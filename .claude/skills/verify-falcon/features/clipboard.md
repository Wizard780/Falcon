# Clipboard (rich copy out, smart paste in)

A Falcon copy carries the Verbatim look as inline styles, so it pastes into Gmail, Google Docs and Word with cites bold 13pt, underline, boxed emphasis, highlights (with `mso-highlight` for Word) and heading sizes. Pasting into Falcon turns other apps' formatting back into Verbatim styles.

## Sub-features

- `copy-out` Cmd-C/cut/drag, the outline's copy and Create Reference all serialize through `src/editor/clipboard-styles.ts` (`freezeStyles`).
- `roundtrip` Falcon's own copy pastes back unchanged: on paste, `style` is dropped from every `f-*` element and the classes decide.
- `paste-in` Word (Verbatim class names or direct formatting), Google Docs, Gmail and CardMirror (`pmd-*`) HTML is rebuilt in `src/editor/paste.ts`: underline + bold or box is emphasis, bold at 13pt or more is a cite, Word's 15 highlight colors are kept (other backgrounds dropped), text shrunk below 10.5pt keeps its size. h1-h4 give pocket/hat/block/tag; bold alone never makes a heading (a cite alone on a line looks the same). Smart paste off (Settings): paragraphs, bold, italic only.
- `inline-lines` One analytic or undertag line pasted onto a line with words sits next to them and takes that line's look. On an empty line, or over a whole line, it keeps its style. Tags and headings always take their own line. Backspace at the start of an analytic joins it to the line above (`journeys/analytics-inline.mjs`).

## Driving it with falcon-verify

- **Journey.** `$V run .claude/skills/verify-falcon/journeys/clipboard.mjs`: 14 `ok` lines. It opens the seed, boxes `next year` with F10, Mod-A + the real copy command, renders the copied HTML in a page with none of Falcon's CSS (screenshot `02-pasted-elsewhere.png`), copies it back out with Chromium's own copy (read from the real clipboard, classes and `data-*` stripped like Gmail) and pastes both versions back.
- **Word.** `scripts/paste-word.mjs` (also in CI) pastes `tests/fixtures/word-clipboard.html`.

## Gotchas

- Reading `e.clipboardData` in a `copy` listener only sees data a handler set (ProseMirror does). A plain contenteditable's copy is written after the event: grant `clipboard-read` and use `navigator.clipboard.read()`.
- Select with Mod-A, not a DOM range: ProseMirror reads DOM selection changes asynchronously.
- The real Word/Docs/Gmail apps aren't driven; their clipboard shapes are modeled in `tests/clipboard.test.ts`.
