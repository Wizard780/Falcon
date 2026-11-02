// What the update card shows from a release: its top changes, and how long ago it came out.

export type Note = { lead: string; rest: string };

const plain = (s: string) => s.replace(/\*\*|`/g, '').trim();

/** The release notes' top-level bullets under Added, Changed, Fixed and Notes (never Install): the first `max`, and how many more. */
export function releaseNotes(md: string, max = 3): { items: Note[]; more: number } {
  const all: Note[] = [];
  let on = false;
  for (const line of md.split(/\r?\n/)) {
    const h = /^#{1,3}\s+(.*)/.exec(line);
    if (h) { on = /^(added|changed|fixed|notes)\b/i.test(h[1].trim()); continue; }
    const b = on && /^[-*]\s+(.*)/.exec(line); // top level only: sub-bullets are indented
    if (!b) continue;
    const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(b[1]);
    all.push(m ? { lead: plain(m[1]), rest: plain(m[2]) } : { lead: '', rest: plain(b[1]) });
  }
  return { items: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** "just now", "5m ago", "2h ago", "3d ago", or the date. */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  if (m < 60 * 24 * 30) return `${Math.floor(m / 1440)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
