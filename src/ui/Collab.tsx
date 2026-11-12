import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as collab from '../collab/service';
import { keyOf, shortCode } from '../collab/code';
import { nextUtcMidnight } from '../collab/relay';
import type { Contact, Received } from '../collab/service';
import type { Ask } from './Confirm';
import { SvgIcon } from './icons';
import './collab.css';

/**
 * Card sharing: send a card to someone by their pairing code, and take in cards sent to yours.
 * The panel holds your code (Copy, your name, a new code), contacts, and cards waiting; Send Card to…
 * is a short list of contacts. Both are Falcon dialogs: Esc or a click outside closes them.
 * A card or contact that goes folds shut in place: it stays while its save runs, and stays for good if the save fails.
 */

export const useCollab = () => useSyncExternalStore(collab.subscribe, collab.current);

/** A time like 4:05 PM today, else Mon 4:05 PM. */
function when(ms: number, now = new Date()) {
  const d = new Date(ms), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`;
}

/** What the relay link is doing, in a line. */
export function linkLine(s: collab.CollabState): string {
  if (s.status === 'unavailable') return "Card sharing needs the Falcon app or a secure page (https), and this one can't keep keys";
  if (!s.relay) return 'No relay is set, so nobody can send you cards yet, and yours go only to contacts whose code carries their relay. Add one in Settings > Sharing';
  if (s.pausedUntil > Date.now()) return `Paused until ${collab.resetTime(s.pausedUntil)}, when the relay's daily limit resets`;
  const l = s.link;
  if (l.kind === 'live') return 'Connected. Cards sent to your code arrive here';
  if (l.kind === 'retry') { const m = Math.max(1, Math.round((l.at - Date.now()) / 60_000)); // the relay's own daily request limit answers in a way a page can't tell from no connection
    return `Can't reach the relay: no connection, or it's over its daily limit until ${collab.resetTime(nextUtcMidnight())}. Trying again in ${l.at - Date.now() < 60_000 ? 'under a minute' : `${m} min`}`; }
  if (l.kind === 'connecting') return 'Connecting to the relay…';
  return 'Cards sent to your code arrive in another Falcon window';
}

/** Under your code: what it carries, and when it changed with your relay. */
export function codeNote(s: collab.CollabState): { text: string; changed?: boolean } {
  if (!s.relay) return { text: "Nobody can send you cards until you set a relay in Settings > Sharing. Your code then carries it. You can still send to contacts whose code carries theirs." };
  if (s.gave && s.gave !== s.code && keyOf(s.gave) === keyOf(s.code)) return { changed: true, text: 'Your relay changed, so your code did too. People who send you cards need this new one.' };
  return { text: 'Give it to whoever will send you cards. It carries your relay, so they reach you from theirs. Anyone with it can send you one, and only this Falcon can read them.' };
}

const FOLD = 320; // collab.css: .co-fold
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A list whose rows fold shut before they go: a row that left `list` keeps its place, marked gone, for the fold's
 *  length. However it left: dismissed here, or in another window. `on` false (the panel is closed) just mirrors the list. */
function useLeaving<T>(list: T[], key: (t: T) => string, on: boolean): { item: T; gone: boolean }[] {
  const prev = useRef<{ item: T; goneAt: number }[]>([]);
  const [, again] = useState(0);
  const live = new Map(list.map((t) => [key(t), t]));
  const now = Date.now(), ms = still() ? 200 : FOLD;
  const rows = !on ? [] : prev.current.flatMap((r) => {
    const t = live.get(key(r.item));
    if (t) { live.delete(key(r.item)); return [{ item: t, goneAt: 0 }]; }
    return r.goneAt && now - r.goneAt >= ms ? [] : [{ item: r.item, goneAt: r.goneAt || now }];
  });
  for (const t of live.values()) rows.push({ item: t, goneAt: 0 });
  prev.current = rows;
  const next = Math.min(...rows.filter((r) => r.goneAt).map((r) => r.goneAt + ms));
  useEffect(() => {
    if (next === Infinity) return;
    const t = setTimeout(() => again((n) => n + 1), Math.max(0, next - Date.now()) + 10);
    return () => clearTimeout(t);
  }, [next]);
  return rows.map((r) => ({ item: r.item, gone: r.goneAt > 0 }));
}

/** Where focus goes when a row leaves: the next row's first button, else the one before, else the heading.
 *  Not when the person has already moved on to something else. */
function focusAfter(row: Element | null, btn: Element) {
  const at = document.activeElement;
  if (!row || (at && at !== document.body && at !== btn && !row.contains(at))) return;
  const ok = (e: Element | null) => !!e && e.classList.contains('co-fold') && !e.hasAttribute('data-gone');
  let to: Element | null = row.nextElementSibling;
  while (to && !ok(to)) to = to.nextElementSibling;
  if (!to) { to = row.previousElementSibling; while (to && !ok(to)) to = to.previousElementSibling; }
  (to?.querySelector<HTMLElement>('button:not(:disabled)') ?? row.closest('section')?.querySelector<HTMLElement>('h3'))?.focus({ preventScroll: true });
}

/** Esc closes, wherever focus is. */
function useEsc(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // a Confirm over the panel (New code…) answers its own Esc
      if (e.key !== 'Escape' || document.querySelector('.cf[role="alertdialog"]')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [open, close]);
}

export function CollabPanel(props: {
  open: boolean;
  onClose: () => void;
  flash: (m: string) => void;
  confirm: (a: Omit<Ask, 'done'>) => Promise<boolean>;
  /** put the card in the open document; null when it went in, else why not */
  onInsert: (c: Received) => string | null;
  onCopy: (c: Received) => Promise<boolean>;
}) {
  const s = useCollab();
  const { open, onClose, flash } = props;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [bad, setBad] = useState<string | null>(null);
  const codeBox = useRef<HTMLInputElement>(null), nameBox = useRef<HTMLInputElement>(null), first = useRef<HTMLButtonElement>(null);
  const [, tick] = useState(0);
  /** a row whose save is running ('wait', then 'slow' past 150 ms: only then a spinner), or failed */
  const [rows, setRows] = useState<Record<string, 'wait' | 'slow' | 'failed'>>({});
  const cards = useLeaving(s.cards, (c) => c.id, open), contacts = useLeaving(s.contacts, (c) => c.code, open);
  useEsc(open, onClose);
  useLayoutEffect(() => {
    if (!open) return;
    setBad(null);
    setRows({});
    (first.current ?? codeBox.current)?.focus();
  }, [open]);
  // the retry countdown in the status line
  useEffect(() => { if (!open) return; const t = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(t); }, [open]);
  if (!open) return null;

  const add = async () => {
    const why = await collab.addContact(code, name);
    setBad(why);
    if (!why) { flash(`Added ${name.trim()}`); setCode(''); setName(''); codeBox.current?.focus(); }
  };
  const fromUnknown = (c: Received) => { setCode(c.from); setName(c.claimed); setBad(null); nameBox.current?.focus(); };
  const copyCode = () => void navigator.clipboard?.writeText(s.code).then(() => { flash('Copied your pairing code'); void collab.gaveCode().catch(() => {}); }, () => flash("Couldn't copy. Select the code and copy it"));
  const renew = async () => {
    if (!(await props.confirm({ title: 'Make a new pairing code?', body: 'Your old code stops working: cards sent to it never arrive. Give the new one to everyone who sends you cards.', ok: 'New code' }))) return;
    await collab.newCode();
    flash('You have a new pairing code');
  };
  const ready = s.status === 'ready';
  /** Run a row's save. True when it went through; the row then folds shut as it leaves the list. */
  const run = async (id: string, save: () => Promise<unknown>) => {
    setRows((r) => ({ ...r, [id]: 'wait' }));
    const slow = setTimeout(() => setRows((r) => (r[id] === 'wait' ? { ...r, [id]: 'slow' } : r)), 150);
    try { await save(); setRows(({ [id]: _, ...r }) => r); return true; }
    catch { setRows((r) => ({ ...r, [id]: 'failed' })); return false; }
    finally { clearTimeout(slow); }
  };
  const leave = async (e: React.MouseEvent<HTMLButtonElement>, id: string, save: () => Promise<unknown>, said: string) => {
    const btn = e.currentTarget, row = btn.closest('.co-fold');
    if (!(await run(id, save))) return;
    flash(said);
    focusAfter(row, btn);
  };
  const dismissAll = async () => {
    const all = s.cards;
    if (!(await props.confirm({ title: `Dismiss all ${all.length} cards?`, body: 'They leave this Falcon for good. To get one back, ask whoever sent it to send it again.', ok: 'Dismiss all' }))) return;
    let done = 0;
    for (const c of all) { // one after another, so they fold shut in turn
      if (await run(c.id, () => collab.drop(c.id))) done++;
      if (!still()) await new Promise((r) => setTimeout(r, 90));
    }
    flash(done === all.length ? `Dismissed ${done} cards` : `Dismissed ${done} of ${all.length} cards`);
    document.querySelector<HTMLElement>('#co-t')?.focus({ preventScroll: true });
  };
  const state = (id: string, gone: boolean) => ({ off: gone || rows[id] === 'wait' || rows[id] === 'slow', slow: rows[id] === 'slow' || undefined, failed: rows[id] === 'failed' });

  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf co" role="dialog" aria-modal="true" aria-labelledby="co-t">
        <h2 id="co-t" tabIndex={-1}>Card sharing</h2>
        <p className="co-line" role="status">{linkLine(s)}</p>

        {cards.length > 0 && (
          <div className="co-fold" data-gone={cards.every((r) => r.gone) || undefined}><div>
            <section className="co-sec" aria-label="Cards waiting">
              <div className="co-h">
                <h3 tabIndex={-1}>Cards waiting</h3>
                {s.cards.length > 1 && <button className="co-plain" onClick={() => void dismissAll()}>Dismiss all</button>}
              </div>
              {cards.map(({ item: c, gone }, i) => {
                const who = collab.contactFor(c.from), st = state(c.id, gone);
                return (
                  <div key={c.id} className="co-fold" data-gone={gone || undefined} aria-hidden={gone || undefined}><div>
                    <div className="co-card">
                      <div className="co-what">
                        <b>{c.label}</b>
                        {st.failed
                          ? <span className="co-err" role="alert">Couldn't save that, so this card is still here. Try again</span>
                          : <span>{c.unreadable ? 'It may need a newer Falcon. Ask them to send it another way. ' : ''}{who ? `From ${who.name}` : `From a code not in your contacts${c.claimed ? `, who says they're ${c.claimed}` : ''}`} · {when(c.gotAt)}</span>}
                      </div>
                      <div className="co-acts">
                        {!c.unreadable && <button ref={i === 0 ? first : undefined} className="co-main" disabled={st.off} onClick={() => { const why = props.onInsert(c); if (why) flash(why); else { void collab.drop(c.id).catch(() => {}); onClose(); } }}>Insert</button>}
                        {!c.unreadable && <button disabled={st.off} onClick={() => void props.onCopy(c).then((ok) => flash(ok ? `Copied “${c.label}”` : "Couldn't copy it"))}>Copy</button>}
                        {!who && <button disabled={st.off} onClick={() => fromUnknown(c)}>Add contact</button>}
                        <button disabled={st.off} data-slow={st.slow} onClick={(e) => void leave(e, c.id, () => collab.drop(c.id), 'Dismissed')}><span className="co-spin" />Dismiss</button>
                      </div>
                    </div>
                  </div></div>
                );
              })}
            </section>
          </div></div>
        )}

        <section className="co-sec" aria-label="Your code">
          <h3>Your pairing code</h3>
          {(() => { const n = codeNote(s); return <p className="co-sub" data-changed={n.changed || undefined} role={n.changed ? 'status' : undefined}>{n.text}</p>; })()}
          <div className="co-me">
            <code className="co-code" aria-label="Your pairing code">{ready ? s.code : '…'}</code>
            <button onClick={copyCode} disabled={!ready}><SvgIcon name="copy" />Copy</button>
          </div>
          <div className="co-row">
            <label htmlFor="co-name">Your name</label>
            <input id="co-name" className="co-in" spellCheck={false} maxLength={60} placeholder="Shown to people you send cards to" value={s.name} disabled={!ready}
              onChange={(e) => void collab.setName(e.target.value)} />
          </div>
          <button className="co-plain" onClick={() => void renew()} disabled={!ready}>New code…</button>
        </section>

        <section className="co-sec" aria-label="Contacts">
          <h3 tabIndex={-1}>Contacts</h3>
          {contacts.length === 0 && <p className="co-sub">No one yet. Paste a partner's pairing code below.</p>}
          {contacts.map(({ item: c, gone }) => {
            const st = state(c.code, gone);
            return (
              <div key={c.code} className="co-fold" data-gone={gone || undefined} aria-hidden={gone || undefined}><div>
                <div className="co-ct">
                  <span className="nm">{c.name}</span>
                  {st.failed ? <span className="co-err" role="alert">Couldn't save that. Try again</span> : <span className="cd">{shortCode(c.code)}</span>}
                  <button className="co-x" aria-label={`Remove ${c.name}`} title={`Remove ${c.name}`} disabled={st.off} data-slow={st.slow}
                    onClick={(e) => void leave(e, c.code, () => collab.removeContact(c.code), `Removed ${c.name}`)}><span className="co-spin" /><SvgIcon name="x" /></button>
                </div>
              </div></div>
            );
          })}
          <form className="co-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input ref={codeBox} className="co-in co-mono" aria-label="Their pairing code" placeholder="Their pairing code" spellCheck={false} autoCapitalize="characters" autoCorrect="off"
              value={code} data-bad={bad ? true : undefined} onChange={(e) => { setCode(e.target.value); setBad(null); }} disabled={!ready} />
            <input ref={nameBox} className="co-in" aria-label="Their name" placeholder="Name" spellCheck={false} maxLength={60} value={name}
              onChange={(e) => { setName(e.target.value); setBad(null); }} disabled={!ready} />
            <button type="submit" className="co-main" disabled={!ready || !code.trim()}><SvgIcon name="plus" />Add</button>
          </form>
          <p className="co-hint" role={bad ? 'alert' : undefined}>{bad ?? ''}</p>
        </section>

        <div className="cf-btns"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

/** Send Card to…: pick a contact (arrows and Enter, or a click). */
export function SendCard(props: { label: string | null; onClose: () => void; onSend: (c: Contact) => void; onManage: () => void }) {
  const s = useCollab();
  const open = props.label !== null;
  const [at, setAt] = useState(0);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  useEsc(open, props.onClose);
  useLayoutEffect(() => { if (open) { setAt(0); requestAnimationFrame(() => (rows.current[0] ?? document.querySelector<HTMLElement>('.co-send button'))?.focus()); } }, [open]);
  if (!open) return null;
  const list = s.contacts;
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step || !list.length) return;
    e.preventDefault();
    const i = (at + step + list.length) % list.length;
    setAt(i);
    rows.current[i]?.focus();
  };
  const note = s.status === 'unavailable' || !s.relay || s.pausedUntil > Date.now() ? linkLine(s) : '';
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="cf co co-send" role="dialog" aria-modal="true" aria-labelledby="co-st" onKeyDown={onKey}>
        <h2 id="co-st">Send “{props.label}” to…</h2>
        {note && <p className="co-line">{note}</p>}
        {list.length ? (
          <div className="co-pick" role="list" aria-label="Contacts">
            {list.map((c, i) => (
              <button key={c.code} ref={(el) => { rows.current[i] = el; }} role="listitem" className="co-ct co-pk" data-on={i === at || undefined}
                onFocus={() => setAt(i)} onPointerEnter={() => setAt(i)} onClick={() => props.onSend(c)}>
                <span className="nm">{c.name}</span><span className="cd">{shortCode(c.code)}</span>
              </button>
            ))}
          </div>
        ) : <p className="co-sub">No contacts yet. Add a partner's pairing code first.</p>}
        <div className="cf-btns">
          <button onClick={props.onManage}>{list.length ? 'Contacts…' : 'Add a contact…'}</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
