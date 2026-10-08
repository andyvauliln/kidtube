# The KidTube helper

A small program that runs once a day. It reads what he watched and what you want, finds new
videos on YouTube, writes what the talking friend says, makes the questions, and updates the
tablet's list (`kidtube-data`) and its notes for you in parent mode.

It uses free AI models on OpenRouter and rotates between them. A paid model can be added later
(`llm.paidModel` in `config.json`).

## How it runs (since 0.6.0)

Cron starts `agent/daily.sh` at 03:30 UTC. It runs **Claude Code (Opus 5.5, effort medium; `orchestrator.model` and `.effort` in config.json)**: `claude -p DAILY.md --append-system-prompt SYSTEM.md`. `SYSTEM.md` has the rules and tools, `DAILY.md` the steps, and the skills `helper-find-videos`, `helper-write-words` and `helper-notes` the details of three steps. Searches run in the `video-scout` subagent (Haiku).

- Claude does the thinking and the writing.
- Claude calls `node agent/kt.mjs …` for data, YouTube search, Gemini (transcripts and questions about a video), the friend's recordings, the checks and saving.
- It plans from the context documents in `kidtube-data` (`context/`: kid, strategy, math, letters, world) and the notes you add in parent mode → Context.
- `agent/runlog.mjs` adds each run (time, turns, cost) to `runs.json`, shown in parent mode → Prompt.
- **↻ Update data** in parent mode runs it on request: `agent/poll.sh` (crontab, every minute) sees `requests/run.json`, at most 6 a day (`onDemandPerDay`), status in `run-status.json`.
- **The parent's notes** go first to the notes agent (`agent/NOTES.md`, Claude Code in its own checkout). It changes the app or the helper, releases, or runs the helper; `agent/notes.mjs` finds new notes without AI.
- If Claude can't run (logged out, out of usage) and nothing was saved that day, the old program `agent/run.mjs` runs the same steps with OpenRouter text models (it does not use the context documents, subjects or spares yet).

Settings in `config.json`:

| Setting | What it chooses |
| --- | --- |
| `orchestrator` | runner (`claude` or `node`), model, whether to fall back to `run.mjs` |
| `voices.speak.provider` | `device`, `gemini` or `openrouter`: who records the friend's lines |
| `openrouter.mode` | `free-first`, `paid` or `specific`, with model lists |
| `transcripts` | Gemini limits per day (videos and minutes) |

Run the session by hand with `agent/daily.sh`. The log goes to `~/.local/share/kidtube/state/`.

The steps below describe the old program `run.mjs`. The Claude session follows the same order.

## What one run does

1. **Gets the data.** Pulls `kidtube-data` (its own clone in `~/.local/share/kidtube/kidtube-data`).
2. **Reads the tablet.** New `activity/` events since the last run:
   - watched videos become *Watched*;
   - thumbs, comments and quiz answers are remembered;
   - your messages from parent mode are kept as their history in `memory.json` (`helper.wishes`).
3. **Reads your words** from parent mode on the tablet:
   - your messages, now and earlier;
   - notes on videos and on the lists;
   - *Approve*, *Remove*, ⭐ must-watch and *→ Today*;
   - the Prompt-tab notes (your standing changes to the prompt);
   - *Videos on the home screen* (Settings) = videos per day.
4. **Decides what to look for.** Today, this week, this month, languages, numbers. It plans 4–8 YouTube searches.
5. **Searches YouTube.** It keeps unknown videos of the right length from channels that aren't blocked, and the model picks the best ones as **Ideas**, each with *Why*.
6. **Makes today's list:**
   1. *Must watch today*;
   2. approved *Must watch*;
   3. other must-watch videos;
   4. approved videos;
   5. the helper's own ideas, only when there aren't enough approved ones.

   Then the language minimums ("at least 2 in Russian"). Yesterday's unwatched videos go back to *Planned*.
7. **Writes the friend's words and the quiz** for today's videos and new ideas:
   - the summary, what he learns, the intro, the outro, things to talk about, and questions;
   - written from the transcript, which the tablet uploads to `transcripts/`, YouTube blocks servers;
   - until a transcript arrives, from the title only, and rewritten once it arrives;
   - math questions come from code templates, so their answers are always right.
8. **Saves.**
   - `queue.json`: today's list, plus `upcoming` so the tablet fetches those transcripts.
   - `parent-config.json`: quiz items and the must-watch order.
   - `memory.json`: everything the helper knows.

   It runs `tools/validate.mjs`, and only if that passes it commits and pushes.
9. **Writes its notes** to `memory.json`, shown in parent mode → Prompt:
   - **What I noticed**;
   - **Study plan** on the first run, weekly, or when your messages or notes change it;
   - a **diary** entry.

## What you do in parent mode

| Where | What for |
|---|---|
| Message to the helper | Goals, *today / this week*, languages, numbers. Plain words. Kept as history. |
| Today / Planned | **Approve** (it goes first), **Remove** (never shown), ⭐ must-watch, **→ Today**, notes for the AI |
| History | 👍 / 👎 and notes on what he watched |
| Prompt | Read the helper's diary, *What I noticed* and study plan; add standing changes to its prompt |
| Settings | *Videos on the home screen* is the number of videos per day |

## Profiles (since 0.9.0)

Each child (YouTube account) is a profile with its own folder in `kidtube-data`: `kidtube/<email name>/`, for example `kidtube/johnnypitt.ind/`. `profiles` in `config.json` lists the ones the helper runs; it runs them one after another, each with its own state folder (`state/kidtube/<folder>/`: session, last save, requests, notes). The log, the run lock and the API quotas are shared.

- `"kidtube/*"` runs every folder that has a `profile.json` (the tablet writes it when a new profile syncs for the first time).
- A new profile gets its starter files from `data-repo-template/kidtube/` on its first run (`node agent/kt.mjs init-profile` does it at once).
- By hand: `KIDTUBE_PROFILE=kidtube/<folder> node agent/kt.mjs info`. Without it, the first profile in the list is used.
- `apps` in `config.json`: which prompts each app's runs use. Only `kidtube` exists so far.
- Moving the old one-child layout into a profile, once: `node agent/kt.mjs migrate-root kidtube/<folder> <email>`, then set `profiles`.

## Setup (once)

1. **Keys** (OpenRouter, Gemini) are in `~/.config/kidtube/agent.env` (only your user can read it, and it's never committed).
2. **Schedule:** run `node agent/run.mjs schedule`. It adds one line to this server's crontab, using `schedule` in `config.json` (server time, UTC). The log goes to `~/.local/share/kidtube/state/helper.log`.

Try it without saving anything: `node agent/run.mjs --dry`. The details land in `~/.local/share/kidtube/state/dry-run.json`.

## Running in the cloud instead

`agent/cloud/helper.yml` is a GitHub Actions workflow for `kidtube-data`; the instructions are at its top. It runs the same script. Use either this server or the cloud, not both.

## Settings (`config.json`)

| Key | Meaning |
|---|---|
| `runner` | `local` (this server, crontab) or `cloud` (GitHub Actions) |
| `schedule` | cron time for `schedule`, in server time (UTC) |
| `timezone` | the day boundary when `parent-config.json` has no IANA time zone |
| `defaults` | videos per day, new ideas per day, questions per video… *Videos on the home screen* (parent mode → Settings) and your messages win. |
| `transcripts` | Gemini watches the public videos for transcripts: `maxVideosPerDay` (10), `maxMinutesPerDay` (120), `models` tried in order, `secondsPerRequest` |
| `llm.preferred` | free models to try first; the rest are found and ranked automatically every day |
| `llm.paidModel` | a paid model id from openrouter.ai/models, used only when every free model fails (`null` = free only) |

## Changing the helper by talking to Claude

Open Claude Code in this repo and say what you want. Claude edits this code, or the prompts in `lib/prompts.mjs` and `PROMPT.md`.

Some examples:
- "From now on, one Russian fairy tale a day."
- "Questions should be harder."
- "Run it now."
