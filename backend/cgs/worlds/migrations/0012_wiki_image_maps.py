from uuid import uuid4

from django.conf import settings
from django.db import migrations, models
from django.db.models.functions import Now


class Migration(migrations.Migration):
    dependencies = [
        ("worlds", "0011_wiki_workspace"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="WikiMapImage",
            fields=[
                ("created_at", models.DateTimeField(db_default=Now())),
                ("id", models.UUIDField(default=uuid4, editable=False, primary_key=True, serialize=False)),
                ("request_key", models.UUIDField()),
                ("storage_key", models.CharField(max_length=100)),
                ("digest", models.CharField(max_length=64)),
                ("content_type", models.CharField(max_length=12)),
                ("width", models.PositiveIntegerField()),
                ("height", models.PositiveIntegerField()),
                ("entry", models.OneToOneField(
                    null=True, on_delete=models.RESTRICT, related_name="base_map_image", to="worlds.wikientry",
                )),
                ("uploaded_by", models.ForeignKey(on_delete=models.RESTRICT, to=settings.AUTH_USER_MODEL)),
                ("wiki", models.ForeignKey(on_delete=models.RESTRICT, to="worlds.wikiworld")),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("wiki", "uploaded_by", "request_key"), name="wiki_map_upload_request_key",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="WikiMapPin",
            fields=[
                ("created_at", models.DateTimeField(db_default=Now())),
                ("id", models.UUIDField(default=uuid4, editable=False, primary_key=True, serialize=False)),
                ("label", models.CharField(max_length=100)),
                ("x", models.FloatField()),
                ("y", models.FloatField()),
                ("map_entry", models.ForeignKey(
                    on_delete=models.RESTRICT, related_name="map_pins", to="worlds.wikientry",
                )),
                ("place", models.ForeignKey(
                    null=True, on_delete=models.RESTRICT, related_name="map_place_pins", to="worlds.wikientry",
                )),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(x__gte=0, x__lte=1, y__gte=0, y__lte=1),
                        name="wiki_map_pin_image_bounds",
                    ),
                ],
            },
        ),
    ]
