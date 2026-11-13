import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Received } from '../collab/service';
import { CardsPane, RelayUsage, linkLine, useCollab, useEsc } from './Collab';
import type { Ask } from './Confirm';
import { LivePane } from './Live';
import { RelayGuide } from './RelayGuide';
import './collab.css';

/**
 * Sharing: card sharing and live editing in one dialog, a Cards | Live switch under the title. The relay's line sits
 * and what's left of its free day sit above both tabs; each tab is the panel it was. Esc or a click outside closes it.
 */
export type ShareTab = 'cards' | 'live';
const TABS: { id: ShareTab; label: string }[] = [{ id: 'cards', label: 'Cards' }, { id: 'live', label: 'Live' }];

export function SharingPanel(props: {
  tab: ShareTab | null;
  onTab: (t: ShareTab) => void;
  onClose: () => void;
  flash: (m: string) => void;
  confirm: (a: Omit<Ask, 'done'>) => Promise<boolean>;
  onInsert: (c: Received) => string | null;
  onCopy: (c: Received) => Promise<boolean>;
  docName: string;
}) {
  const s = useCollab();
  const { tab, onTab, onClose } = props;
  const [, tick] = useState(0);
  const [guide, setGuide] = useState(false); // the relay guide, from Update relay: it updates the relay in place
  // a tab picked on the switch leaves focus on the switch; opened onto a tab (or sent to one), its first button takes it
  const picked = useRef(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEsc(tab !== null && !guide, onClose); // the guide answers its own Esc
  useLayoutEffect(() => { picked.current = false; }, [tab]);
  // the retry countdown in the relay's line
  useEffect(() => { if (tab === null) return; const t = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(t); }, [tab === null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (tab === null) return null;

  const pick = (t: ShareTab) => { if (t === tab) return; picked.current = true; onTab(t); };
  const onKey = (e: React.KeyboardEvent) => {
    const at = TABS.findIndex((t) => t.id === tab);
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const i = (to + TABS.length) % TABS.length;
    pick(TABS[i].id);
    tabs.current[i]?.focus();
  };
  const focus = !picked.current;
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`cf co co-sh${tab === 'live' ? ' co-live' : ''}`} role="dialog" aria-modal="true" aria-labelledby="sh-t">
        <h2 id="sh-t" tabIndex={-1}>Sharing</h2>
        <div className="sh-sw" role="tablist" aria-label="Sharing" data-tab={tab} onKeyDown={onKey}>
          <i aria-hidden="true" />
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { tabs.current[i] = el; }} id={`sh-${t.id}`} role="tab" aria-selected={t.id === tab} aria-controls="sh-pane"
              tabIndex={t.id === tab ? 0 : -1} onClick={() => pick(t.id)}>{t.label}</button>
          ))}
        </div>
        <p className="co-line" role="status">{linkLine(s)}</p>
        <RelayUsage onUpdate={() => setGuide(true)} />
        <div id="sh-pane" role="tabpanel" aria-labelledby={`sh-${tab}`}>
          {tab === 'cards'
            ? <CardsPane focus={focus} onClose={onClose} flash={props.flash} confirm={props.confirm} onInsert={props.onInsert} onCopy={props.onCopy} />
            : <LivePane focus={focus} docName={props.docName} />}
        </div>
        <div className="cf-btns"><button onClick={onClose}>Close</button></div>
      </div>
      {guide && createPortal(<RelayGuide onClose={() => setGuide(false)} />, document.body)}
    </div>
  );
}
