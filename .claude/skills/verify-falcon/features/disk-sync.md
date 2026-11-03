# Open docs and changes on disk

Desktop only. Falcon keeps `open-docs.json` in its app data folder: every open doc's path, whether it has unsaved edits, and when Falcon last read and saved it, so outside tools (Claude's scripts) know what's open before they write. While a doc is open, Falcon watches its file. When another program writes it, the change is merged in card by card: unsaved edits stay, new cards come in orange (pending), and a card changed on both sides opens a dialog: Keep both, Keep mine, or Use the file's. A Save over a file that changed since Falcon read it is refused, merged and then saved, so it can't wipe out the other program's work.

## Sub-features

- `status-file` `open-docs.json` lists open docs with `unsaved`, `active`, `readAt`, `savedAt`; empty after quitting.
- `watch-merge` a write by another program merges in within a second or two; unsaved edits stay; new cards are pending.
- `conflict` a card changed both in Falcon (unsaved) and on disk asks once per change, listing the cards.
- `stale-save` Mod-S right after an outside write merges first, then writes both sides' changes.
- `no-ids` files never saved by Falcon (no `_fc_` bookmarks) match cards by content and position, so an identical copy of a card elsewhere is never taken for the edited one.

## How to get to it (user POV)

- Open a file in the desktop app, then change it with another program (Claude's python-docx scripts, Word) while it's open, with or without unsaved edits.

## Driving it with falcon-verify

Preconditions: `npm run build` current (the script runs the Electron app on `dist/`). `FALCON_DOC=<copy of a real block file>` drives a real file instead of the seed.

- `$V run .claude/skills/verify-falcon/journeys/disk-sync.mjs` runs `scripts/disk-sync-check.mjs`: opens a copy, types an unsaved edit, writes a pending card into the file's XML, writes the same paragraph on disk (dialog: `.cf.ch`, clicks Keep both), then writes again and presses Mod-S at once. Checks `open-docs.json` at each step and the saved file's XML.
- Unit coverage: `tests/disk-merge.test.ts` (merge rules), `tests/docsync.test.ts` (status file, watching, stale save).

## Gotchas

- A web drive can't prove any of this: it all goes through `window.falcon` (`setOpenDocs`, `onDocChanged`, the save check in `electron/docsync.cjs`).
- The watcher polls once a second. A check that writes and reads back faster than that should wait (`until` in the script).
- An outside write must keep `_fc_` bookmarks on cards it doesn't mean to replace; a heading without one is matched by content.
