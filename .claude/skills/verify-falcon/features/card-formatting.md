# Card formatting

A user cuts a card with the function keys or the two-row format grid: they turn lines into pockets, hats, blocks and tags, and mark text as cite, underline, emphasis or highlight. Each change shows on the page right away, and F12 clears it again.

## Sub-features

- `para-styles` F4 pocket, F5 hat, F6 block, F7 tag, Mod-F7 analytic, Mod-F8 undertag.
- `char-marks` F8 cite, F9 underline, F10 emphasis (underline and emphasis replace each other).
- `highlight` F11 highlights in the Settings pen color, and Mod-F11 adds shading.
- `clear` F12 removes marks from the selection but keeps highlight and shading.
- `grid` every key also has a format-grid button whose `title` starts with `Label (Key)`.

## How to get to it (user POV)

- Select text or put the caret in a line, then press the key.
- Click the matching button in the format grid at the top, such as `Tag`, `Cite` or `Clear`.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`, and the seed is open (`f.open(SEED)`).

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/card-formatting.mjs`. It exits 0 with seven `ok` lines.
- **Underline.** `f.select('Temperatures rose again.')`, then F9. The line reads `[Temperatures rose again.]{underline}`.
- **Highlight.** `f.select('rose')`, then F11. The line shows `[rose]{highlight:yellow+underline}`.
- **Emphasis.** `f.select('needle')`, then F10. The line shows `[needle]{emphasis}`, boxed on screen.
- **Cite by button.** `f.select('this line')`, then click `.toolbar button[title^="Cite (F8)"]`. The line shows `[this line]{cite}`.
- **Styles.** `f.select('Warming is real')`, then F6. The line starts `block: `. Click `.toolbar button[title^="Tag (F7)"]` and it starts `tag: ` again.
- **Clear.** Select the whole sentence, then F12. The line reads `normal: Temperatures [rose]{highlight:yellow} again. The needle finds this line.`
- **Proof.** `evidence/card-formatting/` holds `before.markmap.txt`, `after.markmap.txt`, `01-before.png`, `02-marked.png`, `03-cleared.png` and `results.txt`.

## Gotchas

- F12 keeps highlight and shading on purpose, as Verbatim does (`CLEAR_KEEPS` in `src/editor/commands.ts`). Don't assert a fully plain line.
- Enter keeps the marks at the caret, Verbatim style, so text typed after a cite line is cite too. Type plain text first, then mark it by selection.
- F5 and Alt-F8 work in Falcon but not in CardMirror's web build. That is a known probe difference, not a Falcon bug.
- To compare against CardMirror, use `scripts/probe.mjs` and `scripts/scenario.mjs` (they need CM served on :5301).
