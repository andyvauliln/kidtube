// What the helper asks the model, and how each answer is checked before it is used.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WRITING_GUIDE = readFileSync(fileURLToPath(new URL('../PROMPT.md', import.meta.url)), 'utf8');

const BASE = `You are the KidTube helper. You plan YouTube videos for a 4–5-year-old child and write what the talking friend says before and after each video.
Rules:
- The parent's words (wishes page, messages, comments) always win over your own ideas.
- Only calm, kind, age-appropriate videos that teach something or tell a good story. No pranks, screaming, scary things, toy unboxing, ads or clickbait.
- Reply with one JSON object only, no other text.`;

const day = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// 1. What does the parent want now? → numbers and searches.
export function understandPrompt({ today, wishes, about, noticed, plan, news, backlog, comments }) {
  return {
    system: BASE,
    user: `Today is ${day(today)}.

# Parent's wishes and settings (Notion)
${wishes || '(empty)'}

# About the child (written by the parent)
${about || '(empty)'}

# What the helper noticed before
${noticed || '(nothing yet)'}

# Study plan
${plan || '(none yet)'}

# Since the last run
New messages from the parent: ${JSON.stringify(news.wishes)}
Parent comments on videos: ${JSON.stringify(comments)}
Watched: ${JSON.stringify(news.watched.slice(-30))}
Quiz answers: ${JSON.stringify(news.quiz.slice(-30))}
Thumbs and notes from the tablet: ${JSON.stringify(news.notes)}

# Videos already planned (id | language | status | title | topics)
${backlog || '(none)'}

Decide what to look for on YouTube today. Follow "Today", "This week" and "This month" in the wishes, the study plan, and the language rules. Plan searches that find NEW videos for the next days; mark a search mustWatch "today" or "yes" only when the parent asked for that topic to be required.
Reply JSON:
{
  "summary": "2–3 sentences: what the parent wants right now, in plain words",
  "videosPerDay": 6,
  "newIdeas": 6,
  "languageMins": { "ru": 2 },
  "requiredFirst": "first",
  "minMinutes": 3,
  "maxMinutes": 15,
  "searches": [ { "query": "YouTube search words, in the video's language", "lang": "en", "topic": "short topic", "mustWatch": null, "why": "which wish this serves" } ],
  "avoid": [ "things not to pick" ]
}
Numbers come from the "Numbers" section when given. 4–8 searches, each a plain YouTube search (for example "numberblocks adding to 10" or "мультик про дружбу для малышей").`,
    check: (o) => (!Array.isArray(o.searches) || !o.searches.length ? 'searches must be a non-empty array'
      : o.searches.some((s) => typeof s?.query !== 'string' || !s.query.trim()) ? 'every search needs a query'
      : null),
  };
}

// 2. Which search results become ideas?
export function choosePrompt({ want, candidates, about, noticed, backlog, newIdeas }) {
  const ids = new Set(candidates.map((c) => c.videoId));
  return {
    system: BASE,
    user: `# What the parent wants now
${want.summary}
Avoid: ${JSON.stringify(want.avoid ?? [])}

# About the child
${about || '(empty)'}

# What the helper noticed
${noticed || '(nothing yet)'}

# Already planned (don't pick the same topic twice in a row)
${backlog || '(none)'}

# Search results (videoId | language | minutes | channel | title | found by search)
${candidates.map((c) => `${c.videoId} | ${c.lang} | ${Math.round(c.durationSeconds / 60)} | ${c.channelTitle} | ${c.title} | ${c.search.query}${c.search.mustWatch ? ` (must watch: ${c.search.mustWatch})` : ''}`).join('\n')}

Pick up to ${newIdeas} videos that fit best. Prefer well-known children's education channels, clear teaching, calm pace, and variety. Skip anything that looks like clickbait, a compilation of hours, a prank, a toy ad, or not for small children.
Reply JSON:
{
  "picks": [ { "videoId": "…", "why": "one sentence for the parent: why this video fits his wishes", "topics": ["numbers"], "lang": "en", "mustWatch": null } ],
  "badChannels": [ { "channelTitle": "…", "reason": "…" } ]
}
mustWatch is "today", "yes" or null; keep the value of the search that found it unless you have a reason.`,
    check: (o) => (!Array.isArray(o.picks) ? 'picks must be an array'
      : o.picks.some((p) => !ids.has(p?.videoId)) ? `every videoId must be one of the search results (${o.picks.find((p) => !ids.has(p?.videoId))?.videoId} is not)`
      : null),
  };
}

// A spoken answer a small child can give: 1–2 short words, or a whole number up to 20.
export function tooHard(quiz) {
  for (const q of Array.isArray(quiz) ? quiz : []) {
    for (const a of [...(q?.accept ?? []), ...(q?.options ?? [])].map(String)) {
      const words = a.trim().split(/\s+/);
      if (words.length > 2 || a.length > 20) return a;
      if (/\d/.test(a) && !(/^\d+$/.test(a) && Number(a) <= 20)) return a;
    }
  }
  return null;
}

// 3. The talking friend's words and the quiz for one video.
export function contentPrompt({ video, transcript, friend, about, want, templates, quizOn, maxQuestions }) {
  const ru = (video.lang ?? 'en').startsWith('ru');
  return {
    system: `${BASE}\n\n${WRITING_GUIDE}`,
    user: `# The video
Title: ${video.title}
Channel: ${video.channelTitle}
Length: ${Math.round(video.durationSeconds / 60)} minutes
Language: ${ru ? 'Russian — write everything (summary, intro, outro, talking points, questions) in Russian' : 'English — write everything in English'}
Why it was chosen: ${video.why ?? ''}

# Transcript
${transcript?.available ? transcript.text.slice(0, 24000) : '(not available yet — write from the title only, keep it general and do not invent details; questions only about what the title makes certain)'}
${transcript?.onScreen ? `\n# What is shown on screen\n${transcript.onScreen.slice(0, 6000)}\n(You may ask about clearly shown things too, e.g. colours, how many, which animal.)` : ''}

# The talking friend
Name: ${friend.name}. Speaks as ${friend.name}, warm and excited, short sentences.

# About the child
${about || '(empty)'}

# What the parent wants now
${want.summary ?? ''}

# Quiz templates you can use${quizOn ? '' : ' (quiz is OFF: return "quiz": [])'}
${templates.map((t) => `- ${t.id}: ${t.title} — ${t.howItWorks} Params: ${JSON.stringify(t.params ?? {})}. Example: ${t.example}`).join('\n')}

Reply JSON:
{
  "summary": "3–5 sentences for the parent: what the video shows",
  "learned": ["2–4 new things he learns, short"],
  "intro": "2–4 short sentences, at most 400 characters, makes him curious without giving the answer, tells him what to look out for",
  "outro": "3–5 short sentences, at most 600 characters: sums up what he learned, then leads into the questions",
  "talkAbout": ["2–4 things the parent can talk about with him after"],
  "quiz": [ { "template": "video-voice", "prompt": "…", "accept": ["…"] } ]
}
Quiz: at most ${maxQuestions} questions.${transcript?.available ? '' : ' There is no transcript yet: return "quiz": [] unless it is a math video (then use only the math templates); the questions are written later from the transcript.'} For math videos use the math templates (add, subtract, next-number, number-before, bigger) with "params": {"max": N} and optional "count". For other videos use video-voice (one- or two-word answers, several accepted forms) or video-choice ("options" and "correct"). Only ask about things the video really says.
He is 4–5 years old: the intro, outro and questions use only words a small child knows. Skip hard facts from the video (scientific terms like "nucleus" or "hemoglobin", big numbers, shape names like "trapezoid"); ask about the simple, memorable things instead (what it is made of, what colour, which animal, how many up to 10, what to do).
Answers he says must be 1–2 everyday words or a number up to 20.
Do not start the intro or end the outro with a catchphrase or the friend's name; the tablet adds it.`,
    check: (o) => (typeof o.intro !== 'string' || !o.intro.trim() ? 'intro is missing'
      : o.intro.length > 450 ? 'intro is longer than 400 characters'
      : typeof o.outro !== 'string' || !o.outro.trim() ? 'outro is missing'
      : o.outro.length > 600 ? 'outro is longer than 600 characters'
      : typeof o.summary !== 'string' ? 'summary is missing'
      : ru && !/[а-яё]/i.test(o.intro) ? 'the video is Russian: write the intro in Russian'
      : tooHard(o.quiz) ? `this answer is too hard for a 4-year-old: "${tooHard(o.quiz)}" (use 1–2 everyday words or a number up to 20)`
      : null),
  };
}

// 4. What the helper noticed (always) and the study plan (first run, weekly, or when asked).
export function notesPrompt({ today, wishes, about, noticed, plan, news, comments, planComments, rewritePlan, journal, rules }) {
  return {
    system: BASE,
    user: `Today is ${day(today)}.

# Parent's wishes
${wishes || '(empty)'}

# About the child (by the parent)
${about || '(empty)'}

# What the helper noticed so far
${noticed || '(nothing yet)'}

# Current study plan
${plan || '(none yet)'}

# Rules the parent set on the tablet (the plan must fit them, never contradict them)
${JSON.stringify(rules ?? {})}

# Parent comments on the study plan
${JSON.stringify(planComments ?? [])}

# Since the last run
Messages: ${JSON.stringify(news.wishes)}
Comments on videos: ${JSON.stringify(comments)}
Watched: ${JSON.stringify(news.watched.slice(-30))}
Quiz: ${JSON.stringify(news.quiz.slice(-30))}
Thumbs/notes: ${JSON.stringify(news.notes)}
What the helper did today: ${journal}

Reply JSON:
{
  "noticed": "Markdown for the page 'What the helper noticed': ## What he likes, ## What he doesn't like, ## How he does with questions (by skill), ## Parent's preferences I learned, ## Open questions for the parent. Keep everything still true from before, add what is new, short bullet points. Only write what the data shows; tests by the parent (very short watches right after a video was added) are not the child's taste.",
  "plan": ${rewritePlan ? '"Markdown for the page \'Study plan\': a realistic plan for a 4–5-year-old for the next 4 weeks built from the wishes: ## Goals, ## This week (day by day topics), ## Weeks 2–4, ## How we check progress (which quiz templates), ## How screen time stays healthy. Follow the parent\'s comments on the plan."' : 'null'},
  "diary": "2–4 sentences for the parent: what changed today and why"
}`,
    check: (o) => (typeof o.noticed !== 'string' || o.noticed.length < 20 ? 'noticed must be Markdown text'
      : rewritePlan && (typeof o.plan !== 'string' || o.plan.length < 100) ? 'plan must be Markdown text'
      : typeof o.diary !== 'string' ? 'diary is missing' : null),
  };
}
