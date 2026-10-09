# tools/

Developer tools. The helper on the server uses them too.

| File | What it does |
| --- | --- |
| `validate.mjs` | Checks the data files the helper and the tablet exchange: the schemas in `schemas/` plus checks across files. `npm run validate -- <data-dir>` (a profile folder, or a whole data repo) |
| `video-info.mjs` | Real title, channel and length from YouTube's watch page, so list entries are never guessed. `node tools/video-info.mjs <videoId>` or `--search "query"` |
