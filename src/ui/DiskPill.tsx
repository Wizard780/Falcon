import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { bridge } from '../editor/host';

/**
 * The pill at the bottom right, like CardMirror's: where the open file lives (Dropbox, iCloud Drive...), and when
 * another program or device rewrites it while it's open, "Changed on disk" with a choice of whose changes to keep.
 */

/** What Falcon last knew about a tab's file on disk. `copyOf` is set on a conflicted copy made by Keep both. */
export type Disk = { path: string; mtime: number; size: number; changedAt?: number; copyOf?: string };

/** The cloud service a path syncs through, from where it sits, or null for a plain folder. */
export function cloudOf(p: string): string | null {
  const s = p.replace(/\\/g, '/');
  if (/\/Mobile Documents\/com~apple~CloudDocs\/|\/iCloud Drive\//i.test(s)) return 'iCloud Drive';
  if (/\/(CloudStorage\/)?Dropbox[^/]*\//i.test(s)) return 'Dropbox';
  if (/\/(CloudStorage\/)?OneDrive[^/]*\//i.test(s)) return 'OneDrive';
  if (/\/(CloudStorage\/)?Google ?Drive[^/]*\/|\/My Drive\//i.test(s)) return 'Google Drive';
  return null;
}

/** "just now", "3m ago", "2h ago", "4d ago". */
export function ago(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const base = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.docx$/i, '');

/** Keeps track of each tab's file on disk and notices when it changes. `busy` is up while Falcon writes it itself. */
export function useDisk(id: number, path: string | undefined) {
  const [disk, setDisk] = useState<Record<number, Disk>>({});
  const ref = useRef(disk);
  ref.current = disk;
  const busy = useRef(0);
  /** Where the file stands now becomes what's normal for it (after opening, saving or reloading). */
  const settle = useCallback(async (tab: number, p: string, copyOf?: string) => {
    const s = await bridge.fileStat?.(p);
    if (!s) return;
    setDisk((d) => ({ ...d, [tab]: { path: p, ...s, copyOf: copyOf ?? (d[tab]?.path === p ? d[tab].copyOf : undefined) } }));
  }, []);
  useEffect(() => { if (path && ref.current[id]?.path !== path) void settle(id, path); }, [id, path, settle]);
  useEffect(() => {
    if (!path || !bridge.fileStat) return;
    let live = true;
    const check = async () => {
      const b = ref.current[id];
      if (!b || b.path !== path || b.changedAt || busy.current) return;
      const s = await bridge.fileStat!(path);
      // a save of our own may have landed while we asked
      if (!live || busy.current || !s || ref.current[id] !== b) return;
      if (s.mtime !== b.mtime || s.size !== b.size) setDisk((d) => ({ ...d, [id]: { ...b, changedAt: Date.now() } }));
    };
    const t = setInterval(check, 4000);
    addEventListener('focus', check);
    return () => { live = false; clearInterval(t); removeEventListener('focus', check); };
  }, [id, path]);
  return { disk: path && disk[id]?.path === path ? disk[id] : undefined, settle, busy };
}

type Choice = { label: string; note: string; run: () => void };

/** The pill itself, and the choice it opens. `ask` opens the choice from outside (Save on a changed file). */
export function DiskPill(props: {
  disk: Disk | undefined; name: string; dirty: boolean; ask: number;
  onTheirs: () => void; onMine: () => void; onBoth: () => void; onOriginal: (path: string) => void;
}) {
  const { disk } = props;
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  // "Changed on disk 3m ago" keeps its time current
  useEffect(() => { if (!disk?.changedAt) return; const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, [disk?.changedAt]);
  useEffect(() => { if (props.ask && disk?.changedAt) setOpen(true); }, [props.ask]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!disk) return null;
  const cloud = cloudOf(disk.path);
  const state = disk.changedAt ? 'changed' : disk.copyOf ? 'copy' : cloud ? 'synced' : null;
  if (!state) return null;
  const label = state === 'changed' ? `Changed on disk ${ago(disk.changedAt!)}` : state === 'copy' ? 'Conflicted copy' : cloud!;
  const title = state === 'changed' ? `"${props.name}" changed on disk ${ago(disk.changedAt!)}. Another device or program wrote it. Click to decide.`
    : state === 'copy' ? `You're editing a conflicted copy of "${base(disk.copyOf!)}". Click for the original.`
    : `In ${cloud}, as of its last sync. Click to show the file.`;
  const click = () => { if (state === 'synced') void bridge.revealFile?.(disk.path); else setOpen(true); };
  const choices: Choice[] = state === 'changed' ? [
    { label: 'Keep their changes', note: `Load the file as it is on disk now. ${props.dirty ? 'Your unsaved changes go (Undo brings them back).' : 'You have no unsaved changes.'}`, run: props.onTheirs },
    { label: 'Keep my changes', note: 'Save your version over theirs.', run: props.onMine },
    { label: 'Keep both', note: 'Save your version as a conflicted copy in the same folder, and keep editing that.', run: props.onBoth },
  ] : [
    { label: 'Open the original', note: 'In a tab of its own, beside this copy.', run: () => props.onOriginal(disk.copyOf!) },
    { label: 'Show in folder', note: 'Both files, in Finder or Explorer.', run: () => void bridge.revealFile?.(disk.path) },
  ];
  const message = state === 'changed'
    ? `"${props.name}" was changed by another device or program while you had it open${cloud ? ` (it's in ${cloud})` : ''}.`
    : state === 'copy' ? `You're editing a conflicted copy of "${base(disk.copyOf!)}".` : '';
  return <>
    <button className="disk" data-state={state} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={click}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18.5h11a4 4 0 0 0 .6-7.95A6.5 6.5 0 0 0 6.2 9.3 4.6 4.6 0 0 0 7 18.5z" /></svg>
      {label}
    </button>
    {open && createPortal(<Choose message={message} choices={choices} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

/** A question with a few answers, each with a line under it; Esc or a click outside closes it. */
function Choose({ message, choices, onClose }: { message: string; choices: Choice[]; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf dk" role="dialog" aria-modal="true" aria-labelledby="dk-t" data-own-esc>
        <h2 id="dk-t">{message}</h2>
        <div className="dk-list">
          {choices.map((c, i) => (
            <button key={c.label} ref={i ? undefined : first} onClick={() => { onClose(); c.run(); }}>
              <b>{c.label}</b><span>{c.note}</span>
            </button>
          ))}
        </div>
        <div className="cf-btns"><button onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
