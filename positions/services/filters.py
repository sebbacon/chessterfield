from dataclasses import dataclass

from django.db.models import Case, Exists, F, IntegerField, OuterRef, Q, Subquery, Value, When

from progress.models import UserPositionState


@dataclass(frozen=True)
class PositionFilters:
    tags: tuple[str, ...] = ()
    tactic: str | None = None
    progress: str = "all"
    source_kind: str = "all"
    sort: str = "oldest"


def parse_position_filters(request) -> PositionFilters:
    from .common import clean_tag_filters

    progress = normalize_progress_filter(request.GET.get("progress") or request.GET.get("viewed"))

    return PositionFilters(
        tags=tuple(clean_tag_filters(request)),
        tactic=normalize_tactic_filter(request.GET.get("tactic")),
        progress=progress,
        source_kind=normalize_source_kind(request.GET.get("source_kind")),
        sort=normalize_sort(request.GET.get("sort")),
    )


def normalize_progress_filter(value: str | None) -> str:
    aliases = {
        "unviewed": "not_started",
        "completed": "revision",
        "homework": "revision",
        "perfect": "mastered",
    }
    normalized = aliases.get(value, value)
    allowed = {"all", "viewed", "started", "not_started", "in_progress", "revision", "mastered"}
    return normalized if normalized in allowed else "all"


def normalize_source_kind(value: str | None) -> str:
    allowed = {"all", "manual", "lichess", "ocr", "other"}
    return value if value in allowed else "all"


def normalize_tactic_filter(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def normalize_sort(value: str | None) -> str:
    return value if value in {"oldest", "newest", "workout"} else "oldest"


def apply_position_filters(queryset, filters: PositionFilters, user):
    for tag in filters.tags:
        queryset = queryset.filter(tags__name=tag)
    queryset = queryset.distinct()

    if filters.tactic == "all":
        queryset = queryset.filter(tags__name__startswith="tactic:")
    elif filters.tactic:
        queryset = queryset.filter(tags__name=filters.tactic)
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

    if filters.sort == "workout":
        return apply_workout_order(queryset, user)

    ordering = ("-created_at", "-id") if filters.sort == "newest" else ("created_at", "id")
    return queryset.order_by(*ordering)


def apply_progress_filter(queryset, progress: str, user):
    if not user.is_authenticated:
        if progress == "not_started":
            return queryset
        return queryset.none()

    state_qs = UserPositionState.objects.filter(user=user, position=OuterRef("pk"))
    started_qs = state_qs.filter(last_played_at__isnull=False)
    if progress in {"viewed", "started"}:
        return queryset.annotate(has_started=Exists(started_qs)).filter(has_started=True)
    if progress == "not_started":
        return queryset.annotate(has_started=Exists(started_qs)).filter(has_started=False)
    if progress == "in_progress":
        return queryset.filter(user_states__user=user, user_states__last_played_at__isnull=False, user_states__solved_count=0)
    if progress == "revision":
        return queryset.filter(user_states__user=user, user_states__solved_count__gt=0, user_states__mastery_score__lt=85)
    return queryset.filter(user_states__user=user, user_states__mastery_score__gte=85)


def apply_workout_order(queryset, user):
    if not user.is_authenticated:
        return queryset.order_by("created_at", "id")

    state_qs = UserPositionState.objects.filter(user=user, position=OuterRef("pk"))
    queryset = queryset.annotate(
        workout_status=Subquery(state_qs.values("status")[:1]),
        workout_last_played_at=Subquery(state_qs.values("last_played_at")[:1]),
    ).annotate(
        workout_rank=Case(
            When(Q(workout_status__isnull=True) | Q(workout_status=UserPositionState.Status.NEW), then=Value(0)),
            When(workout_status=UserPositionState.Status.IN_PROGRESS, then=Value(1)),
            When(workout_status=UserPositionState.Status.REVISION, then=Value(2)),
            default=Value(99),
            output_field=IntegerField(),
        ),
    ).filter(workout_rank__lt=99)

    return queryset.order_by(
        "workout_rank",
        F("workout_last_played_at").asc(nulls_first=True),
        "created_at",
        "id",
    )
