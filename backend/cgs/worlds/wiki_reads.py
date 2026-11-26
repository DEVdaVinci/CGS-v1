from collections import Counter, defaultdict, deque

from django.db import transaction
from django.db.models import Prefetch, Q

from cgs.api import resource_unavailable

from .drafts import _scoped_read
from .models import (
    WikiAssertion, WikiClaim, WikiDiscovery, WikiEntry, WikiEvent, WikiEventLink, WikiFinding,
    WikiLearnedAbility, WikiMapImage, WikiObservation, WikiWorld,
)
from .wiki import at_tick, can_edit, value_slot, visible_unit, wiki_access
from .wiki_events import event_bounds
from .wiki_layouts import place_layout
from .wiki_maps import describe_image_map
from .wiki_records import (
    causal_accounts_for, derived_age, effective_values, family_links, incoming_links, observation_visible, propositions_for,
)
from .wiki_schema import ACTORS, FIELDS, NONLIVING


def _describe_entry(entry, *, author=False):
    data = {"id": str(entry.pk), "name": entry.name, "kind": entry.kind}
    if author:
        data["author_only"] = entry.author_only
    return data


def _describe_catalog(directory, entries):
    # Catalog membership is independent of a selected time. Keep legacy facts
    # authoritative for their dates, and surface ambiguous classifications for review.
    legacy_items = directory.filter(kind=WikiEntry.Kind.ITEM, catalog_type="")
    classifications = defaultdict(set)
    for entry_id, value in WikiAssertion.objects.filter(
        entry_id__in=legacy_items.values("pk"), field="item_type",
    ).order_by().values_list("entry_id", "value").distinct():
        classifications[entry_id].add(value if isinstance(value, str) else None)

    result = {}
    for entry in entries:
        data = _describe_entry(entry, author=True)
        item_types = classifications.get(entry.pk, ())
        if entry.catalog_type or item_types == {"Vehicle"}:
            data["catalog_type"] = entry.catalog_type or WikiEntry.CatalogType.VEHICLE
        elif "Vehicle" in item_types:
            data["classification_needs_review"] = True
        result[data["id"]] = data
    return result


def search_wiki(world_id, account_id, query):
    with transaction.atomic():
        _scoped_read()
        wiki_access(world_id, account_id, writing=True)
        directory = WikiEntry.objects.filter(wiki_id=world_id, name__icontains=query).order_by("name", "id")
        return {"entries": list(_describe_catalog(directory, list(directory)).values())}


def _world_home(wiki):
    if wiki is None:
        return {"introduction": "", "cover_map_id": None, "featured": []}
    directory = WikiEntry.objects.filter(wiki=wiki, author_only=False, pk__in=wiki.featured_entry_ids)
    featured = _describe_catalog(directory, list(directory))
    cover = WikiMapImage.objects.filter(wiki=wiki, entry_id=wiki.cover_map_id, entry__author_only=False).first()
    return {
        "introduction": wiki.introduction,
        "cover_map_id": str(cover.entry_id) if cover else None,
        "featured": [featured[key] for key in wiki.featured_entry_ids if key in featured],
    }


def read_wiki_home(world_id, account_id):
    with transaction.atomic():
        _scoped_read()
        membership = wiki_access(world_id, account_id)
        wiki = WikiWorld.objects.filter(world_id=world_id).first()
        return {**_world_home(wiki), "can_edit": can_edit(membership)}


def _known_entries(observer, at):
    explicit = WikiDiscovery.objects.filter(observer=observer, learned_at__lte=at).values_list("subject_id", flat=True)
    known = {str(observer.pk), *(str(subject) for subject in explicit)}
    # A recorded observation can establish identity as well as a value. Admit
    # the evidence only when every identity it names is eligible for projection.
    evidence = []
    observations = WikiObservation.objects.filter(observer=observer, learned_at__lte=at).select_related("assertion", "claim")
    for observation in observations:
        source = observation.assertion or observation.claim
        if source.author_only:
            continue
        identities = {str(source.entry_id)}
        if observation.claim_id and source.speaker_id:
            identities.add(str(source.speaker_id))
        if source.qualifier_id:
            identities.add(str(source.qualifier_id))
        if FIELDS[source.field].target_kinds:
            identities.add(str(observation.value))
        evidence.append(identities)
    candidates = set().union(*evidence)
    if candidates:
        allowed = {
            str(pk) for pk in WikiEntry.objects.filter(
                wiki_id=observer.wiki_id, pk__in=candidates, author_only=False,
            ).values_list("pk", flat=True)
        }
        for identities in evidence:
            if identities <= allowed:
                known.update(identities)
    return known


def _id(value):
    return str(value) if value is not None else None


def _serialize_assertion(fact):
    return {
        "id": str(fact.pk), "field": fact.field, "value": fact.value,
        "unit": fact.recorded_unit,
        "from_tick": fact.from_tick, "until_tick": fact.until_tick, "source": fact.source,
        "citation_id": _id(fact.citation_id),
        "author_only": fact.author_only, "event_id": _id(fact.opened_by_id),
        "qualifier_id": _id(fact.qualifier_id),
    }


def _serialize_claim(claim):
    return {
        "id": str(claim.pk), "field": claim.field, "value": claim.value,
        "unit": claim.recorded_unit,
        "tick": claim.tick, "speaker_id": _id(claim.speaker_id),
        "date_precision": claim.date_precision, "start_tick": claim.start_tick, "end_tick": claim.end_tick,
        "source": claim.source, "citation_id": _id(claim.citation_id), "author_only": claim.author_only,
        "qualifier_id": _id(claim.qualifier_id),
    }


def _observations_about(entry):
    return WikiObservation.objects.filter(
        Q(assertion__entry=entry) | Q(claim__entry=entry) | Q(observer=entry)
    ).select_related("assertion", "claim", "claim__speaker", "unit_source").order_by("learned_at", "id")


def _serialize_observation(observation, *, author=False):
    source = observation.assertion or observation.claim
    evidence = {
        "id": str(observation.pk), "field": source.field, "value": observation.value,
        "unit": observation.recorded_unit if author else visible_unit(observation),
        "about_tick": observation.about_tick, "learned_at": observation.learned_at,
        "observer_id": str(observation.observer_id),
        "source_kind": "claim" if observation.claim_id else "assertion",
        "entry_id": str(source.entry_id), "qualifier_id": _id(source.qualifier_id),
    }
    if observation.claim_id and source.speaker_id:
        evidence["speaker_id"] = str(observation.claim.speaker_id)
    if author:
        evidence["source_id"] = str(source.pk)
    return evidence


def _event_outline(event):
    bounds = event_bounds(event)
    return {
        "id": str(event.pk), "tick": event.tick, "node_kind": event.node_kind,
        "date_precision": event.date_precision,
        "parent_id": _id(event.parent_id), "sort_order": event.sort_order,
        "start_tick": event.start_tick, "end_tick": event.end_tick,
        "display_start": bounds[0] if bounds else None, "display_end": bounds[1] if bounds else None,
    }


def _serialize_events(query, outline=None):
    events = query.prefetch_related(
        Prefetch("links", queryset=WikiEventLink.objects.order_by("role", "entry__name", "entry_id")),
        Prefetch("opened_assertions", queryset=WikiAssertion.objects.order_by("entry__name", "field", "id")),
        Prefetch("closed_assertions", queryset=WikiAssertion.objects.order_by("entry__name", "field", "id")),
        "cross_references", "cause_events",
        Prefetch("cause_assertions", queryset=WikiAssertion.objects.order_by("entry__name", "field", "from_tick", "id")),
    ).order_by("tick", "id")
    records = []
    for event in events:
        records.append({
            **(_event_outline(event) if outline is None else outline[str(event.pk)]),
            "name": event.name,
            "source": event.source, "citation_id": _id(event.citation_id),
            "description": event.description, "summary": event.summary, "method": event.method,
            "cross_reference_ids": [str(target.pk) for target in event.cross_references.all()],
            "cause_event_ids": [str(target.pk) for target in event.cause_events.all()],
            "cause_state": [
                {**_serialize_assertion(fact), "entry_id": str(fact.entry_id)} for fact in event.cause_assertions.all()
            ],
            "links": [{"entry_id": str(link.entry_id), "role": link.role} for link in event.links.all()],
            "ability_use": (
                {"ability_id": str(event.ability_id), "actor_id": str(event.performed_by_id)}
                if event.ability_id else None
            ),
            "changes": _event_effects(event),
        })
    if outline is None:
        _derive_group_dates(records)
    return records


def _effect_slot(fact):
    return fact.entry_id, fact.field, *value_slot(fact.field, fact.qualifier_id, fact.value)


def _event_effects(event):
    closed = {_effect_slot(fact): fact for fact in event.closed_assertions.all()}
    result = []
    for fact in event.opened_assertions.all():
        previous = closed.pop(_effect_slot(fact), None)
        result.append({
            "id": str(fact.pk), "entry_id": str(fact.entry_id), "field": fact.field,
            "qualifier_id": _id(fact.qualifier_id), "value": fact.value,
            "unit": fact.recorded_unit, "previous_unit": previous.recorded_unit if previous else None,
            "previous_value": previous.value if previous else None,
        })
    for fact in closed.values():
        result.append({
            "id": str(fact.pk), "entry_id": str(fact.entry_id), "field": fact.field,
            "qualifier_id": _id(fact.qualifier_id), "value": None, "previous_value": fact.value,
            "unit": None, "previous_unit": fact.recorded_unit,
        })
    return result


def _derive_group_dates(records):
    nodes = {node["id"]: node for node in records}
    children = Counter(node["parent_id"] for node in records)
    pending = deque(node for node in records if not children[node["id"]])
    while pending:
        node = pending.popleft()
        parent = nodes.get(node["parent_id"])
        if parent is None:
            continue
        if parent["start_tick"] is None and node["display_start"] is not None:
            if parent["display_start"] is None:
                parent["display_start"], parent["display_end"] = node["display_start"], node["display_end"]
            else:
                parent["display_start"] = min(parent["display_start"], node["display_start"])
                parent["display_end"] = max(parent["display_end"], node["display_end"])
        children[parent["id"]] -= 1
        if children[parent["id"]] == 0:
            pending.append(parent)


def _place_contents(place, at):
    locations = at_tick(WikiAssertion.objects.filter(entry__wiki_id=place.wiki_id, field="located_in"), at)
    here = locations.filter(value=str(place.pk)).values("entry_id")
    elsewhere = locations.exclude(value=str(place.pk)).values("entry_id")
    entries = WikiEntry.objects.filter(pk__in=here).exclude(pk__in=elsewhere).exclude(kind="group").order_by("name", "id")
    return [_describe_entry(item, author=True) for item in entries]


def _learned_abilities(character, at):
    abilities = WikiLearnedAbility.objects.filter(character=character, learned_at__lte=at).order_by("ability__name", "id")
    return [
        {"id": str(item.pk), "ability_id": str(item.ability_id), "learned_at": item.learned_at, "source": item.source}
        for item in abilities
    ]


def _article_events(entry):
    world_events = WikiEvent.objects.filter(wiki_id=entry.wiki_id)
    linked = world_events.filter(
        Q(opened_assertions__entry=entry) | Q(closed_assertions__entry=entry)
        | Q(links__entry=entry) | Q(ability=entry) | Q(performed_by=entry) | Q(cause_assertions__entry=entry)
    ).distinct()
    direct = {str(event_id) for event_id in linked.values_list("id", flat=True)}
    if not direct:
        return [], []
    nodes = [_event_outline(event) for event in world_events.only(
        "tick", "node_kind", "date_precision", "parent_id", "sort_order", "start_tick", "end_tick",
    )]
    _derive_group_dates(nodes)
    outline = {node["id"]: node for node in nodes}
    include = direct.copy()
    for event_id in direct:
        parent = outline[event_id]["parent_id"]
        while parent is not None and parent not in include:
            include.add(parent)
            parent = outline[parent]["parent_id"]
    records = _serialize_events(world_events.filter(pk__in=include), outline)
    return (
        [event for event in records if event["id"] in direct],
        [event for event in records if event["id"] not in direct],
    )


def _author_article(entry, at, identity):
    facts = list(WikiAssertion.objects.filter(entry=entry).order_by("field", "from_tick", "id"))
    claims = WikiClaim.objects.filter(entry=entry).order_by("tick", "id")
    events, event_ancestors = _article_events(entry)
    findings = WikiFinding.objects.filter(entry=entry, resolved_at_edit__isnull=True).order_by("from_tick", "id")
    article = {
        "entry": identity,
        "overview": entry.overview,
        "sections": entry.article_sections,
        "discoveries": [
            {"observer_id": str(item.observer_id), "learned_at": item.learned_at, "source": item.source}
            for item in WikiDiscovery.objects.filter(subject=entry).order_by("learned_at", "id")
        ],
        "assertions": [_serialize_assertion(fact) for fact in facts],
        "claims": [_serialize_claim(claim) for claim in claims],
        "events": events,
        "event_ancestors": event_ancestors,
        "observations": [_serialize_observation(o, author=True) for o in _observations_about(entry)],
        "findings": [
            {
                "id": str(finding.pk), "code": finding.code, "field": finding.field,
                "record_ids": finding.record_ids, "from_tick": finding.from_tick, "until_tick": finding.until_tick,
            }
            for finding in findings
        ],
    }
    if entry.kind == WikiEntry.Kind.GROUP:
        article["legacy_location_review"] = any(fact.field == "located_in" for fact in facts)
    if entry.kind == WikiEntry.Kind.MAP:
        image_map = describe_image_map(entry)
        if image_map is not None:
            article["image_map"] = image_map
    if entry.kind in ACTORS:
        article["variant_of_id"] = str(entry.variant_of_id) if entry.variant_of_id else None
        article["variant_ids"] = [
            str(entry_id) for entry_id in entry.variants.filter(wiki_id=entry.wiki_id, kind__in=ACTORS)
            .order_by("name", "id").values_list("id", flat=True)
        ]
    if at is None:
        return article
    values = effective_values(entry, facts, at)
    article.update(values=values, propositions=propositions_for(entry, at), incoming_links=incoming_links(entry, at))
    if entry.kind in ACTORS:
        article["learned_abilities"] = _learned_abilities(entry, at)
        article["family"] = family_links(entry, facts, at)
        article["causal_accounts"] = causal_accounts_for(entry, at)
    if entry.kind in (*ACTORS, *NONLIVING, "species"):
        article["age_years"] = derived_age(entry, values, at)
    if entry.kind == WikiEntry.Kind.PLACE:
        contents = _place_contents(entry, at)
        article["contents"] = contents
        article["parts"] = [item for item in contents if item["kind"] == "place"]
        article["occupants"] = [item for item in contents if item["kind"] != "place"]
        article["layout"] = place_layout(entry, at)
    return article


def _character_article(entry, observer, at, visible_ids):
    observations = _observations_about(entry).filter(observer=observer, learned_at__lte=at)
    knowledge = [_serialize_observation(o) for o in observations if observation_visible(o, visible_ids)]
    return {
        "entry": _describe_entry(entry), "observations": knowledge,
        "propositions": propositions_for(entry, at, observer, visible_ids),
        "causal_accounts": causal_accounts_for(entry, at, observer, visible_ids),
    }


def read_wiki(world_id, account_id, at, observer_id=None, entry_id=None, *, timeline=False):
    with transaction.atomic():
        _scoped_read()
        membership = wiki_access(world_id, account_id)
        wiki = WikiWorld.objects.filter(world_id=world_id).first()
        directory = WikiEntry.objects.filter(wiki_id=world_id).order_by("name", "id")
        observer = None
        if observer_id is not None:
            observer = directory.filter(pk=observer_id, kind__in=ACTORS).first()
            if observer is None:
                raise resource_unavailable()
            directory = directory.filter(author_only=False, pk__in=_known_entries(observer, at))
        entries = list(directory)
        indexed = {str(entry.pk): entry for entry in entries}
        descriptions = (
            {entry_id: _describe_entry(entry) for entry_id, entry in indexed.items()}
            if observer else _describe_catalog(directory, entries)
        )
        selected = indexed.get(str(entry_id)) if entry_id is not None else None
        if entry_id is not None and selected is None:
            raise resource_unavailable()
        response = {
            "world_name": membership.world.title, "at": at,
            "viewpoint": _describe_entry(observer) if observer else None,
            "entries": list(descriptions.values()),
            "fields": [definition.describe() for definition in FIELDS.values()],
            "article": None,
        }
        if observer is None:
            response.update(
                can_edit=can_edit(membership), edit_counter=wiki.edit_counter if wiki else 0,
                checked_scope="temporal_and_references",
                days_per_year=wiki.days_per_year if wiki else None,
                world_introduction=wiki.introduction if wiki else "",
            )
            if at is None and entry_id is None and not timeline:
                response["world_home"] = _world_home(wiki)
                response["home_cover_ids"] = [
                    str(pk) for pk in WikiMapImage.objects.filter(
                        wiki_id=world_id, entry__author_only=False, entry__isnull=False,
                    ).values_list("entry_id", flat=True)
                ] if can_edit(membership) else []
        if selected is not None:
            response["article"] = (
                _character_article(selected, observer, at, indexed)
                if observer else _author_article(selected, at, descriptions[str(selected.pk)])
            )
        if timeline:
            response["timeline"] = _serialize_events(WikiEvent.objects.filter(wiki_id=world_id)) if observer is None else []
        return response
