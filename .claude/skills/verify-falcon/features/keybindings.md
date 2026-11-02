# Keybindings

Settings > Keybindings lists every shortcut as its keys. Click a shortcut and press new keys to change it: the field turns red and says "Type a shortcut", held modifiers show as they go down, Esc cancels, and Backspace or Delete alone removes the shortcut. A key that needs a modifier, belongs to another command, or that Falcon keeps (Undo, Copy, Quit…) shakes and the reason shows under the row's label. A changed shortcut gets a reset arrow; Restore defaults puts every key back. The editor, the toolbar tips, the Doc and Card menus, Home and the Mac File menu all follow the new key at once.

## Sub-features

- `record` click a field, press keys; saved as `localStorage['falcon.key.<id>']` (keymap names like `Mod-Shift-y`, `''` = no shortcut).
- `refuse` taken or kept keys are refused with a reason (`F9 is already Underline`).
- `cancel/remove` Esc cancels, Backspace removes, the arrow resets one, Restore defaults resets all.
- `effect` editor commands (Tag) and app commands (Find) answer to the new key, not the old one.
- `unbound` Doc and Card menu tools start with no shortcut ("Set shortcut") and can be given one.

## How to get to it (user POV)

- Settings (gear in the rail, or its shortcut), then the Keybindings pane. Searching Settings by a key (`F8`) finds its row.

## Driving it with falcon-verify

- **Journey.** `$V run .claude/skills/verify-falcon/journeys/keybindings.mjs`. It exits 0 with 21 `ok` lines.
- **Field handle.** `.st-keyb[aria-label^="Tag:"]` (aria-label is `<label>: <keys>. Change shortcut`); listening adds `data-listen`; the reset arrow is `.st-keyreset` in the same `.st-row`.
- **Proof.** `evidence/keybindings/` has the page, listening with ⌘⇧ held, the rebound row, the refusal, the new key tagging a line, and the restored page.
- **Mac menu.** Only the desktop shell shows it: launch with `_electron`, set `falcon.key.save`, reload, read `Menu.getApplicationMenu()` File > Save's `accelerator`.

## Gotchas

- While a field listens, no shortcut runs anywhere (`isRecording()`), so pressing ⌘, or Esc there goes to the recorder, not Settings.
- Fixed keys (Enter, Backspace, Tab, Mod-z/y, Mod-a/b/i/u, the Ctrl-/Alt-Arrow paragraph keys, Shift-PageUp/Down) and `~` (send to speech) can't be rebound.
