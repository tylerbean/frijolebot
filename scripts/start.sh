#!/bin/sh
set -eu

# Forward SIGTERM/SIGINT to children for graceful shutdown
terminate() {
  echo "[entrypoint] Received signal, forwarding to children..."
  [ -n "${BOT_PID-}" ] && kill -TERM "$BOT_PID" 2>/dev/null || true
  [ -n "${UI_PID-}" ] && kill -TERM "$UI_PID" 2>/dev/null || true
  [ -n "${GW_PID-}" ] && kill -TERM "$GW_PID" 2>/dev/null || true
  # Grace period to allow graceful shutdown (Discord notify, etc.)
  GRACE=${GRACE_SECONDS:-10}
  for i in $(seq 1 "$GRACE"); do
    alive=0
    for p in "$GW_PID" "$BOT_PID" "$UI_PID"; do
      if kill -0 "$p" 2>/dev/null; then alive=1; fi
    done
    [ "$alive" -eq 0 ] && break
    sleep 1
  done
  # Force kill any remaining processes
  for p in "$GW_PID" "$BOT_PID" "$UI_PID"; do
    kill -0 "$p" 2>/dev/null && kill -KILL "$p" 2>/dev/null || true
  done
}
trap terminate TERM INT

export NODE_ENV=production

# Start bot
HEALTH_CHECK_PORT=${HEALTH_CHECK_PORT:-3001} node /app/discord-link-bot.js &
BOT_PID=$!

# Start Next.js UI (production build assumed)
(
  cd /app/apps/control-panel
  if [ -f .next/BUILD_ID ]; then
    echo "[entrypoint] Starting Next.js (production) on 3100"
    PORT=3100 npm run start
  else
    echo "[entrypoint] No production build found; starting Next.js dev on 3100"
    npx next dev -p 3100 -H 0.0.0.0
  fi
) &
UI_PID=$!

# Start gateway
node /app/gateway/server.js &
GW_PID=$!

# Wait for children
wait "$GW_PID" "$BOT_PID" "$UI_PID"

