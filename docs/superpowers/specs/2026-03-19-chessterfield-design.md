# Chessterfield — Design Spec

**Date:** 2026-03-19
**Status:** Approved

---

## Overview

Chessterfield is now a Django + Vite chess practice app with three durable data layers:

- reusable chess content (`Position`, `Game`, `Tag`, puzzle imports, Lichess imports)
- authenticated user state (profile and per-user settings)
- authenticated practice progress (viewed/completed/mastery state and scored attempts)

---

## Architecture

**Option chosen:** Django API + Vite JS frontend (Option B)

- Django still serves a thin JSON API and one SPA shell page
- Browser-side chess logic remains in the frontend: Chessground, chess.js, and Stockfish worker
- API views are now backed by small query/service modules instead of embedding all filter and serialization logic in view functions
- User-specific state is no longer modeled as content fields; it lives in dedicated `users` and `progress` apps
- Vite bundles the frontend into Django static files; no React, no websockets, no DRF

---

## Django Side

### Apps

- `positions`
  - content models: `Tag`, `Position`, `Game`
  - import workflow models: `PuzzleImportBatch`, `PuzzleImportPage`
  - JSON API for content browsing and detail
- `users`
  - `UserProfile`
  - `UserSettings`
  - `/api/me/` and `/api/me/settings/`
  - signup/login/logout integration via Django auth views
- `progress`
  - `UserPositionState`
  - `PracticeAttempt`
  - `/api/progress/positions/<id>/`
- `practice`
  - learning-mode registry and attempt lifecycle endpoints
  - `/api/practice/modes/`
  - `/api/practice/attempts/`

### Key model boundaries

- `Position` remains reusable chess content: FEN, notes, tags, import provenance
- `Game` remains imported source content: summary plus reconstructed replay history
- `UserPositionState` holds per-user viewed/progress/score summary for a position
- `PracticeAttempt` records individual scored runs without mutating content rows

### API Endpoints

All content endpoints still return JSON. Authenticated endpoints now use Django session auth + CSRF.

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/positions/` | List positions with canonical filters (`tag`, `tags`, `progress`, `sort`, `source_kind`) |
| POST | `/api/positions/` | Create position (name, fen, notes, tags[]) |
| GET | `/api/positions/<id>/` | Retrieve single position plus active-filter `next_position_id` |
| PATCH | `/api/positions/<id>/` | Update name, notes, or tags (tags[] replaces full set) |
| DELETE | `/api/positions/<id>/` | Delete position |
| GET | `/api/games/` | List imported games |
| GET | `/api/games/<id>/` | Game detail plus reconstructed history |
| GET | `/api/tags/` | List all tags (used by Import picker on mount) |
| GET | `/api/me/` | Current auth/session bootstrap and available practice modes |
| PATCH | `/api/me/settings/` | Update persisted user settings |
| PATCH | `/api/progress/positions/<id>/` | Mark viewed/update user position state |
| GET | `/api/practice/modes/` | List supported learning modes |
| POST | `/api/practice/attempts/` | Start a practice attempt |
| PATCH | `/api/practice/attempts/<id>/` | Finish a practice attempt |

Tags are created implicitly: when a position is POSTed or PATCHed with tag names, the backend uses `get_or_create` on Tag. There is no separate tag creation endpoint.

**Tag filter logic:** Multiple `?tag=` params use AND logic. `/tags/<tag1+tag2>/` is preserved as a URL alias for position browsing.

**Position list ordering:** Oldest-first by default, with explicit `sort=newest` support in the API contract.

**Per-user state:** Position payloads now include `user_state`, `score_summary`, and `eligible_modes` when the request is authenticated.

### Template

One Django template (`index.html`) still renders the SPA shell. Auth pages use Django templates under `templates/registration/`.

---

## Frontend Side

**Location:** `frontend/` directory at project root
**Toolchain:** Vite
**Dependencies:** `chessground`, `chess.js`, `stockfish` (npm package, WASM)

### SPA shape

- URL-driven state still lives in `router.js`
- View modules still mount the three main screens: library, import, play
- Network access now goes through thin `frontend/src/api/` helpers instead of raw `fetch` scattered through the views
- Session bootstrap is centralized in `frontend/src/state/session.js`
- Anonymous clients still fall back to local viewed-position storage; authenticated clients use the server-backed progress API

### Current view behavior

- Library
  - browses positions and imported games
  - supports tag filters, viewed/unviewed filters, and paginated browsing
  - shows account state inline in the header
- Import
  - imports manual FEN positions
  - reuses the shared API layer and auth bootstrap
- Play
  - supports free play from saved positions and replay mode from imported games
  - records authenticated practice attempts in `classic` mode
  - persists analysis visibility via user settings when signed in, local storage otherwise

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
  chessterfield/
    settings.py
    urls.py
    wsgi.py
  positions/
    models.py
    views.py
    urls.py
    api/
    services/
    migrations/
  users/
    models.py
    views.py
    urls.py
  progress/
    models.py
    views.py
    services.py
  practice/
    modes.py
    views.py
    urls.py
  templates/
    index.html
    registration/
  frontend/
    package.json
    vite.config.js
    src/
      api/
      state/
      main.js
      views/
        library.js
        import.js
        play.js
      chess/
      style.css
    dist/
  docs/
    superpowers/
      specs/
        2026-03-19-chessterfield-design.md
```

---

## Still Out of Scope

- server-side Stockfish
- multiplayer or shared leaderboards
- DRF / websocket infrastructure
- replacing the vanilla SPA with a frontend framework
