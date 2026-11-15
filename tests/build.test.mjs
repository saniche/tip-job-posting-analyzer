import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('builds with the API base and matching manifest host permission', () => {
  const project = process.cwd();
  const temp = mkdtempSync(join(tmpdir(), 'job-analyzer-build-'));
  try {
    cpSync(join(project, 'src'), join(temp, 'src'), { recursive: true });
    cpSync(join(project, 'manifest.json'), join(temp, 'manifest.json'));
    const cases = [
      { expectedBase: 'http://localhost:8000/api/v1' },
      { fileBase: 'https://file.example.com/api/v1', expectedBase: 'https://file.example.com/api/v1' },
      { fileBase: 'https://file.example.com/api/v1', envBase: 'https://env.example.com/custom/v1', expectedBase: 'https://env.example.com/custom/v1' },
    ];
    for (const { fileBase, envBase, expectedBase } of cases) {
      const env = { ...process.env };
      if (fileBase) writeFileSync(join(temp, '.env'), `API_BASE="${fileBase}"\n`);
      if (envBase === undefined) delete env.API_BASE;
      else env.API_BASE = envBase;
      const result = spawnSync(process.execPath, [resolve(project, 'build.mjs')], {
        cwd: temp,
        env,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const manifest = JSON.parse(readFileSync(join(temp, 'dist', 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest.host_permissions, [`${new URL(expectedBase).origin}/*`]);
      assert.ok(readFileSync(join(temp, 'dist', 'background', 'index.js'), 'utf8').includes(expectedBase));
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
