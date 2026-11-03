import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge, type SdFile, type SdResult } from '../editor/host';
import type { Ask } from './Confirm';
import { SvgIcon } from './icons';
import { readJson, safeSet } from './storage';
import './speechdrop.css';

/**
 * The SpeechDrop tab: SpeechDrop's own site (join a room by its code or make one; the room's files, live,
 * newest first; upload by button or drop; download one or all; delete what you uploaded) inside Falcon.
 * A .docx opens as a Falcon tab, and "Upload" sends the doc you came from without saving it first.
 * It stays mounted while the tab is open, so the room keeps updating behind the editor.
 */

const ROOMS_KEY = 'falcon.sd.rooms'; // rooms joined, newest first: [{ code, name, when }]
const MINE_KEY = 'falcon.sd.mine'; // what this Falcon uploaded, so it may delete it: { room: { slot: when } }
const KEEP_MS = 8 * 24 * 3600_000; // SpeechDrop clears rooms after a week
const CODE_LEN = 6;
const ERRORS: Record<string, string> = {
  no_room: 'No room has that code',
  bad_room: 'Room codes are letters and numbers',
  unreachable: "Couldn't reach SpeechDrop. Check the wifi",
  too_large: "It's over SpeechDrop's 10 MB limit",
  bad_type: "SpeechDrop doesn't take that kind of file",
  upload_unknown: "The upload may not have gone through. Check the room's list",
  no_csrf: 'SpeechDrop turned the request down. Try again',
  gone: "That file isn't in the room anymore",
  download_failed: "Couldn't download it. Try again",
  empty: 'The room has no files yet',
  bad_name: 'Room names are 1 to 60 characters',
};
const say = (code: string) => ERRORS[code] ?? `SpeechDrop said ${code}`;

type Room = { code: string; name: string };
type Recent = Room & { when: number };
export type SdTab = { room: Room | null; fresh: number };

const recentRooms = () => readJson<Recent[]>(ROOMS_KEY, []).filter((r) => Date.now() - r.when < KEEP_MS);
function mine(room: string): Record<string, number> {
  return readJson<Record<string, Record<string, number>>>(MINE_KEY, {})[room] ?? {};
}
function setMine(room: string, slot: number, on: boolean) {
  const all = readJson<Record<string, Record<string, number>>>(MINE_KEY, {});
  const r = { ...all[room] };
  if (on) r[slot] = Date.now(); else delete r[slot];
  all[room] = r;
  for (const [k, v] of Object.entries(all)) {
    for (const [s, t] of Object.entries(v)) if (Date.now() - t > KEEP_MS) delete v[s];
    if (!Object.keys(v).length) delete all[k];
  }
  safeSet(MINE_KEY, JSON.stringify(all));
}

/** When a file came: 4:05 pm today, else Mon 4:05 pm, as SpeechDrop's own list shows times. */
function when(ms: number, now = new Date()) {
  if (!ms) return '';
  const d = new Date(ms);
  const t = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${t}`;
}
const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

export function SpeechDrop(props: {
  open: boolean;
  /** the doc "Upload" sends: the one you came from */
  docName: string;
  exportDoc: () => Promise<Uint8Array>;
  onOpenDocx: (path: string) => void;
  /** the tab's name and its count of files you haven't seen */
  onTab: (t: SdTab) => void;
  flash: (msg: string, action?: { label: string; run: () => void }) => void;
  confirm: (a: Omit<Ask, 'done'>) => Promise<boolean>;
}) {
  const api = bridge.speechdrop;
  const [room, setRoom] = useState<Room | null>(null);
  const [files, setFiles] = useState<SdFile[]>([]);
  const [live, setLive] = useState(false);
  const [owned, setOwned] = useState<Record<string, number>>({});
  // files that came after you joined and you haven't opened (by slot)
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null); // "Uploading 1AC.docx…"
  const [drag, setDrag] = useState(false);
  const [at, setAt] = useState(0);
  const known = useRef<Set<number> | null>(null);
  const uploading = useRef(new Set<string>());
  const openRef = useRef(props.open);
  openRef.current = props.open;
  const { onTab, flash } = props;

  useEffect(() => { onTab({ room, fresh: fresh.size }); }, [room, fresh, onTab]);

  /** A new list: anything not seen before is fresh, unless this Falcon is the one uploading it. */
  const take = useCallback((list: SdFile[], announce: boolean) => {
    setFiles(list);
    const seen = known.current;
    known.current = new Set(list.map((f) => f.index));
    if (!seen) return;
    const added = list.filter((f) => !seen.has(f.index) && !uploading.current.has(f.name));
    if (!added.length) return;
    setFresh((s) => { const n = new Set([...s].filter((i) => known.current!.has(i))); added.forEach((f) => n.add(f.index)); return n; });
    if (announce && !openRef.current) flash(added.length === 1 ? `New in SpeechDrop: ${added[0].name}` : `${added.length} new files in SpeechDrop`, { label: 'Show', run: () => window.dispatchEvent(new Event(SHOW_EVENT)) });
  }, [flash]);

  // the live list, for as long as the tab is open on this room
  useEffect(() => {
    if (!api || !room) return;
    return api.watch(room.code, null, (u) => { setLive(u.live); take(u.files, true); });
  }, [api, room, take]);

  const join = useCallback(async (code: string): Promise<boolean> => {
    if (!api) return false;
    const r = await api.room(code);
    if (!r.ok) { flash(say(r.error)); return false; }
    known.current = null;
    take(r.value.files, false);
    setFresh(new Set());
    setOwned(mine(code));
    setAt(0);
    setLive(false);
    const got = { code, name: r.value.name };
    setRoom(got);
    safeSet(ROOMS_KEY, JSON.stringify([{ ...got, when: Date.now() }, ...recentRooms().filter((x) => x.code !== code)].slice(0, 6)));
    return true;
  }, [api, take, flash]);

  const leave = () => { setRoom(null); setFiles([]); setFresh(new Set()); known.current = null; };

  const send = useCallback(async (name: string, data: Uint8Array) => {
    if (!api || !room) return;
    uploading.current.add(name);
    setBusy(`Uploading ${name}…`);
    let r: SdResult<{ files: SdFile[]; index: number | null }>;
    try { r = await api.upload(room.code, name, data); }
    finally { setBusy(null); }
    if (!r.ok) { uploading.current.delete(name); flash(`Couldn't upload ${name}: ${say(r.error)}`); return; }
    if (r.value.index !== null) { setMine(room.code, r.value.index, true); setOwned(mine(room.code)); }
    take(r.value.files, false);
    uploading.current.delete(name);
    flash(`Uploaded ${name} to ${room.name}`);
  }, [api, room, take, flash]);

  const uploadDoc = async () => {
    let data: Uint8Array;
    try { data = await props.exportDoc(); } catch (e) { flash(`Couldn't make the .docx: ${(e as Error).message}`); return; }
    await send(`${props.docName || 'Untitled'}.docx`, data);
  };
  const uploadPicked = async () => {
    if (!api) return;
    const r = await api.pick();
    if (!r.ok) { flash(say(r.error)); return; }
    for (const f of r.value) {
      if (!f.data) { flash(`${f.name} is over SpeechDrop's 10 MB limit`); continue; }
      await send(f.name, f.data);
    }
  };
  const uploadDropped = async (list: FileList) => {
    for (const f of Array.from(list)) {
      if (f.size > 10 * 1024 * 1024) { flash(`${f.name} is over SpeechDrop's 10 MB limit`); continue; }
      await send(f.name, new Uint8Array(await f.arrayBuffer()));
    }
  };

  const seen = (f: SdFile) => setFresh((s) => { if (!s.has(f.index)) return s; const n = new Set(s); n.delete(f.index); return n; });
  const open = async (f: SdFile) => {
    if (!api || !room) return;
    seen(f);
    const r = await api.open(room.code, f.index, f.name);
    if (!r.ok) { flash(say(r.error)); return; }
    if (r.value.docx) props.onOpenDocx(r.value.path);
  };
  const download = async (f: SdFile) => {
    if (!api || !room) return;
    seen(f);
    const r = await api.download(room.code, f.index, f.name);
    flash(r.ok ? `Downloaded ${f.name} to Downloads › SpeechDrop` : say(r.error));
  };
  const remove = async (f: SdFile) => {
    if (!api || !room) return;
    if (!(await props.confirm({ title: `Delete ${f.name}?`, body: `It leaves ${room.name} for everyone in the room.`, ok: 'Delete' }))) return;
    const r = await api.remove(room.code, f.index);
    if (!r.ok) { flash(say(r.error)); return; }
    setMine(room.code, f.index, false);
    setOwned(mine(room.code));
    take(r.value, false);
  };
  const downloadAll = async () => {
    if (!api || !room) return;
    setBusy('Downloading every file…');
    const r = await api.archive(room.code, room.name);
    setBusy(null);
    if (!r.ok) { flash(say(r.error)); return; }
    setFresh(new Set());
    flash(`Saved ${r.value.count} ${r.value.count === 1 ? 'file' : 'files'} to Downloads › SpeechDrop${r.value.skipped ? ` (${r.value.skipped} couldn't download)` : ''}`);
  };
  const copyCode = () => { if (room) void navigator.clipboard?.writeText(room.code).then(() => flash(`Copied ${room.code}`), () => {}); };

  // the arrow keys walk the list, Enter opens; Delete removes your own upload
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent) => {
    if (!room || !files.length || (e.target as HTMLElement).tagName === 'INPUT') return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      const i = Math.min(files.length - 1, Math.max(0, at + step));
      setAt(i);
      rows.current[i]?.focus();
    } else if (e.key === 'Enter' && files[at] && (e.target as HTMLElement).classList.contains('sd-f')) { e.preventDefault(); void open(files[at]); }
  };
  // a file dragged over the room shows where it goes; the drop uploads it
  const dragHandlers = room ? {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void uploadDropped(e.dataTransfer.files); },
  } : {};

  return (
    <section className={`sd${props.open ? ' open' : ''}`} aria-label="SpeechDrop" aria-hidden={!props.open} inert={!props.open} onKeyDown={onKey} {...dragHandlers}>
      <div className="sd-in">
        {!api ? (
          <header className="sd-head">
            <p className="sd-lab">SpeechDrop</p>
            <h1 className="sd-hi">SpeechDrop needs the desktop app</h1>
            <p className="sd-sub">The web version can't reach speechdrop.net. Open this in the Falcon app.</p>
          </header>
        ) : room ? (
          <>
            <header className="sd-head">
              <p className="sd-lab">SpeechDrop · {live ? 'live' : 'refreshing every 5 s'}</p>
              <h1 className="sd-hi">{room.name}</h1>
              <p className="sd-sub">
                <button className="sd-code" title="Copy the room code" onClick={copyCode}>{room.code}<SvgIcon name="copy" /></button>
                <span>{files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'}` : 'No files yet'}</span>
              </p>
              <div className="sd-acts">
                <button className="hm-act sd-up" onClick={() => void uploadDoc()} disabled={!!busy} title={`Upload ${props.docName || 'Untitled'} as it is now, saved or not`}>
                  <SvgIcon name="upload" /><span>Upload {props.docName || 'Untitled'}</span>
                </button>
                <button className="hm-act" onClick={() => void uploadPicked()} disabled={!!busy}><SvgIcon name="open" /><span>Upload file…</span></button>
                {files.length > 0 && <button className="hm-act" onClick={() => void downloadAll()} disabled={!!busy}><SvgIcon name="download" /><span>Download all</span></button>}
                <button className="hm-act sd-leave" onClick={leave}><span>Leave room</span></button>
              </div>
            </header>
            <p className="sd-busy" role="status">{busy ?? (files.length ? '' : 'Waiting for uploads… Drop files here or use Upload')}</p>
            <div className="sd-list" role="list" aria-label="Files in the room">
              {files.map((f, i) => {
                const own = owned[f.index] !== undefined;
                return (
                  <div key={f.index} className="sd-row" role="listitem" data-on={i === at || undefined} data-fresh={fresh.has(f.index) || undefined}>
                    <button ref={(el) => { rows.current[i] = el; }} className="sd-f" onFocus={() => setAt(i)} onPointerEnter={() => setAt(i)} onClick={() => void open(f)}
                      title={extOf(f.name) === 'docx' ? 'Open in Falcon' : 'Open in its app'}>
                      <span className="ic"><SvgIcon name="doc" /></span>
                      <span className="nm">{f.name}</span>
                      <span className="wh">{fresh.has(f.index) && <i className="sd-new" aria-label="new" />}{when(f.ctime)}</span>
                    </button>
                    <button className="sd-x" title={`Download ${f.name} to Downloads › SpeechDrop`} aria-label={`Download ${f.name}`} onClick={() => void download(f)}><SvgIcon name="download" /></button>
                    {own ? <button className="sd-x" title={`Delete ${f.name}: you uploaded it`} aria-label={`Delete ${f.name}`} onClick={() => void remove(f)}><SvgIcon name="trash" /></button>
                      : <span className="sd-x" aria-hidden="true" />/* the same slot, so every row's time lines up */}
                  </div>
                );
              })}
            </div>
            {files.length > 1 && <p className="hm-keys"><kbd>↑</kbd><kbd>↓</kbd> choose <kbd>↵</kbd> open</p>}
            <div className={`sd-drop${drag ? ' on' : ''}`} aria-hidden="true"><SvgIcon name="upload" /><b>Drop to upload to {room.name}</b></div>
          </>
        ) : <Lobby join={join} make={async (name) => {
          const r = await api.make(name);
          if (!r.ok) { flash(say(r.error)); return false; }
          return join(r.value);
        }} />}
      </div>
    </section>
  );
}

/** Opens the SpeechDrop tab (the toast's Show button). */
export const SHOW_EVENT = 'falcon:sd-show';

/** Join by code (typing the 6th character joins, as on SpeechDrop's site), a room joined before, or make a new one. */
function Lobby(props: { join: (code: string) => Promise<boolean>; make: (name: string) => Promise<boolean> }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [bad, setBad] = useState(false);
  const [recent] = useState(recentRooms);
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { codeRef.current?.focus(); }, []);
  const tryJoin = async (c: string) => {
    setChecking(true);
    const ok = await props.join(c);
    setChecking(false);
    setBad(!ok);
  };
  const onCode = (v: string) => {
    const c = v.replace(/[^A-Za-z0-9]/g, '').slice(0, CODE_LEN);
    setCode(c);
    setBad(false);
    if (c.length === CODE_LEN) void tryJoin(c);
  };
  const left = CODE_LEN - code.length;
  return (
    <>
      <header className="sd-head">
        <p className="sd-lab">SpeechDrop</p>
        <h1 className="sd-hi">Join a room</h1>
        <p className="sd-sub">Type the room code the judge or the other team gave you.</p>
      </header>
      <div className="sd-form">
        <input ref={codeRef} className="sd-in-code" aria-label="Room code" placeholder="Room code" value={code} maxLength={CODE_LEN} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          data-bad={bad || undefined} onChange={(e) => onCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && code) void tryJoin(code); }} />
        <p className="sd-hint">{checking ? 'Checking…' : bad ? 'No room has that code' : `${left} ${left === 1 ? 'character' : 'characters'} left`}</p>
      </div>
      {recent.length > 0 && (
        <div className="sd-recent">
          <div className="hm-lab"><span>Joined before</span></div>
          {recent.map((r) => (
            <button key={r.code} className="sd-f sd-rr" onClick={() => void tryJoin(r.code)}>
              <span className="ic"><SvgIcon name="doc" /></span><span className="nm">{r.name}</span><span className="wh">{r.code}</span>
            </button>
          ))}
        </div>
      )}
      <form className="sd-form sd-make" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void props.make(name.trim()); }}>
        <div className="hm-lab"><span>Or make a room</span></div>
        <div className="sd-mk">
          <input aria-label="New room name" placeholder="Room name, like Round 3 Flight A" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="hm-act" type="submit" disabled={!name.trim()}><SvgIcon name="plus" /><span>Make room</span></button>
        </div>
      </form>
    </>
  );
}
