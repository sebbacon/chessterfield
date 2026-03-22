import json
import pytest
from django.test import Client
from positions.models import Game, Position, Tag


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def position(db):
    return Position.objects.create(
        name='Starting Position',
        fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        notes='The beginning.',
    )


@pytest.fixture
def tag(db):
    return Tag.objects.create(name='opening')


@pytest.fixture
def game(db):
    return Game.objects.create(
        name='vs opponent (2026-03-20)',
        opponent='opponent',
        played_at='2026-03-20T12:00:00Z',
        final_fen='rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        user_color='white',
        winner='white',
        status='mate',
        source='lichess:testgame1',
    )


@pytest.fixture
def game_positions(db):
    return [
        Position.objects.create(
            name='vs opponent (2026-03-20) ply 0',
            fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            source='lichess:testgame1:0',
        ),
        Position.objects.create(
            name='vs opponent (2026-03-20) ply 1',
            fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
            source='lichess:testgame1:1',
        ),
        Position.objects.create(
            name='vs opponent (2026-03-20) ply 2',
            fen='rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
            source='lichess:testgame1:2',
        ),
    ]


# --- GET /api/positions/ ---

@pytest.mark.django_db
def test_list_positions_empty(client):
    r = client.get('/api/positions/')
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data['results'] == []
    assert data['count'] == 0


@pytest.mark.django_db
def test_list_positions_returns_positions(client, position):
    r = client.get('/api/positions/')
    data = json.loads(r.content)
    assert data['count'] == 1
    assert data['results'][0]['name'] == 'Starting Position'
    assert data['results'][0]['fen'] == 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    assert data['results'][0]['tags'] == []


@pytest.mark.django_db
def test_list_positions_tag_filter_and_logic(client):
    t1 = Tag.objects.create(name='opening')
    t2 = Tag.objects.create(name='endgame')
    t3 = Tag.objects.create(name='tactics')
    p1 = Position.objects.create(name='P1', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    p2 = Position.objects.create(name='P2', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    p3 = Position.objects.create(name='P3', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    p1.tags.add(t1)
    p2.tags.add(t1, t2)
    p3.tags.add(t3)
    r = client.get('/api/positions/?tag=opening&tag=endgame')
    data = json.loads(r.content)
    names = {d['name'] for d in data['results']}
    assert names == {'P2'}


@pytest.mark.django_db
def test_tagged_positions_url_serves_spa(client):
    r = client.get('/tags/opening+endgame/')
    assert r.status_code == 200
    assert b'<div id="app"></div>' in r.content


# --- POST /api/positions/ ---

@pytest.mark.django_db
def test_create_position(client):
    payload = {
        'name': 'Sicilian',
        'fen': 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        'notes': '',
        'tags': ['sicilian', 'opening'],
    }
    r = client.post('/api/positions/', json.dumps(payload), content_type='application/json')
    assert r.status_code == 201
    data = json.loads(r.content)
    assert data['name'] == 'Sicilian'
    assert set(data['tags']) == {'sicilian', 'opening'}
    assert Tag.objects.filter(name='sicilian').exists()
    assert Tag.objects.filter(name='opening').exists()


@pytest.mark.django_db
def test_create_position_reuses_existing_tags(client):
    Tag.objects.create(name='sicilian')
    payload = {'name': 'P', 'fen': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'notes': '', 'tags': ['sicilian']}
    client.post('/api/positions/', json.dumps(payload), content_type='application/json')
    assert Tag.objects.filter(name='sicilian').count() == 1


@pytest.mark.django_db
def test_create_position_missing_name_returns_400(client):
    payload = {'fen': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'tags': []}
    r = client.post('/api/positions/', json.dumps(payload), content_type='application/json')
    assert r.status_code == 400


# --- GET /api/positions/<id>/ ---

@pytest.mark.django_db
def test_get_position(client, position):
    r = client.get(f'/api/positions/{position.id}/')
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data['id'] == position.id
    assert data['name'] == 'Starting Position'
    assert data['next_position_id'] is None


@pytest.mark.django_db
def test_get_position_includes_next_position_id(client):
    import time
    first = Position.objects.create(
        name='First',
        fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    )
    time.sleep(0.01)
    second = Position.objects.create(
        name='Second',
        fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    )

    r = client.get(f'/api/positions/{first.id}/')
    data = json.loads(r.content)

    assert data['next_position_id'] == second.id


@pytest.mark.django_db
def test_get_position_not_found(client):
    r = client.get('/api/positions/9999/')
    assert r.status_code == 404


# --- PATCH /api/positions/<id>/ ---

@pytest.mark.django_db
def test_patch_position_name(client, position):
    r = client.patch(f'/api/positions/{position.id}/', json.dumps({'name': 'Renamed'}), content_type='application/json')
    assert r.status_code == 200
    position.refresh_from_db()
    assert position.name == 'Renamed'


@pytest.mark.django_db
def test_patch_position_tags_replaces_set(client, position, tag):
    position.tags.add(tag)
    r = client.patch(f'/api/positions/{position.id}/', json.dumps({'tags': ['endgame']}), content_type='application/json')
    assert r.status_code == 200
    assert list(position.tags.values_list('name', flat=True)) == ['endgame']


# --- DELETE /api/positions/<id>/ ---

@pytest.mark.django_db
def test_delete_position(client, position):
    r = client.delete(f'/api/positions/{position.id}/')
    assert r.status_code == 204
    assert not Position.objects.filter(id=position.id).exists()


@pytest.mark.django_db
def test_delete_position_not_found(client):
    r = client.delete('/api/positions/9999/')
    assert r.status_code == 404


@pytest.mark.django_db
def test_list_positions_oldest_first(client):
    import time
    p1 = Position.objects.create(name='Older', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    time.sleep(0.01)
    p2 = Position.objects.create(name='Newer', fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
    r = client.get('/api/positions/')
    data = json.loads(r.content)
    assert data['results'][0]['name'] == 'Older'
    assert data['results'][1]['name'] == 'Newer'


# --- GET /api/tags/ ---

@pytest.mark.django_db
def test_list_tags(client, tag):
    r = client.get('/api/tags/')
    assert r.status_code == 200
    data = json.loads(r.content)
    assert any(t['name'] == 'opening' for t in data)


# --- GET /api/games/ ---

@pytest.mark.django_db
def test_list_games_empty(client):
    r = client.get('/api/games/')
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data['results'] == []
    assert data['count'] == 0


@pytest.mark.django_db
def test_list_games_returns_game_summaries(client, game):
    r = client.get('/api/games/')
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data['count'] == 1
    assert data['results'][0]['name'] == 'vs opponent (2026-03-20)'
    assert data['results'][0]['fen'] == 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    assert data['results'][0]['result_label'] == 'You won'
    assert data['results'][0]['winner_label'] == 'White won'


@pytest.mark.django_db
def test_get_game_detail(client, game, game_positions):
    r = client.get(f'/api/games/{game.id}/')
    assert r.status_code == 200
    data = json.loads(r.content)
    assert data['id'] == game.id
    assert data['name'] == 'vs opponent (2026-03-20)'
    assert data['result_label'] == 'You won'
    assert len(data['history']) == 3
    assert data['history'][1]['move_san'] == 'e4'
    assert data['history'][2]['move_san'] == 'e5'
