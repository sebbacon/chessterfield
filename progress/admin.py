from django.contrib import admin

from .models import PracticeAttempt, UserPositionState


@admin.register(UserPositionState)
class UserPositionStateAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "position",
        "status",
        "mastery_score",
        "best_score",
        "attempt_count",
        "viewed_at",
    )
    list_filter = ("status",)
    search_fields = ("user__username", "position__name", "position__source")


@admin.register(PracticeAttempt)
class PracticeAttemptAdmin(admin.ModelAdmin):
    list_display = ("user", "position", "mode", "result", "score_delta", "started_at", "finished_at")
    list_filter = ("mode", "result")
    search_fields = ("user__username", "position__name", "position__source")

