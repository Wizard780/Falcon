# Templates

A user names a set of .docx files in Settings > Templates, then opens them all at once from the command center: `t ` and its name, or just its name, then Enter. The files open in the template's order and the user lands on the first. Desktop only, because it opens files by path.

## Sub-features

- `make` New template adds one, opened, with the caret in its name. Add files… picks several in the native dialog; a file it already has stays put. x removes a file. Delete takes two clicks.
- `find` `t ` lists every template as a TPL row. A template's name finds it with no prefix, and a file's name in it finds it more weakly.
- `open` Enter opens every file in order and goes to the first. A file that's already open isn't opened twice, and an untouched blank tab is replaced.
- `missing` A file that won't open doesn't stop the rest, and the message names it.
- `allow` The picker is what lets `falcon:open-path` read the files, for good, in `template-paths.json`. They never need to be recents. Anything never picked is still refused.
- `keep` Templates survive Restore defaults and go through a settings file. On another computer, a file not in a search folder has to be picked again with Add files….

## How to get to it (user POV)

- Settings > Templates.
- Mod-Shift-Space, then `t ` or a template's name. `s templates` leads to the Settings page, and Tab on a TPL row goes to its row there.

## Driving it with falcon-verify

Preconditions:

- `npm run build` is current. This goes through `window.falcon`, so it's proven in Electron, not by a web journey.

- **Everything.** Run `node scripts/templates-e2e.mjs`. It launches Electron with no visible window and a stubbed file dialog, and exits 0 with 13 `ok` lines. Set `TPL_SHOTS=<folder>` to keep screenshots.
- **Logic.** `npx vitest run tests/templates.test.ts` covers the prefix, ranking, storage, Restore defaults and the settings file.

## Gotchas

- The script restarts the app between making the template and opening it, on purpose: the files are never recents, so only the template's allowance can open them.
- A web drive shows the Settings page's desktop-only note and no TPL rows, which is not a failure.
