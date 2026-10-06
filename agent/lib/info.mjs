// helper.json in the data repo: what the helper is and how it works, for the parent screens (Prompt tab).
// Made from the real files every run (the prompt, agent/config.json, the toolkit's command list), so it always
// matches what runs. No secrets: config.json holds none (keys are in the env file).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const iso = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z');

// where: the profile of this run (agent/lib/profile.mjs locate): its app's prompts and its own defaults.
export function helperInfo(root, config, where = {}) {
  // What the helper reads: the system prompt, the steps, and the step details (skills), in that order.
  const skills = ['helper-find-videos', 'helper-write-words', 'helper-notes'].map((n) => {
    const f = join(root, '.claude/skills', n, 'SKILL.md');
    return existsSync(f) ? { name: n, text: readFileSync(f, 'utf8').replace(/^---[\s\S]*?---\n/, '').trim() } : null;
  }).filter(Boolean);
  const app = where.appConfig ?? {};
  const prompt = [readFileSync(join(root, app.system ?? 'agent/SYSTEM.md'), 'utf8'), readFileSync(join(root, app.daily ?? 'agent/DAILY.md'), 'utf8')].join('\n\n');
  const commands = readFileSync(join(root, 'agent/kt.mjs'), 'utf8').split('\n')
    .map((l) => l.match(/^\/\/\s+node agent\/kt\.mjs (\S+)(.*?)\s{2,}(\S.*)$/)).filter(Boolean)
    .map(([, cmd, args, what]) => ({ command: `${cmd}${args}`.trim(), what: what.trim() }));
  const speak = config.voices?.speak ?? {};
  return {
    schemaVersion: 1,
    updatedAt: iso(),
    prompt, skills,
    run: {
      schedule: config.schedule ?? '30 3 * * *', timezone: config.timezone ?? 'UTC',
      runner: config.orchestrator?.runner ?? 'claude', model: config.orchestrator?.model ?? 'sonnet', maxTurns: config.orchestrator?.maxTurns ?? null,
      fallbackToNode: !!config.orchestrator?.fallbackToNode,
      tools: ['node agent/kt.mjs (its toolkit, below)', 'Read (files)'],
    },
    commands,
    defaults: where.defaults ?? config.defaults ?? {},
    ...(where.profile ? { profile: where.profile.path } : {}),
    transcripts: { provider: config.transcripts?.provider ?? 'gemini', maxVideosPerDay: config.transcripts?.maxVideosPerDay, maxMinutesPerDay: config.transcripts?.maxMinutesPerDay,
      secondsPerRequest: config.transcripts?.secondsPerRequest, models: config.transcripts?.models ?? [] },
    voices: { provider: speak.provider ?? 'device', voice: speak.voice ?? null, maxMinutes: speak.maxMinutes ?? null, style: speak.style ?? '',
      models: speak[speak.provider]?.models ?? [] },
    backupText: { mode: config.openrouter?.mode ?? 'free-first', preferred: config.llm?.preferred ?? [], paidModel: config.llm?.paidModel ?? null, maxCallsPerRun: config.llm?.maxCallsPerRun ?? null },
    reads: ['activity/<day>.json from the tablets: what he watched, his answers, your thumbs, notes, messages and plan changes',
      'memory.json: your earlier messages, what it noticed, its study plan and diary',
      'YouTube search (from the server)', 'transcripts/ (from Gemini or the tablet)'],
    writes: ['queue.json: today’s list and the planned videos', 'parent-config.json: the questions and the must-watch order', 'memory.json: everything it knows about each video, your messages, what it noticed, the study plan, the diary, your prompt changes',
      'transcripts/ and audio/ (the friend’s recorded voice)', 'helper.json: this description'],
  };
}
