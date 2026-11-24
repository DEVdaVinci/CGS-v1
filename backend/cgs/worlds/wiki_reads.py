from django.db import transaction
from django.db.models import Prefetch, Q

from cgs.api import resource_unavailable

from .drafts import _scoped_read
from .models import (
    WikiAssertion, WikiClaim, WikiEntry, WikiEvent, WikiEventLink, WikiFinding,
    WikiLearnedAbility, WikiObservation, WikiWorld,
)
from .wiki import at_tick, can_edit, contains_tick, wiki_access
from .wiki_schema import FIELDS


def _describe_entry(entry, *, author=False):
    data = {"id": str(entry.pk), "name": entry.name, "kind": entry.kind}
    if author:
        data["author_only"] = entry.author_only
    return data


def _id(value):
    return str(value) if value is not None else None


def _serialize_assertion(fact):
    return {
        "id": str(fact.pk), "field": fact.field, "value": fact.value,
        "from_tick": fact.from_tick, "until_tick": fact.until_tick, "source": fact.source,
        "author_only": fact.author_only, "event_id": _id(fact.opened_by_id),
    }


def _serialize_claim(claim):
    return {
        "id": str(claim.pk), "field": claim.field, "value": claim.value,
        "tick": claim.tick, "speaker_id": str(claim.speaker_id),
        "source": claim.source, "author_only": claim.author_only,
    }


def _observations_about(entry):
    return WikiObservation.objects.filter(
        Q(assertion__entry=entry) | Q(claim__entry=entry)
    ).select_related("assertion", "claim", "claim__speaker").order_by("learned_at", "id")


def _serialize_observation(observation, *, author=False):
    source = observation.assertion or observation.claim
    evidence = {
        "id": str(observation.pk), "field": source.field, "value": observation.value,
        "about_tick": observation.about_tick, "learned_at": observation.learned_at,
        "observer_id": str(observation.observer_id),
        "source_kind": "claim" if observation.claim_id else "assertion",
    }
    if observation.claim_id:
        evidence["speaker_id"] = str(observation.claim.speaker_id)
    if author:
        evidence["source_id"] = str(source.pk)
    return evidence


def _effective_values(entry, facts, at):
    result = []
    for definition in FIELDS.values():
        if entry.kind not in definition.kinds:
            continue
        matching = [fact for fact in facts if fact.field == definition.key and contains_tick(fact, at)]
        data = {"field": definition.key, "state": "unknown"}
        if matching:
            value = matching[0].value
            if any(fact.value != value for fact in matching[1:]):
                data["state"] = "conflict"
            else:
                data.update(state="value", value=value)
        result.append(data)
    return result


def _serialize_events(query):
    events = query.prefetch_related(
        Prefetch("links", queryset=WikiEventLink.objects.order_by("role", "entry__name", "entry_id")),
        Prefetch("opened_assertions", queryset=WikiAssertion.objects.order_by("entry__name", "field", "id")),
    ).order_by("tick", "id")
    return [
        {
            "id": str(event.pk), "name": event.name, "tick": event.tick,
            "source": event.source, "description": event.description,
            "links": [{"entry_id": str(link.entry_id), "role": link.role} for link in event.links.all()],
            "ability_use": (
                {"ability_id": str(event.ability_id), "actor_id": str(event.performed_by_id)}
                if event.ability_id else None
            ),
            "changes": [
                {"entry_id": str(fact.entry_id), "field": fact.field, "value": fact.value}
                for fact in event.opened_assertions.all()
            ],
        }
        for event in events
    ]


def _place_contents(place, at):
    locations = at_tick(WikiAssertion.objects.filter(entry__wiki_id=place.wiki_id, field="located_in"), at)
    here = locations.filter(value=str(place.pk)).values("entry_id")
    elsewhere = locations.exclude(value=str(place.pk)).values("entry_id")
    entries = WikiEntry.objects.filter(pk__in=here).exclude(pk__in=elsewhere).order_by("name", "id")
    return [_describe_entry(item, author=True) for item in entries]


def _learned_abilities(character, at):
    abilities = WikiLearnedAbility.objects.filter(character=character, learned_at__lte=at).order_by("ability__name", "id")
    return [
        {"id": str(item.pk), "ability_id": str(item.ability_id), "learned_at": item.learned_at, "source": item.source}
        for item in abilities
    ]


def _author_article(entry, at):
    facts = list(WikiAssertion.objects.filter(entry=entry).order_by("field", "from_tick", "id"))
    claims = WikiClaim.objects.filter(entry=entry).order_by("tick", "id")
    events = WikiEvent.objects.filter(wiki_id=entry.wiki_id).filter(
        Q(opened_assertions__entry=entry) | Q(closed_assertions__entry=entry)
        | Q(links__entry=entry) | Q(ability=entry) | Q(performed_by=entry)
    ).distinct()
    findings = WikiFinding.objects.filter(entry=entry, resolved_at_edit__isnull=True).order_by("from_tick", "id")
    article = {
        "entry": _describe_entry(entry, author=True),
        "values": _effective_values(entry, facts, at),
        "assertions": [_serialize_assertion(fact) for fact in facts],
        "claims": [_serialize_claim(claim) for claim in claims],
        "events": _serialize_events(events),
        "observations": [_serialize_observation(o, author=True) for o in _observations_about(entry)],
        "findings": [
            {
                "id": str(finding.pk), "code": finding.code, "field": finding.field,
                "record_ids": finding.record_ids, "from_tick": finding.from_tick, "until_tick": finding.until_tick,
            }
            for finding in findings
        ],
    }
    if entry.kind == WikiEntry.Kind.PERSON:
        article["learned_abilities"] = _learned_abilities(entry, at)
    if entry.kind == WikiEntry.Kind.PLACE:
        article["contents"] = _place_contents(entry, at)
    return article


def _character_article(entry, observer, at, visible_ids):
    observations = _observations_about(entry).filter(observer=observer, learned_at__lte=at)
    knowledge = []
    for observation in observations:
        source = observation.assertion or observation.claim
        if source.author_only:
            continue
        if observation.claim_id and observation.claim.speaker.author_only:
            continue
        if FIELDS[source.field].target_kind and observation.value not in visible_ids:
            continue
        knowledge.append(_serialize_observation(observation))
    return {"entry": _describe_entry(entry), "observations": knowledge}


def read_wiki(world_id, account_id, at, observer_id=None, entry_id=None, *, timeline=False):
    with transaction.atomic():
        _scoped_read()
        membership = wiki_access(world_id, account_id)
        wiki = WikiWorld.objects.filter(world_id=world_id).first()
        directory = WikiEntry.objects.filter(wiki_id=world_id).order_by("name", "id")
        observer = None
        if observer_id is not None:
            observer = directory.filter(pk=observer_id, kind=WikiEntry.Kind.PERSON).first()
            if observer is None:
                raise resource_unavailable()
            directory = directory.filter(author_only=False)
        entries = list(directory)
        indexed = {str(entry.pk): entry for entry in entries}
        selected = indexed.get(str(entry_id)) if entry_id is not None else None
        if entry_id is not None and selected is None:
            raise resource_unavailable()
        response = {
            "world_name": membership.world.title, "at": at,
            "viewpoint": _describe_entry(observer) if observer else None,
            "entries": [_describe_entry(entry, author=observer is None) for entry in entries],
            "fields": [definition.describe() for definition in FIELDS.values()],
            "article": None,
        }
        if observer is None:
            response.update(
                can_edit=can_edit(membership), edit_counter=wiki.edit_counter if wiki else 0,
                checked_scope="temporal_and_references",
            )
        if selected is not None:
            response["article"] = (
                _character_article(selected, observer, at, indexed) if observer else _author_article(selected, at)
            )
        if timeline:
            response["timeline"] = _serialize_events(WikiEvent.objects.filter(wiki_id=world_id)) if observer is None else []
        return response
