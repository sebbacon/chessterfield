import json

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.utils import timezone

from positions.models import Position
from progress.models import PracticeAttempt, UserPositionState


STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(
        username='player1',
        email='player1@example.com',
        password='password123',
    )


@pytest.fixture
def authed_client(client, user):
    client.force_login(user)
    return client


@pytest.fixture
def position(db):
    return Position.objects.create(
        name='Training Position',
        fen=STARTING_FEN,
        notes='',
    )


@pytest.mark.django_db
def test_me_detail_for_anonymous_user(client):
    response = client.get('/api/me/')

    assert response.status_code == 200
    payload = json.loads(response.content)
    assert payload['authenticated'] is False
    assert payload['user'] is None
    assert {mode['id'] for mode in payload['practice_modes']} == {'classic', 'streak', 'replay'}


@pytest.mark.django_db
def test_me_detail_for_authenticated_user(authed_client, user):
    response = authed_client.get('/api/me/')

    assert response.status_code == 200
    payload = json.loads(response.content)
    assert payload['authenticated'] is True
    assert payload['user']['username'] == user.username
    assert payload['user']['settings']['preferred_side'] == 'auto'


@pytest.mark.django_db
def test_patch_user_settings(authed_client, user):
    response = authed_client.patch(
        '/api/me/settings/',
        json.dumps({
            'preferred_side': 'black',
            'analysis_visibility': 'hidden',
        }),
        content_type='application/json',
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.settings.preferred_side == 'black'
    assert user.settings.analysis_visibility == 'hidden'


@pytest.mark.django_db
def test_patch_position_progress_marks_viewed_and_status(authed_client, user, position):
    response = authed_client.patch(
        f'/api/progress/positions/{position.id}/',
        json.dumps({
            'viewed': True,
            'status': 'in_progress',
            'mastery_score': 12,
        }),
        content_type='application/json',
    )

    assert response.status_code == 200
    state = UserPositionState.objects.get(user=user, position=position)
    assert state.viewed_at is not None
    assert state.status == UserPositionState.Status.IN_PROGRESS
    assert state.mastery_score == 12


@pytest.mark.django_db
def test_position_list_filters_by_viewed_progress(authed_client, user):
    viewed = Position.objects.create(name='Viewed', fen=STARTING_FEN, notes='')
    fresh = Position.objects.create(name='Fresh', fen=STARTING_FEN, notes='')
    UserPositionState.objects.create(
        user=user,
        position=viewed,
        viewed_at=timezone.now(),
        status=UserPositionState.Status.IN_PROGRESS,
    )

    response = authed_client.get('/api/positions/?progress=viewed')
    payload = json.loads(response.content)

    assert response.status_code == 200
    assert [row['name'] for row in payload['results']] == ['Viewed']
    assert payload['results'][0]['user_state']['status'] == 'in_progress'
    assert payload['results'][0]['score_summary']['attempt_count'] == 0
    assert fresh.name not in {row['name'] for row in payload['results']}


@pytest.mark.django_db
def test_practice_attempt_lifecycle_updates_user_state(authed_client, user, position):
    start_response = authed_client.post(
        '/api/practice/attempts/',
        json.dumps({
            'position_id': position.id,
            'mode': 'classic',
            'metadata': {'source': 'test'},
        }),
        content_type='application/json',
    )

    assert start_response.status_code == 201
    attempt_id = json.loads(start_response.content)['id']

    finish_response = authed_client.patch(
        f'/api/practice/attempts/{attempt_id}/',
        json.dumps({
            'result': 'won',
            'score_delta': 10,
            'metadata': {'line': 'mate'},
        }),
        content_type='application/json',
    )

    assert finish_response.status_code == 200
    attempt = PracticeAttempt.objects.get(pk=attempt_id)
    state = UserPositionState.objects.get(user=user, position=position)
    assert attempt.result == PracticeAttempt.Result.WON
    assert attempt.score_delta == 10
    assert state.status == UserPositionState.Status.COMPLETED
    assert state.attempt_count == 1
    assert state.best_score == 10
