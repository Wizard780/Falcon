# Relay setup (Settings > Sharing > ?)

Card sharing and live editing need a relay: the user's own Cloudflare Worker (`relay/`). The ? beside Relay in Settings > Sharing opens a guide. In the desktop app it is four steps: what a relay is, make a free Cloudflare account, make a token (a link to Cloudflare's token page with Workers Scripts: Edit and Account Settings: Read filled in), and Set up my relay. That button opens a window the main process owns for the token, and `electron/relay-setup.cjs` uploads the relay the app ships (`dist/relay-worker.json`), picks a workers.dev subdomain if the account has none, turns its address on, and the guide then checks it (waiting out a new address's first minutes) and saves it. "Set it up by hand" switches to the eight terminal steps, which are the web build's only way and end at Connect Falcon (paste the address, Check and save).

## Sub-features

- `steps` desktop: four steps; web: eight, ending at Connect. Back, Next, Done, Esc (closes the guide, not Settings), Tab kept inside.
- `token-link` step 3's link is `https://dash.cloudflare.com/profile/api-tokens` with `permissionGroupKeys` `workers_scripts` edit and `account_settings` read, `accountId=*`, `zoneId=all`, named Falcon relay.
- `token-window` the token is typed into `secret-prompt.html` (title "Cloudflare token", button "Set up"), never the page. Closing it goes back to the button.
- `progress` five rows: Getting the token, Finding your Cloudflare account, Uploading the relay, Turning on its address, Checking it works. Done rows get a check, the current one a spinner, a failed one turns red.
- `waiting` an address that can't be reached yet (a new workers.dev subdomain has no certificate for its first 4 to 5 minutes) is tried every 10 s for up to 10 minutes, with "A new address can take a few minutes to come online. Falcon is still trying". Only then does it say to check the address. Same on the by-hand Connect step.
- `failure` each error has its own sentence that says what to do (bad token, no account, more than one account, email not confirmed, newer relay, offline, what Cloudflare said), and Try again.
- `redeploy` running it over an existing relay sends only the migrations it lacks (none for a current one); an older relay gains rooms that way. The live panel's old-relay line points there on the desktop.
- `token-kept-nowhere` the token is never on disk, in a log, in the page or in an answer.

## How to get to it (user POV)

- Settings > Sharing (under Debate), the ? beside Relay. Search "relay" finds the row.
- The live-editing panel's line for a relay from before rooms.

## Driving it with falcon-verify

Preconditions: a run launched with a build (`dist/relay-worker.json` exists), `npm ci` in `relay/` for the web journey.

- **Desktop.** `$V run .claude/skills/verify-falcon/journeys/relay-setup-desktop.mjs` exits 0 with 25 `ok` lines in about 30 s. The app runs headless with `FALCON_CF_API` pointing at `tests/cloudflare-fake.mjs` over HTTP (a brand-new account) and `FALCON_CF_RELAY_URL` at a stand-in that starts answering only after the guide is waiting. `main.cjs` honours both only when `FALCON_HEADLESS=1`. Playwright sees the token window as a page of its own, so the token is typed with `fill` and Enter, a wrong one first. It then checks the fake's account (one script, tag v2, Inbox and Room, workers.dev on, a `falcon-xxxxxx` subdomain, the shipped code), the saved address, and greps the whole profile for the token (UTF-8 and UTF-16), with the saved address as the control that the grep finds things.
- **Web.** `$V run .claude/skills/verify-falcon/journeys/relay-guide.mjs` exits 0 with 15 `ok` lines: the eight steps, Esc, Tab, a dead address kept trying instead of turned down, the same address saved once it starts answering 12 s in, and a real relay under `wrangler dev`.
- **Unit.** `tests/relay-setup.test.ts` (the main-process logic against the fake) and `tests/relay-guide.test.ts` (both flows with a faked clock).
- **Proof.** `evidence/relay-setup-desktop/`: start, token step, failure, asking for the token, the token window, working (mid upload), waiting, done.

## Gotchas

- Never click the token link in a journey: it goes to `shell.openExternal` and opens a real browser.
- Enter in the token window closes it under the key press; wait for its `close` event instead of the press resolving.
- The fake's `state.hold` makes an upload take that many ms, to catch the working state on screen.
- The live Cloudflare path (real API, real token) is not in any journey. It was checked once by hand with a throwaway Worker (see the PR that added this); never point a check at a script named `falcon-relay`, which is the user's live relay.
