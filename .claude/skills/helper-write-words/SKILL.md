---
name: helper-write-words
description: KidTube helper run, step "words and questions" — write the friend's intro, outro, summary and quiz for videos. Use only inside the KidTube daily run (agent/DAILY.md).
---

# Words and questions

For every video on today's list, among the new ideas, or planned (the next planned ones become spares) (`node agent/kt.mjs videos`) whose words are missing, or were written from the title only while a transcript now exists — at most 20 a day, today's list first — read the transcript (`node agent/kt.mjs transcript <id>`) and run `node agent/kt.mjs words <id> '<json>'` (or write the JSON to `/tmp/kidtube-in/words-<id>.json` and pass `@/tmp/kidtube-in/words-<id>.json`) with:

- `summary`: 3–5 sentences for the parent;
- `learned`: 2–4 new things the child learns;
- `intro`: 2–4 short sentences, at most 400 characters. It makes the child curious without giving the answer and says what to look out for;
- `outro`: 3–5 short sentences, at most 600 characters. It sums up what the child learned, then leads into the questions;
- `talkAbout`: 2–4 things to talk about with the child;
- `quiz`: up to 2 questions.
  - Math videos: `{"template":"add|subtract|next-number|number-before|bigger","params":{"max":10},"count":1}` — `max` from "Where the child is now" in the `math` document.
  - Other videos: `{"template":"video-voice","prompt":"…","accept":["…","…"]}` or `{"template":"video-choice","prompt":"…","options":["…","…","…"],"correct":"…"}`. Use "Question ideas" from the subject document when they fit.
  - Without a transcript: math questions only, or none.
- `tooHard`: null, or one sentence for the parent when a child of the age in `context.kid` can't follow the video (many scientific terms, too fast, scary parts).

Don't start the intro or end the outro with the friend's name or catchphrase; the tablet adds them. If the command refuses, fix what it says and run it again.
