# The record of the user's edits

Desktop only, and nothing to see in Falcon (Aarav's call). Falcon keeps a record of the user's edits to each open file, card by card, so Claude can replay them into its own copy. The record covers edits since a checkpoint: the file as opened, or as another program (Claude) last wrote it. For each card it lists what changed (added, removed, moved, tag or heading, cite, body text, highlight, underline, emphasis, other formatting, approved, rejected), the card's full before and after (styles, text runs, marks), and where it sits.

## Sub-features

- `record` `edits/<hash>.json` in userData, rewritten about a second after each change; `open-docs.json` gives each doc's path to it.
- `kinds` each changed card names its changes; a card moved past others is the only one marked moved.
- `checkpoint` counted from `edits/<hash>.base.docx`, a copy of the file as opened or as another program last wrote it.
- `carry-on` reopening a file still as Falcon last saved it keeps the old checkpoint, so edits from an earlier session stay listed.
- `reset` another program's write starts the record over; merged-in changes are never the user's.

## How to get to it (user POV)

- None: open a file in the desktop app and edit it. Claude reads the record.

## Driving it with falcon-verify

Preconditions: `npm run build` current. `FALCON_DOC=<copy of a real block file>` drives a real file instead of the seed.

- `$V run .claude/skills/verify-falcon/journeys/edit-log.mjs` runs `scripts/edit-log-check.mjs`: retag a card, F11 a word, Mod-Alt-Backspace a card, Mod-Alt-ArrowDown another twice; read the record (4 cards, one change each); Mod-S, quit, relaunch: same checkpoint and edits; write the file from outside: the record empties, then approving the added card records `approved`.
- Unit coverage: `tests/edit-log.test.ts` (change kinds, before/after, positions), `tests/docsync.test.ts` (the record file, carry-on, reset).

## Gotchas

- A web drive can't see the record: it goes through `window.falcon.writeEdits` and `editCheckpoint`.
- The record is written a second after typing stops; wait for it.
- Swapping two neighbouring cards marks one of them moved (either is a correct replay).
