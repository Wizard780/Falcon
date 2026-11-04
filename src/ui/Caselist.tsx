import { useCallback, useEffect, useRef, useState } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import { bridge, type CaselistBridge, type ClChoice, type ClPosted, type ClTarget, type TabroomRound } from '../editor/host';
import { alreadyPosted, draftReport, prefill, roundField, sideLabels, type Side } from '../editor/caselist';
import { readJson, safeSet } from './storage';

const TARGET_KEY = 'falcon.caselist.team';
const SIGNED_OUT = ['not_logged_in', 'login_expired'];
const ERRORS: Record<string, string> = {
  bad_login: 'Wrong email or password',
  not_logged_in: 'Sign in to openCaselist',
  login_expired: 'Your sign-in ran out. Sign in again',
  unreachable: 'Can\'t reach openCaselist. Check your connection',
  upload_unknown: 'openCaselist didn\'t confirm it. Check your team\'s page before posting again',
  bad_round: 'Tournament, round and side are required',
  no_file: 'The speech doc is empty',
  no_team: 'Pick your team first',
  too_large: 'The doc is over the 10 MB limit',
};
const say = (code: string) => (code.startsWith('caselist_rejected:') ? `openCaselist said no: ${code.slice(18)}` : ERRORS[code] ?? `openCaselist said ${code}`);

type Fields = { tournament: string; round: string; side: Side; opponent: string; judge: string };
const BLANK: Fields = { tournament: '', round: '', side: '', opponent: '', judge: '' };

/** Sign in with Tabroom, the way openCaselist does. The password goes out once; only the session comes back to keep. */
function SignIn({ api, note, onDone, onClose }: { api: CaselistBridge; note: string; onDone: () => void; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(note);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const submit = async () => {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    const r = await api.login(email.trim(), password);
    setPassword('');
    setBusy(false);
    if (r.ok) onDone(); else setErr(say(r.error));
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2 id="cl-t">Sign in to openCaselist</h2>
      <p className="cl-sub">Use your Tabroom email and password. Falcon sends them to openCaselist once and keeps only the sign-in it gets back, locked in your keychain.</p>
      <input ref={first} className="sa-name" aria-label="Tabroom email" placeholder="Tabroom email" type="email" autoComplete="username" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="sa-name" aria-label="Tabroom password" placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <p className="cl-err" role="alert">{err}</p>}
      <div className="cf-btns"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !email.trim() || !password}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
    </form>
  );
}

/** Which team page rounds go on: asked once, then kept. */
function TeamPick({ api, onPick, onClose }: { api: CaselistBridge; onPick: (t: ClTarget) => void; onClose: () => void }) {
  const [caselists, setCaselists] = useState<ClChoice[] | null>(null);
  const [schools, setSchools] = useState<ClChoice[] | null>(null);
  const [teams, setTeams] = useState<ClChoice[] | null>(null);
  const [c, setC] = useState('');
  const [s, setS] = useState('');
  const [t, setT] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!c) return;
    setSchools(null); setS(''); setTeams(null); setT('');
    let on = true;
    void api.schools(c).then((r) => { if (!on) return; if (r.ok) setSchools(r.value); else setErr(say(r.error)); });
    return () => { on = false; };
  }, [api, c]);
  useEffect(() => {
    if (!s) return;
    setTeams(null); setT('');
    let on = true;
    void api.teams(c, s).then((r) => { if (!on) return; if (r.ok) setTeams(r.value); else setErr(say(r.error)); });
    return () => { on = false; };
  }, [api, c, s]);
  useEffect(() => {
    void api.caselists().then((r) => {
      if (!r.ok) { setErr(say(r.error)); return; }
      setCaselists(r.value);
      setC(r.value.find((x) => /pf/i.test(`${x.event ?? ''} ${x.name}`))?.name ?? r.value[0]?.name ?? '');
    });
  }, [api]);
  const pick = (label: string, value: string, list: ClChoice[] | null, set: (v: string) => void) => (
    <label className="cl-f"><span>{label}</span>
      <select className="sa-name" aria-label={label} value={value} disabled={!list?.length} onChange={(e) => set(e.target.value)}>
        <option value="">{list ? (list.length ? `Pick your ${label.toLowerCase()}` : `No ${label.toLowerCase()}s yet`) : 'Loading…'}</option>
        {list?.map((x) => <option key={x.name} value={x.name}>{x.label}</option>)}
      </select>
    </label>
  );
  const done = () => {
    const cl = caselists?.find((x) => x.name === c), sc = schools?.find((x) => x.name === s), tm = teams?.find((x) => x.name === t);
    if (!cl || !sc || !tm) return;
    const target: ClTarget = { caselist: cl.name, caselistLabel: cl.label, event: cl.event ?? cl.label, school: sc.name, schoolLabel: sc.label, team: tm.name, teamLabel: tm.label };
    safeSet(TARGET_KEY, JSON.stringify(target));
    onPick(target);
  };
  return (
    <>
      <h2 id="cl-t">Your caselist team</h2>
      <p className="cl-sub">Falcon remembers this, so you only pick it once.</p>
      {pick('Caselist', c, caselists, setC)}
      {pick('School', s, schools, setS)}
      {pick('Team', t, teams, setT)}
      {err && <p className="cl-err" role="alert">{err}</p>}
      <div className="cf-btns"><button onClick={onClose}>Cancel</button><button onClick={done} disabled={!t}>Continue</button></div>
    </>
  );
}

/** Caselist on a speech doc: the round from Tabroom, the report from the doc's headings, the doc attached. Nothing goes up until Disclose. */
export function Caselist({ open, docName, getDoc, exportDoc, flash, onClose }: {
  open: boolean;
  docName: string;
  getDoc: () => PMNode | null;
  exportDoc: () => Promise<Uint8Array>;
  flash: (msg: string) => void;
  onClose: () => void;
}) {
  const api = bridge.caselist;
  const [step, setStep] = useState<'load' | 'signin' | 'team' | 'round'>('load');
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<ClTarget | null>(null);
  const [rounds, setRounds] = useState<TabroomRound[]>([]);
  const [posted, setPosted] = useState<ClPosted[]>([]);
  const [picked, setPicked] = useState(0);
  const [form, setForm] = useState<Fields>(BLANK);
  const [report, setReport] = useState('');
  const [edited, setEdited] = useState(false); // his own words stay when the side changes
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const filename = `${docName || 'Untitled'}.docx`;
  const firstField = useRef<HTMLInputElement>(null);

  const draft = useCallback((side: Side) => { const d = getDoc(); return d ? draftReport(d, docName, side) : ''; }, [getDoc, docName]);

  /** The round form: Tabroom's latest pairing, numbered the way the team's page numbers tournaments. */
  const toRound = useCallback(async (t: ClTarget) => {
    if (!api) return;
    setTarget(t);
    setStep('load');
    setErr('');
    const [rs, ps] = await Promise.all([api.rounds(), api.posted(t)]);
    const out = [rs, ps].find((r) => !r.ok && SIGNED_OUT.includes(r.error));
    if (out && !out.ok) { setNote(say(out.error)); setStep('signin'); return; }
    const list = rs.ok ? rs.value.rounds : [];
    const page = ps.ok ? ps.value : [];
    const fields = list[0] ? prefill(list[0], page) : BLANK;
    setRounds(list);
    setPosted(page);
    setPicked(0);
    setForm(fields);
    setReport(draft(fields.side));
    setEdited(false);
    if (!rs.ok) setErr('Tabroom didn\'t answer, so fill the round in yourself');
    setStep('round');
  }, [api, draft]);

  const begin = useCallback(async () => {
    if (!api) return;
    setStep('load');
    const s = await api.status();
    if (!s.ok || !s.value) { setStep('signin'); return; }
    const saved = readJson<ClTarget | null>(TARGET_KEY, null);
    if (saved) await toRound(saved); else setStep('team');
  }, [api, toRound]);

  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closing = useRef(onClose); // nothing closes it while a post is on its way
  closing.current = () => { if (!busyRef.current) onClose(); };
  useEffect(() => {
    if (!open) return;
    setNote('');
    void begin();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closing.current(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, begin]);
  useEffect(() => { if (step === 'round') firstField.current?.focus(); }, [step]);

  if (!open || !api) return null;
  const labels = sideLabels(target?.event || target?.caselistLabel || '');
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setSide = (side: Side) => { setForm((f) => ({ ...f, side })); if (!edited) setReport(draft(side)); };
  const choose = (v: string) => {
    const i = Number(v);
    setPicked(i);
    const fields = rounds[i] ? prefill(rounds[i], posted) : BLANK;
    setForm(fields);
    if (!edited) setReport(draft(fields.side));
  };
  const ready = !!form.tournament.trim() && !!form.round.trim() && !!form.side && !busy;
  const disclose = async () => {
    if (!ready || !target) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.post(target, { ...form, report }, filename, await exportDoc());
      if (r.ok) { flash(`Disclosed ${filename} to ${target.teamLabel}`); busyRef.current = false; onClose(); return; }
      if (SIGNED_OUT.includes(r.error)) { setNote(say(r.error)); setStep('signin'); return; }
      setErr(say(r.error));
    } catch (e) { setErr(`Couldn't make the .docx: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const again = alreadyPosted(form, posted);
  const field = (k: keyof Fields, label: string, cls = '') => (
    <label className={`cl-f${cls}`}><span>{label}</span>
      <input ref={k === 'tournament' ? firstField : undefined} className="sa-name" aria-label={label} spellCheck={false} value={form[k]} onChange={set(k)} />
    </label>
  );
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) closing.current(); }}>
      <div className="cf sa cl" role="dialog" aria-modal="true" aria-labelledby="cl-t">
        {step === 'load' && <h2 id="cl-t">Checking Tabroom…</h2>}
        {step === 'signin' && <SignIn api={api} note={note} onDone={() => void begin()} onClose={onClose} />}
        {step === 'team' && <TeamPick api={api} onPick={(t) => void toRound(t)} onClose={onClose} />}
        {step === 'round' && target && (
          <>
            <h2 id="cl-t">Disclose this round</h2>
            <p className="cl-sub">{target.teamLabel} · {target.caselistLabel}</p>
            {rounds.length > 0 && (
              <label className="cl-f"><span>Tabroom</span>
                <select className="sa-name" aria-label="Tabroom round" value={picked} onChange={(e) => choose(e.target.value)}>
                  {rounds.map((r, i) => <option key={r.id ?? i} value={i}>{[r.tournament, /^\d+$/.test(roundField(r.round)) ? `Round ${roundField(r.round)}` : r.round, r.opponent && `vs ${r.opponent}`].filter(Boolean).join(' · ')}</option>)}
                  <option value={rounds.length}>Fill it in myself</option>
                </select>
              </label>
            )}
            <div className="cl-grid">
              {field('tournament', 'Tournament', ' wide')}
              {field('round', 'Round')}
              <div className="cl-f"><span>Side</span>
                <div className="cl-seg" role="group" aria-label="Side">
                  {(['A', 'N'] as const).map((s) => <button key={s} type="button" aria-pressed={form.side === s} onClick={() => setSide(s)}>{labels[s]}</button>)}
                </div>
              </div>
              {field('opponent', 'Opponent')}
              {field('judge', 'Judge')}
            </div>
            <label className="cl-f"><span>Round report</span>
              <textarea className="sa-name cl-rep" aria-label="Round report" rows={3} spellCheck={false} placeholder="1NC---Offshoring DA, Econ DA" value={report} onChange={(e) => { setReport(e.target.value); setEdited(true); }} />
            </label>
            <p className="cl-send">Posts <b>{filename}</b> as it is now, saved or not, to <b>{target.teamLabel}</b>. Everyone can see it.</p>
            {again && <p className="cl-err" role="alert">This round is already on your page. Disclosing adds a second row.</p>}
            {err && <p className="cl-err" role="alert">{err}</p>}
            <div className="cf-btns cl-btns">
              <span className="cl-more">
                <button type="button" onClick={() => setStep('team')} disabled={busy}>Change team</button>
                <button type="button" onClick={() => { void api.logout(); setNote(''); setStep('signin'); }} disabled={busy}>Sign out</button>
              </span>
              <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" onClick={() => void disclose()} disabled={!ready}>{busy ? 'Posting…' : 'Disclose'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
