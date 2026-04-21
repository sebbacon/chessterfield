import chess
from django.core.paginator import Paginator

from positions.api.serializers import position_to_dict
from positions.models import Position
from progress.models import UserPositionState

from .filters import PositionFilters, apply_position_filters


PAGE_SIZE = 48


def get_page_num(request):
    try:
        return int(request.GET.get("page", 1))
    except (ValueError, TypeError):
        return 1


def has_valid_fen(fen):
    try:
        board = chess.Board(fen)
    except ValueError:
        return False
    return board.is_valid()


def mark_possible_bug(position: Position) -> None:
    if position.possible_bug:
        return
    position.possible_bug = True
    position.save(update_fields=["possible_bug"])


def position_state_map(user, positions):
    if not user.is_authenticated or not positions:
        return {}
    return {
        state.position_id: state
        for state in UserPositionState.objects.filter(user=user, position__in=positions)
    }


def list_positions(*, request, filters: PositionFilters):
    queryset = apply_position_filters(Position.objects.all().prefetch_related("tags"), filters, request.user)
    if filters.sort == "workout":
        return list_workout_positions(request=request, queryset=queryset, filters=filters)
    paginator = Paginator(queryset, PAGE_SIZE)
    page = paginator.get_page(get_page_num(request))
    positions = list(page.object_list)
    state_map = position_state_map(request.user, positions)
    return {
        "results": [position_to_dict(pos, user_state=state_map.get(pos.id)) for pos in positions],
        "count": paginator.count,
        "page": page.number,
        "total_pages": paginator.num_pages,
        "filters": {
            "tags": list(filters.tags),
            "tactic": filters.tactic,
            "progress": filters.progress,
            "source_kind": filters.source_kind,
            "sort": filters.sort,
        },
    }


def list_workout_positions(*, request, queryset, filters: PositionFilters):
    ordered_positions = []
    for position in queryset:
        if has_valid_fen(position.fen):
            ordered_positions.append(position)
            continue
        mark_possible_bug(position)
    paginator = Paginator(ordered_positions, PAGE_SIZE)
    page = paginator.get_page(get_page_num(request))
    positions = list(page.object_list)
    state_map = position_state_map(request.user, positions)
    return {
        "results": [position_to_dict(pos, user_state=state_map.get(pos.id)) for pos in positions],
        "count": paginator.count,
        "page": page.number,
        "total_pages": paginator.num_pages,
        "filters": {
            "tags": list(filters.tags),
            "tactic": filters.tactic,
            "progress": filters.progress,
            "source_kind": filters.source_kind,
            "sort": filters.sort,
        },
    }


def get_position_detail(*, request, position: Position, filters: PositionFilters):
    if not has_valid_fen(position.fen):
        mark_possible_bug(position)
    state = position_state_map(request.user, [position]).get(position.id)
    payload = position_to_dict(position, user_state=state)
    next_position = next_position_in_filters(position=position, filters=filters, user=request.user)
    payload["next_position_id"] = next_position.id if next_position else None
    return payload


def next_position_in_filters(*, position: Position, filters: PositionFilters, user):
    queryset = apply_position_filters(Position.objects.all(), filters, user)
    ordered = list(queryset.values_list("id", "fen", "possible_bug"))
    found_current = False
    for candidate_id, candidate_fen, candidate_possible_bug in ordered:
        if found_current:
            if has_valid_fen(candidate_fen):
                return Position.objects.get(pk=candidate_id)
            if not candidate_possible_bug:
                Position.objects.filter(pk=candidate_id, possible_bug=False).update(possible_bug=True)
            continue
        if candidate_id == position.id:
            found_current = True
    return None
