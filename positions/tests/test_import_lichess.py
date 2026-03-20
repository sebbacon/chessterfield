import json
from unittest.mock import patch, MagicMock
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from positions.models import Position, Tag


FAKE_GAME = {
    "id": "testgame1",
    "createdAt": 1700000000000,
    "players": {
        "white": {"user": {"name": "sebbacon"}},
        "black": {"user": {"name": "opponent"}},
    },
    "moves": "e2e4 e7e5 g1f3",
}

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def _make_mock_response(games, status_code=200):
    mock_resp = MagicMock()
    mock_resp.ok = status_code == 200
    mock_resp.status_code = status_code
    mock_resp.iter_lines.return_value = [
        json.dumps(g).encode() for g in games
    ]
    return mock_resp


@pytest.mark.django_db
def test_import_creates_positions():
    with patch("positions.management.commands.import_lichess.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response([FAKE_GAME])
        call_command("import_lichess")

    # 4 positions: ply 0 (start), after e4, after e5, after Nf3
    assert Position.objects.count() == 4


@pytest.mark.django_db
def test_import_sets_source():
    with patch("positions.management.commands.import_lichess.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response([FAKE_GAME])
        call_command("import_lichess")

    assert Position.objects.filter(source="lichess:testgame1:0").exists()
    assert Position.objects.filter(source="lichess:testgame1:3").exists()


@pytest.mark.django_db
def test_import_sets_tags():
    with patch("positions.management.commands.import_lichess.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response([FAKE_GAME])
        call_command("import_lichess")

    pos = Position.objects.get(source="lichess:testgame1:0")
    tag_names = set(pos.tags.values_list("name", flat=True))
    assert "lichess" in tag_names
    assert "white" in tag_names  # sebbacon played white


@pytest.mark.django_db
def test_import_skips_existing():
    Position.objects.create(
        name="existing", fen=STARTING_FEN, source="lichess:testgame1:0"
    )
    with patch("positions.management.commands.import_lichess.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response([FAKE_GAME])
        call_command("import_lichess")

    # 3 new + 1 already existing = 4 total, not 8
    assert Position.objects.count() == 4


@pytest.mark.django_db
def test_import_max_games():
    games = [
        {**FAKE_GAME, "id": f"game{i}"} for i in range(5)
    ]
    with patch("positions.management.commands.import_lichess.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response(games)
        call_command("import_lichess", max_games=2)

    assert Position.objects.count() == 8  # 4 positions × 2 games


@pytest.mark.django_db
def test_import_http_error(capsys):
    with patch("positions.management.commands.import_lichess.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response([], status_code=500)
        with pytest.raises(CommandError):
            call_command("import_lichess")

    assert Position.objects.count() == 0


@pytest.mark.django_db
def test_import_position_name_format():
    with patch("positions.management.commands.import_lichess.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response([FAKE_GAME])
        call_command("import_lichess")

    pos = Position.objects.get(source="lichess:testgame1:2")
    assert "opponent" in pos.name
    assert "2023-11-14" in pos.name  # date from createdAt=1700000000000
    assert "ply 2" in pos.name
