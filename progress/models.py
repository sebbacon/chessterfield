from django.conf import settings
from django.db import models

from positions.models import Position


class UserPositionState(models.Model):
    class Status(models.TextChoices):
        NEW = "new", "New"
        IN_PROGRESS = "in_progress", "In progress"
        COMPLETED = "completed", "Completed"
        MASTERED = "mastered", "Mastered"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="position_states",
    )
    position = models.ForeignKey(
        Position,
        on_delete=models.CASCADE,
        related_name="user_states",
    )
    viewed_at = models.DateTimeField(null=True, blank=True)
    last_played_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    mastery_score = models.IntegerField(default=0)
    best_score = models.IntegerField(default=0)
    last_score = models.IntegerField(default=0)
    recent_accuracy_score = models.IntegerField(default=0)
    current_perfect_streak = models.PositiveIntegerField(default=0)
    perfect_record = models.BooleanField(default=False)
    needs_homework = models.BooleanField(default=True)
    best_matched_prefix_plies = models.PositiveSmallIntegerField(default=0)
    last_matched_prefix_plies = models.PositiveSmallIntegerField(default=0)
    solved_count = models.PositiveIntegerField(default=0)
    attempt_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "position")
        ordering = ["position_id"]

    def __str__(self):
        return f"{self.user.get_username()} / {self.position_id}"


class PracticeAttempt(models.Model):
    class Result(models.TextChoices):
        ACTIVE = "active", "Active"
        WON = "won", "Won"
        LOST = "lost", "Lost"
        DRAW = "draw", "Draw"
        COMPLETED = "completed", "Completed"
        ABANDONED = "abandoned", "Abandoned"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="practice_attempts",
    )
    position = models.ForeignKey(
        Position,
        on_delete=models.CASCADE,
        related_name="practice_attempts",
    )
    mode = models.CharField(max_length=30)
    result = models.CharField(max_length=20, choices=Result.choices, default=Result.ACTIVE)
    score_delta = models.IntegerField(default=0)
    target_depth_plies = models.PositiveSmallIntegerField(default=4)
    matched_prefix_plies = models.PositiveSmallIntegerField(default=0)
    completion_reason = models.CharField(max_length=30, blank=True)
    completed_normally = models.BooleanField(default=False)
    expected_line = models.JSONField(default=list, blank=True)
    played_line = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at", "-id"]

    def __str__(self):
        return f"{self.user.get_username()} {self.mode} {self.position_id}"
