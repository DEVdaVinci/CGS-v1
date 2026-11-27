import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0033_wiki_observation_learning_source")]

    operations = [
        migrations.AddField(
            model_name="wikiclaim",
            name="anchor_event",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.RESTRICT,
                                    related_name="anchored_claims", to="worlds.wikievent"),
        ),
    ]
