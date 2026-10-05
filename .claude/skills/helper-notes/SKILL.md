---
name: helper-notes
description: KidTube helper run, step "notes" — diary, what it noticed, study plan, the context documents and video subjects. Use only inside the KidTube daily run (agent/DAILY.md).
---

# Notes, context documents and subjects

Write the JSON with the Write tool to `/tmp/kidtube-in/notes.json`, then run `node agent/kt.mjs notes @/tmp/kidtube-in/notes.json`. Fields:

- `diary`: 2–4 sentences for the parent on what changed today and why (including the subject mix), plus any problems.
- `noticed`: rewrite "What I noticed": What he likes, What he doesn't like, How he does with questions (by skill), Parent's preferences I learned, Open questions for the parent. Keep what is still true, add what is new, only what the data shows.
- `plan`: only on the first run (no `studyPlan`), on Mondays, or when the parent's messages or notes changed what he should learn. A realistic 4-week plan from the context documents and the tablet rules: Goals, This week, Weeks 2–4, How we check progress (which quiz templates), Healthy screen time.
- `context`: only documents that need a change, each as the whole new Markdown document (`{"math":"# Math\n\n## Goal\n…"}`). Work every one of `contextNotes` into its document, and add what the data shows (quiz answers → "Where he is now", queries that worked → "Good search queries", liked/disliked → `kid`). Keep each document's sections:
  - `kid`: About him, Likes, Dislikes, Skills now (math, letters, world), Languages, Parent's rules and wishes;
  - `strategy`: Goals, Balance between subjects (share of the daily list), Languages, Good and bad channels, What to avoid;
  - `math`, `letters`, `world`: Goal, Where he is now, Next steps, Good search queries, Good channels, Question ideas.
  If a document is empty, write it from what you know.
- `subjects`: `{"<videoId>":"math|letters|world|other"}` for today's videos, new ideas, and every open video whose `subject` is null.
- `requiredFirst`: only if the parent changed the must-watch order (`first`, `mix` or `off`).
