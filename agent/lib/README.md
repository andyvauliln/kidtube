# agent/lib/

The helper's modules. `kt.mjs` and `run.mjs` use them.

| File | What it does |
| --- | --- |
| `data.mjs` | The private data repo: the helper's own git clone, reading and writing its files |
| `profile.mjs` | Profiles: one folder per child (`<app>/<folder>/`), which ones to run (`config.json` `profiles`), new profiles' starter files |
| `plan.mjs` | Bookkeeping without network: what he watched, which videos go on today's list, the parent's plan events |
| `prompts.mjs` | What the helper asks a model, and how each answer is checked before it is used |
| `quiz.mjs` | Quiz templates: math made by code (always right), video questions written by the model and checked here |
| `llm.mjs` | OpenRouter text models, free ones first, rotating away from models that fail |
| `gemini.mjs` | Transcripts from Gemini (Google opens the public video), with daily limits |
| `voices.mjs` | The friend's recorded voice: Groq (English), Gemini, or OpenRouter; quotas and fallbacks |
| `info.mjs` | `helper.json`: how the helper works, for parent mode → Prompt |
