import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0032_wiki_health_records")]

    operations = [
        migrations.AddField(
            model_name="wikiobservation",
            name="learning_source",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.RESTRICT,
                                    related_name="+", to="worlds.wikientry"),
        ),
    ]
