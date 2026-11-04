# Recent documents (Ctrl-Tab)

Ctrl-Tab switches between open documents in most-recently-used order. A quick tap flips to the doc you were on before. Held, a glass switcher draws after 150ms with a small page preview of every open doc (from where each was scrolled), most recent first; each Tab moves the lit card, and letting go of Ctrl opens it.

## Sub-features

- `tap` Ctrl-Tab tapped and released opens the last doc; tapped again, flips back. No switcher draws.
- `hold` Ctrl held: `.sw` lists every open doc as `.sw-it` (preview `.sw-doc`, name `.sw-nm span`), the current doc first, the last doc lit (`data-on`).
- `walk` Tab (or arrows) moves forward, Shift-Tab backward, wrapping; nothing switches while held.
- `pick` letting go of Ctrl, Enter, or clicking a card opens it; Esc or a click outside closes it on the current doc.
- `keys` both keys are `recentDoc` / `recentDocBack` in Settings > Keybindings; the held key is the binding's modifiers (a lone F-key just switches). Positional Next/Previous open document keep Mod-Shift-] / [.

## How to get to it (user POV)

- Ctrl-Tab / Ctrl-Shift-Tab (both platforms).
- Command center: "Switch to recent document" (switches straight to the last doc).

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/recent-docs.mjs`. It exits 0 with 14 `ok` lines.
- **Hold.** `page.keyboard.down('Control')`, `press('Tab')`, wait 350ms: `.sw` shows; `keyboard.up('Control')` opens the lit doc.

## Gotchas

- `keyboard.press('Control+Tab')` is a tap (down and up at once): it never draws the switcher. Hold with `keyboard.down`.
- Docs made with Mod-N are all named `Untitled`; check the lit card by its `.sw-doc` text, not its name.
