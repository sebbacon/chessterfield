from django.conf import settings
from django.db import models


class UserProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    display_name = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.display_name or self.user.get_username()

    @property
    def effective_display_name(self) -> str:
        return self.display_name or self.user.get_username()


class UserSettings(models.Model):
    class PreferredSide(models.TextChoices):
        AUTO = "auto", "Auto"
        WHITE = "white", "White"
        BLACK = "black", "Black"

    class AnalysisVisibility(models.TextChoices):
        VISIBLE = "visible", "Visible"
        HIDDEN = "hidden", "Hidden"

    class EngineMoveSpeed(models.TextChoices):
        INSTANT = "instant", "Instant"
        FAST = "fast", "Fast"
        STANDARD = "standard", "Standard"
        SLOW = "slow", "Slow"

    class LibraryMode(models.TextChoices):
        POSITIONS = "positions", "Positions"
        GAMES = "games", "Games"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="settings",
    )
    preferred_side = models.CharField(
        max_length=10,
        choices=PreferredSide.choices,
        default=PreferredSide.AUTO,
    )
    analysis_visibility = models.CharField(
        max_length=10,
        choices=AnalysisVisibility.choices,
        default=AnalysisVisibility.VISIBLE,
    )
    engine_move_speed = models.CharField(
        max_length=10,
        choices=EngineMoveSpeed.choices,
        default=EngineMoveSpeed.INSTANT,
    )
    default_library_mode = models.CharField(
        max_length=10,
        choices=LibraryMode.choices,
        default=LibraryMode.POSITIONS,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Settings for {self.user.get_username()}"


class SignupCode(models.Model):
    code = models.CharField(max_length=64, unique=True)
    label = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        if self.label:
            return f"{self.label} ({self.code})"
        return self.code
