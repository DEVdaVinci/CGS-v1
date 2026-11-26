from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0019_wiki_measurement_unit_sources")]

    operations = [
        migrations.AlterField(
            model_name="wikientry",
            name="kind",
            field=models.CharField(
                choices=[
                    ("person", "Person"), ("place", "Place"), ("group", "Group"),
                    ("class", "Class"), ("ability", "Ability"), ("item", "Item"),
                    ("species", "Species"), ("organism", "Organism"), ("culture", "Culture"),
                    ("role", "Role"), ("resource", "Resource"), ("body_part", "Body part"),
                    ("trait", "Trait"), ("goal", "Goal"), ("image", "Image"), ("model_3d", "3D model"),
                    ("texture", "Texture"), ("animation", "Animation"), ("map", "Map"), ("territory", "Territory"),
                    ("era", "Era"), ("source", "Source"), ("process", "Mental process"), ("skill", "Skill"),
                    ("milestone", "Goal milestone"), ("requirement", "Requirement"), ("method", "Method"),
                    ("status_def", "Status definition"), ("context", "Capability context"),
                    ("relation_def", "Relationship type"), ("relation", "Relationship"),
                ],
                max_length=12,
            ),
        ),
        migrations.RunSQL(
            """
            INSERT INTO worlds_wikifinding
                (id, created_at, entry_id, field, key, code, record_ids, from_tick, until_tick)
            SELECT gen_random_uuid(), CURRENT_TIMESTAMP, ending.entry_id, ending.field,
                'lifespan:' || starting.id || ':' || ending.id, 'LIFESPAN_CONFLICT',
                jsonb_build_array(starting.id, ending.id),
                GREATEST(starting.from_tick, ending.from_tick), LEAST(starting.until_tick, ending.until_tick)
            FROM worlds_wikiassertion AS ending
            JOIN worlds_wikiassertion AS starting ON starting.entry_id = ending.entry_id
                AND starting.field = CASE ending.field
                    WHEN 'death_tick' THEN 'birth_tick'
                    WHEN 'destruction_tick' THEN 'creation_tick'
                    WHEN 'extinction_tick' THEN 'creation_tick'
                END
            WHERE ending.field IN ('death_tick', 'destruction_tick', 'extinction_tick')
                AND ending.value < starting.value
                AND (LEAST(starting.until_tick, ending.until_tick) IS NULL
                    OR GREATEST(starting.from_tick, ending.from_tick) < LEAST(starting.until_tick, ending.until_tick))
            ON CONFLICT (key) DO NOTHING
            """,
            "DELETE FROM worlds_wikifinding WHERE code = 'LIFESPAN_CONFLICT'",
        ),
    ]
