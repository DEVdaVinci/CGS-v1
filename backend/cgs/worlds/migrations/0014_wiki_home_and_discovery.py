from uuid import uuid4

from django.db import migrations, models
from django.db.models.functions import Now


class Migration(migrations.Migration):
    dependencies = [("worlds", "0013_wiki_editorial_content")]

    operations = [
        migrations.AlterField(
            model_name="wikiworld",
            name="introduction",
            field=models.CharField(max_length=3000, blank=True, default="", db_default=""),
        ),
        migrations.AlterField(
            model_name="wikientry",
            name="article_sections",
            field=models.JSONField(default=list, db_default=models.Value([], output_field=models.JSONField()), blank=True),
        ),
        migrations.AddField(
            model_name="wikiworld",
            name="featured_entry_ids",
            field=models.JSONField(default=list, db_default=models.Value([], output_field=models.JSONField()), blank=True),
        ),
        migrations.AddField(
            model_name="wikiworld",
            name="cover_map",
            field=models.ForeignKey(
                to="worlds.wikientry", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
            ),
        ),
        migrations.CreateModel(
            name="WikiDiscovery",
            fields=[
                ("created_at", models.DateTimeField(db_default=Now())),
                ("id", models.UUIDField(default=uuid4, editable=False, primary_key=True, serialize=False)),
                ("learned_at", models.PositiveBigIntegerField()),
                ("source", models.CharField(max_length=500, blank=True)),
                ("observer", models.ForeignKey(to="worlds.wikientry", on_delete=models.RESTRICT, related_name="discoveries")),
                ("subject", models.ForeignKey(to="worlds.wikientry", on_delete=models.RESTRICT, related_name="discovered_by")),
            ],
            options={
                "constraints": [models.UniqueConstraint(
                    fields=("observer", "subject"), name="wiki_discovery_observer_subject",
                )],
            },
        ),
        migrations.AlterField(
            model_name="wikieventlink",
            name="role",
            field=models.CharField(max_length=12, choices=[
                ("participant", "Participant"), ("performer", "Performer"), ("target", "Target"), ("place", "Place"),
                ("item", "Item"), ("purpose", "Purpose"), ("backstory", "Backstory"), ("era", "Era"),
            ]),
        ),
    ]
