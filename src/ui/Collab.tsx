import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as collab from '../collab/service';
import { shortCode } from '../collab/code';
import type { Contact, Received } from '../collab/service';
import type { Ask } from './Confirm';
import { SvgIcon } from './icons';
import './collab.css';

/**
 * Card sharing: send a card to someone by their pairing code, and take in cards sent to yours.
 * The panel holds your code (Copy, your name, a new code), contacts, and cards waiting; Send Card to…
 * is a short list of contacts. Both are Falcon dialogs: Esc or a click outside closes them.
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
  if (!s.relay) return "No relay is set, so cards can't be sent or received yet. Add one in Settings > General > Card sharing";
  if (s.pausedUntil > Date.now()) return `Paused until ${collab.resetTime(s.pausedUntil)}, when the relay's daily limit resets`;
  const l = s.link;
  if (l.kind === 'live') return 'Connected. Cards sent to your code arrive here';
  if (l.kind === 'retry') { const m = Math.max(1, Math.round((l.at - Date.now()) / 60_000)); return `Can't reach the relay. Trying again in ${l.at - Date.now() < 60_000 ? 'under a minute' : `${m} min`}`; }
  if (l.kind === 'connecting') return 'Connecting to the relay…';
  return 'Cards sent to your code arrive in another Falcon window';
}

/** Esc closes, wherever focus is. */
function useEsc(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
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
  const [myName, setMyName] = useState(s.name);
  const codeBox = useRef<HTMLInputElement>(null), nameBox = useRef<HTMLInputElement>(null), first = useRef<HTMLButtonElement>(null);
  const [, tick] = useState(0);
  useEsc(open, onClose);
  useLayoutEffect(() => {
    if (!open) return;
    setBad(null); setMyName(collab.current().name);
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
  const copyCode = () => void navigator.clipboard?.writeText(s.code).then(() => flash('Copied your pairing code'), () => flash("Couldn't copy. Select the code and copy it"));
  const renew = async () => {
    if (!(await props.confirm({ title: 'Make a new pairing code?', body: 'Your old code stops working: cards sent to it never arrive. Give the new one to everyone who sends you cards.', ok: 'New code' }))) return;
    await collab.newCode();
    flash('You have a new pairing code');
  };
  const ready = s.status === 'ready';

  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf co" role="dialog" aria-modal="true" aria-labelledby="co-t">
        <h2 id="co-t">Card sharing</h2>
        <p className="co-line" role="status">{linkLine(s)}</p>

        {s.cards.length > 0 && (
          <section className="co-sec" aria-label="Cards waiting">
            <h3>Cards waiting</h3>
            {s.cards.map((c, i) => {
              const who = collab.contactFor(c.from);
              return (
                <div key={c.id} className="co-card">
                  <div className="co-what">
                    <b>{c.label}</b>
                    <span>{who ? `From ${who.name}` : `From a code not in your contacts${c.claimed ? `, who says they're ${c.claimed}` : ''}`} · {when(c.gotAt)}</span>
                  </div>
                  <div className="co-acts">
                    <button ref={i === 0 ? first : undefined} className="co-main" onClick={() => { const why = props.onInsert(c); if (why) flash(why); else { void collab.drop(c.id); onClose(); } }}>Insert</button>
                    <button onClick={() => void props.onCopy(c).then((ok) => flash(ok ? `Copied “${c.label}”` : "Couldn't copy it"))}>Copy</button>
                    {!who && <button onClick={() => fromUnknown(c)}>Add contact</button>}
                    <button onClick={() => void collab.drop(c.id)}>Dismiss</button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        <section className="co-sec" aria-label="Your code">
          <h3>Your pairing code</h3>
          <p className="co-sub">Give it to whoever will send you cards. Anyone with it can send you one, and only this Falcon can read them.</p>
          <div className="co-me">
            <code className="co-code" aria-label="Your pairing code">{ready ? s.code : '…'}</code>
            <button onClick={copyCode} disabled={!ready}><SvgIcon name="copy" />Copy</button>
          </div>
          <div className="co-row">
            <label htmlFor="co-name">Your name</label>
            <input id="co-name" className="co-in" spellCheck={false} maxLength={60} placeholder="Shown to people you send cards to" value={myName} disabled={!ready}
              onChange={(e) => setMyName(e.target.value)} onBlur={() => { if (myName !== s.name) void collab.setName(myName.trim()); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          </div>
          <button className="co-plain" onClick={() => void renew()} disabled={!ready}>New code…</button>
        </section>

        <section className="co-sec" aria-label="Contacts">
          <h3>Contacts</h3>
          {s.contacts.length === 0 && <p className="co-sub">No one yet. Paste a partner's pairing code below.</p>}
          {s.contacts.map((c) => (
            <div key={c.code} className="co-ct">
              <span className="nm">{c.name}</span>
              <span className="cd">{shortCode(c.code)}</span>
              <button className="co-x" aria-label={`Remove ${c.name}`} title={`Remove ${c.name}`} onClick={() => void collab.removeContact(c.code)}><SvgIcon name="x" /></button>
            </div>
          ))}
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
