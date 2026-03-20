from django.db import models


class Tag(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['name']


class Position(models.Model):
    name = models.CharField(max_length=100)
    fen = models.TextField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    tags = models.ManyToManyField(Tag, blank=True)
    source = models.CharField(max_length=100, null=True, blank=True, unique=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['-created_at']
