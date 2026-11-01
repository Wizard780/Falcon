import { useEffect, useRef } from 'react';
import { SvgIcon } from './icons';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
/** "Mod-Shift-8" as ⌘⇧8 on macOS, Ctrl+Shift+8 elsewhere. */
const keyLabel = (k: string) => (IS_MAC
  ? k.replace(/Mod-/g, '⌘').replace(/Ctrl-/g, '⌃').replace(/Alt-/g, '⌥').replace(/Shift-/g, '⇧')
  : k.replace(/Mod-/g, 'Ctrl+').replace(/Ctrl-/g, 'Ctrl+').replace(/Alt-/g, 'Alt+').replace(/Shift-/g, 'Shift+'));

const SHORTCUTS: [string, [string, string][]][] = [
  ['Card formatting', [
    ['F4', 'Pocket'], ['F5', 'Hat'], ['F6', 'Block'], ['F7', 'Tag'], ['Mod-F7', 'Analytic'], ['Mod-F8', 'Undertag'],
    ['F8', 'Cite'], ['Alt-F8', 'Copy previous cite'], ['F9', 'Underline'], ['F10', 'Emphasis'], ['F11', 'Highlight'],
    ['Mod-F11', 'Background color'], ['F12', 'Clear formatting'], ['Mod-8', 'Shrink card'], ['Mod-Shift-8', 'Undo shrink'],
    ['F2', 'Paste as plain text'], ['F3', 'Condense'], ['Shift-F3', 'Change case'],
  ]],
  ['Moving around', [
    ['PageUp', 'Previous heading'], ['PageDown', 'Next heading'], ['Mod-Alt-ArrowUp', 'Move card up'], ['Mod-Alt-ArrowDown', 'Move card down'],
    ['Mod-F', 'Find'], ['Mod-\\', 'Show or hide the outline'], ['Mod-Shift-R', 'Read mode'], ['Mod-Shift-D', 'Read marker'],
  ]],
  ['Files', [
    ['Mod-N', 'New document'], ['Mod-O', 'Open'], ['Mod-S', 'Save'], ['Mod-Shift-S', 'Save As'], ['Mod-W', 'Close document'],
    ['Ctrl-Tab', 'Next open document'], ['Ctrl-Shift-Tab', 'Previous open document'], ['Mod-T', 'Home'], ['Mod-,', 'Settings'],
    ['Mod-=', 'Zoom in'], ['Mod--', 'Zoom out'], ['Mod-0', 'Actual size'],
  ]],
];

/** Settings: the few preferences Falcon has, and every keyboard shortcut. */
export function Settings(props: {
  open: boolean; onClose: () => void;
  zoom: number; onZoom: (z: number) => void;
  speechMin: number; onSpeechMin: (m: number) => void;
  showOutline: boolean; onShowOutline: (s: boolean) => void;
  depth: number; onDepth: (d: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (props.open) ref.current?.focus({ preventScroll: true }); }, [props.open]);
  if (!props.open) return null;
  const step = (label: string, value: string, dec: () => void, inc: () => void) => (
    <span className="st-step">
      <button aria-label={`Less ${label}`} onClick={dec}>−</button><output>{value}</output><button aria-label={`More ${label}`} onClick={inc}>+</button>
    </span>
  );
  const zoomTo = (z: number) => props.onZoom(Math.max(0.5, Math.min(3, +z.toFixed(2))));
  return (
    <div className="st-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div ref={ref} className="st" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}>
        <div className="st-head"><h2>Settings</h2><button className="sb-ico" aria-label="Close settings" title="Close (Esc)" onClick={props.onClose}><SvgIcon name="x" /></button></div>
        <div className="st-body">
          <section>
            <h3>Page</h3>
            <div className="st-row"><span>Zoom</span>{step('zoom', `${Math.round(props.zoom * 100)}%`, () => zoomTo(props.zoom - 0.1), () => zoomTo(props.zoom + 0.1))}</div>
            <div className="st-row"><span>Speech timer</span>{step('time', `${props.speechMin}:00`, () => props.onSpeechMin(Math.max(1, props.speechMin - 1)), () => props.onSpeechMin(Math.min(30, props.speechMin + 1)))}</div>
          </section>
          <section>
            <h3>Outline</h3>
            <div className="st-row"><span>Show the outline</span>
              <button className="st-tog" role="switch" aria-checked={props.showOutline} aria-label="Show the outline" onClick={() => props.onShowOutline(!props.showOutline)}><i /></button>
            </div>
            <div className="st-row"><span>Levels shown</span>
              <span className="st-seg" role="group" aria-label="Outline levels">
                {['Pockets', 'Hats', 'Blocks', 'Tags'].map((n, i) => <button key={n} data-on={props.depth === i + 1 || undefined} onClick={() => props.onDepth(i + 1)}>{n}</button>)}
              </span>
            </div>
          </section>
          <section>
            <h3>Keyboard shortcuts</h3>
            {SHORTCUTS.map(([group, keys]) => (
              <div key={group} className="st-keys">
                <h4>{group}</h4>
                {keys.map(([k, what]) => <div key={k} className="st-key"><span>{what}</span><kbd>{keyLabel(k).replace('ArrowUp', '↑').replace('ArrowDown', '↓')}</kbd></div>)}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
