# Custom Apps (KidTube, Instagram): rules for every Claude session in this repo

The server's agents (`agent/FIX.md`, `agent/NOTES.md`) and chat sessions all push to `main`. They take turns through
one command; details: `docs/UPDATES.md` section 9.

- **Push with `npm run ship -- -m "<short summary>"`**, after you commit. It waits for the other writers (a lock on
  this server), rebases on `origin/main`, gives `extension/` the next free version, runs `npm test`, pushes the code,
  then makes the Quetta release on top of it and pushes that. It stops when a rebase or a test needs you: solve it
  (keep both changes), then run it again. Never force-push.
- **Don't** change the version in `extension/manifest.json` or the release files in `site/` (`latest.json`,
  `updates.xml`, `.crx`, `.zip`, `site/orion/`) yourself: `ship` makes them. The hook `.githooks/pre-push` refuses a
  push that breaks this (`npm install` turns it on: `git config core.hooksPath .githooks`).
- **Chat sessions release Quetta after every change set** to `extension/` (the parent's standing wish): that is what
  `ship` does. **Orion only when the parent asks:** add `--orion` (the `update-orion` skill says what to check).
  The agents follow their own files for this.
- **Commit messages** end with the `Co-Authored-By` line; `ship` copies it to its own commits.
