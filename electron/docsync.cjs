// Open documents and the files under them. Two jobs:
// 1. open-docs.json in userData says which files Falcon has open, which have unsaved edits, and when Falcon
//    last read and saved each one, so outside tools (Claude's scripts) know before they write a file.
// 2. Every open file is watched (its size and modified time, once a second). When something else changes
//    it, the page is told so it can merge the change in; and a Save over a file that changed since Falcon
//    last read or wrote it is refused, so it can't wipe out what the other program wrote.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const VERSION = 1;
const POLL_MS = 1000;
const sig = (st) => `${st.mtimeMs}:${st.size}`;
const stamp = (p) => fsp.stat(p).then(sig, () => null);
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** `statusFile`: where open-docs.json goes; `notify(path)`: a watched file changed outside Falcon. */
function createDocSync({ statusFile, notify }) {
  const known = new Map(); // path -> stamp of the file as Falcon last read or wrote it
  const told = new Map(); // path -> stamp the page was last told about
  const times = new Map(); // path -> { readAt, savedAt } (ms)
  let docs = [];
  let timer = null;

  function writeStatus() {
    const body = JSON.stringify({
      version: VERSION, pid: process.pid, updated: new Date().toISOString(),
      docs: docs.map((d) => ({ path: d.path ?? null, name: d.name, unsaved: d.unsaved, active: d.active, readAt: iso(times.get(d.path)?.readAt), savedAt: iso(times.get(d.path)?.savedAt) })),
    }, null, 2);
    const tmp = `${statusFile}.tmp`;
    try { fs.mkdirSync(path.dirname(statusFile), { recursive: true }); fs.writeFileSync(tmp, body); fs.renameSync(tmp, statusFile); } catch { /* the status file is a courtesy */ }
  }

  async function poll() {
    for (const d of docs) {
      const p = d.path;
      if (!p) continue;
      const now = await stamp(p);
      if (!known.has(p)) { known.set(p, now); continue; } // a doc restored from a backup: watch from here
      if (now && now !== known.get(p) && told.get(p) !== now) { told.set(p, now); notify(p); }
    }
  }

  return {
    /** Read `p` with `readFn`: the version read is the one the open doc is based on. Stamped before the read, so a
     *  write that lands during it still counts as a change. */
    async read(p, readFn) {
      const st = await stamp(p);
      const data = await readFn();
      known.set(p, st); told.delete(p); times.set(p, { ...times.get(p), readAt: Date.now() }); writeStatus();
      return data;
    },
    /** Falcon just wrote `p`. */
    async wrote(p) { known.set(p, await stamp(p)); told.delete(p); times.set(p, { ...times.get(p), savedAt: Date.now() }); writeStatus(); },
    /** Whether `p` changed on disk since Falcon last read or wrote it (false for a file it never read). */
    async changed(p) { return known.has(p) && known.get(p) !== null && (await stamp(p)) !== known.get(p); },
    /** The page's open docs: [{ path, name, unsaved, active }]. Watches exactly their files. */
    setDocs(list) {
      docs = Array.isArray(list) ? list.filter((d) => d && typeof d.name === 'string').map((d) => ({ path: typeof d.path === 'string' ? path.resolve(d.path) : null, name: d.name, unsaved: d.unsaved === true, active: d.active === true })) : [];
      const open = new Set(docs.map((d) => d.path));
      for (const p of [...known.keys()]) if (!open.has(p)) { known.delete(p); told.delete(p); times.delete(p); }
      writeStatus();
      if (docs.some((d) => d.path) && !timer) timer = setInterval(() => { void poll(); }, POLL_MS);
      if (!docs.some((d) => d.path) && timer) { clearInterval(timer); timer = null; }
    },
    poll,
    /** Quitting: nothing is open any more. */
    stop() { if (timer) clearInterval(timer); timer = null; docs = []; writeStatus(); },
  };
}

module.exports = { createDocSync };
