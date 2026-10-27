// Cross-platform build (no cp/rm shell commands, works on Windows, macOS, Linux)
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/popup', { recursive: true });

await build({
  entryPoints: ['src/background/index.ts', 'src/popup/popup.ts'],
  bundle: true,
  outbase: 'src',
  outdir: 'dist',
  format: 'esm',
  target: 'chrome120',
});

cpSync('manifest.json', 'dist/manifest.json');
cpSync('src/popup/popup.html', 'dist/popup/popup.html');
cpSync('src/popup/popup.css', 'dist/popup/popup.css');
console.log('Built -> dist/  (load THIS folder in chrome://extensions)');
