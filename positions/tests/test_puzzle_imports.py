from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from positions.models import PuzzleImportBatch, PuzzleImportPage
from positions.puzzle_imports import import_positions_from_manifest, store_uploaded_page


@pytest.mark.django_db
def test_store_uploaded_page_uses_content_digest() -> None:
    batch = PuzzleImportBatch.objects.create()
    page_one = PuzzleImportPage.objects.create(
        batch=batch,
        original_filename="page-a.jpg",
        stored_upload_path="",
    )
    page_two = PuzzleImportPage.objects.create(
        batch=batch,
        original_filename="page-b.jpg",
        stored_upload_path="",
    )

    store_uploaded_page(page_one, SimpleUploadedFile("page-a.jpg", b"same-bytes", content_type="image/jpeg"))
    store_uploaded_page(page_two, SimpleUploadedFile("page-b.jpg", b"same-bytes", content_type="image/jpeg"))

    page_one.refresh_from_db()
    page_two.refresh_from_db()
    assert page_one.source_digest == page_two.source_digest
    assert Path(page_one.stored_upload_path).exists()
    assert Path(page_two.stored_upload_path).exists()


@pytest.mark.django_db
def test_import_positions_from_manifest_uses_reviewed_metadata() -> None:
    summary = import_positions_from_manifest(
        image_label="page-1.jpg",
        page_digest="content-digest",
        manifest={
            "cells": [
                {"fen": "8/8/8/8/8/8/8/4K3 w - - 0 1", "crop_path": "crop-1.jpg"},
                {"fen": "", "fen_error": "missing"},
            ]
        },
        stage=5,
        theme_title="Discovered attack",
        set_name="B",
    )

    assert summary.created == 1
    assert summary.failed == 1

    from positions.models import Position

    position = Position.objects.get()
    assert position.name == "Discovered attack set B #01"
    assert position.source == "puzzle-page:content-digest:01"
    assert set(position.tags.values_list("name", flat=True)) == {
        "stage:5",
        "tactic:Discovered attack",
        "set:B",
    }
