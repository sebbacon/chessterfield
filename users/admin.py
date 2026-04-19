from django.contrib import admin

from .models import SignupCode, UserProfile, UserSettings


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "display_name", "created_at")
    search_fields = ("user__username", "display_name")


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "preferred_side", "analysis_visibility", "default_library_mode")
    list_filter = ("preferred_side", "analysis_visibility", "default_library_mode")
    search_fields = ("user__username",)


@admin.register(SignupCode)
class SignupCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "label", "is_active", "created_at")
    list_filter = ("is_active",)
    list_editable = ("is_active",)
    search_fields = ("code", "label")
