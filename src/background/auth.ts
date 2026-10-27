import { ENDPOINTS, resolveApiUrl } from '../shared/config';

const KEY = 'auth';
const TOKEN_LIFETIME_MS = (23 * 60 + 50) * 60_000;
interface AuthData { accessToken: string; expiresAt: number }

export class AuthError extends Error {}

// storage.session: survives service-worker restarts, cleared when the browser closes,
// never written to disk. The password itself is never stored.
export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(resolveApiUrl(ENDPOINTS.login), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401 || res.status === 400) throw new AuthError('Invalid username or password');
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const body: unknown = await res.json();
  if (!body || typeof body !== 'object' || !('access_token' in body) ||
      typeof body.access_token !== 'string' || !body.access_token.trim()) {
    throw new AuthError('Login response did not contain an access token');
  }
  const data: AuthData = { accessToken: body.access_token, expiresAt: Date.now() + TOKEN_LIFETIME_MS };
  await chrome.storage.session.set({ [KEY]: data });
}

export async function getToken(): Promise<string | null> {
  const data = (await chrome.storage.session.get(KEY))[KEY] as AuthData | undefined;
  if (!data || typeof data.accessToken !== 'string' || !data.accessToken.trim() ||
      typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt) ||
      data.expiresAt <= Date.now()) return null;
  return data.accessToken;
}

export async function logout(): Promise<void> {
  await chrome.storage.session.remove(KEY);
}
