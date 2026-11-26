import django.db.models.deletion
from django.db import migrations, models


def fill_unit_sources(apps, schema_editor):
    # These table and column names are from this migration's PostgreSQL schema.
    measures = {
        "worlds_wikiassertion": "measurement.from_tick",
        "worlds_wikiclaim": "measurement.tick",
        "worlds_wikiproposition": "COALESCE(measurement.about_tick, measurement.from_tick)",
    }
    for table, date in measures.items():
        schema_editor.execute(f"""
            UPDATE {table} AS measurement
            SET unit_source_id = (
                SELECT unit.id
                FROM worlds_wikiassertion AS unit
                WHERE unit.entry_id = measurement.qualifier_id
                  AND unit.field = 'unit'
                  AND unit.value = to_jsonb(measurement.recorded_unit)
                  AND unit.from_tick <= {date}
                  AND (unit.until_tick IS NULL OR {date} < unit.until_tick)
                ORDER BY unit.author_only, unit.id
                LIMIT 1
            )
            WHERE measurement.recorded_unit IS NOT NULL
        """)

    schema_editor.execute("""
        UPDATE worlds_wikiobservation AS observation
        SET unit_source_id = COALESCE(
            (SELECT unit_source_id FROM worlds_wikiassertion WHERE id = observation.assertion_id),
            (SELECT unit_source_id FROM worlds_wikiclaim WHERE id = observation.claim_id)
        )
        WHERE observation.recorded_unit IS NOT NULL
    """)


class Migration(migrations.Migration):
    dependencies = [("worlds", "0018_wiki_statement_dates")]

    operations = [
        migrations.AddField(
            model_name=name,
            name="unit_source",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.RESTRICT, related_name="+", to="worlds.wikiassertion",
            ),
        )
        for name in ("wikiassertion", "wikiclaim", "wikiobservation", "wikiproposition")
    ] + [migrations.RunPython(fill_unit_sources, migrations.RunPython.noop)]
