import { useEffect, useRef } from 'react';

/** A question for the user. `done` gets true for the `ok` button, false for Cancel, Esc or a backdrop click. */
export type Ask = { title: string; body: string; ok: string; done: (yes: boolean) => void };

/** Falcon's own warning dialog, in place of the OS alert. Cancel has focus, so Enter never loses work. */
export function Confirm({ ask }: { ask: Ask | null }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
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
