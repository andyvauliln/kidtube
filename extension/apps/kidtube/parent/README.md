# extension/apps/kidtube/parent/

Parent mode: KidTube's parent screens (`parent.html`, opened after the PIN). The apps header sits on top.

| File | What it is |
| --- | --- |
| `parent.html` + `parent.js` | The tabs: **Today** (his list, stats, removed videos), **Planned** (the helper's next videos), **History** (by day), **Context** (the helper's documents and your notes), **Prompt** (how the helper works, your standing instructions), and a video's details with its quiz |
| `settings.js` + `settings.css` | The **Settings** tab: update and status, hours and minutes, sites, the talking friend, hearing (listening keys), the PIN. Changes wait in a save bar |
| `kit.js` | Pieces both use: elements, buttons, the toast, the notes for the AI (the 🎤 button and the notes card). The card's **📄 This screen** and **⚙️ App data** switches attach the screen's text and the app's state to the next notes |
| `markdown.js` | A small Markdown renderer for the helper's prompt (builds DOM nodes, no `innerHTML`) |
| `parent.css` | Styles of the parent screens; `settings.css` adds the settings view |

Changes go to the background (`plan`, `saveRules`, `note`...). They work on this tablet at once and reach the
helper through the data repo. Notes for the AI wait on the tablet until **↻ Update** in the bottom bar.
