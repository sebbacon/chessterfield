# Lichess Game Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Django management command that fetches all public games for a Lichess user and stores every position (one per half-move) as a `Position` record, skipping already-imported positions.

**Architecture:** Add a `source` field to `Position` for deduplication (`lichess:{game_id}:{ply}`), then stream games from the Lichess NDJSON API, replay moves with `python-chess`, and bulk-skip positions whose `source` already exists.

**Tech Stack:** Django management commands, `python-chess` (PGN/FEN), `requests` (HTTP streaming), pytest with `unittest.mock`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `positions/models.py` | Modify | Add `source` field |
| `positions/migrations/0002_position_source.py` | Create | Migration for `source` field |
| `requirements.txt` | Modify | Add `python-chess`, `requests` |
| `positions/management/__init__.py` | Create | Package init |
| `positions/management/commands/__init__.py` | Create | Package init |
| `positions/management/commands/import_lichess.py` | Create | The management command |
| `positions/tests/test_import_lichess.py` | Create | Tests for the command |
| `justfile` | Modify | Add `import-lichess` recipe |

---

## Task 1: Add `source` field to Position

**Files:**
- Modify: `positions/models.py`
- Create: `positions/migrations/0002_position_source.py`
- Test: `positions/tests/test_models.py`

- [ ] **Step 1: Write failing tests for `source` field**

Append to `positions/tests/test_models.py`:

```python
@pytest.mark.django_db
def test_position_source_nullable():
    pos = Position.objects.create(
        name='Test', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    )
    assert pos.source is None

@pytest.mark.django_db
def test_position_source_unique():
    Position.objects.create(
        name='A', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        source='lichess:abc123:0'
    )
    with pytest.raises(IntegrityError):
        Position.objects.create(
            name='B', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            source='lichess:abc123:0'
        )

@pytest.mark.django_db
def test_position_source_multiple_null_allowed():
    """Multiple positions with source=None must be allowed (unique only applies to non-null)."""
    Position.objects.create(name='A', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    Position.objects.create(name='B', fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
    assert Position.objects.filter(source__isnull=True).count() == 2
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
.venv/bin/python -m pytest positions/tests/test_models.py::test_position_source_nullable -v
```

Expected: `FAILED` — `TypeError: Position() got an unexpected keyword argument 'source'`

- [ ] **Step 3: Add `source` field to model**

In `positions/models.py`, add to `Position`:

```python
source = models.CharField(max_length=100, null=True, blank=True, unique=True)
```

Full updated `Position` class:

```python
class Position(models.Model):
    name = models.CharField(max_length=100)
    fen = models.TextField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    tags = models.ManyToManyField(Tag, blank=True)
    source = models.CharField(max_length=100, null=True, blank=True, unique=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['-created_at']
```

- [ ] **Step 4: Generate the migration**

```bash
.venv/bin/python manage.py makemigrations positions --name position_source
```

Expected: `positions/migrations/0002_position_source.py` created.

- [ ] **Step 5: Run the migration**

```bash
.venv/bin/python manage.py migrate
```

- [ ] **Step 6: Run the new tests**

```bash
.venv/bin/python -m pytest positions/tests/test_models.py -v
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add positions/models.py positions/migrations/0002_position_source.py positions/tests/test_models.py
git commit -m "feat: add source field to Position for dedup"
```

---

## Task 2: Add dependencies

**Files:**
- Modify: `requirements.txt`

- [ ] **Step 1: Add dependencies to requirements.txt**

```
django>=4.2,<5.0
django-vite>=3.0
pytest>=8.0
pytest-django>=4.8
python-chess>=1.999
requests>=2.31
```

- [ ] **Step 2: Install dependencies**

```bash
uv pip install -r requirements.txt
```

Expected: `python-chess` and `requests` installed.

- [ ] **Step 3: Verify python-chess works**

```bash
.venv/bin/python -c "import chess; b = chess.Board(); print(b.fen())"
```

Expected: `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`

- [ ] **Step 4: Commit**

```bash
git add requirements.txt
git commit -m "chore: add python-chess and requests"
```

---

## Task 3: Create management command

**Files:**
- Create: `positions/management/__init__.py`
- Create: `positions/management/commands/__init__.py`
- Create: `positions/management/commands/import_lichess.py`
- Create: `positions/tests/test_import_lichess.py`

- [ ] **Step 1: Create management package init files**

```bash
mkdir -p positions/management/commands
touch positions/management/__init__.py positions/management/commands/__init__.py
```

- [ ] **Step 2: Write failing tests**

Create `positions/tests/test_import_lichess.py`:

```python
import json
from unittest.mock import patch, MagicMock
import pytest
from django.core.management import call_command
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
        call_command("import_lichess")

    assert Position.objects.count() == 0


@pytest.mark.django_db
def test_import_position_name_format():
    with patch("positions.management.commands.import_lichess.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response([FAKE_GAME])
        call_command("import_lichess")

    pos = Position.objects.get(source="lichess:testgame1:2")
    assert "opponent" in pos.name
    assert "2014-11-14" in pos.name  # date from createdAt=1700000000000
    assert "ply 2" in pos.name
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
.venv/bin/python -m pytest positions/tests/test_import_lichess.py -v
```

Expected: `FAILED` — `No such management command 'import_lichess'`

- [ ] **Step 4: Write the management command**

Create `positions/management/commands/import_lichess.py`:

```python
import json
from datetime import datetime, timezone

import chess
import requests
from django.core.management.base import BaseCommand, CommandError

from positions.models import Position, Tag


class Command(BaseCommand):
    help = "Import games from Lichess and store each position"

    def add_arguments(self, parser):
        parser.add_argument("--username", default="sebbacon", help="Lichess username")
        parser.add_argument("--max-games", type=int, default=None, dest="max_games")

    def handle(self, *args, **options):
        username = options["username"]
        max_games = options["max_games"]

        url = f"https://lichess.org/api/games/user/{username}"
        params = {"format": "ndjson", "moves": "true"}
        headers = {"Accept": "application/x-ndjson"}

        resp = requests.get(url, params=params, headers=headers, stream=True)

        if resp.status_code == 429:
            raise CommandError("Rate limited by Lichess. Try again later.")
        if not resp.ok:
            raise CommandError(f"HTTP error {resp.status_code} from Lichess.")

        games_processed = created = skipped = 0

        for line in resp.iter_lines():
            if not line:
                continue
            if max_games is not None and games_processed >= max_games:
                break
            try:
                game = json.loads(line)
            except (json.JSONDecodeError, ValueError) as exc:
                self.stderr.write(f"Skipping malformed game: {exc}")
                continue

            c, s = self._import_game(game, username)
            created += c
            skipped += s
            games_processed += 1

        self.stdout.write(
            f"Done: {games_processed} games, {created} positions created, {skipped} skipped."
        )

    def _import_game(self, game, username):
        game_id = game.get("id", "unknown")
        moves_str = game.get("moves", "")
        created_at_ms = game.get("createdAt", 0)
        date = datetime.fromtimestamp(created_at_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

        players = game.get("players", {})
        white_name = players.get("white", {}).get("user", {}).get("name", "")
        if white_name.lower() == username.lower():
            color = "white"
            opponent = players.get("black", {}).get("user", {}).get("name", "unknown")
        else:
            color = "black"
            opponent = players.get("white", {}).get("user", {}).get("name", "unknown")

        lichess_tag, _ = Tag.objects.get_or_create(name="lichess")
        color_tag, _ = Tag.objects.get_or_create(name=color)

        board = chess.Board()
        plies = [(0, board.fen())]

        for move_str in (moves_str.split() if moves_str else []):
            try:
                board.push_uci(move_str)
            except (chess.InvalidMoveError, chess.IllegalMoveError, ValueError):
                try:
                    board.push_san(move_str)
                except Exception:
                    self.stderr.write(f"Bad move '{move_str}' in game {game_id}, stopping.")
                    break
            plies.append((len(plies), board.fen()))

        created = skipped = 0
        existing_sources = set(
            Position.objects.filter(
                source__startswith=f"lichess:{game_id}:"
            ).values_list("source", flat=True)
        )

        for ply, fen in plies:
            source = f"lichess:{game_id}:{ply}"
            if source in existing_sources:
                skipped += 1
                continue
            pos = Position.objects.create(
                name=f"vs {opponent} ({date}) ply {ply}",
                fen=fen,
                notes="",
                source=source,
            )
            pos.tags.add(lichess_tag, color_tag)
            created += 1

        return created, skipped
```

- [ ] **Step 5: Run the tests**

```bash
.venv/bin/python -m pytest positions/tests/test_import_lichess.py -v
```

Expected: all PASS

- [ ] **Step 6: Run the full test suite to check for regressions**

```bash
.venv/bin/python -m pytest
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add positions/management/ positions/tests/test_import_lichess.py
git commit -m "feat: add import_lichess management command"
```

---

## Task 4: Add justfile recipe

**Files:**
- Modify: `justfile`

- [ ] **Step 1: Add recipe to justfile**

Append to `justfile`:

```just
# Import games from Lichess (--max-games N to limit)
import-lichess *args:
    .venv/bin/python manage.py import_lichess {{args}}
```

- [ ] **Step 2: Verify it lists**

```bash
just --list
```

Expected: `import-lichess` appears in the list.

- [ ] **Step 3: Commit**

```bash
git add justfile
git commit -m "chore: add import-lichess just recipe"
```

---

## Task 5: Smoke test against live Lichess API

- [ ] **Step 1: Run with 1 game to verify real API works**

```bash
just import-lichess --max-games 1
```

Expected output like:
```
Done: 1 games, 42 positions created, 0 skipped.
```

- [ ] **Step 2: Re-run to verify deduplication**

```bash
just import-lichess --max-games 1
```

Expected:
```
Done: 1 games, 0 positions created, 42 skipped.
```

- [ ] **Step 3: Check positions in Django shell**

```bash
.venv/bin/python manage.py shell -c "
from positions.models import Position
print(Position.objects.filter(tags__name='lichess').count())
print(Position.objects.filter(source__startswith='lichess:').first().name)
"
```
