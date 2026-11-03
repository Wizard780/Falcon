import { useEffect, useLayoutEffect, useRef } from 'react';

/** A question for the user. `done` gets true for the `ok` button, false for Cancel, Esc or a backdrop click. */
export type Ask = { title: string; body: string; ok: string; done: (yes: boolean) => void };

/** Falcon's own warning dialog, in place of the OS alert. Cancel has focus, so Enter never loses work. */
export function Confirm({ ask }: { ask: Ask | null }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!ask) return;
    cancelRef.current?.focus();
    // Esc cancels wherever focus is, even after a click on the dialog's text
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ask.done(false); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [ask]);
  if (!ask) return null;
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) ask.done(false); }}>
      <div className="cf" role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-b">
        <h2 id="cf-t">{ask.title}</h2>
        <p id="cf-b">{ask.body}</p>
        <div className="cf-btns">
          <button ref={cancelRef} onClick={() => ask.done(false)}>Cancel</button>
          <button className="cf-ok" onClick={() => ask.done(true)}>{ask.ok}</button>
        </div>
      </div>
    </div>
  );
}

/** "Aff", "Aff and Neg", "Aff, Neg and Blocks", "Aff, Neg and 2 more". */
export function nameList(names: string[]) {
  if (names.length <= 1) return names[0] ?? '';
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** A choice between several answers, each a button; `done` gets the picked value, or null for Esc. The first button has focus. */
export type Choose<T extends string> = { title: string; body: string; items?: string[]; options: { label: string; value: T; hint?: string }[]; done: (v: T | null) => void };
export function Chooser<T extends string>({ ask }: { ask: Choose<T> | null }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!ask) return;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ask.done(null); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [ask]);
  if (!ask) return null;
  return (
    <div className="cf-back">
      <div className="cf ch" role="alertdialog" aria-modal="true" aria-labelledby="ch-t" aria-describedby="ch-b">
        <h2 id="ch-t">{ask.title}</h2>
        <p id="ch-b">{ask.body}</p>
        {ask.items && <ul className="cf-list">{ask.items.map((t, i) => <li key={i}>{t}</li>)}</ul>}
        <div className="cf-btns">
          {ask.options.map((o, i) => <button key={o.value} ref={i === 0 ? firstRef : undefined} title={o.hint} onClick={() => ask.done(o.value)}>{o.label}</button>)}
        </div>
      </div>
    </div>
  );
}
