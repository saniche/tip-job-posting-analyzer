import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/background/auth.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const auth = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

let storage;
let response;
let requestUrl;

beforeEach(() => {
  storage = {};
  response = { access_token: 'test-token', token_type: 'bearer' };
  requestUrl = undefined;
  globalThis.chrome = {
    storage: {
      session: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (items) => Object.assign(storage, items),
        remove: async (key) => { delete storage[key]; },
      },
    },
  };
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return { status: 200, ok: true, json: async () => response };
  };
});

test('stores the real API token with a 23-hour-50-minute lifetime', async () => {
  const before = Date.now();
  await auth.login('user', 'password');
  const after = Date.now();
  const lifetime = (23 * 60 + 50) * 60_000;
  assert.equal(requestUrl, 'http://localhost:8000/api/v1/auth/login');
  assert.equal(storage.auth.accessToken, 'test-token');
  assert.ok(storage.auth.expiresAt >= before + lifetime && storage.auth.expiresAt <= after + lifetime);
  assert.equal(await auth.getToken(), 'test-token');
});

test('rejects login responses without a usable access_token', async () => {
  for (const body of [null, {}, { access_token: '' }, { access_token: 42 }]) {
    response = body;
    await assert.rejects(auth.login('user', 'password'), /did not contain an access token/);
    assert.equal(storage.auth, undefined);
  }
});

test('rejects expired and malformed stored authentication', async () => {
  for (const value of [
    { accessToken: 'test-token', expiresAt: Date.now() - 1 },
    { accessToken: undefined, expiresAt: Date.now() + 60_000 },
    { accessToken: 'test-token', expiresAt: NaN },
    { accessToken: 'test-token' },
  ]) {
    storage.auth = value;
    assert.equal(await auth.getToken(), null);
  }
});

test('logout removes the stored token', async () => {
  await auth.login('user', 'password');
  await auth.logout();
  assert.equal(await auth.getToken(), null);
});
