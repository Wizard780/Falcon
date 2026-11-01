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

## Next action
Merge PR #2. Next by value: card numbering, send-to-speech, comments. Paste from a live Word clipboard once on a machine where opening Word is fine.
