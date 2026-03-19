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
  fen         CharField(max_length=100)
  notes       TextField(blank=True)
  created_at  DateTimeField(auto_now_add=True)
  tags        ManyToManyField(Tag, blank=True)

Tag
  id          AutoField (PK)
  name        CharField(max_length=50, unique=True)
```

FEN stored as-is. Tags are shared/reusable across positions (e.g. "sicilian" appears once, linked to many positions).

### API Endpoints

All return/accept JSON. No authentication (local-only app).

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/positions/` | List positions, optional `?tag=<name>` filter |
| POST | `/api/positions/` | Create position (name, fen, notes, tags[]) |
| GET | `/api/positions/<id>/` | Retrieve single position |
| DELETE | `/api/positions/<id>/` | Delete position |
| GET | `/api/tags/` | List all tags |

### Template

One Django template (`index.html`) renders the app shell. Vite's built assets are referenced via Django's `{% static %}` tag.

---

## Frontend Side

**Location:** `frontend/` directory at project root
**Toolchain:** Vite
**Dependencies:** `chessground`, `chess.js`, `stockfish` (stockfish-web WASM)

### Three Views (JS state machine, no router)

#### 1. Library (default view)
- Left sidebar: tag filter list (multi-select, clickable)
- Main area: grid/list of saved positions — name, tags, mini-board thumbnail
- Each card has a "Play" button → navigates to Play view

#### 2. Import
- Form: FEN input, name, notes, tag picker (type to add or select existing tags)
- Client-side FEN validation via chess.js before allowing submit
- On save → redirect to Library

#### 3. Play
- Main area: full-height Chessground board
- Left sidebar: position info (name, FEN, tags), side selector (play as White or Black)
- Right sidebar: vertical evaluation bar, engine depth/score, move history list
- Controls: Resign button, "New game from same position" button

---

## Stockfish Integration

Stockfish runs in a **Web Worker** via stockfish-web's built-in worker support. Communication is message-passing only.

### Play flow

1. Player makes a move → chess.js validates → Chessground updates board
2. Current FEN sent to Stockfish worker: `position fen <fen>` then `go depth 20`
3. Worker streams `info` lines → evaluation bar and depth/score update in real time
4. On engine's turn: Stockfish returns `bestmove` → chess.js applies it → Chessground animates
5. Game end (checkmate / stalemate / resign) → display result overlay, offer "Play Again"

### Evaluation bar

- Vertical bar, white advantage = grows upward
- Centipawn score mapped linearly (capped at ±1000cp = full bar)
- Mate-in-N shown as full bar with "M<n>" label

### Engine strength

Fixed at depth 20. No difficulty slider (YAGNI).

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
      main.js            # Entry point
      views/
        library.js
        import.js
        play.js
      chess/
        stockfish-worker.js
      style.css
  static/                # Vite build output (committed or gitignored)
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
