from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import UserProfile, UserSettings


@receiver(post_save, sender=get_user_model())
def ensure_user_records(sender, instance, created, **kwargs):
    if not created:
        return
    UserProfile.objects.get_or_create(user=instance)
    UserSettings.objects.get_or_create(user=instance)

