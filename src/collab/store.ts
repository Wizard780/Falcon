/**
 * Card sharing's saved state, all in one IndexedDB database: the identity (its private key as a
 * non-extractable CryptoKey, which IndexedDB can hold and localStorage can't), the display name,
 * contacts, and cards that came in. The same path in Electron and the web build. None of it is a
 * setting: Export settings and Restore defaults leave it alone.
 */
import { makeIdentity, type Identity, type Invite } from './crypto';

export type Contact = { code: string; name: string };
/** A card that came in: who sent it (their code), what they call themselves, and the card itself. */
export type Received = { id: string; from: string; claimed: string; sentAt: number; gotAt: number; label: string; content: unknown[]; /** this Falcon can't open it (a newer Falcon's card): it can only be dismissed */ unreadable?: boolean };

/** An invite to a live-editing session that came in: who sent it (their code), what they call themselves, the room. */
export type Invited = { id: string; from: string; claimed: string; sentAt: number; gotAt: number; invite: Invite };
/** Invites kept at most (the newest); one per room. */
export const MAX_INVITES = 20;

const NAME = 'falcon-collab';
const GONE_KEEP = 300; // ids of cards dismissed or inserted, so one delivered twice isn't shown twice
/** Cards waiting, at most. Past it they stay on the relay (which holds 50 more, then turns senders away),
 *  so a stranger with the code can't fill this disk. */
export const MAX_WAITING = 50;
/** keepCard's refusal when MAX_WAITING are waiting. */
export class InboxFull extends Error {}

/** WebCrypto (a secure page: https, localhost or the app) and IndexedDB are both here. */
export const storeAvailable = () => typeof indexedDB !== 'undefined' && !!globalThis.crypto?.subtle;

let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const q = indexedDB.open(NAME, 1);
    q.onupgradeneeded = () => { q.result.createObjectStore('meta'); q.result.createObjectStore('cards', { keyPath: 'id' }); };
    q.onsuccess = () => { q.result.onversionchange = () => { q.result.close(); opened = null; }; resolve(q.result); };
    q.onerror = () => reject(q.error);
    q.onblocked = () => reject(new Error('blocked'));
  }).catch((e) => { opened = null; throw e; });
  return opened;
}

/** Run `f` in one transaction; resolves with its result once the transaction has committed (is on disk). */
async function tx<T>(stores: string[], mode: IDBTransactionMode, f: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  // strict: complete means flushed to disk, which is what lets the relay forget a card
  const t = (await db()).transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
  const r = f(t);
  return new Promise<T>((resolve, reject) => {
    t.oncomplete = () => resolve(r ? r.result : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('aborted'));
  });
}
const get = <T>(key: string) => tx<T | undefined>(['meta'], 'readonly', (t) => t.objectStore('meta').get(key));
const put = (key: string, value: unknown) => tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put(value, key); });

/** This install's identity, made on first use. Two windows racing to make it keep whichever was saved first. */
export async function identity(): Promise<Identity> {
  const have = await get<Identity>('identity');
  if (have) return have;
  const fresh = await makeIdentity();
  return tx<Identity>(['meta'], 'readwrite', (t) => {
    const s = t.objectStore('meta');
    const q = s.get('identity');
    q.onsuccess = () => { if (!q.result) s.put(fresh, 'identity'); };
    return q as IDBRequest<Identity>;
  }).then((saved) => saved ?? fresh);
}
/** A new code: the old one stops working (cards sent to it never arrive). */
export async function regenerate(): Promise<Identity> {
  const fresh = await makeIdentity();
  await put('identity', fresh);
  return fresh;
}

export const loadName = async () => (await get<string>('name')) ?? '';
export const saveName = (name: string) => put('name', name);
export const loadContacts = async () => (await get<Contact[]>('contacts')) ?? [];
/** The code last copied from the panel (see service gaveCode). */
export const loadGave = async () => (await get<string>('gave')) ?? '';
export const saveGave = (code: string) => put('gave', code);
export const saveContacts = (list: Contact[]) => put('contacts', list);

export const loadCards = () => tx<Received[]>(['cards'], 'readonly', (t) => t.objectStore('cards').getAll() as IDBRequest<Received[]>).then((l) => l.sort((a, b) => a.gotAt - b.gotAt));

/** Keep a card that came in. Resolves once it is saved, which is when the relay may forget it. False: already had it.
 *  Rejects with InboxFull when MAX_WAITING are waiting: the card stays on the relay. */
export async function keepCard(card: Received): Promise<boolean> {
  let added = false, full = false;
  await tx(['meta', 'cards'], 'readwrite', (t) => {
    const gone = t.objectStore('meta').get('gone');
    gone.onsuccess = () => {
      if ((gone.result as string[] | undefined)?.includes(card.id)) return;
      const cards = t.objectStore('cards');
      const had = cards.getKey(card.id);
      had.onsuccess = () => {
        if (had.result !== undefined) return;
        const n = cards.count();
        n.onsuccess = () => { if (n.result >= MAX_WAITING) full = true; else { cards.put(card); added = true; } };
      };
    };
  });
  if (full) throw new InboxFull();
  return added;
}
/** Done with a card (inserted or dismissed). */
export const dropCard = (id: string) => tx(['meta', 'cards'], 'readwrite', (t) => {
  t.objectStore('cards').delete(id);
  const meta = t.objectStore('meta'), gone = meta.get('gone');
  gone.onsuccess = () => meta.put([...((gone.result as string[] | undefined) ?? []).filter((x) => x !== id), id].slice(-GONE_KEEP), 'gone');
});

export const loadInvites = async () => (await get<Invited[]>('invites')) ?? [];
/** Keep an invite that came in. Resolves once saved (then the relay may forget it); false: had it already, or it was dismissed. */
export async function keepInvite(inv: Invited): Promise<boolean> {
  let added = false;
  await tx(['meta'], 'readwrite', (t) => {
    const meta = t.objectStore('meta'), gone = meta.get('gone');
    gone.onsuccess = () => {
      if ((gone.result as string[] | undefined)?.includes(inv.id)) return;
      const have = meta.get('invites');
      have.onsuccess = () => {
        const list = (have.result as Invited[] | undefined) ?? [];
        if (list.some((x) => x.id === inv.id)) return;
        // a newer invite to the same room takes the older one's place
        meta.put([...list.filter((x) => x.invite.room !== inv.invite.room), inv].slice(-MAX_INVITES), 'invites');
        added = true;
      };
    };
  });
  return added;
}
/** Done with an invite (joined or dismissed): it isn't shown again if the relay delivers it twice. */
export const dropInvite = (id: string) => tx(['meta'], 'readwrite', (t) => {
  const meta = t.objectStore('meta'), have = meta.get('invites'), gone = meta.get('gone');
  have.onsuccess = () => meta.put(((have.result as Invited[] | undefined) ?? []).filter((x) => x.id !== id), 'invites');
  gone.onsuccess = () => meta.put([...((gone.result as string[] | undefined) ?? []).filter((x) => x !== id), id].slice(-GONE_KEEP), 'gone');
});
