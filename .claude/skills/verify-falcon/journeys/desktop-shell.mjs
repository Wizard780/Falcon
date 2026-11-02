// The Electron shell, with no visible window: runs the repo's scripts/electron-smoke.mjs against dist/
// (or a packaged app via FALCON_EXE) and files its transcript and screenshots under evidence/desktop-shell.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.env.FALCON_EVIDENCE, 'desktop-shell');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync('shots', { recursive: true }); // the smoke script writes shots/electron-<platform>.png, relative to the repo
// it swallows a failed confirm-dialog screenshot: drop old ones so a stale png never lands in this run's evidence
for (const f of fs.readdirSync('shots').filter((f) => f.startsWith('electron-'))) fs.rmSync(`shots/${f}`);
const env = { ...process.env, FALCON_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(process.execPath, ['scripts/electron-smoke.mjs'], { env, encoding: 'utf8', timeout: 120000 });
fs.writeFileSync(path.join(out, 'transcript.txt'), `$ node scripts/electron-smoke.mjs\nexit ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);
for (const f of fs.readdirSync('shots').filter((f) => f.startsWith('electron-'))) fs.copyFileSync(`shots/${f}`, path.join(out, f));
const ok = r.status === 0 && /visible: \[ false \]/.test(r.stdout);
const line = `${ok ? 'ok  ' : 'FAIL'} electron smoke exit ${r.status}, window never shown: ${/visible: \[ false \]/.test(r.stdout)}`;
fs.writeFileSync(path.join(out, 'results.txt'), line + '\n');
console.log(`${r.stdout}${r.stderr}${line}\nevidence: ${out}`);
process.exitCode = ok ? 0 : 1;
