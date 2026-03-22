set dotenv-load

fenify_repo_dir := "tmp/fenify"
fenify_model_name := "models_2023-07-10-chessboard-2D-balanced-fen-cpu.pt"
fenify_model_path := fenify_repo_dir / fenify_model_name

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
    DJANGO_VITE_DEV_MODE="${DJANGO_VITE_DEV_MODE:-false}" .venv/bin/python manage.py runserver

# Run Vite dev server
vite:
    cd frontend && npm run dev

# Run both servers with hot reload in tmux split panes
dev: build
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
    cd frontend && PLAYWRIGHT_PORT="$PORT" PLAYWRIGHT_CHANNEL="${PLAYWRIGHT_CHANNEL:-chromium}" PLAYWRIGHT_BROWSERS_PATH={{justfile_directory()}}/.playwright npx playwright test

# Ensure required OCR tool is available for header metadata extraction
ocr-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v tesseract >/dev/null 2>&1; then
        echo "Error: tesseract is required for puzzle header OCR but is not installed." >&2
        echo "Install it with: brew install tesseract" >&2
        exit 1
    fi

# Ensure local SSHFS support is available for Sprite deploys
sshfs-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v sshfs >/dev/null 2>&1; then
        echo "Error: sshfs is required for Sprite deployment but is not installed." >&2
        case "$(uname -s)" in
            Darwin)
                echo "Install it with: brew install --cask macfuse && brew install sshfs-mac" >&2
                ;;
            Linux)
                echo "Install it with your package manager, for example: sudo apt-get install sshfs" >&2
                ;;
            *)
                echo "Install sshfs for your platform, then retry." >&2
                ;;
        esac
        exit 1
    fi
    if [ "$(uname -s)" = "Darwin" ]; then
        if ! pkgutil --pkgs 2>/dev/null | grep -Eiq 'macfuse|osxfuse'; then
            echo "Error: macFUSE is required for sshfs mounts on macOS but does not appear to be installed." >&2
            echo "Install it with: brew install --cask macfuse && brew install sshfs-mac" >&2
            exit 1
        fi
    fi

# Ensure the Sprite CLI is installed locally
sprite-check:
    #!/usr/bin/env bash
    set -euo pipefail
    sprite_bin="${SPRITE_BIN:-sprite}"
    if [[ "$sprite_bin" == */* ]]; then
        found=0
        [[ -x "$sprite_bin" ]] && found=1
    else
        found=0
        command -v "$sprite_bin" >/dev/null 2>&1 && found=1
    fi
    if [[ "$found" -ne 1 ]]; then
        echo "Error: sprite CLI is required for deployment but is not installed." >&2
        echo "Install it with: curl -fsSL https://sprites.dev/install.sh | sh" >&2
        exit 1
    fi

# Ensure optional Fenify dependencies and model weights are present
fenify-setup:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -d {{fenify_repo_dir}}/.git ] || git clone https://github.com/notnil/fenify {{fenify_repo_dir}}
    .venv/bin/python - <<'PY' || uv pip install --python .venv/bin/python -r requirements-fenify.txt
    import importlib.util
    import sys

    missing = [name for name in ("PIL", "torch", "torchvision") if importlib.util.find_spec(name) is None]
    raise SystemExit(1 if missing else 0)
    PY
    [ -f {{fenify_model_path}} ] || curl -L https://github.com/notnil/fenify/releases/download/v2023-07-10/{{fenify_model_name}} -o {{fenify_model_path}}

# Build frontend for production and provision Fenify inference assets
build: ocr-check fenify-setup
    cd frontend && npm run build
    cp frontend/node_modules/stockfish/src/stockfish-nnue-16-single.wasm frontend/dist/assets/

# Deploy the app to a public Sprite using SSHFS sync
deploy-sprite sprite_name="chessterfield": build sprite-check sshfs-check
    ./scripts/deploy_sprite.sh {{sprite_name}}

# Push the local SQLite database snapshot to a deployed Sprite
push-sprite-data sprite_name="chessterfield": sprite-check
    ./scripts/push_sprite_data.sh {{sprite_name}}

# Import games from Lichess (--max-games N to limit)
import-lichess *args:
    .venv/bin/python manage.py import_lichess {{args}}

# Import photographed puzzle pages from a folder into the app
# Usage: just import-puzzle-folder path/to/folder
import-puzzle-folder folder *args:
    .venv/bin/python manage.py import_puzzle_folder {{folder}} {{args}}

# Analyse a chess position (requires: brew install stockfish)
# Usage: just analyse "FEN" | just analyse --pgn game.pgn
analyse *args:
    .venv/bin/python -m analyse {{args}}

# Analyse a position from the database by ID (requires: brew install stockfish)
# Usage: just analyse-db 42
analyse-db id:
    .venv/bin/python manage.py shell -c "from positions.models import Position; print(Position.objects.get(id={{id}}).fen)" | .venv/bin/python -m analyse -

# Extract candidate puzzle cells from photographed page(s)
# Usage: just extract-puzzle-cells tests/fixtures/puzzle_pages/*.jpg
# Fenify: just extract-puzzle-cells tests/fixtures/puzzle_pages/*.jpg --fenify --fenify-model /path/to/model.pt
extract-puzzle-cells *args:
    .venv/bin/python -m vision {{args}}
