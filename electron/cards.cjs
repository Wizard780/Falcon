// Search cards: every card (tag, cite, and the pocket/hat/block it sits under) in the .docx files of the
// folders allowed in Settings. Only changed files are read again, and the index is kept on disk, so a
// restart doesn't read everything. The page gets tags, cites and headings back, never whole files.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const VERSION = 1;
const STALE_MS = 15000; // asked again after this long: look for changed files (in the background)
const SEP = '\u0001';
// kept short: a big backfile has hundreds of thousands of cards, and all of them stay in memory
const TAG_MAX = 250, CITE_MAX = 160;

// ---------- reading a .docx ----------

/** The named entries of a zip, inflated. Only what a .docx needs: stored or deflated, no zip64. */
function unzip(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count && buf.readUInt32LE(at) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    if (want.includes(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      out[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    }
    at += 46 + nameLen + extra + comment;
  }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? decode(m[1]) : null; };
const valOf = (xml, el) => { const m = new RegExp(`<w:${el}\\b[^>]*>`).exec(xml); return m ? attr(m[0], 'w:val') : null; };

// Which outline level a paragraph style is: the same rules as src/docx/import.ts (paraStyleOf), so the
// nth card here is the nth tag or analytic Falcon shows when it opens the file.
const LEVEL_BY_ID = { heading1: 1, heading2: 2, heading3: 3, heading4: 4, analytic: 4 };
function levelByName(n) {
  if (/^analytic/.test(n)) return 4;
  if (/^undertag/.test(n)) return 0;
  const m = /^heading ?([1-4])$/.exec(n);
  if (m) return Number(m[1]);
  return { pocket: 1, hat: 2, block: 3, tag: 4 }[n] ?? null;
}
function readStyles(xml) {
  const styles = new Map();
  for (const m of (xml ?? '').matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = attr(m[1], 'w:styleId');
    if (!id) continue;
    const ol = valOf(m[2], 'outlineLvl');
    styles.set(id, {
      name: (valOf(m[2], 'name') ?? id).toLowerCase(),
      alias: (valOf(m[2], 'aliases') ?? '').split(',')[0].trim().toLowerCase(),
      basedOn: valOf(m[2], 'basedOn'),
      outline: ol == null ? null : Number(ol),
    });
  }
  return styles;
}
function levelOf(styles, id, ol) {
  const seen = new Set();
  for (let s; id && !seen.has(id) && (s = styles.get(id)); id = s.basedOn) {
    seen.add(id);
    const hit = LEVEL_BY_ID[id.toLowerCase()] ?? levelByName(s.name) ?? levelByName(s.alias);
    if (hit != null) return hit;
    if (s.outline != null && s.outline <= 3) return s.outline + 1;
  }
  return ol != null && Number(ol) <= 3 ? Number(ol) + 1 : 0;
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** The body without its tables: Falcon's outline (and so its card count) only has the paragraphs outside them. */
function outsideTables(xml) {
  let out = '', depth = 0, from = 0;
  for (const m of xml.matchAll(/<(\/?)w:tbl\b[^>]*>/g)) {
    if (!m[1]) { if (depth++ === 0) { out += xml.slice(from, m.index); } }
    else if (depth > 0 && --depth === 0) from = m.index + m[0].length;
  }
  return depth ? out : out + xml.slice(from);
}

/** The cards in one .docx: [tag, cite, headings joined by SEP]. A tag or analytic starts a card; a tag's cite
 *  is the first paragraph with text under it (an analytic has none). */
function parseDocx(buf) {
  const z = unzip(buf, ['word/document.xml', 'word/styles.xml']);
  if (!z['word/document.xml']) throw new Error('not a .docx');
  const styles = readStyles(z['word/styles.xml']);
  const cards = [];
  const heads = ['', '', ''];
  let open = null; // the tag still waiting for its cite
  let under = ''; // the headings, joined once per change so the cards under them share the string
  for (const m of outsideTables(z['word/document.xml']).matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const body = m[1] ?? '';
    const ppr = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(body)?.[1] ?? '';
    const level = levelOf(styles, valOf(ppr, 'pStyle'), valOf(ppr, 'outlineLvl'));
    let text = '';
    for (const r of body.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|noBreakHyphen)\b[^>]*\/>/g)) text += r[1] != null ? decode(r[1]) : r[2] === 'noBreakHyphen' ? '\u2011' : ' ';
    text = clean(text);
    if (level >= 1 && level <= 3) { heads[level - 1] = text; heads.fill('', level); under = heads.filter(Boolean).join(SEP); open = null; continue; }
    if (level === 4) {
      const analytic = /analytic/.test(styles.get(valOf(ppr, 'pStyle'))?.name ?? '');
      const card = [text.slice(0, TAG_MAX), '', under];
      cards.push(card);
      open = analytic ? null : card;
      continue;
    }
    if (open && text) { open[1] = text.slice(0, CITE_MAX); open = null; }
  }
  return cards;
}

// ---------- ranking ----------

const words = (q) => String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every query word has to be in the tag, cite, headings or file name. A word at the start of a word ("chen" in
 *  "Chen 25") beats one inside a word ("kitchen"), tag and cite beat headings and file name, the cite's author beats
 *  a name further into it, cards with a cite
 *  beat analytics, and the same card saved in several files shows once (the newest copy). */
function rank(hay, query, limit = 60) {
  const ws = words(query);
  // one letter matches nearly every card: wait for a second
  if (ws.join('').length < 2) return [];
  const starts = ws.map((w) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(w)}`, 'u'));
  const groups = new Map();
  for (const h of hay) {
    let score = 0;
    for (let k = 0; k < ws.length; k++) {
      let best = 0;
      for (const [text, weight] of [[h.tag, 3], [h.cite, 3], [h.heads, 1], [h.name, 1]]) {
        if (weight * 2 > best && text.includes(ws[k])) best = Math.max(best, weight * (starts[k].test(text) ? 2 : 1));
      }
      if (!best) { score = 0; break; }
      score += best + (h.cite.startsWith(ws[k]) ? 1 : 0); // the cite's author
    }
    if (!score) continue;
    const key = `${h.tag}\n${h.cite}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { h, score, copies: 1 });
    else { g.copies++; if (h.mtime > g.h.mtime) { g.h = h; g.score = Math.max(score, g.score); } }
  }
  return [...groups.values()]
    .sort((a, b) => b.score - a.score || !!b.h.cite - !!a.h.cite || b.copies - a.copies || b.h.mtime - a.h.mtime || a.h.tag.localeCompare(b.h.tag))
    .slice(0, limit);
}

// ---------- the index ----------

/** `listFiles` gives every .docx in the allowed folders ([{ path, mtime }]); `storeFile` keeps the index. */
function createCardIndex(storeFile, listFiles) {
  let files = new Map(); // path -> { mtime, size, bad, cards }
  let hay = null; // lowercase copies for searching, built on the first search after a change
  let loaded = null, scanning = null, scannedAt = 0;
  let progress = { done: 0, total: 0 };

  const load = () => (loaded ??= fsp.readFile(storeFile, 'utf8').then((s) => {
    const saved = JSON.parse(s);
    if (saved.version !== VERSION) return;
    // the cards under one heading share its string instead of each holding a copy
    const one = new Map();
    for (const [, , , , cards] of saved.files) for (const c of cards) { const h = one.get(c[2]); if (h === undefined) one.set(c[2], c[2]); else c[2] = h; }
    files = new Map(saved.files.map(([p, mtime, size, bad, cards]) => [p, { mtime, size, bad, cards }]));
  }, () => {}).catch(() => {}));

  async function save() {
    const tmp = `${storeFile}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ version: VERSION, files: [...files].map(([p, f]) => [p, f.mtime, f.size, f.bad, f.cards]) }));
    await fsp.rename(tmp, storeFile);
  }

  async function doScan() {
    await load();
    const list = await listFiles();
    progress = { done: 0, total: list.length };
    const next = new Map();
    const first = !files.size;
    let changed = list.length !== files.size;
    for (const { path: p } of list) {
      try {
        const st = await fsp.stat(p);
        const old = files.get(p);
        if (old && old.mtime === st.mtimeMs && old.size === st.size) next.set(p, old);
        else {
          changed = true;
          let cards = [], bad = false;
          // a sync read is much faster than an async one for big files; yield after each so other requests get through
          try { cards = parseDocx(fs.readFileSync(p)); } catch { bad = true; }
          next.set(p, { mtime: st.mtimeMs, size: st.size, bad, cards });
          await new Promise((r) => setImmediate(r));
        }
      } catch { /* gone since the folder was listed */ }
      progress.done++;
      // the first time through, search what's read so far instead of nothing
      if (first && progress.done % 100 === 0) { files = new Map(next); hay = null; }
    }
    if (changed || first) { files = next; hay = null; } // unchanged: keep the search copies already built
    scannedAt = Date.now();
    if (changed) await save().catch(() => {});
  }

  function scan() {
    return (scanning ??= doScan().finally(() => { scanning = null; }));
  }

  function haystack() {
    if (hay) return hay;
    hay = [];
    for (const [p, f] of files) {
      const name = path.basename(p).replace(/\.docx$/i, '').toLowerCase();
      let last = null, lower = '';
      f.cards.forEach(([tag, cite, heads], i) => {
        if (heads !== last) { last = heads; lower = heads.toLowerCase(); }
        hay.push({ path: p, i, mtime: f.mtime, tag: tag.toLowerCase(), cite: cite.toLowerCase(), heads: lower, name });
      });
    }
    return hay;
  }

  function status() {
    let cards = 0;
    for (const f of files.values()) cards += f.cards.length;
    return { files: files.size, cards, scanning: !!scanning, done: progress.done, total: progress.total };
  }

  return {
    scan,
    /** Matching cards, from what's indexed now. A stale index is brought up to date in the background. */
    async search(query, limit) {
      await load();
      if (!scanning && Date.now() - scannedAt > STALE_MS) void scan();
      const hits = rank(haystack(), query, limit).map(({ h, copies }) => {
        const [tag, cite, heads] = files.get(h.path).cards[h.i];
        return { path: h.path, ordinal: h.i, file: path.basename(h.path).replace(/\.docx$/i, ''), tag, cite, headings: heads ? heads.split(SEP) : [], copies };
      });
      return { hits, status: status() };
    },
    status,
  };
}

module.exports = { createCardIndex, parseDocx, rank, unzip };
