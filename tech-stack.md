# Falcon tech stack (decided 2026-10-31)

## What CardMirror uses (v1.16.0, checked in ~/Downloads/debateskills/_work/cardmirror)

| Layer | CardMirror |
|---|---|
| Language | TypeScript 5.7 |
| Editor engine | ProseMirror (model/state/view/tables/history) |
| UI | Vanilla TS + DOM, no framework |
| Build | Vite 6, vite-plugin-pwa |
| Desktop | Electron 42 + electron-builder (unsigned builds), koffi for native calls |
| Web edition | Static build on Cloudflare Workers (assets only, cardmirror.app) |
| .docx I/O | Hand-written OOXML importer/exporter (fast-xml-parser + fflate), native `.cmir` format |
| Collab | loro-crdt + loro-prosemirror, Python relay server (Docker), E2E encrypted |
| Spellcheck / lang | nspell, tinyld |
| AI | User's own Anthropic key, called directly from the app |
| Tests | Vitest + jsdom |
| Analytics | **None.** PRIVACY.md promises "no analytics SDKs ... no usage telemetry" |

**License: PolyForm Noncommercial 1.0.0.** You can fork and change it, but only for uses
"without any anticipated commercial application", and you must keep its notices.
If Falcon ever charges money, takes sponsorships, or sells a team tier, a fork is not allowed
without Anthony Trufanov's permission. ProseMirror, Loro, and the other libraries are MIT, so
using the *same libraries* is fine. Copying CardMirror's *code* is the restricted part.

## Falcon stack

| Layer | Pick | Why |
|---|---|---|
| Language | TypeScript | Same as CardMirror |
| Editor engine | ProseMirror | Built for this: it handles big docs and has a schema for cards, tags, and cites. Verbatim parity is already proven on it. MIT |
| UI | React + Tailwind | Falcon has much more UI than CardMirror (home, flow, round/prep modes, settings). The EasyUI/shadcn components you reviewed are React + Tailwind. ProseMirror runs inside a React ref with no wrapper library needed |
| Build | Vite | Same as CardMirror |
| Desktop | Electron + electron-builder + electron-updater (GitHub Releases) | Debate tools need a main process. The plugin found that the Tabroom/openCaselist cookie login and SpeechDrop only work outside the renderer. Electron also gives the same Chromium everywhere, which matters for contenteditable on 1,500-page files. Tauri would use Safari's WebKit on Mac, a different engine from Windows |
| Web edition | Same build, static on Cloudflare (or Vercel) | Chromebooks and locked-down school laptops |
| .docx I/O | Own OOXML importer/exporter (fast-xml-parser + fflate) | This is the hardest part and decides whether Falcon works. Round-trip tests against real Verbatim files come first |
| Collab (later) | Loro CRDT + Cloudflare Durable Objects as the relay | Same CRDT CardMirror proved out. Durable Objects means no server to run |
| Accounts (later, only when needed) | Supabase (auth + Postgres) | Needed for team libraries and sync. **Not** needed to count users |
| **User analytics** | **PostHog** (posthog-js in the renderer) | Free up to 1M events/mo. It covers DAU/WAU/MAU, retention, feature usage, and error tracking in one tool, so no separate Sentry |
| AI | Anthropic API, user key first (like CardMirror). Later a Worker proxy if Falcon pays for usage | No backend needed to ship |
| Tests | Vitest (unit, docx round-trip) + Playwright (headless UI) | Same as CardMirror, plus browser tests |

## Alternatives considered (desktop shell)

Falcon's core is a rich-text editor for huge Verbatim docs. Every serious editor of that kind runs on the
browser's editing engine (ProseMirror, CodeMirror, Lexical). So the main question is whether the shell
gives us a web engine.

| Option | Verdict | Why |
|---|---|---|
| **Electron** | **Pick** | Same Chromium on Mac and Windows. Node main process for SpeechDrop/Tabroom cookie logins (the plugin's helper.mjs ports straight in). Used by Obsidian, VS Code, Notion, Slack, and CardMirror. Costs: ~100 MB+ installer, heavier RAM, and the "bloated" reputation |
| Tauri 2 | Runner-up | ~5–15 MB installer and lower RAM. But it uses the OS web engine: Chromium (WebView2) on Windows and **Safari's WebKit on Mac**, so every editor bug and perf issue has to be tested twice. Native code is Rust, so the Node helper has to be rewritten or run as a sidecar |
| React Native (+ RN Windows/macOS) | No | No contenteditable, so there's no ProseMirror and no mature rich-text editor. We'd write a Word-grade editor from scratch, or embed a webview (which is just Electron/Tauri with extra steps). RN Windows/macOS are Microsoft-maintained side projects with a small ecosystem. Good for phone apps, wrong for a desktop document editor |
| Flutter | No | Same problem: no mature rich-text editor for docx-like documents |
| Native (Swift + C#) | No | Two full codebases, and an editor built twice |
| Electrobun / Wails | No | Same system-webview tradeoff as Tauri, with a younger ecosystem |

**What would change the pick:** if download size or RAM on old school laptops turns out to matter more
than one predictable engine, use Tauri. A 1-day spike (same ProseMirror build, 1,500-page doc, open time
and RAM on Mac in Electron vs Tauri) would settle it with numbers.

**Electron complaints, and how Falcon handles them:**
- Slow and heavy: this comes from the app, not Electron. VS Code and Obsidian are fast because of
  virtualized rendering and lazy loading. CardMirror's fast-open work proves it on this exact workload.
- Big download: ~100 MB once, then auto-updates are deltas. That's acceptable for a daily tool.
- Security: contextIsolation on, nodeIntegration off, all network work in main.

## Shipping Windows .exe and Mac .dmg

electron-builder produces both from one config: NSIS `.exe` installer (x64 + arm64) and `.dmg`
(universal or per-arch). GitHub Actions builds each on its own OS runner (macos-latest, windows-latest)
and publishes to GitHub Releases, where electron-updater picks them up.

Signing is where the money and friction are. CardMirror skips it, which is why its users see scary warnings:
- **Mac:** Apple Developer Program, $99/yr, with signing + notarization in CI. Without it, macOS 15+
  blocks the app until users dig into System Settings. Recommended before any public release.
- **Windows:** without a cert, SmartScreen shows "Windows protected your PC". Cheapest fix is
  Microsoft's Azure signing service (~$10/mo). Its warning fades as installs build reputation.

## PostHog setup (how user counting works)

- No login needed. PostHog gives each install an anonymous ID, so "how many users" means
  unique installs active per day/week/month. Call `posthog.identify()` later once accounts exist.
- Electron settings: `persistence: 'localStorage'`, `capture_pageview: false` (pages are `file://`),
  `autocapture: false`, `disable_session_recording: true`.
- **Never send document text.** Evidence files are private strategy, and session replay or autocapture
  would leak card text. Send named events only:
  `app_opened`, `doc_opened` (size bucket only), `speech_sent` (target: speechdrop/email),
  `flow_created`, `ai_action_used` (type), `round_mode_entered`.
- Super properties on every event: `app_version`, `platform`, `edition` (desktop/web).
- Add an "anonymous usage stats" toggle in Settings. Many users are high schoolers, so it needs
  a short privacy page that says what is collected.

## Decision: fresh codebase, CardMirror as a reference only (2026-10-31)

Falcon is written from scratch. We study CardMirror to learn *how* it solves problems, but we don't
reuse its code. Rules for anyone (human or agent) working on Falcon:

- **OK:** reading CardMirror's ARCHITECTURE.md, MANUAL.md, and source to understand ideas and approaches
  (e.g. "three-layer rendering", "stable heading IDs", "send-to-speech as cross-doc transactions").
  Ideas, designs, and file formats aren't owned by anyone.
- **OK:** going to the same primary sources it used: the OOXML spec (ECMA-376), ProseMirror docs, real
  Verbatim .docx files, Verbatim's own template.
- **Not OK:** copy-pasting CardMirror code, porting a file line by line, or keeping its structure and
  renaming variables. That's still a copy under its license.
- **In practice:** read to understand, close the file, then write Falcon's version from the spec plus
  our own tests. Write the .docx importer/exporter against the spec and real Verbatim files, not
  against CardMirror's implementation.

(Not legal advice. If Falcon goes commercial, a quick lawyer check or a note to Anthony is cheap insurance.)

### Earlier options (for the record)

**Fork CardMirror, or start fresh on the same libraries?**

- **Fork:** you get the .docx round-trip, Verbatim shortcuts, read mode, and the perf work right away,
  which saves weeks to months. But Falcon can never be commercial without Anthony's permission, and
  you'd be removing a "no analytics" promise from code he wrote.
- **Fresh (recommended if money is ever possible):** same stack as above, your own code, with the
  importer/exporter written first. Or ask Anthony about a license. He takes sponsorships, so he may agree.

If Falcon will stay free forever, forking is the faster choice.
