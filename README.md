# Falcon

A debate evidence editor for Mac and Windows (and the web) that reads and writes Verbatim `.docx` files.
The editor is built to feel like CardMirror and Verbatim: same keys, same formatting rules, same card structure.

## Run it

```sh
npm install
node node_modules/electron/install.js   # only if npm blocked Electron's download script
npm run dev              # web version at http://localhost:5173
npm run electron:dev     # desktop app against the dev server
npm run dist             # build the installer for this OS (.dmg on Mac, .exe on Windows)
```

CI (`.github/workflows/build.yml`) runs the tests, then builds the `.dmg` on macOS and the `.exe` on Windows.

## Install on a Mac

Falcon isn't signed with an Apple Developer ID yet, so the first launch is blocked.
Drag Falcon to Applications, open it once, then go to System Settings > Privacy & Security and click **Open Anyway**.
Or run `xattr -cr /Applications/Falcon.app` in Terminal, then open it normally.

## Keys

| Key | Does |
|---|---|
| F2 | Paste as plain text |
| F3 / Alt-F3 / Mod-Alt-F3 | Condense (keep paragraphs) / merge / merge with ¶ |
| Shift-F3 | lowercase → UPPERCASE → Title Case |
| F4 F5 F6 F7 | Pocket, Hat, Block, Tag |
| Mod-F7 / Mod-F8 | Analytic / Undertag |
| F8 | Cite (word at cursor if nothing selected) |
| Alt-F8 | Copy the previous card's cite |
| F9 / Mod-U | Underline toggle (F9: word at cursor; Mod-U: next typed text) |
| F10 | Emphasis (apply only; replaces underline) |
| F11 / Mod-F11 | Highlight / background color toggle (click the button with nothing selected for the paintbrush) |
| F12 | Clear formatting, keeping highlights |
| Mod-8 / Mod-Shift-8 | Shrink the card's unread text / regrow |
| Mod-Shift-Space | Command center: run any command, change any setting, go to any heading (CardMirror's Search Everything, minus files) |
| Mod-F | Find |
| ~ | Send the selection, or the card or section at the cursor, to the speech doc (the mic button in the tool row marks which file it is). The page can't type a ~ |
| PageUp / PageDown | Previous / next heading |
| Mod-Alt-Up / Down | Move the card or section |
| Ctrl/Alt-Up / Down | Previous / next paragraph |

Mouse: double-click selects a word, triple-click a paragraph, and drags extend by that unit. A plain drag snaps
to whole words once it leaves the first word. Shift-click extends by the last unit.

## Tests and parity checks

```sh
npm test                                   # unit tests (formatting keys, card edges, docx round trip)
FALCON_DOCX="a.docx:b.docx" npm test       # also round-trip real Verbatim files
node scripts/probe.mjs falcon              # editing cases, diffed against CardMirror (needs its web build on :5301)
node scripts/mouse.mjs falcon              # mouse gestures (compare with `cm`)
node scripts/side-by-side.mjs file.docx    # same file screenshotted in both apps
node scripts/bigdoc.mjs file.docx          # open time and typing latency
node scripts/electron-smoke.mjs            # desktop app, headless (run `npm run build` first)
```

CardMirror is a reference only: Falcon studies how it behaves but shares no code with it.
