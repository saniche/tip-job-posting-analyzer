import { api, ApiError, AuthError } from './api';
import { getToken } from './auth';
import {
  ENDPOINTS, JOB_TIMEOUT_MS, MAX_ACTIVE_JOBS, MAX_CONSECUTIVE_FAILURES, MAX_CONTENT_CHARS,
  POLL_BACKOFF, POLL_INITIAL_MS, POLL_MAX_MS,
} from '../shared/config';
import type { AnalyzeResponse, Job, JobStatus, PagePayload, ProcessingJobResponse } from '../shared/types';

const KEY = 'jobs';
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const submitting = new Set<string>(); // jobs currently being sent to the server (count toward the cap)

const isRunning = (j: Job) => j.status === 'pending' || j.status === 'processing'; // occupies a slot
const isActive = (j: Job) => j.status === 'waiting' || isRunning(j);
const pollDelay = (count: number) => Math.min(POLL_MAX_MS, Math.round(POLL_INITIAL_MS * POLL_BACKOFF ** count));

// Job boards append tracking params to the same posting; strip them so duplicates are detected.
const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|trk|tracking|ref(id)?$|mc_)/i;
function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (TRACKING_PARAM.test(k)) x.searchParams.delete(k);
    x.searchParams.sort();
    return x.href;
  } catch { return u; }
}

/** Also accepts running/done as aliases. Other unknown statuses count as still running; the job timeout is the safety net. */
function normalizeStatus(s: string): JobStatus {
  switch (s.toLowerCase()) {
    case 'completed': case 'done': return 'completed';
    case 'failed': return 'failed';
    case 'pending': return 'pending';
    default: return 'processing'; // 'processing', 'running', anything unknown
  }
}

// Serialise read-modify-write on storage so concurrent operations don't clobber each other.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const read = async () => ((await chrome.storage.local.get(KEY))[KEY] ?? {}) as Record<string, Job>;

async function write(all: Record<string, Job>) {
  await chrome.storage.local.set({ [KEY]: all });
  await setBadge(all);
}

async function setBadge(all: Record<string, Job>) {
  const n = Object.values(all).filter(isActive).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

export async function flashError() {
  await chrome.action.setBadgeText({ text: '!' });
  setTimeout(async () => setBadge(await read()), 3_000);
}

const update = (id: string, patch: Partial<Job>) =>
  locked(async () => {
    const all = await read();
    const job = all[id];
    if (!job) return;
    all[id] = { ...job, ...patch, updatedAt: Date.now() };
    await write(all);
  });

// ---------- submit (queue + concurrency cap) ----------

/** Adds the job as 'waiting' (rejecting duplicates atomically), then lets pump() start it if a slot is free. */
export async function submit(p: PagePayload): Promise<void> {
  const key = normalizeUrl(p.url);
  await locked(async () => {
    const all = await read();
    if (Object.values(all).some((j) => isActive(j) && normalizeUrl(j.url) === key)) {
      throw new Error('This page is already being analyzed');
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    all[id] = {
      id, url: p.url, title: p.title, snippet: p.content.slice(0, 160),
      status: 'waiting', payload: p, submittedAt: now, updatedAt: now,
    };
    await write(all);
  });
  await pump();
}

export async function submitTab(tab: chrome.tabs.Tab, selectionHint?: string): Promise<void> {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('This page cannot be analyzed');
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    // Highlighted text wins (handy when a page is cluttered); otherwise the page's full text.
    func: () => (getSelection()?.toString().trim() || document.body?.innerText || ''),
  });
  const text = (selectionHint?.trim() || (injected?.result as string | undefined) || '').slice(0, MAX_CONTENT_CHARS);
  if (!text) throw new Error('No text found on this page');
  await submit({ url: tab.url, title: tab.title || tab.url, content: text });
}

/** Promotes the oldest waiting jobs while fewer than MAX_ACTIVE_JOBS are running. */
async function pump(): Promise<void> {
  if (!(await getToken())) return; // waiting jobs stay put until the user signs in

  const picked = await locked(async () => {
    const all = await read();
    let free = MAX_ACTIVE_JOBS - Object.values(all).filter(isRunning).length - submitting.size;
    const waiting = Object.values(all)
      .filter((j) => j.status === 'waiting' && !submitting.has(j.id))
      .sort((a, b) => a.submittedAt - b.submittedAt);

    const toStart: Job[] = [];
    let changed = false;
    for (const j of waiting) {
      if (Date.now() - j.submittedAt > JOB_TIMEOUT_MS) {
        all[j.id] = { ...j, status: 'failed', error: 'Timed out waiting for a free slot', payload: undefined, updatedAt: Date.now() };
        changed = true;
      } else if (free > 0) {
        submitting.add(j.id); // claim the slot before leaving the lock
        toStart.push(j);
        free--;
      }
    }
    if (changed) await write(all);
    return toStart;
  });

  const results = await Promise.all(picked.map(startJob));
  if (results.some(Boolean)) await pump(); // a submit failed for good: its slot is free again
}

/** Returns true if the job ended up failed (so the caller should try to fill the slot). */
async function startJob(job: Job): Promise<boolean> {
  const p = job.payload!;
  try {
    const res = await api<AnalyzeResponse>(ENDPOINTS.analyze, {
      method: 'POST',
      body: JSON.stringify({
        url: p.url,
        // `content` is a JSON-encoded string, as the server expects
        content: JSON.stringify(p.content),
      }),
    });

    if (!res.processing_job_id) {
      await update(job.id, {
        status: 'failed', payload: undefined, pageId: res.id,
        error: `The server did not start a processing job (status: ${res.status})`,
      });
      return true;
    }

    await update(job.id, {
      status: 'pending', pageId: res.id, processingJobId: res.processing_job_id, payload: undefined,
      startedAt: Date.now(), pollCount: 0, nextPollAt: Date.now() + POLL_INITIAL_MS,
    });
    schedule(job.id, POLL_INITIAL_MS);
    return false;
  } catch (e) {
    // Not signed in, or server says "busy": stay waiting, the watchdog retries.
    if (e instanceof AuthError) return false;
    if (e instanceof ApiError && (e.status === 429 || e.status === 503)) return false;
    await update(job.id, {
      status: 'failed', payload: undefined,
      error: e instanceof Error ? e.message : 'Could not submit the page',
    });
    return true;
  } finally {
    submitting.delete(job.id);
  }
}

// ---------- polling ----------

function schedule(id: string, delayMs: number) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => void poll(id), delayMs));
}

async function poll(id: string) {
  timers.delete(id);
  const job = (await read())[id];
  if (!job || !isRunning(job) || !job.processingJobId) return;

  if (Date.now() - (job.startedAt ?? job.submittedAt) > JOB_TIMEOUT_MS) {
    await update(id, { status: 'failed', error: 'Timed out waiting for the analysis', nextPollAt: undefined });
    await pump();
    return;
  }

  try {
    const s = await api<ProcessingJobResponse>(ENDPOINTS.processingJob(job.processingJobId));
    const status = normalizeStatus(s.status);

    if (status === 'completed') {
      let result: unknown;
      let error: string | undefined;
      if (s.result_id) {
        try {
          result = await api<unknown>(ENDPOINTS.result(s.result_id));
        } catch (e) {
          if (e instanceof AuthError) throw e; // retry the whole step after the next login
          error = 'The analysis finished, but its result could not be loaded';
        }
      }
      await update(id, { status, resultId: s.result_id ?? undefined, result, error, nextPollAt: undefined });
      await pump(); // slot freed
      return;
    }

    if (status === 'failed') {
      await update(id, { status, error: s.error ?? 'Analysis failed', nextPollAt: undefined });
      await pump();
      return;
    }

    const pollCount = (job.pollCount ?? 0) + 1;
    const delay = pollDelay(pollCount);
    await update(id, { status, pollCount, failures: 0, nextPollAt: Date.now() + delay });
    schedule(id, delay);
  } catch (e) {
    if (e instanceof AuthError) {
      // Pause: the job stays running; resumePolling() picks it up after the next login.
      await update(id, { nextPollAt: undefined });
      return;
    }
    const failures = (job.failures ?? 0) + 1;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      await update(id, { status: 'failed', error: 'Lost contact with the server', failures, nextPollAt: undefined });
      await pump();
      return;
    }
    const delay = Math.min(POLL_MAX_MS * 3, 2_000 * 2 ** failures); // exponential backoff on errors
    await update(id, { failures, nextPollAt: Date.now() + delay });
    schedule(id, delay);
  }
}

/**
 * MV3 service workers get killed, taking setTimeout with them.
 * Called on startup, on login, and by a 30s alarm: restarts orphaned polling and
 * retries waiting submissions (after sign-in, or after a 429/503 from the server).
 */
export async function resumePolling(): Promise<void> {
  const all = await read();
  for (const job of Object.values(all)) {
    if (isRunning(job) && !timers.has(job.id)) {
      schedule(job.id, Math.max(0, (job.nextPollAt ?? 0) - Date.now()));
    }
  }
  await setBadge(all);
  await pump();
}

export async function clearFinished(): Promise<void> {
  await locked(async () => {
    const all = await read();
    for (const [id, j] of Object.entries(all)) if (!isActive(j)) delete all[id];
    await write(all);
  });
}
