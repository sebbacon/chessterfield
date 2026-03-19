import json
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods
from .models import Position, Tag


def _position_to_dict(pos):
    return {
        'id': pos.id,
        'name': pos.name,
        'fen': pos.fen,
        'notes': pos.notes,
        'created_at': pos.created_at.isoformat(),
        'tags': sorted(pos.tags.values_list('name', flat=True)),
    }


def _apply_tags(position, tag_names):
    """Replace position's tag set with the given list of tag names."""
    tags = [Tag.objects.get_or_create(name=n.strip())[0] for n in tag_names if n.strip()]
    position.tags.set(tags)


@require_http_methods(['GET', 'POST'])
def positions_list(request):
    if request.method == 'GET':
        qs = Position.objects.all()
        tag_filters = request.GET.getlist('tag')
        if tag_filters:
            qs = qs.filter(tags__name__in=tag_filters).distinct()
        return JsonResponse([_position_to_dict(p) for p in qs], safe=False)

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
def tags_list(request):
    tags = Tag.objects.all().values('id', 'name')
    return JsonResponse(list(tags), safe=False)
