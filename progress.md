# Falcon v1 editor: progress

## Task
First working Falcon: Electron app (Mac + Windows), whose editor feels close to 1:1 with CardMirror (CM).
Editing mechanics come first: underline, highlight, emphasis, cite, headings, card boundaries.
CM is a reference only. Read its manual and run its behavior, but write Falcon's own code.

## Done means
1. `node scripts/probe.mjs falcon` gives the same mark map as CM (`shots/probe-cm.json`) on every case,
   except cases listed under "Known differences" with a reason.
2. The side-by-side page screenshots (`scripts/scenario.mjs cm|falcon`) show the same structure and marks.
3. Mouse: double-click word, drag by word, triple-click paragraph, click-drag snaps to words after the first word.
4. Chrome follows the approved prototype (`prototypes/falcon.html`): two-row formatting grid where each button previews its style,
   outline docked on the page's left with 1–4 levels (on by default), slim left rail, and status bar.
5. Open and save Verbatim .docx (round-trip test passes), and plain-text paste with F2.
6. `npm test` passes, `npm run build` passes, and the Electron app launches headless and renders the editor.
7. CI builds Mac and Windows (GitHub Actions matrix).

## Baseline (2026-11-01)
- Repo had no code (README only). CM web build served from `~/Downloads/debateskills/_work/cardmirror/dist` on :5301.
- CM probe results are saved in `shots/probe-cm.json`.

## Decisions
- Flat paragraph model (`paragraph` with `style` attr), like Word/Verbatim, instead of CM's card containers.
  Card boundary behavior comes from keymaps.
- Plain CSS taken from the prototype, not Tailwind. The editor chrome is small, and Tailwind adds nothing here yet.
- Default body font is Calibri (Verbatim default), falling back to Carlito and Arial.

## Known differences from CM
- F5 (Hat) and Alt-F8 (copy previous cite): CM's web build can't use these keys in the browser, so the probe
  shows a difference. Falcon does what CM's manual describes.
- Card numbering, comments, multi-doc workspace, collab, AI, and installer signing aren't built yet.
- Native drag-and-drop of selected text is off (CM's page drag also needs Mod-Shift-Alt).

## Stages (results)
- [x] scaffold: Vite + React + ProseMirror + Electron
- [x] schema + commands + keymap: probe 48/50 cases match CM (the 2 left are the CM web-key limits above)
- [x] chrome: two-row toolbar with style previews, docked outline (levels 1–4, counts), status bar with read times
- [x] mouse selection: all 8 gestures in scripts/mouse.mjs match CM exactly
- [x] docx import/export: 6 real Verbatim files (up to 17 MB, 10.8k paragraphs) round-trip exactly; python-docx reads the export
- [x] electron shell: headless smoke test passes; packaged .app launches; saves limited to user-chosen .docx paths
- [x] perf: 10.8k-paragraph file types at ~22ms dispatch-to-frame (tiny doc floor is 16.7ms), opens in ~3s
- [x] find bar, heading jumps, card moving
- [x] subagent review, PR #1 merged, CI green
- [x] release v0.1.0 published (CI-built arm64 dmg + Windows NSIS exe): https://github.com/Wizard780/Falcon/releases/tag/v0.1.0

## Failed attempts
- Electron in tests: ELECTRON_RUN_AS_NODE=1 is inherited from the host app here and turns Electron into Node. Scripts unset it.
- Hidden Electron windows have no OS focus, so the browser's own caret keys (Shift-Arrow) do nothing in tests. The smoke test selects through the editor.
- CM's Open uses showOpenFilePicker. The side-by-side script deletes it so CM falls back to a file input.
- Bisecting the 'oB' typing bug by commit was misleading: it was timing-dependent. A pause sweep (fails at 0ms, passes at 50ms) pointed at layout, not code.
- Leaving clicks inside a selection to the browser caused a late caret collapse after double-click. Now the editor handles every plain press.

## Stage: chrome matches the prototype; one v0.1.0 release (2026-11-01)
User report: the first release didn't look like prototypes/falcon.html, the scrolling animations differed,
and the Mac app opened as "damaged" without showing up in Privacy & Security.
Done means:
- Editor screen matches the prototype's editor screen (shots: /tmp/fcmp proto-doc vs app-doc): 56px file strip
  with a hover files panel, docked outline (sliding lit pill, sliding 1-4 highlight, filter, hidden tick strip with peek, Cmd-\),
  centered Classic two-row toolbar, graphite status bar.
- Home at launch and on Cmd-T (date, beam title, matrix clock, New/Open, recents with peek and undoable Clear).
- Scrolling: outline click scrolls smoothly; the lit row follows the scroll position, not the caret; the outline list follows it.
- Parity unchanged: probe 51/53, mouse 8/8, Word paste OK; npm test and build pass; Electron smoke passes.
- Mac DMG is ad-hoc signed and passes codesign deep strict verification (the 0.2.0 one wasn't: that was "damaged").
- Old releases v0.1.0 and v0.2.0 deleted, and one new v0.1.0 published from the merge commit.
Results:
- [x] chrome + home ported from the prototype's own CSS/JS (side.css, unslop.css, home.css, top-api.js Classic, kit.js, beam.js)
- [x] probe 51/53, mouse 8/8, paste OK, smoke OK (Home at launch, Esc closes, openPath refuses unpicked files)
- [x] big file: scroll median frame 16.7ms with the outline tracking; jump to the last heading lands at 16px
Decisions:
- Toolbar keeps the prototype's grid; Send became Read (no send-to-speech yet), line weight became Shrink.
- Recents reopen through a main-process list of dialog-picked paths (userData/recent-paths.json); nothing else is readable.
- Home has no favorites, tournament line or speech-doc button: there's no real data behind them yet.
Failed attempts:
- Native smooth scrollTo with a scrollend correction landed thousands of px short on big files (estimated heights
  from content-visibility). A rAF scroll that re-reads the target each frame lands exactly.

## Stage: rail, several open docs, font size, Settings (2026-11-01, PR from rail-tabs-settings)
User report (two scrawls): the hover files panel is gimmicky and can't open files; hiding the outline is hard to undo;
at depth 3 a block's chevron didn't show its tags; no way to switch between open files; no font size readout; no settings;
"can't save as". (Cmd-S did write the file: the edit was on disk. The missing piece was a visible Save / Save As.)
Done means / results (scripts/ui-check.mjs, 20/20 ok):
- [x] fixed rail: Home, New, Open, Save, Save As, Find, Outline, Read; Settings at the bottom. Hover panel removed.
- [x] several open docs: Open adds a tab (a blank Untitled is replaced), list above the outline, x closes (asks if unsaved),
      Ctrl-Tab / Mod-Shift-[ ] cycle, Mod-W closes; undo history and scroll kept per doc
- [x] depth 3: a block's chevron shows its tags
- [x] font size box (reads the selection, list of sizes); Settings (zoom, timer length, outline, shortcut list)
- [x] Mac File menu (labels only: registerAccelerator false, the page handles the keys)
- [x] crash recovery (falcon.autosave.v2) keeps every unsaved doc, not just the active one; quitting with unsaved docs asks
- [x] Settings and read mode block doc-swapping keys and menu items
- [x] probe 51/53, mouse 8/8, smoke OK, npm test + build OK
Decisions:
- Open files are listed in the outline pane, not a tab strip, so the toolbar keeps its two rows.
- Tests run Electron with FALCON_USER_DATA (a temp profile). Before this the smoke test wrote into the user's real profile.


Merge PR #2. Next by value: card numbering, send-to-speech, comments. Paste from a live Word clipboard once on a machine where opening Word is fine.

## Stage: tools row, files in the rail, prototype Settings (2026-11-01)
User recording: move the rail's file/view buttons into a row above the outline, put open files back in the rail, and make Settings look like prototypes/falcon.html.
- [x] `.tools` row (New, Open, Save, Save As | Find, Outline, Read) sits above the outline, level with the toolbar's second row and the logo
- [x] rail: Home, one button per open doc (hover name, hover ×, middle-click closes, unsaved dot, scrolls past ~8 docs), Settings
- [x] Settings: section nav with search (/), breadcrumb, Restore defaults, cards of rows; only settings that work (highlighter, zoom, outline, depth, speech length, keybindings)
- [x] checks: ui-check 28/28, vitest 32 pass, electron smoke passes, review fixes (inert behind Settings, rail overflow, stale tooltip)
- Note: the toolbar needs a ~1100px window to show in full; narrower, it packs closer and scrolls sideways.

## Stage: tables, pictures and footnotes (2026-11-02, branch tables-images)
Gap from cardmirror-gap.md: opening a file with tables, images or footnotes and saving it flattened or lost them,
the only gap that could destroy a user's work. The user also asked for easier editing and resizing, and for
pasted tables and pictures to be easy to edit.
Done means:
- Real files open with their tables (spans, merges, shading, header rows), pictures and footnotes, and a save → reopen gives the same document.
- Saved files are valid Word packages (python-docx reads them, every part is well-formed XML) with no text lost against the originals.
- Columns and pictures resize by mouse. The table bar, Tab between cells, footnote editing and insert, and paste of tables and screenshots all work in the real app.
- npm test, tsc, build, every verify-falcon journey and the Electron smoke test pass.
Results:
- [x] 12 real debate files from ~/Downloads (up to 872 pictures, 14 tables, footnotes) round-trip exactly. python-docx opens every save. Text is unchanged except no-break hyphens (already written as characters before this) and Word's duplicate text-box fallback, now read once.
- [x] vitest 213 pass (28 new in tests/media.test.ts). A second review found 5 more (a lone footnote or picture lost on cut/paste, crop lost on copy, bad picture data failing a save, nested layout tables, cell-only borders): fixed. Subagent review: 9 important findings fixed (footnote popup focus on arrow keys, shift-click cell selection, footnote links, per-keystroke footnote scan, borders, crop, unsupported picture types, motion/Enter in cells, fetching on open) plus the low ones (sanitized pasted footnotes and cell colors, adjacent tables, sticky broken overlay, multi-picture order). Journey tables-images-footnotes: 43 ok; all 13 journeys pass after merging main (smart paste rework). Typing on the 871-picture file: 16.7ms median, 20ms p90 (crash-recovery autosave stores each picture once; before that fix, p90 was over 1s). The other 10 web journeys and desktop-shell pass.
Decisions:
- prosemirror-tables for tables (column resizing, cell selection, fixTables), the one new dependency.
- Pictures are data URLs in the document, so big picture-heavy files hold their bytes in memory. A web picture that can't be fetched stays a linked picture.
- Footnotes are one-character atoms carrying their note as JSON, so find, read times and positions are unaffected and cut/paste/undo carry the note whole.
- Floating pictures open in line with the text (their position is lost, the picture isn't). Text boxes come out as paragraphs after their line. Tables nested in a cell are flattened into that cell.
- An inner column edge takes width from its neighbour, like Word, so a table stays page-wide. A document always ends with a paragraph after a final table.
- Table borders: a table with lines saves with plain single lines (custom border colours aren't kept); a table Word draws without lines stays without them (shown with faint dashed guides). Cell shading, widths, spans and header rows are kept.
- Word's picture crop (srcRect) is kept and shown. Endnotes open as footnotes so their text is kept (they save as footnotes).
- Pasted pictures in formats Word can't hold (WebP, AVIF, SVG…) are redrawn as PNG on the way in. Opening a file never fetches the web pictures linked inside it; only pasted ones are fetched.
- Charts, SmartArt, shapes and OLE objects without a picture are still dropped on open (as before this work); pictures inside footnotes too.
Open:
- Word's own clipboard gives pictures as file:// paths the page can't read, so a mixed text+picture copy from Word brings the text only. Copying the picture alone, or a screenshot, works.
- Not opened in Microsoft Word itself (no Word launch here). Package structure matches Word's own output and python-docx reads it.

## Stage: command center (2026-11-02, branch command-center)
User ask: CardMirror's Mod-Shift-Space control center, but it does everything and more. Files and the quick-card library stay out: a co-founder is building those (Cmd-K) and will join them in later.
Done means / results:
- [x] Mod-Shift-Space opens a bar laid out like CardMirror's Search Everything (low over the page, results above the box, hint strip, badges, one Esc closes, Enter on a toggle flips it, Enter on a cycle steps it)
- [x] every key binding, fixed key and toolbar action is a command (unit test fails if a new binding or pref is missing); every Settings row is a Toggle or Cycle row
- [x] beyond CardMirror: choice lists (Tab), typed choices (`light`), typed values (`zoom 150`, `14pt`, `card 12`, `depth 2`, `speech 6`), headings and cards by cite in the open file with page peeking, find/replace rows, Shift-Enter keeps it open, Mod-Z undoes the doc from it, Tab opens the row in Settings, recents, fuzzy and initials matching, dimmed rows that can't run here
- [x] vitest 181 pass, build passes, journeys command-center 35/35 plus keybindings, settings, file-search, card-formatting, find-replace, outline all ok, electron smoke ok
Decisions:
- Sources live in `src/ui/cc-sources.ts`; a files/library source can be added beside them without touching the UI.
- Settings rows read and write the same prefs as Settings; labels match Settings rows so Tab lands on them.
- Not driven in Electron: the palette itself (the smoke test only proves the desktop app still launches and renders).

## Stage: performance (2026-11-02, branch perf)
User ask: app is bloated, slow and CPU-heavy; at least 50% faster, optimise React, drop bloat dependencies, shrink the bundle, OK on weak internet, better with large files. Show a chart per goal.
Done means: each goal measured before (origin/main build) and after with `scripts/perf.mjs` (headless Chromium, median of 5, 5 real files up to 30 MB of document.xml), output unchanged (import: old vs new toJSON on 655 real files; save: every saved part byte-identical on 3 files), npm test, tsc, build, Electron smoke and a real Electron open/save/reopen of the 30 MB file pass.
Results (30 MB Nordics file unless noted; perf-results/before.json, after.json, report.html):
- [x] open 5.23 s -> 0.98 s (-81%); 20 MB 3.46 -> 0.74 s (-79%)
- [x] CPU per keystroke 73 -> 23 ms (-68%); per scroll frame 54 -> 23 ms (-57%); key to screen 67 -> 28 ms
- [x] save freeze 602 -> 232 ms (-61%), same bytes
- [~] first-screen JS+CSS 250 -> 162 KB gzipped (-35%); all JS 741 -> 553 KB (-25%); ready to type on slow 3G 5.95 -> 4.21 s (-29%). Below 50%: what's left on the first screen is the editor engine (ProseMirror ~216 KB, Preact, the editor)
- [x] idle CPU already ~0 before and after (the 36 ms/s seen at first was Home's one-time title sweep); JS heap after GC unchanged
What did it:
- DOMParser (3.1 s of a 4.9 s open) replaced by src/docx/xml.ts, a small reader with the DOM calls the importer uses
- react-dom -> preact/compat: react-dom saved the selection before every render by walking every text node of the focused editor (~30 ms/render on big files)
- content-visibility: auto -> hidden unless src/editor/window.ts marks a paragraph near the screen; the browser's per-paragraph intersection observers cost ~18 ms per key and scroll frame
- big saves zip in fflate's workers; clean text skips escaping
- Settings, command center, Cmd-K and the .docx code load on first use and at idle
Decisions:
- Far off-screen paragraphs are content-visibility: hidden, so screen readers don't see them (auto kept them readable).
- Preact 10.29.8, not the new 11.x major. React's API stays the source of truth (@types/react, aliases in vite.config.ts).
Failed attempts:
- No content-visibility at all: 97 ms per key and 3.2 s open. The skipping is needed; only who decides changed.
- React.lazy + Suspense for the modals: the re-render lands outside Preact's act in tests; replaced by a small `later()` loader.
Open:
- Find selects a match but doesn't scroll to it (main does the same; not from this work).

## Stage: home redesign (2026-11-02, branch home-redesign)
User: the home screen was "very ugly". Picked: recent files first, quiet like the editor, cut the animated title; then a list with a preview, more background, the app's own fonts, square buttons.
- [x] header: date, a greeting by time of day, file and card counts, New / Open, the dot clock (kept)
- [x] recent files as a list (tile, name over folder and cards, when); ↑↓ or hover picks one, click or Enter opens it
- [x] beside it the picked file drawn as a page in Verbatim's styles (pocket, hats, blocks, stand-in cards highlighted in the pen color), a second sheet under it, a glass caption with Open
- [x] background: the dot field, a light from the top left, a glow in the pen color behind the page; no title beam (removed from home-fx.ts)
- [x] empty state: a blank Untitled page with New document; under ~960px of room the page hides and the list fills the width
- [x] vitest 307 pass, tsc clean; journeys settings, themes, open-save-docx, desktop-shell pass; driven in the web build (keys, hover, 1440/1100/860 widths, empty)
