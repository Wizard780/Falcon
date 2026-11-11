# Send Card (card sharing)

Each Falcon has a pairing code. Partners swap codes and save each other as contacts; then Send Card to… seals the card at the caret (or the selection) to a contact and hands it to the relay (`relay/`, a Cloudflare Worker). In the other person's Falcon it arrives as a toast and a dot on the rail's inbox button, without taking focus. From the Card sharing panel they can Insert it below their caret, Copy it, or Dismiss it. A card from a code that isn't in contacts says so, with Add contact. With no relay set, sharing is inert and says so, but the code and contacts still work.

## Sub-features

- `code` the panel shows this install's 56-character code in groups of 7; Copy puts it on the clipboard; New code… (after a Confirm) replaces it.
- `name` Your name is sent with each card, and saved as you type.
- `contacts` paste a code and a name, then Add. A typo, a short code or a newer Falcon's code is refused with its own reason. Remove is the x on hover.
- `send` Send Card to… lists the contacts (arrows, Enter or a click) and names the card it sends; the toast says Sent, or why it didn't go.
- `receive` a card arrives while typing: a toast with Show and the rail's `Cards waiting (n)` button. Focus and the text stay put.
- `insert` Insert puts it below the caret's paragraph with every style and mark. Read mode refuses. Copy and Dismiss do what they say.
- `unknown` a card from a code not in contacts shows the name it claims, and Add contact fills it in.
- `fail` relay stopped: the send says it failed and the panel says it's retrying. Relay over its daily limit: paused until 00:00 UTC, shown in local time (app test). The editor keeps working.
- `inert` no relay set: the panel and the picker say so, and sending explains it.

## How to get to it (user POV)

- Command center (Mod-Shift-Space): `Card sharing` opens the panel; `Send Card to…` opens the picker. Neither has a key until one is set in Settings > Keybindings (Card sharing group).
- The rail's inbox button above Settings, shown only while cards are waiting.
- The toast's Show button when a card arrives.
- Settings > General > Card sharing > Relay (search "relay"), the relay's address.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`, and `npm ci` has been run in `relay/` (the journey starts its own `wrangler dev`, no account needed).

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/send-card.mjs`. It exits 0 with 37 `ok` lines. It opens three browser contexts (A, B, and C with no relay), so three identities, plus a second window in B that waits for the socket and takes it over when the first closes.
- **Desktop.** After `npm run build`, run `$V run .claude/skills/verify-falcon/journeys/send-card-desktop.mjs`. It exits 0 with 12 `ok` lines. The hidden Electron window (file://) connects and proves its key, takes a card from the script (the partner, using `src/collab` itself), inserts it with its marks, sends one back that the partner opens and verifies, and keeps the same code and contacts after a relaunch.
- **Relay.** In Settings, fill `input[aria-label="Relay address"]`. `localStorage['falcon.relayUrl']` holds it, and the panel's `.co-line` reads `Connected. Cards sent to your code arrive here`.
- **Code.** `.co-code` is the code. `.co-me button` copies it and the toast reads `Copied your pairing code`.
- **Contact.** Fill `input[aria-label="Their pairing code"]` and `input[aria-label="Their name"]`, then click `.co-add button[type="submit"]`. A bad code shows in `.co-hint`. Saved contacts are `.co-ct .nm`.
- **Send.** Put the caret in a card, run `Send Card to…`. `#co-st` reads `Send “<tag>” to…`. Enter sends to the lit `.co-pk`, and the toast reads `Sent “<tag>” to <name>`. The page makes one POST and no OPTIONS preflight.
- **Receive.** On the other side, `.toast` starts `Card from`, `.fstrip [aria-label="Cards waiting (1)"]` appears, and typing continues in the editor. Click it, then `.co-card button:has-text("Insert")`. The mark map gains the sent card's lines exactly.
- **Proof.** `evidence/send-card/` holds A's screens (contact added, send picker in dark and light, relay stopped) and `results.txt`. `b/` holds B's screens (panel dark and light, the toast while typing, the waiting card, inserted). `c/` holds the no-relay panel.

## Gotchas

- Each `openFalcon` is its own browser, so IndexedDB (where the identity, contacts and cards live) is separate. Two pages in one context would share an identity.
- `wrangler dev` takes a few seconds to come up. The journey waits for a 404 from `/x` before starting.
- The command center row for the panel is just `Card sharing`. Typing `card sharing` also matches the `Card sharing relay` setting row, which opens Settings if it ranks first.
- The daily-limit message can't be produced against a local relay. `tests/collab-app.test.ts` covers it with a relay that answers 429.
- The relay's 3-hour expiry is covered by `relay/test/relay.test.mjs` with `EXPIRY_MS`, not here.
