from django.conf import settings
from django.db import migrations


def backfill_user_records(apps, schema_editor):
    user_model = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    UserProfile = apps.get_model("users", "UserProfile")
    UserSettings = apps.get_model("users", "UserSettings")

    for user in user_model.objects.all().iterator():
        UserProfile.objects.get_or_create(user=user)
        UserSettings.objects.get_or_create(user=user)


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0002_signupcode"),
    ]

    operations = [
        migrations.RunPython(backfill_user_records, migrations.RunPython.noop),
    ]
