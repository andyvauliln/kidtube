i# YouTube Kids Filter & Wrapper — Research and Plan

_Research date: 2026-09-24. Source: public GitHub search (the `gh` CLI is not installed, so this covers public repos only, not private ones)._

## Goal

An app that wraps YouTube for my kids. It filters content based on **my preferences** and shows only videos that match them. It should work on **web** and **Android**.

---

## 1. What already exists on GitHub

### Kid-focused YouTube wrappers and filters

| Project | Stars | Platform / Stack | How it works | Worth borrowing |
|---|---|---|---|---|
| [varshneydevansh/FilterTube](https://github.com/varshneydevansh/FilterTube) | 108 | Browser extension + Android (on Google Play) | Keyword/channel rules and a whitelist mode, applied inside real youtube.com and YouTube Kids. Processing stays on the device. | Rule engine; device-to-device settings sync ("Nanah") |
| [degipe/YouTubeWhitelist](https://github.com/degipe/YouTubeWhitelist) | 4 | Android: Kotlin, Compose, Hilt, Room (GPL-3) | Official YouTube Data API v3 + IFrame player. Parent mode and kid mode, PIN, multiple profiles, time limits, sleep mode, kiosk (screen pinning), JSON export, no backend. | Closest to a design YouTube's terms allow on Android |
| [SecFathy/KidTube](https://github.com/SecFathy/KidTube) | 47 | Flutter | YouTube-like UI. The parent approves videos or channels, can block channels, sets a PIN. SQLite on the device. | Kid UI that looks and feels like YouTube |
| [juanmarques/KidsTube](https://github.com/juanmarques/KidsTube) | 0 | Android, Kotlin multi-module | Channel **RSS feeds** for browsing (cost no API quota), API only for search, 6h search cache, 40+ known kids channels, language preferences | Quota strategy; UI for toddlers |
| [jimsimon/hometube](https://github.com/jimsimon/hometube) | 1 | Self-hosted web (Rust), beta | Allowlisted channels and videos, a preview screen for parents, RSS refresher for new uploads, yt-dlp, watch-activity dashboard, sleep timer, Chromecast, offline downloads | Most complete feature set |
| [noemit/safe-youtube](https://github.com/noemit/safe-youtube) | 3 | PWA (TypeScript) on Vercel | One JSONC config file: blocklist or allowlist mode, category buttons on the home screen, featured channels, a guard against rapid video-hopping | Config parents can edit easily; category buttons; video-hopping guard |
| [gopeter/glotzi](https://github.com/gopeter/glotzi) | 2 | PWA (React/Vite) + Fastify/SQLite server + Capacitor APK | Strict whitelist. The home server downloads approved videos with yt-dlp and kids only play local copies. Offline playback. LAN or VPN only. | Offline mode; **one codebase for web and APK through Capacitor** |
| [adampickering/quietplay](https://github.com/adampickering/quietplay) | 8 | tvOS SwiftUI + Node/Fastify, Postgres, Redis | Hourly yt-dlp ingest of curated channels, Shorts filtered out, stream URLs resolved on demand, admin UI on the LAN | Ingest pipeline design |
| [limelightseychelles-git/KidsTube-filter](https://github.com/limelightseychelles-git/KidsTube-filter) | 5 | React, Node, PostgreSQL, Redis | Channel approval, keyword blocking, watch history, **kid asks for a video → parent approves**, rotation of several API keys | Request/approve flow |
| [dreygur/yt-kids-safe](https://github.com/dreygur/yt-kids-safe) | 6 | Android, Kotlin | Approved channels and playlists, Piped/Invidious backend (no ads), profiles, time limits, categories | Category organization |
| [raveuk/ZimbaBeats](https://github.com/raveuk/ZimbaBeats) | 2 | Android, Compose | Kid app plus a separate "Family" companion app for the parent. **Proprietary license.** Use it for ideas only. | Two-app model (kid device and parent device) |
| [shaikh-amaan-fm/youtube-parental-controlled](https://github.com/shaikh-amaan-fm/youtube-parental-controlled) | 4 | Cordova, Android | Only channels the parent selected | — |
| [Proxy/youtube-safer-streamer](https://github.com/Proxy/youtube-safer-streamer) | 1 | Apple TV + iPhone | Parent approves on the phone, kid watches on the TV | Approval from the phone |

### Network-level parental controls
- [destan19/OpenAppFilter](https://github.com/destan19/OpenAppFilter) (2.9k★): app filtering for OpenWrt routers.
- [relloyd/tubetimeout](https://github.com/relloyd/tubetimeout) (46★): YouTube usage tracker and time limits for the home network.
- [Vladikamira/pihole-parental-control](https://github.com/Vladikamira/pihole-parental-control): Pi-hole DNS limits per day.

### AI / classifier attempts (very immature)
- `thisisarjun/res-analyze`: "classifies and filters youtube videos for kids". The repo is essentially empty.
- `VipulTank/Youtube_Videos_Safe_for_Children_or_Not`: a notebook that transcribes audio with Whisper, summarizes with BART, then classifies.
- `Override92/AiSList` (292★): a blocklist of "AI slop" channels. Could be used as an extra blocklist.
- `microsoftmrinal/cleantube-kids`: filters comments only.

### Building blocks (libraries and reference clients)

| Repo | Stars | License | Use |
|---|---|---|---|
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | 193k | Unlicense | Metadata, channel listings, stream URLs, downloads |
| [LuanRT/YouTube.js](https://github.com/LuanRT/YouTube.js) | 5.3k | MIT | JS client for YouTube's internal API (search, captions, metadata) |
| [TeamNewPipe/NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor) | 2k | GPL-3 | Java/Kotlin extraction library for Android |
| [iv-org/invidious](https://github.com/iv-org/invidious) | 24.7k | AGPL-3 | Alternative YouTube frontend and API |
| [TeamPiped/Piped](https://github.com/TeamPiped/Piped) | 10.3k | AGPL-3 | Alternative YouTube frontend and API |
| [yuliskov/SmartTube](https://github.com/yuliskov/SmartTube) | 34k | MIT | Reference Android TV client |
| [libre-tube/LibreTube](https://github.com/libre-tube/LibreTube) | 12.7k | GPL-3 | Reference Android client |
| [futo-org/grayjay-android](https://github.com/futo-org/grayjay-android) | 1.8k | custom | Reference Android client |

### Takeaway — the gap

Almost every project uses **manual allowlists** or **keyword blocklists**. Nobody has built well **automatic filtering based on the parent's preferences** (an AI scores each video against what the parent described in plain words). That should be the core of our product. The allowlist, PIN, time limits and kiosk mode are solved problems, and we can copy their patterns.

---

## 2. Proposed architecture

```
 Parent app (web)                      Backend (Django or FastAPI)
 ─ preferences in plain words   ──▶    1. Find candidates: allowlisted channels (RSS),
 ─ allow/block channels                   parent's seed searches, related videos
 ─ review queue, 👍/👎 on verdicts       2. Collect data: title, description, tags,
                                          duration, thumbnail, transcript if available
                                       3. Hard rules: no Shorts, max length,
                                          language, blocklists
                                       4. AI scoring against the parent's preferences
                                          → approve / reject / "ask parent" + reason
                                       5. Cache the verdict per video ID
                                                 │
 Kid app (PWA / Android)  ◀── approved feed only ┘
 ─ feed, player, no search outside the approved pool
```

### Preference model
The preferences have two parts:
- **Fixed settings:** kid's age, allowed languages, max video duration, Shorts on/off, daily time limit, bedtime.
- **Free text:** for example, "science, animals and building things; calm pacing; no prank or challenge videos, no toy unboxing, no loud clickbait thumbnails; Russian or English."

**Feedback loop:** the parent's 👍/👎 on verdicts are saved as examples that go into the scoring prompt, so the filter learns the family's taste over time.

### AI scoring
- **Model:** a small, cheap Claude model (Haiku class).
- **Input:** the video's title, description, tags, channel and duration, plus the thumbnail (image). Use the transcript when available.
- **Output:** structured JSON: `score`, `verdict` (approve / reject / review), `reason`, and which of the parent's rules matched.
- **Caching:** each video ID is scored once, so costs stay very low.
- **Channel trust:** allowlisted channels skip AI review, and blocked channels are always rejected.
- **"Ask parent" queue:** videos the AI is unsure about wait for the parent's decision.

---

## 3. Getting videos and playing them

| Approach | Pros | Cons |
|---|---|---|
| **A. Official YouTube Data API v3 + IFrame/embedded player** (recommended) | Allowed by YouTube's terms; can be published on Google Play | Daily limit of 10,000 API units, and one search costs 100 of them. Use RSS feeds and caching to stay under it. The player can link out to YouTube (logo, end screens), so the app must block that navigation. |
| **B. yt-dlp / YouTube.js / NewPipeExtractor** | No ads, offline downloads, full control of the player | Against YouTube's terms, breaks often when YouTube changes, can't be published on Play (sideload only). Fine for private family use. |

**Decision:** start with A. Offer B later as an optional "offline mode" in private builds only.

---

## 4. Platforms: web and Android from one codebase

1. **PWA first** (React or Svelte, served by the backend). It works on any tablet, laptop or TV browser.
2. **Android through a Capacitor wrapper** around the same PWA (the pattern from `gopeter/glotzi`), adding:
   - Screen pinning / lock-task mode (kiosk) so the kid can't leave the app.
   - Blocking every navigation to youtube.com inside the app's web view, which closes the "leave via the YouTube logo" hole.
   - An optional home-screen launcher mode.
   - On-device storage for offline videos.
3. **Native Kotlin later**, only if needed (for example, for Android TV). `degipe/YouTubeWhitelist` is a good reference.

### Enforcement outside the app
A web app alone can't stop a kid from opening YouTube itself. On the kid's devices:
- Use Google Family Link or Android device-owner mode to hide or block the YouTube app.
- Block youtube.com at the DNS level with NextDNS or the router, allowing only what the embedded player needs.

---

## 5. Build phases

1. **MVP (about 1–2 weeks)**
   - Data models: Profile, Preferences, Channel (allowed/blocked), Video, Verdict, WatchLog.
   - Channel ingest from RSS feeds, and a parent page for allowlisting channels.
   - Kid PWA: feed and embedded player, with a PIN-protected parent area.
2. **AI filter**
   - Preference editor.
   - Background scoring worker (Celery or cron) with verdict caching.
   - Parent review queue: approve or reject, with the AI's reason shown.
   - 👍/👎 feedback loop.
3. **Discovery**
   - The parent's seed topics and searches run on a schedule (to save quota), and the AI filters the results.
   - Kid can ask for a video, and the parent gets a notification to approve it.
4. **Android**
   - Capacitor APK with kiosk mode and navigation blocking.
   - Time limits, bedtime fade-out, watch statistics.
5. **Optional**
   - Transcripts for better scoring.
   - Several kids, each with their own preference profile.
   - Offline downloads (private builds only).
   - Android TV client.

---

## 6. Open questions

- **Play Store or sideloading?** Publishing on Play requires approach A only.
- **Backend or not?** Is a server OK, or should the kid app work fully on the device with no server (like `degipe/YouTubeWhitelist`)? The AI scoring works best with a backend.
- **Where to host?** It could live inside the existing Django site (`/home/superuser/site`) as a separate Django app, or in its own repo. The recommendation is its own repo, so the kids' product stays isolated.
- **Languages** to support in the content and in the UI.
