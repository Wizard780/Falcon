// Anonymous usage counts sent to PostHog: which features get used, never what's in a document.
// Off in dev, in tests (headless) and in unpackaged runs; the page also skips it when the user turns
// it off in Settings. Events go straight to PostHog's capture endpoint, so there's no SDK to bundle.
const { app } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// PostHog's project key is public by design (it can only send events, not read them)
const KEY = '';
const HOST = 'https://us.i.posthog.com';

// the only events and properties the page may send; anything else is dropped
const EVENTS = new Set(['app_opened', 'doc_new', 'doc_opened', 'doc_saved']);
const PROP = /^[a-z_]{1,24}$/;

// one random id per install. If it can't be kept, send nothing: a new id each launch would count as a new user
let id;
function installId() {
  if (id !== undefined) return id;
  const file = path.join(app.getPath('userData'), 'telemetry-id');
  try { id = fs.readFileSync(file, 'utf8').trim(); } catch {}
  if (!/^[0-9a-f-]{36}$/.test(id ?? '')) {
    id = crypto.randomUUID();
    try { fs.writeFileSync(file, id); } catch { id = null; }
  }
  return id;
}

/** Keep only short word values, so a file name or card text can never ride along. */
function clean(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    if (!PROP.test(k)) continue;
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string' && PROP.test(v)) out[k] = v;
  }
  return out;
}

function enabled({ dev, headless, key = KEY }) {
  return !!key && app.isPackaged && !dev && !headless;
}

function track(event, props) {
  const distinct_id = EVENTS.has(event) ? installId() : null;
  if (!distinct_id) return;
  const body = {
    api_key: KEY,
    event,
    distinct_id,
    properties: {
      ...clean(props),
      app_version: app.getVersion(),
      $os: { darwin: 'Mac OS X', win32: 'Windows', linux: 'Linux' }[process.platform] ?? process.platform,
      $lib: 'falcon-desktop',
      $process_person_profile: false, // anonymous: counts installs without building person profiles
      $geoip_disable: true, // no city or country lookup from the IP
    },
  };
  fetch(`${HOST}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {}); // offline at a tournament: drop it
}

module.exports = { enabled, track, clean };
