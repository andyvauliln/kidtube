// The checks in the service worker: what must be true after a start, after each message, and what the pages report.
// Each check has an id, an area, the words for what it expects (expect), where its code is (code), and a function
// that fills an Expect (kit.js). A failure becomes a report with everything needed to reproduce it: the mismatch
// lines, the evidence, the browser and build, the profile and mode, the page, and the last steps before it.
// Results and reports stay on this tablet (storage key "checks"; parent mode and "Check this browser" show them).
// This module imports no other background module: main.js hands it the checks (registerChecks), and store.js
// and sync.js report through it, so there is no import cycle.
import { TARGET } from '../lib/target.js';
import { Expect, redact, safeUrl, fingerprint, clip } from './kit.js';
import { getRepoFile, putRepoFile } from '../lib/github.js';
import { DEFAULT_REPO } from '../background/constants.js';

// --- what is registered ---------------------------------------------------------------------------------------
const START = [];        // { id, area, expect, code, net, run(t, ctx) }
const ACTIONS = {};      // message type → { area, expect, code, snap, check(t, c), later: { ms, check(t, c) } }
export function registerChecks({ start = [], actions = {} } = {}) {
  START.push(...start);
  for (const [type, def] of Object.entries(actions)) {
    if (ACTIONS[type]) throw new Error(`two checks for the message "${type}"`);
    ACTIONS[type] = def;
  }
}
export const startChecks = () => [...START];
export const actionChecks = () => ({ ...ACTIONS });

// --- the results, kept in chrome.storage.local "checks" -----------------------------------------------------------
// results: the newest result of each check. reports: the failures, newest last (one per fingerprint; a repeat
// counts up here only; sentAt: when GitHub got it). start: the last run of the start checks. seen: when parent mode
// last showed the reports. device: this tablet's id in the reports.
const MAX_REPORTS = 30;
let book = null, saving = null;
async function load() {
  if (!book) {
    const { checks } = await chrome.storage.local.get('checks');
    book ??= { results: {}, reports: [], start: null, seen: null, last: null, ...(checks ?? {}) };
  }
  return book;
}
function save() {
  clearTimeout(saving);
  saving = setTimeout(() => { if (book) chrome.storage.local.set({ checks: book }).catch(() => {}); }, 300);
}
// For the tests: write now.
export async function flushChecks() { clearTimeout(saving); if (book) await chrome.storage.local.set({ checks: book }); }
export function forgetChecks() { book = null; steps.length = 0; }

// --- the last steps: what happened just before a failure ----------------------------------------------------------
// The background's own (the messages it answered) and the page's (taps, page changes), merged by time in a report.
// Kept in chrome.storage.session, so a restarted worker still has them; gone when the browser restarts.
const MAX_STEPS = 40;
const steps = [];
const session = chrome.storage?.session;
let stepsLoaded = session ? session.get('checkSteps').then((g) => { steps.unshift(...(g.checkSteps ?? [])); }).catch(() => {}) : Promise.resolve();
let stepsSaving = null;
export function step(s) {
  const last = steps.at(-1);
  // The same thing again (an account report every 10 s): counted, not repeated.
  if (last && last.kind === s.kind && last.type === s.type && last.label === s.label && last.ok === s.ok && last.from === s.from) last.n = (last.n ?? 1) + 1;
  else steps.push({ at: new Date().toISOString(), ...s });
  steps.splice(0, Math.max(0, steps.length - MAX_STEPS));
  clearTimeout(stepsSaving);
  stepsSaving = setTimeout(() => session?.set({ checkSteps: steps }).catch(() => {}), 1000);
}
export const stepsNow = () => steps.map((s) => ({ ...s }));

// --- the situation at the moment of a failure ---------------------------------------------------------------------
const workerStart = new Date().toISOString();
export async function contextNow(sender) {
  const g = await chrome.storage.local.get(['settings', 'account', 'shell', 'ytAccount', 'syncStatus', 'dnrWorks', 'bgStuck']);
  const st = g.settings ?? {};
  const m = chrome.runtime.getManifest();
  const yt = g.ytAccount ?? null;
  const parentOn = st.mode === 'parent';
  return redact({
    app: { version: m.version, versionName: m.version_name ?? null, target: TARGET, workerStartedAt: workerStart },
    browser: { userAgent: globalThis.navigator?.userAgent ?? null, online: globalThis.navigator?.onLine ?? null,
      language: globalThis.navigator?.language ?? null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    profile: {
      app: g.account?.app ?? null, folder: g.account?.folder ?? null, running: !(g.shell?.on ?? !g.account),
      mode: parentOn ? 'parent' : 'kid', shell: g.shell ?? null,
      youtube: yt ? { signedIn: !!yt.loggedIn, sameAsProfile: g.account?.email && yt.email ? yt.email === g.account.email : null,
        checkedSecondsAgo: yt.at ? Math.round((Date.now() - yt.at) / 1000) : null } : null,
      github: { connected: !!st.token, repo: st.repo || null }, pinSet: !!st.pinHash,
    },
    sync: g.syncStatus ? { at: g.syncStatus.at ?? null, errors: (g.syncStatus.errors ?? []).slice(0, 5), notes: g.syncStatus.notes ?? [] } : null,
    worker: { blockingRules: g.dnrWorks ?? null, stuckStep: g.bgStuck ?? null },
    page: sender ? { url: safeUrl(sender.url ?? sender.tab?.url ?? ''), inFrame: !!sender.frameId, tabId: sender.tab?.id ?? null } : null,
  });
}

// --- recording a result ----------------------------------------------------------------------------------------
// r: { id, kind, area, expect, code, mismatch, evidence, skipped, ms, strikes } (strikes: an outside thing that
// fails only after that many failures a minute or more apart, so one bad page load is not a report).
// extra: { sender, pageSteps, page } from a page.
export async function record(r, extra = {}) {
  const b = await load();
  const now = Date.now();
  const prev = b.results[r.id] ?? {};
  const failed = !r.skipped && r.mismatch?.length > 0;
  let status = r.skipped ? 'skip' : failed ? 'fail' : 'pass';
  let pending = null;
  if (failed && r.strikes > 1) {
    const p = prev.pending ?? { n: 0, firstAt: now };
    p.n += 1;
    if (p.n < r.strikes || now - p.firstAt < 60000) { status = 'warn'; pending = p; }
  }
  const res = {
    id: r.id, kind: r.kind, area: r.area, expect: r.expect, code: r.code ?? [], status, at: new Date(now).toISOString(),
    ms: r.ms ?? null, saw: failed ? sawOf(r.mismatch) : r.skipped ?? null,
    ...(failed ? { mismatch: redact(r.mismatch) } : {}), ...(pending ? { pending } : {}),
    passes: (prev.passes ?? 0) + (status === 'pass' ? 1 : 0), fails: (prev.fails ?? 0) + (status === 'fail' ? 1 : 0),
  };
  b.results[r.id] = res;
  let report = null;
  if (status === 'fail') report = await addReport(b, r, res, extra);
  save();
  return { ...res, report };
}
const sawOf = (mm) => mm.map((m) => `${m.what}: expected ${short(m.expected)}, saw ${short(m.actual)}`).join('; ').slice(0, 400);
const short = (v) => (typeof v === 'string' ? v : JSON.stringify(v))?.slice(0, 120);

async function addReport(b, r, res, { sender, pageSteps = [], page = null, quiet = false } = {}) {
  const m = chrome.runtime.getManifest();
  const fp = fingerprint(r.id, m.version, TARGET);
  // The same problem on this version: counted on the tablet, never sent again. The server has it (and its fix agent
  // may be working on it); a fix comes as a new version, and a new version is a new fingerprint.
  const old = b.reports.find((x) => x.fingerprint === fp);
  if (old) {
    old.count += 1;
    old.lastAt = res.at;
    if (!old.sentAt) sendSoon();
    return old;
  }
  await stepsLoaded;
  const context = await contextNow(sender);
  if (page) context.page = { ...(context.page ?? {}), ...redact(page) };
  b.device ??= `tab-${crypto.randomUUID().slice(0, 8)}`;
  const report = {
    type: 'problem', reportId: crypto.randomUUID(), deviceId: b.device, fingerprint: fp, check: r.id, kind: r.kind, area: r.area, auto: true,
    expect: r.expect, saw: res.saw, mismatch: res.mismatch, evidence: redact(r.evidence ?? {}), code: r.code ?? [],
    firstAt: res.at, lastAt: res.at, count: 1, context,
    steps: [...stepsNow(), ...redact(pageSteps).map((s) => ({ ...s, page: true }))].sort((a, x) => String(a.at).localeCompare(String(x.at))).slice(-MAX_STEPS),
  };
  b.reports = [...b.reports, report].slice(-MAX_REPORTS);
  // The banner (core/ui/watch.js): a page where the parent is shows it for 15 s, once (never in kid mode). Not for a
  // report the parent sent themselves (quiet).
  if (!quiet) chrome.storage.local.set({ checkAlert: { reportId: report.reportId, at: report.firstAt, check: report.check, expect: report.expect, saw: report.saw, shown: false } }).catch(() => {});
  sendSoon();
  return report;
}

// --- sending the reports to the data repo: problems/<day>.json at its top, one file for every tablet and profile ----
// (the apps header has no profile, and a problem can come before one exists). The server reads them (agent/poll.sh).
let sendTimer = null, sendRun = null;
export function sendSoon(ms = 10000) { clearTimeout(sendTimer); sendTimer = setTimeout(() => sendReports().catch(() => {}), ms); }
export function sendReports() {
  sendRun ??= (async () => {
    const b = await load();
    const todo = b.reports.filter((r) => !r.sentAt);
    if (!todo.length) return { ok: true, sent: 0 };
    const { settings = {} } = await chrome.storage.local.get('settings');
    if (!settings.token) return { ok: false, error: 'No GitHub token: the reports stay on this tablet.' };
    const loc = { repo: settings.repo || DEFAULT_REPO, base: '' };
    const days = {};
    for (const r of todo) (days[r.firstAt.slice(0, 10)] ??= []).push(r);
    let sent = 0;
    for (const [day, list] of Object.entries(days)) {
      const path = `problems/${day}.json`;
      for (let attempt = 0; attempt < 3; attempt++) {
        const cur = await getRepoFile(loc, settings.token, path);
        const file = cur?.json?.schemaVersion === 1 ? cur.json : { schemaVersion: 1, date: day, reports: [] };
        for (const r of list) {
          const { sent: _s, sentAt: _a, ...out } = r;
          const i = file.reports.findIndex((x) => x.reportId === r.reportId);
          if (i >= 0) file.reports[i] = out; else file.reports.push(out);
        }
        file.updatedAt = new Date().toISOString();
        if (await putRepoFile(loc, settings.token, path, file, cur?.sha, `problems ${day}: ${list.map((r) => r.check).join(', ')}`.slice(0, 200))) {
          const at = new Date().toISOString();
          for (const r of list) r.sentAt = at;
          sent += list.length;
          break;
        }
      }
    }
    save();
    return { ok: true, sent };
  })().finally(() => { sendRun = null; });
  return sendRun;
}

// The banner's report, once: null when there is none, or it was shown already. The caller decides who may see it.
export async function takeAlert() {
  const { checkAlert } = await chrome.storage.local.get('checkAlert');
  if (!checkAlert || checkAlert.shown) return null;
  await chrome.storage.local.set({ checkAlert: { ...checkAlert, shown: true } });
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...checkAlert, willSend: !!settings.token };
}

// Runs one check with its own time limit (a browser API that never answers is a failure, not a hang).
export async function runCheck(def, args, limitMs = 15000) {
  const t = new Expect();
  const t0 = Date.now();
  let timer;
  try {
    await Promise.race([def.run(t, args), new Promise((_, no) => { timer = setTimeout(() => no(new Error(`no result in ${limitMs / 1000} s`)), limitMs); })]);
  } catch (e) {
    t.mismatch.push({ what: 'the check itself', expected: 'finishes', actual: clip(String(e?.message ?? e)) });
    t.note('stack', String(e?.stack ?? '').split('\n').slice(0, 5).join('\n'));
  } finally { clearTimeout(timer); }
  if (def.net && t.mismatch.length && globalThis.navigator?.onLine === false) t.skip('offline');
  return record({ ...def, kind: def.kind ?? 'start', mismatch: t.mismatch, evidence: t.evidence, skipped: t.skipped, ms: Date.now() - t0 });
}

// --- the start checks: after an install, an update, a browser start, or "Run the checks" ------------------------
let startRunning = null;
export function runStartChecks(reason) {
  startRunning ??= (async () => {
    const b = await load();
    const g = await chrome.storage.local.get(['settings', 'account']);
    const now = { version: chrome.runtime.getManifest().version, at: new Date().toISOString(),
      had: { token: !!g.settings?.token, pin: !!g.settings?.pinHash, repo: g.settings?.repo || null, profile: !!g.account?.key } };
    const ctx = { reason, previous: b.last, startedAt: Date.now() };
    step({ kind: 'start', type: reason });
    const out = [];
    for (const def of START) out.push(await runCheck(def, ctx));
    b.last = now;
    b.start = { reason, at: now.at, version: now.version, pass: out.filter((r) => r.status === 'pass').length,
      fail: out.filter((r) => r.status === 'fail').length, skip: out.filter((r) => r.status === 'skip').length };
    save();
    return { ok: true, start: b.start, results: out.map(({ report, ...r }) => r) };
  })().finally(() => { startRunning = null; });
  return startRunning;
}

// --- the messages: every answer is checked against what the message should have done ----------------------------
// Reads answered every second (the state, playback time) are not steps; their failures still count.
const QUIET = new Set(['state', 'tick', 'header', 'ping', 'frameReady', 'runStatus', 'version', 'heldNotes', 'getRules', 'status',
  'parentData', 'videoDetail', 'helperData', 'contextData', 'talk', 'apps', 'checks', 'checkResult', 'details']);
// How long the asking page waits (core/lib/ask.js 8 s; the apps header 15 s). An answer later than that never arrives.
const HEADER_TYPES = new Set(['header', 'openApp', 'connect', 'plainSite', 'plainYouTube', 'connectGitHub', 'exportSettings', 'importSettings']);
const waitOf = (type) => (HEADER_TYPES.has(type) ? 15000 : 8000);
// Answers the page shows as they are: { ok: false } must say why, or the parent sees "That didn't work".
const SAYS_WHY = new Set(['openApp', 'connect', 'plainSite', 'plainYouTube', 'connectGitHub', 'exportSettings', 'importSettings', 'runHelper', 'updateApp', 'setMode']);
// When a content script last spoke, per tab (the start check "the YouTube tab answers").
export const heardFrom = new Map();

const AREA = (type) => (HEADER_TYPES.has(type) ? 'header' : 'background');
const from = (sender) => (sender?.url ? safeUrl(sender.url) : sender?.tab ? `content ${safeUrl(sender.tab.url)}` : 'unknown');

export async function observe(type, msg, ctx, run) {
  if (['checkResult', 'checks', 'runChecks', 'checkAlert', 'sendChecks', 'clearChecks'].includes(type)) return run();
  if (ctx.sender?.tab?.id != null && !String(ctx.sender.url ?? '').startsWith(chrome.runtime.getURL(''))) heardFrom.set(ctx.sender.tab.id, Date.now());
  const def = ACTIONS[type];
  let before = null;
  if (def?.snap) try { before = await chrome.storage.local.get(def.snap); } catch {}
  const t0 = Date.now();
  let answer, error = null;
  try { answer = await run(); } catch (e) { error = e; }
  const ms = Date.now() - t0;
  // What the message left, read at once: a check run later could see the next message's changes instead.
  let after = null;
  if (def?.snap && !error) try { after = await chrome.storage.local.get(def.snap); } catch {}
  if (!QUIET.has(type) || error) step({ kind: 'message', type, from: from(ctx.sender), ms, ok: error ? false : answer?.ok ?? null, ...(answer?.error ? { error: clip(answer.error, 160) } : {}) });
  // Checked after the answer is on its way: a check never slows the page down.
  setTimeout(() => afterAnswer(type, def, { msg, answer, error, before, after, ms, ...ctx }).catch(() => {}), 0);
  if (error) throw error;
  return answer;
}

async function afterAnswer(type, def, c) {
  const where = ['core/background/messages.js handle'];
  if (c.error) {
    const t = new Expect();
    t.mismatch.push({ what: `the "${type}" handler`, expected: 'an answer', actual: `threw: ${clip(String(c.error?.message ?? c.error), 200)}` });
    t.note('stack', String(c.error?.stack ?? '').split('\n').slice(0, 6).join('\n')).note('message', c.msg);
    await record({ id: `rule.handlerError.${type}`, kind: 'rule', area: AREA(type), expect: `"${type}" answers without an error`, code: where, mismatch: t.mismatch, evidence: t.evidence }, { sender: c.sender });
    return;
  }
  if (c.ms > waitOf(type)) {
    await record({ id: `rule.slowAnswer.${type}`, kind: 'rule', area: AREA(type), strikes: 2, expect: `"${type}" answers before the page stops waiting (${waitOf(type) / 1000} s)`,
      code: where, mismatch: [{ what: `time to answer "${type}"`, expected: `under ${waitOf(type)} ms`, actual: `${c.ms} ms` }], evidence: { message: c.msg } }, { sender: c.sender });
  }
  if (SAYS_WHY.has(type) && c.answer?.ok === false && !c.answer.error) {
    await record({ id: `rule.noReason.${type}`, kind: 'rule', area: AREA(type), expect: `a refused "${type}" says why`, code: where,
      mismatch: [{ what: 'answer.error', expected: 'a reason the parent can read', actual: c.answer }], evidence: { message: c.msg } }, { sender: c.sender });
  }
  if (!def) return;
  if (def.skip?.(c)) return;
  const t = new Expect();
  const t0 = Date.now();
  const read = async () => (def.snap ? chrome.storage.local.get(def.snap) : {});
  const args = { ...c, after: c.after ?? await read(), tabUrl };
  try {
    await def.check(t, args);
    if (def.later && t.passed && !t.skipped) {
      const waited = def.later.ms ?? 3000;
      await new Promise((r) => setTimeout(r, waited));
      await def.later.check(t, { ...args, after: await read(), waited });
    }
  } catch (e) {
    t.mismatch.push({ what: 'the check itself', expected: 'finishes', actual: clip(String(e?.message ?? e)) });
  }
  if (def.net && t.mismatch.length && globalThis.navigator?.onLine === false) t.skip('offline');
  t.note('message', c.msg).note('answer', c.answer);
  await record({ id: def.id ?? `action.${type}`, kind: 'action', area: def.area, expect: def.expect, code: def.code, strikes: def.strikes,
    mismatch: t.mismatch, evidence: t.evidence, skipped: t.skipped, ms: Date.now() - t0 + c.ms }, { sender: c.sender });
}

// Where a tab is now (the address it is going to, while it loads). null: no such tab, or the browser didn't say.
export async function tabUrl(tabId) {
  if (tabId == null) return null;
  try { const tab = await chrome.tabs.get(tabId); return tab?.pendingUrl || tab?.url || null; } catch { return null; }
}

// --- outside things that come and go: a strike, then a failure the second time ----------------------------------
// probe('gh.sync', def, t): def { area, expect, code, strikes (default 2), net }; t an Expect already filled.
export function probe(id, def, t) {
  if (def.net !== false && t.mismatch.length && globalThis.navigator?.onLine === false) t.skip('offline');
  return record({ id, kind: 'probe', strikes: def.strikes ?? 2, ...def, mismatch: t.mismatch, evidence: t.evidence, skipped: t.skipped });
}

// --- results from the pages and content scripts (core/ui/watch.js) ---------------------------------------------------
const ID = /^[a-z][A-Za-z0-9_.:-]{2,120}$/;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
export async function pageResult(msg, sender) {
  const r = msg.result ?? {};
  if (!ID.test(r.id ?? '') || !['pass', 'fail', 'skip'].includes(r.status)) return { ok: false, error: 'not a check result' };
  const mismatch = r.status === 'fail' ? [].concat(r.mismatch ?? []).slice(0, 12).map((m) => ({ what: str(m?.what, 200) ?? '?', expected: clip(m?.expected), actual: clip(m?.actual) })) : [];
  if (r.status === 'fail' && !mismatch.length) mismatch.push({ what: 'the page check', expected: str(r.expect, 300) ?? '?', actual: 'failed with no detail' });
  const out = await record({
    id: r.id, kind: ['screen', 'rule', 'probe'].includes(r.kind) ? r.kind : 'screen', area: str(r.area, 40) ?? 'page',
    expect: str(r.expect, 300) ?? '', code: [].concat(r.code ?? []).slice(0, 6).map((x) => str(x, 200)).filter(Boolean),
    strikes: Math.min(5, r.strikes | 0) || 0, mismatch, evidence: r.evidence ?? {}, skipped: r.status === 'skip' ? (str(r.skipped, 200) ?? 'skipped') : null, ms: Number(r.ms) || null,
  }, { sender, pageSteps: [].concat(msg.steps ?? []).slice(-20), page: r.page ?? null, quiet: r.quiet === true });
  if (r.status === 'fail') step({ kind: 'check', type: r.id, ok: false, from: from(sender) });
  // again: the same problem was reported before on this version (counted here, not sent again).
  return { ok: true, status: out.status, again: (out.report?.count ?? 1) > 1 };
}

// --- what the pages show: the results and the reports ----------------------------------------------------------
export async function checksView({ seen = false } = {}) {
  const b = await load();
  const results = Object.values(b.results).sort((a, x) => (rank(a.status) - rank(x.status)) || a.id.localeCompare(x.id));
  const unseen = b.reports.filter((r) => !b.seen || r.lastAt > b.seen).length;
  if (seen) { b.seen = new Date().toISOString(); save(); }
  return { ok: true, version: chrome.runtime.getManifest().version, target: TARGET, start: b.start, results, reports: b.reports, unseen };
}
const rank = (s) => ({ fail: 0, warn: 1, skip: 2, pass: 3 }[s] ?? 4);

export async function clearReports() {
  const b = await load();
  b.reports = [];
  for (const r of Object.values(b.results)) if (r.status === 'fail') r.status = 'cleared';
  save();
  return { ok: true };
}
