// Must match host_permissions in manifest.json
export const API_BASE = 'http://localhost:8000/api/v1';

export function resolveApiUrl(pathOrUrl: string): URL {
  const base = new URL(`${API_BASE.replace(/\/+$/, '')}/`);
  const path = pathOrUrl.startsWith('/') && !pathOrUrl.startsWith('//') ? pathOrUrl.slice(1) : pathOrUrl;
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error('Refusing cross-origin request');
  return url;
}

export const ENDPOINTS = {
  login: '/auth/login',                                                            // ASSUMPTION: adjust to your auth endpoint
  analyze: '/jobs/normalize',
  processingJob: (id: string) => `/processing-jobs/${encodeURIComponent(id)}`,
  result: (resultId: string) => `/jobs/${encodeURIComponent(resultId)}`,        // ASSUMPTION: adjust to your result endpoint
};

export const MAX_ACTIVE_JOBS = 10; // concurrent jobs on the server; extras wait locally as 'waiting'

// The server gives no polling hint, so the client backs off: 2s, 3s, 4.5s ... capped at 10s
export const POLL_INITIAL_MS = 2_000;
export const POLL_MAX_MS = 10_000;
export const POLL_BACKOFF = 1.5;

export const JOB_TIMEOUT_MS = 10 * 60_000;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const MAX_CONTENT_CHARS = 50_000;
