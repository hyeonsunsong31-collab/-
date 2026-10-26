// Builds the static client in offline-save mode and prepares it for publishing as a hosted page:
// the page body (no document skeleton — the host wraps it) plus every asset, listed in a manifest.
// Usage: node scripts/build-artifact.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const out = 'client/dist-artifact';
execSync(`npx vite build --config client/vite.config.ts client --outDir dist-artifact --emptyOutDir`, {
  stdio: 'inherit',
  env: { ...process.env, VITE_OFFLINE: '1' },
});

const html = readFileSync(join(out, 'index.html'), 'utf8');
const head = /<head>([\s\S]*?)<\/head>/i.exec(html)[1];
const body = /<body>([\s\S]*?)<\/body>/i.exec(html)[1];
// Keep the title, the module script(s) and stylesheet links; the host supplies charset/viewport.
const keep = head
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => /^<title>|<script |<link rel="(stylesheet|modulepreload)"/.test(l));
const page = [
  '<title>Ascendant Ki</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  '<meta name="theme-color" content="#0b0d12">',
  // Full-bleed game: the canvas and HUD are fixed to the viewport (HUD edges add the safe-area insets themselves),
  // so the body's side gutter never moves anything; it is there for the host's side-cover contract.
  '<style>:root{--ak-bg:#0b0d12;--ak-paper:#f4efe2;color-scheme:dark}html,body{height:100%;background:var(--ak-bg);color:var(--ak-paper);overflow:hidden}body{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}</style>',
  ...keep.filter((l) => !l.startsWith('<title>')),
  body.replace(/<script[^>]*src="\/src\/main\.ts"[^>]*><\/script>/, '').trim(),
].join('\n');
writeFileSync(join(out, 'page.html'), page);

const files = {};
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (!/index\.html$|page\.html$/.test(p)) files[relative(out, p)] = p;
  }
};
walk(out);
writeFileSync(join(out, 'files.json'), JSON.stringify(files, null, 2));
let total = 0;
for (const p of Object.values(files)) total += statSync(p).size;
console.log(`page.html + ${Object.keys(files).length} files, ${(total / 1024 / 1024).toFixed(2)} MB`);
