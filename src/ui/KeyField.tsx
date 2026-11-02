import { useEffect, useState, type KeyboardEvent } from 'react';
import { bindingOf, heldMods, keyOf, keyParts, keyText, recordKey, refusal, resetKey, setKey, setRecording } from '../editor/keybinds';
import { SvgIcon } from './icons';

export type KeyNote = { id: string; text: string; bad?: boolean } | null;

/**
 * A shortcut in Settings > Keybindings, shown as its keys. Click it and press the new keys: modifiers show
 * as they go down, Esc cancels, Backspace or Delete alone removes the shortcut, and keys Falcon can't take
 * shake and say why (through `onNote`, which Settings shows under the row's label). The arrow puts the
 * default back.
 */
export function KeyField({ id, label, onNote }: { id: string; label: string; onNote: (n: KeyNote) => void }) {
  const [listening, setListening] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [anim, setAnim] = useState<{ kind: 'shake' | 'bob'; n: number } | null>(null);
  useEffect(() => () => setRecording(false), []);
  const key = keyOf(id);
  const def = bindingOf(id)?.key ?? '';

  const stop = () => { setListening(false); setHeld([]); setRecording(false); };
  const start = () => {
    setListening(true); setRecording(true);
    onNote({ id, text: 'Press the new keys. Esc cancels, Backspace removes the shortcut.' });
  };
  const play = (kind: 'shake' | 'bob') => setAnim((a) => ({ kind, n: (a?.n ?? 0) + 1 }));
  const onKeyDown = (e: KeyboardEvent) => {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (e.key === 'Escape') { stop(); onNote(null); return; }
    if (plain && (e.key === 'Backspace' || e.key === 'Delete')) { setKey(id, ''); stop(); onNote(null); return; }
    const k = recordKey(e.nativeEvent);
    if (!k) { setHeld(heldMods(e.nativeEvent)); return; }
    const why = refusal(id, k);
    stop();
    if (why) { play('shake'); onNote({ id, text: why, bad: true }); return; }
    setKey(id, k); play('bob'); onNote(null);
  };

  const shown = keyParts(listening ? held.join('-') : key);
  return (
    <span className="st-keyf">
      {key !== def && (
        <button className="st-keyreset" title={`Back to ${def ? keyText(def) : 'no shortcut'}`} aria-label={`Reset ${label} to ${def ? keyText(def) : 'no shortcut'}`}
          onClick={() => { resetKey(id); onNote(null); }}><SvgIcon name="undo" /></button>
      )}
      <button className="st-kbd st-keyb" data-listen={listening || undefined} data-empty={!shown.length || undefined}
        aria-label={`${label}: ${key ? keyText(key) : 'no shortcut'}. Change shortcut`} aria-pressed={listening}
        onClick={() => { if (!listening) start(); }} onKeyDown={onKeyDown}
        onKeyUp={(e) => { if (listening) { e.preventDefault(); setHeld(heldMods(e.nativeEvent)); } }}
        onBlur={() => { if (listening) { stop(); onNote(null); } }}>
        <span className="st-keys" key={anim?.n ?? 0} data-anim={anim?.kind}>
          {shown.map((c, i) => <kbd key={i} style={{ animationDelay: `${i * 40}ms` }}>{c}</kbd>)}
          {listening ? <span className="st-keytype"><i />{held.length ? '' : 'Type a shortcut'}</span> : !shown.length && <span className="st-keytype">Set shortcut</span>}
        </span>
      </button>
    </span>
  );
}
