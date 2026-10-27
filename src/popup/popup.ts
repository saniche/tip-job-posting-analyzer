import { send } from '../shared/messages';
import type { Job } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function showError(msg = '') { $('error').textContent = msg; }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // textContent only: server data is untrusted
  return e;
}

const LABELS: Record<Job['status'], string> = {
  waiting: 'waiting for a free slot',
  pending: 'queued',
  processing: 'analyzing…',
  completed: 'completed',
  failed: 'failed',
};

const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** The result shape is up to the server, so render it generically: a `summary` first, then every other field. */
function renderResult(result: unknown): HTMLElement {
  const box = el('div', 'result');
  if (result === null || typeof result !== 'object') {
    box.append(el('div', '', fmt(result)));
    return box;
  }
  const { summary, ...rest } = result as Record<string, unknown>;
  if (summary !== undefined) box.append(el('div', 'summary', fmt(summary)));
  for (const [k, v] of Object.entries(rest)) {
    const row = el('div', 'field');
    row.append(el('b', '', `${k}: `), document.createTextNode(fmt(v)));
    box.append(row);
  }
  return box;
}

function renderJob(job: Job): HTMLLIElement {
  const li = el('li');
  li.append(el('div', 'title', job.title || job.url), el('div', 'url', job.url));
  li.append(el('span', `badge ${job.status}`, LABELS[job.status]));

  if (job.status === 'completed') {
    if (job.result !== undefined) li.append(renderResult(job.result));
    if (job.error) li.append(el('div', 'err', job.error));
  }
  if (job.status === 'failed') li.append(el('div', 'err', job.error ?? 'Analysis failed'));
  return li;
}

async function render() {
  const state = await send<{ authenticated: boolean }>({ type: 'authState' });
  const authed = state.ok && state.data?.authenticated === true;
  $('login').hidden = authed;
  $('main').hidden = !authed;

  const jobs = Object.values(
    ((await chrome.storage.local.get('jobs')).jobs ?? {}) as Record<string, Job>,
  ).sort((a, b) => b.submittedAt - a.submittedAt);
  $('jobs').replaceChildren(...jobs.map(renderJob));
}

async function run(req: Parameters<typeof send>[0]) {
  showError();
  const res = await send(req);
  if (!res.ok) showError(res.error);
  await render();
}

$('loginBtn').addEventListener('click', async () => {
  const username = $<HTMLInputElement>('username').value.trim();
  const password = $<HTMLInputElement>('password').value;
  await run({ type: 'login', username, password });
  $<HTMLInputElement>('password').value = '';
});
$('analyzeBtn').addEventListener('click', () => run({ type: 'submitActive' }));
$('clearBtn').addEventListener('click', () => run({ type: 'clearFinished' }));
$('logoutBtn').addEventListener('click', () => run({ type: 'logout' }));

// Live updates: the background writes job state to storage, the popup just re-renders.
chrome.storage.onChanged.addListener(() => void render());
void render();
