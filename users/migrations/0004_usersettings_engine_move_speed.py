from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0003_backfill_user_records"),
    ]

    operations = [
        migrations.AddField(
            model_name="usersettings",
            name="engine_move_speed",
            field=models.CharField(
                choices=[("fast", "Fast"), ("standard", "Standard"), ("slow", "Slow")],
                default="standard",
                max_length=10,
            ),
        ),
    ]
