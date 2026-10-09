// KidTube's rules and list in force: the files bundled with the extension (data/), GitHub's parent-config.json
// and queue.json, the parent's changes not on GitHub yet (localConfig) and today's plan changes (planLog).
import { mergeConfig } from '../../../core/lib/merge.js';
import { appOf } from '../../registry.js';
import { applyPlan } from '../lib/plan.js';

let bundled; // { config, queue, quizTypes }
export async function loadBundled() {
  if (!bundled) {
    const [config, queue, quizTypes] = await Promise.all(['default-config.json', 'default-queue.json', 'quiz-types.json']
      .map((f) => fetch(chrome.runtime.getURL(`apps/kidtube/data/${f}`)).then((r) => r.json())));
    bundled = { config, queue, quizTypes };
  }
  return bundled;
}

export async function effective(s) {
  const b = await loadBundled();
  let config = mergeConfig(mergeConfig(b.config, s.data?.config), s.localConfig);
  const queue = applyPlan(s.data?.queue ?? b.queue, s.planLog);
  // Questions of planned videos the parent moved onto today's list.
  if (Object.keys(s.planLog?.items ?? {}).length) config = mergeConfig(config, { quiz: { items: s.planLog.items } });
  return { config, queue };
}

// Context documents (parent mode → Context) of the current profile's app.
export const contextDocsOf = async () => appOf((await chrome.storage.local.get('account')).account).contextDocs;
