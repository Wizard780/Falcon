// Free-plan maths for live co-editing: how many rounds a day one relay on Cloudflare Workers Free can carry,
// for the design Falcon uses and for the naive designs it rules out.
//   node scripts/live-free-tier.mjs
//
// Limits are Cloudflare's published Free-plan numbers, read 2026-11-11 from
//   https://developers.cloudflare.com/durable-objects/platform/pricing/
//   https://developers.cloudflare.com/durable-objects/platform/limits/
//   https://developers.cloudflare.com/workers/platform/limits/
// All of them reset at 00:00 UTC, and on Free "further operations of that type will fail with an error".
const LIMIT = {
  workerRequests: 100_000, // Workers: 100,000 requests a day (shared with Send Card)
  doRequests: 100_000, // Durable Objects: HTTP requests, RPC sessions, alarms, incoming WebSocket messages at 20:1
  durationGBs: 13_000, // Durable Objects: 13,000 GB-s a day, wall clock while active and not eligible to hibernate, at 128 MB
  rowsWritten: 100_000,
  rowsRead: 5_000_000,
};
const WS_RATIO = 20; // "a 20:1 ratio is applied to incoming WebSocket messages"; outgoing messages are free
const GB = 128 / 1024; // each object is billed for its 128 MB

// ---------- the round ----------
const HOURS = 2;
const SECONDS = HOURS * 3600;
const BATCH_MS = 400; // a client sends at most one frame (doc update + its cursor) per 400 ms window
const HANDLER_MS = 2; // the room's webSocketMessage: check size, fan the frame out to the other sockets; no awaits, no storage
const CONNECTS = 6; // each person: the first connect plus reconnects (wifi drops, a laptop lid)
const LATE_JOINERS = 1; // one person joins after the start, and once more after a reconnect gap
const SNAPSHOT_MB = 8; // a several-hundred-page block file's Loro snapshot, sent by a peer in chunks
const CHUNK_KB = 256;

/** The share of the round each person is editing or moving their caret: a frame every window while they are. */
const PROFILES = { realistic: 0.5, worst: 1 };

function round(people, active, design) {
  const framesPerPerson = design.perKeystroke
    ? SECONDS * active * design.perKeystroke // every transaction (keys, caret moves) is its own message
    : SECONDS * active * (1000 / BATCH_MS);
  const frames = framesPerPerson * people;
  const connects = people * CONNECTS;
  // each connect: {"t":"join"}, the ask, one peer's answer, a catch-up update, and every other person's name frame
  const handshake = connects * (4 + (people - 1));
  const snapshotFrames = LATE_JOINERS * 2 * (1 + Math.ceil((SNAPSHOT_MB * 1024) / CHUNK_KB)); // the ask, then the peer's chunks
  const incoming = frames + handshake + snapshotFrames;
  return {
    workerRequests: connects, // the upgrade goes through the Worker once; frames go straight to the object
    doRequests: connects + incoming / WS_RATIO,
    durationGBs: design.hibernates ? (incoming * HANDLER_MS) / 1000 * GB : SECONDS * GB, // accept() bills the whole time a socket is open
    rowsWritten: design.storesUpdates ? frames + (design.compacts ? frames / 50 : 0) : 0,
    rowsRead: design.snapshotFromStorage ? LATE_JOINERS * 2 * framesPerPerson * people : 0,
    frames,
  };
}

const DESIGNS = {
  falcon: { label: 'Falcon: hibernating room, ciphertext rebroadcast only, 400 ms batches, snapshot from a peer', hibernates: true },
  perKeystroke: { label: 'no batching: one message per transaction (~8 a second while editing)', hibernates: true, perKeystroke: 8 },
  stores: { label: 'a storage row per update, late joiner reads them back', hibernates: true, storesUpdates: true, snapshotFromStorage: true },
  noHibernate: { label: 'room calls ws.accept() (no hibernation)', hibernates: false },
};

const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));
const perDay = (use) => Math.floor(Math.min(...Object.keys(LIMIT).map((k) => (use[k] > 0 ? LIMIT[k] / use[k] : Infinity))));
const binding = (use) => Object.keys(LIMIT).reduce((a, k) => ((use[k] > 0 ? LIMIT[k] / use[k] : Infinity) < (use[a] > 0 ? LIMIT[a] / use[a] : Infinity) ? k : a));

console.log(`One round: ${HOURS} h, ${BATCH_MS} ms batches, ${HANDLER_MS} ms per frame in the room, ${CONNECTS} connects a person, ${LATE_JOINERS} late joiner (twice) fetching a ${SNAPSHOT_MB} MB snapshot from a peer.\n`);
for (const [profile, active] of Object.entries(PROFILES)) {
  console.log(`## ${profile}: each person editing ${Math.round(active * 100)}% of the round\n`);
  console.log('| design | people | frames in | Worker req | DO req | GB-s | rows written | rows read | rounds/day | runs out first |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [key, d] of Object.entries(DESIGNS)) {
    for (const people of [2, 3, 4]) {
      if (key !== 'falcon' && people !== 4) continue;
      const u = round(people, active, d);
      console.log(`| ${key} | ${people} | ${fmt(u.frames)} | ${fmt(u.workerRequests)} | ${fmt(u.doRequests)} | ${fmt(u.durationGBs)} | ${fmt(u.rowsWritten)} | ${fmt(u.rowsRead)} | ${perDay(u).toLocaleString('en-US')} | ${binding(u)} |`);
    }
  }
  console.log();
}
// how sensitive the answer is to the one number that can't be measured locally
for (const ms of [2, 10, 50]) {
  const u = { ...round(4, 1, DESIGNS.falcon), durationGBs: (round(4, 1, DESIGNS.falcon).frames * ms) / 1000 * GB };
  console.log(`worst case, 4 people, ${ms} ms a frame: ${fmt(u.durationGBs)} GB-s a round, ${perDay(u)} rounds/day (${binding(u)})`);
}
console.log('\nDesigns:'); for (const [k, d] of Object.entries(DESIGNS)) console.log(`- ${k}: ${d.label}`);
