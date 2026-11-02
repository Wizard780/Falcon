---
name: verify-falcon
description: Launch and drive the real Falcon debate-evidence editor (React + ProseMirror web build in headless Chromium, plus the Electron desktop shell) to prove a change works the way a user would see it: F-key card formatting, .docx open/save, the outline pane, find and replace, Settings. Use before calling any Falcon UI or editor change done, or when asked to run, screenshot or demo Falcon.
---

# Verify Falcon

Falcon is an Electron app whose whole UI is one web page (`dist/index.html`). Every behavior except the
OS bridge (native file dialogs, save-in-place, clipboard, window close) can be driven in headless
Chromium against `vite preview`, which is what this skill does. The Electron shell has its own smoke
script (see `features/desktop-shell.md`). There is no backend, no auth and no database: state is the
open documents plus `localStorage` (`falcon.*` keys).

Paths below are relative to the repo root. `V=.claude/skills/verify-falcon/bin/falcon-verify`.

## Launch

```sh
V=.claude/skills/verify-falcon/bin/falcon-verify
$V launch            # npm run build, then vite preview on a free 127.0.0.1 port
$V launch --no-build # reuse dist/ as is (only when dist/ is already current)
```

Ready is the line `READY <run-id>`, printed only after a headless browser saw the editor
(`.ProseMirror`) mount. Ready means usable, not just a port that answers. Launch prints the URL, the
server pid, the commit it built and `evidence  /tmp/falcon-verify/<run-id>/evidence`. Each run gets
its own port and its own folder, and each drive opens a fresh browser context with `localStorage`
cleared, so many drives can share one run. Only one run per checkout can be up, because a second build
would empty the `dist/` the first server is serving. `launch` refuses and names the live run. To run
side by side, use separate worktrees. `/tmp/falcon-verify` is shared by every checkout and session.
Commands with no run id pick the newest live run from this checkout only. Pass the id explicitly
whenever you are not sure. Never drive a vite server you did not launch: the
user's `npm run dev` (:5173) or a hand-started `vite preview` (:5190, the port the older
`scripts/*-check.mjs` assume) belong to someone else.

## Doctor

```sh
$V doctor [run-id]   # default: newest run
```

Read-only. Checks that the server pid is alive and is still this run's `vite preview`, the port's
listener is our process, the run's checkout HEAD matches the commit that was built, `dist/` is the
build the run served, no build input (`src/`, `public/`, `index.html`, `vite.config.ts`,
`package.json`) is newer than `dist/`, and the page renders the editor with title `Falcon` and no page errors. Any `FAIL` exits 1. Run it
first whenever a result looks wrong. A "build inputs changed after dist/ was built" failure means you are
testing stale code: `cleanup`, then `launch` again.

## Drive

Drive scripts are plain Node ESM files run through the helper, which hands them the run's URL and
evidence folder:

```sh
$V run [run-id] .claude/skills/verify-falcon/journeys/open-save-docx.mjs
$V run my-check.mjs  # your own script, anywhere
```

The journey scripts in `journeys/` drive each mapped feature end to end and exit non-zero on any
`FAIL`. To write your own, import the library by absolute path:

```js
import { openFalcon, SEED, MOD } from '/abs/repo/.claude/skills/verify-falcon/lib/falcon.mjs';
const f = await openFalcon('my-feature');   // fresh context, localStorage cleared, Home dismissed
await f.open(SEED);                          // tool row Open… -> file chooser
await f.select('two percent');               // editor selection over exact text
await f.page.keyboard.press('F9');           // real key
f.want((await f.markMap()).includes('{underline}'), 'F9 underlines');
await f.shot('after-f9');                    // evidence/<feature>/NN-after-f9.png
await f.save('out.docx');                    // Mod-S; the web build downloads the file
await f.done();                              // writes results.txt, sets the exit code
```

Stable handles (from `src/ui/App.tsx`, `Outline.tsx`, `FindBar.tsx`, `Settings.tsx`):

- Tool row: `.tools [aria-label="New document" | "Open…" | "Save" | "Save As…" | "Find" | "Outline" | "Read mode"]`.
- Rail: `.fstrip [aria-label="Home"]`, `.fstrip [aria-label="Settings"]`; open docs are `.doc-row .doc-nm[aria-label="<name>"]`, with `i[aria-label="unsaved"]` when dirty.
- Format grid buttons carry a `title` that starts with the label and key, e.g. `Tag (F7): …`. Keys: F4 pocket, F5 hat, F6 block, F7 tag, Mod-F7 analytic, Mod-F8 undertag, F8 cite, F9 underline, F10 emphasis, F11 highlight, F12 clear.
- Outline rows: `.sb-row.ol.l1`–`.l4` (`data-i`, lit row has `data-on`); depth buttons `[aria-label="Show pockets" | "Show down to hats" | "Show down to blocks" | "Show down to tags"]`.
- Find bar: `.findbar`, inputs `input[placeholder="Find"]` and `.findbar .fb-with` (`placeholder="Replace with"`), match counter `.findbar .count` (`1/1`).
- Settings: `[aria-label="Settings sections"] button` (General, Appearance, Editor, Formatting, Keybindings, Speech and timers), `[aria-label="Search settings"]`, `[aria-label="Close settings"]`.

Read-only state hooks for evidence: `window.__falconMarkMap()` (one line per paragraph:
`style: text` with `[run]{marks}`) and `window.__falconView` (the ProseMirror view). Read state through
them. Do not dispatch edits through them as proof of a user path. The one allowed exception is
selection: a headless page has no OS focus, so Shift-Arrow and mouse-drag selection don't move the
caret. `f.select(text)` sets the selection the way a drag would end up. Mouse-gesture behavior itself
is covered by `scripts/mouse.mjs`.

## Evidence

Everything goes to `/tmp/falcon-verify/<run-id>/evidence/<feature>/`: numbered screenshots, the
mark map before and after, files the app saved, and `results.txt` with one `ok`/`FAIL` line per
check. Proof standards:

- Drive the real user path: keys, toolbar clicks, the Open file chooser, the Save download. Never
  `view.dispatch` an edit and call that proof.
- Capture the action and the result, not just the end screen: a mark map or screenshot before and
  after.
- Verify side effects alongside the screen. A save is proven by reopening the downloaded `.docx` in a
  fresh context and comparing mark maps. A setting is proven by its `localStorage` key and by its
  effect surviving a reload.
- The web build has no native dialogs or save-in-place. Anything that goes through `window.falcon`
  (the Electron preload bridge) is only proven by the desktop smoke script, not by a web drive.

## Cleanup

```sh
$V cleanup [run-id]  # kills the process group launch started, removes scratch/, keeps evidence/
$V list              # every run (up, down or stopped) and its evidence folder
```

Cleanup kills only the pid recorded at launch (and its group), never by process name, and only
after checking that the pid is still this run's `vite preview` (a dead server's pid can be reused). It renames
`state.json` to `state.stopped.json` and leaves `evidence/`, `server.log` and `build.log` in place.
Run it after every failed attempt too. `dist/` is the repo's normal build output and is left alone.

## Helpers

- `bin/falcon-verify`: launch, doctor, run, cleanup, list (usage in its header).
- `lib/falcon.mjs`: `openFalcon(feature, { storage })` returns `{ page, want, shot, markMap, select, open, save, done }`. `storage` pre-seeds `localStorage` before the first render.
- `journeys/*.mjs`: one proven journey per feature file.
- `bin/make-seed.mjs`: rebuilds `fixtures/seed.docx` by typing it in the app. Run it only when the
  seed must change, and keep `fixtures/seed.markmap.txt` in step.
- `fixtures/seed.docx`: pocket, hat, two blocks, two tags, a cite, underlined and highlighted body, and the word `needle`. Its expected mark map is `fixtures/seed.markmap.txt`.

Read `features/README.md` for the map of user-facing features and how to prove each one.
