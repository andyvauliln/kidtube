#!/usr/bin/env bash
# The daily run (crontab). Claude Code runs agent/DAILY.md with the toolkit agent/kt.mjs.
# If Claude can't run (logged out, out of usage, crashed) and nothing was saved today, the old fixed program
# agent/run.mjs runs instead (config orchestrator.fallbackToNode).
set -u
cd "$(dirname "$0")/.."
STATE="${KIDTUBE_STATE_DIR:-$HOME/.local/share/kidtube/state}"
mkdir -p "$STATE"
# One run at a time with runs asked for from parent mode (agent/poll.sh holds the lock and sets KIDTUBE_LOCKED).
if [ -z "${KIDTUBE_LOCKED:-}" ]; then
  exec 9>"$STATE/run.lock"
  flock -w 3600 9 || { echo "=== another run held the lock for an hour, skipping"; exit 1; }
fi
cfg() { node -e "const c=require('./agent/config.json');const v=$1;process.stdout.write(String(v??''))"; }
RUNNER=$(cfg "c.orchestrator?.runner")
MODEL=$(cfg "c.orchestrator?.model")
EFFORT=$(cfg "c.orchestrator?.effort")
FALLBACK=$(cfg "c.orchestrator?.fallbackToNode")
TODAY=$(date -u +%F)
echo "=== $(date -u +%FT%TZ) daily run, runner=$RUNNER model=$MODEL effort=${EFFORT:-default}"

if [ "$RUNNER" = "claude" ] && command -v claude >/dev/null; then
  # Long steps (save makes voice recordings) must run in the foreground: in -p mode Claude ends
  # when it stops talking, and a backgrounded save was killed with it (Oct 3–5).
  mkdir -p /tmp/kidtube-in "$STATE/runs" && rm -f /tmp/kidtube-in/*
  OUT="$STATE/runs/$(date -u +%Y%m%dT%H%M%SZ).json"
  # SYSTEM.md: who it is and the rules; DAILY.md: the steps; .claude/skills/helper-*: step details;
  # .claude/agents/video-scout.md: searches on a cheaper model.
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 BASH_DEFAULT_TIMEOUT_MS=1800000 BASH_MAX_TIMEOUT_MS=1800000 \
  claude -p "$(cat agent/DAILY.md)" \
    --append-system-prompt "$(cat agent/SYSTEM.md)" \
    --model "${MODEL:-sonnet}" ${EFFORT:+--effort "$EFFORT"} \
    --permission-mode dontAsk \
    --allowedTools "Bash(node agent/kt.mjs:*)" "Read" "Edit(//tmp/kidtube-in/**)" "Skill" "Agent" "Task" --add-dir /tmp/kidtube-in \
    --output-format json > "$OUT"
  code=$?
  # The report goes to the log; time, turns and cost go to runs.json in kidtube-data (parent mode → Prompt).
  node agent/runlog.mjs "$OUT" "${KIDTUBE_ON_DEMAND:+request}"
  echo "=== claude exit $code"
fi

if [ "$(cat "$STATE/last-save" 2>/dev/null)" != "$TODAY" ] && { [ "$RUNNER" = "node" ] || [ "$FALLBACK" = "true" ]; }; then
  echo "=== nothing saved today: running agent/run.mjs"
  node agent/run.mjs
fi
