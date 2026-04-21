from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("positions", "0006_puzzleimportbatch_puzzleimportpage"),
    ]

    operations = [
        migrations.AddField(
            model_name="position",
            name="possible_bug",
            field=models.BooleanField(default=False),
        ),
    ]
