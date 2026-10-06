---
name: helper-find-videos
description: KidTube helper run, step "new ideas" — find new YouTube videos by subject and add them to the plan. Use only inside the KidTube daily run (agent/DAILY.md) when newIdeas.stillAllowed > 0.
---

# Find new videos by subject

1. **How many, which subjects.** At most `newIdeas.stillAllowed` new videos. Split them over the subjects that are short: compare `subjects.open` with the balance in the `strategy` document; a subject with few open videos gets more.

2. **Queries.** For each subject, 1–3 queries from its document: "Next steps" (what the child should learn next) and "Good search queries" (what worked before). In the video's language (for example "numberblocks counting to 20", "мультик про дружбу для малышей"). Russian when the strategy or the parent's messages ask for Russian videos and too few are open.

3. **Search with the video scout.** Give the `video-scout` agent all queries in one message, as lines `<subject> | <query> | <en|ru>`, plus the child's age (from `context.kid`) and what to avoid from `strategy`. It runs the searches (cheaper model) and returns the best candidates per subject. If the agent is not available, search yourself: `node agent/kt.mjs search "<words>" 10 <en|ru>`.

4. **Pick.** From the candidates, pick at most `stillAllowed`: known children's education channels, clear teaching, calm pace, variety, not already planned, channels not in the bad list. Add them:
   `node agent/kt.mjs add '[{"videoId":"…","why":"one sentence for the parent","topics":["numbers"],"lang":"en","required":null}]'`
   `required` is `today` or `yes` only when the parent asked for that topic as a must-watch. Remember each new video's subject for the `subjects` notes (skill `helper-notes`).

5. **Transcripts.** Run `node agent/kt.mjs transcribe` again so the new ideas get transcripts.

6. Queries that found good videos go into the subject document's "Good search queries" (skill `helper-notes`).
