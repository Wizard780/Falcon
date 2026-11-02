# Command center

A user presses Mod-Shift-Space (CardMirror's Search Everything key) and gets a bar low over the page with results above the box and a hint strip under it. One box runs any command, flips any setting (Toggle rows) or steps it to its next value (Cycle rows), sets values typed as text (`zoom 150`, `14pt`, `card 12`), and jumps to any heading or card in the open file, cards also by their cite. It also opens .docx files as DOCX rows: open docs, recent files and (desktop) the folders Settings > File search allows, the same files Cmd-K finds. The card library is not in it yet.

## Sub-features

- `open` Mod-Shift-Space opens it with focus in the box, and closes it again. An empty box shows the prompt line and recent rows only.
- `prefix` `c ` commands plus Toggle and Cycle rows, `s ` settings, `h ` (or `#`) headings in this file, `f ` files (with nothing typed: what's open and recent), `?` help. With a prefix and nothing typed, it browses the whole source, 50 rows at a time.
- `run` Enter runs the row and closes. Shift-Enter runs it and keeps the box open. Mod-Z and Mod-Shift-Z undo and redo the document from the box.
- `settings` Toggle rows flip on Enter, Cycle rows step to the next choice and say `Now → Next`, Tab (or →) lists a Cycle row's choices, typing a choice (`light`) lists `Theme: Light` directly.
- `doc` heading rows show a CardMirror badge (POC HAT BLK TAG ANL). Arrowing onto one scrolls the page there, Enter moves the caret there, and Esc puts the page back where it was.
- `values` `zoom N`, `N%`, `size N`, `Npt`, `card N` (or `#N`), `depth N`, `speech N`, `prep N`.
- `find` any text ends with Find “text” in this file and Replace “text”… rows, which open the find bar on it.
- `tab` Tab on a command opens Settings > Keybindings searched for it. Tab on a setting opens its Settings page searched for its row. Right-click does the same.
- `esc` one Esc closes it, or backs out of a choice list.

## How to get to it (user POV)

- Mod-Shift-Space anywhere except over Settings or a warning dialog, including on Home and in read mode.
- Settings > Keybindings, row "Search everything (command center)", to rebind it.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`, and the seed is open.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/command-center.mjs`. It exits 0 with 35 `ok` lines.
- **Open.** Press `${MOD}+Shift+Space`. `.cc input` has focus, `.cc-start` starts with `Type to search everything`, and `.cc-chips` holds the c, s, h and ? chips.
- **Command.** `f.select('Temperatures')`, open, fill `.cc input` with `hat`. `.cc-row[data-on] .cc-nm` is `Hat`, and Enter turns the line into `hat: Temperatures rose again.…`.
- **Toggle.** Fill `bold cites`. The current row is `Toggle Bold cites` with `.cc-tog[aria-checked="true"]` (its aria-label says On or Off). Shift-Enter flips it to `Off`, the box stays, and `<html>` gets `cite-plain`.
- **Cycle.** Fill `theme`, press Tab. the `.cc-chip` in the box reads `Theme` and the rows are the themes. Esc returns to `theme`.
- **Heading.** Fill `h warming`, Enter. The caret's paragraph is `Warming Block`. Filling `smith` lists `Growth is slowing` (its cite).
- **Proof.** `evidence/command-center/` holds `01-empty.png`, `02-browse-commands.png`, `03-typed-hat.png`, `04-toggle-off.png`, `05-theme-choices.png`, `06-light-theme.png`, `07-cite-search.png`, `08-tab-settings.png` and `results.txt`.

## Gotchas

- Use `page.fill('.cc input', …)` to set the query. Typing character by character works too, but `fill` avoids racing the ranking.
- Read mode and dialogs hold back the document-swapping app commands (New, Open, Close, Home, next/previous doc). Their rows show dimmed and do nothing.
- Undo inside the box acts on the document, never on the query text.
- The toast sits under the bar's bottom edge. Read `.toast` text rather than screenshotting it.
