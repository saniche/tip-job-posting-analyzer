// Cross-platform build (no cp/rm shell commands, works on Windows, macOS, Linux)
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');
const apiBase = process.env.API_BASE ?? 'http://localhost:8000/api/v1';
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.host_permissions = [new URL(apiBase).origin + '/*'];

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/popup', { recursive: true });

await build({
  entryPoints: ['src/background/index.ts', 'src/popup/popup.ts'],
  bundle: true,
  outbase: 'src',
  outdir: 'dist',
  format: 'esm',
  target: 'chrome120',
  define: {
    __API_BASE__: JSON.stringify(apiBase)
  }
});

writeFileSync('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
cpSync('src/popup/popup.html', 'dist/popup/popup.html');
cpSync('src/popup/popup.css', 'dist/popup/popup.css');
console.log('Built -> dist/  (load THIS folder in chrome://extensions)');
