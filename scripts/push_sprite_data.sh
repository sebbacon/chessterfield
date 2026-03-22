#!/usr/bin/env bash
set -euo pipefail

SPRITE_NAME="${1:-}"
SPRITE_BIN="${SPRITE_BIN:-sprite}"
SPRITE_BIN_RESOLVED=""
SPRITE_ORG="${SPRITE_ORG:-}"
SPRITE_DEBUG="${SPRITE_DEBUG:-0}"

if [[ -z "$SPRITE_NAME" ]]; then
  echo "Usage: $0 <sprite-name>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_KEY_PATH="${SPRITE_DEPLOY_KEY_PATH:-$ROOT_DIR/.tmp-home/sprite-deploy-ed25519}"
LOCAL_DB_PATH="${SPRITE_LOCAL_DB_PATH:-$ROOT_DIR/db.sqlite3}"
REMOTE_HOME="/home/sprite"
REMOTE_APP_DIR="$REMOTE_HOME/chessterfield"
REMOTE_DB_PATH="$REMOTE_APP_DIR/db.sqlite3"
REMOTE_UPLOAD_PATH="$REMOTE_APP_DIR/db.sqlite3.upload"
LOCAL_PROXY_PORT="${SPRITE_PROXY_PORT:-2000}"

PROXY_PID=""
LOCAL_SNAPSHOT_PATH=""

if [[ "$SPRITE_DEBUG" == "1" ]]; then
  set -x
fi

require_cmd() {
  local cmd="$1"
  if [[ "$cmd" == */* ]]; then
    [[ -x "$cmd" ]] || {
      echo "Error: required command '$cmd' is not installed." >&2
      exit 1
    }
    return
  fi
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command '$1' is not installed." >&2
    exit 1
  fi
}

resolve_cmd() {
  local cmd="$1"
  if [[ "$cmd" == */* ]]; then
    printf '%s\n' "$cmd"
  else
    command -v "$cmd"
  fi
}

proxy_pids_for_port() {
  lsof -tiTCP:"$LOCAL_PROXY_PORT" -sTCP:LISTEN 2>/dev/null || true
}

is_sprite_proxy_pid() {
  local pid="$1"
  local cmd

  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  [[ -n "$cmd" ]] || return 1
  [[ "$cmd" == *"sprite"* ]] || return 1
  [[ "$cmd" == *" proxy ${LOCAL_PROXY_PORT}:22"* ]] || return 1
  [[ "$cmd" == *" -s ${SPRITE_NAME} "* || "$cmd" == *" -s ${SPRITE_NAME}" || "$cmd" == *" ${SPRITE_NAME} proxy ${LOCAL_PROXY_PORT}:22"* ]]
}

cleanup_proxy_port() {
  local pid

  for pid in $(proxy_pids_for_port); do
    if ! is_sprite_proxy_pid "$pid"; then
      continue
    fi

    kill "$pid" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      if ! kill -0 "$pid" >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done
}

cleanup() {
  set +e

  if [[ -n "$LOCAL_SNAPSHOT_PATH" ]]; then
    rm -f "$LOCAL_SNAPSHOT_PATH"
  fi

  if [[ -n "$PROXY_PID" ]] && kill -0 "$PROXY_PID" >/dev/null 2>&1; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
    wait "$PROXY_PID" >/dev/null 2>&1 || true
  fi

  cleanup_proxy_port
}

trap cleanup EXIT

if [[ ! -f "$LOCAL_DB_PATH" ]]; then
  echo "Error: local database not found at $LOCAL_DB_PATH" >&2
  exit 1
fi

require_cmd "$SPRITE_BIN"
require_cmd ssh
require_cmd scp
require_cmd ssh-keygen
require_cmd lsof
require_cmd base64

PYTHON_BIN=""
for candidate in "$ROOT_DIR/.venv/bin/python" python3 python; do
  if [[ "$candidate" == */* ]]; then
    if [[ -x "$candidate" ]]; then
      PYTHON_BIN="$candidate"
      break
    fi
  elif command -v "$candidate" >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v "$candidate")"
    break
  fi
done

if [[ -z "$PYTHON_BIN" ]]; then
  echo "Error: Python is required to create a consistent SQLite snapshot." >&2
  exit 1
fi

SPRITE_BIN_RESOLVED="$(resolve_cmd "$SPRITE_BIN")"

if [[ -z "$SPRITE_ORG" && -n "${SPRITE_TOKEN:-}" ]]; then
  SPRITE_ORG="${SPRITE_TOKEN%%/*}"
fi

sprite() {
  if [[ -n "$SPRITE_ORG" ]]; then
    if [[ "$SPRITE_DEBUG" == "1" ]]; then
      "$SPRITE_BIN_RESOLVED" --debug -o "$SPRITE_ORG" "$@"
    else
      "$SPRITE_BIN_RESOLVED" -o "$SPRITE_ORG" "$@"
    fi
  else
    if [[ "$SPRITE_DEBUG" == "1" ]]; then
      "$SPRITE_BIN_RESOLVED" --debug "$@"
    else
      "$SPRITE_BIN_RESOLVED" "$@"
    fi
  fi
}

cleanup_proxy_port

if lsof -iTCP:"$LOCAL_PROXY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Error: local port $LOCAL_PROXY_PORT is already in use. Set SPRITE_PROXY_PORT to another port and retry." >&2
  exit 1
fi

mkdir -p "$(dirname "$DEPLOY_KEY_PATH")"
if [[ ! -f "$DEPLOY_KEY_PATH" ]]; then
  ssh-keygen -q -t ed25519 -N "" -f "$DEPLOY_KEY_PATH" >/dev/null
fi

list_output=""
list_status=0
if ! list_output="$(sprite list 2>&1)"; then
  list_status=$?
  echo "Error: failed to list sprites before syncing data (exit $list_status)." >&2
  if [[ -n "$list_output" ]]; then
    printf '%s\n' "$list_output" >&2
  else
    echo "The Sprite CLI returned no output." >&2
  fi
  exit 1
fi

if ! printf '%s\n' "$list_output" | grep -Fxq "$SPRITE_NAME"; then
  echo "Error: Sprite '$SPRITE_NAME' does not exist. Deploy it first or choose a valid sprite name." >&2
  exit 1
fi

LOCAL_SNAPSHOT_PATH="$(mktemp "${TMPDIR:-/tmp}/chessterfield-db.XXXXXX.sqlite3")"

echo "Creating a consistent local SQLite snapshot"
"$PYTHON_BIN" - "$LOCAL_DB_PATH" "$LOCAL_SNAPSHOT_PATH" <<'PY'
import sqlite3
import sys

source_path, snapshot_path = sys.argv[1], sys.argv[2]

source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
target = sqlite3.connect(snapshot_path)
try:
    source.backup(target)
finally:
    target.close()
    source.close()
PY

echo "Ensuring SSH access is available on the Sprite"
sprite -s "$SPRITE_NAME" exec -- bash -lc "sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server"

pubkeys_b64="$(base64 < "${DEPLOY_KEY_PATH}.pub" | tr -d '\n')"

echo "Authorizing local SSH keys on the Sprite"
sprite -s "$SPRITE_NAME" exec -- bash -lc "set -euo pipefail; umask 077; mkdir -p '$REMOTE_HOME/.ssh'; touch '$REMOTE_HOME/.ssh/authorized_keys'; tmp=\$(mktemp); printf '%s' '$pubkeys_b64' | base64 -d > \"\$tmp\"; sort -u '$REMOTE_HOME/.ssh/authorized_keys' \"\$tmp\" > '$REMOTE_HOME/.ssh/authorized_keys.new'; mv '$REMOTE_HOME/.ssh/authorized_keys.new' '$REMOTE_HOME/.ssh/authorized_keys'; rm -f \"\$tmp\""

echo "Configuring the Sprite SSH service"
sprite -s "$SPRITE_NAME" api /services/sshd -- -X PUT -H "Content-Type: application/json" --data-binary @- <<'JSON'
{
  "cmd": "bash",
  "args": [
    "-lc",
    "sudo mkdir -p /run/sshd && exec sudo /usr/sbin/sshd -D"
  ]
}
JSON

echo "Starting Sprite SSH proxy on localhost:${LOCAL_PROXY_PORT}"
sprite -s "$SPRITE_NAME" proxy "${LOCAL_PROXY_PORT}:22" >/tmp/chessterfield-sprite-proxy.log 2>&1 &
PROXY_PID=$!

for _ in {1..40}; do
  if ssh -i "$DEPLOY_KEY_PATH" -p "$LOCAL_PROXY_PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=2 sprite@localhost true >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! ssh -i "$DEPLOY_KEY_PATH" -p "$LOCAL_PROXY_PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 sprite@localhost true >/dev/null 2>&1; then
  echo "Error: could not connect to the Sprite over the local SSH proxy." >&2
  exit 1
fi

echo "Uploading database snapshot"
ssh -i "$DEPLOY_KEY_PATH" -p "$LOCAL_PROXY_PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new sprite@localhost "mkdir -p '$REMOTE_APP_DIR'"
scp -i "$DEPLOY_KEY_PATH" -P "$LOCAL_PROXY_PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$LOCAL_SNAPSHOT_PATH" "sprite@localhost:$REMOTE_UPLOAD_PATH"

echo "Stopping Django web service"
sprite -s "$SPRITE_NAME" api /services/web/stop -- -X POST

echo "Replacing remote database"
sprite -s "$SPRITE_NAME" exec -- bash -lc "set -euo pipefail; cd '$REMOTE_APP_DIR'; if [[ -f '$REMOTE_DB_PATH' ]]; then cp -p '$REMOTE_DB_PATH' '$REMOTE_DB_PATH.bak'; fi; mv '$REMOTE_UPLOAD_PATH' '$REMOTE_DB_PATH'"

echo "Starting Django web service"
sprite -s "$SPRITE_NAME" api /services/web/start -- -X POST

echo "Sprite database updated:"
echo "  Local snapshot: $LOCAL_DB_PATH"
echo "  Remote database: $SPRITE_NAME:$REMOTE_DB_PATH"
