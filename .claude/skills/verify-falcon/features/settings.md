# Settings

Settings is an overlay with seven panes and a search box, opened from the gear at the bottom of the rail. Every choice applies right away, is stored in `localStorage` under a `falcon.*` key, and is still there after a reload. The highlighter pen is the most visible example: pick Green and F11 highlights in green.

## Sub-features

- `panes` General, File search, Appearance, Editor, Formatting, Keybindings, Speech and timers.
- `pen` the Appearance `Highlighter` radio group (Yellow, Green, Cyan, Magenta, Gray), stored as `falcon.highlight`.
- `effect` F11 uses the chosen pen.
- `persist` choices survive a reload.
- `search` `[aria-label="Search settings"]` filters rows across panes.

## How to get to it (user POV)

- The gear `Settings` at the bottom of the rail, or Mod-, (comma).
- `Close settings`, or Escape, closes it.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`, and the seed is open.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/settings.mjs`. It exits 0 with five `ok` lines.
- **Open.** Click `.fstrip [aria-label="Settings"]`. `[aria-label="Settings sections"] button` lists the seven panes.
- **Pick a pen.** Click the `Appearance` pane, then `[aria-label="Highlighter"] [role=radio][aria-label="Green"]`. Green has `aria-checked="true"`, and `localStorage['falcon.highlight']` is `green`.
- **Effect.** Close settings, `f.select('Temperatures')`, then F11. The mark map shows `[Temperatures]{highlight:green}`.
- **Persist.** Reload and reopen Settings > Appearance. Green is still checked.
- **Proof.** `evidence/settings/` holds `01-green-picked.png`, `02-green-highlight.png` and `results.txt`.
- **Every row.** `scripts/settings-check.mjs <a.docx> <port>` changes every Settings row and checks its effect (about 84 checks). Pass it the run's port.

## Gotchas

- `openFalcon` clears `localStorage`. To start with a setting already set, pass `openFalcon(name, { storage: { 'falcon.highlight': 'green' } })`. Don't click through Settings in every drive.
- Some rows come from feature modules (nav-keys, doc-tools, card-tools) and show up under Formatting gaps or Standardize. A missing row can mean a feature's settings are not registered, not a Settings bug.
- `settings-check.mjs` needs a real `.docx` as its first argument. `fixtures/seed.docx` works.
