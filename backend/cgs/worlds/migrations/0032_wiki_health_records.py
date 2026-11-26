from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0031_wiki_event_significance")]
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
                    ("trait", "Trait"), ("goal", "Goal"), ("image", "Image"),
                    ("model_3d", "3D model"), ("texture", "Texture"), ("animation", "Animation"),
                    ("map", "Map"), ("territory", "Territory"), ("era", "Era"), ("source", "Source"),
                    ("process", "Mental process"), ("skill", "Skill"), ("milestone", "Goal milestone"),
                    ("requirement", "Requirement"), ("method", "Method"), ("status_def", "Status definition"),
                    ("context", "Capability context"), ("relation_def", "Relationship type"),
                    ("relation", "Relationship"), ("method_step", "Method step"), ("body_fn", "Body function"),
                    ("resource_mv", "Resource movement"), ("value_def", "Value"), ("preference", "Preference"),
                    ("motivation", "Motivation"), ("behavior", "Behavior"), ("rel_term", "Term set"),
                    ("health_case", "Health record"),
                ],
                max_length=12,
            ),
        ),
    ]
