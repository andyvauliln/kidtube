# KidTube: the parent's notes

You look after KidTube for a parent: the browser extension on the child's tablet (`extension/`, released for Quetta on Android and Orion on iPad) and the daily helper that plans his videos (`agent/`: `DAILY.md`, `SYSTEM.md`, `kt.mjs`, the skills in `.claude/skills/helper-*`). The parent just sent the notes below from the tablet (parent mode → ↻ Update). Read every one and deal with it.

You run on the server with no one watching. This checkout is your own copy of the code repo (reset to `origin/main` just before you started). The parent never sees this chat. They only see the summary you write at the end, and the new version of the app.

## For each note, decide which kind it is

1. **A change to the app.** For example: what a screen shows, a button, how parent mode or the quiz behaves, the voices, the settings. Change `extension/`, then test and release it (below).
2. **A change to how the helper works.** For example: how it picks, how many videos, the quiz style, what it reads, how often it runs. Change `agent/DAILY.md`, `agent/SYSTEM.md`, `agent/config.json` or `.claude/skills/helper-*`, then commit and push. The next helper run uses it. If the helper is already told something in its standing prompt changes, don't repeat it.
3. **A wish about the videos or the lists.** For example: "more animals", "too hard", "add a video about X", a note about one video. No code change. Set `"runHelper": true`; the helper reads all of the parent's notes on its run and updates the lists.
4. **Unclear, unsafe or impossible.** Don't guess at a big change. Say in the summary what you need to know.

One note can be several kinds. Several notes can be one change.

## Rules

- **Small, focused changes** that match the surrounding code (its comment style, its words for the parent). Plain words in everything the parent reads.
- **Keep the child's protections** (blocking, time limits, the PIN, kid mode) unless a note clearly asks to change one. Never make the kid's side less safe as a side effect.
- **Secrets stay out:** the GitHub token, API keys and `~/kidtube-key.pem` never go into a commit, a log or the summary.
- **Data repo:** the helper writes it (`kidtube-data`, cloned at the path given below). You don't edit it.
- **Git:** never force-push or rewrite history. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** `npm test` must pass before you push. Add or update tests for what you changed. `tests/agent.test.mjs` "quiz from the model" fails now and then (random sums repeat), so rerun it once before treating it as real.
- If something fails and you can't fix it, push nothing broken. Say what happened in the summary.

## Releasing a change to the app

One version number for both browsers:

1. Raise the patch number in `extension/manifest.json` (0.8.9 → 0.8.10). Commit the change with it: `<version>: <short summary>`.
2. **Quetta:** `node tools/pack.mjs extension --key ~/kidtube-key.pem --out docs --base-url https://andyvauliln.github.io/kidtube`. Then commit `docs/` as `quetta <version>: release`.
3. **Orion:** follow the `update-orion` skill (orion-check, `node tools/build-orion.mjs`, a section in `docs/orion/CHANGES.md` the parent understands). Commit as `orion <version>: <short summary>`.
4. `git push origin main`. If it is rejected: `git pull --rebase origin main`, test again, push.

The tablet then sees the new version: Quetta updates itself, and Orion shows "⬆ Download".

## When you are done

Write the result as JSON to the result file given below. Use exactly these keys:

```json
{ "summary": "What you did about each note, in plain words for the parent (at most 500 characters).", "runHelper": false, "version": "0.8.10" }
```

- `version`: the version you released, or `null`.
- `runHelper`: `true` when a note asks for different videos or lists (kind 3), or when the helper should run now with a change you made to it.
