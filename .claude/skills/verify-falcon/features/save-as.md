# Save As

Save As opens Falcon's own dialog: a name field (the doc's name plus `.docx`, the name selected) and four kinds of save. As-Is writes the whole document and the open file becomes that copy. Send Doc, Read Doc and Marked Doc write a copy and leave the open file, its name and its unsaved dot alone.

## Sub-features

- `dialog` the tool row Save As button, Mod-Shift-S, Shift-click on Save and the desktop menu's Save As all open the dialog. Esc, Cancel or a backdrop click closes it; Enter in the name field saves As-Is.
- `asis` As-Is: the whole doc; the open file takes the new name and path.
- `send` Send Doc: analytics and undertags are left out; everything else, marks included, stays.
- `read` Read Doc: what read mode shows (headings, analytics, tags, cites, highlights, red markers; plus whatever Settings > read mode adds). Hidden text between two shown runs becomes one space; body paragraphs that flow together in read mode become one paragraph under the cite.
- `marked` Marked Doc: only marked cards, meaning cards (tag or analytic plus its body) whose text is all red (`#FF0000` or the Settings marker color; undertags don't count either way), under the pocket/hat/block headings they sit in. A red `Marked 3:15` reading stamp in a black card is not a marked card. No marked cards: nothing is written and a toast says so.

## How to get to it (user POV)

- The `Save As…` button in the tool row, or Shift-click on `Save`.
- Mod-Shift-S, and File > Save As in the desktop menu.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/save-as.mjs`. It exits 0 with 13 `ok` lines.
- **Open the dialog.** Click `.tools [aria-label="Save As…"]`. `.cf.sa` appears with `.sa-name` = `seed.docx` and four `.sa-mode[data-mode=asis|send|read|marked]` buttons.
- **Save a copy.** Click a `.sa-mode`; the web build downloads `seed.docx`. Reopen it with `f.open(path)` and compare mark maps.
- **Marked.** `fixtures/marked.docx` is the seed plus an all-red card under `Marked Block`; its Marked Doc is just that card under Seed Pocket / Seed Hat.
- **Original unchanged.** Switch back to the `seed` doc row: its mark map equals the one before the saves.

## Gotchas

- A reopened copy becomes the active doc. Switch back to the original before the next Save As, or the next copy is made from the copy.
- Switching docs means hovering the rail, which slides the files panel over the tool row; move the mouse away and wait before clicking the tool row again.
- The dialog fades in; wait ~400ms before a screenshot.
- In the desktop app the dialog is followed by the native save picker, prefilled with the name. A web drive never proves that step.
