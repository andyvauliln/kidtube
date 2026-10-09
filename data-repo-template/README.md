# data-repo-template/

What a new private data repo (`kidtube-data`) starts from.

| Item | What it is |
| --- | --- |
| `.github/workflows/validate.yml` | CI for the data repo: checks every push from the helper or the tablet with `tools/validate.mjs` |
| `kidtube/` | Starter files of a new KidTube profile; the helper copies what is missing into `kidtube/<folder>/` (see `kidtube/README.md`) |

The data repo's layout: `<app>/<folder>/` per profile (for example `kidtube/johnnypitt.ind/`), and
`<app>/keys.json` for keys every profile of the app shares.
