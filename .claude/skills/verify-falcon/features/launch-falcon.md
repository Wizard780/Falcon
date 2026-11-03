# Falcon on launch

When Falcon starts on Home, a falcon (drawn feather by feather, its eye ring and cere in the pen color) sweeps in over Home from the bottom left, banks round and lands left of the date, where it becomes the logo: the app icon's head drawn in detail (hood, mustache, heavy brow over a pen-colored eye ring, notched beak, hackles). Home has no greeting; the date and the line under it sit right of the logo. Home's layout never moves for the flight. Any key or click lands it at once. Landed, it holds still.

## Sub-features

- `flight` the falcon flies over Home on a page load that starts on Home, about 2.5 s, wingbeats slowing into a glide and a pen-colored trail behind it.
- `perch` it ends as `svg.falcon-logo` in `.hm-perch` (62x65, left of `.hm-date` and `.hm-sub`, centered on them), in one continuous hand-off (the wings fold, wings and body dissolve, the head blends into the logo, which rides on the bird's eye until it is down), and stays there with no animation running.
- `skip` any key or click mid-flight lands it straight away.
- `setting` Settings > Appearance > Falcon on launch (`falcon.launchFalcon`, on by default, also in the command center) turns the flight off; the falcon is then perched from the start.
- `reduce-motion` Reduce motion (the setting or the OS) skips the flight the same way.

## How to get to it (user POV)

- Start Falcon with Open on launch set to Home (the default), or reload the page.
- Settings > Appearance > Falcon on launch, or the command center.

## Driving it with falcon-verify

Preconditions:

- `falcon-verify doctor` is all `ok`.

- **Journey.** Run `$V run .claude/skills/verify-falcon/journeys/launch-falcon.mjs`. It starts the app itself without the Escape `openFalcon` presses, films the flight, and checks the landing, the logo's place and that the greeting is gone, the layout, the setting, Reduce motion and a key mid-flight. Ten `ok` lines.
- **Layout.** It compares the boxes of `.hm-perch`, `.hm-date`, `.hm-sub`, `.hm-acts`, `.hm-clock` and `.hm-main` during the flight, after it, and with the setting off. All three must match.
- **Proof.** `evidence/launch-falcon/` holds `flight-0250.png` to `flight-3200.png` (1950 to 2950 show the hand-off from bird to logo), `perched.png`, `layout.txt` and `results.txt`.

## Gotchas

- `openFalcon` presses Escape at load, which lands the falcon at once, so other journeys never wait for it.
- The flight plays once per page load. Opening Home again later doesn't replay it.
- The bird is `falconSvg()` and the logo `logoSvg()` in `src/ui/falcon.ts`; wings are `[data-wing="near"]` and `[data-wing="far"]`. The logo is the HEAD path from `logo/build-brand.mjs`.
