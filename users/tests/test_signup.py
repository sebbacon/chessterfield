import pytest
from django.contrib.auth import get_user_model

from users.models import SignupCode


@pytest.mark.django_db
def test_signup_requires_valid_active_code(client):
    SignupCode.objects.create(code="alpha-2026", label="Trusted group", is_active=True)

    response = client.post(
        "/accounts/signup/",
        {
            "username": "newplayer",
            "email": "newplayer@example.com",
            "password1": "CorrectHorseBatteryStaple123",
            "password2": "CorrectHorseBatteryStaple123",
            "signup_code": "wrong-code",
        },
    )

    assert response.status_code == 200
    assert b"That signup code is not valid." in response.content
    assert not get_user_model().objects.filter(username="newplayer").exists()


@pytest.mark.django_db
def test_signup_accepts_trimmed_case_insensitive_active_code(client):
    SignupCode.objects.create(code="CoachGroup", label="Coach handout", is_active=True)

    response = client.post(
        "/accounts/signup/",
        {
            "username": "newplayer",
            "email": "newplayer@example.com",
            "password1": "CorrectHorseBatteryStaple123",
            "password2": "CorrectHorseBatteryStaple123",
            "signup_code": "  coachgroup  ",
        },
    )

    assert response.status_code == 302
    assert response.headers["Location"] == "/"
    assert get_user_model().objects.filter(username="newplayer").exists()


@pytest.mark.django_db
def test_signup_rejects_inactive_code(client):
    SignupCode.objects.create(code="quiet-list", label="Disabled", is_active=False)

    response = client.post(
        "/accounts/signup/",
        {
            "username": "newplayer",
            "email": "newplayer@example.com",
            "password1": "CorrectHorseBatteryStaple123",
            "password2": "CorrectHorseBatteryStaple123",
            "signup_code": "quiet-list",
        },
    )

    assert response.status_code == 200
    assert b"That signup code is not valid." in response.content
