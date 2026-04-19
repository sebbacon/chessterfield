from django.core.paginator import Paginator

from positions.api.serializers import game_to_dict
from positions.models import Game


PAGE_SIZE = 48


def get_page_num(request):
    try:
        return int(request.GET.get("page", 1))
    except (ValueError, TypeError):
        return 1


def list_games(*, request):
    paginator = Paginator(Game.objects.all(), PAGE_SIZE)
    page = paginator.get_page(get_page_num(request))
    return {
        "results": [game_to_dict(game) for game in page],
        "count": paginator.count,
        "page": page.number,
        "total_pages": paginator.num_pages,
    }
