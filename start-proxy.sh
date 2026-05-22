#!/bin/bash

# Usage: ./start-proxy.sh [--background|stop|url] [FRP_AUTH_TOKEN]
#
# If no token is provided, attempts to fetch it from GCP Secret Manager
# (requires an active @two.inc gcloud login).

# Source .env.local if it exists
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

# Define environment variables
PROXY_USER="${PROXY_USER:-$USER}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-1236}"
PIDFILE=".frpc.pid"

# Sanitize PROXY_USER for subdomain use: lowercase, replace invalid chars with hyphens, clean up hyphens
USER_LOWER=$(echo "${PROXY_USER}" | tr '[:upper:]' '[:lower:]')
SANITIZED_USER=$(echo "${USER_LOWER}" | sed -E 's/[^a-z0-9-]+/-/g' | sed -E 's/^-+|-+$//g' | sed -E 's/--+/-/g')
export SUBDOMAIN="magento-hyva-${SANITIZED_USER}"

PROXY_URL="https://${SUBDOMAIN}.frp.beta.two.inc"

# ── stop mode ────────────────────────────────────────────────────────────────
if [ "$1" = "stop" ]; then
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
    echo "Proxy stopped"
  fi
  exit 0
fi

# ── url mode (just print the proxy URL if running) ───────────────────────────
if [ "$1" = "url" ]; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "$PROXY_URL"
  fi
  exit 0
fi

# ── start mode ───────────────────────────────────────────────────────────────

# Parse arguments: first positional may be --background, token is the remaining arg
MODE=""
TOKEN_ARG=""
for arg in "$@"; do
  if [ "$arg" = "--background" ]; then
    MODE="background"
  else
    TOKEN_ARG="$arg"
  fi
done

# Kill any existing frpc from a previous run
if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null
  rm -f "$PIDFILE"
fi

# Resolve FRP auth token
if [ -n "$TOKEN_ARG" ]; then
  export FRP_AUTH_TOKEN="$TOKEN_ARG"
elif [ -n "$FRP_AUTH_TOKEN" ]; then
  export FRP_AUTH_TOKEN
else
  echo "Fetching FRP_AUTH_TOKEN from Secret Manager..."
  if ! FRP_AUTH_TOKEN=$(gcloud secrets versions access latest --secret="FRP_AUTH_TOKEN" --project="two-beta" 2>&1); then
    echo "Failed to fetch FRP_AUTH_TOKEN:"
    echo "$FRP_AUTH_TOKEN"
    echo ""
    echo "Usage: ./start-proxy.sh [--background] <FRP_AUTH_TOKEN>"
    echo "   or: export FRP_AUTH_TOKEN=<token> before running"
    exit 1
  fi
  export FRP_AUTH_TOKEN
fi

# Start frpc in background
frpc -c frpc.toml &
FRP_PID=$!

sleep 2

if ! ps -p $FRP_PID >/dev/null 2>&1; then
  echo "frpc failed to start"
  exit 1
fi

echo "$FRP_PID" > "$PIDFILE"

echo ""
echo "Proxy: $PROXY_URL"
echo ""

# If --background, detach and return
if [ "$MODE" = "background" ]; then
  disown $FRP_PID
  exit 0
fi

# Foreground mode: wait until interrupted
trap 'kill $FRP_PID 2>/dev/null; rm -f "$PIDFILE"' EXIT
wait $FRP_PID
