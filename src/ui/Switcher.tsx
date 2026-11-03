import { useLayoutEffect, useRef } from 'react';
import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { schema } from '../editor/schema';
import { norm } from '../editor/keybinds';
import './switcher.css';

export type Mod = 'ctrlKey' | 'metaKey' | 'altKey';
/** The keys to keep holding for the switcher to stay up: a binding's modifiers, less Shift (Shift turns it backward). */
export function holdMods(key: string): Mod[] {
  const parts = norm(key).split(/-(?!$)/).slice(0, -1);
  return ([['Meta', 'metaKey'], ['Ctrl', 'ctrlKey'], ['Alt', 'altKey']] as const).filter(([m]) => parts.includes(m)).map(([, f]) => f);
}
/** The open docs, most recently used first (the current one leads); docs never visited follow in tab order. */
export function recentOrder(ids: number[], mru: number[], current: number): number[] {
  const rank = (id: number) => (id === current ? -1 : mru.includes(id) ? mru.indexOf(id) : Infinity);
  return ids.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map((x) => x.id);
}

export type SwitchDoc = { id: number; name: string; dirty: boolean; doc: PMNode; top: number };

/** The page as you left it: its blocks from the first one that was on screen, drawn small. */
function Peek({ doc, top }: { doc: PMNode; top: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const ser = DOMSerializer.fromSchema(schema), out = document.createDocumentFragment();
    const start = Math.min(doc.resolve(Math.min(top, doc.content.size)).index(0), Math.max(0, doc.childCount - 1));
    for (let i = start; i < Math.min(doc.childCount, start + 24); i++) out.append(ser.serializeNode(doc.child(i)));
    ref.current?.replaceChildren(out);
  }, [doc, top]);
  return <div className="sw-pg" aria-hidden><div ref={ref} className="sw-doc ProseMirror" /></div>;
}

/** Ctrl-Tab: the open docs with a preview of each, most recent first. Releasing the held keys opens the lit one. */
export function Switcher(props: { docs: SwitchDoc[]; sel: number; onHover: (i: number) => void; onPick: (i: number) => void; onCancel: () => void }) {
  return (
    <div className="sw-back" onPointerDown={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div className="sw" role="listbox" aria-label="Open documents, most recent first">
        {props.docs.map((d, i) => (
          <div key={d.id} className="sw-it" role="option" aria-selected={i === props.sel} data-on={i === props.sel || undefined}
            onPointerEnter={() => props.onHover(i)} onPointerDown={(e) => { e.preventDefault(); props.onPick(i); }}>
            <Peek doc={d.doc} top={d.top} />
            <div className="sw-nm"><span>{d.name}</span>{d.dirty && <i aria-label="unsaved" />}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
