import json

import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from users.models import UserProfile, UserSettings


@pytest.fixture
def client():
    return Client()


@pytest.mark.django_db
def test_me_detail_backfills_missing_user_records(client):
    user = get_user_model().objects.create_user(
        username="legacy-player",
        email="legacy@example.com",
        password="password123",
    )
    UserProfile.objects.filter(user=user).delete()
    UserSettings.objects.filter(user=user).delete()
    client.force_login(user)

    response = client.get("/api/me/")

    assert response.status_code == 200
    payload = json.loads(response.content)
    assert payload["authenticated"] is True
    assert payload["user"]["username"] == "legacy-player"
    assert UserProfile.objects.filter(user=user).exists()
    assert UserSettings.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_me_settings_backfills_missing_settings(client):
    user = get_user_model().objects.create_user(
        username="legacy-settings",
        email="legacy-settings@example.com",
        password="password123",
    )
    UserSettings.objects.filter(user=user).delete()
    client.force_login(user)

    response = client.patch(
        "/api/me/settings/",
        json.dumps({"preferred_side": "black"}),
        content_type="application/json",
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.settings.preferred_side == "black"
