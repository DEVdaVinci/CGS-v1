import uuid

import django.db.models.deletion
import django.db.models.functions.datetime
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0022_wiki_method_steps")]

    operations = [
        migrations.CreateModel(
            name="WikiCausalAccount",
            fields=[
                ("created_at", models.DateTimeField(db_default=django.db.models.functions.datetime.Now())),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=100)),
                ("applicability", models.CharField(blank=True, max_length=500)),
                ("from_tick", models.PositiveBigIntegerField()),
                ("until_tick", models.PositiveBigIntegerField(null=True)),
                ("author_only", models.BooleanField(default=False)),
                ("citation", models.ForeignKey(
                    null=True, on_delete=django.db.models.deletion.RESTRICT, related_name="+", to="worlds.wikientry",
                )),
                ("holder", models.ForeignKey(
                    on_delete=django.db.models.deletion.RESTRICT, related_name="causal_accounts", to="worlds.wikientry",
                )),
            ],
            options={
                "indexes": [models.Index(fields=["holder", "from_tick"], name="wiki_causal_account_timeline")],
                "constraints": [models.CheckConstraint(
                    condition=models.Q(until_tick__isnull=True) | models.Q(until_tick__gt=models.F("from_tick")),
                    name="wiki_causal_account_interval",
                )],
            },
        ),
        migrations.CreateModel(
            name="WikiCausalTerm",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("phase", models.CharField(
                    choices=[("cause", "Cause"), ("intermediary", "Intermediary"), ("outcome", "Outcome")], max_length=12,
                )),
                ("position", models.PositiveSmallIntegerField()),
                ("account", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="terms", to="worlds.wikicausalaccount",
                )),
                ("belief", models.ForeignKey(
                    on_delete=django.db.models.deletion.RESTRICT, related_name="causal_uses", to="worlds.wikiproposition",
                )),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=["account", "position"], name="wiki_causal_term_position"),
                    models.UniqueConstraint(fields=["account", "phase", "belief"], name="wiki_causal_term_once_per_phase"),
                ],
            },
        ),
    ]
