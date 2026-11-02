// File search (Cmd-K): the folders the user allowed in Settings, and the .docx files inside them.
// Only these folders are read, and the page gets names and paths, never file contents.
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_DEPTH = 12;
const MAX_FILES = 20000; // per folder: a whole home folder stays bounded
const STALE_MS = 15000; // a list older than this is scanned again (in the background) when asked for
const SKIP_DIRS = new Set(['node_modules', 'Library', 'AppData', '$RECYCLE.BIN', 'System Volume Information']);

/** Every .docx under `root`, skipping hidden folders, Word's ~$ lock files and app folders. */
async function scan(root) {
  const files = [];
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; } // no access: skip it
    const subdirs = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) subdirs.push(p); }
      else if (e.isFile() && e.name.toLowerCase().endsWith('.docx') && !e.name.startsWith('~$')) {
        if (files.length >= MAX_FILES) return;
        files.push(p);
      }
    }
    for (const d of subdirs) await walk(d, depth + 1);
  }
  await walk(root, 0);
  // modified times, for ranking newer files first among equal matches
  return Promise.all(files.map(async (p) => ({ path: p, mtime: await fs.stat(p).then((s) => s.mtimeMs, () => 0) })));
}

/** True when `p` is `root` itself or inside it (path.relative, so /a/Docs2 is not inside /a/Docs). */
function inside(root, p) {
  const rel = path.relative(root, p);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function createIndex(storeFile) {
  let folders = null; // string[] once loaded
  const cache = new Map(); // folder -> { files, at, scanning: Promise | null, error }

  async function load() {
    if (folders) return folders;
    try { folders = JSON.parse(await fs.readFile(storeFile, 'utf8')).filter((p) => typeof p === 'string'); }
    catch { folders = []; }
    return folders;
  }
  const store = () => fs.writeFile(storeFile, JSON.stringify(folders)).catch(() => {});

  function rescan(folder) {
    const c = cache.get(folder) ?? { files: [], at: 0, scanning: null, error: null };
    cache.set(folder, c);
    if (c.scanning) return c.scanning;
    c.scanning = (async () => {
      const ok = await fs.stat(folder).then((s) => s.isDirectory(), () => false);
      c.error = ok ? null : 'missing';
      c.files = ok ? await scan(folder) : [];
      c.at = Date.now();
      c.scanning = null;
    })();
    return c.scanning;
  }

  return {
    /** The allowed folders, each with how many files it holds (null while its first scan runs). */
    async folders() {
      return (await load()).map((p) => {
        const c = cache.get(p);
        return { path: p, count: c && c.at ? c.files.length : null, missing: c?.error === 'missing' };
      });
    },
    async add(paths) {
      const list = await load();
      for (const raw of paths) {
        const p = path.resolve(raw);
        // a folder already covered by an allowed one adds nothing; one that covers allowed folders replaces them
        if (list.some((f) => inside(f, p))) continue;
        for (const f of list.filter((f) => inside(p, f))) { list.splice(list.indexOf(f), 1); cache.delete(f); }
        list.push(p);
      }
      await store();
      await Promise.all(list.map((f) => (cache.get(f)?.at ? null : rescan(f))));
    },
    async remove(p) {
      const list = await load();
      const i = list.indexOf(p);
      if (i >= 0) { list.splice(i, 1); cache.delete(p); await store(); }
    },
    /** Every indexed file. Answers from the last scan right away (a folder never scanned is waited for
     * once), and scans stale folders again in the background so the next ask is current. */
    async files() {
      const list = await load();
      await Promise.all(list.map((f) => {
        const c = cache.get(f);
        if (!c || !c.at) return rescan(f);
        if (Date.now() - c.at > STALE_MS) void rescan(f);
        return null;
      }));
      return list.flatMap((root) => (cache.get(root)?.files ?? []).map((f) => ({ path: f.path, root, mtime: f.mtime })));
    },
    /** May the page open `p` by path? Only a .docx inside an allowed folder. */
    async allows(p) {
      return p.toLowerCase().endsWith('.docx') && (await load()).some((f) => inside(f, p));
    },
  };
}

module.exports = { createIndex, scan, inside };
