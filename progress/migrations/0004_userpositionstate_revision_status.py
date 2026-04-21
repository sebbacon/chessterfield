from django.db import migrations, models


MASTERED_MASTERY_THRESHOLD = 85


def recalculate_position_statuses(apps, schema_editor):
    UserPositionState = apps.get_model("progress", "UserPositionState")

    for state in UserPositionState.objects.all().iterator():
        if state.last_played_at is None and state.attempt_count == 0 and state.solved_count == 0:
            next_status = "new"
        elif state.mastery_score >= MASTERED_MASTERY_THRESHOLD:
            next_status = "mastered"
        elif state.solved_count > 0:
            next_status = "revision"
        else:
            next_status = "in_progress"

        if state.status != next_status:
            state.status = next_status
            state.save(update_fields=["status", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("progress", "0003_userpositionstate_current_perfect_streak_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userpositionstate",
            name="status",
            field=models.CharField(
                choices=[
                    ("new", "New"),
                    ("in_progress", "In progress"),
                    ("revision", "Revision"),
                    ("mastered", "Mastered"),
                ],
                default="new",
                max_length=20,
            ),
        ),
        migrations.RunPython(recalculate_position_statuses, migrations.RunPython.noop),
    ]
