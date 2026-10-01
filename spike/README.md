# M0 spike: does Quetta do what the plan needs?

A throwaway extension that checks the go/no-go items from PLAN.md §6 (M0) and records each result in a report on its options page. It is not the product.

## Build (once)

```bash
npm install
node tools/keygen.mjs ~/kidtube-key.pem      # prints the extension id and the manifest "key"; keep the .pem out of git
```

1. Paste the printed `manifest "key"` into `spike/manifest.json` → `"key"`.
2. Replace `OWNER` in `update_url` with your GitHub user. Turn on GitHub Pages for the public `kidtube` repo.
3. Pack:
   ```bash
   node tools/pack.mjs spike --key ~/kidtube-key.pem --out dist --base-url https://OWNER.github.io/kidtube
   ```
4. Upload `dist/*` (the CRX, `updates.xml`, `latest.json`) to the Pages site.

## On the tablet

1. Install `kidtube-spike-0.0.1.crx` in Quetta. Write down the id it shows. It must match the id from keygen.
2. Open the extension's options page and follow the "Manual steps" list there.
3. Update test: change `"version"` to `0.0.2`, pack again, upload, then press **requestUpdateCheck()** on the tablet.
4. Press **Copy report** and save the JSON. Record the result in the table below.

| Check | Result |
|---|---|
| CRX installs; id equals keygen id | |
| Badge on m.youtube.com and www.youtube.com (`content_isolated_*`, `content_main_*`) | |
| `mainWorldPushState` counts SPA navigation | |
| Channel tap → back to home (`guardRedirects`) | |
| Fullscreen: `frameVisible` value | |
| Site allowlist ON blocks wikipedia.org | |
| doubleclick.net blocked | |
| `alarmFires` grows in the background | |
| `githubFetch` status 200 | |
| `requestUpdateCheck` status, and whether 0.0.2 installed | |
| Incognito: extension runs? can it be disabled? | |
| Removing the extension: how easy is it for a kid? | |

**Go** = everything except incognito and remove works. **If update fails**, M5 uses the "Install vX →" fallback as its main path (PLAN.md C24).
