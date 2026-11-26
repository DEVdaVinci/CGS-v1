from collections import defaultdict

from django.db import migrations, models


# Freeze the fields and unit rules supported by the pre-migration Wiki.
MEASURES = (
    "resource_amount", "actual_rating", "physical_average", "physical_distribution",
    "power_average", "power_distribution", "processing_speed", "mental_bandwidth",
    "processing_efficiency", "processing_cost", "processing_overload", "emotional_stress",
)


def fill_recorded_units(apps, schema_editor):
    database = schema_editor.connection.alias
    assertions = apps.get_model("worlds", "WikiAssertion").objects.using(database)
    units = defaultdict(list)
    for entry, start, end, value in assertions.filter(field="unit").values_list(
        "entry_id", "from_tick", "until_tick", "value"
    ).iterator():
        if isinstance(value, str) and value.strip():
            units[entry].append((start, end, value))

    def backfill(query, recorded_unit):
        batch = []
        for record in query.iterator(chunk_size=500):
            if (unit := recorded_unit(record)) is None:
                continue
            record.recorded_unit = unit
            batch.append(record)
            if len(batch) == 500:
                query.bulk_update(batch, ["recorded_unit"])
                batch.clear()
        if batch:
            query.bulk_update(batch, ["recorded_unit"])

    for model, date in (
        ("WikiAssertion", lambda record: record.from_tick),
        ("WikiClaim", lambda record: record.tick),
        ("WikiProposition", lambda record: record.from_tick if record.about_tick is None else record.about_tick),
    ):
        records = apps.get_model("worlds", model).objects.using(database).filter(field__in=MEASURES)

        def unit_at_recorded_date(record):
            tick = date(record)
            applicable = {
                unit for start, end, unit in units[record.qualifier_id]
                if start <= tick and (end is None or tick < end)
            }
            return next(iter(applicable)) if len(applicable) == 1 else None

        backfill(records, unit_at_recorded_date)

    observations = apps.get_model("worlds", "WikiObservation").objects.using(database).select_related("assertion", "claim")
    backfill(observations, lambda record: (record.assertion or record.claim).recorded_unit)


class Migration(migrations.Migration):
    dependencies = [("worlds", "0015_wiki_dates_and_sources")]

    operations = [
        migrations.AddField(
            model_name=name,
            name="recorded_unit",
            field=models.CharField(blank=True, max_length=500, null=True),
        )
        for name in ("wikiassertion", "wikiclaim", "wikiobservation", "wikiproposition")
    ] + [migrations.RunPython(fill_recorded_units, migrations.RunPython.noop)]
