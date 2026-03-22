from django.db import models


class Tag(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['name']


class Game(models.Model):
    name = models.CharField(max_length=100)
    opponent = models.CharField(max_length=100)
    played_at = models.DateTimeField()
    final_fen = models.TextField()
    user_color = models.CharField(max_length=5)
    winner = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=30, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Format: lichess:<game_id> — used for deduplication on re-import
    source = models.CharField(max_length=200, unique=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['-played_at', '-id']


class Position(models.Model):
    name = models.CharField(max_length=100)
    fen = models.TextField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    tags = models.ManyToManyField(Tag, blank=True)
    # Format: lichess:<game_id>:<ply> — used for deduplication on re-import
    source = models.CharField(max_length=200, null=True, blank=True, unique=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['created_at', 'id']
