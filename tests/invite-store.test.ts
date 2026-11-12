import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const store = await import('../src/collab/store');
const inv = (n: number, from: string, joined?: boolean) => ({ id: `i${n}`, from, claimed: '', sentAt: n, gotAt: n, invite: { room: n.toString(16).padStart(64, '0'), key: 'k', doc: `Doc ${n}` }, ...(joined ? { joined } : {}) });

beforeEach(async () => {
  await new Promise<void>((r, j) => { const q = indexedDB.deleteDatabase('falcon-collab'); q.onsuccess = () => r(); q.onerror = () => j(q.error); });
});

describe('invites kept', () => {
  it('a joined invite stays listed, marked joined', async () => {
    await store.keepInvite(inv(1, 'x'));
    await store.markJoined('i1');
    expect((await store.loadInvites()).map((i) => [i.id, !!i.joined])).toEqual([['i1', true]]);
  });
  it("when full, a stranger's invite already joined goes before one still waiting", async () => {
    await store.keepInvite(inv(0, 'stranger-old')); // the oldest, still waiting
    for (let n = 1; n < store.MAX_INVITES; n++) await store.keepInvite(inv(n, `s${n}`));
    await store.markJoined('i5');
    await store.keepInvite(inv(99, 'new'));
    const ids = (await store.loadInvites()).map((i) => i.id);
    expect(ids).toHaveLength(store.MAX_INVITES);
    expect(ids).toContain('i0');
    expect(ids).not.toContain('i5');
  });
});
