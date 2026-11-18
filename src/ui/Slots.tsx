import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SvgIcon } from './icons';

type SlotInfo = { top: string | null; under: number };

/** Slots: "Open X into…" Slot 1, 2 or 3. Each shows the screen after the pick and what the file goes on top of. */
export function SlotAsk({ name, slots, done }: { name: string; slots: SlotInfo[]; done: (slot: number | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const doneRef = useRef(done); // the keys answer whichever question is showing
  doneRef.current = done;
  useLayoutEffect(() => {
    const first = slots.findIndex((s) => !s.top);
    (box.current?.children[first >= 0 ? first : 0] as HTMLElement | undefined)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const btns = [...(box.current?.children ?? [])] as HTMLElement[];
      if (e.key === 'Escape') doneRef.current(null);
      else if (['1', '2', '3'].includes(e.key)) doneRef.current(Number(e.key) - 1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') btns[(btns.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]?.focus();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) done(null); }}>
      <div className="cf slot-ask" role="dialog" aria-modal="true" aria-labelledby="slot-t">
        <h2 id="slot-t">Open <b>{name}</b> into…</h2>
        <div ref={box} className="slot-btns">
          {slots.map((s, i) => (
            <button key={i} className="slot-b" onClick={() => done(i)}>
              <span className="slot-h"><span>Slot {i + 1}</span><kbd>{i + 1}</kbd></span>
              <span className="slot-mini" aria-hidden="true">{slots.map((o, k) => (o.top || k === i) && <i key={k} data-hit={k === i || undefined} />)}</span>
              <span className="slot-nm" data-empty={!s.top || undefined}>{s.top ? `On top of ${s.top}${s.under ? ` +${s.under}` : ''}` : 'Empty'}</span>
            </button>
          ))}
        </div>
        <div className="cf-btns"><button onClick={() => done(null)}>Cancel</button></div>
      </div>
    </div>
  );
}

/** Slots: the button by a slot's name, "⌄ 3": its files, top first. Pick one to bring it to the top, or close it. */
export function SlotStack({ files, onPick, onClose }: { files: { id: number; name: string }[]; onPick: (id: number) => void; onClose: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); };
  }, [open]);
  return (
    <span ref={ref} className="pane-stk">
      <button className="stk-b" aria-haspopup="menu" aria-expanded={open} title="Files in this slot" aria-label={`${files.length} files in this slot`} onClick={() => setOpen((o) => !o)}>
        <SvgIcon name="caret" />{files.length}
      </button>
      {open && (
        <div className="pop menu in stk-menu" role="menu" aria-label="Files in this slot">
          {files.map((f, i) => (
            <div key={f.id} className="stk-r" data-top={i === 0 || undefined}>
              <button className="mn-i" role="menuitem" onClick={() => { setOpen(false); onPick(f.id); }}><span>{f.name}</span></button>
              <button className="stk-x" aria-label={`Close ${f.name}`} onClick={() => onClose(f.id)}><SvgIcon name="x" /></button>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
