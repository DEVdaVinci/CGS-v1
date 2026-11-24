import django.db.models.deletion
from django.db import migrations, models
from django.db.models.functions import Now


class Migration(migrations.Migration):
    dependencies = [("worlds", "0002_scoped_constraints")]

    operations = [
        migrations.AddField(
            model_name="draftrevision",
            name="policy_version",
            field=models.PositiveBigIntegerField(db_default=1),
        ),
        migrations.AddField(
            model_name="mutationreceipt",
            name="draft_response",
            field=models.JSONField(null=True),
        ),
        migrations.CreateModel(
            name="EntityKey",
            fields=[
                ("created_at", models.DateTimeField(db_default=Now())),
                ("id", models.UUIDField(primary_key=True, editable=False, serialize=False)),
                ("kind", models.CharField(max_length=16)),
                ("first_revision", models.PositiveBigIntegerField()),
                ("draft", models.ForeignKey(
                    to="worlds.worlddraft", on_delete=django.db.models.deletion.RESTRICT,
                    db_constraint=False, db_index=False,
                )),
                ("world", models.ForeignKey(
                    to="worlds.world", on_delete=django.db.models.deletion.RESTRICT, db_index=False,
                )),
            ],
            options={
                "db_table": "entity_key",
                "constraints": [
                    models.UniqueConstraint(fields=["world", "id"], name="entity_key_world_scope"),
                    models.CheckConstraint(
                        condition=models.Q(kind__in=["place", "actor", "item", "role"]),
                        name="entity_key_valid_kind",
                    ),
                ],
            },
        ),
        migrations.RunSQL(
            """
                ALTER TABLE draft_revision
                    ADD CONSTRAINT draft_revision_policy_fk
                    FOREIGN KEY (draft_id, policy_version) REFERENCES draft_policy (draft_id, version)
                    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

                ALTER TABLE entity_key
                    ADD CONSTRAINT entity_key_first_revision_fk
                    FOREIGN KEY (world_id, draft_id, first_revision)
                    REFERENCES draft_revision (world_id, draft_id, revision)
                    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
            """,
            """
                ALTER TABLE entity_key DROP CONSTRAINT entity_key_first_revision_fk;
                ALTER TABLE draft_revision DROP CONSTRAINT draft_revision_policy_fk;
            """,
        ),
    ]
