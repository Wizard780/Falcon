# Falcon verification map

This directory is the maintained source for verifying Falcon's user-facing behavior. Read this index before driving the app, then use the matching feature file as the recipe. Each feature has a journey script in `../journeys/` that drives it end to end.

## Baseline preconditions

- A run started by `falcon-verify launch` from this checkout, and `falcon-verify doctor` passing (all `ok`).
- `V=.claude/skills/verify-falcon/bin/falcon-verify`, run from the repo root.
- Every drive starts from `openFalcon(feature)`: a fresh browser context, `localStorage` cleared, Home dismissed, one blank Untitled doc.
- The seed document is `fixtures/seed.docx`. Its expected mark map is `fixtures/seed.markmap.txt`: pocket `Seed Pocket`, hat `Seed Hat`, blocks `Economy Block` and `Warming Block`, tags `Growth is slowing` and `Warming is real`, cite `Smith 24`, underlined `growth will fall to two percent` with `two percent` highlighted, and the sentence `Temperatures rose again. The needle finds this line.`
- Never drive a server this run did not launch (`npm run dev` on :5173, or a hand-started preview on :5190).

## Driving conventions

- Act through real input: F-keys, `Mod-` shortcuts, toolbar and rail clicks, the Open file chooser, the Save download.
- Set selections with `f.select(text)`. A headless page has no OS focus, so Shift-Arrow and drag selection do nothing.
- Read state with `f.markMap()` and `window.__falconView.state` for evidence only. Never dispatch an edit through them.
- Prefer `aria-label`, `title^="Label (Key)"`, `role` and `placeholder` handles over CSS position.
- Home keeps a hidden preview of the page (`.ProseMirror.hm-doc`) in the DOM. Scope editor selectors with `.ProseMirror:not(.hm-doc)`, or a count of tables, pictures or footnotes comes out doubled.
- Move the caret with clicks or `f.select`, not End/Home: in a headless page they also smooth-scroll the page to its end a moment later. `journeys/typing-new-paragraphs.mjs` checks that a split or joined paragraph stays drawn in a long file (the off-screen skip in `src/editor/window.ts`).
- Run a journey with `$V run .claude/skills/verify-falcon/journeys/<feature>.mjs`. Exit 0 means every check was `ok`.

## Proof and skip reporting

- Proof lives in `/tmp/falcon-verify/<run-id>/evidence/<feature>/`: numbered screenshots, mark maps before and after, saved files, and `results.txt`.
- A mutation is proven from a second view: reopen a saved file in a fresh context, or reload the page for a setting.
- Anything that goes through `window.falcon` (native dialogs, save in place, recents, the close guard) is proven only by `desktop-shell`. A web drive never proves it.
- Report an entry point you could not drive, with the command you tried and the unmet precondition. Do not report it as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with falcon-verify` starts with `Preconditions:` and pairs each user action with the exact handle or key and the observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Recent documents (Ctrl-Tab)](./recent-docs.md) covers the MRU switcher: tap, hold with previews, walk, pick.
- [Falcon on launch](./launch-falcon.md) covers the falcon's flight over Home at startup, its perch, skipping, the setting and Reduce motion.
- [Open and save .docx](./open-save-docx.md) covers Open…, editing, the unsaved dot, Mod-S, and a reopen round trip.
- [Tables, pictures and footnotes](./tables-images-footnotes.md) covers opening and saving them, column and picture resizing, the table bar, cell keys, footnote editing and pasting tables and screenshots.
- [Card formatting](./card-formatting.md) covers the F-key paragraph styles, cite, underline, emphasis, highlight and Clear, from keys and the format grid.
- [Outline pane](./outline.md) covers heading rows, the 1-4 depth buttons, jumping by row, and stored depth.
- [Save As](./save-as.md) covers the Save As dialog and its As-Is, Send, Read and Marked copies, each reopened.
- [Clipboard](./clipboard.md) covers rich copy out to Gmail/Docs/Word and smart paste in from Word, Docs, Gmail and CardMirror.
- [Find and replace](./find-replace.md) covers the find bar, the match counter, Replace all and its single undo.
- [Send to speech](./send-to-speech.md) covers the `` ` `` key (changeable in Settings), the speech doc in the rail, send order, the Undo toast, Mod-Z and the Speech doc button.
- [Send Card](./send-card.md) covers pairing codes (which carry their owner's relay), recipients, Send Card to…, a card arriving without taking focus, Insert with its marks, a stopped relay and no relay set, through two local `wrangler dev` relays, one per person.
- [Live editing](./live-editing.md) covers starting a session, inviting a recipient (across relays), joining, converging edits and carets, frames per the free plan, a relay restart, a late joiner, leaving, saving, and an older relay without rooms.
- [Recipients](./recipients.md) covers the one list of people cards go to, in Settings > Sharing and the Card sharing panel: add (and a bad code), rename, move, hide from Send Card, star for Send Card to starred, remove with its fold, in dark and light.
- [Relay setup](./relay-setup.md) covers Settings > Sharing's ? guide: on the desktop, Falcon putting the relay on a Cloudflare account itself from a token (against a fake of Cloudflare's API), its progress, failures and waiting for a new address; on the web, the terminal steps and Connect, through a local `wrangler dev` relay.
- [Settings](./settings.md) covers the nine panes and the highlighter pen with its stored value and effect.
- [Themes](./themes.md) covers the preset tiles, custom themes and their colors, Document paper, System, and the desktop window following the theme.
- [Keybindings](./keybindings.md) covers changing a shortcut in Settings and the editor and app following it.
- [Command center](./command-center.md) covers Mod-Shift-Space: commands, Toggle and Cycle settings, typed values, headings and cites, find, Shift-Enter, and Tab to Settings.
- [Templates](./templates.md) covers named sets of files: making one in Settings, and opening it from the command center.
- [Desktop shell](./desktop-shell.md) covers the Electron app with no visible window: launch, keys, the preload bridge, save in place, and the close guard.
