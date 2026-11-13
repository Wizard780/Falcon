import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import * as collab from '../collab/service';
import { shortCode } from '../collab/code';
import { liveActions, liveInfo, setLiveInfo, subscribeLive, TYPING_MS, type LiveInfo } from '../collab/live-store';
import type { LiveSession, Member } from '../collab/live';
import { createState } from '../editor/editor';
import { bridge } from '../editor/host';
import { useCollab } from './Collab';
import type { Ask } from './Confirm';
import './collab.css';

/**
 * Live editing: everyone in a session edits the same doc and sees each other's edits and carets as they type. A
 * session is a room on the relay (the one set in Settings > Sharing), sealed with a key that goes to each person
 * invited inside a card envelope, so the relay only ever passes along ciphertext. One session per window.
 */

export const useLive = () => useSyncExternalStore(subscribeLive, liveInfo);

/** Live editing, in a line. */
export function liveLine(i: LiveInfo, relay: string): string {
  if (!relay) return 'Live editing goes through a relay, and none is set. Add one in Settings > Sharing';
  if (!i) return 'Not in a live session';
  const s = i.status;
  switch (s.kind) {
    case 'connecting': return 'Connecting to the relay…';
    case 'syncing': return i.docId === null ? `Getting “${i.doc}” from the others in it…` : 'Catching up with the others…';
    case 'waiting': return `Nobody in “${i.doc}” has it open right now. It opens here when someone who has it comes back`;
    case 'live': return i.members.length ? 'Live. Your edits reach everyone in it as you type' : 'Live. Invite someone, and your edits reach them as you type';
    case 'retry': { const sec = Math.max(1, Math.round((s.at - Date.now()) / 1000));
      return `Can't reach the relay. Your edits stay here and go out once it's back. Trying again in ${sec < 60 ? `${sec} s` : `${Math.round(sec / 60)} min`}`; }
    case 'paused': return `Paused until ${collab.resetTime(s.until)}, when the relay's free daily limit resets. Your edits stay here and go out then`;
    case 'full': return 'This session already has 8 people in it. Trying again in a bit';
    case 'no_rooms': return bridge.relaySetup
      ? 'Your relay is from before live editing. Whoever set it up updates it: the ? beside Relay in Settings > Sharing, then Set up my relay. Card sharing keeps working meanwhile'
      : 'Your relay is from before live editing. Whoever set it up downloads it again and runs npx wrangler deploy (the ? in Settings > Sharing shows how). Card sharing keeps working meanwhile';
    case 'ended': return 'You left the session';
    case 'closed': return `${s.by} ended the session. “${i.doc}” stays open here as it is`;
    case 'removed': return `${s.by} took you out of the session. “${i.doc}” stays open here as it is`;
    case 'mismatch': return `${s.name}'s Falcon is a different version, so you can't edit together. Update Falcon, both of you, then start again`;
  }
}

const named = (m: { name: string }) => (m.name === '…' ? 'Someone joining' : m.name);
/** "Avery and Blake", "Avery, Blake and 2 more" */
export function whoLine(i: NonNullable<LiveInfo>) {
  const n = i.members.map(named);
  if (!n.length) return 'just you';
  return n.length <= 3 ? n.join(n.length === 2 ? ' and ' : ', ').replace(/, ([^,]*)$/, ' and $1') : `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
}

export type LiveHost = {
  /** the doc the toolbar acts on */
  active: () => { id: number; name: string } | null;
  /** the editor holding doc `id` now, or null when it's put away in its tab */
  viewOf: (id: number) => EditorView | null;
  stored: (id: number) => EditorState | null;
  setStored: (id: number, s: EditorState) => void;
  /** open `doc` in a new tab (or the untouched blank one) and show it; its id */
  openDoc: (doc: PMNode, name: string) => number | null;
  flash: (m: string, action?: { label: string; run: () => void }) => void;
  confirm: (a: Omit<Ask, 'done'>) => Promise<boolean>;
  openPanel: () => void;
  /** a dialog, a question or read mode is up: a toast's Join waits for it (the invite still waits on the rail) */
  busy: () => boolean;
};

type Mods = [typeof import('../collab/live'), typeof import('../collab/live-doc')];
type Held = { s: LiveSession; docId: number | null; plugins: readonly Plugin[] | null; away?: () => void };

/** App's half: start, leave, invite and join, kept in step with the editor holding the doc. */
export function useLiveSessions(h: LiveHost) {
  const host = useRef(h);
  host.current = h;
  const held = useRef<Held | null>(null);
  const mods = useRef<Mods | null>(null);
  const load = async () => (mods.current ??= await Promise.all([import('../collab/live'), import('../collab/live-doc')]));
  const publish = useCallback(() => {
    const r = held.current;
    setLiveInfo(r ? { docId: r.docId, room: r.s.room, doc: r.s.invite().doc, status: r.s.status, me: r.s.me, members: r.s.members, hosting: r.s.hosting } : null);
    // the session is over from the other side (a Falcon whose documents differ, ended for everyone, or taken out of it):
    // the doc goes back to a plain one
    const k = r?.s.status.kind;
    if (k === 'mismatch' || k === 'closed' || k === 'removed') {
      const why = liveLine(liveInfo(), collab.relayUrl());
      // taken out: the invite to that room goes too, so it isn't one click from coming back in
      if (k === 'removed') for (const v of collab.current().invites) if (v.invite.room === r!.s.room) void collab.dropInvite(v.id).catch(() => {});
      setTimeout(() => { if (held.current === r) { stopRef.current(false); host.current.flash(why); } }, 0);
    }
  }, []);
  const stopRef = useRef<(say?: boolean) => void>(() => {});
  const myName = () => collab.current().name.trim() || 'Someone';

  /**
   * While the session's doc is out of the editor (another tab showing), its tab's stored state is kept up to date with
   * what comes in: crash recovery, block search and the unsaved dot read it, and Send to speech can add to it.
   */
  const follow = (r: Held, ld: Mods[1]) => {
    r.s.binding.shown = (shown, last) => {
      r.away?.();
      r.away = undefined;
      if (shown || held.current !== r || r.docId === null) return;
      const id = r.docId;
      r.away = r.s.binding.doc.subscribe((event) => {
        const st = host.current.stored(id) ?? last; // the tab gets its state once App has stashed it
        const next = st && ld.applyRemote(st, r.s.binding, event);
        if (next) { last = next; host.current.setStored(id, next); }
      });
    };
  };

  /** Leave: the doc goes back to a plain one, as it is now (with what came in while its tab was put away). */
  const stop = useCallback((say = true) => {
    const r = held.current;
    if (!r) return;
    held.current = null;
    r.s.binding.shown = undefined;
    r.away?.();
    r.s.stop();
    const m = mods.current;
    if (m && r.docId !== null && r.plugins) {
      const [, ld] = m, view = host.current.viewOf(r.docId);
      if (view) view.updateState(ld.localState(view.state, r.plugins));
      else { const st = host.current.stored(r.docId); if (st && ld.isLiveState(st)) host.current.setStored(r.docId, createState(ld.docOf(r.s.binding) ?? st.doc)); }
    }
    publish();
    if (say) host.current.flash(`Left the live session. “${r.s.invite().doc}” stays open as it is`);
  }, [publish]);

  stopRef.current = stop;

  /** Only one session at a time: asks before leaving the one there is. */
  const leaveFirst = async (what: string) => {
    const r = held.current;
    if (!r) return true;
    if (!(await host.current.confirm({ title: `Leave the session on “${r.s.invite().doc}”?`, body: `Falcon is in one live session at a time. ${what} That doc stays open as it is.`, ok: 'Leave it' }))) return false;
    stop(false);
    return true;
  };

  const start = useCallback(async () => {
    const cur = host.current.active();
    if (!cur) return;
    if (held.current?.docId === cur.id) { host.current.openPanel(); return; }
    const relay = collab.relayUrl();
    if (!relay) { host.current.flash('Live editing goes through a relay, and none is set. Add one in Settings > Sharing'); return; }
    if (!(await leaveFirst(`Starting one on “${cur.name}” leaves it.`))) return;
    const [live, ld] = await load();
    const view = host.current.viewOf(cur.id);
    if (!view || held.current) return;
    const s = live.host({ relay, doc: cur.name, name: myName(), onChange: publish }, view.state.doc);
    const r: Held = { s, docId: cur.id, plugins: view.state.plugins };
    held.current = r;
    follow(r, ld);
    view.updateState(ld.liveState(view.state, s.binding, s.me));
    publish();
    host.current.openPanel();
  }, [publish]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = useCallback(async (inv: collab.Invited) => {
    if (held.current?.s.room === inv.invite.room) { void collab.joinedInvite(inv.id).catch(() => {}); host.current.openPanel(); return; }
    // the room is on the host's relay, which the invite names; mine is for an invite that names none
    const relay = inv.invite.relay || collab.relayUrl();
    if (!relay) { host.current.flash('Live editing goes through a relay, and none is set. Add one in Settings > Sharing'); return; }
    if (!(await leaveFirst(`Joining “${inv.invite.doc}” leaves it.`))) return;
    const [live, ld] = await load();
    if (held.current) return;
    const s = live.join({ relay, name: myName(), onChange: publish }, inv.invite);
    const r: Held = { s, docId: null, plugins: null };
    held.current = r;
    publish();
    host.current.flash(`Joining “${inv.invite.doc}”…`);
    await s.ready;
    if (held.current !== r) return; // left before it came in
    const id = host.current.openDoc(ld.docOf(s.binding)!, inv.invite.doc); // Loro's doc now: more may have come in since ready
    const view = id === null ? null : host.current.viewOf(id);
    if (!view) { stop(false); return; }
    r.docId = id;
    r.plugins = view.state.plugins;
    void collab.joinedInvite(inv.id).catch(() => {}); // in it: no longer waiting on the rail
    follow(r, ld);
    view.updateState(ld.liveState(view.state, s.binding, s.me));
    publish();
    host.current.flash(`You're in “${inv.invite.doc}” with ${whoLine(liveInfo()!)}`);
  }, [publish, stop]); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = useCallback(async (c: collab.Contact) => {
    const r = held.current;
    if (!r) return;
    host.current.flash(`Inviting ${c.name}…`);
    host.current.flash((await collab.sendInvite(c, r.s.invite())).message);
  }, []);

  useEffect(() => {
    Object.assign(liveActions, {
      start: () => void start(), stop: () => stop(), invite, join: (i: collab.Invited) => void join(i), open: () => host.current.openPanel(),
      end: async () => { const r = held.current; if (!r || r.s.status.kind !== 'live') return; await r.s.end(); stop(false); },
      remove: (peer: string) => {
        const r = held.current, m = r?.s.members.find((x) => x.peer === peer);
        if (!r || !m) return;
        if (r.s.status.kind !== 'live') { host.current.flash("Can't reach the relay right now, so nobody can be removed. Try again once it's back"); return; }
        r.s.remove(peer);
        host.current.flash(`Removed ${named(m)}. They keep their copy`);
      },
    });
  }, [start, stop, invite, join]);
  useEffect(() => collab.onInvited((i, who) => {
    // invited again to the room I'm in (they pressed Invite twice): nothing to join, nothing waiting
    if (held.current?.s.room === i.invite.room) { void collab.joinedInvite(i.id).catch(() => {}); return; }
    // the name an envelope gives is only what the sender typed: a stranger is said to be one, as the panel says it
    const from = collab.fromWho(who, i.claimed);
    host.current.flash(`${from[0].toUpperCase()}${from.slice(1)}${!who && i.claimed.trim() ? ',' : ''} invited you to live-edit “${i.invite.doc}”`, {
      label: 'Join',
      // the toast draws over dialogs: what's open is dealt with first, and the invite waits on the rail meanwhile
      run: () => { if (host.current.busy()) host.current.flash(WAITS); else void join(i); },
    });
  }), [join]);
  // a closed window leaves: the socket closes with the page, which the room tells the others
  useEffect(() => () => { const r = held.current; if (r) { r.s.binding.shown = undefined; r.away?.(); r.s.stop(); } held.current = null; setLiveInfo(null); }, []);

  /** The doc `id` closed: its session ends with it. */
  const closed = useCallback((id: number) => { if (held.current?.docId === id) stop(); }, [stop]);
  return { start, stop, closed };
}

/** Said when a toast's button can't act yet. */
export const WAITS = "Close what's open first. It waits on the rail's Sharing button.";

const when = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Invites that came in: Join (again, for one you left) or Dismiss. */
function Invites() {
  const c = useCollab(), i = useLive();
  if (!c.invites.length) return <p className="co-sub">None waiting. When a recipient invites you, it shows here and as a message.</p>;
  return (
    <>{[...c.invites].reverse().map((v) => {
      const who = collab.contactFor(v.from), here = i?.room === v.invite.room;
      return (
        <div key={v.id} className="co-card lv-inv">
          <div className="co-what">
            <b>{v.invite.doc}</b>
            <span>{who ? `From ${who.name}` : `From a code not in your recipients${v.claimed ? `, who says they're ${v.claimed}` : ''}`} · {when(v.gotAt)}</span>
          </div>
          <div className="co-acts">
            <button className="co-main" disabled={here} onClick={() => liveActions.join?.(v)}>{here ? 'In it' : 'Join'}</button>
            <button onClick={() => void collab.dropInvite(v.id).catch(() => {})}>Dismiss</button>
          </div>
        </div>
      );
    })}</>
  );
}

/** The Sharing dialog's Live tab (Sharing.tsx draws the dialog): this doc's session (start, who's in it, invite,
 *  leave) and invites that came in. `focus`: opened onto this tab, so its first button takes focus. */
export function LivePane(props: { focus: boolean; docName: string }) {
  const i = useLive(), c = useCollab();
  const [, tick] = useState(0);
  const first = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (props.focus) (first.current ?? box.current?.querySelector('button'))?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []); // the retry countdown
  const relay = collab.relayUrl();
  const on = !!i;
  return (
    <div ref={box}>
        <section className="co-sec lv-now">
          <p className="co-line lv-line" role="status">{liveLine(i, relay)}</p>
        </section>

        <section className="co-sec" aria-label="This document">
          {!on ? (
            <>
              <h3>“{props.docName}”</h3>
              <p className="co-sub">Start a session on this doc, then invite recipients. Everyone in it edits it with you and sees your edits as you type. Only the people you invite can read it: the relay passes it along sealed.</p>
              <button ref={first} className="co-main" disabled={!relay} onClick={() => liveActions.start?.()}>Start live editing</button>
            </>
          ) : (
            <>
              <h3>In “{i.doc}”</h3>
              <div className="lv-who" role="list" aria-label="In this session">
                <div className="co-ct" role="listitem"><i className="lv-bar" style={{ '--peer': i.me.color } as React.CSSProperties} /><span className="nm">You ({i.me.name})</span></div>
                {i.members.map((m) => <div key={m.slot} className="co-ct" role="listitem"><i className="lv-bar" style={{ '--peer': m.color } as React.CSSProperties} /><span className="nm">{named(m)}</span></div>)}
              </div>
              <button className="co-plain" onClick={() => { liveActions.stop?.(); }}>Leave the session</button>
            </>
          )}
        </section>

        {on && i.docId !== null && (
          <section className="co-sec" aria-label="Invite">
            <h3>Invite</h3>
            {c.contacts.length ? (
              <div role="list" aria-label="Recipients">
                {c.contacts.map((ct, n) => (
                  <div key={ct.code} className="co-ct" role="listitem"><span className="nm">{ct.name}</span><span className="cd">{shortCode(ct.code)}</span>
                    <button ref={n === 0 ? first : undefined} className="lv-inv-btn" onClick={() => void liveActions.invite?.(ct)}>Invite</button></div>
                ))}
              </div>
            ) : <p className="co-sub">No recipients yet. Swap pairing codes, then add them in Settings &gt; Sharing.</p>}
          </section>
        )}

        <section className="co-sec" aria-label="Invites">
          <h3>Invites to you</h3>
          <Invites />
        </section>
    </div>
  );
}

/** Settings > Sharing > Live editing: the open doc's session. */
export function LiveDocControl() {
  const i = useLive();
  useCollab();
  const relay = collab.relayUrl();
  if (!i) return <button className="st-btn" disabled={!relay} onClick={() => liveActions.start?.()}>Start live editing</button>;
  return (
    <span className="lv-st">
      <span className="lv-note">{i.status.kind === 'live' ? `With ${whoLine(i)}` : liveLine(i, relay)}</span>
      <button className="st-btn" onClick={() => liveActions.open?.()}>Invite…</button>
      <button className="st-btn" onClick={() => liveActions.stop?.()}>Leave</button>
    </span>
  );
}
/** Settings > Sharing > Invites to you. */
export function LiveInvitesControl() {
  const c = useCollab();
  if (!c.invites.length) return <span className="lv-note">None waiting</span>;
  return <button className="st-btn" onClick={() => liveActions.open?.()}>{c.invites.length === 1 ? '1 invite…' : `${c.invites.length} invites…`}</button>;
}

const HEADS = ['tag', 'block', 'hat', 'pocket', 'analytic'];
/** The heading above someone's caret on this screen (their tag, else their block…), from the page itself. */
function whereIs(peer?: string): string {
  if (!peer) return '';
  const c = document.querySelector(`.ProseMirror .f-peer[data-peer="${peer}"]`);
  let el = c?.closest('.ProseMirror > *') ?? null;
  for (; el; el = el.previousElementSibling) {
    const st = (el as HTMLElement).dataset.style;
    if (st && HEADS.includes(st) && el.textContent?.trim()) { const t = el.textContent.trim(); return t.length > 40 ? `${t.slice(0, 39)}…` : t; }
  }
  return '';
}
/** "Econ Advantage · typing now", "Okafor 24 · idle 3 min" */
function doing(m: Member, now: number): string {
  if (m.name === '…') return 'Joining…';
  const bits = [whereIs(m.peer)];
  if (m.at && now - m.at < TYPING_MS) bits.push('typing now');
  else if (m.at && now - m.at >= 60_000) bits.push(`idle ${Math.floor((now - m.at) / 60_000)} min`);
  if (m.host) bits.push('hosting');
  return bits.filter(Boolean).join(' · ') || 'Here';
}
/** You first, then whoever typed last. */
const byLast = (ms: Member[]) => [...ms].sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.slot - b.slot);

const FOLD_MS = 340;
/** Rows that leave stay a moment, folding shut where they were (Card sharing's motion). */
function useLeaving<T>(items: T[], key: (t: T) => string): { x: T; gone: boolean }[] {
  const [gone, setGone] = useState<Map<string, { x: T; i: number }>>(new Map());
  const prev = useRef<T[]>(items);
  const keys = items.map(key).join();
  useEffect(() => {
    const now = new Set(items.map(key));
    const left = prev.current.map((x, i) => ({ x, i })).filter(({ x }) => !now.has(key(x)));
    prev.current = items;
    if (!left.length) return;
    setGone((g) => { const n = new Map(g); for (const l of left) n.set(key(l.x), l); return n; });
    setTimeout(() => setGone((g) => { const n = new Map(g); for (const l of left) n.delete(key(l.x)); return n; }), FOLD_MS);
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = items.map((x) => ({ x, gone: false }));
  for (const [k, l] of gone) if (!items.some((x) => key(x) === k)) out.splice(Math.min(l.i, out.length), 0, { x: l.x, gone: true });
  return out;
}

const short = (k: string) => (k === 'syncing' ? 'Catching up…' : k === 'paused' ? 'Paused' : k === 'no_rooms' ? 'Relay needs an update' : k === 'connecting' ? 'Connecting…' : 'Reconnecting…');

/**
 * Who's here: the live doc's people, on the toolbar. Their colors, and how many; open, each person with where they are
 * and whether they're typing (hover one to find their caret). Whoever started it can take someone out, or end it for
 * everyone; the others leave.
 */
export function WhoHere({ docId }: { docId: number }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  /** the session as it was when this Falcon ended it: the popover stays to say so */
  const [over, setOver] = useState<NonNullable<LiveInfo> | null>(null);
  const shown = useRef(false);
  const [folding, setFolding] = useState<Set<number>>(new Set());
  const [, tick] = useState(0);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null), head = useRef<HTMLHeadingElement>(null), endYes = useRef<HTMLButtonElement>(null), endAsk = useRef<HTMLButtonElement>(null);
  const i = live?.docId === docId ? live : over?.docId === docId ? over : null;
  shown.current = open;
  const close = useCallback(() => { setOpen(false); setAsking(false); setOver(null); setFolding(new Set()); setLit(null); }, []);
  useEffect(() => { if (!open) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.cf[role="alertdialog"], .cf-back')) return;
      e.preventDefault(); e.stopPropagation();
      if (asking) { setAsking(false); setTimeout(() => endAsk.current?.focus(), 0); } else close(); // Esc backs out of the question first
    };
    addEventListener('mousedown', down, true);
    addEventListener('keydown', key, true);
    return () => { removeEventListener('mousedown', down, true); removeEventListener('keydown', key, true); };
  }, [open, asking, close]);
  useLayoutEffect(() => { if (open) head.current?.focus({ preventScroll: true }); }, [open]);
  useLayoutEffect(() => { if (asking) endYes.current?.focus({ preventScroll: true }); }, [asking]);
  // the order is set when it opens: a row never moves under the pointer (someone typing would bring theirs to the top)
  const order = useRef<number[]>([]);
  if (!open) order.current = [];
  const ranked = byLast(i?.members ?? []);
  for (const m of ranked) if (!order.current.includes(m.slot)) order.current.push(m.slot);
  const people = ranked.sort((a, b) => order.current.indexOf(a.slot) - order.current.indexOf(b.slot)).filter((m) => !folding.has(m.slot));
  const rows = useLeaving(people, (m) => String(m.slot));
  if (!i) return null;
  const k = i.status.kind, here = k === 'live' || over;
  const n = 1 + i.members.length;
  const now = Date.now();

  const end = async () => {
    const snap = i;
    // one after another, then the session goes
    for (const m of byLast(snap.members)) { setFolding((f) => new Set(f).add(m.slot)); await new Promise((r) => setTimeout(r, 110)); }
    if (!shown.current) { setFolding(new Set()); await liveActions.end?.(); return; } // closed while folding: it ends, with nothing left to show
    setOver({ ...snap, members: [] });
    setAsking(false);
    await liveActions.end?.();
    head.current?.focus({ preventScroll: true });
  };

  return (
    <div className="lv-whowrap" ref={wrap}>
      {lit && <style>{`.ProseMirror .f-peer[data-peer="${lit}"]::after{opacity:1}`}</style>}
      <button className="who" aria-haspopup="dialog" aria-expanded={open} aria-label={`Live editing with ${whoLine(i)}`} title={`Live editing with ${whoLine(i)}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { if (open) { close(); return; } const r = e.currentTarget.getBoundingClientRect(); setAt({ top: r.bottom + 6, right: Math.max(8, innerWidth - r.right) }); setOpen(true); }}>
        <span className="dots" aria-hidden>{[i.me, ...i.members].map((m, j) => <i key={j} style={{ '--c': m.color } as React.CSSProperties} />)}</span>
        <span>{over ? 'Just you' : here ? (n > 1 ? `${n} here` : 'Just you') : short(k)}</span>
      </button>
      {open && (
        <div className="lv-pop" role="dialog" aria-label="In this file" style={at ?? undefined}>
          <h3 tabIndex={-1} ref={head}>In this file</h3>
          <p className="line" role="status">{over ? 'The session is over. This file is yours alone again.' : k === 'live' ? `People editing ${i.doc} with you.` : liveLine(i, collab.relayUrl())}</p>
          <div role="list" aria-label="In this session">
            <div className="lv-fold" role="listitem"><div><div className="pr">
              <span className="d" style={{ '--c': i.me.color } as React.CSSProperties} />
              <div className="t"><b>You</b><span>This Falcon{i.hosting && !over ? ' · hosting' : ''}</span></div>
            </div></div></div>
            {rows.map(({ x: m, gone }) => (
              <div key={m.slot} className="lv-fold" data-gone={gone || undefined} role="listitem"
                onMouseEnter={() => setLit(m.peer ?? null)} onMouseLeave={() => setLit(null)}>
                <div><div className="pr">
                  <span className="d" style={{ '--c': m.color } as React.CSSProperties} />
                  <div className="t"><b>{named(m)}</b><span>{doing(m, now)}</span></div>
                  {i.hosting && !over && k === 'live' && m.peer && (
                    <button className="lv-btn" aria-label={`Remove ${named(m)}`} onClick={() => { liveActions.remove?.(m.peer!); setLit(null); }}>Remove</button>
                  )}
                </div></div>
              </div>
            ))}
          </div>
          {!over && (
            <div className="end">
              {asking ? (
                <>
                  <span>Everyone keeps their own copy.</span>
                  <div className="acts">
                    <button className="lv-btn" onClick={() => { setAsking(false); setTimeout(() => endAsk.current?.focus(), 0); }}>Cancel</button>
                    <button className="lv-btn" ref={endYes} onClick={() => void end()}>End session</button>
                  </div>
                </>
              ) : (
                <>
                  {i.docId !== null ? <button className="lv-btn plain lv-l" onClick={() => { close(); liveActions.open?.(); }}>Invite…</button> : <span />}
                  {i.hosting && k !== 'live' ? <span />
                    : i.hosting
                    ? <button ref={endAsk} className="lv-btn plain" onClick={() => setAsking(true)}>End session for everyone…</button>
                    : <button className="lv-btn plain" onClick={() => { close(); liveActions.stop?.(); }}>Leave</button>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
