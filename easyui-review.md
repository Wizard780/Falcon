end_turn None
## Use
- **Spotlight Search** (https://easyui.site/components/spotlight-search): Serves as the ⌘K palette for jumping to blocks, files, and commands like "send marked copy" or "start prep," using the gliding active highlight. Replace the kbd pills with plain gray monospaced shortcut text on the right and drop any borders around results.
- **Sidebar** (https://easyui.site/components/sidebar): Serves as the hover files panel (Speech/Aff/Neg) that slides out of the slim icon strip, with the hover pill and the shared-layout active pill. Remove nested sections, collapse chrome, and dividers, then restyle it as the floating glass panel with small monospaced section labels, gray icons, counts on the right, and a single gradient pill on the active row.
- **Pill Navigation** (https://easyui.site/components/pill-navigation): Serves as the outline pane's 1–4 level buttons and the Speech/Aff/Neg switcher, as a dark glass pill with a sliding highlight. Drop the submenu dropdowns and keep it one row of plain labels.
- **Animated Number Morph** (https://easyui.site/components/animated-number): Serves as the speech timer and Aff/Neg prep time readouts, where only the changing digit rolls. Use monospaced tabular digits with no locale, currency, or compact modes, and turn the springs down so seconds tick calmly.
- **Undo Toast** (https://easyui.site/components/undo-toast): Serves the toasts for "Sent to SpeechDrop," "Block moved," and "Partner pass accepted," with a short undo window and pause on hover. Restyle it to the glass surface with one text color and make the countdown a faint fill rather than a ruled progress line.
- **Morphing Button** (https://easyui.site/components/morphing-button): Serves as the Send button, which moves through idle → linting → sending → sent/error in place, so pre-send lint results and SpeechDrop status never shift the layout. Keep it to a text and icon change with a single accent and no color-coded state backgrounds.
- **Split Button** (https://easyui.site/components/split-button): Groups the send actions in one pill: Send doc, with the chevron revealing One-card send and Marked-copy builder. Remove the seam line between the halves and show the menu as the same glass panel.
- **Peek Card** (https://easyui.site/components/peek-card): Serves the hover previews: the read log on a card ("read 6x, last at Glenbrooks R4"), hot-link targets in the outline, and novice jargon definitions. Strip the metadata rows, avatars, and borders down to two or three lines of plain text.
- **Focus Mode** (https://easyui.site/components/focus-mode): Serves the highlighted-only reading view and the live reading cursor by dimming everything except the card being read, with no layout shift. Use one dim level only and remove the scaling effect on the focused card.
- **DirectionalTooltip** (https://easyui.site/components/directional-tooltip): Adds tooltips to the icon strip and the two-row formatting grid, showing the style name and shortcut. Use plain glass with small type and no arrows or icons.

## Maybe later
- Recovery Ledger: could front block-level history ("this block before Harvard"), but its timeline markers and diff chrome need heavy stripping.
- UnfoldAccordion: fits fold memory and fold-to-level in the outline once that ships, as long as the chevrons stay gray and small.
- Selection Basket: useful for multi-card actions such as send, move, or archive dead blocks, but it adds a floating bar the core flow doesn't need yet.
- AI Response: a possible shell for Collapse advisor and tag honesty output, but the AI text quarantine styling has to be designed first and citations or feedback chrome removed.
- Loader: one calm variant could cover tag checks and Tabroom pulls, and is only worth adding if a spinner is needed at all.

## Skip
Rejected: dashboard and analytics pieces (charts, stat cards, heatmaps, tables, telemetry feeds), badge and chip components (Badge, Command Menu with category badges, Notification Bell, Avatar Stack), decorative effects (meteors, shaders, particles, glitch, charms, 3D cards, page transitions), marketing and auth pages (pricing, login, comparison), and novelty controls (gooey, liquid, magnetic, rainbow, dock). They break the banned list or add chrome a debater never touches mid-round.

## Caveat
EasyUI assumes React, Tailwind, and Framer Motion, while Falcon's prototype is vanilla HTML built by build.py on the zen-c snapshot. For now, port only the behavior (the spring constants, the layoutId sliding-pill technique, pause-on-hover timing) into vanilla CSS transitions and the Web Animations API on CardMirror Sleek tokens. Copy the components themselves only if the real app moves to React, and even then replace the Tailwind theme with Falcon's own tokens rather than EasyUI's.
