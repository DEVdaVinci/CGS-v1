from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0029_wiki_relationship_terms")]
    operations = [
        migrations.AddField(
            model_name="wikiclaim",
            name="additional_citations",
            field=models.ManyToManyField(blank=True, related_name="supported_claims", to="worlds.wikientry"),
        ),
        migrations.AddField(
            model_name="wikiobservation",
            name="learning_note",
            field=models.CharField(blank=True, default="", max_length=500),
        ),
        migrations.AddField(
            model_name="wikiobservation",
            name="author_only",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="wikiproposition",
            name="additional_evidence",
            field=models.ManyToManyField(blank=True, related_name="supported_beliefs", to="worlds.wikiobservation"),
        ),
        migrations.AddField(
            model_name="wikiproposition",
            name="confidence",
            field=models.DecimalField(decimal_places=9, max_digits=10, null=True),
        ),
        migrations.AddConstraint(
            model_name="wikiproposition",
            constraint=models.CheckConstraint(
                condition=models.Q(confidence__isnull=True) | models.Q(confidence__gte=0, confidence__lte=1),
                name="wiki_belief_confidence_range",
            ),
        ),
    ]
