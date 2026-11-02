# Find and replace

A user opens the find bar from the tool row, types a word, and sees the match count and the match selected on the page. With Replace they swap every match in one go, and one undo puts everything back.

## Sub-features

- `open` the tool row `Find` button opens `.findbar` with the Find box focused.
- `count` `.findbar .count` shows `current/total`, and the current match is selected.
- `replace-all` Replace, then `All`, replaces every match.
- `undo` one Mod-Z undoes the whole Replace all.

## How to get to it (user POV)

- The tool row magnifier `Find`, or Mod-F.
- Mod-Shift-H on Mac (Ctrl+H on Windows) opens find with replace. Alt-F finds by position.
- The find bar's `Replace` text button shows the Replace box, and `All` replaces every match.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`, and the seed is open.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/find-replace.mjs`. It exits 0 with six `ok` lines.
- **Find one.** Click `.tools [aria-label="Find"]` and fill `.findbar input[placeholder="Find"]` with `needle`. The count reads `1/1`, and the selection's text is `needle`.
- **Find two.** Fill `Block`. The count ends `/2`.
- **Replace all.** Click `.findbar button[title^="Replace (⌘⇧H)"]` (Windows: `Replace (Ctrl+H)`), fill `.findbar .fb-with` with `Section`, then click `button[title^="Replace all"]`. The mark map has `block: Economy Section` and `block: Warming Section`, and no `Block`.
- **Undo.** Escape, click the page, then Mod-Z once. Both `Block` headings are back.
- **Proof.** `evidence/find-replace/` holds `01-found.png`, `02-replaced.png` and `results.txt`.

## Gotchas

- Two buttons are titled `Replace (…)`: the toggle (`⌘⇧H` / `Ctrl+H`) and, once the Replace box is open, the one-match `Replace (Enter)`. Match by the key in the title.
- Find is case-insensitive by default, so `block` also matches `Block`. Pick search words the seed spells only one way.
- The find bar covers the top right of the page. Screenshots of that area show the bar, not the text under it.
