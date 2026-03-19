# Chessterfield — Design Spec

**Date:** 2026-03-19
**Status:** Approved

---

## Overview

A Django-based local chess practice app. Users import positions in FEN format, tag and save them to a library, then play from those positions against Stockfish with a real-time evaluation bar.

---

## Architecture

**Option chosen:** Django API + Vite JS frontend (Option B)

- Django serves a thin JSON API and renders a single HTML shell page
- All chess logic lives in the browser: Chessground (board), chess.js (move validation), stockfish-web WASM (engine)
- Vite bundles the frontend into Django's static files — works fully offline after `npm run build` + `python manage.py runserver`
- No websockets, no React, no DRF

---

## Django Side

### App: `positions`

### Models

```
Position
  id          AutoField (PK)
  name        CharField(max_length=100)
  fen         TextField()
  notes       TextField(blank=True)
  created_at  DateTimeField(auto_now_add=True)
  tags        ManyToManyField(Tag, blank=True)

Tag
  id          AutoField (PK)
  name        CharField(max_length=50, unique=True)
```

FEN stored as-is (TextField — FEN strings can exceed 100 chars with move counters). Tags are shared/reusable across positions (e.g. "sicilian" appears once, linked to many positions).

### API Endpoints

All return/accept JSON. No authentication (local-only app).

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/positions/` | List positions, optional `?tag=<name>` (repeatable, OR logic) |
| POST | `/api/positions/` | Create position (name, fen, notes, tags[]) |
| GET | `/api/positions/<id>/` | Retrieve single position |
| PATCH | `/api/positions/<id>/` | Update name, notes, or tags (tags[] replaces full set) |
| DELETE | `/api/positions/<id>/` | Delete position |
| GET | `/api/tags/` | List all tags (used by Import picker on mount) |

Tags are created implicitly: when a position is POSTed or PATCHed with tag names, the backend uses `get_or_create` on Tag. There is no separate tag creation endpoint.

**Tag filter logic:** Multiple `?tag=` params use OR logic — positions matching any of the selected tags are shown. Default (no tags selected) shows all positions.

**Position list ordering:** Sorted by `created_at` descending (newest first). No sort parameter.

**PATCH tag semantics:** Supplying `tags[]` in a PATCH replaces the full tag set for that position.

### Template

One Django template (`index.html`) renders the app shell. Assets resolved via `django-vite` (`{% vite_asset 'src/main.js' %}`).

---

## Frontend Side

**Location:** `frontend/` directory at project root
**Toolchain:** Vite
**Dependencies:** `chessground`, `chess.js`, `stockfish` (npm package, WASM)

### Three Views (JS state machine, no router)

#### 1. Library (default view)
- Left sidebar: tag filter list (multi-select, clickable; OR logic)
- Main area: grid/list of saved positions — name, tags, mini-board thumbnail
- Each card has a "Play" button → navigates to Play view
- Tag list pre-fetched from `GET /api/tags/` on Library mount

#### 2. Import
- Form: FEN input, name, notes, tag picker (type to add or select existing tags)
- Tag picker pre-fetches all tags from `GET /api/tags/` on mount
- Client-side FEN validation: attempt `new Chess(fen)` — if it throws, show inline error and block submission. This catches syntactically invalid and most illegal positions.
- On save → redirect to Library

#### 3. Play
- Main area: full-height Chessground board
- Left sidebar: position info (name, FEN, tags), side selector (play as White or Black)
- Right sidebar: vertical evaluation bar, engine depth/score, move history list
- Controls: Resign button, "New game from same position" button
- "Play Again" and "Back to Library" appear in the result overlay (not as persistent controls)

---

## Stockfish Integration

Stockfish (`stockfish` npm package) runs in a **Web Worker**. Communication is message-passing only.

### Play flow

1. Player makes a move → chess.js validates → Chessground updates board
2. After every move, frontend checks chess.js game-end methods (see below) before sending to engine
3. If game continues: current FEN sent to Stockfish worker: `position fen <fen>` then `go depth 20`
4. Worker streams `info` lines → evaluation bar and depth/score update in real time
5. On engine's turn: Stockfish returns `bestmove` → chess.js applies it → Chessground animates → repeat from step 2
6. Game end detected → display result overlay

### Side selection and turn order

- The user selects White or Black before play begins (side selector in left sidebar)
- If user picks White and FEN has White to move → user moves first
- If user picks White and FEN has Black to move → engine makes the first move automatically
- If user picks Black and FEN has White to move → engine makes the first move automatically
- If user picks Black and FEN has Black to move → user moves first

### Game-end detection

After every move (player or engine), the frontend calls all relevant chess.js methods:
- `chess.isCheckmate()` → "Checkmate"
- `chess.isStalemate()` → "Stalemate — Draw"
- `chess.isInsufficientMaterial()` → "Insufficient Material — Draw"
- `chess.isThreefoldRepetition()` → "Threefold Repetition — Draw" (auto-claimed; no player action needed)
- `chess.isDrawByFiftyMoves()` → "Fifty-Move Rule — Draw" (auto-claimed)

All five trigger the result overlay immediately. This is a practice app — draws are auto-claimed.

### Result overlay

Shown on game end or resign. Displays:
- Result string (e.g. "Checkmate — Engine wins", "Stalemate — Draw", "You resigned — Engine wins")
- "Play Again" button → restarts from the same FEN with the same side selection
- "Back to Library" button → returns to Library view

This behaviour is identical for all game-end conditions (checkmate, draw, resign).

### Evaluation bar

- Vertical bar; White's advantage = top of bar, Black's advantage = bottom (conventional, regardless of which side the user is playing)
- Centipawn score mapped linearly (capped at ±1000cp = full bar)
- Mate for White (positive): full bar top + "M<n>" label
- Mate for Black (negative): full bar bottom + "M<n>" label

### Engine strength

Fixed at depth 20. No difficulty slider (YAGNI).

### Error handling (minimum)

- FEN invalid (chess.js constructor throws on Import): inline error, block submission
- Stockfish worker fails to load: persistent banner "Engine unavailable — analysis disabled"; board still usable for viewing
- API call fails: toast notification with error message; no silent failures

---

## Django + Vite Integration

Use the `django-vite` package. Vite builds with `manifest: true` into `frontend/dist/`. Django's `STATICFILES_DIRS` includes `frontend/dist/`. The app shell template uses `{% vite_asset 'src/main.js' %}`. This resolves hashed filenames correctly for both dev (HMR proxy) and production (built assets).

---

## Project Structure

```
chessterfield/
  manage.py
  chessterfield/         # Django project settings
    settings.py
    urls.py
    wsgi.py
  positions/             # Django app
    models.py
    views.py
    urls.py
    migrations/
  templates/
    index.html           # App shell
  frontend/              # Vite project
    package.json
    vite.config.js
    src/
      main.js            # Entry point, JS state machine
      views/
        library.js
        import.js
        play.js
      chess/
        stockfish-worker.js
      style.css
    dist/                # Vite build output (in STATICFILES_DIRS)
  docs/
    superpowers/
      specs/
        2026-03-19-chessterfield-design.md
```

---

## Out of Scope (for this phase)

- PGN game import
- Game history / replay
- Difficulty slider
- User accounts / auth
- Server-side Stockfish
- Opening explorer
- Mobile layout
