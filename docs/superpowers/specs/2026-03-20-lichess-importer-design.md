# Lichess Game Importer — Design Spec

**Date:** 2026-03-20

## Overview

Import all games for a Lichess user (sebbacon) and extract every position (one per half-move) into the existing `Position` model. Re-running the importer skips already-imported positions.

## Data Model Change

Add a `source` field to `Position`:

```python
source = models.CharField(max_length=100, null=True, blank=True, unique=True)
```

Value format: `lichess:{game_id}:{ply}` (e.g. `lichess:AbCd1234:12`). `unique=True` with null allowed is the deduplication key — if a position with that source already exists, it is skipped.

## Dependencies

Add to `requirements.txt`:
- `python-chess` — PGN parsing and FEN extraction
- `requests` — HTTP streaming from Lichess API

## Management Command

`positions/management/commands/import_lichess.py`

### Behaviour

1. Stream NDJSON from `https://lichess.org/api/games/user/sebbacon?format=ndjson&moves=true`
2. For each game, replay moves with `chess.Board`, capturing FEN at each ply (0 = starting position, 1 = after move 1, etc.)
3. For each ply, compute `source = lichess:{id}:{ply}`, skip if already in DB
4. Create `Position`:
   - `name`: `vs {opponent} ({date}) ply {ply}`
   - `fen`: current board FEN
   - `notes`: `""` (empty)
   - `source`: `lichess:{id}:{ply}`
   - tags: `lichess`, user's color (`white` or `black`)

### Arguments

- `--max-games N` — stop after importing N games (default: unlimited)
- `--username` — Lichess username (default: `sebbacon`)

### Error handling

- HTTP errors: print warning and abort
- Malformed game JSON: print warning and skip that game
- Lichess rate limit (429): print message and abort with non-zero exit

## Justfile Recipe

```just
import-lichess *args:
    .venv/bin/python manage.py import_lichess {{args}}
```

## What Is Not In Scope

- Auth / private games
- Incremental sync (only newest games)
- UI for triggering the import
