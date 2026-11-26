from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worlds", "0030_wiki_claim_and_belief_evidence")]
    operations = [
        migrations.AddField(
            model_name="wikievent",
            name="significance",
            field=models.CharField(blank=True, choices=[("major", "Major"), ("minor", "Minor")], default="", max_length=5),
        ),
        migrations.AddConstraint(
            model_name="wikievent",
            constraint=models.CheckConstraint(condition=models.Q(significance__in=("", "major", "minor")), name="wiki_event_significance"),
        ),
    ]
