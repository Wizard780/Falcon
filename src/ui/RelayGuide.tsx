import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { checkRelay } from '../collab/relay';
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

/** The last step: paste the address, and Falcon checks a relay answers there before saving it. */
function Connect() {
  const [url, setUrl] = useState(pref(P.relayUrl));
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const check = async () => {
    const u = relayAddress(url);
    if (!u) { setNote({ text: 'Paste the address wrangler printed first', bad: true }); return; }
    setNote({ text: 'Checking…' });
    const r = await checkRelay(u);
    if (r === 'ok') { setPref(P.relayUrl, u); setUrl(u); setNote({ text: "It works. Falcon is connected and saved the address. Card sharing is ready" }); }
    else setNote({ bad: true, text: r === 'unreachable'
      ? "Couldn't reach it. Check the address is the one ending in .workers.dev, and that npx wrangler deploy finished"
      : "Something answered, but it isn't a Falcon relay. Check you copied the whole address" });
  };
  return (
    <>
      <div className="rg-row">
        <input className="co-in" aria-label="Relay address" spellCheck={false} maxLength={200} placeholder="https://falcon-relay.you.workers.dev"
          value={url} onChange={(e) => { setUrl(e.target.value); setNote(null); }} onKeyDown={(e) => { if (e.key === 'Enter') void check(); }} />
        <button className="co-main" onClick={() => void check()}>Check and save</button>
      </div>
      {note && <p className="rg-note" data-bad={note.bad || undefined} role="status">{note.text}</p>}
      <p>Then send the address to your teammates. Each of them pastes it into Settings › Sharing › Relay. Nobody else has to do the steps before this one.</p>
    </>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  { title: 'Set up card sharing', body: <>
    <p>Sending cards needs a relay: a tiny server where a card waits, sealed, until the other person's Falcon picks it up. It can't read the cards.</p>
    <p>One person on your team sets it up, once, on Cloudflare's free plan. Everyone else just pastes its address. It takes about 10 minutes.</p>
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
    : <p>Press the Start button, type <b>PowerShell</b>, and press Enter. A window opens where you can type commands. Keep it open for the next steps.</p> },
  { title: 'Download the relay', body: <>
    <p>Copy each line into the terminal and press {IS_MAC ? 'Return' : 'Enter'}. Wait for one to finish before the next.</p>
    <Cmd text="npx --yes degit Wizard780/Falcon/relay falcon-relay" />
    <Cmd text="cd falcon-relay" />
    <Cmd text="npm ci" />
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
  useLayoutEffect(() => { box.current?.focus(); }, [at]);
  const step = STEPS[at], last = at === STEPS.length - 1;
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* data-own-esc: App leaves Esc to this dialog instead of closing Settings under it */}
      <div ref={box} className="cf co rg" role="dialog" aria-modal="true" aria-labelledby="rg-t" tabIndex={-1} data-own-esc=""
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
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
