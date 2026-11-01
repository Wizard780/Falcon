# falcon---astra

An alternate Falcon mockup made with Astra. Open `falcon---astra.html` directly in a modern browser; everything is embedded in the file.

## Direction

- **Product:** evidence preparation and speech delivery for debaters
- **Character:** focused, editorial, tactile
- **World:** marked-up source documents on a quiet graphite desk
- **Moments:** a paper speech preview on Home and readable, highlighted evidence in the editor
- **Signature:** a narrow cyan margin mark for the current location and evidence highlights

## Audit of the attached mockup

The original already has a coherent graphite palette and well-organized file groups. This is an alternate concept, as requested, rather than a claim that every part of the existing design needs replacing.

- Home: the animated, striped Falcon wordmark dominates the working content.
- Home: the dotted backdrop adds texture without helping navigation or reading.
- Home: the matrix clock competes with the title while the useful speech timer is elsewhere.
- Navigation: icon-only files depend on hover to reveal their names.
- Home actions: three equal cards give creation, speech creation, and opening identical visual weight.
- Controls: the prototype combines several icon stroke widths, small type sizes, and corner treatments.

## Nine passes

1. **Spacing.** Use a 4px spacing scale, 36px navigation rows, consistent 64px file rows, and aligned metadata. Preserve the order of actions, Favorites, and Recent.
2. **Color.** Keep graphite chrome with three text roles. Place pale cyan in the evidence and current-location marker. The document paper is a warm near-white.
3. **Icons.** Use one set of 18px line icons at a 1.5px stroke. Preserve Falcon’s existing flat symbol.
4. **Copy.** Make the tournament and round the Home heading. Keep the original filenames and evidence. Use short, literal action labels.
5. **Type.** Use Helvetica Neue for the interface, a system monospace for figures, and Georgia for evidence. Give headings size and space instead of excessive weight.
6. **Layout.** Make file labels persistent on desktop. Pair the existing Home sections with a speech preview. In the editor, the sidebar switches between files and outline; sending a card opens the speech queue. Small screens use a navigation drawer.
7. **Details.** Put counts in aligned columns, show shortcuts as small keycaps, add keyboard focus states, and let the active outline item carry the cyan marker.
8. **Visuals.** Use the speech document and its highlighted passage as the visual. No generated image or image prompt was needed.
9. **Motion.** Use short surface transitions. Timers update only while running. Respect reduced-motion settings for scrolling and transitions.

## Interactions

- Open the included files from Home, navigation, or Search.
- Search document names and evidence, including authors; use Command/Ctrl+K.
- Filter Recent by Speech, Aff, and Neg.
- Jump through the outline and change heading depth.
- Edit text, apply heading styles, underline, emphasize, and highlight selections.
- Send the selected card to the local speech draft and inspect its queue.
- Toggle Read to pause editing and emphasize highlighted content.
- Run the speech timer or either side’s prep timer.
- Create a draft, create a new speech, import plain text, and download edited HTML.

## Verification and scope

All ten source documents are embedded, with text-preservation assertions passing. They retain source qualifications such as “SUMMARY, not verbatim.” The initial speech is the same ten-card subset used in the attachment. A new speech keeps the previous draft available in Search and Recent.

Browser checks passed for filtering, editing, highlighting, outline jumps, search, card transfer, timers, Read mode, mobile navigation, the speech queue, keyboard search, and previous-speech preservation. No horizontal overflow at 1440, 1024, 728, or 390 pixels. No runtime errors in those checks or the inline preview.

This is a self-contained prototype. Edits last for the current session; download HTML to keep them. File import supports plain text. Production DOCX import/export, collaboration, and persistent storage are outside this mockup. Native browser editing commands are sufficient for trying the design; a production editor should use structured document transactions.

Design process credit: [unslop by Damir Sokolovsky (@heydamir)](https://heydamir.design/unslop), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
