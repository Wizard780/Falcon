// Open documents and the files under them. Three jobs:
// 1. open-docs.json in userData says which files Falcon has open, which have unsaved edits, and when Falcon
//    last read and saved each one, so outside tools (Claude's scripts) know before they write a file.
// 2. Every open file is watched (its size and modified time, once a second). When something else changes
//    it, the page is told so it can merge the change in; and a Save over a file that changed since Falcon
//    last read or wrote it is refused, so it can't wipe out what the other program wrote.
// 3. The user's edits since a checkpoint, card by card, in edits/<hash>.json (the page works them out, edit-log.ts).
//    The checkpoint is the file as opened, or as another program last wrote it; a copy sits beside the record as
//    <hash>.base.docx. When the file is still as Falcon last saved it, reopening it keeps counting from there.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 1;
const POLL_MS = 1000;
const KEEP_MS = 14 * 24 * 3600 * 1000;
const sig = (st) => `${st.mtimeMs}:${st.size}`;
const stamp = (p) => fsp.stat(p).then(sig, () => null);
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** `statusFile`: where open-docs.json goes; `notify(path)`: a watched file changed outside Falcon. */
function createDocSync({ statusFile, notify }) {
  const known = new Map(); // path -> stamp of the file as Falcon last read or wrote it
  const told = new Map(); // path -> stamp the page was last told about
  const times = new Map(); // path -> { readAt, savedAt } (ms)
  const records = new Map(); // path -> the edit record (see editsFile), plus `continued` (not written)
  let docs = [];
  let timer = null;

  const editsDir = path.join(path.dirname(statusFile), 'edits');
  const editsFile = (p) => path.join(editsDir, `${crypto.createHash('sha1').update(p).digest('hex').slice(0, 16)}.json`);
  const baseFile = (p) => editsFile(p).replace(/\.json$/, '.base.docx');
  const loadRecord = (p) => { try { const r = JSON.parse(fs.readFileSync(editsFile(p), 'utf8')); return r && r.path === p ? r : null; } catch { return null; } };
  function saveRecord(p, rec) {
    const { continued: _c, ...body } = rec;
    const tmp = `${editsFile(p)}.tmp`;
    try { fs.mkdirSync(editsDir, { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(body, null, 2)); fs.renameSync(tmp, editsFile(p)); } catch { /* a courtesy too */ }
  }
  /** Start counting the user's edits from `data` (the file's bytes now). */
  async function freshRecord(p, data, why) {
    await fsp.mkdir(editsDir, { recursive: true });
    await fsp.writeFile(baseFile(p), data);
    const now = new Date().toISOString();
    const rec = { version: VERSION, path: p, checkpoint: { at: now, why, base: baseFile(p) }, savedStamp: null, updated: now, unsaved: false, cards: [], continued: false };
    records.set(p, rec);
    saveRecord(p, rec);
    return rec;
  }
  // records (and their copies of the file) untouched for two weeks go: a copy of every file ever opened would pile up
  void fsp.readdir(editsDir).then((names) => Promise.all(names.map(async (n) => {
    const f = path.join(editsDir, n);
    const st = await fsp.stat(f).catch(() => null);
    if (st && Date.now() - st.mtimeMs > KEEP_MS) await fsp.rm(f, { force: true });
  }))).catch(() => {});

  /** The record for `p` now stamped `st`: the earlier one when the file is still as Falcon last saved it, else null. */
  function carried(p, st) {
    const old = loadRecord(p);
    return old && st && old.savedStamp === st && fs.existsSync(baseFile(p)) ? { ...old, continued: true } : null;
  }

  function writeStatus() {
    const body = JSON.stringify({
      version: VERSION, pid: process.pid, updated: new Date().toISOString(),
      docs: docs.map((d) => ({ path: d.path ?? null, name: d.name, unsaved: d.unsaved, active: d.active, readAt: iso(times.get(d.path)?.readAt), savedAt: iso(times.get(d.path)?.savedAt), edits: d.path && records.has(d.path) ? editsFile(d.path) : null })),
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
      const first = !known.has(p), outside = !first && known.get(p) !== st;
      known.set(p, st); told.delete(p); times.set(p, { ...times.get(p), readAt: Date.now() });
      // the user's edits count from here, unless this is the file as Falcon last saved it (or as it was read before)
      if (first) { const rec = carried(p, st); if (rec) records.set(p, rec); else await freshRecord(p, data, 'opened'); }
      else if (outside || !records.has(p)) await freshRecord(p, data, outside ? 'changed-on-disk' : 'opened');
      writeStatus();
      return data;
    },
    /** Falcon just wrote `p`. */
    async wrote(p) {
      const st = await stamp(p);
      known.set(p, st); told.delete(p); times.set(p, { ...times.get(p), savedAt: Date.now() });
      const rec = records.get(p) ?? (await freshRecord(p, await fsp.readFile(p), 'saved-as'));
      rec.savedStamp = st;
      saveRecord(p, rec);
      writeStatus();
    },
    /** The checkpoint the page counts `p`'s edits from: `data` is the file to count from when it isn't the doc the page
     *  opened (an earlier session's checkpoint, or a doc restored from a backup and never read here), else null. */
    async checkpoint(p) {
      if (records.has(p)) { const rec = records.get(p); return { continued: rec.continued, data: rec.continued ? await fsp.readFile(baseFile(p)) : null }; }
      const st = await stamp(p);
      if (!st) return { continued: false, data: null };
      if (!known.has(p)) known.set(p, st);
      const rec = carried(p, st);
      if (rec) { records.set(p, rec); writeStatus(); return { continued: true, data: await fsp.readFile(baseFile(p)) }; }
      const data = await fsp.readFile(p);
      await freshRecord(p, data, 'opened');
      writeStatus();
      return { continued: false, data };
    },
    /** The page's latest count of the user's edits to `p`: { cards, unsaved }. */
    writeEdits(p, edits) {
      const rec = records.get(p);
      if (!rec || !edits || !Array.isArray(edits.cards)) return;
      rec.cards = edits.cards;
      rec.unsaved = edits.unsaved === true;
      rec.updated = new Date().toISOString();
      saveRecord(p, rec);
    },
    /** Whether `p` changed on disk since Falcon last read or wrote it (false for a file it never read). */
    async changed(p) { return known.has(p) && known.get(p) !== null && (await stamp(p)) !== known.get(p); },
    /** The page's open docs: [{ path, name, unsaved, active }]. Watches exactly their files. */
    setDocs(list) {
      docs = Array.isArray(list) ? list.filter((d) => d && typeof d.name === 'string').map((d) => ({ path: typeof d.path === 'string' ? path.resolve(d.path) : null, name: d.name, unsaved: d.unsaved === true, active: d.active === true })) : [];
      const open = new Set(docs.map((d) => d.path));
      for (const p of [...known.keys()]) if (!open.has(p)) { known.delete(p); told.delete(p); times.delete(p); records.delete(p); }
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
