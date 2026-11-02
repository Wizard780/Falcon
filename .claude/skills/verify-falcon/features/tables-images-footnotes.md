# Tables, pictures and footnotes

A user opens a Word file with tables, pictures and footnotes and sees them as they were: a table with its header row, cell shading, column spans and merged rows; pictures at their Word size; footnote numbers in the text with the notes listed under the document. They resize columns and pictures with the mouse, edit tables from the table bar and with Tab, edit and add footnotes, and paste tables and screenshots in as editable tables and resizable pictures. Saving writes all of it back as real Word tables, embedded pictures and footnotes.

## Sub-features

- `open-tables` opens `w:tbl` with tblGrid widths, `gridSpan`, `vMerge`, cell shading and `tblHeader` rows.
- `open-pictures` opens DrawingML (inline and floating, which come in as inline) and VML pictures at their size.
- `open-footnotes` opens `footnotes.xml` notes as numbered references with formatted note text.
- `column-resize` drags a column edge. An inner edge takes the width from the next column, and the last edge widens the table.
- `table-bar` shows a pill above the table at the cursor: rows, columns, merge, split, header, shade, even widths, deletes.
- `cell-keys` moves with Tab and Shift-Tab (each selects the cell's text, as Word does). Tab in the last cell adds a row.
- `cell-select` drags from one cell into another to select cells. Formatting keys and Merge act on them.
- `picture-resize` drags the corner handle (aspect locked, live size). Double-clicking the handle restores the picture's own size.
- `footnote-edit` opens a small editor when a number is clicked. Escape or Enter goes back to the text.
- `footnote-insert` puts a new note at the cursor with `Mod-Alt-F` or Doc ▸ Insert Footnote. Numbers follow document order.
- `paste` keeps tables (spans, shading, widths) from Word, Sheets and the web. Pasted or dropped picture files come in no wider than the page.
- `save` writes tables, embedded or linked pictures and footnotes, and reopens to the same mark map.

## How to get to it (user POV)

- Open a `.docx` that has them (tool row `Open…`).
- Click into a table: the table bar appears. Hover a column edge: a blue line shows, then drag it.
- Click a picture: its handle shows in the bottom-right corner.
- Click a footnote number, or a note in the list under the document.
- Doc menu ▸ Insert: Insert Table, Insert Picture…, Insert Footnote (`Mod-Alt-F`).
- Paste (`Mod-V`) or drop a table or picture.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`.
- `fixtures/media.docx` exists. Rebuild it with `node .claude/skills/verify-falcon/bin/make-media-fixture.mjs`. It holds a 4-row table (header row, D9D9D9 header shading, a 1x2 row merge, a 2x1 span with FFF2CC shading), a 360×203 chart, and two footnotes.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/tables-images-footnotes.mjs`. It exits 0 with 42 `ok` lines across the main and reopen folders (the reopen folder also checks crash recovery).
- **Open.** The page has one `table`, `td[colspan="2"]`, `td[rowspan="2"]`, three `th`, a `.f-img img` 360px wide, `.f-footnote` numbered `1` and `2`, and two `.f-notes li`.
- **Column edge.** `page.mouse` moves onto a cell's right edge until `.column-resize-handle` shows, then down, move and up. Widths are read from the cells' `colwidth`.
- **Table bar.** `.f-tbar button:text-is("Row ↓")`, `"Merge"`, `"Col →"`. The bar takes mousedown, so the editor keeps its selection.
- **Cells.** Click in a cell, then `Tab` or `Shift+Tab`, and type. Drag from one cell to another and `.selectedCell` count is 2.
- **Picture.** Click the `img`, then drag `.f-img-handle`. `.f-img-size` reads `480 × 271` mid-drag. `Mod-Z` undoes the resize in one step.
- **Footnote.** Click `.f-footnote`. `.f-note-pop` shows `Footnote N` and `.f-note-text`. Type, then Escape.
- **Paste.** Dispatch a `ClipboardEvent('paste')` on the editor with a `DataTransfer` holding `text/html` (a table) or a `File` (`image/png`). This is the browser's own paste path, so ProseMirror's handlers run.
- **Save.** `Mod-S`. The saved zip has `w:tbl`, `w:drawing`, `word/media/*` and `word/footnotes.xml`. A fresh context reopens it to the same mark map.

## Gotchas

- `End`, the arrows and `Mod-End` don't move the caret on a headless page. Use the journey's `caretAfter(text)`, the same selection exception as `f.select`.
- A narrower column wraps its text and makes rows taller. Measure a cell's box again after any resize before clicking it.
- Tab and Shift-Tab select the next cell's text, so typing replaces it (Word does the same).
- The mark map shows a table as `table N rows`, then `cell rRcC [CxR] [bg#HEX] [head] style: …`. Pictures show as `[image WxH]` and footnotes as `[^note text]`.
- A document never ends with a table: a blank paragraph follows one, as in Word.
