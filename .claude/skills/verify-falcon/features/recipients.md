# Recipients

The people cards go to. One list on one store (`src/collab/store.ts` contacts, `service.ts` edits), drawn by one component (`Recipients` in `src/ui/Collab.tsx`) in two places: Settings > Sharing (under the relay, with your pairing code and your name) and the command center's Card sharing panel. A change in either shows in the other. Each row: the name (an input: Enter or leaving it saves, Esc puts it back), the code's ends (the whole code on hover, as its title, or on a line of its own while it has focus), then Move up, Move down, Hide from Send Card (the eye), Star and Remove, shown on hover or keyboard focus. Hidden and starred stay shown. The row design follows the Card sharing tab of the owner's mockup (`~/Downloads/falcon/mockups/obsidian-ideas.html`): 36px rows on a faint hover fill, no borders, 28px icon actions, a spinner only past 150 ms, a failure said in the row, a removed row folding shut.

## Sub-features

- `add` Add recipient (full width, under the rows) opens a row with the code and a name. A bad code is turned down in the row with `parseCode`'s reason; no name says so. Focus goes back to Add recipient after.
- `rename` the name box; the panel and Settings show the new name.
- `order` Move up and down; Send Card to… lists recipients in this order. Focus stays on the button that moved (or the other arrow, at an end).
- `hide` the eye: out of Send Card to…'s list, still here. Everyone hidden: the picker says so.
- `star` one at a time (starring another moves it), as CardMirror's: Send Card to starred recipient (command center, Card sharing keybinding group, no key by default) sends the card at the caret straight to them, hidden or not. Nobody starred: it says to star someone.
- `remove` the row folds shut where it is (grid rows 1fr to 0fr, 320 ms on `--u-ease`), focus goes to the next row's Remove, else the heading (the panel) or Add recipient (Settings).
- `kept` order, hidden and starred survive a reload.

## Driving it with falcon-verify

- **Journey.** `$V run .claude/skills/verify-falcon/journeys/recipients.mjs` exits 0 with 44 `ok` lines (22 in dark, 22 in light) in under a minute. Codes are made with `src/collab` and carry a relay that isn't there, so a send fails naming who it went to, which proves where Send Card to starred sent it.
- **Rows.** `.st .rcp-row[data-code="<code>"]` (Settings) or `.cf.co .rcp-row[...]` (the panel). Name: `.rcp-nm` (read `value`). Actions: `[data-a="up" | "down" | "hide" | "star" | "x"]`, with `aria-pressed` on hide and star. A row folding away is `.co-fold[data-gone]`.
- **Unit.** `tests/recipients.test.ts` (the real App: Settings, the panel, the picker, Send Card to starred, the guide's Add a recipient).
- **Proof.** `evidence/recipients/` and `recipients/light/`: empty, a bad code, three with one hovered, the panel, the picker, hidden moved and starred, removing (mid-fold), removed.

## Gotchas

- Preact sets an input's `value` as a property, so `[value="…"]` selectors don't match a name; select rows by `data-code`.
- Actions show on `:hover` or `:has(:focus-visible)`, not `:focus-within`: a mouse click mustn't leave a row's actions out.
