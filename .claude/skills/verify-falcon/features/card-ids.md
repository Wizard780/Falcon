# Stable card ids

Nothing a user sees. Every heading (pocket, hat, block, tag, analytic) carries a hidden id that stays the same through typing, cut and paste, saves in Falcon and saves in Word. A pasted copy gets a new id. The id is saved as a hidden Word bookmark `_fc_<id>` at the start of the heading. Edit tracking, changes from disk and pending cards key on it, and Claude's python-docx scripts address cards by it.

## Sub-features

- `ids-on-open` every heading gets an id when a file opens; a file without ids opens clean (no unsaved dot).
- `ids-keep` typing, moving and cut-and-paste keep a heading's id; a copy gets a fresh one.
- `ids-save` Save writes one `_fc_<id>` bookmark per heading; reopening reads the same ids.
- `ids-word` Word keeps the bookmarks through its own edit and save (checked once by hand, 2026-11-03; not in the journey).

## How to get to it (user POV)

- Open any `.docx`, edit, save. There is no UI.

## Driving it with falcon-verify

Preconditions: a live run. `FALCON_DOC=<copy of a real block file>` drives a real file instead of the seed.

- Open… the file: `window.__falconView.state.doc` headings each hold `attrs.card` (8 lowercase letters/digits), all different; no `.doc-row i[aria-label="unsaved"]`.
- `f.select` text in a tag and type: that heading's `attrs.card` is unchanged.
- Mod-S: the download's `word/document.xml` holds one `w:name="_fc_…"` per heading. Reopen in a fresh context: same ids.
- Journey: `journeys/card-ids.mjs`.

## Gotchas

- The editor draws only paragraphs near the screen in a long file, so count ids from the editor state, not from `[data-card]` in the DOM.
- Ids are random per open until the file is saved once by Falcon (or a script writes the bookmarks).
