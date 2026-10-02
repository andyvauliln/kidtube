# The KidTube helper

A small program that runs once a day. It reads what he watched and what you want, finds new
videos on YouTube, writes what the talking friend says, makes the questions, and updates the
tablet's list (`kidtube-data`) and your Notion pages.

It uses free AI models on OpenRouter and rotates between them. A paid model can be added later
(`llm.paidModel` in `config.json`).

## How it runs (since 0.6.0)

Cron starts `agent/daily.sh` at 03:30 UTC. It runs **Claude Code (Sonnet)** with the instructions in `agent/DAILY.md`.

- Claude does the thinking and the writing, and reads and writes Notion through its Notion connection. No Notion key is needed.
- Claude calls `node agent/kt.mjs …` for data, YouTube search, Gemini (transcripts and questions about a video), the friend's recordings, the checks and saving.
- If Claude can't run (logged out, out of usage) and nothing was saved that day, the old program `agent/run.mjs` runs the same steps with OpenRouter text models.

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
   - messages from the tablet ("Message to the helper") are copied to the bottom of **Wishes and settings** in Notion.
3. **Reads Notion:**
   - **Wishes and settings**, **About him**, **What the helper noticed** and **Study plan**;
   - the **Videos** table: *Approved*, *Status = No*, *Must watch*, *Day* and *Parent comment*;
   - comments on video pages, on **About him** and on **Study plan**;
   - **Quiz templates**, where *Use it* is on.
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
9. **Updates Notion:**
   - the table rows and video pages, each with the video, why, summary, words, quiz and transcript;
   - **What the helper noticed**;
   - **Study plan** on the first run, weekly, or when you comment on it or change your wishes;
   - a **Helper diary** entry.

## Notion

| Page | Who writes | What for |
|---|---|---|
| ⚙️ Wishes and settings | you | Goals, *Today / This week / This month*, languages, numbers. Plain words. |
| 🧒 About him | you | Your document about him. The helper reads it and never changes it. |
| 🔎 What the helper noticed | helper | What he likes, how he does with questions, open questions for you |
| 📚 Study plan | helper | 4-week plan; comment on any line to change it |
| 📓 Helper diary | helper | What each run did, and any problems |
| 🎬 Videos | both | Views: **Added today**, **Today**, **Planned**, **Watched** |
| 🧩 Quiz templates | both | Built-in ones (math, questions about the video); add *Custom* rows with a description |

In **Videos** you set:
- **Approved**: it goes first.
- **Status = No**: never show it.
- **Must watch** or **Must watch today**.
- **Day**: plan it for a date.
- **Parent comment**: anything, and the helper takes it into account.

Comments on the page work too.

## Setup (once)

1. **Keys** (OpenRouter, Gemini) are in `~/.config/kidtube/agent.env` (only your user can read it, and it's never committed).
2. **Notion:**
   1. On https://www.notion.so/profile/integrations, make an internal connection named "KidTube helper". Give it Read content, Update content, Insert content and Read comments.
   2. Copy its secret into `~/.config/kidtube/agent.env` as `NOTION_TOKEN=ntn_...`.
   3. In Notion, make an empty page (for example "KidTube"). Use ••• → Connections → add "KidTube helper".
   4. Run `node agent/run.mjs setup-notion <link to that page>`.
3. **Schedule:** run `node agent/run.mjs schedule`. It adds one line to this server's crontab, using `schedule` in `config.json` (server time, UTC). The log goes to `~/.local/share/kidtube/state/helper.log`.

Try it without saving anything: `node agent/run.mjs --dry`. The details land in `~/.local/share/kidtube/state/dry-run.json`.

## Running in the cloud instead

`agent/cloud/helper.yml` is a GitHub Actions workflow for `kidtube-data`; the instructions are at its top. It runs the same script. Use either this server or the cloud, not both.

## Settings (`config.json`)

| Key | Meaning |
|---|---|
| `runner` | `local` (this server, crontab) or `cloud` (GitHub Actions) |
| `schedule` | cron time for `schedule`, in server time (UTC) |
| `timezone` | the day boundary when `parent-config.json` has no IANA time zone |
| `defaults` | videos per day, new ideas per day, questions per video… Your **Numbers** in Notion win. |
| `transcripts` | Gemini watches the public videos for transcripts: `maxVideosPerDay` (10), `maxMinutesPerDay` (120), `models` tried in order, `secondsPerRequest` |
| `llm.preferred` | free models to try first; the rest are found and ranked automatically every day |
| `llm.paidModel` | a paid model id from openrouter.ai/models, used only when every free model fails (`null` = free only) |

## Changing the helper by talking to Claude

Open Claude Code in this repo and say what you want. Claude edits your **Wishes and settings** page, this code, or the prompts in `lib/prompts.mjs` and `PROMPT.md`.

Some examples:
- "From now on, one Russian fairy tale a day."
- "Questions should be harder."
- "Run it now."
