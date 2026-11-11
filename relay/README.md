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

1. Make a Cloudflare account at dash.cloudflare.com. **Don't add a payment method.** With no card on
   file the account stays on the Free plan, so going over a limit pauses the relay for the rest of
   the day instead of costing anything.
2. From this folder:
   ```sh
   npm ci
   npx wrangler login     # opens the browser once
   npx wrangler deploy
   ```
   Wrangler prints the URL, like `https://falcon-relay.<your-subdomain>.workers.dev`.
3. Put that URL in Falcon. Either:
   - per install: Settings > General > Card sharing > Relay, or
   - for everyone: set `DEFAULT_RELAY` in `src/collab/relay.ts` and ship a build.

The migration in `wrangler.jsonc` uses `new_sqlite_classes`, the Durable Object storage the Free plan
allows. Keep it that way.

## Daily limits (Free plan)

Each limit resets at 00:00 UTC. While one is used up, sends fail and Falcon says that card sharing is
paused until then (shown in the user's local time). Nothing is charged.

| Limit | Free plan, per day | What uses it |
| --- | --- | --- |
| Worker requests | 100,000 | each card sent, and each socket connect |
| Durable Object requests | 100,000 | the same, plus incoming socket messages at 20 to 1 |
| Rows written | 100,000 | each card sent (one row, plus one alarm when the inbox had none), each card acked (one delete) |
| Rows read | 5,000,000 | queue checks and deliveries |
| Storage | 5 GB total | envelopes waiting (at most 50 cards or 10 MB per inbox, 3 hours) |

Falcon never polls. It keeps one socket per app launch, idle sockets hibernate (no duration charged),
and it reconnects with backoff capped at 5 minutes.

## Develop

```sh
npm ci
npm run dev        # wrangler dev on http://localhost:8787, no account needed
npm test           # the Worker under wrangler dev, driven by Falcon's own client crypto (needs the root npm ci)
npm run typecheck
```

`EXPIRY_MS` (a Worker var) changes the 3-hour expiry. Only the tests set it.

When a free-plan daily cap runs out, Cloudflare fails the Durable Object call with an error. Its
text isn't documented; it is reported as `Exceeded allowed rows written in Durable Objects free tier`
(or rows read, duration, volume of requests). The Worker answers 429 for that and 503 for anything
else. When the Worker's own 100,000 requests run out, Cloudflare answers with its error 1027 page
before the Worker runs. That page has no CORS header, so Falcon sees it as the relay being unreachable.

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
