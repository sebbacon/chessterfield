from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0004_usersettings_engine_move_speed"),
    ]

    operations = [
        migrations.AlterField(
            model_name="usersettings",
            name="engine_move_speed",
            field=models.CharField(
                choices=[
                    ("instant", "Instant"),
                    ("fast", "Fast"),
                    ("standard", "Standard"),
                    ("slow", "Slow"),
                ],
                default="instant",
                max_length=10,
            ),
        ),
    ]
