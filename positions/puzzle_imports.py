import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from positions.models import Position, PuzzleImportBatch, PuzzleImportPage, Tag
from vision.cells import extract_cells, write_result
from vision.fenify import FenifyPredictor


SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}


@dataclass(frozen=True)
class ImportSummary:
    created: int = 0
    skipped: int = 0
    failed: int = 0

    def __add__(self, other: "ImportSummary") -> "ImportSummary":
        return ImportSummary(
            created=self.created + other.created,
            skipped=self.skipped + other.skipped,
            failed=self.failed + other.failed,
        )


def admin_batch_root(batch: PuzzleImportBatch) -> Path:
    return Path(settings.BASE_DIR) / "tmp" / "admin-puzzle-imports" / f"batch-{batch.pk}"


def _clean_optional_text(value: str | None) -> str:
    return (value or "").strip()


def _page_output_root(page: PuzzleImportPage) -> Path:
    root = admin_batch_root(page.batch) / "processed"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _page_upload_path(page: PuzzleImportPage, filename: str) -> Path:
    suffix = Path(filename).suffix.lower()
    stem = slugify(Path(filename).stem) or "page"
    upload_dir = admin_batch_root(page.batch) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir / f"{page.pk:03d}-{stem}{suffix}"


def store_uploaded_page(page: PuzzleImportPage, uploaded_file) -> PuzzleImportPage:
    target = _page_upload_path(page, uploaded_file.name)
    digest = hashlib.sha1()
    with target.open("wb") as handle:
        for chunk in uploaded_file.chunks():
            handle.write(chunk)
            digest.update(chunk)

    page.stored_upload_path = str(target)
    page.source_digest = digest.hexdigest()
    page.save(update_fields=["stored_upload_path", "source_digest", "updated_at"])
    return page


def path_source_digest(image_path: Path) -> str:
    return hashlib.sha1(str(image_path.resolve()).encode("utf-8")).hexdigest()[:12]


def position_source(page_digest: str, index: int) -> str:
    return f"puzzle-page:{page_digest}:{index:02d}"


def position_name(
    image_label: str,
    index: int,
    theme_title: str | None,
    set_name: str | None,
) -> str:
    parts = []
    cleaned_theme = _clean_optional_text(theme_title)
    cleaned_set = _clean_optional_text(set_name)
    if cleaned_theme:
        parts.append(cleaned_theme)
    if cleaned_set:
        parts.append(f"set {cleaned_set}")
    if not parts:
        parts.append(Path(image_label).stem)
    parts.append(f"#{index:02d}")
    return " ".join(parts)


def position_notes(
    image_label: str,
    index: int,
    cell: dict,
    theme_title: str | None,
    set_name: str | None,
    stage: int,
) -> str:
    lines = [
        f"Imported from {image_label}",
        f"Stage: {stage}",
        f"Cell: {index:02d}",
    ]
    cleaned_theme = _clean_optional_text(theme_title)
    cleaned_set = _clean_optional_text(set_name)
    if cleaned_theme:
        lines.append(f"Tactic: {cleaned_theme}")
    if cleaned_set:
        lines.append(f"Set: {cleaned_set}")
    crop_path = cell.get("crop_path")
    if crop_path:
        lines.append(f"Crop: {crop_path}")
    return "\n".join(lines)


def position_tag_names(stage: int, theme_title: str | None, set_name: str | None) -> list[str]:
    tag_names = [f"stage:{stage}"]
    cleaned_theme = _clean_optional_text(theme_title)
    cleaned_set = _clean_optional_text(set_name)
    if cleaned_theme:
        tag_names.append(f"tactic:{cleaned_theme}")
    if cleaned_set:
        tag_names.append(f"set:{cleaned_set}")
    return tag_names


def import_positions_from_manifest(
    *,
    image_label: str,
    page_digest: str,
    manifest: dict,
    stage: int,
    theme_title: str | None,
    set_name: str | None,
) -> ImportSummary:
    tags = [Tag.objects.get_or_create(name=name)[0] for name in position_tag_names(stage, theme_title, set_name)]

    created = skipped = failed = 0
    for index, cell in enumerate(manifest.get("cells", []), start=1):
        fen = (cell.get("fen") or "").strip()
        if not fen:
            failed += 1
            continue

        source = position_source(page_digest, index)
        if Position.objects.filter(source=source).exists():
            skipped += 1
            continue

        position = Position.objects.create(
            name=position_name(image_label, index, theme_title, set_name),
            fen=fen,
            notes=position_notes(image_label, index, cell, theme_title, set_name, stage),
            source=source,
        )
        position.tags.add(*tags)
        created += 1

    return ImportSummary(created=created, skipped=skipped, failed=failed)


def process_puzzle_import_page(
    page: PuzzleImportPage,
    *,
    fenify_predictor=None,
) -> PuzzleImportPage:
    stored_path = Path(page.stored_upload_path)
    page_image, result = extract_cells(stored_path)
    page_dir = write_result(
        page_image,
        result,
        _page_output_root(page),
        fenify_predictor=fenify_predictor,
    )
    manifest = json.loads((page_dir / "manifest.json").read_text())

    page.manifest = manifest
    page.normalized_image_path = str(page_dir / "normalized.jpg")
    page.overlay_image_path = str(page_dir / "overlay.jpg")
    page.ocr_engine = manifest.get("ocr_engine") or ""
    page.ocr_theme_title = _clean_optional_text(manifest.get("title_en"))
    page.ocr_set_name = _clean_optional_text(manifest.get("set_name"))
    page.theme_title = page.theme_title or page.ocr_theme_title
    page.set_name = page.set_name or page.ocr_set_name
    page.processing_error = ""
    page.save(
        update_fields=[
            "manifest",
            "normalized_image_path",
            "overlay_image_path",
            "ocr_engine",
            "ocr_theme_title",
            "ocr_set_name",
            "theme_title",
            "set_name",
            "processing_error",
            "updated_at",
        ]
    )
    return page


def process_puzzle_import_batch(
    batch: PuzzleImportBatch,
    *,
    fenify_model: str | None = None,
    fenify_repo: str | None = None,
) -> PuzzleImportBatch:
    if batch.status in {PuzzleImportBatch.STATUS_READY, PuzzleImportBatch.STATUS_IMPORTED}:
        return batch

    batch.status = PuzzleImportBatch.STATUS_PROCESSING
    batch.error_message = ""
    batch.save(update_fields=["status", "error_message"])

    try:
        predictor = FenifyPredictor(
            model_path=fenify_model or os.environ.get("FENIFY_MODEL_PATH"),
            repo_dir=fenify_repo or os.environ.get("FENIFY_REPO_DIR"),
        )
    except Exception as exc:
        message = str(exc)
        batch.pages.update(processing_error=message, updated_at=timezone.now())
        batch.status = PuzzleImportBatch.STATUS_FAILED
        batch.error_message = message
        batch.processed_at = timezone.now()
        batch.save(update_fields=["status", "error_message", "processed_at"])
        return batch

    any_success = False
    for page in batch.pages.order_by("id"):
        try:
            process_puzzle_import_page(page, fenify_predictor=predictor)
        except Exception as exc:
            page.processing_error = str(exc)
            page.manifest = {}
            page.normalized_image_path = ""
            page.overlay_image_path = ""
            page.save(
                update_fields=[
                    "processing_error",
                    "manifest",
                    "normalized_image_path",
                    "overlay_image_path",
                    "updated_at",
                ]
            )
        else:
            any_success = True

    batch.status = PuzzleImportBatch.STATUS_READY if any_success else PuzzleImportBatch.STATUS_FAILED
    batch.processed_at = timezone.now()
    batch.save(update_fields=["status", "processed_at"])
    return batch


def import_reviewed_batch(batch: PuzzleImportBatch) -> ImportSummary:
    summary = ImportSummary()

    with transaction.atomic():
        for page in batch.pages.order_by("id"):
            if page.processing_error or not page.manifest:
                continue

            if page.stage is None:
                raise ValueError(f"Stage is required for {page.original_filename}.")

            page_summary = import_positions_from_manifest(
                image_label=page.original_filename,
                page_digest=page.source_digest,
                manifest=page.manifest,
                stage=page.stage,
                theme_title=page.theme_title,
                set_name=page.set_name,
            )
            page.created_count = page_summary.created
            page.skipped_count = page_summary.skipped
            page.failed_count = page_summary.failed
            page.save(update_fields=["created_count", "skipped_count", "failed_count", "updated_at"])
            summary += page_summary

        batch.status = PuzzleImportBatch.STATUS_IMPORTED
        batch.imported_at = timezone.now()
        batch.save(update_fields=["status", "imported_at"])

    return summary
