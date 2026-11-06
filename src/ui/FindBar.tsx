import { IS_MAC, titled } from '../editor/keybinds';
import { useEffect, useState, type RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import { clearFind, findInfo, findRequest, replaceAll, replaceOne, setGrouped, setQuery, step } from '../editor/find';
import { readSetting } from '../editor/tools';
import { onPrefs } from '../editor/prefs';
import { findOrderSetting } from '../editor/nav-keys';
import { Icon, SvgIcon } from './icons';
import './outline.css';

/** Find (Mod-F), Find and Replace (Mod-Shift-H, Ctrl-H on Windows), and find by position (Alt-F). */
export function FindBar({ view, inputRef, onClose, flash }: { view: EditorView; inputRef: RefObject<HTMLInputElement | null>; onClose: () => void; flash: (m: string) => void }) {
  const [replace, setReplace] = useState(false);
  const [grouped, setGroupedState] = useState(() => readSetting(findOrderSetting) === 'grouped');
  const [with_, setWith] = useState('');
  useEffect(() => onPrefs(() => setGroupedState(readSetting(findOrderSetting) === 'grouped')), []); // Import settings or Restore defaults
  // a key asked for the replace row or position order: take the request (now, and while open)
  useEffect(() => {
    const take = () => {
      if (findRequest.replace) setReplace(true);
      if (findRequest.byPosition) order(false);
      Object.assign(findRequest, { replace: undefined, byPosition: undefined });
    };
    take();
    addEventListener('falcon-find', take);
    return () => removeEventListener('falcon-find', take);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const order = (g: boolean) => { setGroupedState(g); setGrouped(view, g); };
  const close = () => { clearFind(view); onClose(); view.focus(); };
  const f = findInfo(view.state);
  const count = f && f.query ? (f.matches.length ? `${f.index + 1}/${f.matches.length}` : 'No results') : '';
  const doAll = () => {
    const n = replaceAll(view, with_);
    flash(n < 0 ? 'An AI edit is working on some of those matches. Try again in a moment.' : n ? `Replaced ${n} ${n === 1 ? 'match' : 'matches'}` : 'Nothing to replace');
  };
  const keys = (e: React.KeyboardEvent, enter: (shift: boolean, mod: boolean) => void) => {
    if (e.key === 'Enter') { e.preventDefault(); enter(e.shiftKey, IS_MAC ? e.metaKey : e.ctrlKey); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  const btn = (title: string, on: () => void, child: React.ReactNode, cls?: string, pressed?: boolean) => (
    <button className={cls} title={title} aria-label={title.replace(/[:(].*/, '').trim()} aria-pressed={pressed} onMouseDown={(e) => { e.preventDefault(); on(); }}>{child}</button>
  );
  return (
    <div className="findbar" data-replace={replace || undefined}>
      <div className="fb-row">
        <SvgIcon name="search" />
        <input ref={inputRef} placeholder="Find" defaultValue={f?.query ?? ''}
          onChange={(e) => setQuery(view, e.target.value, grouped)}
          onKeyDown={(e) => keys(e, (shift) => step(view, shift ? -1 : 1))} />
        <span className="count">{count}</span>
        {btn(grouped ? 'Grouped by type: headings, then tags, analytics, undertags, cites, then text. Click to go in order from the cursor' : 'In order from the cursor. Click to group by type',
          () => order(!grouped), grouped ? 'By type' : 'In order', 'fb-txt')}
        {btn('Previous (⇧Enter): go to the match above', () => step(view, -1), <Icon name="chevronUp" />)}
        {btn('Next (Enter): go to the match below', () => step(view, 1), <Icon name="chevron" />)}
        {btn(titled('Replace', 'replace', 'show the replace box'), () => { setReplace((r) => !r); if (!replace) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.findbar .fb-with')?.focus()); }, 'Replace', 'fb-txt', replace)}
        {btn('Close find (Esc)', close, <Icon name="x" />)}
      </div>
      {replace && (
        <div className="fb-row">
          <span className="fb-sp" />
          <input className="fb-with" placeholder="Replace with" value={with_} onChange={(e) => setWith(e.target.value)}
            onKeyDown={(e) => keys(e, (_s, mod) => (mod ? doAll() : replaceOne(view, with_)))} />
          {btn('Replace (Enter): replace this match and go to the next', () => replaceOne(view, with_), 'Replace', 'fb-txt')}
          {btn(`Replace all (${IS_MAC ? '⌘' : 'Ctrl+'}Enter): replace every match, one undo step`, doAll, 'All', 'fb-txt')}
        </div>
      )}
    </div>
  );
}
