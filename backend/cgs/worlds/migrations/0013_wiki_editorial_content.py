from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0012_wiki_image_maps")]

    operations = [
        migrations.AddField(
            model_name="wikiworld",
            name="introduction",
            field=models.CharField(max_length=3000, blank=True, default=""),
        ),
        migrations.AddField(
            model_name="wikientry",
            name="article_sections",
            field=models.JSONField(default=list, blank=True),
        ),
    ]
