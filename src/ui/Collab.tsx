import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as collab from '../collab/service';
import { keyOf, shortCode } from '../collab/code';
import { nextUtcMidnight } from '../collab/relay';
import type { Contact, Received } from '../collab/service';
import type { Ask } from './Confirm';
import { SvgIcon } from './icons';
import { StarIcon } from './starred';
import './collab.css';

/**
 * Card sharing: send a card to someone by their pairing code, and take in cards sent to yours.
 * The panel holds your code (Copy, your name, a new code), recipients, and cards waiting; Send Card to…
 * is a short list of recipients. Both are Falcon dialogs: Esc or a click outside closes them. The recipients list is
 * also in Settings > Sharing: one component, one store, so a change in either shows in the other.
 * A card or recipient that goes folds shut in place: it stays while its save runs, and stays for good if the save fails.
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
  if (!s.relay) return 'No relay is set, so nobody can send you cards yet, and yours go only to recipients whose code carries their relay. Add one in Settings > Sharing';
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
  if (!s.relay) return { text: "Nobody can send you cards until you set a relay in Settings > Sharing. Your code then carries it. You can still send to recipients whose code carries theirs." };
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
  const live = new Set(list.map(key));
  const now = Date.now(), ms = still() ? 200 : FOLD;
  // in the list's order (it can be reordered: recipients), with each row still folding shut kept after the row it was after
  const rows: { item: T; goneAt: number }[] = on ? list.map((t) => ({ item: t, goneAt: 0 })) : [];
  let after: string | null = null;
  for (const r of on ? prev.current : []) {
    const k = key(r.item);
    if (live.has(k)) { after = k; continue; }
    if (r.goneAt && now - r.goneAt >= ms) continue;
    rows.splice(after === null ? 0 : rows.findIndex((x) => key(x.item) === after) + 1, 0, { item: r.item, goneAt: r.goneAt || now });
    after = k;
  }
  prev.current = rows;
  const next = Math.min(...rows.filter((r) => r.goneAt).map((r) => r.goneAt + ms));
  useEffect(() => {
    if (next === Infinity) return;
    const t = setTimeout(() => again((n) => n + 1), Math.max(0, next - Date.now()) + 10);
    return () => clearTimeout(t);
  }, [next]);
  return rows.map((r) => ({ item: r.item, gone: r.goneAt > 0 }));
}

/** Where focus goes when a row leaves: the next row's `pick` (its first button), else the one before's, else the
 *  heading (`fallback`, or the section's). Not when the person has already moved on to something else. */
function focusAfter(row: Element | null, btn: Element, pick = 'button:not(:disabled)', fallback?: HTMLElement | null) {
  const at = document.activeElement;
  if (!row || (at && at !== document.body && at !== btn && !row.contains(at))) return;
  const ok = (e: Element | null) => !!e && e.classList.contains('co-fold') && !e.hasAttribute('data-gone');
  let to: Element | null = row.nextElementSibling;
  while (to && !ok(to)) to = to.nextElementSibling;
  if (!to) { to = row.previousElementSibling; while (to && !ok(to)) to = to.previousElementSibling; }
  (to?.querySelector<HTMLElement>(pick) ?? fallback ?? row.closest('section')?.querySelector<HTMLElement>('h3'))?.focus({ preventScroll: true });
}

/** Rows whose save is running ('wait', then 'slow' past 150 ms: only then a spinner, on the button `a` that started
 *  it), or failed, which the row then says. */
function useRowSaves() {
  const [rows, setRows] = useState<Record<string, { st: 'wait' | 'slow' | 'failed'; a: string }>>({});
  /** Run a row's save. True when it went through. */
  const run = useCallback(async (id: string, save: () => Promise<unknown>, a = '') => {
    setRows((r) => ({ ...r, [id]: { st: 'wait', a } }));
    const slow = setTimeout(() => setRows((r) => (r[id]?.st === 'wait' ? { ...r, [id]: { st: 'slow', a } } : r)), 150);
    try { await save(); setRows(({ [id]: _, ...r }) => r); return true; }
    catch { setRows((r) => ({ ...r, [id]: { st: 'failed', a } })); return false; }
    finally { clearTimeout(slow); }
  }, []);
  const state = (id: string, gone = false) => {
    const r = rows[id], busy = r?.st === 'wait' || r?.st === 'slow';
    return { busy, off: gone || busy, doing: (busy && r.a) || '', slow: (r?.st === 'slow' && r.a) || '', failed: r?.st === 'failed' };
  };
  return { run, state, clear: useCallback(() => setRows({}), []) };
}

/** Esc closes, wherever focus is. */
export function useEsc(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // a Confirm over the panel (New code…) answers its own Esc, and so does a box being typed in (data-draft)
      if (e.key !== 'Escape' || document.querySelector('.cf[role="alertdialog"]') || (e.target as HTMLElement | null)?.closest?.('[data-draft]')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [open, close]);
}

/** The Sharing dialog's Cards tab (Sharing.tsx draws the dialog): cards waiting, your code, recipients. */
export function CardsPane(props: {
  /** opened onto this tab: its first button takes focus (switched to: focus stays on the switch) */
  focus: boolean;
  onClose: () => void;
  flash: (m: string) => void;
  confirm: (a: Omit<Ask, 'done'>) => Promise<boolean>;
  /** put the card in the open document; null when it went in, else why not */
  onInsert: (c: Received) => string | null;
  onCopy: (c: Received) => Promise<boolean>;
}) {
  const s = useCollab();
  const { onClose, flash } = props;
  const first = useRef<HTMLButtonElement>(null), copyBtn = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  /** Add recipient on a card from a code that isn't one: the recipients list opens its add row with the code and name */
  const [draft, setDraft] = useState<Draft | null>(null);
  const { run, state, clear } = useRowSaves();
  const cards = useLeaving(s.cards, (c) => c.id, true);
  useLayoutEffect(() => { if (props.focus) (first.current ?? copyBtn.current)?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fromUnknown = (c: Received) => setDraft({ code: c.from, name: c.claimed });
  const copyCode = () => copyMyCode(s.code, flash);
  const renew = async () => {
    if (!(await props.confirm({ title: 'Make a new pairing code?', body: 'Your old code stops working: cards sent to it never arrive. Give the new one to everyone who sends you cards.', ok: 'New code' }))) return;
    await collab.newCode();
    flash('You have a new pairing code');
  };
  const ready = s.status === 'ready';
  const leave = async (e: React.MouseEvent<HTMLButtonElement>, id: string, save: () => Promise<unknown>, said: string) => {
    const btn = e.currentTarget, row = btn.closest('.co-fold');
    if (!(await run(id, save, 'x'))) return;
    flash(said);
    focusAfter(row, btn);
  };
  const dismissAll = async () => {
    const all = s.cards;
    if (!(await props.confirm({ title: `Dismiss all ${all.length} cards?`, body: 'They leave this Falcon for good. To get one back, ask whoever sent it to send it again.', ok: 'Dismiss all' }))) return;
    let done = 0;
    for (const c of all) { // one after another, so they fold shut in turn
      if (await run(c.id, () => collab.drop(c.id), 'x')) done++;
      if (!still()) await new Promise((r) => setTimeout(r, 90));
    }
    flash(done === all.length ? `Dismissed ${done} cards` : `Dismissed ${done} of ${all.length} cards`);
    document.querySelector<HTMLElement>('#sh-t')?.focus({ preventScroll: true });
  };

  return (
    <>
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
                          : <span>{c.unreadable ? 'It may need a newer Falcon. Ask them to send it another way. ' : ''}{who ? `From ${who.name}` : `From a code not in your recipients${c.claimed ? `, who says they're ${c.claimed}` : ''}`} · {when(c.gotAt)}</span>}
                      </div>
                      <div className="co-acts">
                        {!c.unreadable && <button ref={i === 0 ? first : undefined} className="co-main" disabled={st.off} onClick={() => { const why = props.onInsert(c); if (why) flash(why); else { void collab.drop(c.id).catch(() => {}); onClose(); } }}>Insert</button>}
                        {!c.unreadable && <button disabled={st.off} onClick={() => void props.onCopy(c).then((ok) => flash(ok ? `Copied “${c.label}”` : "Couldn't copy it"))}>Copy</button>}
                        {!who && <button disabled={st.off} onClick={() => fromUnknown(c)}>Add recipient</button>}
                        <button disabled={st.off} data-slow={st.slow || undefined} onClick={(e) => void leave(e, c.id, () => collab.drop(c.id), 'Dismissed')}><span className="co-spin" />Dismiss</button>
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
            <button ref={copyBtn} onClick={copyCode} disabled={!ready}><SvgIcon name="copy" />Copy</button>
          </div>
          <div className="co-row">
            <label htmlFor="co-name">Your name</label>
            <input id="co-name" className="co-in" spellCheck={false} maxLength={60} placeholder="Shown to people you send cards to" value={s.name} disabled={!ready}
              onChange={(e) => void collab.setName(e.target.value)} />
          </div>
          <button className="co-plain" onClick={() => void renew()} disabled={!ready}>New code…</button>
        </section>

        <section className="co-sec" aria-label="Recipients">
          <h3 ref={heading} tabIndex={-1}>Recipients</h3>
          <Recipients flash={flash} draft={draft} taken={() => setDraft(null)} heading={() => heading.current} />
        </section>
    </>
  );
}

/** Copy my pairing code, and remember it was given out (codeNote says when it has changed since). */
export const copyMyCode = (code: string, flash: (m: string) => void) => void navigator.clipboard?.writeText(code)
  .then(() => { flash('Copied your pairing code'); void collab.gaveCode().catch(() => {}); }, () => flash("Couldn't copy. Select the code and copy it"));

/** A recipient to add, from outside the list (a card from a stranger, the relay guide). The list takes it once
 *  (`taken`), so the one who passed it clears it and a list drawn again never sees an old one. */
export type Draft = { code: string; name: string };

/** A recipient's name: saved on Enter or leaving the box, Esc puts it back (data-draft keeps that Esc from closing what's behind). */
function NameBox({ c, disabled, save }: { c: Contact; disabled: boolean; save: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() && draft.trim() !== c.name) save(draft);
  };
  return (
    <input className="rcp-nm" aria-label={`Name of ${c.name}`} spellCheck={false} maxLength={60} disabled={disabled} value={draft ?? c.name}
      data-draft={draft === null ? undefined : ''} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape' && draft !== null) { e.stopPropagation(); setDraft(null); } }} />
  );
}

/** A code's ends, the whole code on hover (its title) or while it has focus. */
function CodeText({ code }: { code: string }) {
  const [full, setFull] = useState(false);
  return (
    <span className="rcp-cd" tabIndex={0} title={code} aria-label={`Pairing code ${code}`} data-full={full || undefined}
      onFocus={() => setFull(true)} onBlur={() => setFull(false)}>{full ? code : shortCode(code)}</span>
  );
}

/**
 * Recipients: who Send Card can send to, in the order it lists them. Each row: a name to edit, the code, then Move up,
 * Move down, Hide from Send Card, Star (where Send Card to starred goes) and Remove, shown on hover or focus.
 * The same list, on the same store, in the Card sharing panel and in Settings > Sharing. `heading` takes focus when
 * the last row leaves; without one, Add recipient does.
 */
export function Recipients({ flash, draft, taken, heading }: { flash: (m: string) => void; draft?: Draft | null; taken?: () => void; heading?: () => HTMLElement | null }) {
  const s = useCollab(), ready = s.status === 'ready';
  const list = useLeaving(s.contacts, (c) => c.code, true);
  const { run, state } = useRowSaves();
  const [adding, setAdding] = useState<{ code: string; name: string; bad: string | null } | null>(null);
  const box = useRef<HTMLDivElement>(null), codeBox = useRef<HTMLInputElement>(null), nameBox = useRef<HTMLInputElement>(null), addBtn = useRef<HTMLButtonElement>(null);
  /** where focus goes once a render has the element: the add row's box, Add recipient, or a row's button after a move */
  const want = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useLayoutEffect(() => {
    const el = want.current?.();
    if (el) { want.current = null; el.focus(); }
  });
  const open = (code = '', name = '') => { setAdding({ code, name, bad: null }); want.current = () => (code ? nameBox : codeBox).current; };
  useEffect(() => { if (draft) { open(draft.code, draft.name); taken?.(); } }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setAdding(null); want.current = () => addBtn.current; };
  const add = async () => {
    if (!adding) return;
    const had = collab.contactFor(adding.code);
    const why = await collab.addContact(adding.code, adding.name);
    if (why) { setAdding({ ...adding, bad: why }); (why === 'Give them a name' ? nameBox : codeBox).current?.focus(); return; }
    flash(had ? `Updated ${adding.name.trim()}${had.hidden ? '. They stay hidden from Send Card' : ''}` : `Added ${adding.name.trim()}`);
    close();
  };
  const row = (code: string) => box.current?.querySelector(`.rcp-row[data-code="${code}"]`);
  /** A move, a hide or a star, one at a time per row. Its button is off while it saves and its row may have moved, so
   *  once the list is drawn again focus goes back to it (or to the other arrow, at an end), unless it went elsewhere. */
  const act = async (c: Contact, a: string, save: () => Promise<unknown>) => {
    if (state(c.code).busy) return;
    await run(c.code, save, a);
    setTimeout(() => {
      const on = document.activeElement;
      if (on && on !== document.body && !box.current?.contains(on)) return;
      const b = row(c.code)?.querySelector<HTMLButtonElement>(`[data-a="${a}"]`);
      (b && !b.disabled ? b : row(c.code)?.querySelector<HTMLButtonElement>(`[data-a="${a === 'up' ? 'down' : 'up'}"]`))?.focus({ preventScroll: true });
    });
  };
  const remove = async (e: React.MouseEvent<HTMLButtonElement>, c: Contact) => {
    const btn = e.currentTarget, at = btn.closest('.co-fold');
    if (state(c.code).busy) return;
    if (!(await run(c.code, () => collab.removeContact(c.code), 'x'))) return;
    flash(`Removed ${c.name}`);
    focusAfter(at, btn, '[data-a="x"]', heading?.() ?? addBtn.current);
  };
  const n = s.contacts.length;
  return (
    <div className="rcp" ref={box}>
      {!list.length && !adding && <p className="rcp-none">No one yet. Add the pairing code someone gave you.</p>}
      {list.map(({ item: c, gone }) => {
        // only a removal turns the row off: a button disabled under focus drops it, so a rename, move, hide or star
        // runs with the row as it is (act() won't start a second one)
        const st = state(c.code, gone), at = s.contacts.findIndex((x) => x.code === c.code), off = !ready || gone || st.doing === 'x';
        const btn = (a: string, label: string, title: string, icon: ReactNode, onClick: (e: React.MouseEvent<HTMLButtonElement>) => void, more: { disabled?: boolean; pressed?: boolean } = {}) => (
          <button className="rcp-i" data-a={a} aria-label={label} title={title} aria-pressed={more.pressed} disabled={off || more.disabled}
            data-slow={st.slow === a || undefined} onClick={onClick}><span className="co-spin" />{icon}</button>
        );
        return (
          <div key={c.code} className="co-fold" data-gone={gone || undefined} aria-hidden={gone || undefined}><div>
            <div className="rcp-row" data-code={c.code} data-hidden={c.hidden || undefined}>
              <NameBox c={c} disabled={off} save={(name) => { if (!state(c.code).busy) void run(c.code, () => collab.renameContact(c.code, name), 'name'); }} />
              {st.failed ? <span className="rcp-err" role="alert">Couldn't save that. Try again</span> : <CodeText code={c.code} />}
              <span className="rcp-acts">
                {btn('up', `Move ${c.name} up`, 'Move up', <SvgIcon name="moveUp" />, () => void act(c, 'up', () => collab.moveContact(c.code, -1)), { disabled: at <= 0 })}
                {btn('down', `Move ${c.name} down`, 'Move down', <SvgIcon name="moveDown" />, () => void act(c, 'down', () => collab.moveContact(c.code, 1)), { disabled: at < 0 || at >= n - 1 })}
                {btn('hide', `Hide ${c.name} from Send Card`, c.hidden ? 'Hidden from Send Card. Click to show them there again' : 'Hide from Send Card (they stay here)',
                  <SvgIcon name={c.hidden ? 'eyeOff' : 'eye'} />, () => void act(c, 'hide', () => collab.hideContact(c.code, !c.hidden)), { pressed: !!c.hidden })}
                {btn('star', `Star ${c.name}`, c.starred ? 'Starred: Send Card to starred goes to them. Click to unstar' : 'Star: Send Card to starred goes to them',
                  <StarIcon />, () => void act(c, 'star', () => collab.starContact(c.code, !c.starred)), { pressed: !!c.starred })}
                {btn('x', `Remove ${c.name}`, 'Remove', <SvgIcon name="x" />, (e) => void remove(e, c))}
              </span>
            </div>
          </div></div>
        );
      })}
      {adding ? (
        // data-draft and data-own-esc: Esc anywhere in the add row (its boxes or buttons) shuts the row, not the panel or Settings
        <form className="rcp-add" data-draft="" data-own-esc="" onSubmit={(e) => { e.preventDefault(); void add(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
          <input ref={codeBox} className="co-in co-mono" aria-label="Their pairing code" placeholder="Paste their pairing code" spellCheck={false} autoCapitalize="characters" autoCorrect="off"
            value={adding.code} data-bad={adding.bad && adding.bad !== 'Give them a name' ? true : undefined} disabled={!ready}
            onChange={(e) => setAdding({ ...adding, code: e.target.value, bad: null })} />
          <input ref={nameBox} className="co-in" aria-label="Their name" placeholder="Name" spellCheck={false} maxLength={60} value={adding.name}
            data-bad={adding.bad === 'Give them a name' || undefined} disabled={!ready} onChange={(e) => setAdding({ ...adding, name: e.target.value, bad: null })} />
          <button type="submit" className="rcp-btn rcp-main" disabled={!ready || !adding.code.trim()}>Add</button>
          <button type="button" className="rcp-btn" onClick={close}>Cancel</button>
        </form>
      ) : <button ref={addBtn} className="rcp-btn rcp-new" disabled={!ready} onClick={() => open()}><SvgIcon name="plus" />Add recipient</button>}
      {adding?.bad && <p className="rcp-err rcp-why" role="alert">{adding.bad}</p>}
    </div>
  );
}

/** Send Card to…: pick a recipient (arrows and Enter, or a click). Hidden ones aren't listed; the order is theirs. */
export function SendCard(props: { label: string | null; onClose: () => void; onSend: (c: Contact) => void; onManage: () => void }) {
  const s = useCollab();
  const open = props.label !== null;
  const [at, setAt] = useState(0);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  useEsc(open, props.onClose);
  useLayoutEffect(() => { if (open) { setAt(0); requestAnimationFrame(() => (rows.current[0] ?? document.querySelector<HTMLElement>('.co-send button'))?.focus()); } }, [open]);
  if (!open) return null;
  const list = collab.sendable(s);
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
          <div className="co-pick" role="list" aria-label="Recipients">
            {list.map((c, i) => (
              <button key={c.code} ref={(el) => { rows.current[i] = el; }} role="listitem" className="co-ct co-pk" data-on={i === at || undefined}
                onFocus={() => setAt(i)} onPointerEnter={() => setAt(i)} onClick={() => props.onSend(c)}>
                <span className="nm">{c.name}</span><span className="cd">{shortCode(c.code)}</span>
              </button>
            ))}
          </div>
        ) : <p className="co-sub">{s.contacts.length ? 'Everyone is hidden from this list. Show someone again with the eye in Settings > Sharing.' : 'No recipients yet. Add the pairing code someone gave you first.'}</p>}
        <div className="cf-btns">
          <button onClick={props.onManage}>{s.contacts.length ? 'Recipients…' : 'Add a recipient…'}</button>
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
