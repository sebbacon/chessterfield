import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from positions.models import Position, Tag


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
