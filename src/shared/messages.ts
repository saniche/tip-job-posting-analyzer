export type Request =
  | { type: 'login'; username: string; password: string }
  | { type: 'logout' }
  | { type: 'authState' }
  | { type: 'submitActive' }
  | { type: 'clearFinished' };

export type Response<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; authRequired?: boolean };

export function send<T = unknown>(req: Request): Promise<Response<T>> {
  return chrome.runtime.sendMessage(req);
}
