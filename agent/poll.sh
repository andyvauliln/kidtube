#!/usr/bin/env bash
# Runs every minute (crontab). When parent mode asked for a run (requests/run.json in kidtube-data,
# a new id), it runs agent/daily.sh now and reports in run-status.json, which parent mode shows.
# Cheap when idle: one `git ls-remote`, no pull, unless kidtube-data changed.
set -u
cd "$(dirname "$0")/.."
STATE="${KIDTUBE_STATE_DIR:-$HOME/.local/share/kidtube/state}"
DATA=$(node -e "const c=require('./agent/config.json');process.stdout.write((process.env.KIDTUBE_DATA_DIR??c.dataDir).replace(/^~/,process.env.HOME))")
MAX=$(node -e "process.stdout.write(String(require('./agent/config.json').orchestrator?.onDemandPerDay??6))")
mkdir -p "$STATE"

# One run at a time: the 03:30 run holds the same lock.
exec 9>"$STATE/run.lock"
flock -n 9 || exit 0
[ -d "$DATA/.git" ] || exit 0

remote=$(git -C "$DATA" ls-remote origin HEAD 2>/dev/null | cut -f1)
[ -n "$remote" ] && [ "$remote" = "$(cat "$STATE/poll-head" 2>/dev/null)" ] && exit 0
git -C "$DATA" fetch --quiet origin && git -C "$DATA" reset --quiet --hard "origin/HEAD" || exit 0
echo "$remote" > "$STATE/poll-head"

req="$DATA/requests/run.json"
[ -f "$req" ] || exit 0
id=$(node -e "try{process.stdout.write(String(require('$req').id??''))}catch{}")
[ -n "$id" ] && [ "$id" != "$(cat "$STATE/last-request" 2>/dev/null)" ] || exit 0
echo "$id" > "$STATE/last-request"

status() { # state, message
  node -e "
    const fs=require('fs'),p='$DATA/run-status.json';
    const old=(()=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return {}}})();
    const now=new Date().toISOString(), st=process.argv[1];
    const s={schemaVersion:1,requestId:'$id',state:st,message:process.argv[2]||'',
      startedAt:st==='running'?now:(old.requestId==='$id'?old.startedAt:null),finishedAt:st==='running'?null:now};
    fs.writeFileSync(p,JSON.stringify(s,null,2)+'\n');" "$1" "$2"
  git -C "$DATA" add run-status.json
  git -C "$DATA" -c user.name="KidTube helper" commit --quiet -m "helper: run $1" || return 0
  for i in 1 2 3; do git -C "$DATA" push --quiet origin HEAD && break; git -C "$DATA" pull --quiet --rebase origin HEAD; done
}

TODAY=$(date -u +%F)
count=$(grep -c "^$TODAY " "$STATE/on-demand" 2>/dev/null || true)
if [ "${count:-0}" -ge "$MAX" ]; then
  status failed "Not run: already $MAX runs on request today. The nightly run still happens."
  exit 0
fi
echo "$TODAY $id" >> "$STATE/on-demand"

status running "The helper is working (usually 10–30 minutes)."
echo "=== $(date -u +%FT%TZ) run on request $id" >> "$STATE/helper.log"
before=$(git -C "$DATA" rev-parse HEAD)
KIDTUBE_LOCKED=1 KIDTUBE_ON_DEMAND=1 agent/daily.sh >> "$STATE/helper.log" 2>&1
git -C "$DATA" fetch --quiet origin && git -C "$DATA" reset --quiet --hard origin/HEAD
if git -C "$DATA" log --format=%s "$before..HEAD" | grep -q "^helper: [0-9]"; then
  status done "Done. The new list and notes are on the tablet after the next sync."
else
  status failed "The run did not save a new list. Details are in the server log (helper.log)."
fi
git -C "$DATA" rev-parse HEAD > "$STATE/poll-head"
