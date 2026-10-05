#!/usr/bin/env bash
# The daily run (crontab). Claude Code runs agent/DAILY.md with the toolkit agent/kt.mjs.
# If Claude can't run (logged out, out of usage, crashed) and nothing was saved today, the old fixed program
# agent/run.mjs runs instead (config orchestrator.fallbackToNode).
set -u
cd "$(dirname "$0")/.."
STATE="${KIDTUBE_STATE_DIR:-$HOME/.local/share/kidtube/state}"
mkdir -p "$STATE"
cfg() { node -e "const c=require('./agent/config.json');const v=$1;process.stdout.write(String(v??''))"; }
RUNNER=$(cfg "c.orchestrator?.runner")
MODEL=$(cfg "c.orchestrator?.model")
FALLBACK=$(cfg "c.orchestrator?.fallbackToNode")
TODAY=$(date -u +%F)
echo "=== $(date -u +%FT%TZ) daily run, runner=$RUNNER model=$MODEL"

if [ "$RUNNER" = "claude" ] && command -v claude >/dev/null; then
  # Long steps (save makes voice recordings) must run in the foreground: in -p mode Claude ends
  # when it stops talking, and a backgrounded save was killed with it (Oct 3–5).
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 BASH_DEFAULT_TIMEOUT_MS=1800000 BASH_MAX_TIMEOUT_MS=1800000 \
  claude -p "$(cat agent/DAILY.md)" \
    --model "${MODEL:-sonnet}" \
    --permission-mode dontAsk \
    --allowedTools "Bash(node agent/kt.mjs:*)" "Read" \
    --output-format text
  echo "=== claude exit $?"
fi

if [ "$(cat "$STATE/last-save" 2>/dev/null)" != "$TODAY" ] && { [ "$RUNNER" = "node" ] || [ "$FALLBACK" = "true" ]; }; then
  echo "=== nothing saved today: running agent/run.mjs"
  node agent/run.mjs
fi
