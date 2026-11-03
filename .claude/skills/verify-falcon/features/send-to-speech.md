# Send to speech

A user builds a speech inside Falcon by pressing `` ` `` in any file. It copies the selection, or with just a caret the card or heading section at the caret, into the speech doc. The first send creates a blank "Speech" doc in the background, the file they were in never changes, and each send lands below the last. The send's toast has an Undo button, and Mod-Z inside the speech doc takes a send back too.

## Sub-features

- `send` `` ` `` sends the card at a caret in a card, the block or hat with everything under it at a caret on that heading, or the selected text with its styles and marks.
- `create` the first send adds `Speech` to the rail, marked `S`, without switching to it.
- `order` the speech doc's caret ends after each send, so the next lands below it.
- `undo` the toast's Undo button, or Mod-Z in the speech doc, removes the last send only. The toast button steps aside once the speech doc was edited.
- `mark` the tool row `Speech doc` button makes the open file the speech doc, or unmarks it. Only one file is ever the speech doc.
- `guard` `` ` `` does nothing in the speech doc itself (it says so), and types normally in text boxes such as the find bar.
- `recover` the speech marker comes back with crash recovery after a reload.
- `close` closing the speech doc leaves no speech doc, and the next send makes a fresh one.

## How to get to it (user POV)

- `` ` `` (Backquote) with the page focused, or whatever key Settings > Keybindings > Send to speech is set to.
- The `Send` text button beside Read and the timer in the top bar.
- The mic button `Speech doc` in the tool row, to pick which file receives sends.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`, and the seed is open.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/send-to-speech.mjs`. It exits 0 with 25 `ok` lines.
- **Send a card.** Click the body line (`.ProseMirror :text("Global")`) and press `Shift+Backquote`. The rail gains `.doc-nm[aria-label="Speech (speech doc)"]` with `i.spk`, the seed's mark map is unchanged, and `.toast` reads `Sent “Growth is slowing” to SpeechUndo`.
- **Read it.** Click the Speech tab. The mark map is the seed's lines 4 to 6: the tag, the cite and the body with its marks.
- **Send a section.** Click `Warming Block`, press `` ` ``. The speech doc ends with `block: Warming Block`, its tag and its body.
- **Undo.** Click `.toast button`, or press Mod-Z in the speech doc. The last send is gone and the card before it stays.
- **Mark.** Click `.tools [aria-label="Speech doc"]`. `aria-pressed` is `true` and the `S` moves to this file's rail button.
- **Proof.** `evidence/send-to-speech/` holds `01-first-send.png`, `02-speech-doc.png`, `03-two-sends-in-order.png`, `04-after-mod-z.png`, `05-marker-moved.png`, `06-fresh-speech-doc.png` and `results.txt`.

## Gotchas

- Click a text line to get a caret. `f.select(text)` makes a selection, which sends only those words, not the card.
- Hovering the rail slides the files panel over the tool row. Move the mouse off it (`page.mouse.move(800, 600)`) before clicking a tool button, or the click is intercepted.
- The toast lasts about six seconds with an action. Click Undo inside that window.
- The speech doc is dirty from its first send, so closing it asks first. Reloads keep it only through crash recovery, which writes about a second after the last change.
- The send key is eaten by the page on purpose, so a literal `` ` `` can't be typed there while it's bound. A text box (find bar, Settings search) still takes it. Rebinding it (say to `~`) frees `` ` `` again.

## New speech doc

`journeys/new-speech.mjs`: Settings > General > Speech doc name (`falcon.speechName`, default
`Speech {speech} {date:M-D h-mmA}`), then Mod-Shift-N, Shift-click on the tool row's +, or Home's
New speech doc. The dialog takes the speech's name, the doc opens on a pocket with it, is marked as the
speech doc, and Mod-S downloads it under the template's name.
