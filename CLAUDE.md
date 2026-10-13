# Custom Apps (KidTube, Instagram): rules for every Claude session in this repo

The server's agents (`agent/FIX.md`, `agent/NOTES.md`) and chat sessions all push to `main`. Nobody locks the others.

- **Before a push:** `git fetch origin && git rebase origin/main`, solve conflicts by keeping both changes, `npm test`,
  then `git push origin main`. Refused: do it again. Never force-push. Details: `docs/UPDATES.md` section 9.
- **Version:** one patch number above the newest on `main` (`site/latest.json`). A rebase that stops on
  `extension/manifest.json` → the next free number, and the same number in the commit message.
- **Release last:** push the code first; then `npm run release:quetta`, `git add -A site`, commit
  `quetta <version>: release`, push. Never solve a conflict in `site/` by hand: abort, reset to `origin/main`, make
  the release again. Orion: the `update-orion` skill. Steps: `agent/NOTES.md` → "Releasing a change to the app".
- **Commit messages** end with the `Co-Authored-By` line.
