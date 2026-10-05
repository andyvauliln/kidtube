---
name: update-orion
description: Build and publish the Orion (iPad/iPhone/Mac) version of KidTube from the current extension/ code. Use when the user says "update orion", "release orion", "build for orion", "orion based on the latest changes" or similar.
---

# Update the Orion build

`extension/` is the one source. It is developed and released for Quetta (Android) as usual. The Orion build is made from that same code **only when the user asks**, so Orion's version can lag behind Quetta's.

The Orion build differs only in two ways, both done by `tools/build-orion.mjs`:
- `lib/target.js` gets `TARGET = 'orion'`. Code that must behave differently checks `TARGET` (today: no blocking rules, manual updates, its own `orion/latest.json`).
- The manifest has no `update_url`, no `minimum_chrome_version`, and no `declarativeNetRequest` permission.

The published files are in `docs/orion/`: `kidtube-orion-<version>.zip`, the same file as `kidtube-orion.zip` (a link that never changes, always the newest build) and `latest.json`, which records `sourceCommit` and `sourceHash`. The install page (`docs/index.html#orion`) links to them.

## Steps

1. **Start clean.**
   - Run `git status` and `git pull --rebase`.
   - If `extension/` has uncommitted changes, ask the user whether they belong in this release. Then commit them, or stop. The build refuses a dirty `extension/`.

2. **What changed since the last Orion build.**
   - Read `docs/orion/latest.json`; it has the previous `version` and `sourceCommit`.
   - Run `git log --oneline <sourceCommit>..HEAD -- extension/` and `git diff --stat <sourceCommit> HEAD -- extension/`.
   - If nothing changed in `extension/`, tell the user Orion is already up to date and stop.
   - Otherwise, summarize the changes for the user in a few plain bullets.

3. **Check Orion compatibility.**
   - Run `node tools/orion-check.mjs`.
     - `✗` (error): a `chrome.*` API Orion lacks. Fix it before releasing. Either put it behind `TARGET !== 'orion'` (import from `lib/target.js`), or make it optional with `?.` and a fallback. Then add it to `HANDLED` in `tools/orion-check.mjs` with a one-line reason.
     - `?` (warning): partial or not in Orion's table. Look at the call; prefer a fallback. Tell the user it needs a check on the iPad.
   - Read the diff for things the API check can't see. Mention any that appear:
     - manifest changes: permissions, content scripts, `world`, `web_accessible_resources`;
     - new reliance on blocking a page *before* it loads;
     - speech recognition, the microphone, Cache Storage, fullscreen;
     - background timing: on iPad Orion is frozen when not on screen.
   - If a change needs different behaviour on Orion, branch on `TARGET` in the source. **Never edit the Orion output by hand.**

4. **Test.** Run `npm test`. It includes `tests/orion-build.test.mjs`, which builds Orion into a temp dir and runs its service worker. `tests/agent.test.mjs` "quiz from the model" is known to fail now and then (random sums can repeat); rerun once before treating it as real.

5. **Version.**
   - A version number means one set of files, whichever browser it was released for.
   - If the build says `bump "version"`, raise the patch number in `extension/manifest.json` (0.6.2 → 0.6.3). Commit it as `<version>: version for the Orion build`.
   - That version is also used by the next Quetta release.

6. **Build.** Run `node tools/build-orion.mjs`. It prints the new `latest.json`; check `version` and `zipUrl`.

7. **Record it.** Add a section to the top of `docs/orion/CHANGES.md`: `## <version> (YYYY-MM-DD)`, then plain bullets the parent understands, from step 2.

8. **Commit and push.**
   - Commit `docs/orion/` and any source fixes as `orion <version>: <short summary>`.
   - Push to `origin main` over HTTPS (see the GitHub access memory).
   - GitHub Pages serves `docs/`. Within a few minutes, `curl -s https://andyvauliln.github.io/kidtube/orion/latest.json` should show the new version; check it.

9. **Tell the user:**
   - the version, and what changed (step 2);
   - any compatibility notes (step 3) and anything to test on the iPad;
   - on the iPad: open the install page → **Download for Orion (.zip)** → Orion → Extensions → **+** → install from file; then check that the PIN and GitHub key are still set.

## Don't

- Don't release Quetta from this skill. `docs/latest.json`, `updates.xml` and the `.crx` are the Quetta release (`tools/pack.mjs` with the signing key).
- Don't copy Orion-only changes into a separate source tree. All differences live in `extension/` behind `TARGET`, or in `orionManifest()` in `tools/build-orion.mjs`.
- Don't refresh `tools/orion-apis.json` without saying so. It is a dated snapshot of Kagi's table. When updating it, regenerate from the sheet and change `snapshot`.
