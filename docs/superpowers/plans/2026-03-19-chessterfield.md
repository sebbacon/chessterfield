# Chessterfield Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Django chess practice app where users import FEN positions into a tagged library and play them against Stockfish with a real-time evaluation bar.

**Architecture:** Django serves a JSON API (Position + Tag CRUD) and a single HTML shell page. All chess logic runs in the browser via Chessground (board), chess.js (move validation), and stockfish (WASM engine in a Web Worker). Vite bundles the frontend into `frontend/dist/` which Django serves as static files — fully offline after `npm run build`.

**Tech Stack:** Python/Django 4.2+, django-vite, pytest/pytest-django, Node/Vite, chess.js, chessground, stockfish (npm), Vitest

---

## File Map

```
chessterfield/
  requirements.txt
  pytest.ini
  manage.py
  chessterfield/
    __init__.py
    settings.py          # Django config incl. django-vite settings
    urls.py              # Root URL conf → positions.urls + template view
    wsgi.py
  positions/
    __init__.py
    models.py            # Position + Tag models
    views.py             # All 6 API endpoint functions
    urls.py              # /api/positions/ and /api/tags/ routes
    migrations/
      0001_initial.py
    tests/
      __init__.py
      test_models.py     # Model creation, tag M2M
      test_views.py      # All API endpoint behaviours
  templates/
    index.html           # App shell — loads Vite assets
  frontend/
    package.json
    vite.config.js
    src/
      main.js            # Entry point; JS state machine (view switching)
      style.css          # Global styles; layout grid; eval bar; overlay
      views/
        library.js       # Library view: fetch positions, tag filter, mini-boards
        import.js        # Import view: FEN form, validation, tag picker
        play.js          # Play view: Chessground, side select, move loop
      chess/
        worker.js        # Web Worker: UCI protocol wrapper around stockfish
        eval.js          # Pure fn: parse Stockfish output → {cp, mate, depth}
        miniboard.js     # Pure fn: FEN → 8×8 HTML string (Unicode pieces)
      tests/
        eval.test.js     # Vitest: centipawn mapping, mate parsing
        miniboard.test.js # Vitest: FEN → board grid
    dist/                # Vite build output (gitignored; served by Django)
```

---

## Task 1: Python environment + Django project scaffold

**Files:**
- Create: `requirements.txt`
- Create: `pytest.ini`
- Create: `manage.py` (via django-admin)
- Create: `chessterfield/settings.py`
- Create: `chessterfield/urls.py`
- Create: `chessterfield/wsgi.py`
- Create: `chessterfield/__init__.py`

- [ ] **Step 1: Create `requirements.txt`**

```
django>=4.2,<5.0
django-vite>=3.0
pytest>=8.0
pytest-django>=4.8
```

- [ ] **Step 2: Create virtual environment and install deps**

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 3: Scaffold Django project**

```bash
django-admin startproject chessterfield .
```

This creates `manage.py`, `chessterfield/settings.py`, `chessterfield/urls.py`, `chessterfield/wsgi.py`, `chessterfield/__init__.py`.

- [ ] **Step 4: Create `positions` app**

```bash
python manage.py startapp positions
```

- [ ] **Step 5: Edit `chessterfield/settings.py`**

Add/modify these sections (leave everything else as generated):

```python
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Add to INSTALLED_APPS:
INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.staticfiles',
    'django_vite',
    'positions',
]
# (Remove auth, admin, sessions, messages if you want minimal — but keeping them is fine)

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
            ],
        },
    },
]

STATIC_URL = '/static/'
STATICFILES_DIRS = [
    BASE_DIR / 'frontend' / 'dist',
]
STATIC_ROOT = BASE_DIR / 'staticfiles'

DJANGO_VITE = {
    'default': {
        'dev_mode': True,           # Set False for production (after npm run build)
        'dev_server_port': 5173,
        'assets_path': BASE_DIR / 'frontend' / 'dist',
    }
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}
```

- [ ] **Step 6: Edit `chessterfield/urls.py`**

```python
from django.urls import path, include
from django.views.generic import TemplateView

urlpatterns = [
    path('api/', include('positions.urls')),
    path('', TemplateView.as_view(template_name='index.html'), name='index'),
]
```

- [ ] **Step 7: Create `pytest.ini`**

```ini
[pytest]
DJANGO_SETTINGS_MODULE = chessterfield.settings
pythonpath = .
```

- [ ] **Step 8: Verify Django starts**

```bash
python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 9: Commit**

```bash
git add requirements.txt pytest.ini manage.py chessterfield/ positions/
git commit -m "feat: scaffold Django project with positions app"
```

---

## Task 2: Position and Tag models

**Files:**
- Modify: `positions/models.py`
- Create: `positions/migrations/0001_initial.py` (via makemigrations)
- Create: `positions/tests/__init__.py`
- Create: `positions/tests/test_models.py`

- [ ] **Step 1: Write failing model test**

Create `positions/tests/__init__.py` (empty) and `positions/tests/test_models.py`:

```python
import pytest
from positions.models import Position, Tag

@pytest.mark.django_db
def test_create_tag():
    tag = Tag.objects.create(name='sicilian')
    assert tag.name == 'sicilian'
    assert str(tag) == 'sicilian'

@pytest.mark.django_db
def test_create_position():
    pos = Position.objects.create(
        name='Sicilian Najdorf',
        fen='rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6',
        notes='Key middlegame position',
    )
    assert pos.name == 'Sicilian Najdorf'
    assert pos.tags.count() == 0
    assert str(pos) == 'Sicilian Najdorf'

@pytest.mark.django_db
def test_position_tags_many_to_many():
    tag1 = Tag.objects.create(name='sicilian')
    tag2 = Tag.objects.create(name='opening')
    pos = Position.objects.create(
        name='Najdorf',
        fen='rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6',
    )
    pos.tags.add(tag1, tag2)
    assert pos.tags.count() == 2
    assert set(pos.tags.values_list('name', flat=True)) == {'sicilian', 'opening'}

@pytest.mark.django_db
def test_tag_uniqueness():
    Tag.objects.create(name='endgame')
    with pytest.raises(Exception):
        Tag.objects.create(name='endgame')

@pytest.mark.django_db
def test_position_ordered_newest_first():
    pos1 = Position.objects.create(name='First', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    pos2 = Position.objects.create(name='Second', fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
    qs = list(Position.objects.all())
    assert qs[0] == pos2  # newest first
    assert qs[1] == pos1
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest positions/tests/test_models.py -v
```

Expected: `ImportError` or `FAILED` — models don't exist yet.

- [ ] **Step 3: Write `positions/models.py`**

```python
from django.db import models


class Tag(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['name']


class Position(models.Model):
    name = models.CharField(max_length=100)
    fen = models.TextField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    tags = models.ManyToManyField(Tag, blank=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['-created_at']
```

- [ ] **Step 4: Create and apply migration**

```bash
python manage.py makemigrations positions
python manage.py migrate
```

Expected: Migration created and applied successfully.

- [ ] **Step 5: Run tests to confirm pass**

```bash
pytest positions/tests/test_models.py -v
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add positions/models.py positions/migrations/ positions/tests/
git commit -m "feat: add Position and Tag models with tests"
```

---

## Task 3: API views

**Files:**
- Create: `positions/urls.py`
- Modify: `positions/views.py`
- Modify: `positions/tests/test_views.py`

All views return/accept JSON. Use Django's `JsonResponse` and `json.loads`. No DRF.

- [ ] **Step 1: Write failing view tests**

Create `positions/tests/test_views.py`:

```python
import json
import pytest
from django.test import Client
from positions.models import Position, Tag


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


# --- GET /api/positions/ ---

@pytest.mark.django_db
def test_list_positions_empty(client):
    r = client.get('/api/positions/')
    assert r.status_code == 200
    assert json.loads(r.content) == []


@pytest.mark.django_db
def test_list_positions_returns_positions(client, position):
    r = client.get('/api/positions/')
    data = json.loads(r.content)
    assert len(data) == 1
    assert data[0]['name'] == 'Starting Position'
    assert data[0]['fen'] == 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    assert data[0]['tags'] == []


@pytest.mark.django_db
def test_list_positions_tag_filter_or_logic(client):
    t1 = Tag.objects.create(name='opening')
    t2 = Tag.objects.create(name='endgame')
    t3 = Tag.objects.create(name='tactics')
    p1 = Position.objects.create(name='P1', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    p2 = Position.objects.create(name='P2', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    p3 = Position.objects.create(name='P3', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    p1.tags.add(t1)
    p2.tags.add(t2)
    p3.tags.add(t3)
    r = client.get('/api/positions/?tag=opening&tag=endgame')
    data = json.loads(r.content)
    names = {d['name'] for d in data}
    assert names == {'P1', 'P2'}


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


# --- GET /api/tags/ ---

@pytest.mark.django_db
def test_list_tags(client, tag):
    r = client.get('/api/tags/')
    assert r.status_code == 200
    data = json.loads(r.content)
    assert any(t['name'] == 'opening' for t in data)
```

- [ ] **Step 2: Run to confirm failure**

```bash
pytest positions/tests/test_views.py -v
```

Expected: All FAIL (no views/urls yet).

- [ ] **Step 3: Create `positions/urls.py`**

```python
from django.urls import path
from . import views

urlpatterns = [
    path('positions/', views.positions_list, name='positions-list'),
    path('positions/<int:pk>/', views.positions_detail, name='positions-detail'),
    path('tags/', views.tags_list, name='tags-list'),
]
```

- [ ] **Step 4: Write `positions/views.py`**

```python
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
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


@csrf_exempt
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


@csrf_exempt
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
    return JsonResponse({}, status=204)


@require_http_methods(['GET'])
def tags_list(request):
    tags = Tag.objects.all().values('id', 'name')
    return JsonResponse(list(tags), safe=False)
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
pytest positions/tests/test_views.py -v
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add positions/views.py positions/urls.py positions/tests/test_views.py
git commit -m "feat: add position and tag API views with tests"
```

---

## Task 4: App shell template + django-vite wiring

**Files:**
- Create: `templates/index.html`

- [ ] **Step 1: Create `templates/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chessterfield</title>
  {% load django_vite %}
  {% vite_asset 'src/main.js' %}
</head>
<body>
  <div id="app"></div>
</body>
</html>
```

- [ ] **Step 2: Verify the Django template view works**

Start Django and Vite dev server (two terminals):

```bash
# Terminal 1
source venv/bin/activate
python manage.py runserver

# Terminal 2 (after frontend is set up in Task 5)
cd frontend && npm run dev
```

For now, just verify Django serves 200 at `http://localhost:8000/` (the template will 500 until Vite is running — that's expected).

- [ ] **Step 3: Commit**

```bash
git add templates/
git commit -m "feat: add app shell template with django-vite wiring"
```

---

## Task 5: Frontend scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/src/main.js`
- Create: `frontend/src/style.css`
- Create: `frontend/.gitignore`

- [ ] **Step 1: Create `frontend/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 2: Create `frontend/package.json`**

```json
{
  "name": "chessterfield-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "chess.js": "^1.3.0",
    "chessground": "^9.1.1",
    "stockfish": "^16.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 3: Create `frontend/vite.config.js`**

```js
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: '/static/',
  build: {
    manifest: true,
    outDir: 'dist',
    rollupOptions: {
      input: '/src/main.js',
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    // Headers required for Stockfish WASM SharedArrayBuffer
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['stockfish'],
  },
})
```

- [ ] **Step 4: Create `frontend/src/style.css`** (skeleton — fleshed out in later tasks)

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  height: 100vh;
  overflow: hidden;
}

#app { height: 100vh; display: flex; flex-direction: column; }
```

- [ ] **Step 5: Create `frontend/src/main.js`** (minimal — just prove it loads)

```js
import './style.css'

document.getElementById('app').textContent = 'Chessterfield loading...'
```

- [ ] **Step 6: Install dependencies**

```bash
cd frontend && npm install
```

- [ ] **Step 7: Run Vite dev server and verify it starts**

```bash
cd frontend && npm run dev
```

Expected: `Local: http://localhost:5173/` — no errors.

Visit `http://localhost:8000/` with both servers running — page should load with "Chessterfield loading...".

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold Vite frontend with chess.js, chessground, stockfish"
```

---

## Task 6: Pure helper modules + tests

**Files:**
- Create: `frontend/src/chess/eval.js`
- Create: `frontend/src/chess/miniboard.js`
- Create: `frontend/src/tests/eval.test.js`
- Create: `frontend/src/tests/miniboard.test.js`

These are pure functions — easiest to write test-first.

- [ ] **Step 1: Write failing eval tests**

Create `frontend/src/tests/eval.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { parseStockfishLine, cpToPercent } from '../chess/eval.js'

describe('parseStockfishLine', () => {
  it('parses centipawn score', () => {
    const line = 'info depth 20 seldepth 25 multipv 1 score cp 45 nodes 123456 time 500 pv e2e4'
    expect(parseStockfishLine(line)).toEqual({ cp: 45, mate: null, depth: 20 })
  })

  it('parses negative centipawn score', () => {
    const line = 'info depth 15 score cp -130 nodes 1000 time 200 pv d7d5'
    expect(parseStockfishLine(line)).toEqual({ cp: -130, mate: null, depth: 15 })
  })

  it('parses mate score for White', () => {
    const line = 'info depth 5 score mate 3 nodes 500 time 50 pv e2e4'
    expect(parseStockfishLine(line)).toEqual({ cp: null, mate: 3, depth: 5 })
  })

  it('parses mate score for Black', () => {
    const line = 'info depth 5 score mate -2 nodes 500 time 50 pv d7d5'
    expect(parseStockfishLine(line)).toEqual({ cp: null, mate: -2, depth: 5 })
  })

  it('returns null for non-info lines', () => {
    expect(parseStockfishLine('bestmove e2e4')).toBeNull()
    expect(parseStockfishLine('uciok')).toBeNull()
  })

  it('returns null for info lines without score', () => {
    expect(parseStockfishLine('info depth 1 nodes 100')).toBeNull()
  })
})

describe('cpToPercent', () => {
  it('maps 0 cp to 50%', () => expect(cpToPercent(0)).toBe(50))
  it('maps +1000 cp to 100%', () => expect(cpToPercent(1000)).toBe(100))
  it('maps -1000 cp to 0%', () => expect(cpToPercent(-1000)).toBe(0))
  it('clamps above +1000', () => expect(cpToPercent(2000)).toBe(100))
  it('clamps below -1000', () => expect(cpToPercent(-2000)).toBe(0))
  it('maps +500 cp to 75%', () => expect(cpToPercent(500)).toBe(75))
  it('maps -500 cp to 25%', () => expect(cpToPercent(-500)).toBe(25))
})
```

- [ ] **Step 2: Write failing miniboard tests**

Create `frontend/src/tests/miniboard.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { fenToMiniBoard } from '../chess/miniboard.js'

describe('fenToMiniBoard', () => {
  it('returns an 8x8 grid string for starting position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    const html = fenToMiniBoard(fen)
    // Should have 64 cells
    expect((html.match(/class="cell/g) || []).length).toBe(64)
    // Should have all 32 pieces (16 per side)
    expect((html.match(/class="piece/g) || []).length).toBe(32)
  })

  it('shows white king symbol in starting position', () => {
    const html = fenToMiniBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(html).toContain('♔') // white king
  })

  it('shows black queen symbol in starting position', () => {
    const html = fenToMiniBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(html).toContain('♛') // black queen
  })

  it('handles empty board (only kings)', () => {
    const html = fenToMiniBoard('8/8/8/8/8/8/8/4K3 w - - 0 1')
    expect((html.match(/class="piece/g) || []).length).toBe(1)
  })
})
```

- [ ] **Step 3: Run to confirm failure**

```bash
cd frontend && npm test
```

Expected: FAIL — modules don't exist yet.

- [ ] **Step 4: Create `frontend/src/chess/eval.js`**

```js
/**
 * Parse a Stockfish UCI output line into { cp, mate, depth } or null.
 * cp: centipawns (positive = White advantage)
 * mate: moves to mate (positive = White mates, negative = Black mates)
 */
export function parseStockfishLine(line) {
  if (!line.startsWith('info')) return null

  const depthMatch = line.match(/\bdepth\s+(\d+)/)
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/)
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/)

  if (!depthMatch || (!cpMatch && !mateMatch)) return null

  return {
    cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
    mate: mateMatch ? parseInt(mateMatch[1], 10) : null,
    depth: parseInt(depthMatch[1], 10),
  }
}

/**
 * Map centipawn score to a 0–100 percentage for the eval bar.
 * 50 = equal, 100 = White winning, 0 = Black winning.
 */
export function cpToPercent(cp) {
  const clamped = Math.max(-1000, Math.min(1000, cp))
  return 50 + (clamped / 1000) * 50
}
```

- [ ] **Step 5: Create `frontend/src/chess/miniboard.js`**

```js
const WHITE_PIECES = { P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔' }
const BLACK_PIECES = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' }
const ALL_PIECES = { ...WHITE_PIECES, ...BLACK_PIECES }

/**
 * Convert FEN position string to a minimal 8×8 HTML grid string.
 * Returns an HTML string suitable for innerHTML.
 */
export function fenToMiniBoard(fen) {
  const positionPart = fen.split(' ')[0]
  const rows = positionPart.split('/')

  let html = '<div class="miniboard">'
  for (const row of rows) {
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) {
          html += '<span class="cell"></span>'
        }
      } else {
        const symbol = ALL_PIECES[ch] ?? ''
        const color = ch === ch.toUpperCase() ? 'white' : 'black'
        html += `<span class="cell">${symbol ? `<span class="piece ${color}">${symbol}</span>` : ''}</span>`
      }
    }
  }
  html += '</div>'
  return html
}
```

- [ ] **Step 6: Run tests to confirm pass**

```bash
cd frontend && npm test
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/chess/ frontend/src/tests/
git commit -m "feat: add eval parser and miniboard helper with tests"
```

---

## Task 7: Frontend state machine (main.js)

**Files:**
- Modify: `frontend/src/main.js`
- Create: `frontend/src/views/library.js` (stub)
- Create: `frontend/src/views/import.js` (stub)
- Create: `frontend/src/views/play.js` (stub)

- [ ] **Step 1: Create view stubs**

`frontend/src/views/library.js`:
```js
export function mountLibrary(app, navigate) {
  app.innerHTML = '<h1>Library</h1><button id="go-import">Import Position</button>'
  app.querySelector('#go-import').addEventListener('click', () => navigate('import'))
}
```

`frontend/src/views/import.js`:
```js
export function mountImport(app, navigate) {
  app.innerHTML = '<h1>Import</h1><button id="go-library">Back</button>'
  app.querySelector('#go-library').addEventListener('click', () => navigate('library'))
}
```

`frontend/src/views/play.js`:
```js
export function mountPlay(app, navigate, positionId) {
  app.innerHTML = `<h1>Play #${positionId}</h1><button id="go-library">Back</button>`
  app.querySelector('#go-library').addEventListener('click', () => navigate('library'))
}
```

- [ ] **Step 2: Write `frontend/src/main.js` state machine**

```js
import './style.css'
import { mountLibrary } from './views/library.js'
import { mountImport } from './views/import.js'
import { mountPlay } from './views/play.js'

const app = document.getElementById('app')

// State: { view: 'library'|'import'|'play', positionId: number|null }
let state = { view: 'library', positionId: null }

function navigate(view, positionId = null) {
  state = { view, positionId }
  render()
}

function render() {
  switch (state.view) {
    case 'library':
      mountLibrary(app, navigate)
      break
    case 'import':
      mountImport(app, navigate)
      break
    case 'play':
      mountPlay(app, navigate, state.positionId)
      break
    default:
      mountLibrary(app, navigate)
  }
}

render()
```

- [ ] **Step 3: Verify navigation works in browser**

With both `npm run dev` and `python manage.py runserver` running, visit `http://localhost:8000/`. Clicking "Import Position" should show the Import view, "Back" returns to Library.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.js frontend/src/views/
git commit -m "feat: add JS state machine with view routing"
```

---

## Task 8: Library view

**Files:**
- Modify: `frontend/src/views/library.js`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Replace library.js stub with full implementation**

```js
import { fenToMiniBoard } from '../chess/miniboard.js'

export async function mountLibrary(app, navigate) {
  app.innerHTML = `
    <div class="library-layout">
      <aside class="sidebar" id="tag-sidebar">
        <h2>Tags</h2>
        <div id="tag-list">Loading...</div>
      </aside>
      <main class="library-main">
        <div class="library-header">
          <h1>Positions</h1>
          <button id="go-import" class="btn-primary">+ Import Position</button>
        </div>
        <div id="position-grid">Loading...</div>
      </main>
    </div>
  `

  app.querySelector('#go-import').addEventListener('click', () => navigate('import'))

  let allTags = []
  let selectedTags = new Set()

  async function loadTags() {
    try {
      const r = await fetch('/api/tags/')
      allTags = await r.json()
      renderTags()
    } catch {
      showToast('Failed to load tags')
    }
  }

  function renderTags() {
    const container = app.querySelector('#tag-list')
    if (allTags.length === 0) {
      container.innerHTML = '<p class="muted">No tags yet</p>'
      return
    }
    container.innerHTML = allTags.map(t => `
      <label class="tag-filter ${selectedTags.has(t.name) ? 'active' : ''}">
        <input type="checkbox" value="${t.name}" ${selectedTags.has(t.name) ? 'checked' : ''}>
        ${t.name}
      </label>
    `).join('')

    container.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedTags.add(cb.value)
        else selectedTags.delete(cb.value)
        loadPositions()
      })
    })
  }

  async function loadPositions() {
    const grid = app.querySelector('#position-grid')
    grid.innerHTML = '<p>Loading...</p>'
    try {
      const params = [...selectedTags].map(t => `tag=${encodeURIComponent(t)}`).join('&')
      const url = '/api/positions/' + (params ? `?${params}` : '')
      const r = await fetch(url)
      const positions = await r.json()
      renderPositions(positions)
    } catch {
      showToast('Failed to load positions')
    }
  }

  function renderPositions(positions) {
    const grid = app.querySelector('#position-grid')
    if (positions.length === 0) {
      grid.innerHTML = '<p class="muted">No positions yet. Import one!</p>'
      return
    }
    grid.innerHTML = positions.map(p => `
      <div class="position-card">
        <div class="position-miniboard">${fenToMiniBoard(p.fen)}</div>
        <div class="position-info">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="tags">${p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        </div>
        <button class="btn-primary play-btn" data-id="${p.id}">Play</button>
      </div>
    `).join('')

    grid.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate('play', parseInt(btn.dataset.id)))
    })
  }

  await Promise.all([loadTags(), loadPositions()])
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}
```

- [ ] **Step 2: Add Library + shared styles to `style.css`**

Append to `frontend/src/style.css`:

```css
/* Layout */
.library-layout {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 200px;
  min-width: 160px;
  background: #16213e;
  padding: 1rem;
  overflow-y: auto;
  border-right: 1px solid #0f3460;
}

.sidebar h2 { font-size: 0.85rem; text-transform: uppercase; color: #888; margin-bottom: 0.75rem; }

.library-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #0f3460;
}

/* Position grid */
#position-grid {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  align-content: start;
}

.position-card {
  background: #16213e;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid #0f3460;
}

.position-miniboard { padding: 0.5rem; background: #0f3460; }
.position-info { padding: 0.5rem 0.75rem; flex: 1; }
.position-info h3 { font-size: 0.9rem; margin-bottom: 0.25rem; }

/* Mini board */
.miniboard {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  aspect-ratio: 1;
  width: 100%;
}

.miniboard .cell {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9em;
}

.miniboard .cell:nth-child(odd) { background: #b58863; }
.miniboard .cell:nth-child(even) { background: #f0d9b5; }

/* Adjust checkerboard for alternating rows */
.miniboard .cell.dark { background: #b58863; }
.miniboard .cell.light { background: #f0d9b5; }

.miniboard .piece.white { color: #fff; text-shadow: 0 0 1px #000; }
.miniboard .piece.black { color: #1a1a2e; }

/* Tags */
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.tag { background: #0f3460; color: #90caf9; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; }

.tag-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  cursor: pointer;
  font-size: 0.85rem;
}
.tag-filter.active { color: #90caf9; }
.tag-filter input { cursor: pointer; }

/* Buttons */
.btn-primary {
  background: #e94560;
  color: #fff;
  border: none;
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn-primary:hover { background: #c73652; }

.btn-secondary {
  background: #0f3460;
  color: #e0e0e0;
  border: 1px solid #1a5276;
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn-secondary:hover { background: #1a5276; }

.play-btn { margin: 0.5rem; }
.muted { color: #666; font-size: 0.9rem; padding: 1rem 0; }

/* Toast */
.toast {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  background: #e94560;
  color: #fff;
  padding: 0.75rem 1.25rem;
  border-radius: 8px;
  z-index: 999;
  animation: fadein 0.2s ease;
}

@keyframes fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; } }
```

- [ ] **Step 3: Fix miniboard checkerboard**

The current miniboard doesn't account for alternating rows. Update `miniboard.js` to add light/dark classes:

```js
// Replace the fenToMiniBoard function:
export function fenToMiniBoard(fen) {
  const positionPart = fen.split(' ')[0]
  const rows = positionPart.split('/')

  let html = '<div class="miniboard">'
  rows.forEach((row, rankIdx) => {
    let fileIdx = 0
    for (const ch of row) {
      if (/\d/.test(ch)) {
        const count = parseInt(ch, 10)
        for (let i = 0; i < count; i++) {
          const shade = (rankIdx + fileIdx) % 2 === 0 ? 'light' : 'dark'
          html += `<span class="cell ${shade}"></span>`
          fileIdx++
        }
      } else {
        const shade = (rankIdx + fileIdx) % 2 === 0 ? 'light' : 'dark'
        const symbol = ALL_PIECES[ch] ?? ''
        const color = ch === ch.toUpperCase() ? 'white' : 'black'
        html += `<span class="cell ${shade}">${symbol ? `<span class="piece ${color}">${symbol}</span>` : ''}</span>`
        fileIdx++
      }
    }
  })
  html += '</div>'
  return html
}
```

Update the miniboard tests to check for `class="cell light"` and `class="cell dark"` instead of just `class="cell`:

```js
// In miniboard.test.js, update the count check:
expect((html.match(/class="cell (light|dark)"/g) || []).length).toBe(64)
```

- [ ] **Step 4: Run Vitest**

```bash
cd frontend && npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Manual test in browser**

Import a test position via Django admin or direct API call:

```bash
curl -X POST http://localhost:8000/api/positions/ \
  -H 'Content-Type: application/json' \
  -d '{"name":"Starting Position","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","notes":"","tags":["opening"]}'
```

Visit `http://localhost:8000/` — position card should appear with miniboard.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/library.js frontend/src/style.css frontend/src/chess/miniboard.js frontend/src/tests/
git commit -m "feat: implement Library view with tag filter and miniboard thumbnails"
```

---

## Task 9: Import view

**Files:**
- Modify: `frontend/src/views/import.js`

- [ ] **Step 1: Replace import.js stub with full implementation**

```js
import { Chess } from 'chess.js'

export async function mountImport(app, navigate) {
  app.innerHTML = `
    <div class="import-layout">
      <div class="import-card">
        <div class="import-header">
          <button id="go-back" class="btn-secondary">← Library</button>
          <h1>Import Position</h1>
        </div>
        <form id="import-form">
          <label>
            FEN *
            <input type="text" id="fen-input" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" autocomplete="off">
            <span class="field-error" id="fen-error"></span>
          </label>
          <label>
            Name *
            <input type="text" id="name-input" placeholder="e.g. Sicilian Najdorf">
            <span class="field-error" id="name-error"></span>
          </label>
          <label>
            Notes
            <textarea id="notes-input" rows="3" placeholder="Optional notes about this position"></textarea>
          </label>
          <label>
            Tags
            <div class="tag-input-area">
              <input type="text" id="tag-input" placeholder="Type tag and press Enter">
              <div id="tag-suggestions" class="tag-suggestions"></div>
            </div>
            <div id="selected-tags" class="selected-tags"></div>
          </label>
          <div class="form-actions">
            <button type="submit" class="btn-primary">Save Position</button>
          </div>
        </form>
      </div>
    </div>
  `

  app.querySelector('#go-back').addEventListener('click', () => navigate('library'))

  // Tag picker
  let existingTags = []
  let selectedTags = new Set()

  try {
    const r = await fetch('/api/tags/')
    existingTags = (await r.json()).map(t => t.name)
  } catch {
    // tag suggestions won't work, that's fine
  }

  const tagInput = app.querySelector('#tag-input')
  const suggestionsEl = app.querySelector('#tag-suggestions')
  const selectedTagsEl = app.querySelector('#selected-tags')

  function renderSelectedTags() {
    selectedTagsEl.innerHTML = [...selectedTags].map(t =>
      `<span class="tag-chip">${escapeHtml(t)} <button class="remove-tag" data-tag="${escapeHtml(t)}">×</button></span>`
    ).join('')
    selectedTagsEl.querySelectorAll('.remove-tag').forEach(btn => {
      btn.addEventListener('click', () => { selectedTags.delete(btn.dataset.tag); renderSelectedTags() })
    })
  }

  function addTag(name) {
    const trimmed = name.trim().toLowerCase()
    if (trimmed) { selectedTags.add(trimmed); renderSelectedTags() }
    tagInput.value = ''
    suggestionsEl.innerHTML = ''
  }

  tagInput.addEventListener('input', () => {
    const val = tagInput.value.trim().toLowerCase()
    if (!val) { suggestionsEl.innerHTML = ''; return }
    const matches = existingTags.filter(t => t.includes(val) && !selectedTags.has(t))
    suggestionsEl.innerHTML = matches.slice(0, 6).map(t =>
      `<div class="suggestion" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</div>`
    ).join('')
    suggestionsEl.querySelectorAll('.suggestion').forEach(el => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); addTag(el.dataset.tag) })
    })
  })

  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput.value) }
  })

  // FEN validation
  const fenInput = app.querySelector('#fen-input')
  const fenError = app.querySelector('#fen-error')

  function validateFen(fen) {
    try {
      new Chess(fen)
      fenError.textContent = ''
      return true
    } catch {
      fenError.textContent = 'Invalid FEN string'
      return false
    }
  }

  fenInput.addEventListener('blur', () => { if (fenInput.value) validateFen(fenInput.value) })

  // Form submit
  app.querySelector('#import-form').addEventListener('submit', async (e) => {
    e.preventDefault()

    const fen = fenInput.value.trim()
    const name = app.querySelector('#name-input').value.trim()
    const nameError = app.querySelector('#name-error')

    let valid = true
    if (!fen || !validateFen(fen)) valid = false
    if (!name) { nameError.textContent = 'Name is required'; valid = false } else { nameError.textContent = '' }
    if (!valid) return

    try {
      const r = await fetch('/api/positions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          fen,
          notes: app.querySelector('#notes-input').value,
          tags: [...selectedTags],
        }),
      })
      if (!r.ok) throw new Error('Save failed')
      navigate('library')
    } catch {
      showToast('Failed to save position')
    }
  })
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}
```

- [ ] **Step 2: Add Import styles to `style.css`**

Append:

```css
/* Import view */
.import-layout {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 2rem;
  overflow-y: auto;
  height: 100vh;
}

.import-card {
  background: #16213e;
  border-radius: 10px;
  padding: 2rem;
  width: 100%;
  max-width: 560px;
  border: 1px solid #0f3460;
}

.import-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.import-header h1 { font-size: 1.3rem; }

#import-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: #aaa;
}

#import-form input,
#import-form textarea {
  background: #0f3460;
  border: 1px solid #1a5276;
  color: #e0e0e0;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.95rem;
  width: 100%;
}

#import-form input:focus,
#import-form textarea:focus {
  outline: none;
  border-color: #e94560;
}

.field-error { color: #e94560; font-size: 0.8rem; min-height: 1em; }

.tag-input-area { position: relative; }

.tag-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #0f3460;
  border: 1px solid #1a5276;
  border-radius: 0 0 6px 6px;
  z-index: 10;
}

.suggestion { padding: 6px 12px; cursor: pointer; font-size: 0.9rem; }
.suggestion:hover { background: #1a5276; }

.selected-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }

.tag-chip {
  background: #0f3460;
  color: #90caf9;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 4px;
}

.remove-tag {
  background: none;
  border: none;
  color: #90caf9;
  cursor: pointer;
  padding: 0;
  font-size: 1rem;
  line-height: 1;
}

.form-actions { margin-top: 1.5rem; }
```

- [ ] **Step 3: Manual test in browser**

Visit `http://localhost:8000/`, click Import Position. Try:
- Enter an invalid FEN → should show error on blur
- Enter a valid FEN, fill in name and tags → Save → should redirect to Library and show the new card

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/import.js frontend/src/style.css
git commit -m "feat: implement Import view with FEN validation and tag picker"
```

---

## Task 10: Stockfish Web Worker

**Files:**
- Create: `frontend/src/chess/worker.js`

The worker wraps the stockfish npm package and communicates via message-passing.

- [ ] **Step 1: Create `frontend/src/chess/worker.js`**

```js
// This file runs as a Web Worker.
// It wraps the Stockfish engine and exposes a simple message protocol.
//
// Incoming messages (from main thread):
//   { type: 'cmd', cmd: '<uci command string>' }
//
// Outgoing messages (to main thread):
//   { type: 'output', line: '<stockfish output line>' }
//   { type: 'ready' }
//   { type: 'error', message: '<error string>' }

let engine = null

async function init() {
  try {
    // stockfish npm package: import the factory function
    // The package provides a WASM-backed engine via an emscripten module
    const { default: Stockfish } = await import('stockfish/src/stockfish-nnue-16-single.js')
    engine = await Stockfish()
    engine.addMessageListener((line) => {
      self.postMessage({ type: 'output', line })
    })
    engine.postMessage('uci')
    // Wait for uciok then signal ready
    // (uciok arrives via the message listener above; caller can watch for 'uciok' in output)
    self.postMessage({ type: 'ready' })
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message })
  }
}

self.onmessage = (e) => {
  const { type, cmd } = e.data
  if (type === 'cmd' && engine) {
    engine.postMessage(cmd)
  }
}

init()
```

**Note on stockfish package:** The exact import path depends on the installed version. Check `node_modules/stockfish/src/` after `npm install` and use the single-threaded file (name contains `single`). If the path differs, update the import. The multi-threaded build requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers from Django in production (add middleware if needed).

- [ ] **Step 2: Verify the worker can be imported in play.js (smoke test)**

In `frontend/src/views/play.js` (the stub), temporarily add:

```js
// Temporary smoke test — remove after verifying
const worker = new Worker(new URL('../chess/worker.js', import.meta.url), { type: 'module' })
worker.onmessage = (e) => console.log('Worker msg:', e.data)
worker.postMessage({ type: 'cmd', cmd: 'uci' })
```

Open browser console at `http://localhost:8000/play` (navigate there) — should see `Worker msg: { type: 'ready' }` and UCI lines.

Remove the smoke test code after verifying.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/chess/worker.js
git commit -m "feat: add Stockfish Web Worker with UCI message protocol"
```

---

## Task 11: Play view

**Files:**
- Modify: `frontend/src/views/play.js`
- Modify: `frontend/src/style.css`

This is the largest task. The Play view wires together: Chessground, chess.js, and the Stockfish worker.

- [ ] **Step 1: Replace play.js stub with full implementation**

```js
import { Chess } from 'chess.js'
import { Chessground } from 'chessground'
import { parseStockfishLine, cpToPercent } from '../chess/eval.js'

// Import Chessground CSS (Vite handles this)
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

export async function mountPlay(app, navigate, positionId) {
  // --- Fetch position data ---
  let position
  try {
    const r = await fetch(`/api/positions/${positionId}/`)
    if (!r.ok) throw new Error('Not found')
    position = await r.json()
  } catch {
    app.innerHTML = '<p class="muted" style="padding:2rem">Position not found. <button id="back" class="btn-secondary">Back</button></p>'
    app.querySelector('#back').addEventListener('click', () => navigate('library'))
    return
  }

  // --- Render layout ---
  app.innerHTML = `
    <div class="play-layout">
      <aside class="sidebar play-sidebar-left">
        <div class="pos-info">
          <h2>${escapeHtml(position.name)}</h2>
          <div class="tags">${position.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          <p class="fen-display">${escapeHtml(position.fen)}</p>
        </div>
        <div class="side-selector">
          <p>Play as</p>
          <div class="side-buttons">
            <button class="side-btn active" data-side="white">White</button>
            <button class="side-btn" data-side="black">Black</button>
          </div>
        </div>
        <div class="play-controls">
          <button id="resign-btn" class="btn-secondary">Resign</button>
          <button id="back-btn" class="btn-secondary">← Library</button>
        </div>
        <div id="engine-banner" class="engine-banner hidden">Engine unavailable — analysis disabled</div>
      </aside>

      <main class="play-main">
        <div id="board-wrap">
          <div id="board"></div>
        </div>
      </main>

      <aside class="sidebar play-sidebar-right">
        <div class="eval-bar-wrap">
          <div class="eval-label" id="eval-white-label"></div>
          <div class="eval-bar-outer">
            <div class="eval-bar-fill" id="eval-fill" style="height:50%"></div>
          </div>
          <div class="eval-label" id="eval-black-label"></div>
        </div>
        <div class="engine-info">
          <span id="engine-depth">depth —</span>
          <span id="engine-score">—</span>
        </div>
        <div class="move-history-wrap">
          <h3>Moves</h3>
          <ol id="move-history" class="move-history"></ol>
        </div>
      </aside>
    </div>

    <div class="result-overlay hidden" id="result-overlay">
      <div class="result-card">
        <h2 id="result-text"></h2>
        <button id="play-again-btn" class="btn-primary">Play Again</button>
        <button id="back-to-library-btn" class="btn-secondary">Back to Library</button>
      </div>
    </div>
  `

  // --- State ---
  let userColor = 'white'
  let chess = new Chess(position.fen)
  let cg = null
  let worker = null
  let workerReady = false
  let gameOver = false

  // --- Worker setup ---
  try {
    worker = new Worker(new URL('../chess/worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = handleWorkerMessage
    worker.onerror = () => {
      app.querySelector('#engine-banner').classList.remove('hidden')
      workerReady = false
    }
  } catch {
    app.querySelector('#engine-banner').classList.remove('hidden')
  }

  function sendToEngine(cmd) {
    if (worker && workerReady) worker.postMessage({ type: 'cmd', cmd })
  }

  function handleWorkerMessage(e) {
    const { type, line } = e.data
    if (type === 'ready') { workerReady = true; return }
    if (type === 'error') { app.querySelector('#engine-banner').classList.remove('hidden'); return }
    if (type !== 'output') return

    // Parse eval info
    const parsed = parseStockfishLine(line)
    if (parsed) updateEvalBar(parsed)

    // Engine move
    if (line.startsWith('bestmove') && !gameOver) {
      const match = line.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/)
      if (match) applyEngineMove(match[1])
    }
  }

  // --- Eval bar ---
  function updateEvalBar({ cp, mate, depth }) {
    const fill = app.querySelector('#eval-fill')
    const depthEl = app.querySelector('#engine-depth')
    const scoreEl = app.querySelector('#engine-score')
    const whiteLabel = app.querySelector('#eval-white-label')
    const blackLabel = app.querySelector('#eval-black-label')

    depthEl.textContent = `depth ${depth}`

    if (mate !== null) {
      const percent = mate > 0 ? 100 : 0
      fill.style.height = percent + '%'
      const label = `M${Math.abs(mate)}`
      scoreEl.textContent = mate > 0 ? `+${label}` : `-${label}`
      whiteLabel.textContent = mate > 0 ? label : ''
      blackLabel.textContent = mate < 0 ? label : ''
    } else if (cp !== null) {
      const percent = cpToPercent(cp)
      fill.style.height = percent + '%'
      const display = cp > 0 ? `+${(cp / 100).toFixed(1)}` : (cp / 100).toFixed(1)
      scoreEl.textContent = display
      whiteLabel.textContent = cp > 0 ? display : ''
      blackLabel.textContent = cp < 0 ? display : ''
    }
  }

  // --- Move history ---
  const moveHistory = []

  function updateMoveHistory() {
    const ol = app.querySelector('#move-history')
    const history = chess.history()
    ol.innerHTML = ''
    for (let i = 0; i < history.length; i += 2) {
      const li = document.createElement('li')
      li.textContent = `${history[i] ?? ''} ${history[i + 1] ?? ''}`
      ol.appendChild(li)
    }
    ol.scrollTop = ol.scrollHeight
  }

  // --- Game-end detection ---
  function checkGameEnd() {
    if (chess.isCheckmate()) return chess.turn() === 'w' ? 'Checkmate — Engine wins' : 'Checkmate — You win!'
    if (chess.isStalemate()) return 'Stalemate — Draw'
    if (chess.isInsufficientMaterial()) return 'Insufficient Material — Draw'
    if (chess.isThreefoldRepetition()) return 'Threefold Repetition — Draw'
    if (chess.isDrawByFiftyMoves ? chess.isDrawByFiftyMoves() : false) return 'Fifty-Move Rule — Draw'
    return null
  }

  function showResult(text) {
    gameOver = true
    sendToEngine('stop')
    const overlay = app.querySelector('#result-overlay')
    app.querySelector('#result-text').textContent = text
    overlay.classList.remove('hidden')
  }

  // --- Chessground helpers ---
  function toDests(ch) {
    const dests = new Map()
    ch.moves({ verbose: true }).forEach(m => {
      if (!dests.has(m.from)) dests.set(m.from, [])
      dests.get(m.from).push(m.to)
    })
    return dests
  }

  function isUserTurn() {
    const turn = chess.turn() // 'w' or 'b'
    return (turn === 'w' && userColor === 'white') || (turn === 'b' && userColor === 'black')
  }

  // --- Apply engine move ---
  function applyEngineMove(uciMove) {
    if (gameOver) return
    const from = uciMove.slice(0, 2)
    const to = uciMove.slice(2, 4)
    const promotion = uciMove[4] ?? undefined

    chess.move({ from, to, promotion })
    updateMoveHistory()

    cg.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable: {
        color: userColor,
        dests: isUserTurn() ? toDests(chess) : new Map(),
      },
      lastMove: [from, to],
    })

    const result = checkGameEnd()
    if (result) { showResult(result); return }

    // After engine moves, it's user's turn — start eval for user's position
    if (workerReady) {
      sendToEngine(`position fen ${chess.fen()}`)
      sendToEngine('go depth 20')
    }
  }

  // --- Chessground init ---
  function initBoard() {
    const boardEl = app.querySelector('#board')
    const orientation = userColor

    cg = Chessground(boardEl, {
      fen: chess.fen(),
      orientation,
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable: {
        free: false,
        color: userColor,
        dests: isUserTurn() ? toDests(chess) : new Map(),
        events: {
          after(orig, dest) {
            // Promotion: always promote to queen for simplicity
            const move = chess.move({ from: orig, to: dest, promotion: 'q' })
            if (!move) return

            updateMoveHistory()
            cg.set({
              fen: chess.fen(),
              turnColor: chess.turn() === 'w' ? 'white' : 'black',
              movable: { color: userColor, dests: new Map() }, // disable while engine thinks
            })

            const result = checkGameEnd()
            if (result) { showResult(result); return }

            // Trigger engine
            if (workerReady) {
              sendToEngine('stop')
              sendToEngine(`position fen ${chess.fen()}`)
              sendToEngine('go depth 20')
            }
          },
        },
      },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 },
    })
  }

  // --- Engine first move (when engine goes first) ---
  function engineGoFirst() {
    if (workerReady) {
      sendToEngine(`position fen ${chess.fen()}`)
      sendToEngine('go depth 20')
    } else {
      // Worker not ready yet — wait for ready message then trigger
      const originalHandler = worker.onmessage
      worker.onmessage = (e) => {
        originalHandler(e)
        if (e.data.type === 'ready') {
          sendToEngine(`position fen ${chess.fen()}`)
          sendToEngine('go depth 20')
          worker.onmessage = originalHandler
        }
      }
    }
  }

  // --- Side selector ---
  app.querySelectorAll('.side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      app.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      userColor = btn.dataset.side
      startGame()
    })
  })

  // --- Resign ---
  app.querySelector('#resign-btn').addEventListener('click', () => {
    if (!gameOver) showResult('You resigned — Engine wins')
  })

  app.querySelector('#back-btn').addEventListener('click', () => navigate('library'))

  // --- Result overlay buttons ---
  app.querySelector('#play-again-btn').addEventListener('click', () => {
    app.querySelector('#result-overlay').classList.add('hidden')
    startGame()
  })
  app.querySelector('#back-to-library-btn').addEventListener('click', () => navigate('library'))

  // --- Start / restart game ---
  function startGame() {
    gameOver = false
    chess = new Chess(position.fen)
    updateMoveHistory()
    app.querySelector('#eval-fill').style.height = '50%'
    app.querySelector('#engine-depth').textContent = 'depth —'
    app.querySelector('#engine-score').textContent = '—'
    app.querySelector('#eval-white-label').textContent = ''
    app.querySelector('#eval-black-label').textContent = ''

    if (cg) cg.destroy()
    initBoard()

    sendToEngine('ucinewgame')

    const fenTurn = chess.turn() // 'w' or 'b'
    const engineGoesFirst = (fenTurn === 'w' && userColor === 'black') ||
                            (fenTurn === 'b' && userColor === 'white')

    if (engineGoesFirst) {
      // Disable board until engine responds
      cg.set({ movable: { color: userColor, dests: new Map() } })
      engineGoFirst()
    }
  }

  startGame()
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
```

- [ ] **Step 2: Add Play view styles to `style.css`**

Append:

```css
/* Play view */
.play-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.play-sidebar-left {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  width: 220px;
  overflow-y: auto;
}

.play-sidebar-right {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 0.75rem;
  width: 160px;
  gap: 0.5rem;
}

.play-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  overflow: hidden;
}

#board-wrap {
  width: min(calc(100vh - 2rem), calc(100vw - 400px));
  height: min(calc(100vh - 2rem), calc(100vw - 400px));
}

#board {
  width: 100%;
  height: 100%;
}

/* Position info */
.pos-info h2 { font-size: 1rem; margin-bottom: 4px; }
.fen-display {
  font-family: monospace;
  font-size: 0.65rem;
  color: #666;
  word-break: break-all;
  margin-top: 4px;
}

/* Side selector */
.side-selector p { font-size: 0.8rem; color: #aaa; margin-bottom: 4px; }
.side-buttons { display: flex; gap: 6px; }
.side-btn {
  flex: 1;
  background: #0f3460;
  border: 1px solid #1a5276;
  color: #e0e0e0;
  padding: 0.3rem 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.8rem;
}
.side-btn.active { background: #e94560; border-color: #e94560; color: #fff; }

/* Play controls */
.play-controls { display: flex; flex-direction: column; gap: 6px; }

/* Engine banner */
.engine-banner {
  background: #c0392b;
  color: #fff;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 0.75rem;
  text-align: center;
}
.engine-banner.hidden { display: none; }

/* Eval bar */
.eval-bar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
  width: 100%;
}

.eval-label {
  font-size: 0.7rem;
  color: #aaa;
  min-height: 1em;
  text-align: center;
}

.eval-bar-outer {
  flex: 1;
  width: 28px;
  background: #1a1a2e;
  border: 1px solid #0f3460;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.eval-bar-fill {
  width: 100%;
  background: #f0d9b5; /* White's colour */
  transition: height 0.3s ease;
}

.engine-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 0.7rem;
  color: #888;
}

/* Move history */
.move-history-wrap {
  width: 100%;
  overflow-y: auto;
  max-height: 200px;
}

.move-history-wrap h3 { font-size: 0.75rem; color: #aaa; margin-bottom: 4px; }

.move-history {
  list-style: none;
  font-size: 0.8rem;
  padding: 0;
}
.move-history li { padding: 2px 0; border-bottom: 1px solid #0f3460; }
.move-history li::before {
  counter-increment: move-counter;
  color: #666;
  margin-right: 4px;
}

/* Result overlay */
.result-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.result-overlay.hidden { display: none; }

.result-card {
  background: #16213e;
  border: 1px solid #0f3460;
  border-radius: 12px;
  padding: 2.5rem 3rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.result-card h2 { font-size: 1.4rem; }
```

- [ ] **Step 3: Verify Chessground CSS is loading**

The `import 'chessground/assets/...'` lines in play.js will try to import CSS via Vite. If there are path issues, check what's in `node_modules/chessground/assets/` and update imports to match exactly.

```bash
ls node_modules/chessground/assets/
```

Update the import paths in play.js to match the actual filenames present.

- [ ] **Step 4: Manual test**

1. Import a test position if none exist
2. Click Play on a position card
3. The board should render with pieces from the FEN
4. Try making a move — engine should respond
5. Eval bar should update
6. Try resigning — result overlay should appear
7. Click Play Again — game should restart

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/play.js frontend/src/style.css
git commit -m "feat: implement Play view with Chessground, Stockfish, eval bar, and game-end detection"
```

---

## Task 12: Production build wiring

**Files:**
- Modify: `chessterfield/settings.py` (add COOP/COEP middleware if needed)
- Create: `chessterfield/middleware.py` (COOP/COEP headers for WASM)

The Stockfish WASM build may require `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers in production. This is only needed for the multi-threaded build. If using the single-threaded build (`*-single.js`), skip the middleware.

- [ ] **Step 1: Check if COOP/COEP headers are needed**

In the browser console during play, check:

```js
crossOriginIsolated  // Should be true if multi-threaded Stockfish is used
```

If `false` and the engine still works (single-threaded build), skip to Step 4.

- [ ] **Step 2: Create `chessterfield/middleware.py`** (only if needed)

```python
class CrossOriginIsolationMiddleware:
    """Add COOP/COEP headers required for SharedArrayBuffer (Stockfish multi-threaded)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response['Cross-Origin-Opener-Policy'] = 'same-origin'
        response['Cross-Origin-Embedder-Policy'] = 'require-corp'
        return response
```

- [ ] **Step 3: Add middleware to settings** (only if needed)

```python
MIDDLEWARE = [
    'chessterfield.middleware.CrossOriginIsolationMiddleware',
    # ... existing middleware
]
```

- [ ] **Step 4: Test production build**

```bash
cd frontend && npm run build
```

Expected: `frontend/dist/` created with hashed assets and `.vite/manifest.json`.

In `chessterfield/settings.py`, temporarily set:

```python
DJANGO_VITE = {
    'default': {
        'dev_mode': False,
        'assets_path': BASE_DIR / 'frontend' / 'dist',
    }
}
```

Run Django without Vite dev server:

```bash
python manage.py runserver
```

Visit `http://localhost:8000/` — should load fully from built assets.

- [ ] **Step 5: Reset to dev mode**

Set `dev_mode: True` again for normal development.

- [ ] **Step 6: Add `.gitignore` at project root**

```
venv/
__pycache__/
*.pyc
db.sqlite3
staticfiles/
frontend/node_modules/
frontend/dist/
```

- [ ] **Step 7: Commit**

```bash
git add chessterfield/ .gitignore
git commit -m "feat: add production build wiring and COOP/COEP middleware"
```

---

## Running the App

**Development (two terminals):**
```bash
# Terminal 1
source venv/bin/activate && python manage.py runserver

# Terminal 2
cd frontend && npm run dev
```

Visit `http://localhost:8000/`

**Production (single terminal):**
```bash
cd frontend && npm run build && cd ..
# Set dev_mode: False in settings.py
source venv/bin/activate && python manage.py runserver
```

---

## Running Tests

```bash
# Django tests
source venv/bin/activate && pytest

# Frontend tests
cd frontend && npm test
```
