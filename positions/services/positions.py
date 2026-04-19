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


def position_state_map(user, positions):
    if not user.is_authenticated or not positions:
        return {}
    return {
        state.position_id: state
        for state in UserPositionState.objects.filter(user=user, position__in=positions)
    }


def list_positions(*, request, filters: PositionFilters):
    queryset = apply_position_filters(Position.objects.all().prefetch_related("tags"), filters, request.user)
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
            "progress": filters.progress,
            "source_kind": filters.source_kind,
            "sort": filters.sort,
        },
    }


def get_position_detail(*, request, position: Position, filters: PositionFilters):
    state = position_state_map(request.user, [position]).get(position.id)
    payload = position_to_dict(position, user_state=state)
    next_position = next_position_in_filters(position=position, filters=filters, user=request.user)
    payload["next_position_id"] = next_position.id if next_position else None
    return payload


def next_position_in_filters(*, position: Position, filters: PositionFilters, user):
    queryset = apply_position_filters(Position.objects.all(), filters, user)
    ordered = list(queryset.values_list("id", "fen"))
    found_current = False
    for candidate_id, candidate_fen in ordered:
        if found_current:
            if has_valid_fen(candidate_fen):
                return Position.objects.get(pk=candidate_id)
            continue
        if candidate_id == position.id:
            found_current = True
    return None

