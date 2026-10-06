#!/usr/bin/env bash
# Runs every minute (crontab). No AI unless there is work to do:
# - new notes from the parent in kidtube-data (agent/notes.mjs finds them) → the notes agent: Claude Code with
#   agent/NOTES.md in its own checkout of the code. It changes the app or the helper, releases a new version,
#   and can ask for a helper run.
# - a run asked for from parent mode (requests/run.json, a new id) with no new notes → the helper (agent/daily.sh).
# Progress goes to run-status.json, which parent mode shows. Cheap when idle: one `git ls-remote`, no pull,
# unless kidtube-data changed.
set -u
cd "$(dirname "$0")/.."
ROOT=$PWD
cfg() { node -e "const c=require('./agent/config.json');const v=$1;process.stdout.write(String(v??''))"; }
STATE="${KIDTUBE_STATE_DIR:-$HOME/.local/share/kidtube/state}"
DATA=$(node -e "const c=require('./agent/config.json');process.stdout.write((process.env.KIDTUBE_DATA_DIR??c.dataDir).replace(/^~/,process.env.HOME))")
MAX=$(cfg "c.orchestrator?.onDemandPerDay??6")
NOTES_MAX=$(cfg "c.notesAgent?.perDay??10")
APP=${KIDTUBE_APP_DIR:-$(cfg "(c.notesAgent?.workDir??'~/.local/share/kidtube/app').replace(/^~/,process.env.HOME)")}
mkdir -p "$STATE"

# One run at a time: the 03:30 run holds the same lock.
exec 9>"$STATE/run.lock"
flock -n 9 || exit 0
[ -d "$DATA/.git" ] || exit 0

remote=$(git -C "$DATA" ls-remote origin HEAD 2>/dev/null | cut -f1)
[ -n "$remote" ] && [ "$remote" = "$(cat "$STATE/poll-head" 2>/dev/null)" ] && exit 0
git -C "$DATA" fetch --quiet origin && git -C "$DATA" reset --quiet --hard "origin/HEAD" || exit 0
echo "$remote" > "$STATE/poll-head"

# What is there to do: a new run request, new notes, or both.
id=""
req="$DATA/requests/run.json"
if [ -f "$req" ]; then
  rid=$(node -e "try{process.stdout.write(String(require('$req').id??''))}catch{}")
  if [ -n "$rid" ] && [ "$rid" != "$(cat "$STATE/last-request" 2>/dev/null)" ]; then id=$rid; echo "$id" > "$STATE/last-request"; fi
fi
notes=$(node agent/notes.mjs new --data "$DATA" --state "$STATE") || notes='[]'
count=$(printf '%s' "$notes" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).length))}catch{process.stdout.write('0')}})")
[ -n "$id" ] || [ "$count" -gt 0 ] || exit 0
# Notes sent by an older tablet (no request) still get a status line under their own id.
statusId=${id:-notes-$(date -u +%Y%m%dT%H%M%SZ)}

status() { # state, message
  node -e "
    const fs=require('fs'),p='$DATA/run-status.json';
    const old=(()=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return {}}})();
    const now=new Date().toISOString(), st=process.argv[1];
    const s={schemaVersion:1,requestId:'$statusId',state:st,message:process.argv[2]||'',
      startedAt:st==='running'?(old.requestId==='$statusId'&&old.startedAt||now):(old.requestId==='$statusId'?old.startedAt:null),finishedAt:st==='running'?null:now};
    fs.writeFileSync(p,JSON.stringify(s,null,2)+'\n');" "$1" "$2"
  git -C "$DATA" add run-status.json
  git -C "$DATA" -c user.name="KidTube helper" commit --quiet -m "helper: run $1" || return 0
  for i in 1 2 3; do git -C "$DATA" push --quiet origin HEAD && break; git -C "$DATA" pull --quiet --rebase origin HEAD; done
}

TODAY=$(date -u +%F)

run_helper() { # code checkout to run it from, text to put before the result
  local dir=$1 before_text=${2:-}
  local n
  n=$(grep -c "^$TODAY " "$STATE/on-demand" 2>/dev/null || true)
  if [ "${n:-0}" -ge "$MAX" ]; then
    status done "${before_text}The helper already ran $MAX times on request today; it updates the lists in its nightly run."
    return
  fi
  echo "$TODAY $statusId" >> "$STATE/on-demand"
  status running "${before_text}The helper is updating the lists (usually 10–30 minutes)."
  echo "=== $(date -u +%FT%TZ) helper run on request $statusId (from $dir)" >> "$STATE/helper.log"
  local before
  before=$(git -C "$DATA" rev-parse HEAD)
  (cd "$dir" && KIDTUBE_LOCKED=1 KIDTUBE_ON_DEMAND=1 agent/daily.sh) >> "$STATE/helper.log" 2>&1
  git -C "$DATA" fetch --quiet origin && git -C "$DATA" reset --quiet --hard origin/HEAD
  if git -C "$DATA" log --format=%s "$before..HEAD" | grep -q "^helper: [0-9]"; then
    status done "${before_text}The new lists are on the tablet after the next sync."
  else
    status failed "${before_text}The helper run did not save a new list. Details are in the server log (helper.log)."
  fi
}

if [ "$count" -gt 0 ]; then
  ran=$(grep -c "^$TODAY " "$STATE/notes-runs.log" 2>/dev/null || true)
  if [ "${ran:-0}" -ge "$NOTES_MAX" ]; then
    # Over the day's limit: the notes stay new and are read tomorrow. Said once a day.
    if [ "$(cat "$STATE/notes-limit" 2>/dev/null)" != "$TODAY" ]; then
      echo "$TODAY" > "$STATE/notes-limit"
      status failed "Your notes arrived. The AI already worked on notes $NOTES_MAX times today, so it reads these tomorrow."
    fi
    [ -n "$id" ] && run_helper "$ROOT"
    git -C "$DATA" rev-parse HEAD > "$STATE/poll-head"
    exit 0
  fi
  echo "$TODAY $statusId $count" >> "$STATE/notes-runs.log"
  printf '%s\n' "$notes" > "$STATE/notes-in.json"
  status running "The AI is working on your $count note$([ "$count" = 1 ] || echo s). A change to the app comes as a new version."
  log="$STATE/notes.log"
  echo "=== $(date -u +%FT%TZ) notes agent: $count note(s), request $statusId" >> "$log"

  # Its own checkout, fresh from GitHub: never the one someone may be working in.
  [ -d "$APP/.git" ] || git clone --quiet "$(git -C "$ROOT" remote get-url origin)" "$APP" >> "$log" 2>&1
  git -C "$APP" fetch --quiet origin && git -C "$APP" checkout --quiet main && git -C "$APP" reset --quiet --hard origin/main && git -C "$APP" clean --quiet -fd
  lock=$(sha1sum "$APP/package-lock.json" 2>/dev/null | cut -c1-40)
  if [ -n "$lock" ] && { [ ! -d "$APP/node_modules" ] || [ "$lock" != "$(cat "$STATE/app-npm" 2>/dev/null)" ]; }; then
    (cd "$APP" && npm ci --silent) >> "$log" 2>&1 && echo "$lock" > "$STATE/app-npm"
  fi

  RESULT="$STATE/notes-result.json"
  rm -f "$RESULT"
  mkdir -p "$STATE/notes-runs"
  MODEL=$(cfg "c.notesAgent?.model")
  EFFORT=$(cfg "c.notesAgent?.effort")
  prompt="$(cat "$APP/agent/NOTES.md")

## The notes (newest last)

\`\`\`json
$notes
\`\`\`

- Result file: $RESULT
- Data repo (read only): $DATA
- Today: $TODAY"
  (cd "$APP" && CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 BASH_DEFAULT_TIMEOUT_MS=900000 BASH_MAX_TIMEOUT_MS=1800000 \
    claude -p "$prompt" --model "${MODEL:-opus}" ${EFFORT:+--effort "$EFFORT"} \
      --permission-mode dontAsk --allowedTools "Bash" "Read" "Edit" "Write" "Glob" "Grep" "Skill" "Agent" "Task" \
      --add-dir "$STATE" "$DATA" --output-format json < /dev/null) > "$STATE/notes-runs/$(date -u +%Y%m%dT%H%M%SZ).json" 2>> "$log"
  echo "=== claude exit $?" >> "$log"
  # Handled either way: a note that failed is not tried again every minute (the summary says what happened).
  node agent/notes.mjs mark "$STATE/notes-in.json" --state "$STATE" >> "$log"

  summary=$(node -e "try{const r=require('$RESULT');process.stdout.write(String(r.summary??'').slice(0,600))}catch{}")
  helper=$(node -e "try{process.stdout.write(require('$RESULT').runHelper===true?'yes':'')}catch{}")
  # The main checkout follows when nobody is working in it (the nightly helper runs from there).
  if [ -z "$(git -C "$ROOT" status --porcelain)" ]; then git -C "$ROOT" pull --quiet --ff-only origin main >> "$log" 2>&1; fi
  if [ -z "$summary" ]; then
    status failed "The AI could not finish working on your notes. Details are in the server log (notes.log)."
  elif [ -n "$helper" ]; then
    run_helper "$APP" "$summary "
  else
    status done "$summary"
  fi
elif [ -n "$id" ]; then
  run_helper "$ROOT"
fi
git -C "$DATA" rev-parse HEAD > "$STATE/poll-head"
