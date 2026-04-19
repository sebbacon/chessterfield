import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.core.files.uploadedfile import SimpleUploadedFile

from positions.models import Position, PuzzleImportBatch, Tag


@pytest.fixture
def admin_client(db):
    user = get_user_model().objects.create_superuser(
        username="admin",
        email="admin@example.com",
        password="password123",
    )
    client = Client()
    client.force_login(user)
    return client


@pytest.mark.django_db
def test_admin_index_is_available(admin_client):
    response = admin_client.get("/admin/")
    assert response.status_code == 200
    assert b"Positions" in response.content


@pytest.mark.django_db
def test_position_admin_changelist_shows_import_review_fields(admin_client):
    tactic = Tag.objects.create(name="tactic:fork")
    position = Position.objects.create(
        name="Fork set A #01",
        fen="8/8/8/8/8/8/8/4K3 w - - 0 1",
        notes="Imported from page-1.jpg",
        source="puzzle-page:abc123def456:01",
    )
    position.tags.add(tactic)

    response = admin_client.get("/admin/positions/position/")

    assert response.status_code == 200
    assert b"OCR imports" in response.content
    assert b"Import Puzzle Pages" in response.content
    assert b"puzzle-page:abc123def456:01" in response.content
    assert b"tactic:fork" in response.content


@pytest.mark.django_db
def test_position_admin_save_rewrites_tags(admin_client):
    opening = Tag.objects.create(name="opening")
    position = Position.objects.create(
        name="Needs cleanup",
        fen="8/8/8/8/8/8/8/4K3 w - - 0 1",
        notes="Imported from page-1.jpg",
        source="puzzle-page:abc123def456:02",
    )
    position.tags.add(opening)

    response = admin_client.post(
        f"/admin/positions/position/{position.id}/change/",
        {
            "name": "Cleaned title",
            "tag_names": "stage:3, tactic:fork, set:A",
            "fen": position.fen,
            "notes": position.notes,
            "source": position.source,
            "_save": "Save",
        },
        follow=True,
    )

    assert response.status_code == 200
    position.refresh_from_db()
    assert position.name == "Cleaned title"
    assert set(position.tags.values_list("name", flat=True)) == {
        "stage:3",
        "tactic:fork",
        "set:A",
    }


@pytest.mark.django_db
def test_puzzle_import_upload_rejects_more_than_five_images(admin_client):
    files = [
        SimpleUploadedFile(f"page-{idx}.jpg", b"fake-image", content_type="image/jpeg")
        for idx in range(6)
    ]

    response = admin_client.post("/admin/positions/puzzle-import/", {"images": files})

    assert response.status_code == 200
    assert b"Upload at most 5 images at a time." in response.content
    assert PuzzleImportBatch.objects.count() == 0


@pytest.mark.django_db
def test_puzzle_import_admin_flow_creates_positions(admin_client, monkeypatch):
    def fake_process(batch):
        page = batch.pages.get()
        page.manifest = {
            "ocr_engine": "tesseract",
            "title_en": "Fork",
            "set_name": "A",
            "cells": [
                {"fen": "8/8/8/8/8/8/8/4K3 w - - 0 1", "crop_path": "crop-1.jpg"},
                {"fen": "", "fen_error": "no pieces", "crop_path": "crop-2.jpg"},
            ],
        }
        page.ocr_engine = "tesseract"
        page.ocr_theme_title = "Fork"
        page.ocr_set_name = "A"
        page.theme_title = "Fork"
        page.set_name = "A"
        page.normalized_image_path = __file__
        page.overlay_image_path = __file__
        page.processing_error = ""
        page.save()
        batch.status = PuzzleImportBatch.STATUS_READY
        batch.save(update_fields=["status"])
        return batch

    monkeypatch.setattr("positions.admin_views.process_puzzle_import_batch", fake_process)

    upload = SimpleUploadedFile("page-1.jpg", b"fake-image", content_type="image/jpeg")
    response = admin_client.post("/admin/positions/puzzle-import/", {"images": [upload]})

    assert response.status_code == 302
    batch = PuzzleImportBatch.objects.get()

    process_response = admin_client.post(f"/admin/positions/puzzle-import/{batch.id}/processing/start/")
    assert process_response.status_code == 200

    review_response = admin_client.get(f"/admin/positions/puzzle-import/{batch.id}/review/")
    assert review_response.status_code == 200
    assert b"Fork" in review_response.content

    page = batch.pages.get()
    import_response = admin_client.post(
        f"/admin/positions/puzzle-import/{batch.id}/review/",
        {
            "form-TOTAL_FORMS": "1",
            "form-INITIAL_FORMS": "1",
            "form-MIN_NUM_FORMS": "0",
            "form-MAX_NUM_FORMS": "1000",
            "form-0-id": str(page.id),
            "form-0-stage": "3",
            "form-0-theme_title": "Pin",
            "form-0-set_name": "C",
            "_import": "Import positions",
        },
        follow=True,
    )

    assert import_response.status_code == 200
    batch.refresh_from_db()
    assert batch.status == PuzzleImportBatch.STATUS_IMPORTED

    position = Position.objects.get()
    assert position.name == "Pin set C #01"
    assert set(position.tags.values_list("name", flat=True)) == {
        "stage:3",
        "tactic:Pin",
        "set:C",
    }
