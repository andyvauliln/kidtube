# KidTube run

Plan today's videos. The rules and your tools are in the system prompt.

## Steps

1. **Start.** `node agent/kt.mjs start`. Read the output carefully:
   - `tablet`: what he watched, his answers, thumbs and comments, and the parent's messages (`wishes`; one with `aboutList` is about that list). `tablet.plan` are the parent's changes in parent mode, already applied; a removed video (status "no") never goes back on a list. Comments in `tablet.notes` are about one video.
   - `context`: the context documents — `kid` (about him), `strategy` (overall: goals, balance between subjects, languages, channels), and one per subject: `math`, `letters`, `world`. They are your main guide. `contextNotes` are the parent's new notes on them and win over the documents.
   - `subjects`: open videos per subject, and what he watched in the last 7 days per subject. Each video has a `subject` (`math`, `letters`, `world`, `other`, or null).
   - `rules` (the tablet rules), `wishesHistory` (earlier messages, still valid unless a newer one says otherwise), and your own `noticed`, `studyPlan`, `recentDiary`.

2. **Decide what today needs.** From the context documents, the parent's notes and messages, the study plan, and what he watched and answered:
   - today's subject mix: follow "Balance between subjects" in `strategy` (for 10 videos and "a third each" that is about 3 math, 3 letters, 3 world, 1 other), adjusted toward subjects he watched least this week;
   - which subject topics come next ("Next steps" in each subject document).
   Videos per day is `rules.queueSize`. Look at what is planned: `node agent/kt.mjs videos`.

3. **Transcripts first.** `node agent/kt.mjs transcribe` (Gemini, within today's limits, likely-today order). A video with a transcript gets real questions; read one with `node agent/kt.mjs transcript <id>`; `node agent/kt.mjs ask <id> "<question>"` only when the transcript leaves something unclear.

4. **New ideas, only when needed.** If `newIdeas.stillAllowed` (from `start`, `transcribe` or `node agent/kt.mjs ideas`) is 0, skip this step. Otherwise load the skill `helper-find-videos` and follow it.

5. **Today's list** (`rules.queueSize` videos). `node agent/kt.mjs today --suggest <count> ru=<n>` proposes an order (must-watch today, approved must-watch, other must-watch, approved, your ideas, flagged too-hard last; transcripts first within each group). Change it to reach today's subject mix from step 2 and to follow the wishes, then set it: `node agent/kt.mjs today id1,id2,…`. Never a video with status "no". `save` adds up to 10 spares after the list; when he watches or the parent removes one, the next spare takes its place.

6. **Words and questions.** Load the skill `helper-write-words` and follow it (today's list first, at most 20 videos a day).

7. **Notes, context documents and subjects.** Load the skill `helper-notes` and follow it.

8. **Save.** `node agent/kt.mjs save` — in the foreground, and wait for it (it can take 10+ minutes); never in the background, the session ends when you stop. It records today's lines, checks every file and pushes to GitHub. Report its `voices` numbers as they are (`made`, `kept`, `skipped`, `errors`).

9. **Report.** A few plain lines: today's list by subject, new ideas, what changed, anything that failed. They go to the log.

If a step fails, note it, carry on, and mention it in the diary. Only `save` must succeed for the tablet to get a new list; if it keeps failing, stop and report why.
