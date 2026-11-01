# Falcon: new feature ideas (Claude API, claude-opus-5-5, 2026-10-29)

Generated from your feature list + debate-uploader v0.15.1 features + CardMirror fork perf work. None of these duplicate the existing list.

## In-round

- **Pre-send lint**: Before any doc goes to SpeechDrop or the chain, run a 200ms check for cards with no highlighting, missing or partial cites, leaked notes or comments, unresolved track changes, your name or school in docx metadata, and a filename that doesn't match "Tournament-Round-Side-Speech." Clicking a flagged item jumps to it. This catches the errors that start ethics challenges and embarrassing CX.
- **Tabroom pairing autofill**: When pairings drop, pull opponent, side, room, judge, and flight into the current round, create the speech doc names, and preload their wiki page. That removes about two minutes of fumbling during the window you should spend on strategy.
- **Judge strip**: Keep a slim, collapsible bar showing the five paradigm lines that matter: speed, K and theory stance, tech vs. truth, disclosure views, and "don't do X." Add your team's private notes on that judge from past rounds. You see it at the moment you're choosing what to collapse to.
- **Disclosure diff**: When the 1AC arrives, auto-compare it against their wiki disclosure and past round reports. Flag new cards, changed tags, and whether it's a new aff. You immediately know if disclosure theory or "new affs bad" is live and which cards to ask about in CX.
- **One-card send**: When they say "can I see that card," press one key on the card under your cursor to send it alone to the room or chain with a clear name. This avoids dragging it into a scratch doc mid-CX.
- **Round lock**: In Round mode, source files become read-only and only the speech doc and flow are editable. Accidentally retyping into your master file at 400wpm stops being possible.
- **Marked-copy builder**: After you mark where you stopped, one action builds the marked copy. It truncates cards at the marks, drops unread cards, stamps "MARKED," and sends it. Judges and opponents get it in seconds instead of after prep starts running.

## Prep & card cutting

- **Cite builder from URL/DOI/PDF**: Paste a link and get author, qualifications (scraped from bio pages), date, title, publication, and access date. It formats them in your team's cite style and lets you edit before insert. Cite quality is where most cards are weakest.
- **Full-paragraph clipper**: A browser extension that cuts from the article but enforces paragraph boundaries. It also saves an archived snapshot of the source alongside the card. This provides evidence-ethics protection, and Card Check works even after the article is paywalled or deleted.
- **Card identity & variants**: Detect when the same card lives in 14 files with different highlighting or tags. Show them as variants of one canonical card. Fixing a typo or bad cite can then propagate everywhere, or you can choose to keep variants.
- **Staleness flags**: Mark cards by age relative to their purpose. Uniqueness and "now" cards older than about 60 days get a warning, and anything predating a major event you define (an election or court ruling) gets flagged. Stale uniqueness loses rounds.
- **Style normalizer**: Paste or import a doc from another team's open source and convert their fonts, underline sizes, highlight colors, and heading styles to yours in one pass. This also strips their invisible formatting junk.
- **Answer coverage matrix**: Map the topic's common affs, DAs, and Ks against your files in a grid. Each cell shows whether you have a 2AC/1AR frontline, how many cards it has, and when it was last updated. Coaches can assign the empty cells.
- **Opponent evidence library**: Every opponent doc you receive auto-files into a deduped "Their Evidence" library, indexed by team and argument. Next time you hit them, their prior cards and your past answers are already linked.

## Flowing

- **Dropped-argument detector**: Highlight flow cells that got no response in the next speech column, with a count per sheet. The 2NR/2AR "they dropped X" list writes itself.
- **Shorthand dictionary**: Define your own flow shorthand ("ot" → "outweighs," "↑" → "increases," "NUQ" → "non-unique"). Store it short, then expand it on export or hover. You flow at speed without making the flow unreadable to a partner later.
- **Extend keystroke**: Select a cell and press one key to carry it into the next column as an extension, with an arrow and the original speech labeled. You can see the life of an argument across all speeches at a glance.
- **Order generator**: From the current flow, produce a roadmap ("T, CP, DA, case: solvency then adv 1") ordered by your sheets. Paste it to the judge or read it aloud. No more fumbling the order.
- **CX pinning**: During CX, type answers and press a key to pin each one to the flow cell it concerns, timestamped. Concessions show up exactly where you'll need them in the next speech.
- **RFD capture**: After the round, a template records the decision, ballot, speaker points, and the judge's key reasoning, attached to the flow and the judge's profile. Your judge notes and post-round redos come from this.

## Claude/AI

- **Tag honesty check**: Claude compares each tag against only the highlighted text and flags overclaims ("tag says 'extinction,' highlighting says 'conflict risk'"). It suggests a defensible tag. This makes your evidence harder to indict and keeps you ethical.
- **Unhighlighted context finder**: For opponent cards, surface caveats and qualifiers in the unhighlighted portions that cut against their tag. Each one comes with a ready-made CX question. This is the single best use of AI in-round.
- **Collapse advisor**: Before the 2NR/2AR, read the flow, drops, judge paradigm, and time left. Recommend what to go for, with one-line reasoning and the blocks to pull. It advises; you decide.
- **Re-highlight to time**: Ask Claude to cut a card's highlighting down to N words or seconds while keeping it grammatical and the warrant intact. Show the result as a diff before applying.
- **AI text quarantine**: Anything Claude generates is visually marked and can never be inserted into a card body or sent as card text. It can go only in analytics, tags (with confirmation), or notes. Fabricated evidence should be structurally impossible.
- **Offline local model fallback**: Offer a small local model for tag checks and summaries when tournament wifi is dead. Make it explicit when you're on local vs. Claude.

## Big docs & file management

- **Saved views (live virtual docs)**: Save a query like "cards tagged #heg, newer than Jan 2025, not read this season" as a doc that updates live. You can read from it or drag from it like any file.
- **Block-level history**: Every block keeps its own timeline. Scrub back to "this block before Harvard" and restore just that block without touching the rest of the file.
- **Read log per card**: Track which cards were sent in which speeches at which tournaments. Hover a card to see "read 6x, last at Glenbrooks R4." This helps you avoid repeating against the same team and spot dead weight.
- **Dead block finder**: List blocks never read or opened in the last N tournaments. Offer to archive them to a cold file so active files stay lean and fast.
- **Split/merge by pocket**: Split a 1,500-page file into per-pocket files, or merge several into one, while preserving hot-links, tags, and history across the boundary.
- **Fold memory**: Remember which headings are collapsed per file. Add one-key fold-to-level (show only pockets, only hats, or only blocks), so big files open in the shape you left them.

## Collaboration (partner/coach/team)

- **Partner pass**: During prep, your partner sends a block straight into your speech column with a ping ("2AC to Taiwan DA"). You accept or reject without them touching your doc. This replaces shouting across the table and USB swaps.
- **Live reading cursor**: Your partner sees exactly which card you're on as you read, advanced by a key or by scroll position. They can prep the next speech knowing what's been covered and mark you if needed.
- **Coach suggest mode**: Coaches leave suggested edits and comments that render like track changes but are excluded from every speech doc. Debaters accept or reject per suggestion, and coaches see a review queue per student.
- **Assignment board**: Coaches assign cutting tasks tied to coverage matrix cells, with due dates. When a debater finishes, it links to the actual blocks, and the coach checks them off after review.
- **Tiered team library**: Varsity can edit, novices get read-only copies they can fork, and private strategy files stay owner-only. Open-source-ready files are clearly marked as such.
- **Novice explain layer**: Hovering jargon (perm, link turn, uniqueness) shows a short definition. Add an optional "explain this block" mode for novices learning from varsity files.

## Feel & polish

- **Highlighted-only reading view**: Toggle a view that hides everything but highlighted text and tags, in large type. This is what you actually read at speed, without visual noise.
- **Timer cues**: Optional subtle sound or haptic at 1:00, 0:30, and the last 10 seconds of a speech or prep. You can keep your eyes on the doc instead of the clock.
- **Meaningful highlight palette**: Assign meanings to colors (yellow = read, green = later in round, blue = CX). Add one-key toggles to hide or show each layer. Pre-send lint knows to send only the "read" layer.
- **Focus dim**: Everything except the current card fades slightly while you read, and the next card is pre-scrolled into view. You never lose your place mid-speech.
- **Global undo with receipts**: Destructive actions across files (delete block, move pocket, send) show a toast with Undo. A history panel lists the last 50 cross-file actions.
- **Tournament-aware defaults**: The format (Policy/LD/PF) sets speech and prep times, speech names, and doc naming automatically. Override per tournament for odd prep rules.

## Reliability & performance

- **Keystroke journaling**: Every edit is written to a crash-safe journal. On restart after a crash or dead battery, everything is restored to the last keystroke. Losing a 2AC block mid-round is unacceptable.
- **SpeechDrop fallback chain**: If SpeechDrop fails, automatically try the email chain, then fall back to LAN, AirDrop, or a local QR code. The doc reaches the judge whatever the wifi does.
- **Pre-round health check**: One button tests SpeechDrop, Gmail auth, Tabroom login, battery, disk space, and unsaved files. Run it while walking to the room.
- **Battery saver mode**: Disable background watchers, animations, and indexing when battery drops below a threshold. Show estimated time remaining, so you survive a five-round day without an outlet.
- **Verbatim round-trip guarantee**: Run automated fidelity tests so any doc you send opens correctly in Word/Verbatim, with correct styles, heading levels, and highlighting. Opponents and judges shouldn't see breakage.
- **Peer sync without internet**: You and your partner sync over local network or Bluetooth when tournament wifi is down. Conflicts are resolved per block.

## Wild ideas

- **Clipping self-check**: Optionally record your speech locally and align the audio to the doc. Flag cards where you skipped highlighted words, and auto-place stop marks. You can defend against clipping accusations with evidence, or catch your own habits in practice.
- **Opponent tendency report**: Mine wiki round reports and past flows to show what a team goes for in the 2NR/2AR, by side and judge type. Example: "goes for the K 70% vs. tech judges."
- **Speed drill mode**: Practice drills that measure your words per minute on highlighted text, track clarity over weeks, and feed your real reading speed into the speech column clock.
- **Round replay**: Scrub a timeline of a past round: speeches, docs sent, flow evolution, and prep used. Use it for post-round redos with coaches.
- **Judge QR handoff**: Display a QR code the judge scans to get the live speech docs and marked copies for the round, with no email chain setup. It's useful for lay judges in PF and LD.

## Top 5 to build first

1. **Pre-send lint**: Used every speech, it prevents the most common embarrassments and ethics issues, and it's cheap to build on your existing parser.
2. **Keystroke journaling + SpeechDrop fallback chain**: Reliability is the main reason debaters still cling to Word. Never losing work or failing to send is the trust foundation.
3. **Partner pass + live reading cursor**: It changes how teams prep in-round and is a reason to switch that CardMirror and Verbatim can't match.
4. **Unhighlighted context finder + tag honesty check**: These are the highest-value, lowest-risk Claude features. They're directly useful in CX and keep evidence ethical.
5. **Dropped-argument detector + extend keystroke**: These make built-in flowing clearly better than paper or Excel from day one, which drives adoption of the flow feature.

## From the plugin's history (added by Claude Code)

- **Native main process from day one**: The plugin needed a local helper because CardMirror's renderer can't set cookies for Tabroom/openCaselist auth. Falcon should own a main process, so Tabroom, Caselist, Gmail and SpeechDrop work with no helper install.
- **First-class extension API**: The plugin kept reaching into CardMirror's DOM for themes, motion, and the switcher, and broke on CardMirror updates. A real plugin API (commands, panels, themes, doc events) keeps Falcon's own features and community add-ons from regressing.
- **Parse cache + worker open as the default**: The plugin's open cache and the fork's off-thread parse/zip are what make 1,000+ page files usable. Bake them in rather than bolting them on.
- **Card Check at cut time, not just on demand**: Run the existing Card Check when a card is pasted or cut, and pair it with the archived-source clipper above.
