import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SaveMode } from '../editor/save-modes';
import { speechFileName } from './files';

const MODES: { mode: SaveMode; label: string; hint: string }[] = [
  { mode: 'asis', label: 'As-Is', hint: 'Everything in the document. The open file becomes this copy.' },
  { mode: 'send', label: 'Send Doc', hint: 'Without analytics and undertags, for the other team.' },
  { mode: 'read', label: 'Read Doc', hint: 'Only what read mode shows: headings, tags, cites and highlights.' },
  { mode: 'marked', label: 'Marked Doc', hint: 'Only the cards you marked (turned red).' },
];

/** Save As: a name, then one of four kinds of copy. Enter saves As-Is; Esc or a backdrop click cancels. */
export function SaveAs({ name, onSave, onClose }: { name: string | null; onSave: (mode: SaveMode, name: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (name === null) return;
    setValue(`${name}.docx`);
    // the name is selected without its extension, so typing replaces just the name
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(0, name.length); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [name, onClose]);
  if (name === null) return null;
  const base = value.trim().replace(/\.docx$/i, '').trim() || name;
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf sa" role="dialog" aria-modal="true" aria-labelledby="sa-t">
        <h2 id="sa-t">Save As</h2>
        <input ref={inputRef} className="sa-name" aria-label="File name" spellCheck={false} value={value}
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave('asis', base); } }} />
        <div className="sa-modes">
          {MODES.map((m) => (
            <button key={m.mode} className="sa-mode" data-mode={m.mode} onClick={() => onSave(m.mode, base)}>
              <b>{m.label}</b><span>{m.hint}</span>
            </button>
          ))}
        </div>
        <div className="cf-btns"><button onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

/** New speech doc: type the speech's name (1NC, 2AC…), and the file is named from Settings' template. Enter makes it; Esc cancels. */
export function NewSpeech({ open, onMake, onClose }: { open: boolean; onMake: (speech: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // a layout effect: focus and Esc are live as soon as the dialog is in the page, so keys pressed
  // straight after the shortcut aren't lost
  useLayoutEffect(() => {
    if (!open) return;
    setValue('');
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf sa" role="dialog" aria-modal="true" aria-labelledby="ns-t">
        <h2 id="ns-t">New Speech Doc</h2>
        <input ref={inputRef} className="sa-name" aria-label="Speech name" placeholder="1NC, 2AC, 1AR…" spellCheck={false} maxLength={80} value={value}
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onMake(value.trim()); } }} />
        <p className="ns-file">Saves as <b>{speechFileName(value)}.docx</b></p>
        <div className="cf-btns"><button onClick={onClose}>Cancel</button><button onClick={() => onMake(value.trim())}>Create</button></div>
      </div>
    </div>
  );
}
