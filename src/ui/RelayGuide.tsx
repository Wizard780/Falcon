import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { checkRelayPatiently, checkRooms } from '../collab/relay';
import { P, pref, setPref } from '../editor/prefs';
import { IS_MAC } from '../editor/keybinds';
import { SvgIcon } from './icons';
import './collab.css';

/** What the Relay box saves for what was typed: an address without http(s):// gets https://. */
export const relayAddress = (typed: string) => { const u = typed.trim(); return !u || /^https?:\/\//i.test(u) ? u : `https://${u}`; };

/** A line to paste into the terminal, with its own Copy. */
function Cmd({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rg-cmd">
      <code>{text}</code>
      <button onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}>
        <SvgIcon name="copy" />{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const Link = ({ href, children }: { href: string; children: ReactNode }) => <a className="rg-link" href={href} target="_blank" rel="noreferrer">{children}</a>;

export const WAITING = 'A new address can take a few minutes to come online. Falcon is still trying. Leave this open';
const WORKS = 'It works. Falcon is connected and saved the address. Card sharing and live editing are ready';

/** The last step: paste the address, and Falcon checks a relay answers there before saving it. */
function Connect() {
  const [url, setUrl] = useState(pref(P.relayUrl));
  const [note, setNote] = useState<{ text: string; bad?: boolean; busy?: boolean } | null>(null);
  // the check in flight, which keeps trying a new address for a while: a newer one, an edit or closing the guide stops it
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);
  const check = async () => {
    const u = relayAddress(url);
    if (!u) { setNote({ text: 'Paste the address wrangler printed first', bad: true }); return; }
    const mine = ++run.current, gone = () => mine !== run.current;
    setNote({ text: 'Checking…', busy: true });
    const r = await checkRelayPatiently(u, gone, () => setNote({ text: WAITING }));
    if (r === null) return;
    if (r === 'ok') {
      setPref(P.relayUrl, u); setUrl(u);
      // only a relay that says it has no rooms is an old one: a hiccup on this second request is not
      const rooms = await checkRooms(u);
      if (gone()) return;
      setNote(rooms === 'no_rooms' ? { bad: true, text: 'It works for card sharing, and Falcon saved the address. But this relay is from before live editing: download it again and redeploy it (steps 5 to 7)' }
        : { text: WORKS });
    }
    else setNote({ bad: true, text: r === 'unreachable'
      ? "Couldn't reach it for 10 minutes. Check the address is the one ending in .workers.dev, and that npx wrangler deploy finished"
      : "Something answered, but it isn't a Falcon relay. Check you copied the whole address" });
  };
  return (
    <>
      <div className="rg-row">
        <input className="co-in" aria-label="Relay address" spellCheck={false} maxLength={200} placeholder="https://falcon-relay.you.workers.dev" data-first=""
          value={url} onChange={(e) => { run.current++; setUrl(e.target.value); setNote(null); }} onKeyDown={(e) => { if (e.key === 'Enter') void check(); }} />
        <button className="co-main" disabled={!!note?.busy} onClick={() => void check()}>Check and save</button>
      </div>
      <p className="rg-note" data-bad={note?.bad || undefined} role="status">{note?.text}</p>
      <p>Your pairing code now carries this relay, so teammates don't paste it. Each of them sets up a relay of their own with this guide (or uses one your team shares), and then you swap pairing codes in Card sharing.</p>
    </>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  { title: 'Set up card sharing', body: <>
    <p>Sending cards and live editing need a relay: a tiny server where a card waits, sealed, until the other person's Falcon picks it up, and that passes live edits between the people in a session. It can't read either.</p>
    <p>You set one up once, on Cloudflare's free plan, and your pairing code carries its address, so people reach you from their own relays and each of you has your own free daily allowance. (A team can also share one.) It takes about 10 minutes.</p>
  </> },
  { title: 'Make a free Cloudflare account', body: <>
    <p><Link href="https://dash.cloudflare.com/sign-up">Sign up at dash.cloudflare.com</Link> and confirm your email.</p>
    <p>Don't add a payment method. With no card on file Cloudflare can never charge you: if the relay ever uses up a day's free allowance, sharing just pauses until midnight UTC.</p>
  </> },
  { title: 'Install Node.js', body: <>
    <p><Link href="https://nodejs.org/en/download">Download Node.js</Link> (the LTS version) and run the installer with its usual options.</p>
    <p>Already have it? Skip this step.</p>
  </> },
  { title: 'Open a terminal', body: IS_MAC
    ? <p>Press ⌘ Space, type <b>Terminal</b>, and press Return. A window opens where you can type commands. Keep it open for the next steps.</p>
    : <p>Press the Start button, type <b>cmd</b>, and press Enter to open Command Prompt. A window opens where you can type commands. Keep it open for the next steps.</p> },
  { title: 'Download the relay', body: <>
    <p>Copy each line into the terminal and press {IS_MAC ? 'Return' : 'Enter'}. Wait for one to finish before the next.</p>
    <Cmd text="npx --yes degit Wizard780/Falcon/relay falcon-relay" />
    <Cmd text="cd falcon-relay" />
    <Cmd text="npm ci" />
    <p>Trying again? The first line stops if a falcon-relay folder is already there. Delete that folder, then start over from the first line.</p>
    <p>Set up a relay before live editing came out? Do this step and the next two again (delete the old falcon-relay folder first). Running npx wrangler deploy in the old folder would put the same old relay back. Its address stays the same, and card sharing keeps working.</p>
  </> },
  { title: 'Sign in to Cloudflare', body: <>
    <Cmd text="npx wrangler login" />
    <p>Your browser opens a Cloudflare page. Click <b>Allow</b>, then come back to the terminal.</p>
  </> },
  { title: 'Put the relay online', body: <>
    <Cmd text="npx wrangler deploy" />
    <p>If it asks to register a workers.dev subdomain, answer yes and type any name, like your team's.</p>
    <p>When it's done it prints an address that ends in <b>.workers.dev</b>. Copy that address.</p>
  </> },
  { title: 'Connect Falcon', body: <Connect /> },
];

/** Settings' step-by-step guide to deploying a relay and connecting to it. Esc, Done or a click outside closes it. */
export function RelayGuide({ onClose }: { onClose: () => void }) {
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  // focus goes back to what opened the guide (the ?) when it closes
  useLayoutEffect(() => { const was = document.activeElement as HTMLElement | null; return () => was?.focus(); }, []);
  // each step starts on its box to type in (Connect's address), else on the dialog
  useLayoutEffect(() => { (box.current?.querySelector<HTMLElement>('[data-first]') ?? box.current)?.focus(); }, [at]);
  const step = STEPS[at], last = at === STEPS.length - 1;
  /** Tab and Shift-Tab go round the dialog's own controls, never out to Settings behind it */
  const trap = (e: React.KeyboardEvent) => {
    const all = [...box.current!.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input')];
    if (!all.length) return;
    const first = all[0], end = all[all.length - 1], on = document.activeElement;
    if (e.shiftKey && (on === first || on === box.current)) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && on === end) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* data-own-esc: App leaves Esc to this dialog instead of closing Settings under it */}
      <div ref={box} className="cf co rg" role="dialog" aria-modal="true" aria-labelledby="rg-t" tabIndex={-1} data-own-esc=""
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose(); } else if (e.key === 'Tab') trap(e); }}>
        <p className="co-sub">Step {at + 1} of {STEPS.length}</p>
        <h2 id="rg-t">{step.title}</h2>
        <div className="rg-body" key={at}>{step.body}</div>
        <div className="cf-btns">
          {at > 0 && <button onClick={() => setAt(at - 1)}>Back</button>}
          <button className="co-main" onClick={() => (last ? onClose() : setAt(at + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
