import uuid

from django.db import migrations, models
from django.db.models.functions import Now


class Migration(migrations.Migration):
    dependencies = [("worlds", "0027_wiki_behavior_definitions")]
    operations = [
        migrations.CreateModel(
            name="WikiEventReport",
            fields=[
                ("created_at", models.DateTimeField(db_default=Now())),
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("title", models.CharField(max_length=120)),
                ("account", models.CharField(max_length=1500, blank=True)),
                ("source", models.CharField(max_length=500, blank=True)),
                ("learned_at", models.PositiveBigIntegerField()),
                ("reported_tick", models.PositiveBigIntegerField(null=True)),
                ("earliest_tick", models.PositiveBigIntegerField(null=True)),
                ("latest_tick", models.PositiveBigIntegerField(null=True)),
                ("author_only", models.BooleanField(default=False)),
                ("event", models.ForeignKey(on_delete=models.RESTRICT, related_name="character_reports", to="worlds.wikievent")),
                ("observer", models.ForeignKey(on_delete=models.RESTRICT, related_name="event_reports", to="worlds.wikientry")),
                ("known_entries", models.ManyToManyField(blank=True, related_name="event_report_mentions", to="worlds.wikientry")),
            ],
            options={
                "indexes": [models.Index(fields=["observer", "learned_at"], name="wiki_event_report_knowledge")],
                "constraints": [models.CheckConstraint(
                    condition=(models.Q(earliest_tick__isnull=True, latest_tick__isnull=True) | models.Q(
                        reported_tick__isnull=True, earliest_tick__isnull=False, latest_tick__isnull=False,
                        latest_tick__gte=models.F("earliest_tick"),
                    )),
                    name="wiki_event_report_dates",
                )],
            },
        ),
    ]
