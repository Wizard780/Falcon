// SpeechDrop (speechdrop.net) from the main process: join or make a room, list it live, upload, delete
// your own uploads, download one file or all of them. The engine is the debate-uploader plugin's
// (lib/speechdrop.mjs, lib/roomwatch.mjs), plus the parts of SpeechDrop's own site the plugin never
// needed: making rooms, the room's name and deleting. The routes follow SpeechDrop's source
// (github.com/yunyu/speechdrop, SpeechDropApplication.java). Nothing here imports Electron, so tests
// run it with a fake fetch.
const fs = require('node:fs/promises');
const path = require('node:path');
const { crc32 } = require('node:zlib');

const ROOM_RE = /^[A-Za-z0-9]{1,32}$/;
const MAX_BYTES = 10 * 1024 * 1024; // SpeechDrop's own limit
// SpeechDrop takes these (by MIME type, and .cmir by name)
const MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.pages': 'application/x-iwork-pages-sffpages',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.cmir': 'application/octet-stream',
};

function mimeFor(name) {
  const mime = MIME[path.extname(String(name)).toLowerCase()];
  if (!mime) throw new Error('bad_type');
  return mime;
}
const checkRoom = (room) => { if (!ROOM_RE.test(room ?? '')) throw new Error('bad_room'); };

/** SpeechDrop's index → newest first, deleted slots (null holes) dropped. `index` is the slot, part of the download URL. */
function parseIndex(entries) {
  return entries
    .map((e, index) => (e && typeof e.name === 'string' ? { index, name: e.name, ctime: Number(e.ctime) || 0 } : null))
    .filter(Boolean)
    .reverse();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", '#x2F': '/', '#47': '/' };
const htmlDecode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|#x27|#x2F|#47);/g, (_, k) => ENTITIES[k]);

function createSpeechDrop({
  base = 'https://speechdrop.net',
  media = 'https://media.speechdrop.net/uploads/',
  fetchImpl = (...a) => fetch(...a),
  timeoutMs = 20_000,
} = {}) {
  const get = async (url, init = {}) => {
    try { return await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), ...init }); }
    catch { throw new Error('unreachable'); }
  };
  // the page's cookies and its XSRF token: every write needs both (signed double-submit tokens)
  const token = (res) => {
    const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    const xsrf = cookies.find((c) => c.startsWith('XSRF-TOKEN='))?.slice('XSRF-TOKEN='.length);
    if (!xsrf) throw new Error('no_csrf');
    return { cookie: cookies.join('; '), xsrf };
  };
  const json = async (res) => {
    let v;
    try { v = JSON.parse(await res.text()); } catch { throw new Error('bad_response'); }
    if (!Array.isArray(v)) throw new Error('bad_response');
    return v;
  };

  /** The room page: its name and files, and the token a write needs. A room that doesn't exist redirects home. */
  async function page(room) {
    checkRoom(room);
    const res = await get(`${base}/${room}`, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) throw new Error('no_room');
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res;
  }

  return {
    /** Join: the room's name and its files, newest first. */
    async room(room) {
      const res = await page(room);
      const html = await res.text();
      const m = /window\.roomConfig\s*=\s*(\{.*?\});\s*<\/script>/s.exec(html);
      let config = null;
      try { config = m ? JSON.parse(m[1]) : null; } catch { /* below */ }
      if (!config) throw new Error('bad_response');
      return { room, name: htmlDecode(config.roomName ?? room), files: parseIndex(Array.isArray(config.initialFiles) ? config.initialFiles : []) };
    },

    /** The file list alone (what the live view polls without a socket). */
    async list(room) {
      checkRoom(room);
      const res = await get(`${base}/${room}/index`);
      if (res.status === 404) throw new Error('no_room');
      if (!res.ok) throw new Error(`http_${res.status}`);
      return parseIndex(await json(res));
    },

    /** Make a room called `name`: SpeechDrop answers with a redirect to its new code. */
    async make(name) {
      const n = String(name ?? '').trim();
      if (!n || n.length > 60) throw new Error('bad_name');
      const home = await get(`${base}/`);
      if (!home.ok) throw new Error(`http_${home.status}`);
      const { cookie, xsrf } = token(home);
      const form = new URLSearchParams({ name: n, 'X-XSRF-TOKEN': xsrf });
      const res = await get(`${base}/makeroom`, { method: 'POST', redirect: 'manual', body: form, headers: { Cookie: cookie, 'X-XSRF-TOKEN': xsrf } });
      const code = (res.headers.get('location') ?? '').replace(/^.*\//, '');
      if (res.status < 300 || res.status >= 400 || !ROOM_RE.test(code)) throw new Error(res.status === 403 ? 'no_csrf' : 'make_failed');
      return code;
    },

    /** Upload one file. Returns the new list and the slot it took (only its uploader may delete it). */
    async upload({ room, name, bytes }) {
      checkRoom(room);
      if (bytes.length > MAX_BYTES) throw new Error('too_large');
      const type = mimeFor(name);
      const { cookie, xsrf } = token(await page(room));
      const form = new FormData();
      form.append('X-XSRF-TOKEN', xsrf);
      form.append('file', new Blob([bytes], { type }), name);
      let up;
      try {
        up = await fetchImpl(`${base}/${room}/upload`, { method: 'POST', body: form, headers: { Cookie: cookie, 'X-XSRF-TOKEN': xsrf }, signal: AbortSignal.timeout(60_000) });
      } catch { throw new Error('upload_unknown'); }
      // from here the file may already be stored, so anything unclear is upload_unknown ("check the room"), never a plain failure
      let text;
      try { text = await up.text(); } catch { throw new Error('upload_unknown'); }
      if (up.status === 400) {
        let err = 'rejected';
        try { err = JSON.parse(text).err ?? err; } catch { /* keep rejected */ }
        throw new Error(err);
      }
      if (up.status === 404) throw new Error('no_room');
      if (up.status >= 500) throw new Error('upload_unknown');
      if (!up.ok) throw new Error(`http_${up.status}`);
      let entries;
      try { entries = JSON.parse(text); } catch { throw new Error('upload_unknown'); }
      if (!Array.isArray(entries)) throw new Error('upload_unknown');
      const slot = Number(up.headers.get('x-uploaded-file-index'));
      return { files: parseIndex(entries), index: Number.isInteger(slot) && slot >= 0 && entries[slot] ? slot : null };
    },

    /** Delete the file in `index` (SpeechDrop's site offers this only to its uploader). Returns the new list. */
    async remove(room, index) {
      if (!Number.isInteger(index) || index < 0) throw new Error('bad_index');
      const { cookie, xsrf } = token(await page(room));
      const res = await get(`${base}/${room}/delete`, {
        method: 'POST',
        body: `fileIndex=${index}`,
        headers: { Cookie: cookie, 'X-XSRF-TOKEN': xsrf, 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (res.status === 404) throw new Error('no_room');
      if (!res.ok) throw new Error(`http_${res.status}`);
      return parseIndex(await json(res));
    },

    /** One file's bytes. */
    async download({ room, index, name }) {
      checkRoom(room);
      try {
        const res = await fetchImpl(`${media}${room}/${index}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error();
        return Buffer.from(await res.arrayBuffer());
      } catch { throw new Error('download_failed'); }
    },
  };
}

/**
 * Live file lists, one room at a time: SpeechDrop's Vert.x event-bus socket pushes the whole index on every
 * change. Without a socket (blocked, dropped) it polls `list` every `pollMs` and keeps trying to reconnect.
 * `onFiles({ room, files, live })` fires on every change, and when the connection comes or goes.
 */
function createWatcher({ wsUrl = 'wss://speechdrop.net/sock/websocket', list, onFiles, WebSocketImpl = globalThis.WebSocket, pollMs = 5000, pingMs = 5000, reconnectMs = 1000 }) {
  let cur = null;
  function stop() {
    if (!cur) return;
    const r = cur;
    cur = null;
    clearInterval(r.ping); clearInterval(r.poll); clearTimeout(r.retry);
    if (r.ws) { const ws = r.ws; r.ws = null; try { ws.close(); } catch { /* already closed */ } }
  }
  const send = (r) => { if (cur === r) onFiles({ room: r.room, files: r.files ?? [], live: r.live }); };
  const setFiles = (r, files) => {
    if (r.files && JSON.stringify(r.files) === JSON.stringify(files)) return;
    r.files = files;
    send(r);
  };
  const poll = async (r) => { try { setFiles(r, await list(r.room)); } catch { /* next tick tries again */ } };
  function connect(r) {
    if (!WebSocketImpl) return;
    let ws;
    try { ws = new WebSocketImpl(wsUrl); } catch { return; }
    r.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', address: `speechdrop.room.${r.room}` }));
      r.ping = setInterval(() => { try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* closing */ } }, pingMs);
    };
    ws.onmessage = async (e) => {
      let msg, entries;
      try { msg = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text()); } catch { return; }
      if (msg.type !== 'rec') return;
      try { entries = JSON.parse(msg.body); } catch { return; }
      if (!Array.isArray(entries) || cur !== r) return;
      r.failures = 0;
      if (!r.live) { r.live = true; clearInterval(r.poll); r.poll = 0; send(r); }
      setFiles(r, parseIndex(entries));
    };
    ws.onerror = ws.onclose = () => {
      if (r.ws !== ws) return; // already handled, or stopped
      r.ws = null;
      clearInterval(r.ping);
      if (cur !== r) return;
      if (r.live) { r.live = false; send(r); }
      if (!r.poll) r.poll = setInterval(() => void poll(r), pollMs);
      const delay = Math.min(30_000, reconnectMs * 2 ** Math.min(r.failures++, 5));
      r.retry = setTimeout(() => { if (cur === r) connect(r); }, delay);
    };
  }
  return {
    /** Watch `room` (null stops), starting from the list the caller already has. */
    watch(room, files = null) {
      if (cur?.room === room) return;
      stop();
      if (!room) return;
      checkRoom(room);
      const r = { room, files, live: false, ws: null, failures: 0, ping: 0, poll: 0, retry: 0 };
      cur = r;
      // poll until the socket says it's live
      r.poll = setInterval(() => void poll(r), pollMs);
      connect(r);
    },
    stop,
  };
}

/** Never overwrites: an identical file is reused, a different one gets "name (2).ext", "(3)", ... */
async function saveUnique(dir, name, bytes) {
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || path.basename(name) !== name) throw new Error('bad_name');
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const p = path.join(dir, n === 1 ? name : `${stem} (${n})${ext}`);
    let existing;
    try { existing = await fs.readFile(p); } catch { await fs.writeFile(p, bytes); return p; }
    if (existing.equals(bytes)) return p;
  }
}

/** First free "name.ext", "name (2).ext", ... in dir. */
async function freeName(dir, name) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const p = path.join(dir, n === 1 ? name : `${stem} (${n})${ext}`);
    try { await fs.stat(p); } catch { return p; }
  }
}

/** Streams a .zip to disk, stored not deflated (.docx and .pdf are compressed already). Same name twice → "name (2).ext". */
async function createZipWriter(file) {
  const fh = await fs.open(file, 'w');
  const used = new Set(), centrals = [];
  let offset = 0;
  return {
    async add(name, bytes) {
      const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
      let unique = name;
      for (let n = 2; used.has(unique.toLowerCase()); n++) unique = `${stem} (${n})${ext}`;
      used.add(unique.toLowerCase());
      if (centrals.length >= 0xffff || offset + bytes.length + 1024 > 0xffffffff) throw new Error('too_large');
      const nm = Buffer.from(unique, 'utf8'), crc = crc32(bytes) >>> 0;
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(0x21, 12);
      head.writeUInt32LE(crc, 14); head.writeUInt32LE(bytes.length, 18); head.writeUInt32LE(bytes.length, 22); head.writeUInt16LE(nm.length, 26);
      const cen = Buffer.alloc(46);
      cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x800, 8); cen.writeUInt16LE(0x21, 14);
      cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(bytes.length, 20); cen.writeUInt32LE(bytes.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(offset, 42);
      await fh.write(Buffer.concat([head, nm, bytes]));
      centrals.push(cen, nm);
      offset += 30 + nm.length + bytes.length;
    },
    async close() {
      const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
      end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
      await fh.write(Buffer.concat([cd, end]));
      await fh.close();
    },
    abort: () => fh.close().catch(() => {}),
  };
}

/** A file or folder name that's safe on Mac and Windows. */
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 80) || 'SpeechDrop';

module.exports = { createSpeechDrop, createWatcher, parseIndex, mimeFor, saveUnique, freeName, createZipWriter, safeName, MAX_BYTES, MIME };
