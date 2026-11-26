from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("worlds", "0010_wiki_event_performer"),
    ]

    operations = [
        migrations.AddField(
            model_name="wikientry",
            name="overview",
            field=models.CharField(blank=True, default="", max_length=1500),
        ),
        migrations.AddField(
            model_name="wikientry",
            name="catalog_type",
            field=models.CharField(blank=True, choices=[("vehicle", "Vehicle")], default="", max_length=12),
        ),
        migrations.AddConstraint(
            model_name="wikientry",
            constraint=models.CheckConstraint(
                condition=models.Q(catalog_type="") | models.Q(kind="item", catalog_type="vehicle"),
                name="wiki_entry_catalog_type_matches_kind",
            ),
        ),
    ]
