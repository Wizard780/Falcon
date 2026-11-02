# Themes

Settings > Appearance > Theme picks the colors of the chrome and the page from a row of tiles, each a small picture of its theme: System (Light or Dark, following the OS live), Dark (the default graphite), Light, Night (graphite with a dark page), Midnight, Sepia and High contrast. New theme copies the one that's on into a custom theme, whose name and four colors (Background, Text, Paper, Paper text) then edit in place; every other chrome shade is the text mixed into the background. Document paper (Theme, White, Dark) overrides just the page. Nothing here changes the saved file.

## Sub-features

- `presets` seven tiles in `[aria-label="Theme"]`, stored as `falcon.theme` (a preset id, `system`, or a custom id).
- `custom` New theme, then the Theme name, Background, Text, Paper and Paper text rows; stored as a list in `falcon.themes`.
- `readable` a new Background or Paper its text can't be read on (contrast under 4.5) flips that text light or dark.
- `delete` Delete theme goes back to Dark or Light.
- `restore` Restore defaults selects Dark again but keeps custom themes (they live outside the prefs).
- `paper` Document paper Theme / White / Dark, stored as `falcon.paper`; the old `falcon.pageDark=on` becomes `dark` once.
- `system` System follows `prefers-color-scheme` without a reload.
- `desktop` the Electron window's background and native theme follow, and `userData/theme.json` keeps them for the next launch.

## How to get to it (user POV)

- The gear `Settings` at the bottom of the rail (or Mod-,), then `Appearance`.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`.

- **Journey.** `$V run .claude/skills/verify-falcon/journeys/themes.mjs`. It exits 0 with 23 `ok` lines across `themes`, `themes-reopen` and `themes-migrate`.
- **Pick.** Click `[aria-label="Theme"] [role=radio][aria-label="Light"]`. `document.documentElement.dataset.chrome` is `light` and `body` is `rgb(244, 244, 245)`.
- **Custom.** Click `[aria-label="New theme"]`, then `page.fill('input[aria-label="Background"]', '#203040')`. `body` turns `rgb(32, 48, 64)` at once.
- **Persist.** Reload: the custom theme is still applied and checked.
- **File.** Save under Night and reopen in a fresh context: the mark map is unchanged.
- **Desktop.** `scripts/electron-smoke.mjs` picks Light in Settings and checks the window background, `nativeTheme.themeSource` and `theme.json`.
- **Proof.** `evidence/themes/` holds `01-light.png`, `02-custom.png`, `03-system-dark.png` and `results.txt`.

## Gotchas

- Setting `falcon.theme` straight in `localStorage` does nothing until a reload: prefs are cached. Click the tile, or seed it with `openFalcon(name, { storage })`.
- jsdom has no `matchMedia`; unit tests stub it (`vi.stubGlobal`). `color-mix()` values are checked as strings there, and as computed colors only in a browser.
- `--ink` is set inline on `.app`, so the chrome's pen-colored marks use `--ink-ui`, declared on `.app` too (on light chrome it darkens the pen, or a yellow bar would vanish).
