import json
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods
from .models import Game, Position, Tag


def _position_to_dict(pos):
    return {
        'id': pos.id,
        'name': pos.name,
        'fen': pos.fen,
        'notes': pos.notes,
        'created_at': pos.created_at.isoformat(),
        'tags': sorted(pos.tags.values_list('name', flat=True)),
    }


def _game_result_label(game):
    if game.winner == 'draw':
        return 'Draw'
    if game.winner in {'white', 'black'}:
        if game.winner == game.user_color:
            return 'You won'
        return f'{game.opponent} won'
    if game.status == 'aborted':
        return 'Aborted'
    return 'Result unavailable'


def _game_winner_label(game):
    if game.winner == 'draw':
        return 'Draw'
    if game.winner == 'white':
        return 'White won'
    if game.winner == 'black':
        return 'Black won'
    return 'Winner unknown'


def _game_to_dict(game):
    return {
        'id': game.id,
        'name': game.name,
        'opponent': game.opponent,
        'fen': game.final_fen,
        'played_at': game.played_at.isoformat(),
        'user_color': game.user_color,
        'winner': game.winner,
        'winner_label': _game_winner_label(game),
        'result_label': _game_result_label(game),
        'status': game.status,
    }


def _apply_tags(position, tag_names):
    """Replace position's tag set with the given list of tag names."""
    tags = [Tag.objects.get_or_create(name=n.strip())[0] for n in tag_names if n.strip()]
    position.tags.set(tags)


PAGE_SIZE = 48


def _get_page_num(request):
    try:
        return int(request.GET.get('page', 1))
    except (ValueError, TypeError):
        return 1


@require_http_methods(['GET', 'POST'])
def positions_list(request):
    if request.method == 'GET':
        from django.core.paginator import Paginator
        qs = Position.objects.all()
        tag_filters = request.GET.getlist('tag')
        if tag_filters:
            qs = qs.filter(tags__name__in=tag_filters).distinct()
        paginator = Paginator(qs, PAGE_SIZE)
        page = paginator.get_page(_get_page_num(request))
        return JsonResponse({
            'results': [_position_to_dict(p) for p in page],
            'count': paginator.count,
            'page': page.number,
            'total_pages': paginator.num_pages,
        })

    # POST
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    name = data.get('name', '').strip()
    fen = data.get('fen', '').strip()
    if not name or not fen:
        return JsonResponse({'error': 'name and fen are required'}, status=400)

    pos = Position.objects.create(name=name, fen=fen, notes=data.get('notes', ''))
    _apply_tags(pos, data.get('tags', []))
    return JsonResponse(_position_to_dict(pos), status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def positions_detail(request, pk):
    try:
        pos = Position.objects.get(pk=pk)
    except Position.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    if request.method == 'GET':
        return JsonResponse(_position_to_dict(pos))

    if request.method == 'PATCH':
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        if 'name' in data:
            pos.name = data['name']
        if 'notes' in data:
            pos.notes = data['notes']
        pos.save()
        if 'tags' in data:
            _apply_tags(pos, data['tags'])
        return JsonResponse(_position_to_dict(pos))

    # DELETE
    pos.delete()
    return HttpResponse(status=204, content_type='application/json')


@require_http_methods(['GET'])
def games_list(request):
    from django.core.paginator import Paginator

    paginator = Paginator(Game.objects.all(), PAGE_SIZE)
    page = paginator.get_page(_get_page_num(request))
    return JsonResponse({
        'results': [_game_to_dict(g) for g in page],
        'count': paginator.count,
        'page': page.number,
        'total_pages': paginator.num_pages,
    })


@require_http_methods(['GET'])
def games_detail(request, pk):
    try:
        game = Game.objects.get(pk=pk)
    except Game.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    return JsonResponse(_game_to_dict(game))


@require_http_methods(['GET'])
def tags_list(request):
    tags = Tag.objects.all().values('id', 'name')
    return JsonResponse(list(tags), safe=False)
