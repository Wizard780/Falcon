# Pending cards

Cards Claude added to a file (or that came in from disk) show on a light orange background until the user approves them. Each pending card has Approve and Reject on its tag. Approve keeps the card and clears the orange. Reject deletes the card: tag, cite and body, or a whole block when the block heading is pending. Both then move to the next pending card. The status bar counts them. Nothing orange is ever saved, so Word and Verbatim open the file clean.

## Sub-features

- `pending-open` a heading whose id bookmark is `_fcp_<id>` opens pending; its section (tag and body, or a block and its cards) is orange.
- `pending-approve` the Approve button or Mod-Shift-Enter keeps the card, clears its orange and goes to the next pending card.
- `pending-reject` the Reject button or Mod-Shift-Backspace deletes the card's section and goes to the next one; Undo brings it back.
- `pending-jump` outside a pending card the keys only go to the next one; `N pending` in the status bar does the same.
- `pending-save` save writes `_fc_` for approved cards and `_fcp_` for ones still pending, and no shading or highlight.

## How to get to it (user POV)

- Open a file Claude added cards to. Click Approve or Reject on an orange card, or press Mod-Shift-Enter / Mod-Shift-Backspace.
- Card menu > Review: Approve card, Reject card, Next pending card, Approve all pending cards (keys changeable in Settings > Keybindings).
- Click `N pending` in the status bar.

## Driving it with falcon-verify

Preconditions: a live run and `FALCON_DOC` set to a copy of a block file with `_fcp_` cards (make one with python-docx: copy a Heading 4 paragraph's `w:pPr`, add a run and `<w:bookmarkStart w:id="900" w:name="_fcp_c1aude01"/><w:bookmarkEnd w:id="900"/>` right after the `w:pPr`).

- Open… it: `.status .pend` reads `2 pending`; `.ProseMirror .f-pending` paragraphs have an orange background, the heading also `.f-pending-head`.
- Click `.status .pend`: the caret is on the first pending tag, a quarter of the way down the page.
- Click `.f-pending-head [aria-label="Approve card"]`: that heading's `attrs.pending` is false, the caret is on the next pending tag.
- Press `${MOD}+Shift+Backspace`: that card's paragraphs are gone.
- Mod-S: no `_fcp_` in `word/document.xml`, no `w:shd`/`w:highlight` added. Journey: `journeys/pending-cards.mjs`.

## Gotchas

- The buttons are a widget inside the tag (`contenteditable=false`): click them with a real click, not by setting the selection.
- A pending block covers every card under it; approving it approves them all.
