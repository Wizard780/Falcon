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
    ['normal', 'Falcon is an editor for debate evidence. It opens and saves the same Word .docx files as Verbatim, so your files, your team\'s files and Falcon\'s files are one and the same. The boxed heading above is a pocket, the biggest heading.'],
    ['normal', 'This is a practice file the tour opened for you. Type in it and try the keys as you go: nothing here is saved, and it closes when the tour ends.'],

    ['hat', 'Try it: cut a card'],
    ['normal', 'The card below has no formatting yet. The tour walks you through it: make the first line a tag, mark the cite, then underline and highlight the part you\'d read.'],
    ['block', SAMPLE.block],
    ['normal', SAMPLE.tag],
    ['normal', SAMPLE.cite],
    ['normal', SAMPLE.body],

    ['hat', 'Open and save your files'],
    ['normal', `Open…${k('open')} opens any Verbatim file, and Save${k('save')} writes it back as a .docx that Verbatim and your teammates can open. Home${k('home')} lists your recent files.`],
    ['normal', `Save As${k('saveAs')} can also save a different kind of copy: a Send Doc leaves out your analytics and undertags, a Read Doc keeps only what you read aloud, and a Marked Doc keeps only the cards you marked.`],
    ['normal', 'Falcon keeps a copy of your open files and brings them back if it closes unexpectedly (Settings > General > Crash recovery). Save early anyway: a .docx on disk is what other people can open.'],

    ['hat', 'Headings and card styles'],
    ['normal', 'Falcon uses Verbatim\'s four heading levels, pocket, hat, block and tag, plus analytics and undertags. Each has a key, and Settings > Keybindings changes any of them:'],
    ['normal', `${kk('pocket')} pocket, ${kk('hat')} hat, ${kk('block')} block, ${kk('tag')} tag, ${kk('analytic')} analytic, ${kk('undertag')} undertag.`],
    ['normal', `Put the cursor in a paragraph and press the key to change it. A selection changes every paragraph it touches, and ${kk('clear')} clears it back to plain text.`],
    ['block', 'Blocks group cards under a hat'],
    ['tag', 'A card is one piece of evidence, with its tag on top'],
    ['undertag', 'An undertag adds a note under the tag, like a qualifier.'],
    ['normal', ['Smith 24', 'cite'], ', Professor of Climate Science, "Title of the Source," Publication Name, 9/23/2024, https://example.com'],
    ['normal', 'The body holds the evidence. ', [`${kk('underline')} underlines`, 'underline'], ', ', [`${kk('emphasis')} adds emphasis`, 'emphasis'], ', and ', [`${kk('highlight')} highlights the part you read aloud`, 'underline', 'highlight'], `. ${kk('shrink')} shrinks the words you don't read, and ${kk('cite')} marks the cite, like "Smith 24" above.`],
    ['analytic', 'An analytic is your own argument, a claim with no card behind it.'],

    ['hat', 'The outline'],
    ['normal', `The outline on the left lists every heading. Click a row to jump to it, double-click one to fold it, and pick how deep it goes with 1 to 4. Drag a row to move that heading and everything under it, and hold ${copyKey()} while you drag to copy it instead.`],
    ['normal', `${kk('cardUp')} and ${kk('cardDown')} move the card at your cursor up and down, and ${kk('nextHeading')} jumps to the next heading.`],

    ['hat', 'Read mode and timers'],
    ['normal', `Read mode${k('read')}, the eye in the tool row, shows only what you read aloud: headings, tags, cites, analytics and highlights. Typing is locked so a stray key can't change the file, and Space drops a marker where you stopped.`],
    ['normal', 'The status bar shows how long Reader 1 and Reader 2 take to read the file, or the selection. Set how fast each reads in Settings > Speech and timers.'],
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

    ['hat', 'Make it yours'],
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
