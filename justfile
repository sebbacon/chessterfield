set dotenv-load

# Show available commands
default:
    @just --list

# Set up development environment (Python venv + Node deps)
setup:
    uv venv
    uv pip install -r requirements.txt
    cd frontend && npm install
    .venv/bin/python manage.py migrate

# Run Django server using built assets (run `just build` first if needed)
django:
    DJANGO_VITE_DEV_MODE=false .venv/bin/python manage.py runserver

# Run Vite dev server
vite:
    cd frontend && npm run dev

# Run both servers with hot reload in tmux split panes
dev:
    #!/usr/bin/env bash
    if [ -n "$TMUX" ]; then
        tmux split-window -h "DJANGO_VITE_DEV_MODE=true just django; echo 'Press enter to close...'; read"
        just vite
    else
        tmux new-session -d -s chessterfield "just vite; echo 'Press enter to close...'; read"
        tmux split-window -h -t chessterfield "DJANGO_VITE_DEV_MODE=true just django; echo 'Press enter to close...'; read"
        tmux attach -t chessterfield
    fi

# Run all tests (backend + frontend)
test: test-backend test-frontend

# Run backend tests
test-backend:
    .venv/bin/python -m pytest

# Run frontend tests
test-frontend:
    cd frontend && npm test

# Run end-to-end smoke tests against a real server
smoke: build
    #!/usr/bin/env bash
    PORT=$(.venv/bin/python - <<'PY'
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        print(sock.getsockname()[1])
    PY
    )
    cd frontend && PLAYWRIGHT_PORT="$PORT" PLAYWRIGHT_CHANNEL="${PLAYWRIGHT_CHANNEL:-chrome}" PLAYWRIGHT_BROWSERS_PATH={{justfile_directory()}}/.playwright npx playwright test

# Build frontend for production
build:
    cd frontend && npm run build
    cp frontend/node_modules/stockfish/src/stockfish-nnue-16-single.wasm frontend/dist/assets/

# Import games from Lichess (--max-games N to limit)
import-lichess *args:
    .venv/bin/python manage.py import_lichess {{args}}

# Analyse a chess position (requires: brew install stockfish)
# Usage: just analyse "FEN" | just analyse --pgn game.pgn
analyse *args:
    .venv/bin/python -m analyse {{args}}

# Analyse a position from the database by ID (requires: brew install stockfish)
# Usage: just analyse-db 42
analyse-db id:
    .venv/bin/python manage.py shell -c "from positions.models import Position; print(Position.objects.get(id={{id}}).fen)" | .venv/bin/python -m analyse -
