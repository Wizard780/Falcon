# Falcon on launch

When Falcon starts on Home, a falcon (drawn feather by feather, its eye ring and cere in the pen color) sweeps in over Home from the bottom left, banks round and lands on its perch in the strip above the date. Home's own layout never moves. Any key or click lands it at once. Perched, it holds still.

## Sub-features

- `flight` the falcon flies over Home on a page load that starts on Home, about 2.5 s, wingbeats slowing into a glide and a pen-colored trail behind it.
- `perch` it ends in `.hm-perch` (118x65, above `.hm-date`, lined up with it) and stays there with no animation running.
- `skip` any key or click mid-flight lands it straight away.
- `setting` Settings > Appearance > Falcon on launch (`falcon.launchFalcon`, on by default, also in the command center) turns the flight off; the falcon is then perched from the start.
- `reduce-motion` Reduce motion (the setting or the OS) skips the flight the same way.

## How to get to it (user POV)

- Start Falcon with Open on launch set to Home (the default), or reload the page.
- Settings > Appearance > Falcon on launch, or the command center.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/launch-falcon.mjs`. It starts the app itself without the Escape `openFalcon` presses, films the flight, and checks the landing, the layout, the setting, Reduce motion and a key mid-flight. Eight `ok` lines.
- **Layout.** It compares the boxes of `.hm-date`, `.hm-hi`, `.hm-sub`, `.hm-acts`, `.hm-clock` and `.hm-main` during the flight, after it, and with the setting off. All three must match.
- **Proof.** `evidence/launch-falcon/` holds `flight-0250.png` to `flight-3200.png`, `perched.png`, `layout.txt` and `results.txt`.

## Gotchas

- `openFalcon` presses Escape at load, which lands the falcon at once, so other journeys never wait for it.
- The flight plays once per page load. Opening Home again later doesn't replay it.
- The bird is built from `falconSvg()` in `src/ui/falcon.ts`; wings are `[data-wing="near"]` and `[data-wing="far"]`.
