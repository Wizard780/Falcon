# AI cite formatter

Mod-Shift-X turns a selected citation or URL into a styled cite with the name and date cite-marked. Reformat Every Cite runs that over each cite in the doc. Both need AI features on and an Anthropic key in Settings > AI.

- Requests run in `electron/ai.cjs`. The key sits in `ai-key.bin` under userData, encrypted with safeStorage. It never reaches the page or a settings file.
- A reply can be a `[[CITE]]`, `[[TOKENS]]`, `[[END]]` block, the same as CardMirror's prompts answer, so a custom prompt imported from there works. Any other reply goes in whole as the cite, just unmarked, so people can write prompts for their own style.
- The model field is sent as typed, blank means Opus 5.5.
- Settings > AI picks the prompt: the built-in one or up to ten presets, like CardMirror. Each preset has a bindable Use Prompt Preset command.
- A stretch being worked on is tinted (`.ai-busy`), follows edits around it, and is locked: typing in it does nothing and it flashes.

`scripts/ai-smoke.mjs` runs both in the real Electron app against a stand-in server, so it needs no real key:

```bash
npm run build && env -u ELECTRON_RUN_AS_NODE node scripts/ai-smoke.mjs
```
