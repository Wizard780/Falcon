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
(fill in)

## Stages
- [ ] scaffold (vite + react + PM + electron)
- [ ] schema + commands + keymap → probe parity
- [ ] chrome (toolbar, outline, status bar)
- [ ] mouse selection
- [ ] docx import/export
- [ ] electron shell + CI
- [ ] review + PR

## Next action
Scaffold the app.
