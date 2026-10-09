# KidTube agent: the talking friend's words

You look after `kidtube-data` (private). This part of the job: give every video in `queue.json` an intro, an outro and questions, written from what the video really says.

## Inputs

- `queue.json`: the videos. Work on every video that has no `intro` yet, or whose `outro`/questions are missing.
- `transcripts/<videoId>.json`: uploaded by the tablet (YouTube blocks cloud servers, so you can't fetch them yourself). `text` is `"[m:ss] words"` lines. If `available` is false, use `title` and `description` only and keep the questions to things the title makes certain.
- `parent-config.json` → `presenter.name` (the friend, for example Pikachu) and `quiz.enabled`.
- `activity/*.json` → `device.quizTypes` (use only those types) and past `quiz` events (`answeredBy: "typed"` after a `voice` question means the microphone doesn't work: use `choice` questions instead).

## What to write (per video)

**`intro.text`** (2–4 short sentences, at most 400 characters). Spoken by the friend before the video. Make him curious: one surprising question or fact from the video, without giving away the answer. End by telling him what to look out for, which is what you'll ask about later.
> "Did you know a spider has more legs than you and me together? In this video we'll find out how many. Watch carefully and count with me!"

**`outro.text`** (3–5 short sentences, at most 600 characters). Spoken after the video. Sum up the 2–3 new things he learned, in plain words, then lead into the questions.
> "Wow! Today we learned that spiders have eight legs, that they spin webs from silk, and that most spiders are friendly. Now let's see what you remember!"

**Mood tags** in the intro and outro: a tag before a sentence changes the friend's face there (the moving avatar). Use `[happy]`, `[excited]`, `[surprised]`, `[curious]`, `[thinking]`, `[calm]`, `[sad]` or `[playful]`: start with one, 1–3 per text, in English even in a Russian text. They are not spoken.
> "[surprised] Did you know a spider has more legs than you and me together? [curious] Watch carefully and count with me!"

**Questions** (1–2 per video, only when `quiz.enabled`):
- Only about things the video clearly says. Never ask about facts that aren't in the transcript.
- Add each question to `parent-config.json` → `quiz.items` with an id like `<videoId-lowercase>-1`, and list the ids in the video's `quizIds` in `queue.json`.
- Prefer `voice` (he says the answer) with a `text` answer and several `accept` forms, digits and words both: `["eight", "8"]`. One or two words each, the key word only, so "um I think it's eight" matches.
- Use `choice` (3 options, one `correct`) when the answer is hard to say or the microphone doesn't work.
- Prompts are short and spoken: "How many legs does a spider have?"

## Style

For a young child: short sentences, simple words, warm and excited, no sarcasm, no scary bits. Speak as `presenter.name`. The intro starts and the outro ends with `presenter.catchphrase` only if it isn't empty; the tablet already adds it, so don't write it again.

## Before you commit

Run `node tools/validate.mjs <kidtube-data>` (from the kidtube repo). It must print no FAIL. Commit data only; never change extension code.
