// The Electron app with the record of the user's edits: runs scripts/edit-log-check.mjs (on a copy of
// FALCON_DOC, default the seed) and files its results and screenshots under evidence/edit-log.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.env.FALCON_EVIDENCE, 'edit-log');
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env, FALCON_SHOTS: out };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(process.execPath, ['scripts/edit-log-check.mjs'], { env, encoding: 'utf8', timeout: 150000 });
fs.writeFileSync(path.join(out, 'transcript.txt'), `$ node scripts/edit-log-check.mjs\nexit ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);
const lines = (r.stdout ?? '').split('\n').filter((l) => /^(ok  |FAIL)/.test(l));
fs.writeFileSync(path.join(out, 'results.txt'), `${lines.join('\n')}\n`);
console.log(`${lines.join('\n')}\nevidence: ${out}`);
process.exitCode = r.status === 0 && lines.length && !lines.some((l) => l.startsWith('FAIL')) ? 0 : 1;
