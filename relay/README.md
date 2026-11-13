# Falcon card relay

Falcon's Send Card goes through this relay. It is a Cloudflare Worker with one SQLite-backed Durable
Object per inbox. It holds sealed card envelopes until the recipient's Falcon connects, proves it
holds the inbox's private key, and acks them. It never sees a card or a name: those are sealed. It
does see public keys. The sender's rides in each envelope's header (that is how the recipient knows
who sent it), and the recipient's is sent when it connects (to prove it owns the inbox). A pairing
code is that public key plus a checksum, so the relay could tell which codes talk to which. It can't
read or forge anything with them. Envelopes nobody collects are deleted after 3 hours.

It is built to stay on the **Workers Free plan**, and it never needs a paid one.

## Deploy (once)

1. Make a Cloudflare account at dash.cloudflare.com and confirm its email (Cloudflare won't take a Worker
   until you do). **Don't add a payment method.** With no card on file the account stays on the Free
   plan, so going over a limit pauses the relay for the rest of the day instead of costing anything.
2. In the Falcon desktop app, open Settings > Sharing and click the ? beside Relay. The guide opens
   Cloudflare's page for a new account API token (`https://dash.cloudflare.com/?to=/:account/api-tokens/create`,
   Manage account > Account API tokens > Create Token). Nothing is filled in: you click the
   **Edit Cloudflare Workers** policy, then **Continue to summary** and **Create Token**, and copy
   the token, which starts with `cfat_` and is about 50 characters (the name at the top of the page
   is not the token). Then click **Set up my relay** and paste it once, into a window Falcon's main
   process owns. Something that isn't shaped like a token is turned down there, before anything is
   sent; quotes or a `Bearer ` pasted along with it are dropped. Falcon then does
   what `wrangler deploy` would, through Cloudflare's API (`electron/relay-setup.cjs`):
   - uploads this Worker, which ships prebuilt inside the app (`dist/relay-worker.json`, made from
     `src/index.ts` and `wrangler.jsonc` by `vite.config.ts` at build time), with only the migrations
     the account's copy still lacks, so running it again over a relay is safe and is how an older
     relay gains live-editing rooms;
   - registers a workers.dev subdomain if the account has none (`falcon-` and six random letters,
     another if that's taken), and never touches one that exists;
   - turns on the Worker's workers.dev address, waits for it to come online, and saves it.

   The token is used for that one run and dropped: it's never written to disk or a log, and the page
   never sees it. You can delete it in Cloudflare afterwards, under Manage account > Account API
   tokens.
3. Or by hand (the web build's only way):
   ```sh
   npx --yes degit Wizard780/Falcon/relay falcon-relay
   cd falcon-relay
   npm ci                 # warnings about install scripts are fine to ignore
   npx wrangler login     # opens the browser once
   npx wrangler deploy    # asked for a workers.dev subdomain? type any name; it can't be empty
   ```
   Wrangler prints the URL, like `https://falcon-relay.<your-subdomain>.workers.dev`. Paste it into
   the guide's last step (Settings > Sharing > ?).

A brand-new workers.dev subdomain has no TLS certificate for its first few minutes (about 4 to 5 in
practice), and until then its address fails exactly like a wrong one. Both ways, Falcon keeps trying
every 10 seconds for up to 10 minutes and says so, and only then asks you to check the address.

Your pairing code then carries the relay's address (code v2, `src/collab/code.ts`), so people send to
you through your relay from theirs, and each person's free allowance is their own. Teammates don't
paste your address: each sets up a relay of their own (or a team shares one), and you swap codes and add
each other under Recipients (Settings > Sharing). A
code from before this (v1) has no relay, and cards to it go through the sender's own relay, as they
always did. For everyone at once instead, set `DEFAULT_RELAY` in `src/collab/relay.ts` and ship a build.

Set up a relay by hand before live editing came out? In the desktop app, run Set up my relay: it
updates it in place. By hand, download it again (the old folder deleted first, then
`npx --yes degit Wizard780/Falcon/relay falcon-relay`, `npm ci`) and run `npx wrangler deploy`. Running
it in the old folder puts the same old relay back. The address stays the same, and card sharing keeps
working. Falcon tells a relay without rooms apart (`GET /v1/rooms` answers 404) and says to do this. The same
update gives an older relay its usage count (`GET /v1/usage` answers 404 until then).

The migrations in `wrangler.jsonc` use `new_sqlite_classes`, the Durable Object storage the Free plan
allows. Keep it that way. The app's copy reads them from there, so a new migration only needs adding
there.

## Daily limits (Free plan)

Each limit resets at 00:00 UTC. While one is used up, sends fail and Falcon says that card sharing is
paused until then (shown in the user's local time). Nothing is charged.

| Limit | Free plan, per day | What uses it |
| --- | --- | --- |
| Worker requests | 100,000 | each card sent, and each socket connect |
| Durable Object requests | 100,000 | the same, plus incoming socket messages at 20 to 1 |
| Rows written | 100,000 | each card sent (one row and its index, plus one alarm when the inbox had none), each card acked or expired (one delete and its index), and the usage count (one row each time it is handed over) |
| Rows read | 5,000,000 | queue checks and deliveries |
| Storage | 5 GB total | envelopes waiting (at most 50 cards or 10 MB per inbox, 3 hours) |

Falcon never polls. It keeps one socket per app launch, idle sockets hibernate (no duration charged),
and it reconnects with backoff capped at 5 minutes.

### What's left today

Cloudflare gives a Worker no way to read its account's remaining free allowance, so the relay counts its own
day, and Falcon shows what's left as a bar (Sharing, and Settings > Sharing). `GET /v1/usage` answers the raw
tallies for the current UTC day:

```json
{ "usage": 1, "day": "2026-11-13", "requests": 1234, "objects": 1180, "rows": 3020, "msgs": 9400 }
```

`requests` are Worker requests, `objects` Durable Object requests (not counting socket messages), `rows` rows
written, and `msgs` incoming socket messages, which Cloudflare bills as Durable Object requests 20 to 1. The
limits and the maths are the app's (`src/collab/relay.ts`, `percentLeft`), so a change there needs an app
update, not every relay redeployed. A relay from before this answers 404, and Falcon says to update it.

How it counts, roughly:

- The Worker counts every request it runs for, and a Durable Object request for each one that reaches an inbox
  or a room. A card stored counts 5 rows over its life (its insert and its delete are two each, the row and its
  primary-key index, and at most one alarm), one more Durable Object request (that alarm running) and one incoming
  message (its ack); an inbox connect counts three (hello, proof, an ack). The Worker keeps this in memory and hands it
  to the Meter, one SQLite Durable Object with one row for the day, in one call once it reaches 25 Durable Object
  requests or 100 Worker requests, and whenever `/v1/usage` is answered.
- A room counts each incoming message in the socket's attachment, so the count outlasts hibernation. It hands
  them over every 400 messages and the rest when the socket closes.
- Each hand-over is one Durable Object request and one row written, and is counted too: about 4% on cards and
  5% on live editing. A new UTC day replaces the row. Rows read (5,000,000 a day) aren't counted: a relay runs
  out of the others long before.
- `/v1/usage` needs no key, so the Worker keeps its answer for 30 seconds, unless it counted something since
  (then the answer would be out of date, and the hand-over it makes was due anyway). A room's hand-over goes to the
  Meter directly, so the answer can trail a live session by up to that long.
- Counting never costs a send: every hand-over runs after the answer and is let go if it fails, including when
  the Meter itself is over the day's limit (then `/v1/usage` answers 429 `daily_limit`).

It only sees this relay. Other Workers on the same Cloudflare account share the same free allowance and aren't
counted, and a Worker isolate that is evicted loses what it hadn't handed over yet (under 25 Durable Object requests
and 100 Worker requests). So the bar is a close lower bound on what's used, not Cloudflare's own number.

### What a stranger can do

Posting to an inbox needs no key, only the code. So someone who wants to can use up the day's
allowance for everyone (it takes tens of thousands of junk cards), or fill one person's inbox with 50 junk
cards so real ones are turned away for up to 3 hours. Either way the worst case is that sharing
pauses until 00:00 UTC. It never costs money and never exposes a card. The fix for a targeted
person is New code… in Falcon. If it ever happens for real, put a per-address limit in front of
the Worker; nothing in the relay does that today.

When the Worker's own request limit is used up, Cloudflare answers before the relay runs, in a way
a page can't tell from having no connection. Falcon then says it can't reach the relay and that
the daily limit may be why.

## Develop

```sh
npm ci
npm run dev        # wrangler dev on http://localhost:8787, no account needed
npm test           # the Worker under wrangler dev, driven by Falcon's own client crypto (needs the root npm ci)
npm run typecheck
```

`EXPIRY_MS` (a Worker var) changes the 3-hour expiry. `METER_TEST` set to `on` lets a `PUT /v1/usage` set
the day's row as given, and `over` makes the Meter fail as if over the day's limit. Only the tests set them.

When a free-plan daily cap runs out, Cloudflare fails the Durable Object call with an error. Its
text isn't documented; it is reported as `Exceeded allowed rows written in Durable Objects free tier`
(or rows read, duration, volume of requests). The Worker answers 429 for that and 503 for anything
else. When the Worker's own 100,000 requests run out, Cloudflare answers with its error 1027 page
before the Worker runs. That page has no CORS header, so Falcon sees it as the relay being unreachable.

## Live-editing rooms

A Room is a Durable Object that passes sealed frames between the people in a live-editing session
and stores nothing (no rows, no alarms). Who is in it lives in each socket's attachment, which
survives hibernation, so idle sessions cost no duration. The room key never reaches the relay: it
goes to each invitee inside a sealed card envelope. A joiner gets the document from a peer, never
from storage. `scripts/live-free-tier.mjs` works out what a round costs on the free plan.

- `GET /v1/rooms`: `200 {rooms:1,...}` from the Worker itself (no Durable Object request). An older
  relay answers 404.
- `GET /v1/room/:id` (64 hex) as a WebSocket. The client sends `{"t":"join"}`, and gets
  `{"t":"welcome","slot","peers":[...]}` (peers in join order). The others get `{"t":"joined","slot"}`,
  and `{"t":"left","slot"}` when a socket closes.
- Binary frames in: `[kind][...][sealed]`. Out: `[kind][from slot u32][sealed]`.
  - kind 1 (update) goes to everyone else.
  - kind 2 (ask, one more byte: the attempt) goes to the peer in longest, the next one on a retry.
    With nobody else in, the asker gets `{"t":"alone"}`.
  - kind 3 (answer, a u32 target slot) goes to that slot only.
- Limits: 8 people (`{"t":"error","code":"room_full"}`), 1 MiB a frame. Over the daily limit, the
  upgrade gets a socket that says `{"t":"error","code":"daily_limit"}` and closes.

## Protocol v1

- `POST /v1/inbox/:id` with the envelope bytes as the body (no Content-Type, so browsers send no
  preflight). Answers: `201 {id}` stored, `400` not an envelope, `404` bad inbox id, `413` over
  1,000,000 bytes, `507` inbox full, `429` daily limit, `503` relay error.
- `GET /v1/inbox/:id` as a WebSocket (Hibernation API). The client sends `{"t":"hello","pub"}`, and
  the relay checks the key hashes to `:id`. The relay then makes a one-time X25519 key and sends
  `{"t":"challenge","eph","nonce"}`. The client answers `{"t":"proof","mac"}`, an HMAC keyed by HKDF
  over X25519(its private key, eph). Nothing is delivered or deleted before the proof passes.
- After the proof, each waiting card arrives as a binary frame (36-byte id, then the envelope), and
  new ones are pushed as they come. `{"t":"ack","ids":[…]}` deletes them. Falcon acks only once the
  card is saved on disk.
