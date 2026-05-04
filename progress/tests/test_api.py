import json
from datetime import datetime, timezone as dt_timezone

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.utils import timezone

from positions.models import Position, Tag
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
    assert payload['user']['settings']['engine_move_speed'] == 'instant'


@pytest.mark.django_db
def test_patch_user_settings(authed_client, user):
    response = authed_client.patch(
        '/api/me/settings/',
        json.dumps({
            'preferred_side': 'black',
            'analysis_visibility': 'hidden',
            'engine_move_speed': 'fast',
        }),
        content_type='application/json',
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.settings.preferred_side == 'black'
    assert user.settings.analysis_visibility == 'hidden'
    assert user.settings.engine_move_speed == 'fast'


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
def test_position_list_filters_by_not_started_progress(authed_client, user):
    started = Position.objects.create(name='Started', fen=STARTING_FEN, notes='')
    fresh = Position.objects.create(name='Fresh', fen=STARTING_FEN, notes='')
    UserPositionState.objects.create(
        user=user,
        position=started,
        last_played_at=timezone.now(),
        status=UserPositionState.Status.IN_PROGRESS,
    )

    response = authed_client.get('/api/positions/?progress=not_started')
    payload = json.loads(response.content)

    assert response.status_code == 200
    assert [row['name'] for row in payload['results']] == ['Fresh']
    assert started.name not in {row['name'] for row in payload['results']}


@pytest.mark.django_db
def test_practice_attempt_lifecycle_updates_user_state(authed_client, user, position):
    start_response = authed_client.post(
        '/api/practice/attempts/',
        json.dumps({
            'position_id': position.id,
            'mode': 'classic',
            'target_depth_plies': 4,
            'metadata': {'source': 'test'},
        }),
        content_type='application/json',
    )

    assert start_response.status_code == 201
    start_payload = json.loads(start_response.content)
    attempt_id = start_payload['id']
    assert start_payload['target_depth_plies'] == 4

    finish_response = authed_client.patch(
        f'/api/practice/attempts/{attempt_id}/',
        json.dumps({
            'result': 'completed',
            'matched_prefix_plies': 4,
            'expected_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
            'played_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
            'completion_reason': 'solved',
            'completed_normally': True,
            'metadata': {'line': 'mate'},
        }),
        content_type='application/json',
    )

    assert finish_response.status_code == 200
    attempt = PracticeAttempt.objects.get(pk=attempt_id)
    state = UserPositionState.objects.get(user=user, position=position)
    assert attempt.result == PracticeAttempt.Result.COMPLETED
    assert attempt.score_delta == 4
    assert attempt.matched_prefix_plies == 4
    assert attempt.metadata == {'source': 'test', 'line': 'mate'}
    assert attempt.expected_line == ['e2e4', 'g1f3', 'f1c4', 'd2d3']
    assert attempt.played_line == ['e2e4', 'g1f3', 'f1c4', 'd2d3']
    assert state.status == UserPositionState.Status.MASTERED
    assert state.attempt_count == 1
    assert state.best_score == 4
    assert state.mastery_score == 100
    assert state.recent_accuracy_score == 100
    assert state.current_perfect_streak == 1
    assert state.perfect_record is False
    assert state.needs_homework is True
    assert state.best_matched_prefix_plies == 4
    assert state.last_matched_prefix_plies == 4
    assert state.solved_count == 1


@pytest.mark.django_db
def test_practice_attempt_mismatch_updates_prefix_without_solving(authed_client, user, position):
    start_response = authed_client.post(
        '/api/practice/attempts/',
        json.dumps({
            'position_id': position.id,
            'mode': 'classic',
            'target_depth_plies': 4,
        }),
        content_type='application/json',
    )
    attempt_id = json.loads(start_response.content)['id']

    finish_response = authed_client.patch(
        f'/api/practice/attempts/{attempt_id}/',
        json.dumps({
            'result': 'lost',
            'matched_prefix_plies': 1,
            'expected_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
            'played_line': ['e2e4', 'b1c3'],
            'completion_reason': 'mismatch',
            'completed_normally': False,
        }),
        content_type='application/json',
    )

    assert finish_response.status_code == 200
    attempt = PracticeAttempt.objects.get(pk=attempt_id)
    state = UserPositionState.objects.get(user=user, position=position)
    assert attempt.matched_prefix_plies == 1
    assert attempt.completion_reason == 'mismatch'
    assert state.status == UserPositionState.Status.IN_PROGRESS
    assert state.best_score == 1
    assert state.last_score == 1
    assert state.mastery_score == 16
    assert state.recent_accuracy_score == 25
    assert state.current_perfect_streak == 0
    assert state.perfect_record is False
    assert state.needs_homework is True
    assert state.best_matched_prefix_plies == 1
    assert state.last_matched_prefix_plies == 1
    assert state.solved_count == 0


@pytest.mark.django_db
def test_hinted_solve_caps_mastery_and_preserves_metadata(authed_client, user, position):
    start_response = authed_client.post(
        '/api/practice/attempts/',
        json.dumps({
            'position_id': position.id,
            'mode': 'classic',
            'target_depth_plies': 4,
            'metadata': {'start_fen': STARTING_FEN, 'tracked_puzzle': True},
        }),
        content_type='application/json',
    )
    attempt_id = json.loads(start_response.content)['id']

    finish_response = authed_client.patch(
        f'/api/practice/attempts/{attempt_id}/',
        json.dumps({
            'result': 'completed',
            'matched_prefix_plies': 4,
            'expected_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
            'played_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
            'completion_reason': 'solved',
            'completed_normally': True,
            'metadata': {'hint_requested': True, 'final_fen': STARTING_FEN},
        }),
        content_type='application/json',
    )

    assert finish_response.status_code == 200
    attempt = PracticeAttempt.objects.get(pk=attempt_id)
    state = UserPositionState.objects.get(user=user, position=position)
    assert attempt.metadata == {
        'start_fen': STARTING_FEN,
        'tracked_puzzle': True,
        'hint_requested': True,
        'final_fen': STARTING_FEN,
    }
    assert state.solved_count == 1
    assert state.mastery_score == 80
    assert state.status == UserPositionState.Status.REVISION


@pytest.mark.django_db
def test_clean_solve_after_hinted_solve_can_reach_mastered(authed_client, user, position):
    for metadata in ({'hint_requested': True}, {'hint_requested': False}):
        start_response = authed_client.post(
            '/api/practice/attempts/',
            json.dumps({
                'position_id': position.id,
                'mode': 'classic',
                'target_depth_plies': 4,
            }),
            content_type='application/json',
        )
        attempt_id = json.loads(start_response.content)['id']

        finish_response = authed_client.patch(
            f'/api/practice/attempts/{attempt_id}/',
            json.dumps({
                'result': 'completed',
                'matched_prefix_plies': 4,
                'expected_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
                'played_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
                'completion_reason': 'solved',
                'completed_normally': True,
                'metadata': metadata,
            }),
            content_type='application/json',
        )
        assert finish_response.status_code == 200

    state = UserPositionState.objects.get(user=user, position=position)
    assert state.attempt_count == 2
    assert state.solved_count == 2
    assert state.mastery_score == 100
    assert state.status == UserPositionState.Status.MASTERED


@pytest.mark.django_db
def test_three_perfect_attempts_mark_position_mastered(authed_client, user, position):
    for _index in range(3):
        start_response = authed_client.post(
            '/api/practice/attempts/',
            json.dumps({
                'position_id': position.id,
                'mode': 'classic',
                'target_depth_plies': 4,
            }),
            content_type='application/json',
        )
        attempt_id = json.loads(start_response.content)['id']
        finish_response = authed_client.patch(
            f'/api/practice/attempts/{attempt_id}/',
            json.dumps({
                'result': 'completed',
                'matched_prefix_plies': 4,
                'expected_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
                'played_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
                'completion_reason': 'solved',
                'completed_normally': True,
            }),
            content_type='application/json',
        )
        assert finish_response.status_code == 200

    state = UserPositionState.objects.get(user=user, position=position)
    assert state.status == UserPositionState.Status.MASTERED
    assert state.attempt_count == 3
    assert state.solved_count == 3
    assert state.mastery_score == 100
    assert state.recent_accuracy_score == 100
    assert state.current_perfect_streak == 3
    assert state.perfect_record is True
    assert state.needs_homework is False

    response = authed_client.get('/api/positions/?progress=mastered')
    payload = json.loads(response.content)
    assert response.status_code == 200
    assert [row['id'] for row in payload['results']] == [position.id]


@pytest.mark.django_db
def test_position_list_filters_by_revision_status(authed_client, user):
    revision = Position.objects.create(name='Revision', fen=STARTING_FEN, notes='')
    mastered = Position.objects.create(name='Mastered', fen=STARTING_FEN, notes='')
    UserPositionState.objects.create(
        user=user,
        position=revision,
        status=UserPositionState.Status.REVISION,
        solved_count=1,
        mastery_score=48,
        needs_homework=True,
    )
    UserPositionState.objects.create(
        user=user,
        position=mastered,
        status=UserPositionState.Status.MASTERED,
        mastery_score=100,
        perfect_record=True,
        needs_homework=False,
    )

    response = authed_client.get('/api/positions/?progress=revision')
    payload = json.loads(response.content)

    assert response.status_code == 200
    assert [row['name'] for row in payload['results']] == ['Revision']


@pytest.mark.django_db
def test_workout_sort_orders_positions_by_progress_bucket_and_last_attempt(authed_client, user):
    invalid_fresh = Position.objects.create(name='Invalid Fresh', fen='8/8/8/8/8/8/6r1/1Q1K3n w - - 0 1', notes='')
    tactic = Position.objects.create(name='Fresh A', fen=STARTING_FEN, notes='')
    second_fresh = Position.objects.create(name='Fresh B', fen=STARTING_FEN, notes='')
    in_progress_old = Position.objects.create(name='In Progress Old', fen=STARTING_FEN, notes='')
    in_progress_new = Position.objects.create(name='In Progress New', fen=STARTING_FEN, notes='')
    revision_old = Position.objects.create(name='Revision Old', fen=STARTING_FEN, notes='')
    revision_new = Position.objects.create(name='Revision New', fen=STARTING_FEN, notes='')
    mastered = Position.objects.create(name='Mastered', fen=STARTING_FEN, notes='')

    tactic_tag = Tag.objects.create(name='tactic:fork')
    for position in (invalid_fresh, tactic, second_fresh, in_progress_old, in_progress_new, revision_old, revision_new, mastered):
        position.tags.add(tactic_tag)

    old_attempt_time = datetime(2026, 4, 1, 10, 0, tzinfo=dt_timezone.utc)
    new_attempt_time = datetime(2026, 4, 2, 10, 0, tzinfo=dt_timezone.utc)

    UserPositionState.objects.create(
        user=user,
        position=in_progress_old,
        status=UserPositionState.Status.IN_PROGRESS,
        last_played_at=old_attempt_time,
        attempt_count=1,
    )
    UserPositionState.objects.create(
        user=user,
        position=in_progress_new,
        status=UserPositionState.Status.IN_PROGRESS,
        last_played_at=new_attempt_time,
        attempt_count=1,
    )
    UserPositionState.objects.create(
        user=user,
        position=revision_old,
        status=UserPositionState.Status.REVISION,
        solved_count=1,
        mastery_score=40,
        last_played_at=old_attempt_time,
        attempt_count=1,
    )
    UserPositionState.objects.create(
        user=user,
        position=revision_new,
        status=UserPositionState.Status.REVISION,
        solved_count=1,
        mastery_score=60,
        last_played_at=new_attempt_time,
        attempt_count=1,
    )
    UserPositionState.objects.create(
        user=user,
        position=mastered,
        status=UserPositionState.Status.MASTERED,
        solved_count=3,
        mastery_score=92,
        last_played_at=new_attempt_time,
        attempt_count=3,
    )

    response = authed_client.get('/api/positions/?sort=workout&tactic=tactic:fork')
    payload = json.loads(response.content)

    invalid_fresh.refresh_from_db()
    assert response.status_code == 200
    assert invalid_fresh.possible_bug is True
    assert [row['name'] for row in payload['results']] == [
        'Fresh A',
        'Fresh B',
        'In Progress Old',
        'In Progress New',
        'Revision Old',
        'Revision New',
    ]


@pytest.mark.django_db
def test_workout_all_tactics_filter_only_returns_tactic_positions(authed_client):
    tactic_position = Position.objects.create(name='Tactic Position', fen=STARTING_FEN, notes='')
    non_tactic_position = Position.objects.create(name='Plain Position', fen=STARTING_FEN, notes='')
    tactic_position.tags.add(Tag.objects.create(name='tactic:pin'))
    non_tactic_position.tags.add(Tag.objects.create(name='opening'))

    response = authed_client.get('/api/positions/?sort=workout&tactic=all')
    payload = json.loads(response.content)

    assert response.status_code == 200
    assert [row['name'] for row in payload['results']] == ['Tactic Position']


@pytest.mark.django_db
def test_practice_attempt_counts_short_solution_as_solved(authed_client, user, position):
    start_response = authed_client.post(
        '/api/practice/attempts/',
        json.dumps({
            'position_id': position.id,
            'mode': 'classic',
            'target_depth_plies': 4,
        }),
        content_type='application/json',
    )
    attempt_id = json.loads(start_response.content)['id']

    finish_response = authed_client.patch(
        f'/api/practice/attempts/{attempt_id}/',
        json.dumps({
            'result': 'completed',
            'target_depth_plies': 2,
            'matched_prefix_plies': 2,
            'expected_line': ['d1h5', 'f1c4'],
            'played_line': ['d1h5', 'f1c4'],
            'completion_reason': 'solved',
            'completed_normally': True,
        }),
        content_type='application/json',
    )

    assert finish_response.status_code == 200
    attempt = PracticeAttempt.objects.get(pk=attempt_id)
    state = UserPositionState.objects.get(user=user, position=position)
    assert attempt.target_depth_plies == 2
    assert attempt.matched_prefix_plies == 2
    assert state.solved_count == 1
    assert state.status == UserPositionState.Status.MASTERED


@pytest.mark.django_db
def test_mastery_score_recovers_after_early_failures(authed_client, user, position):
    for result in ('lost', 'lost', 'lost', 'completed', 'completed'):
        start_response = authed_client.post(
            '/api/practice/attempts/',
            json.dumps({
                'position_id': position.id,
                'mode': 'classic',
                'target_depth_plies': 4,
            }),
            content_type='application/json',
        )
        attempt_id = json.loads(start_response.content)['id']
        payload = {
            'result': result,
            'target_depth_plies': 4,
            'matched_prefix_plies': 4 if result == 'completed' else 0,
            'expected_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
            'played_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'] if result == 'completed' else ['a2a3'],
            'completion_reason': 'solved' if result == 'completed' else 'mismatch',
            'completed_normally': result == 'completed',
        }
        finish_response = authed_client.patch(
            f'/api/practice/attempts/{attempt_id}/',
            json.dumps(payload),
            content_type='application/json',
        )
        assert finish_response.status_code == 200

    state = UserPositionState.objects.get(user=user, position=position)
    assert state.attempt_count == 5
    assert state.solved_count == 2
    assert state.current_perfect_streak == 2
    assert state.mastery_score == 70
    assert state.status == UserPositionState.Status.REVISION


@pytest.mark.django_db
def test_mastery_score_caps_at_100_after_long_recovery_streak(authed_client, user, position):
    for result in ('lost', 'lost', 'lost', 'completed', 'completed', 'completed', 'completed'):
        start_response = authed_client.post(
            '/api/practice/attempts/',
            json.dumps({
                'position_id': position.id,
                'mode': 'classic',
                'target_depth_plies': 4,
            }),
            content_type='application/json',
        )
        attempt_id = json.loads(start_response.content)['id']
        payload = {
            'result': result,
            'target_depth_plies': 4,
            'matched_prefix_plies': 4 if result == 'completed' else 0,
            'expected_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'],
            'played_line': ['e2e4', 'g1f3', 'f1c4', 'd2d3'] if result == 'completed' else ['a2a3'],
            'completion_reason': 'solved' if result == 'completed' else 'mismatch',
            'completed_normally': result == 'completed',
        }
        finish_response = authed_client.patch(
            f'/api/practice/attempts/{attempt_id}/',
            json.dumps(payload),
            content_type='application/json',
        )
        assert finish_response.status_code == 200

    state = UserPositionState.objects.get(user=user, position=position)
    assert state.attempt_count == 7
    assert state.solved_count == 4
    assert state.current_perfect_streak == 4
    assert state.mastery_score == 100
    assert state.status == UserPositionState.Status.MASTERED
