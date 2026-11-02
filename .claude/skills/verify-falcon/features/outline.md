# Outline pane

The outline is docked to the left of the page and lists the doc's headings. A user picks how deep it goes with the 1-4 buttons and clicks a row to jump the page and caret there. The lit row follows where they are, and the depth stays the same after a reload.

## Sub-features

- `rows` one row per pocket, hat and block (depth 3 is the default), with counts.
- `depth` `1` pockets, `2` down to hats, `3` down to blocks, `4` down to tags.
- `jump` clicking a row moves the caret to that heading and lights the row.
- `persist` the depth is stored as `falcon.depth` and restored on load.
- `toggle` the tool row `Outline` button (or Mod-\) shows and hides the pane.

## How to get to it (user POV)

- The pane is on by default, to the left of the page.
- Depth buttons `1 2 3 4` in the pane header.
- The tool row `Outline` button.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`, and the seed is open.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/outline.mjs`. It exits 0 with seven `ok` lines.
- **Default rows.** `.sb-row.ol` rows read `Seed Pocket, Seed Hat, Economy Block, Warming Block`.
- **Depth 4.** Click `[aria-label="Show down to tags"]`. Six rows appear, adding `Growth is slowing` and `Warming is real`.
- **Depth 1.** Click `[aria-label="Show pockets"]`. Only `Seed Pocket` is left.
- **Jump.** At depth 4, click `.sb-row.ol:has-text("Warming is real")`. That row gets `data-on`, and the caret's paragraph is `Warming is real`.
- **Persist.** Reload. `localStorage['falcon.depth']` is `4`, and the depth-4 button has `data-on`.
- **Proof.** `evidence/outline/` holds `01-depth-3.png`, `02-jumped.png` and `results.txt`.

## Gotchas

- A row's `textContent` ends with its count (`Seed Pocket2`). Strip trailing digits before comparing names.
- The lit row moves on scroll. Wait about 700 ms after a click before reading `data-on`.
- `scripts/outline-check.mjs` clicks every row of a big real file, and `scripts/nav-check.mjs` covers outline drag, copy-drag and outline search. Both expect a server on :5190, or `FALCON_URL` for nav-check.
