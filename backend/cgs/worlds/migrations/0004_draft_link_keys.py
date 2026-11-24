import django.db.models.deletion
from django.db import migrations, models
from django.db.models.functions import Now


class Migration(migrations.Migration):
    dependencies = [("worlds", "0003_manual_draft_history")]

    operations = [
        migrations.CreateModel(
            name="DraftLinkKey",
            fields=[
                ("created_at", models.DateTimeField(db_default=Now())),
                ("pk", models.CompositePrimaryKey(
                    "draft_id", "link_id", blank=True, editable=False, primary_key=True, serialize=False,
                )),
                ("link_id", models.UUIDField()),
                ("first_revision", models.PositiveBigIntegerField()),
                ("draft", models.ForeignKey(
                    to="worlds.worlddraft", on_delete=django.db.models.deletion.RESTRICT,
                    db_constraint=False, db_index=False,
                )),
            ],
            options={"db_table": "draft_link_key"},
        ),
        migrations.RunSQL(
            """
                INSERT INTO draft_link_key (draft_id, link_id, first_revision)
                SELECT draft_id, link.key::uuid, min(revision)
                FROM draft_revision
                CROSS JOIN LATERAL jsonb_object_keys(document -> 'links') AS link(key)
                GROUP BY draft_id, link.key::uuid;

                ALTER TABLE draft_link_key ADD CONSTRAINT draft_link_key_revision_fk
                    FOREIGN KEY (draft_id, first_revision) REFERENCES draft_revision (draft_id, revision)
                    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
            """,
            """
                ALTER TABLE draft_link_key DROP CONSTRAINT draft_link_key_revision_fk;
            """,
        ),
    ]
