import json
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from .lichess import build_game_history
from .models import Game, Position, Tag
from positions.api.serializers import game_to_dict
from positions.services.common import apply_tags
from positions.services.filters import parse_position_filters
from positions.services.games import list_games
from positions.services.positions import get_position_detail, list_positions


@require_http_methods(['GET', 'POST'])
def positions_list(request):
    if request.method == 'GET':
        filters = parse_position_filters(request)
        return JsonResponse(list_positions(request=request, filters=filters))

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
    apply_tags(pos, data.get('tags', []))
    filters = parse_position_filters(request)
    return JsonResponse(get_position_detail(request=request, position=pos, filters=filters), status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def positions_detail(request, pk):
    try:
        pos = Position.objects.get(pk=pk)
    except Position.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    if request.method == 'GET':
        return JsonResponse(get_position_detail(request=request, position=pos, filters=parse_position_filters(request)))

    if request.method == 'PATCH':
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        update_fields = []
        if 'name' in data:
            pos.name = data['name']
            update_fields.append('name')
        if 'notes' in data:
            pos.notes = data['notes']
            update_fields.append('notes')
        if 'possible_bug' in data:
            pos.possible_bug = bool(data['possible_bug'])
            update_fields.append('possible_bug')
        if update_fields:
            pos.save(update_fields=sorted(set(update_fields)))
        if 'tags' in data:
            apply_tags(pos, data['tags'])
        return JsonResponse(get_position_detail(request=request, position=pos, filters=parse_position_filters(request)))

    # DELETE
    pos.delete()
    return HttpResponse(status=204, content_type='application/json')


@require_http_methods(['GET'])
def games_list(request):
    return JsonResponse(list_games(request=request))


@require_http_methods(['GET'])
def games_detail(request, pk):
    try:
        game = Game.objects.get(pk=pk)
    except Game.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    data = game_to_dict(game)
    data['history'] = build_game_history(game)
    return JsonResponse(data)


@require_http_methods(['GET'])
def tags_list(request):
    tags = Tag.objects.all().values('id', 'name')
    return JsonResponse(list(tags), safe=False)
