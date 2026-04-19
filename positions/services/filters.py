from dataclasses import dataclass

from django.db.models import Exists, OuterRef, Q

from progress.models import UserPositionState


@dataclass(frozen=True)
class PositionFilters:
    tags: tuple[str, ...] = ()
    progress: str = "all"
    source_kind: str = "all"
    sort: str = "oldest"


def parse_position_filters(request) -> PositionFilters:
    from .common import clean_tag_filters

    progress = normalize_progress_filter(request.GET.get("progress"))
    viewed = request.GET.get("viewed")
    if progress == "all" and viewed in {"viewed", "unviewed"}:
        progress = viewed

    return PositionFilters(
        tags=tuple(clean_tag_filters(request)),
        progress=progress,
        source_kind=normalize_source_kind(request.GET.get("source_kind")),
        sort=normalize_sort(request.GET.get("sort")),
    )


def normalize_progress_filter(value: str | None) -> str:
    allowed = {"all", "viewed", "unviewed", "in_progress", "completed", "mastered"}
    return value if value in allowed else "all"


def normalize_source_kind(value: str | None) -> str:
    allowed = {"all", "manual", "lichess", "ocr", "other"}
    return value if value in allowed else "all"


def normalize_sort(value: str | None) -> str:
    return "newest" if value == "newest" else "oldest"


def apply_position_filters(queryset, filters: PositionFilters, user):
    for tag in filters.tags:
        queryset = queryset.filter(tags__name=tag)
    queryset = queryset.distinct()

    if filters.source_kind == "manual":
        queryset = queryset.filter(Q(source__isnull=True) | Q(source=""))
    elif filters.source_kind == "lichess":
        queryset = queryset.filter(source__startswith="lichess:")
    elif filters.source_kind == "ocr":
        queryset = queryset.filter(source__startswith="puzzle-page:")
    elif filters.source_kind == "other":
        queryset = queryset.exclude(source__startswith="lichess:").exclude(source__startswith="puzzle-page:").exclude(
            Q(source__isnull=True) | Q(source="")
        )

    if filters.progress != "all":
        queryset = apply_progress_filter(queryset, filters.progress, user)

    ordering = ("-created_at", "-id") if filters.sort == "newest" else ("created_at", "id")
    return queryset.order_by(*ordering)


def apply_progress_filter(queryset, progress: str, user):
    if not user.is_authenticated:
        if progress == "unviewed":
            return queryset
        return queryset.none()

    state_qs = UserPositionState.objects.filter(user=user, position=OuterRef("pk"))
    if progress == "viewed":
        return queryset.annotate(has_state=Exists(state_qs.filter(viewed_at__isnull=False))).filter(has_state=True)
    if progress == "unviewed":
        return queryset.annotate(has_state=Exists(state_qs.filter(viewed_at__isnull=False))).filter(has_state=False)
    return queryset.filter(user_states__user=user, user_states__status=progress)

