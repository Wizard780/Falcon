# Live editing

Two or more people edit the same doc at once and see each other's edits and carets as they type. Whoever starts a session (Settings > Sharing, the command center, or the Live editing panel) makes a room on their own relay. Each contact they invite gets the room's id, key and relay sealed in a card envelope through the contact's own relay; the invite arrives as a toast with Join, counts on the rail's Sharing button until it's joined or dismissed, and stays listed in the panel. Joining opens the doc in a new tab once a peer in the room has sent it. Leaving keeps the doc as it is, with normal undo again. The relay only passes sealed frames along and stores nothing; the doc lives with the people in the room.

## Sub-features

- `start` Start live editing on the open doc: the Live editing panel opens, status `Live. Invite someone…`, the toolbar's Who's here says `Just you`.
- `invite` the panel's Invite list (recipients); the toast says `Invited <name> to “<doc>”`. The invite goes to the recipient's relay (their code carries it).
- `join` the invite's toast (`<name> invited you to live-edit “<doc>”`, Join; from a stranger, `A code not in your recipients, who says they're <name>, invited you…`) or the panel's Invites to you, or the rail's Sharing button (it opens Live editing when only invites wait); the doc opens in a tab, live. The room is on the host's relay, named in the invite.
- `converge` typing and F-keys on both sides at once end in the same mark map; carets show as a bar in the other person's color, their name on hover.
- `who` the toolbar's Who's here (`3 here`, a dot in each person's color; its label `Live editing with Blake and Casey`). Open, it lists you first, then whoever typed last, each with the heading above their caret and `typing now` / `idle N min` / `hosting`; hovering a row puts that person's name over their caret. The panel's In “<doc>” list too.
- `remove` / `end` (whoever started it) Remove on a row takes that person out (their Falcon leaves, keeps its copy, and drops the invite; honour-system, the key isn't changed); End session for everyone… asks inline (`Everyone keeps their own copy.`, Esc backs out), the rows fold one after another and everyone leaves with their copy. Those who joined get Leave instead.
- `undo` an inserted card (Send to speech, block search, Insert) is its own undo step in a live doc, and the send toast's Undo works there.
- `frames` a typist sends at most one frame per 100 ms (a caret that only moved, one per 400 ms); an idle person sends none (`scripts/live-free-tier.mjs`).
- `latency` keys typed at a steady pace show on the other screen within 120 ms on average (local relay), and the first key after a click goes at once.
- `reconnect` the relay drops: edits stay local (Who's here says `Reconnecting…`, the panel says so), and on reconnect each side gets what the other did.
- `late` someone joining late gets the whole doc from a peer, not from storage.
- `away` the live doc's tab put away (another tab showing): what comes in keeps its stored state current, and Send to speech into it goes into the session.
- `leave` Leave live editing (command center, the panel, Settings): the doc stays, history undo is back, nothing more arrives.
- `save` a .docx saved during or after a session reopens with the same mark map.
- `old-relay` a relay deployed before rooms: the panel says to update it (desktop: the ? in Settings > Sharing, then Set up my relay; web: download it again and run `npx wrangler deploy`); the editor is unaffected.

## How to get to it (user POV)

- Settings > Sharing > Live editing: This document (Start live editing / Invite… / Leave), Invites to you.
- Command center (Mod-Shift-Space): `Live editing` (the panel), `Start live editing`, `Leave live editing`. No keys until set in Settings > Keybindings (Live editing group).
- The toolbar's Who's here (top right, while the shown doc is live): who's in it, Invite… (the panel), End session for everyone… or Leave.
- An invite's toast: Join. The toast draws over any open dialog.
- The rail's Sharing button (paper plane) counts invites not joined yet.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`, and `npm ci` has been run in `relay/` (the journey starts its own `wrangler dev` relays, no account needed).
- Each person needs a relay set, a name, and the others as recipients (Card sharing or Settings > Sharing).

- **Journey.** `$V run .claude/skills/verify-falcon/journeys/live-editing.mjs` exits 0 with 50 `ok` lines in about 4 minutes. A and C are on relay 1 (the room's), B on relay 2: the invite crosses relays.
- **Start.** Settings > Sharing: `.st-row:has-text("This document") button:has-text("Start live editing")`. The panel is `.cf.co.co-live`; its status is `.co-live .co-line`; who's in it, `.lv-who .nm`.
- **Invite.** `.co-live section[aria-label="Invite"] .co-ct:has-text("<name>") button`.
- **Join.** `.toast button:has-text("Join")`, or `.co-live section[aria-label="Invites"] button:has-text("Join")`.
- **Who's here.** `.who` reads `Just you`, `N here`, `Reconnecting…`, `Paused`; its `aria-label` is `Live editing with <names>` (the shared tooltip moves `title` away on hover, so read the label). The popover is `.lv-pop`, rows `.lv-pop .pr` (match a row by its name, `.pr:has(b:text-is("Blake"))`: the line under a name can hold another name).
- **Carets.** `.ProseMirror .f-peer` with `title` = the person's name and a colored left border.
- **Frames.** count `framesent` on the page's `/v1/room/` WebSocket (Playwright `page.on('websocket')`).
- **Proof.** `evidence/live-editing/` holds A's screens (Settings, panel started, converged, relay down, three in the room), `converged.markmap.txt` and `a-live.docx`; `b/` the invite toast, B's view with Avery's caret, and after leaving with `b-after-leaving.docx`; `c/` the panel's invites; `old-relay/` the redeploy message.

## Gotchas

- Join from the panel leaves the panel open: press Escape before the next command center command.

- Put the caret with a collapsed selection (the journey's `caret()`), not a click on `:text(...)`: a click lands mid-word, and the next lookup of that text fails.
- The binding attaches on a timeout of 0 and holds off doc changes until then: type after a tick, as a person does.
- The panel class is `co-live`. `.lv` is the outline's level picker.
- The daily-limit pause can't be produced under `wrangler dev`; `tests/live-session.test.ts` covers it with a fake relay with rooms.
- A relay restart takes `wrangler dev` a few seconds; reconnects back off from 1 s to 30 s, so the catch-up check waits up to 45 s.
