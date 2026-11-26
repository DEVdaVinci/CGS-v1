import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0020_wiki_context_and_lifespan")]

    operations = [
        migrations.AddField(
            model_name="wikientry",
            name="variant_of",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.RESTRICT,
                related_name="variants", to="worlds.wikientry",
            ),
        ),
        migrations.AddConstraint(
            model_name="wikientry",
            constraint=models.CheckConstraint(
                condition=models.Q(variant_of__isnull=True) | (
                    models.Q(kind__in=("person", "organism")) & ~models.Q(id=models.F("variant_of_id"))
                ),
                name="wiki_entry_actor_variant",
            ),
        ),
    ]
