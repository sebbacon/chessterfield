import json

from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods

from practice.modes import PRACTICE_MODES

from .forms import SignupForm
from .models import UserProfile, UserSettings


def signup_view(request):
    if request.method == "POST":
        form = SignupForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect("index")
    else:
        form = SignupForm()
    return render(request, "registration/signup.html", {"form": form})


def _settings_to_dict(settings: UserSettings) -> dict:
    return {
        "preferred_side": settings.preferred_side,
        "analysis_visibility": settings.analysis_visibility,
        "default_library_mode": settings.default_library_mode,
    }


def _ensure_user_records(user) -> tuple[UserProfile, UserSettings]:
    profile, _ = UserProfile.objects.get_or_create(user=user)
    settings, _ = UserSettings.objects.get_or_create(user=user)
    return profile, settings


def _user_to_dict(user) -> dict:
    profile, settings = _ensure_user_records(user)
    return {
        "id": user.id,
        "username": user.get_username(),
        "display_name": profile.effective_display_name,
        "settings": _settings_to_dict(settings),
    }


@require_http_methods(["GET"])
def me_detail(request):
    payload = {
        "authenticated": request.user.is_authenticated,
        "user": None,
        "practice_modes": list(PRACTICE_MODES.values()),
    }
    if request.user.is_authenticated:
        payload["user"] = _user_to_dict(request.user)
    return JsonResponse(payload)


@login_required
@require_http_methods(["PATCH"])
def me_settings(request):
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    _profile, settings = _ensure_user_records(request.user)
    allowed_fields = {
        "preferred_side": {choice for choice, _label in UserSettings.PreferredSide.choices},
        "analysis_visibility": {choice for choice, _label in UserSettings.AnalysisVisibility.choices},
        "default_library_mode": {choice for choice, _label in UserSettings.LibraryMode.choices},
    }

    updated_fields = []
    for field, choices in allowed_fields.items():
        if field not in data:
            continue
        value = data[field]
        if value not in choices:
            return JsonResponse({"error": f"Invalid value for {field}"}, status=400)
        setattr(settings, field, value)
        updated_fields.append(field)

    if updated_fields:
        settings.save(update_fields=updated_fields + ["updated_at"])

    return JsonResponse({"settings": _settings_to_dict(settings)})
