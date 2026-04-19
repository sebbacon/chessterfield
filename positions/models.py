from django.conf import settings
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


class PuzzleImportBatch(models.Model):
    STATUS_UPLOADED = "uploaded"
    STATUS_PROCESSING = "processing"
    STATUS_READY = "ready"
    STATUS_FAILED = "failed"
    STATUS_IMPORTED = "imported"

    STATUS_CHOICES = [
        (STATUS_UPLOADED, "Uploaded"),
        (STATUS_PROCESSING, "Processing"),
        (STATUS_READY, "Ready for review"),
        (STATUS_FAILED, "Processing failed"),
        (STATUS_IMPORTED, "Imported"),
    ]

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="puzzle_import_batches",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_UPLOADED)
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    imported_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    def __str__(self):
        return f"Puzzle import batch {self.pk}"

    class Meta:
        ordering = ["-created_at", "-id"]


class PuzzleImportPage(models.Model):
    batch = models.ForeignKey(PuzzleImportBatch, on_delete=models.CASCADE, related_name="pages")
    original_filename = models.CharField(max_length=255)
    stored_upload_path = models.TextField()
    source_digest = models.CharField(max_length=40, blank=True)
    normalized_image_path = models.TextField(blank=True)
    overlay_image_path = models.TextField(blank=True)
    manifest = models.JSONField(default=dict, blank=True)
    ocr_engine = models.CharField(max_length=50, blank=True)
    ocr_theme_title = models.CharField(max_length=200, blank=True)
    ocr_set_name = models.CharField(max_length=20, blank=True)
    stage = models.PositiveIntegerField(null=True, blank=True)
    theme_title = models.CharField(max_length=200, blank=True)
    set_name = models.CharField(max_length=20, blank=True)
    processing_error = models.TextField(blank=True)
    created_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.original_filename

    @property
    def cell_count(self) -> int:
        return len((self.manifest or {}).get("cells", []))

    @property
    def valid_fen_count(self) -> int:
        return sum(1 for cell in (self.manifest or {}).get("cells", []) if (cell.get("fen") or "").strip())

    @property
    def failed_fen_count(self) -> int:
        return self.cell_count - self.valid_fen_count

    class Meta:
        ordering = ["id"]
