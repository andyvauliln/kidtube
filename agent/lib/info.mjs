// helper.json in the data repo: what the helper is and how it works, for the parent screens (Prompt tab).
// Made from the real files every run (the prompt, agent/config.json, the toolkit's command list), so it always
// matches what runs. No secrets: config.json holds none (keys are in the env file).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const iso = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z');

export function helperInfo(root, config) {
  const prompt = readFileSync(join(root, 'agent/DAILY.md'), 'utf8');
  const commands = readFileSync(join(root, 'agent/kt.mjs'), 'utf8').split('\n')
    .map((l) => l.match(/^\/\/\s+node agent\/kt\.mjs (\S+)(.*?)\s{2,}(\S.*)$/)).filter(Boolean)
    .map(([, cmd, args, what]) => ({ command: `${cmd}${args}`.trim(), what: what.trim() }));
  const speak = config.voices?.speak ?? {};
  return {
    schemaVersion: 1,
    updatedAt: iso(),
    prompt,
    run: {
      schedule: config.schedule ?? '30 3 * * *', timezone: config.timezone ?? 'UTC',
      runner: config.orchestrator?.runner ?? 'claude', model: config.orchestrator?.model ?? 'sonnet', maxTurns: config.orchestrator?.maxTurns ?? null,
      fallbackToNode: !!config.orchestrator?.fallbackToNode,
      tools: ['node agent/kt.mjs (its toolkit, below)', 'Read (files)', 'Notion (Kids Content Manager)'],
    },
    commands,
    defaults: config.defaults ?? {},
    transcripts: { provider: config.transcripts?.provider ?? 'gemini', maxVideosPerDay: config.transcripts?.maxVideosPerDay, maxMinutesPerDay: config.transcripts?.maxMinutesPerDay,
      secondsPerRequest: config.transcripts?.secondsPerRequest, models: config.transcripts?.models ?? [] },
    voices: { provider: speak.provider ?? 'device', voice: speak.voice ?? null, maxMinutes: speak.maxMinutes ?? null, style: speak.style ?? '',
      models: speak[speak.provider]?.models ?? [] },
    backupText: { mode: config.openrouter?.mode ?? 'free-first', preferred: config.llm?.preferred ?? [], paidModel: config.llm?.paidModel ?? null, maxCallsPerRun: config.llm?.maxCallsPerRun ?? null },
    reads: ['activity/<day>.json from the tablets: what he watched, his answers, your thumbs, notes, messages and plan changes',
      'Notion: Wishes and settings, About him, What the helper noticed, Study plan, the Videos table and comments, Quiz templates',
      'YouTube search (from the server)', 'transcripts/ (from Gemini or the tablet)'],
    writes: ['queue.json: today’s list and the planned videos', 'parent-config.json: the questions and the must-watch order', 'memory.json: everything it knows about each video, the diary, your prompt changes',
      'transcripts/ and audio/ (the friend’s recorded voice)', 'Notion: the Videos table and pages, What the helper noticed, Study plan, Helper diary', 'helper.json: this description'],
  };
}
