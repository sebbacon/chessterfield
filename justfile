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

# Run both servers with hot reload (open two terminals)
dev:
    @echo "Open two terminals and run:"
    @echo "  just vite"
    @echo "  DJANGO_VITE_DEV_MODE=true just django"

# Run all tests (backend + frontend)
test: test-backend test-frontend

# Run backend tests
test-backend:
    .venv/bin/python -m pytest

# Run frontend tests
test-frontend:
    cd frontend && npm test

# Build frontend for production
build:
    cd frontend && npm run build
