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
import { cmpVersion } from '../lib/version.js';
import { WAIT } from '../lib/ask.js';

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
    app: { version: m.version, versionName: m.version_name ?? null, target: TARGET, workerStartedAt: workerStart,
      installType: await new Promise((r) => { try { chrome.management.getSelf((x) => { void chrome.runtime.lastError; r(x?.installType ?? null); }); } catch { r(null); } }),
      update: (await chrome.storage.local.get('updateState')).updateState ?? null },
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
// How long the asking page waits (core/lib/ask.js 8 s or its WAIT; the apps header 15 s). An answer later than that never arrives.
const HEADER_TYPES = new Set(['header', 'inbox', 'openApp', 'connect', 'plainSite', 'plainYouTube', 'connectGitHub', 'exportSettings', 'importSettings']);
const waitOf = (type) => WAIT[type] ?? (HEADER_TYPES.has(type) ? 15000 : 8000);
// Answers the page shows as they are: { ok: false } must say why, or the parent sees "That didn't work".
const SAYS_WHY = new Set(['inbox', 'openApp', 'connect', 'plainSite', 'plainYouTube', 'connectGitHub', 'exportSettings', 'importSettings', 'runHelper', 'updateApp', 'setMode']);
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

// --- the fix agent's answers: fixes.json at the data repo's top (agent/problems.mjs writes it) ----------------------
// { fixes: [{ key: "<check>|<target>", state, version, message, at, tries }] }. state: working (the AI works on it
// now), fixed, not-a-bug, not-reproduced, needs-you, no-answer (the AI stopped; it tries again), gave-up.
// Read when a report was sent, at most every 2 minutes; kept in the book (b.fixes = { at, list, error }).
const FIXES_EVERY = 2 * 60000;
let fixesRun = null;
export function readFixes({ force = false } = {}) {
  fixesRun ??= (async () => {
    const b = await load();
    if (!force && (!b.reports.some((r) => r.sentAt) || (b.fixes?.at && Date.now() - Date.parse(b.fixes.at) < FIXES_EVERY))) return b.fixes;
    const { settings = {} } = await chrome.storage.local.get('settings');
    if (!settings.token) return b.fixes;
    const at = new Date().toISOString();
    try {
      const cur = await getRepoFile({ repo: settings.repo || DEFAULT_REPO, base: '' }, settings.token, 'fixes.json');
      b.fixes = { at, list: Array.isArray(cur?.json?.fixes) ? cur.json.fixes : [], error: null };
    } catch (e) {
      b.fixes = { at, list: b.fixes?.list ?? [], error: String(e.message ?? e).slice(0, 200) };
    }
    save();
    return b.fixes;
  })().finally(() => { fixesRun = null; });
  return fixesRun;
}

// The reports as problems: one per check (its reports on several versions together, their counts added), each with
// where it is. state:
//   unsent     found here, not sent yet            waiting   sent, the AI did not start yet
//   late       sent 30+ minutes ago, no answer     working   the AI works on it now
//   reload     fixed in a newer version than this one: update (or reload) KidTube
//   fixed      fixed in this version (or without a new version)
//   checked    the AI could not make it happen, or found it was not a bug: nothing to do
//   needs-you  the AI left it for the parent (its message says what to do)
//   retry      the AI stopped before it answered; it tries again      gave-up   it stopped 3 times
// done: nothing waits (fixed, checked). A report on the fixed version or newer is the problem back: waiting again.
export function problemsOf(reports, fixes, installed, now = Date.now()) {
  const groups = new Map();
  for (const r of reports) {
    const key = `${r.check}|${TARGET}`;
    const g = groups.get(key) ?? { key, check: r.check, area: r.area, expect: r.expect, saw: r.saw, count: 0, versions: [], firstAt: r.firstAt,
      lastAt: r.lastAt, sentAt: null, unsent: 0, reportIds: [] };
    const v = r.fingerprint?.split('|')[1] ?? r.context?.app?.version ?? null;
    g.count += r.count ?? 1;
    if (v && !g.versions.includes(v)) g.versions.push(v);
    if (r.firstAt < g.firstAt) g.firstAt = r.firstAt;
    if (r.lastAt >= g.lastAt) { g.lastAt = r.lastAt; g.saw = r.saw; g.expect = r.expect; }
    if (!r.sentAt) g.unsent++;
    else if (!g.sentAt || r.sentAt > g.sentAt) g.sentAt = r.sentAt;
    if (r.lastAt >= g.lastAt || !g.first) g.first = r.mismatch?.[0] ?? null;
    g.reportIds.push(r.reportId);
    groups.set(key, g);
  }
  const out = [...groups.values()].map((g) => {
    g.versions.sort(cmpVersion);
    const fix = (fixes ?? []).find((f) => f?.key === g.key) ?? null;
    const { first, ...rest } = g;
    // tries: each version it was reported on is one request to the AI (the same version again only counts up).
    return { ...rest, ...wordsOf(g), tries: Math.max(1, g.versions.length),
      fix: fix && { state: fix.state, version: fix.version ?? null, message: fix.message ?? '', at: fix.at ?? null }, ...stateOf(g, fix, installed, now) };
  });
  const order = ['working', 'needs-you', 'reload', 'unsent', 'late', 'retry', 'gave-up', 'waiting', 'fixed', 'checked'];
  return out.sort((a, x) => (order.indexOf(a.state) - order.indexOf(x.state)) || x.lastAt.localeCompare(a.lastAt));
}

// A problem in plain words, for the header's list and Check this browser: kind (error: the code broke; validation:
// a self-check found something not as it should be), title (what went wrong, where) and detail (what was expected
// and what was there). The check id stays in the details for the AI.
const WHERE = { header: 'in the header', parent: 'on the parent screens', youtube: 'on YouTube', page: 'on an extension page',
  background: '', notes: 'with the notes', rules: 'with the rules', instagram: 'in the Instagram app', kid: 'on the kid’s screen' };
const quote = (s) => `“${String(s ?? '').slice(0, 60)}”`;
// The messages by what the parent tapped or saw (a check names the message type; the parent never sees those).
const ACTION = { runHelper: '↻ Update (send the notes, ask for an AI run)', sync: 'the sync with GitHub', header: 'loading the header',
  inbox: 'a button in the notifications', openApp: 'opening an app', connect: 'Connect', plainSite: 'the App | site switch',
  plainYouTube: 'the App | YouTube switch', connectGitHub: 'connecting GitHub', exportSettings: 'saving the settings file',
  importSettings: 'loading the settings file', openUpdate: 'the new version next to the logo', checkUpdate: 'Update now in Settings',
  parentData: 'loading the parent screens', state: 'loading his screen', note: 'saving a note', wish: 'saving a note', setMode: 'the Parent | Kid switch' };
const action = (type) => ACTION[type] ?? quote(type);
const secs = (ms) => (/^\d+ ms$/.test(ms) ? `${Math.round(parseInt(ms, 10) / 100) / 10} s` : ms);
export function wordsOf({ check, area, expect, first, saw }) {
  const [, rule, arg = ''] = String(check).match(/^rule\.(\w+)\.?(.*)$/) ?? [];
  const where = WHERE[area] ? ` ${WHERE[area]}` : '';
  const got = first?.actual != null ? String(typeof first.actual === 'string' ? first.actual : JSON.stringify(first.actual)).slice(0, 160) : '';
  const wanted = first?.expected != null ? String(typeof first.expected === 'string' ? first.expected : JSON.stringify(first.expected)).slice(0, 160) : '';
  const label = String(expect ?? '').match(/“(.+)”/)?.[1] ?? arg;
  switch (rule) {
    case 'deadButton': return { kind: 'error', title: `Tapping ${quote(label)}${where} did nothing`, detail: 'Nothing on the screen changed within 5 seconds after the tap.' };
    case 'noAnswer': return { kind: 'error', title: `No answer for ${action(arg)}${where}`, detail: `The screen waited ${wanted.replace(/^within /, '') || '15 s'} for the extension and then stopped waiting. A slow connection to GitHub is the usual cause; the action may still have worked.` };
    case 'pageError': return { kind: 'error', title: `A script error${where} (${arg.replace(/_(\d+)$/, ':$1')})`, detail: got ? `The error: ${got}` : '' };
    case 'handlerError': return { kind: 'error', title: `The extension broke during ${action(arg)}`, detail: got ? `The error: ${got.replace(/^threw: /, '')}` : '' };
    case 'slowAnswer': return { kind: 'error', title: `${action(arg)[0].toUpperCase()}${action(arg).slice(1)} was too slow${where}`, detail: got ? `It took ${secs(got)}, but the screen waits only ${secs(wanted.replace(/^under /, ''))}, so it said “no answer” too early.` : '' };
    case 'noReason': return { kind: 'error', title: `${action(arg)[0].toUpperCase()}${action(arg).slice(1)} failed and did not say why`, detail: 'You would only see “That didn’t work”.' };
    default: break;
  }
  const what = first?.what ? `${first.what}: ` : '';
  return { kind: 'validation', title: `A self-check failed${where}: ${String(expect || check).slice(0, 160)}`,
    detail: first ? `${what}expected ${wanted || '?'}, but it was ${got || 'nothing'}.` : String(saw ?? '').slice(0, 200) };
}

function stateOf(g, fix, installed, now) {
  const newest = g.versions.at(-1) ?? null;
  const fixAt = fix?.at ? Date.parse(fix.at) : 0;
  const after = fixAt > Date.parse(g.lastAt);                                  // the answer is newer than the last report
  const fixedIn = (v) => !v || !newest || cmpVersion(newest, v) < 0;           // the reports are older than version v
  if (g.unsent) return { state: 'unsent', label: 'Found here, not sent yet', done: false };
  if (fix?.state === 'working' && fixAt && now - fixAt < 3 * 3600000) return { state: 'working', label: 'The AI is working on it now', done: false };
  if (fix?.state === 'fixed' && (fix.version ? fixedIn(fix.version) : after)) {
    if (fix.version && cmpVersion(installed, fix.version) < 0) return { state: 'reload', label: `Fixed in ${fix.version}: update Custom Apps to get it`, done: false };
    return { state: 'fixed', label: fix.version ? `Fixed in ${fix.version}` : 'Fixed (no new version needed)', done: true };
  }
  if (fix?.state === 'not-a-bug' && (fix.version ? fixedIn(fix.version) : after)) {
    if (fix.version && cmpVersion(installed, fix.version) < 0) return { state: 'reload', label: `The check was wrong; ${fix.version} has the right one: update Custom Apps`, done: false };
    return { state: 'checked', label: 'Not a bug (the check was wrong and is fixed)', done: true };
  }
  if (after && fix?.state === 'not-reproduced') return { state: 'checked', label: 'The AI could not make it happen: nothing changed', done: true };
  if (after && fix?.state === 'needs-you') return { state: 'needs-you', label: 'The AI needs you', done: false };
  if (after && fix?.state === 'no-answer') return { state: 'retry', label: 'The AI stopped before it answered: it tries again later', done: false };
  if (after && fix?.state === 'gave-up') return { state: 'gave-up', label: 'The AI stopped 3 times: it waits for a new report', done: false };
  const back = ['fixed', 'not-a-bug'].includes(fix?.state) && fix.version ? ` (back after the fix in ${fix.version})` : '';
  if (now - Date.parse(g.sentAt) > 30 * 60000) return { state: 'late', label: `Sent, no answer from the server yet${back}`, done: false };
  return { state: 'waiting', label: `Sent: the AI starts in a few minutes${back}`, done: false };
}

// --- what the pages show: the results, the reports and the problems ----------------------------------------------
export async function checksView({ seen = false } = {}) {
  const b = await load();
  readFixes().catch(() => {});      // in the background: its answer changes "checks", and the pages ask again
  const results = Object.values(b.results).sort((a, x) => (rank(a.status) - rank(x.status)) || a.id.localeCompare(x.id));
  const unseen = b.reports.filter((r) => !b.seen || r.lastAt > b.seen).length;
  if (seen) { b.seen = new Date().toISOString(); save(); }
  const version = chrome.runtime.getManifest().version;
  const problems = problemsOf(b.reports, b.fixes?.list, version);
  return { ok: true, version, target: TARGET, start: b.start, results, reports: b.reports, problems,
    fixesAt: b.fixes?.at ?? null, fixesError: b.fixes?.error ?? null, unseen };
}
const rank = (s) => ({ fail: 0, warn: 1, skip: 2, pass: 3 }[s] ?? 4);

export async function clearReports() {
  const b = await load();
  b.reports = [];
  for (const r of Object.values(b.results)) if (r.status === 'fail') r.status = 'cleared';
  save();
  return { ok: true };
}
