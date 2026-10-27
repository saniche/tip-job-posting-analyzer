import { resolveApiUrl } from '../shared/config';
import { AuthError, getToken, logout } from './auth';
export { AuthError };

export class ApiError extends Error {
  constructor(public status: number) { super(`Server error ${status}`); }
}

export async function api<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  const url = resolveApiUrl(pathOrUrl);

  const token = await getToken();
  if (!token) throw new AuthError('Not authenticated');

  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    await logout();
    throw new AuthError('Session expired');
  }
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}
