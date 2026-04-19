from datetime import timedelta

from django import forms
from django.contrib import admin
from django.db.models import Count, Prefetch, Q
from django.utils import timezone

from .models import Game, Position, Tag


def _source_kind_from_value(source: str | None) -> str:
    if not source:
        return "manual"
    if source.startswith("puzzle-page:"):
        return "ocr"
    if source.startswith("lichess:"):
        return "lichess"
    return "other"


class PositionAdminForm(forms.ModelForm):
    tag_names = forms.CharField(
        required=False,
        label="Tags",
        help_text="Comma-separated tag names. Existing tags will be reused and missing ones will be created.",
        widget=forms.TextInput(attrs={"style": "width: 32rem;"}),
    )

    class Meta:
        model = Position
        fields = ["name", "tag_names", "fen", "notes", "source"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["tag_names"].initial = ", ".join(
                self.instance.tags.order_by("name").values_list("name", flat=True)
            )

    def clean_tag_names(self):
        seen = set()
        cleaned = []
        for raw_name in self.cleaned_data["tag_names"].split(","):
            name = raw_name.strip()
            if name and name not in seen:
                cleaned.append(name)
                seen.add(name)
        return cleaned


class SourceKindFilter(admin.SimpleListFilter):
    title = "import source"
    parameter_name = "source_kind"

    def lookups(self, request, model_admin):
        return [
            ("ocr", "OCR imports"),
            ("lichess", "Lichess imports"),
            ("manual", "Manual positions"),
            ("other", "Other sources"),
        ]

    def queryset(self, request, queryset):
        value = self.value()
        if value == "ocr":
            return queryset.filter(source__startswith="puzzle-page:")
        if value == "lichess":
            return queryset.filter(source__startswith="lichess:")
        if value == "manual":
            return queryset.filter(Q(source__isnull=True) | Q(source=""))
        if value == "other":
            return queryset.exclude(source__startswith="puzzle-page:").exclude(
                source__startswith="lichess:"
            ).exclude(Q(source__isnull=True) | Q(source=""))
        return queryset


class RecentImportFilter(admin.SimpleListFilter):
    title = "created"
    parameter_name = "created_window"

    def lookups(self, request, model_admin):
        return [
            ("1d", "Past 24 hours"),
            ("7d", "Past 7 days"),
            ("30d", "Past 30 days"),
        ]

    def queryset(self, request, queryset):
        windows = {
            "1d": timedelta(days=1),
            "7d": timedelta(days=7),
            "30d": timedelta(days=30),
        }
        window = windows.get(self.value())
        if not window:
            return queryset
        return queryset.filter(created_at__gte=timezone.now() - window)


@admin.register(Position)
class PositionAdmin(admin.ModelAdmin):
    form = PositionAdminForm
    change_list_template = "admin/positions/position/change_list.html"
    fields = ("name", "tag_names", "fen", "notes", "source", "created_at")
    list_display = ("created_at", "name", "source_kind", "tag_list", "source")
    list_display_links = ("created_at",)
    list_editable = ("name",)
    list_filter = (SourceKindFilter, RecentImportFilter, ("tags", admin.RelatedOnlyFieldListFilter))
    search_fields = ("name", "notes", "source", "tags__name")
    ordering = ("-created_at", "-id")
    readonly_fields = ("created_at",)
    date_hierarchy = "created_at"
    list_per_page = 100

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .prefetch_related(Prefetch("tags", queryset=Tag.objects.order_by("name")))
        )

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        tags = [Tag.objects.get_or_create(name=name)[0] for name in form.cleaned_data["tag_names"]]
        form.instance.tags.set(tags)

    @admin.display(description="Source")
    def source_kind(self, obj):
        return _source_kind_from_value(obj.source).upper()

    @admin.display(description="Tags")
    def tag_list(self, obj):
        return ", ".join(tag.name for tag in obj.tags.all()) or "-"


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "position_count")
    search_fields = ("name",)
    ordering = ("name",)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(position_total=Count("position"))

    @admin.display(ordering="position_total", description="Positions")
    def position_count(self, obj):
        return obj.position_total


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ("played_at", "name", "opponent", "user_color", "winner", "status")
    list_filter = ("user_color", "winner", "status")
    search_fields = ("name", "opponent", "source")
    ordering = ("-played_at", "-id")
