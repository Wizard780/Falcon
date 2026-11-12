import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { checkRelayPatiently, checkRooms } from '../collab/relay';
import { bridge, type RelaySetupResult } from '../editor/host';
import { P, pref, setPref } from '../editor/prefs';
import { IS_MAC } from '../editor/keybinds';
import { SvgIcon } from './icons';
import { chromeLook } from './theme';
import './collab.css';

/** What the Relay box saves for what was typed: an address without http(s):// gets https://. */
export const relayAddress = (typed: string) => { const u = typed.trim(); return !u || /^https?:\/\//i.test(u) ? u : `https://${u}`; };

/**
 * Cloudflare's page for making an API token, with what Falcon needs filled in (Cloudflare's token template link): edit
 * Workers scripts, which covers uploading the relay, its workers.dev subdomain and turning its address on, and read
 * Account Settings, without which the token can't see the account at all.
 */
export const TOKEN_PAGE = 'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys='
  + encodeURIComponent(JSON.stringify([{ key: 'workers_scripts', type: 'edit' }, { key: 'account_settings', type: 'read' }]))
  + '&accountId=%2A&zoneId=all&name=Falcon%20relay';

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
const ENTER = IS_MAC ? 'Return' : 'Enter';

export const WAITING = 'A new address can take a few minutes to come online. Falcon is still trying. Leave this open';
const WORKS = 'It works. Falcon is connected and saved the address. Card sharing and live editing are ready';
/** What opens Settings' recipients list on an add row (the guide's opener passes it), or null. */
const AddRecipient = createContext<(() => void) | null>(null);
/** After a working relay, the next thing to do: swap pairing codes, and add the person to Recipients. */
function Next() {
  const add = useContext(AddRecipient);
  return (
    <>
      <p>Next, swap pairing codes with each person you'll send cards to. Your code now carries this relay. Their code goes under Recipients, just below the relay in Settings &gt; Sharing. (Each of them sets up a relay of their own with this guide, or uses one your team shares.)</p>
      {add && <div className="rg-row"><button className="co-main" data-first="" onClick={add}><SvgIcon name="plus" />Add a recipient</button></div>}
    </>
  );
}

/** The last step by hand: paste the address, and Falcon checks a relay answers there before saving it. */
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
      {note && !note.bad && !note.busy && note.text !== WAITING ? <Next /> : <p>Your pairing code then carries this relay, so the people you swap codes with reach you from their own relays.</p>}
    </>
  );
}

/** What went wrong with Set up my relay, and what to do about it. */
function setupFailure(r: Extract<RelaySetupResult, { ok: false }>): string {
  switch (r.error) {
    case 'bad_token': return 'Cloudflare turned down that token. Make a new one with the link in step 3, copy all of it, and try again';
    case 'no_account': return "That token can't see your Cloudflare account. Make it again with the link in step 3, and keep both permissions it fills in";
    case 'many_accounts': return 'That token reaches more than one Cloudflare account. Make it again with the link in step 3, and under Account Resources pick the one to use';
    case 'verify_email': return 'Cloudflare wants you to confirm your email first. Click the link in the email Cloudflare sent you, then try again';
    case 'newer_relay': return 'Your relay was set up by a newer Falcon. Update Falcon, then try again';
    case 'no_subdomain': return "Cloudflare didn't give your account a workers.dev address. Try again in a minute";
    case 'offline': return "Couldn't reach Cloudflare. Check you're online, then try again";
    case 'busy': return 'Falcon is still finishing the last try. Wait a few seconds, then try again';
    case 'missing': return 'This copy of Falcon is missing the relay. Reinstall Falcon, or set it up by hand';
    case 'cloudflare': return r.said ? `Cloudflare said: ${r.said.replace(/\.$/, '')}. Try again, or set it up by hand` : 'Cloudflare turned it down. Try again, or set it up by hand';
    default: return 'Something went wrong. Try again, or set it up by hand';
  }
}

/** The steps Set up my relay goes through. The first four happen in the main process, the last one here. */
const ROWS = [['token', 'Getting the token'], ['account', 'Finding your Cloudflare account'], ['upload', 'Uploading the relay'], ['address', 'Turning on its address'], ['online', 'Checking it works']] as const;
type Row = typeof ROWS[number][0];
// a failure after the relay went up keeps its `url`: trying again then only checks again, with no new token
type Phase = { at: 'idle' } | { at: 'run'; row: Row; waiting?: boolean } | { at: 'bad'; row: Row; text: string; url?: string } | { at: 'done'; url: string };

/** The desktop's last step: Falcon makes the relay on the user's account, then checks it like Connect does and saves it. */
function SetUp({ byHand }: { byHand: () => void }) {
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });
  const run = useRef(0); // as in Connect: going Back or closing the guide drops a run's answer and stops its waiting
  useEffect(() => () => { run.current++; }, []);
  // the button that started a run goes away with it: keep focus in the dialog (so Esc and Tab stay its own), and
  // on the button again once there is one
  const mark = useRef<HTMLParagraphElement>(null), first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // the guide focuses the step when it opens
    const dialog = mark.current?.closest<HTMLElement>('.rg');
    (phase.at === 'run' ? dialog : dialog?.querySelector<HTMLElement>('[data-first]') ?? dialog)?.focus();
  }, [phase.at]);
  const go = async () => {
    const mine = ++run.current, gone = () => mine !== run.current;
    let row: Row = 'token';
    const at = (r: Row, waiting?: boolean) => { row = r; if (!gone()) setPhase({ at: 'run', row: r, waiting }); };
    let url = phase.at === 'bad' ? phase.url : undefined;
    if (!url) {
      at('token');
      const r: RelaySetupResult = await bridge.relaySetup!(chromeLook(), (s) => { if (ROWS.some(([k]) => k === s)) at(s as Row); })
        .catch(() => ({ ok: false, error: 'failed' }));
      if (gone()) return;
      if (!r.ok) { setPhase(r.error === 'cancelled' ? { at: 'idle' } : { at: 'bad', row, text: setupFailure(r) }); return; }
      url = r.url;
    }
    at('online');
    const c = await checkRelayPatiently(url, gone, () => at('online', true));
    if (c === null) return;
    if (c !== 'ok') {
      setPhase({ at: 'bad', row, url, text: c === 'unreachable' ? "The relay is on Cloudflare, but its address didn't come online in 10 minutes. Click Try again to keep checking"
        : 'Something else answered at the relay\'s address. Try again, or set it up by hand' });
      return;
    }
    setPref(P.relayUrl, url);
    setPhase({ at: 'done', url });
  };
  const now = phase.at === 'idle' ? -1 : phase.at === 'done' ? ROWS.length : ROWS.findIndex(([k]) => k === phase.row);
  return (
    <>
      {phase.at === 'idle'
        ? <p>Click <b>Set up my relay</b>, paste the token, and press {ENTER}. Falcon does the rest and shows you how it's going.</p>
        : <ol className="rg-steps" aria-label="Setting up your relay">
          {ROWS.map(([k, label], i) => {
            const st = i < now ? 'done' : i > now ? 'todo' : phase.at === 'bad' ? 'bad' : 'now';
            return <li key={k} data-st={st}><i>{st === 'done' ? <SvgIcon name="check" /> : st === 'now' ? <span className="co-spin" /> : null}</i>{label}</li>;
          })}
        </ol>}
      <p ref={mark} className="rg-note" data-bad={phase.at === 'bad' || undefined} role="status">
        {phase.at === 'bad' ? phase.text : phase.at === 'done' ? `It works. Your relay is at ${phase.url}, and Falcon saved it. Card sharing and live editing are ready`
          : phase.at === 'run' && phase.waiting ? WAITING : phase.at === 'run' && phase.row === 'token' ? 'Paste the token in the window that opened' : ''}
      </p>
      {phase.at === 'done'
        ? <><Next /><p>Falcon didn't keep the token. You can delete it in Cloudflare, under My Profile, then API Tokens.</p></>
        : <>
          {phase.at !== 'run' && <div className="rg-row"><button className="co-main" data-first="" onClick={() => void go()}>{phase.at === 'bad' ? 'Try again' : 'Set up my relay'}</button></div>}
          <p className="rg-alt">Rather use a terminal? <button className="rg-hand" onClick={byHand}>Set it up by hand</button></p>
        </>}
    </>
  );
}

type Step = { title: string; body: ReactNode };
const intro = (mine: boolean): Step => ({ title: 'Set up card sharing', body: <>
  <p>Sending cards and live editing need a relay: a tiny server where a card waits, sealed, until the other person's Falcon picks it up, and that passes live edits between the people in a session. It can't read either.</p>
  <p>{mine ? 'Falcon puts one on your own Cloudflare account, on the free plan.' : "You set one up once, on Cloudflare's free plan."} Your pairing code carries its address, so people reach you from their own relays and each of you has your own free daily allowance. (A team can also share one.) It takes about {mine ? 5 : 10} minutes.</p>
</> });
const ACCOUNT: Step = { title: 'Make a free Cloudflare account', body: <>
  <p><Link href="https://dash.cloudflare.com/sign-up">Sign up at dash.cloudflare.com</Link> and confirm your email. Cloudflare won't take a relay until you do.</p>
  <p>Don't add a payment method. With no card on file Cloudflare can never charge you: if the relay ever uses up a day's free allowance, sharing just pauses until midnight UTC.</p>
</> };

/** The desktop app's way: Falcon does the setting up through Cloudflare's API with a token the user makes. */
const BY_FALCON = (byHand: () => void): Step[] => [
  intro(true),
  ACCOUNT,
  { title: 'Make a token for Falcon', body: <>
    <p>A token lets Falcon put the relay on your account. It can only manage Workers (Cloudflare's small servers) and read your account settings. Falcon uses it once and then forgets it.</p>
    <p><Link href={TOKEN_PAGE}>Open Cloudflare's token page</Link>. Everything is filled in. Scroll down, click <b>Continue to summary</b>, then click <b>Create Token</b>.</p>
    <p>Cloudflare shows the token once. Click <b>Copy</b> beside it.</p>
  </> },
  { title: 'Set up your relay', body: <SetUp byHand={byHand} /> },
];

/** The terminal's way: the web build's only one, and the desktop's fallback. */
const BY_HAND: Step[] = [
  intro(false),
  ACCOUNT,
  { title: 'Install Node.js', body: <>
    <p><Link href="https://nodejs.org/en/download">Download Node.js</Link> (the LTS version) and run the installer with its usual options.</p>
    <p>Already have it? Skip this step.</p>
  </> },
  { title: 'Open a terminal', body: IS_MAC
    ? <p>Press ⌘ Space, type <b>Terminal</b>, and press Return. A window opens where you can type commands. Keep it open for the next steps.</p>
    : <p>Press the Start button, type <b>cmd</b>, and press Enter to open Command Prompt. A window opens where you can type commands. Keep it open for the next steps.</p> },
  { title: 'Download the relay', body: <>
    <p>Copy each line into the terminal and press {ENTER}. Wait for one to finish before the next.</p>
    <Cmd text="npx --yes degit Wizard780/Falcon/relay falcon-relay" />
    <Cmd text="cd falcon-relay" />
    <Cmd text="npm ci" />
    <p>npm may print warnings about install scripts. They are fine to ignore: you don't need to approve anything.</p>
    <p>Trying again? The first line stops if a falcon-relay folder is already there. Delete that folder, then start over from the first line.</p>
    <p>Set up a relay before live editing came out? Do this step and the next two again (delete the old falcon-relay folder first). Running npx wrangler deploy in the old folder would put the same old relay back. Its address stays the same, and card sharing keeps working.</p>
  </> },
  { title: 'Sign in to Cloudflare', body: <>
    <Cmd text="npx wrangler login" />
    <p>Your browser opens a Cloudflare page. Click <b>Allow</b>, then come back to the terminal.</p>
  </> },
  { title: 'Put the relay online', body: <>
    <Cmd text="npx wrangler deploy" />
    <p>If it asks for a workers.dev subdomain, type any name made of letters and numbers, like your team's, and press {ENTER}. It can't be left empty.</p>
    <p>When it's done it prints an address that ends in <b>.workers.dev</b>. Copy that address.</p>
  </> },
  { title: 'Connect Falcon', body: <Connect /> },
];

/**
 * Settings' step-by-step guide to a relay. In the desktop app Falcon sets it up (BY_FALCON), with the terminal steps
 * one click away; the web build has no main process to do that, so it only has those. Esc, Done or a click outside closes it.
 */
export function RelayGuide({ onClose, onAddRecipient }: { onClose: () => void; onAddRecipient?: () => void }) {
  const [hand, setHand] = useState(!bridge.relaySetup);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  // focus goes back to what opened the guide (the ?) when it closes
  useLayoutEffect(() => { const was = document.activeElement as HTMLElement | null; return () => was?.focus(); }, []);
  // each step starts on its box to type in (Connect's address) or its main button, else on the dialog
  useLayoutEffect(() => { (box.current?.querySelector<HTMLElement>('[data-first]') ?? box.current)?.focus(); }, [at, hand]);
  // by hand from the desktop's last step: the steps after the account, which both ways share
  const steps = hand ? BY_HAND : BY_FALCON(() => { setHand(true); setAt(2); });
  const step = steps[at], last = at === steps.length - 1;
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
        <p className="co-sub">Step {at + 1} of {steps.length}</p>
        <h2 id="rg-t">{step.title}</h2>
        <div className="rg-body" key={`${hand}-${at}`}><AddRecipient.Provider value={onAddRecipient ?? null}>{step.body}</AddRecipient.Provider></div>
        <div className="cf-btns">
          {at > 0 && <button onClick={() => setAt(at - 1)}>Back</button>}
          <button className="co-main" onClick={() => (last ? onClose() : setAt(at + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
