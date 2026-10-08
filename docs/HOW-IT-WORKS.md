# KidTube: how it works

*As of 2026-10-05 (version 0.7.1).*

## Overview

KidTube has four parts. They never talk to each other directly. Everything goes through files in the private GitHub repo `kidtube-data`; you steer it from parent mode on the tablet.

| Part | Where it runs | What it does | Reads | Writes |
| --- | --- | --- | --- | --- |
| Tablet extension (KidTube 0.6.1) | Quetta browser on the Android tablet, or Orion on iPad/iPhone/Mac | Shows only the planned videos, the talking friend and the questions. Enforces hours, minutes and locks. | `queue.json`, `parent-config.json`, `characters/` | `activity/<day>.json`, `transcripts/` (when it can), rule changes |
| Data repo `kidtube-data` | GitHub (private) | The one place everything is stored. Every push is checked. | — | — |
| Daily helper | This server, 03:30 UTC (crontab → `agent/daily.sh`) | Claude Code (Sonnet) runs the day by `agent/DAILY.md`: plans the list, finds videos, writes the friend's words and the questions, its notes for you | data repo, YouTube search | data repo |
| AI services | Claude, Google Gemini, OpenRouter | Claude thinks and writes; Gemini watches videos and records the friend's voice; OpenRouter is the voice alternative and the old program's text models | what the helper sends | answers only |

The tablet syncs with GitHub every 15 minutes, and also when you press **Update**. The helper runs once a day. Claude (in a chat in this repo) can change the code, and run the helper by hand.

## Kid flow on the tablet

He only sees the list, the talking friend and the video. Any other YouTube page sends him back to the list.

1. **He opens YouTube in Quetta.** The extension covers the page with his list.
    - Outside the watching hours, over the daily minutes, or after "no more videos today": he gets a lock screen ("Videos are sleeping", "That's all for today" or "Good work today").
    - Another site typed in the address bar is blocked. Only the allowed sites open.
2. **The list.** Today's videos from `queue.json`, minus the ones he has watched, at most "Videos on the home screen".
    - ⭐ videos are must-watch. How they work depends on the must-watch rule:
        - *first*: the other cards are greyed out ("⭐ first") until every ⭐ video is watched.
        - *mix*: one ⭐ video, then one free choice, and so on.
        - *off*: ⭐ is only a mark.
    - Tapping a greyed card only wiggles it and the stars.
3. **He taps a video.**
    - Intro on: the talking friend's screen opens. He taps the friend (browsers only speak after a tap), and the friend waves and says the intro. A Russian video gets a Russian voice.
    - Intro off: straight to the video.
4. **Watching.** YouTube's player shows; everything else is hidden. The strip below shows the other cards, locked with a countdown until the minimum watching time has passed.
    - Skipping forward and speeding up are blocked unless *Allow skipping* is on.
    - If the daily minutes run out, the video pauses and the lock screen shows.
    - If he leaves early (after the minimum time), the video counts as watched if he watched long enough, and he goes back to the list.
5. **The video ends.**
    - Outro on, or questions waiting: the friend's screen shows what we learned, then each question.
    - Otherwise: back to the list.
6. **Each question.**
    - *Voice*: the microphone opens by itself and he says the answer.
        - If the tablet has no microphone, he gets a box to type into from then on.
        - If he says nothing: "Tap the 🎤 and say it again".
    - *Choice*: big buttons in random order.
    - Right answer: praise, and the friend jumps.
    - Wrong answer: "Try again", up to *Tries per question*. After that the friend says "The answer is …".
7. **After the questions**, the rule *After N wrong answers* decides:
    - *continue*: back to the list.
    - *rewatch*: the same video once more (once a day).
    - *no more videos today*: lock screen until tomorrow. A parent can undo it with *Reset today*.
8. **Every step is logged** to `activity/<day>.json`: seconds watched, why it ended, and every answer.

A parent can skip any friend screen with the 🔒 button and the PIN.

## Parent flows

You can steer from two places: the tablet and a chat with Claude. All of them end up in the data repo, and the helper reads them on its next run.

**On the tablet** (parent mode: 🔒 Parent at the top right of his screens, then the PIN):

| What you do | What happens |
| --- | --- |
| **Update now** | Pulls the newest list, rules and app version right away (otherwise every 15 min) |
| Change **Rules** (hours, minutes, must-watch order, talking friend, questions) | Works on the tablet at once and is saved to `parent-config.json`, so the helper sees it |
| **Ask the AI** (Settings, and the note box on every tab) | Saved as a `wish` event, held until ↻ Update. The next run keeps it in its history of your messages (`memory.json`, `helper.wishes`) and acts on it. |
| 👍 / 👎 / comment on a watched video | Saved as a `parentNote`. The helper uses it for *What the helper noticed* and future picks. |
| Tap a watched video's picture | You watch it yourself with skipping allowed. It doesn't count for him. |
| **Reset today** | Gives back today's minutes and undoes "no more videos today" |

**Parent mode** (since 0.7.0). On his screens, tap **🔒 Parent** (top right) and enter the PIN. While it is on, YouTube's home opens your screens instead of his list, any YouTube video plays, nothing is blocked and nothing counts for him, and the apps header is on top. It stays on until you tap **Kid** in the **Parent | Kid** switch (top right of your screens).

| Tab | What you see | What you can do |
| --- | --- | --- |
| **Today** | Every video on his list today, watched ones marked ✓ | ⭐ must-watch on/off, **Remove** (back to Planned; the next planned video takes its place), a note for the AI about the video or the whole list |
| **Planned** | The helper's next picks in its order, then its other ideas | ⭐ on/off, **Approve**, **→ Today**, **Remove** (never shown), notes for the AI (video or list) |
| **History** | What he watched, by day: minutes, how it ended, his answers | 👍 / 👎, notes for the AI (video or the whole history) |
| **Prompt** | How the helper works: when it runs, its diary, *What I noticed*, its study plan, each step of its prompt, the settings and models it uses, the tablet rules it reads, what it reads and writes, the whole prompt | **Your changes to the prompt**: standing instructions it follows every run (they win over its steps, not over its safety rules); remove one any time |
| **Settings** | Ask the AI, Update, Status, the rules, the talking friend, the PIN | change them; the account, GitHub and the settings file are in the apps header |

Swipe left or right to move between the tabs; on a video's page, swipe right to go back.

The Prompt tab reads `helper.json`, which the helper writes on every run from the real `agent/DAILY.md`, `agent/config.json` and its toolkit (`node agent/kt.mjs info` publishes it at once). Prompt changes go to the helper as `prompt` events; it keeps them in `memory.json` (`helper.promptNotes`) and gets them as `promptNotes` from `start`.

Tap a video for its page: why it's on the list, what he learns, the summary, the intro and outro (🔊 hear the friend), the questions with their answers, **Try the quiz yourself**, things to talk about, and the notes for the AI. **Watch it yourself** plays it without his rules.

Every change works on the tablet at once and is saved as a `plan` event in `activity/<day>.json` (notes as `parentNote`, list notes as `wish` with `list`). The other devices pick it up on their next sync. The helper applies them on its next run, ahead of its own choices.

**Profiles (one per YouTube account).** KidTube reads which YouTube account is signed in (its email, from YouTube's own account switcher). Every rule, list, history and note belongs to that account's profile, and so do its files on GitHub (`kidtube-data/kidtube/<email name>/`) and its helper runs: another child is another profile and starts fresh. The apps header (on top of YouTube when no app runs, and in parent mode) shows the account with **Switch** (Google's account chooser), its apps as round tiles, and **Add app**; the account menu has the GitHub connection, the settings file (save / load) and Sign out. A new app starts empty. The PIN, parent mode and the GitHub connection belong to the tablet, the same for every profile.

**In a chat with Claude** in this repo: say what you want, for example "one Russian fairy tale a day", "harder questions" or "run it now". Claude edits the code or the prompts, or runs the helper by hand.

## Who does what in the daily run

| Job | Done by | Notes |
| --- | --- | --- |
| Run the day, decide, write every text | **Claude Code (Sonnet)** following `agent/DAILY.md` | uses some of your Claude plan's usage each day |
| Data, YouTube search, checks, saving | `agent/kt.mjs` (commands Claude calls) | plain code, same result every time |
| Watch videos: transcripts, questions about a video | **Gemini** (free tier) | limits in `agent/config.json` → `transcripts` |
| Record the friend's voice | **Gemini** speech (free) by default; OpenRouter (paid) or off | `voices.speak.provider`: `device`, `gemini` or `openrouter` |
| Hear his answers | recorded and sent: free Gemini first, then paid OpenRouter (keys on the tablet); or the tablet's own recognition | parent page → Talking friend → Hearing his answers |
| Backup if Claude can't run | `agent/run.mjs`, the old fixed program with OpenRouter text models | `orchestrator.fallbackToNode`; `openrouter.mode`: `free-first`, `paid` or `specific` |

## The daily helper run

One run takes about 10–20 minutes. It uses about 15 text-model calls and up to 10 Gemini videos. It starts at 03:30 UTC from the server's crontab (`agent/daily.sh`). Claude Code runs the steps below with the commands in `agent/kt.mjs`. If Claude can't run and nothing was saved that day, the old program `agent/run.mjs` does the same steps with OpenRouter models instead.

```mermaid
flowchart TD
  A["03:30 UTC: lock, pull kidtube-data"] --> B["Read tablet activity since the last run"]
  B --> C["Your messages, notes, approvals, Prompt-tab notes"]
  C --> D["Plan searches, search YouTube, pick ideas"]
  D -. "all models fail" .-> D2["Step skipped, noted in the diary"]
  D --> E["Today's list: approved and must-watch first"]
  E --> F["Gemini transcripts (10 videos, 120 min)"]
  F -. "quota used or busy" .-> F2["Words from the title for now"]
  F --> G["Write words, questions, notes, plan"]
  G --> H{"Every file passes the checks?"}
  H -- no --> H2["Nothing saved, yesterday's list stays"]
  H -- yes --> I["Push to GitHub"]
  I --> J["Tablet gets the new list (15 min or Update)"]
```

1. **Lock and fetch.** Only one run at a time. It pulls a fresh copy of `kidtube-data`.
2. **Read the tablet's activity** since the last run.
    - A video watched to the end, or longer than the minimum, becomes *Watched*.
    - Thumbs, comments and quiz answers are remembered for the notes.
    - Messages to the helper are collected.
3. **Read your words** from parent mode: messages (with the earlier ones from `memory.json`), notes on videos, Prompt-tab notes, approvals, must-watch marks and *Remove*.
    - They win over the helper's own choices.
    - *Videos on the home screen* (Settings) is the number of videos per day.
4. **Understand** (text model): what you want now, the numbers for today, and 4–8 YouTube searches. If every model fails, it uses the defaults and searches nothing.
5. **Search YouTube** from the server. It keeps only new videos of the right length from channels that aren't blocked.
6. **Choose** (text model): up to *New ideas per day* become **Ideas**, each with a reason, topics and a language.
7. **Make today's list** in this order:
    1. *Must watch today*
    2. approved *Must watch*
    3. other must-watch videos
    4. approved videos
    5. the helper's own ideas, only if there aren't enough approved ones
    6. videos flagged as too hard, last

   Then it applies the language minimums. Yesterday's unwatched videos go back to *Planned*.
8. **Transcripts** (Gemini): today's videos first, then new ideas, then planned ones, until 10 videos or 120 minutes of video.
9. **Words and questions** (text model) for every video that needs them: today's videos, new ideas, and planned videos whose transcript just arrived.
10. **Write the files:**
    - `queue.json`: today's list, plus `upcoming` so the tablet fetches those transcripts too
    - `parent-config.json`: the questions and the must-watch order
    - `memory.json`: everything the helper knows
    - `transcripts/`
11. **Notes** (text model):
    - *What the helper noticed*: every run
    - the *Study plan*: on the first run, weekly, or when your messages or notes change what he should learn
    - a diary entry
12. **Check and save.** `validate.mjs` checks every file.
    - If a file fails, nothing is saved and the run stops, with the reason in the log.
    - If all pass, it commits and pushes. If the tablet pushed meanwhile, the helper puts its commit on top and pushes again.
13. **Notes in memory.json**: noticed, plan and diary, shown in parent mode → Prompt.

The tablet picks up the new list on its next sync (15 min) or when you press **Update**.

## Gemini: transcripts

Gemini is asked for one thing only: what is said and what is shown. Everything else (summary, intro, outro, questions) is written afterwards by the text models, from that transcript.

YouTube blocks servers, but not Google: the helper sends Gemini the public video link, and Google's servers open the video themselves. Nothing about him or your notes is sent.

**The request, word for word** (one per video):

```text
[the video: https://www.youtube.com/watch?v=<id>]

You are making a transcript of a children's video for a parent.
Write everything that is said, in the video's own language (do not translate),
and the things a child would notice on screen.
Only what is really said and shown.
```

The answer must follow a fixed shape:
- `language`
- `transcript`: lines with a time, about every 10–20 seconds
- `onScreen`: lines like "[1:54] Word banner: EVAPORATE"

The temperature is 0.2, so it sticks to what is there.

**What the helper does with it:**
1. It saves `transcripts/<id>.json`, with kind `ai` and source `gemini`.
2. The text models use the transcript and the on-screen lines for the words, the questions and the age check. Questions like "What colour is…?" are allowed because of `onScreen`.

**Limits** (in `agent/config.json`, under `transcripts`):

| Setting | Now | Meaning |
| --- | --- | --- |
| `maxVideosPerDay` | 10 | videos Gemini may watch per day |
| `maxMinutesPerDay` | 120 | total minutes of video per day |
| `secondsPerRequest` | 120 | how long to wait for one model before giving up on it |
| `models` | 3.5 Flash Lite, 3.7 Flash, 3.8 Flash, 3.5 Flash, Flash latest | tried in this order |

**When something goes wrong:**
- A model is busy (503), gone (404) or too slow: it moves to the back of the line for this run and the next model is tried.
- The free daily quota is used up (429): no more Gemini today. Those videos keep words written from the title.
- A video would go over the minutes left: it is skipped today and tried tomorrow.
- The tablet still uploads YouTube's own captions when it is on. A transcript that already exists is never fetched again.

Google's free tier allows about 8 hours of YouTube video a day. On the free tier, Google may use requests to improve its products.

## Words and questions

Claude writes them during the daily session, following `agent/DAILY.md`. `kt.mjs words` checks every answer (lengths, language, answers a 4-year-old can say) and refuses it until it's right. The backup program sends four kinds of request to OpenRouter models instead; its prompts are in `agent/lib/prompts.mjs` and `agent/PROMPT.md`:

| Request | It gets | It returns | Checks before use |
| --- | --- | --- | --- |
| **Understand** | your wishes, About him, noticed, plan, new messages and comments, what he watched and answered, the planned list | a summary of what you want now, numbers for today, 4–8 YouTube searches, things to avoid | searches present |
| **Choose** | search results (title, channel, minutes, language), the wishes summary, About him | up to N picks, each with a reason, topics, language and must-watch | every pick is one of the results |
| **Words** (per video) | title, channel, transcript and on-screen lines (or "title only"), the friend's name, About him, quiz templates | summary, what he learns, intro (≤ 400 chars), outro (≤ 600), things to talk about, up to 2 questions, a too-hard flag | lengths; a Russian video gets Russian text; every answer is 1–2 everyday words or a number ≤ 20 |
| **Notes** | everything above, plus today's journal and the tablet rules | *What the helper noticed*, the *Study plan* (when due), a diary line | not empty |

**Rules every text follows:**
- Your words win over the helper's ideas.
- Only calm, kind videos.
- Only words a 4–5-year-old knows.
- Questions only about what the video really says or shows.
- No hard terms or big numbers.
- No catchphrase: the tablet adds the friend's catchphrase itself.

**Quiz templates.** Math questions are made by code, so the right answer is always right:

| Template | Example | He answers |
| --- | --- | --- |
| Adding (`add`) | What is 3 plus 4? | says 7 |
| Taking away (`subtract`) | What is 7 minus 2? | says 5 |
| What comes next | What number comes after 6? | says 7 |
| What comes before | What number comes before 5? | says 4 |
| Which is bigger | Which is bigger: 4 or 7? | taps 7 |
| Say it: about the video | How many wheels does the wheelbarrow have? | says one |
| Tap it: about the video | What do bees make? honey / milk / bread | taps honey |

English and Russian number words both count ("seven", "семь", "7"). Without a transcript, only math questions are made; the others wait until the transcript arrives.

**Models.** The list of free models is refreshed daily:
1. the preferred ones first (Nemotron 3 Super, Qwen 3.8, Gemma 4),
2. then the rest, by how well they did before.

A busy model rests for 30 minutes. A paid model can be added as a last resort (`llm.paidModel`).

## Voices

**The friend's voice.** `voices.speak.provider` in `agent/config.json`:
- `device`: the tablet speaks every line with its own voice.
- `gemini` (now): during `save`, Gemini records today's intros, outros, questions, "the answer is…" lines, the catchphrase and the praise lines in English and Russian. They are saved as `audio/<id>.mp3` in the data repo. The tablet downloads them on sync and plays them; any line without a recording is spoken by the tablet. Recordings no one uses any more are deleted.
- `openrouter`: the same, made with `openai/gpt-audio-mini` (paid, about $0.0003 a line). A recording is kept only if the model said exactly the text.

On the parent page, *Use the helper's recorded voice* turns playback off.

**Hearing his answers.** Parent page → *Hearing his answers*:
- *Record and send* (default): the tablet records his answer (it stops after a short silence) and sends it to the free Gemini models first (`gemini-3.5-flash-lite`, then `gemini-3.1-flash-lite`, the parent's own Gemini API key, free tier), then to the paid OpenRouter ones (`google/gemini-3.5-flash-lite`, then `openai/gpt-audio-mini`, about $0.0001 an answer). If a model hasn't answered after about 2.5 s the next one starts too, and the first answer wins; a model that hits its limit, fails or is slow rests for a while (a 429 for its Retry-After, else 30 s–5 min), so the next answers skip it. Both keys are typed in Settings and stay on the tablet only (and in *Save settings to a file*). The quiz question is never sent: given it, the models wrote the right answer instead of his. If nothing works, or there is no key, the tablet's own recognition is used. On Gemini's free tier Google may use what is sent to improve its products. OpenRouter's free audio models were tried (2026-10-06): they refuse apps or don't hear the audio.
- *The tablet's own speech recognition*.

## Where everything lives, and failures

The code is public (`andyvauliln/kidtube`). Everything about him is private (`andyvauliln/kidtube-data`). The keys live in one file on the server.

| What | Where |
| --- | --- |
| Extension code, helper code, prompts, schemas | `kidtube` repo. The extension is published on GitHub Pages and updates itself. |
| Today's list, rules, questions | `kidtube-data`: `queue.json`, `parent-config.json` |
| What he did | `kidtube-data/activity/<day>.json` |
| Transcripts | `kidtube-data/transcripts/<video id>.json` |
| The helper's memory (every video, its status and words; your messages; what it noticed, its plan and diary) | `kidtube-data/memory.json` |
| Pikachu drawing | `kidtube-data/characters/pikachu.svg` |
| Keys (OpenRouter, Gemini) | `~/.config/kidtube/agent.env` on the server, readable only by your user |
| Helper log, model stats, Gemini usage | `~/.local/share/kidtube/state/` on the server |
| Helper settings (runner, model, schedule, limits, voices, OpenRouter mode) | `agent/config.json` |
| The daily session's instructions | `agent/DAILY.md` |
| Recordings of the friend's voice | `kidtube-data/audio/*.mp3`; on the tablet in its cache |

| If this fails | What happens |
| --- | --- |
| A free text model is busy or gives bad JSON | The next model is tried and the run goes on |
| All text models fail for a step | That step is skipped (no new ideas, or the old words are kept) and listed in the diary |
| The Gemini quota is used up | The rest get words from their titles; transcripts come tomorrow |
| YouTube search is blocked | No new ideas today; the list is made from planned videos |
| The new files fail the checks | Nothing is saved; the tablet keeps yesterday's list |
| The server is off at 03:30 | No run that day; the next run catches up on all activity |
| The tablet is offline | It keeps the last good list; its events wait and are sent later |
| Claude can't run (logged out, out of usage) | The backup program runs |

## Orion (iPad, iPhone, Mac)

Orion gets its own build of the same code, from the *Install in Orion* card on the install page. Claude makes a new one when you say "update orion"; until then Orion stays on its last version while Quetta moves on. Orion is built on WebKit and lacks some Chrome features:

| Feature | Quetta | Orion |
| --- | --- | --- |
| Other websites blocked | before the page loads (blocking rules) | sent back to his list right after it starts loading |
| His spoken answers | the tablet's speech recognition | may be missing on iPad/iPhone: *Record and send* (the default) doesn't need it; without keys he types |
| Updates | automatic | manual: after "update orion", the parent page shows *Install the new version*; download the Orion .zip and install it again |
| Keeping him in the browser | Family Link | Screen Time |

## Not built yet

None of these exist today. Each one is your choice.

**YouTube likes.** Your 👍 / 👎 stay in our files; YouTube never sees them. YouTube learns only from the Google account signed in on the tablet, if there is one: what is watched there shapes that account's recommendations.
- Possible: when you tap 👍 on the parent page, the extension also presses YouTube's own Like button for that account.
- Needs: the tablet signed in to a Google account.

**YouTube's recommendations as ideas.** There is no official way to read someone's recommendations, and the server can't sign in. The tablet can, though: YouTube already loads the home feed and the "up next" list beside each video, which we hide from him.
- Possible: the extension saves those videos to `suggestions/<day>.json`, and the helper adds them to its search results with the same checks (length, channel, age, your approval).
- Without a signed-in account the feed is generic and less useful.

**More from Gemini.** It could write the words and questions itself in the same call, since it saw the video. That would be one call instead of two, with better questions about what's shown. It can't hand back frames from the video, but YouTube's own thumbnails can be shown.

**Pictures.** Google's image models (Gemini image models on the same key) can draw new pictures: picture questions ("tap the triangle"), flashcards, Pikachu poses. The tablet would need a picture-question type, which means a new version.

**Charts.** Quiz results by skill and minutes per day could be shown as charts in parent mode.
