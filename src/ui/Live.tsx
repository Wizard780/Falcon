import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import * as collab from '../collab/service';
import { shortCode } from '../collab/code';
import { liveActions, liveInfo, setLiveInfo, subscribeLive, type LiveInfo } from '../collab/live-store';
import type { LiveSession } from '../collab/live';
import { createState } from '../editor/editor';
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
    case 'no_rooms': return 'Your relay is from before live editing. Whoever set it up downloads it again and runs npx wrangler deploy (the ? in Settings > Sharing shows how). Card sharing keeps working meanwhile';
    case 'ended': return 'You left the session';
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
    setLiveInfo(r ? { docId: r.docId, room: r.s.room, doc: r.s.invite().doc, status: r.s.status, me: r.s.me, members: r.s.members } : null);
    // someone runs a Falcon whose documents differ: the session has ended, so the doc goes back to a plain one
    if (r?.s.status.kind === 'mismatch') {
      const why = liveLine(liveInfo(), collab.relayUrl());
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
    if (held.current?.s.room === inv.invite.room) { host.current.openPanel(); return; }
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
    Object.assign(liveActions, { start: () => void start(), stop: () => stop(), invite, join: (i: collab.Invited) => void join(i), open: () => host.current.openPanel() });
  }, [start, stop, invite, join]);
  useEffect(() => collab.onInvited((i, who) => {
    // the name an envelope gives is only what the sender typed: a stranger is said to be one, as a card from one is
    host.current.flash(`${who ? who.name : 'A code not in your contacts'} invited you to live-edit “${i.invite.doc}”`, { label: 'Join', run: () => void join(i) });
  }), [join]);
  // a closed window leaves: the socket closes with the page, which the room tells the others
  useEffect(() => () => { const r = held.current; if (r) { r.s.binding.shown = undefined; r.away?.(); r.s.stop(); } held.current = null; setLiveInfo(null); }, []);

  /** The doc `id` closed: its session ends with it. */
  const closed = useCallback((id: number) => { if (held.current?.docId === id) stop(); }, [stop]);
  return { start, stop, closed };
}

/** The status bar's live line, when the shown doc is in a session. Opens the panel. */
export function LiveBit({ docId, onOpen }: { docId: number; onOpen: () => void }) {
  const i = useLive();
  if (!i || i.docId !== docId) return null;
  const k = i.status.kind;
  const what = k === 'live' ? `Live · ${whoLine(i)}` : k === 'paused' ? 'Live · paused' : k === 'no_rooms' ? 'Live · relay needs an update' : k === 'syncing' ? 'Live · catching up' : 'Live · reconnecting';
  return <button className="lit lv-bit" title="Live editing: who's in it, invite, leave" onClick={onOpen}>{what}</button>;
}

/** Esc closes, wherever focus is. */
function useEsc(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.cf[role="alertdialog"]')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [open, close]);
}

const when = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Invites that came in: Join (again, for one you left) or Dismiss. */
function Invites() {
  const c = useCollab(), i = useLive();
  if (!c.invites.length) return <p className="co-sub">None waiting. When a contact invites you, it shows here and as a message.</p>;
  return (
    <>{[...c.invites].reverse().map((v) => {
      const who = collab.contactFor(v.from), here = i?.room === v.invite.room;
      return (
        <div key={v.id} className="co-card lv-inv">
          <div className="co-what">
            <b>{v.invite.doc}</b>
            <span>{who ? `From ${who.name}` : `From a code not in your contacts${v.claimed ? `, who says they're ${v.claimed}` : ''}`} · {when(v.gotAt)}</span>
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

/** Live editing: this doc's session (start, who's in it, invite, leave) and invites that came in. */
export function LivePanel(props: { open: boolean; onClose: () => void; docName: string }) {
  const i = useLive(), c = useCollab();
  const { open, onClose } = props;
  const [, tick] = useState(0);
  const first = useRef<HTMLButtonElement>(null);
  useEsc(open, onClose);
  useLayoutEffect(() => { if (open) (first.current ?? document.querySelector<HTMLElement>('.co-live button'))?.focus(); }, [open]);
  useEffect(() => { if (!open) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [open]); // the retry countdown
  if (!open) return null;
  const relay = collab.relayUrl();
  const on = !!i;
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf co co-live" role="dialog" aria-modal="true" aria-labelledby="lv-t">
        <h2 id="lv-t" tabIndex={-1}>Live editing</h2>
        <p className="co-line" role="status">{liveLine(i, relay)}</p>

        <section className="co-sec" aria-label="This document">
          {!on ? (
            <>
              <h3>“{props.docName}”</h3>
              <p className="co-sub">Start a session on this doc, then invite contacts. Everyone in it edits it with you and sees your edits as you type. Only the people you invite can read it: the relay passes it along sealed.</p>
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
              <div role="list" aria-label="Contacts">
                {c.contacts.map((ct, n) => (
                  <div key={ct.code} className="co-ct" role="listitem"><span className="nm">{ct.name}</span><span className="cd">{shortCode(ct.code)}</span>
                    <button ref={n === 0 ? first : undefined} className="lv-inv-btn" onClick={() => void liveActions.invite?.(ct)}>Invite</button></div>
                ))}
              </div>
            ) : <p className="co-sub">No contacts yet. Swap pairing codes in Card sharing (command center) first.</p>}
          </section>
        )}

        <section className="co-sec" aria-label="Invites">
          <h3>Invites to you</h3>
          <Invites />
        </section>

        <div className="cf-btns"><button onClick={onClose}>Close</button></div>
      </div>
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
