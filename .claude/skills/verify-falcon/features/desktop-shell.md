# Desktop shell

Falcon ships as an Electron app for Mac and Windows. The shell adds what the web build can't do: native Open and Save dialogs, save in place to a file picked before, recent files, the app menu, the clipboard bridge for F2 plain paste, and the unsaved-changes question on close. It all runs with no visible window.

## Sub-features

- `launch` the app loads `dist/index.html` and the editor renders, with the window never shown (`FALCON_HEADLESS=1`).
- `keys` real F-keys format a card in the desktop window.
- `bridge` the preload exposes only `openFile, openPath, saveFile, readClipboardText, onMenu, onConfirmClose, forceClose, platform`.
- `path-guard` `openPath` refuses any path that was not picked in a dialog before.
- `save-in-place` Save writes an already-open file without a dialog.
- `close-guard` closing with unsaved work asks first.
- `menu` the app menu has File, Edit and Window.

## How to get to it (user POV)

- Launch the installed app, or `npm run electron:dev` / `npm run electron:start` from the repo.
- The File menu, Mod-O / Mod-S, and the recents on Home.
- Closing the window or quitting.

## Driving it with falcon-verify

Preconditions:

- A run launched with a build, so `dist/` is current (`falcon-verify doctor` is all `ok`).
- `ELECTRON_RUN_AS_NODE` unset. `falcon-verify run` removes it.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/desktop-shell.mjs`. It exits 0 and prints `ok   electron smoke exit 0, window never shown: true`.
- **What it drives.** It wraps `scripts/electron-smoke.mjs`, which launches Electron with a throwaway `FALCON_USER_DATA` profile and checks Home at launch, Escape, typing a tag and body with F7, F9, F10 and F11, a stray `openPath` being refused, the drag regions, save in place, the bridge, the menu and the close guard.
- **Packaged app.** `FALCON_EXE=/path/to/Falcon.app/Contents/MacOS/Falcon $V run .claude/skills/verify-falcon/journeys/desktop-shell.mjs` drives an installed build instead of the dev tree.
- **Proof.** `evidence/desktop-shell/` holds `transcript.txt` (command, exit code, stdout, stderr), `electron-<platform>.png`, `electron-confirm-<platform>.png` and `results.txt`.

## Gotchas

- Hosts like the IDE can set `ELECTRON_RUN_AS_NODE=1`, which turns Electron into plain Node. Always go through `falcon-verify run`.
- A hidden window has no OS focus, so the browser's own caret keys (Shift-Arrow) do nothing. The smoke script selects through the editor.
- The smoke script loads `dist/`, not `src/`. Relaunch (or `npm run build`) after editing `src/`, or you test stale code.
- It writes its screenshots to `shots/` in the repo root, which the journey creates. They are not cleaned up, because the journey copies them into evidence.
- macOS Gatekeeper, signing and the dmg layout are not covered. They need a real install from the GitHub release.
