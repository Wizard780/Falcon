/**
 * What the screens show of live editing, and the actions they call. Loaded with the app; the session itself
 * (live.ts, with the CRDT) loads only when one starts. App (ui/Live.tsx useLive) fills both in.
 */
import type { LiveStatus, Member } from './live';
import type { Contact, Invited } from './service';

export type LiveInfo = {
  /** the open doc the session is on (null while joining: the doc opens once it has come in) */
  docId: number | null;
  room: string;
  doc: string;
  status: LiveStatus;
  me: { name: string; color: string };
  members: Member[];
  /** this Falcon started the session */
  hosting: boolean;
} | null;

/** Someone whose last edit came in this long ago is typing now. */
export const TYPING_MS = 3_000;

let info: LiveInfo = null;
const subs = new Set<() => void>();
export const liveInfo = () => info;
export const subscribeLive = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setLiveInfo(next: LiveInfo) { info = next; for (const f of subs) f(); }

export const liveActions: {
  /** start a session on the open doc */
  start?: () => void;
  /** leave the session (the doc stays open as it is) */
  stop?: () => void;
  /** end it for everyone (each keeps the doc as it is) */
  end?: () => Promise<void>;
  /** ask one person (Loro peer id) to leave */
  remove?: (peer: string) => void;
  invite?: (c: Contact) => Promise<void>;
  join?: (i: Invited) => void;
  /** open the Live editing panel */
  open?: () => void;
} = {};
