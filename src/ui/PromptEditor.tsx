import { useLayoutEffect, useRef, useState } from 'react';
import { BUILT_IN_PROMPT } from '../editor/ai-cite';
import { keyText } from '../editor/keybinds';

/** What's being edited: an existing preset by id, or a new one (`id` null) starting from `prompt`. */
export type PromptEdit = { id: string | null; name: string; prompt: string; placeholder: string };

/** The full-size editor for an AI cite-creator prompt, like CardMirror's Edit prompt window. Nothing saves until Save. */
export function PromptEditor({ edit, onSave, onClose }: { edit: PromptEdit; onSave: (name: string, prompt: string) => void; onClose: () => void }) {
  const [name, setName] = useState(edit.name);
  const [prompt, setPrompt] = useState(edit.prompt);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const save = () => onSave(name, prompt);
  useLayoutEffect(() => {
    areaRef.current?.focus();
    areaRef.current?.setSelectionRange(0, 0);
    // Esc closes this window only, not Settings behind it
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf pe" role="dialog" aria-modal="true" aria-labelledby="pe-t" data-own-esc
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}>
        <h2 id="pe-t">{edit.id ? 'Edit prompt' : 'New prompt preset'}</h2>
        <p className="pe-note">
          This is what the AI is told before the citation you selected, so it sets your cite style. <code>{'{DATE}'}</code> becomes
          today&apos;s date (M-D-YYYY). End it with the <code>[[CITE]]</code> … <code>[[TOKENS]]</code> … <code>[[END]]</code> block
          like the built-in prompt does: the lines under <code>[[TOKENS]]</code> are what gets the cite mark. A prompt without the
          block still works, but nothing gets marked.
        </p>
        <label className="pe-lab">Preset name
          <input className="st-text" aria-label="Preset name" spellCheck={false} maxLength={40} placeholder={edit.placeholder} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <textarea ref={areaRef} className="pe-area" aria-label="Preset prompt" spellCheck={false} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="cf-btns">
          <button className="pe-left" onClick={() => setPrompt(BUILT_IN_PROMPT)} title="Put Falcon's built-in prompt in the box, to start over from it">Use built-in prompt</button>
          <button onClick={onClose}>Cancel</button>
          <button className="pe-save" onClick={save} title={`Save (${keyText('Mod-Enter')})`}>Save</button>
        </div>
      </div>
    </div>
  );
}
