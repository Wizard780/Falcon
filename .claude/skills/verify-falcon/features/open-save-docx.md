# Open and save .docx

A user opens a Verbatim `.docx` from the tool row, sees every heading, cite, underline and highlight as they were, edits it, and saves. On the web build, Save downloads the file. Reopening the download shows the edit with nothing else lost.

## Sub-features

- `open-picker` opens a `.docx` through Open… and its file chooser, replacing the blank Untitled doc.
- `open-fidelity` keeps paragraph styles and marks exactly as saved.
- `dirty-dot` marks an edited file unsaved in the rail.
- `save-download` saves with Mod-S (web build: a download named after the doc) and clears the dot.
- `round-trip` reopens the saved file with the same mark map.

## How to get to it (user POV)

- Tool row folder icon `Open…`, or the Open item on Home.
- Tool row `Save` / `Save As…`, or `Mod-S` / `Mod-Shift-S`.
- Desktop only: File menu, recents on Home and the files panel (see `desktop-shell.md`).

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`.
- `fixtures/seed.docx` matches `fixtures/seed.markmap.txt`.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/open-save-docx.mjs`. It exits 0 with eight `ok` lines.
- **Open.** `f.open(SEED)` clicks `.tools [aria-label="Open…"]` and answers the file chooser. The rail gains `.doc-row .doc-nm[aria-label="seed"]`, and `f.markMap()` equals `seed.markmap.txt`.
- **Edit.** `f.select('needle')`, then type `thread`. `.doc-row i[aria-label="unsaved"]` appears, and the mark map changes only `needle` to `thread`.
- **Save.** Press `Mod-S` and catch the download. Its suggested name is `seed.docx`. Keep it as `seed-saved.docx`. The unsaved dot is gone, and the file's `word/document.xml` contains `thread finds this line`.
- **Reopen.** A second `openFalcon('open-save-docx/reopen')` opens the saved file. Its mark map equals the edited one.
- **Proof.** `evidence/open-save-docx/` holds `01-empty.png` through `04-saved.png`, `opened.markmap.txt`, `seed-saved.docx` and `results.txt`. `reopen/` holds `reopened.markmap.txt` and its screenshot.

## Gotchas

- Opening into the blank Untitled replaces it. A second Open adds a doc. Count rows by name, not by position.
- A saved Untitled doc is named by the `New file name` setting (Untitled, date or speech). The download name varies.
- The web build always downloads. Save in place and the save dialog run only in Electron.
- For a big real file, use `scripts/bigdoc.mjs`. Six real Verbatim files up to 17 MB are round-tripped by `tests/docx.test.ts` with `FALCON_DOCX` set, and they are not in the repo.
