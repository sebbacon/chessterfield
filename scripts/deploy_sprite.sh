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
REMOTE_HOME="/home/sprite"
REMOTE_APP_DIR="$REMOTE_HOME/chessterfield"
SPRITE_ALLOWED_HOSTS="localhost,127.0.0.1,.sprites.app,.sprites.dev"
LOCAL_PROXY_PORT="${SPRITE_PROXY_PORT:-2000}"
MOUNT_POINT="${SPRITE_MOUNT_POINT:-/tmp/chessterfield-sprite-${SPRITE_NAME}}"

PROXY_PID=""
MOUNTED=0

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

  if [[ "$MOUNTED" -eq 1 ]]; then
    if command -v mountpoint >/dev/null 2>&1 && mountpoint -q "$MOUNT_POINT"; then
      :
    elif command -v stat >/dev/null 2>&1 && stat -f %HT "$MOUNT_POINT" >/dev/null 2>&1; then
      :
    fi

    if command -v fusermount >/dev/null 2>&1; then
      fusermount -u "$MOUNT_POINT" >/dev/null 2>&1 || true
    fi
    if command -v umount >/dev/null 2>&1; then
      umount "$MOUNT_POINT" >/dev/null 2>&1 || true
    fi
    if command -v diskutil >/dev/null 2>&1; then
      diskutil unmount "$MOUNT_POINT" >/dev/null 2>&1 || true
    fi
  fi

  if [[ -n "$PROXY_PID" ]] && kill -0 "$PROXY_PID" >/dev/null 2>&1; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
    wait "$PROXY_PID" >/dev/null 2>&1 || true
  fi

  cleanup_proxy_port
}

trap cleanup EXIT

require_cmd "$SPRITE_BIN"
require_cmd sshfs
require_cmd rsync
require_cmd ssh
require_cmd ssh-keygen
require_cmd lsof
require_cmd base64

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
  echo "Error: failed to list sprites before deploy (exit $list_status)." >&2
  if [[ -n "$list_output" ]]; then
    printf '%s\n' "$list_output" >&2
  else
    echo "The Sprite CLI returned no output." >&2
    if [[ -z "$SPRITE_ORG" ]]; then
      echo "Retry with SPRITE_ORG set, for example: SPRITE_ORG=seb-bacon ./scripts/deploy_sprite.sh $SPRITE_NAME" >&2
    fi
  fi
  exit 1
fi

if printf '%s\n' "$list_output" | grep -Fxq "$SPRITE_NAME"; then
  echo "Updating existing Sprite: ${SPRITE_NAME}"
else
  echo "Creating Sprite: ${SPRITE_NAME}"
  sprite create "$SPRITE_NAME"
fi

echo "Making Sprite URL public"
sprite -s "$SPRITE_NAME" url update --auth public

echo "Installing remote prerequisites"
sprite -s "$SPRITE_NAME" exec -- bash -lc "sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server python3-venv"

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

mkdir -p "$MOUNT_POINT"

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

echo "Mounting the Sprite filesystem with SSHFS"
sshfs -p "$LOCAL_PROXY_PORT" \
  -o IdentityFile="$DEPLOY_KEY_PATH" \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new \
  -o reconnect \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  "sprite@localhost:${REMOTE_HOME}" "$MOUNT_POINT"
MOUNTED=1

mkdir -p "$MOUNT_POINT/chessterfield"

echo "Syncing repository to the Sprite"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.playwright/' \
  --exclude '.pytest_cache/' \
  --exclude '.tmp-home/' \
  --exclude '.venv/' \
  --exclude '__pycache__/' \
  --exclude '*/__pycache__/' \
  --exclude '*.pyc' \
  --exclude 'db.sqlite3' \
  --exclude 'frontend/node_modules/' \
  --exclude 's2/' \
  --exclude 'tmp/' \
  --exclude 'venv/' \
  "$ROOT_DIR/" "$MOUNT_POINT/chessterfield/"

echo "Installing Python dependencies and running migrations on the Sprite"
sprite -s "$SPRITE_NAME" exec -- bash -lc "set -euo pipefail; cd '$REMOTE_APP_DIR'; python3 -m venv .venv; .venv/bin/python -m pip install --upgrade pip; .venv/bin/python -m pip install -r requirements.txt; DJANGO_VITE_DEV_MODE=false ALLOWED_HOSTS='${SPRITE_ALLOWED_HOSTS}' .venv/bin/python manage.py migrate"

echo "Configuring the web service"
sprite -s "$SPRITE_NAME" api /services/web -- -X PUT -H "Content-Type: application/json" --data-binary @- <<JSON
{
  "cmd": "bash",
  "args": [
    "-lc",
    "cd ${REMOTE_APP_DIR} && export DJANGO_VITE_DEV_MODE=false ALLOWED_HOSTS=${SPRITE_ALLOWED_HOSTS} && exec .venv/bin/python manage.py runserver 0.0.0.0:8080 --noreload"
  ],
  "http_port": 8080
}
JSON

echo "Restarting the web service"
sprite -s "$SPRITE_NAME" api /services/web/stop -- -X POST || true
sprite -s "$SPRITE_NAME" api /services/web/start -- -X POST

echo "Sprite deployed:"
sprite -s "$SPRITE_NAME" url
