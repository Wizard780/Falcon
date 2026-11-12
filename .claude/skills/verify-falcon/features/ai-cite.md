# AI cite formatter

Mod-Shift-X turns a selected citation or URL into a styled cite with the name and date cite-marked. Reformat Every Cite runs that over each cite in the doc. Both need AI features on and an Anthropic key in Settings > AI.

- Requests run in `electron/ai.cjs`. The key is a named secret in `electron/secrets.cjs` (`secrets/anthropic.bin` under userData, encrypted with safeStorage). The page only names it: Add key… opens a window main owns (`secret-prompt.html`), so the value never reaches the page or a settings file. That window can't read the app's styles, so the page sends its colors and its font's file in the URL (`chromeLook` in `theme.ts`). Nothing comes back the other way.
- A reply can be a `[[CITE]]`, `[[TOKENS]]`, `[[END]]` block, the same as CardMirror's prompts answer, so a custom prompt imported from there works. Any other reply goes in whole as the cite, just unmarked, so people can write prompts for their own style.
- The model field is sent as typed, blank means Opus 5.5.
- Settings > AI also offers OpenRouter (a raw fetch in `electron/ai.cjs`, its own key and its own model pref). Its model has to be pasted in.
- Settings > AI picks the prompt: the built-in one or up to ten presets, like CardMirror. Each preset has a bindable Use Prompt Preset command.
- Edit and New preset open the prompt editor (`src/ui/PromptEditor.tsx`), a big window over Settings like CardMirror's Edit prompt. Nothing saves until Save (or Mod-Enter); Esc closes it and leaves Settings open. Edit on the built-in prompt starts a preset from it. `{DATE}` fills in as M-D-YYYY, like CardMirror.
- Anthropic requests stream, so a big max output tokens works (the SDK refuses those without streaming). An error the SDK raises itself now shows its reason instead of a bare "The AI request failed."
- A stretch being worked on is tinted (`.ai-busy`), follows edits around it, and is locked: typing in it does nothing and it flashes.

`scripts/ai-smoke.mjs` runs both in the real Electron app against a stand-in server, so it needs no real key:

```bash
npm run build && env -u ELECTRON_RUN_AS_NODE node scripts/ai-smoke.mjs
```
