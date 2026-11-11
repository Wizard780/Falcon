/**
 * The tour's sample document: a short guide to Falcon, with an unformatted practice card near the top that the
 * hands-on steps format. It's built when the tour starts, so every key it names is the one bound right now.
 *
 * Each paragraph is a style and its runs: a string is plain text, [text, ...marks] is marked text. Edit the text
 * freely, but keep the practice card's lines (SAMPLE) as they are, or change tutorial-steps.ts with them: the steps
 * find their lines by this text.
 */
import type { Node as PMNode, Mark } from 'prosemirror-model';
import { IS_MAC, keyLabel } from '../editor/keybinds';
import { schema, type ParaStyle } from '../editor/schema';

/** The practice card, unformatted: a tag line, a cite line and a body paragraph. */
export const SAMPLE = {
  name: 'Tutorial',
  block: 'Practice card',
  tag: 'Rural broadband raises small business growth',
  cite: 'Rivera 24 (Dana Rivera, fellow at the Center for Regional Economics, "Connected Counties," Journal of Rural Policy, March 2024)',
  author: 'Rivera 24',
  body: 'Counties that gained fast internet between 2015 and 2022 saw new business filings rise faster than similar counties that did not. The effect was largest for firms with fewer than ten employees, which used the connection to reach customers outside their region. These gains held after controlling for population, income and existing industry.',
  sentence: 'The effect was largest for firms with fewer than ten employees',
};

type Run = string | [string, ...string[]];
/** A key as this computer shows it, in brackets after the command: " (⌘O)", or nothing when it has none. */
const k = (id: string) => (keyLabel(id) ? ` (${keyLabel(id)})` : '');
/** A key on its own: "F7", or "its key" when it has none (Settings > Keybindings gives it one). */
const kk = (id: string) => keyLabel(id) || 'its key';
const copyKey = () => (IS_MAC ? 'Option' : 'Ctrl'); // page-drag.ts copyModifier

function guide(): [ParaStyle, ...Run[]][] {
  return [
    ['pocket', 'Welcome to Falcon'],
    ['normal', 'Falcon is where you cut, file and read your debate cards. Its files are ordinary Word .docx files in Verbatim\'s format, so what you make here works in Verbatim, and the other way round. The heading at the top, in a box, is a pocket: the largest heading there is.'],
    ['normal', 'The tour opened this practice file for you. Nothing in it is saved, so edit it as much as you like. It closes when the tour ends.'],

    ['hat', 'Try it: cut a card'],
    ['normal', 'The card below has no formatting yet. The tour walks you through it: make the first line a tag, mark the cite, then underline and highlight the part you\'d read.'],
    ['block', SAMPLE.block],
    ['normal', SAMPLE.tag],
    ['normal', SAMPLE.cite],
    ['normal', SAMPLE.body],

    ['hat', 'Your files'],
    ['normal', `Open…${k('open')} opens any Verbatim file, and Save${k('save')} keeps your changes in that same .docx, ready for Word, Verbatim or a teammate. Home${k('home')} lists your recent files.`],
    ['normal', `Save As${k('saveAs')} can also save a different kind of copy: a Send Doc leaves out your analytics and undertags, a Read Doc keeps only what you read aloud, and a Marked Doc keeps only the cards you marked.`],
    ['normal', 'If Falcon closes without warning, it brings your open files back as they were (Settings > General > Crash recovery). That copy stays on this computer, so save a file before you share it.'],

    ['hat', 'Headings and card styles'],
    ['normal', 'A file has four sizes of heading, from biggest to smallest: pocket, hat, block, tag. Analytics and undertags get their own styles too. These are their keys, and you can change any of them in Settings > Keybindings:'],
    ['normal', `${kk('pocket')} pocket, ${kk('hat')} hat, ${kk('block')} block, ${kk('tag')} tag, ${kk('analytic')} analytic, ${kk('undertag')} undertag.`],
    ['normal', `Press a style's key and the paragraph you're in takes that style. Select several paragraphs first to style them all at once, and ${kk('clear')} turns them back into plain text.`],
    ['block', 'A block sits under a hat and holds cards'],
    ['tag', 'Each card starts with a tag: its claim in one line'],
    ['undertag', 'An undertag is a smaller line below the tag, for a caveat or some context.'],
    ['normal', ['Okafor 25', 'cite'], ', Senior Analyst at the Institute for Water Security, "Dry Years Ahead," Coastal Review, 2/11/2025, https://example.org'],
    ['normal', 'Under the cite goes the text of the article. ', [`${kk('underline')} underlines`, 'underline'], ', ', [`${kk('emphasis')} adds emphasis`, 'emphasis'], ', and ', [`${kk('highlight')} highlights the part you read aloud`, 'underline', 'highlight'], `. ${kk('shrink')} makes the words you skip smaller, and ${kk('cite')} marks the cite, like "Okafor 25" above.`],
    ['analytic', 'An analytic is a point you make yourself, without evidence to back it.'],

    ['hat', 'The outline'],
    ['normal', `Every heading in the file shows in the outline on the left. A click on a row takes you to that heading, and a double-click folds the row away. The 1 to 4 buttons choose how many levels it shows. Dragging a row moves the heading with everything below it. Hold ${copyKey()} as you drag and Falcon copies it instead.`],
    ['normal', `${kk('cardUp')} and ${kk('cardDown')} move the card at your cursor up and down, and ${kk('nextHeading')} jumps to the next heading.`],

    ['hat', 'Read mode and timers'],
    ['normal', `Read mode${k('read')}, the eye in the tool row, shows only what you read aloud: headings, tags, cites, analytics and highlights. While it's on, the file can't be edited, and Space drops a marker where you stopped.`],
    ['normal', 'At the bottom of the window, Reader 1 and Reader 2 are how long each of your speakers would take to read the file, or just the selection. Change their reading speeds in Settings > Speech and timers.'],
    ['normal', 'The timer in the top bar runs your speech. Click it for the timer window with both sides\' prep, and pick your event\'s speech times in Settings > Speech and timers.'],

    ['hat', 'Build a speech'],
    ['normal', `Press ${kk('sendToSpeech')} to send the card at your cursor, or what you selected, to your speech doc. The first send makes a Speech file in the rail, marked S, and each send lands below the last. The file you're in never changes, and Undo on the message takes a send back.`],
    ['normal', `New speech doc${k('newSpeech')} starts one yourself, and the mic in the tool row makes the open file your speech doc. Settings > Speech and timers can add a Send button to the top bar.`],
    ['normal', 'SpeechDrop, on Home, joins a round\'s room by its code. Upload sends the file you came from without saving it first, and a .docx in the room opens as a Falcon tab.'],

    ['hat', 'Find your evidence'],
    ['normal', `Find${k('find')} searches this file, and can replace too. Search files${k('search')} finds any file by name, and Search cards${k('searchCards')} searches the tags, cites and headings of every card in your files.`],
    ['normal', 'Both read the folders you add in Settings > File search, like your team\'s Dropbox, in the desktop app. Star or pin a file there to put it at the top.'],
    ['normal', 'A template is a set of files you open together, like an aff and its frontlines. Make one in Settings > Templates with Add files…, then open it from the command center: type t and its name.'],
    ['normal', `The command center${k('commands')} runs any command, changes any setting, and goes to any heading or cite.`],

    ['hat', 'Work with your team'],
    ['normal', 'Copy a card into Gmail, Google Docs or Word and it keeps its formatting. Cards pasted in from Word, Docs or CardMirror keep theirs.'],
    ['normal', 'Card sharing sends a card straight to a teammate\'s Falcon. Swap pairing codes once in Card sharing in the command center, then Send Card to… sends the card at your cursor. It arrives as a message, without taking their focus.'],
    ['normal', 'To see files side by side, shift-click them in the rail, right-click one and choose Join.'],

    ['hat', 'Set it up your way'],
    ['normal', `Settings${k('settings')}, the gear at the bottom of the rail, changes every key, the theme, the fonts and how each style looks. With an Anthropic key in Settings > AI, ${kk('aiCite')} turns a pasted citation or link into a finished cite.`],
    ['normal', 'Replay this tour any time from Settings > General, or type Replay tutorial in the command center.'],
  ];
}

export function sampleDoc(): PMNode {
  const run = (r: Run) => {
    if (typeof r === 'string') return schema.text(r);
    const [text, ...marks] = r;
    return schema.text(text, marks.map((m): Mark => schema.marks[m].create()));
  };
  return schema.node('doc', null, guide().map(([style, ...runs]) => schema.node('paragraph', { style }, runs.map(run))));
}
