from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0025_wiki_shared_goals_and_motivation")]

    operations = [
        migrations.AddField(
            model_name="wikifinding",
            name="details",
            field=models.JSONField(
                blank=True, db_default=models.Value({}, output_field=models.JSONField()), default=dict,
            ),
        ),
    ]
