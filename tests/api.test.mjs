import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/background/api.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

let requests;

beforeEach(() => {
  requests = [];
  globalThis.chrome = {
    storage: {
      session: {
        get: async () => ({ auth: { accessToken: 'test-token', expiresAt: Date.now() + 60_000 } }),
      },
    },
  };
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return { status: 200, ok: true, json: async () => ({}) };
  };
});

test('resolves endpoint paths under the API base path', async () => {
  await api.api('/jobs/normalize', { method: 'POST' });
  await api.api('/processing-jobs/job-id');
  await api.api('/results/result-id');
  assert.deepEqual(requests, [
    'http://localhost:8000/api/v1/jobs/normalize',
    'http://localhost:8000/api/v1/processing-jobs/job-id',
    'http://localhost:8000/api/v1/results/result-id',
  ]);
});

test('allows same-origin absolute URLs without changing their paths', async () => {
  await api.api('http://localhost:8000/other/status');
  assert.deepEqual(requests, ['http://localhost:8000/other/status']);
});

test('refuses cross-origin absolute and protocol-relative URLs', async () => {
  await assert.rejects(api.api('http://other.example/status'), /Refusing cross-origin request/);
  await assert.rejects(api.api('//other.example/status'), /Refusing cross-origin request/);
  assert.deepEqual(requests, []);
});
