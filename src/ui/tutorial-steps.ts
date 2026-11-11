/**
 * The first-run tutorial's steps, in order. Edit this list to change the tour.
 *
 * To add a step, copy one of the entries below and change it:
 *   title   one short line.
 *   body    one or two plain sentences (or a function of the tour's ctx returning them), addressed to "you". Write a key with key('tag'), never "F7",
 *           so a key someone rebound in Settings shows right (the ids are in keybinds.ts and keymap.ts).
 *   target  what the glow ring goes around: a CSS selector, or a function returning the element (or a
 *           list of them). Leave it out for a card in the middle of the window. A step whose target
 *           isn't on screen is skipped, unless it says `optional: true` (then its card shows centered).
 *   enter   runs when the step starts (put the cursor somewhere, select text).
 *   leave   runs when the step ends, either way (close what the step opened).
 *   keys    the shortcuts (binding ids) you may press during the step. Every other key and click is
 *           held back while the tour runs, except on the ring's target.
 *   done    for a hands-on step: true once you've done the thing. The tour moves on by itself; Next
 *           still works for someone who can't.
 *   look    the target can be seen but not clicked.
 *   near    what the card sits beside, when not the first target (a function, like target).
 * Removing, rewording or moving a step is just editing or moving its entry.
 *
 * The tour runs in its own sample document (SAMPLE below), which nothing saves.
 */
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { keyLabel } from '../editor/keybinds';
import { schema } from '../editor/schema';

/** What steps can reach: the sample document's editor, the command center, and the outline's depth. */
export type TourCtx = {
  view: () => EditorView | null;
  ccOpen: () => boolean;
  closeCc: () => void;
  depth: () => number;
  setDepth: (n: number) => void;
};
type Found = Element | Element[] | null | undefined;
export type Step = {
  title: string;
  body: string | ((ctx: TourCtx) => string);
  target?: string | ((ctx: TourCtx) => Found);
  optional?: boolean;
  enter?: (ctx: TourCtx) => void;
  leave?: (ctx: TourCtx) => void;
  keys?: string[];
  done?: (ctx: TourCtx) => boolean;
  look?: boolean;
  near?: (ctx: TourCtx) => Element | null;
};

/** The sample: a block heading (already styled, so the outline has a row), then one unformatted card: a tag line, a cite line and a body paragraph. */
export const SAMPLE = {
  name: 'Tutorial',
  block: 'Broadband advantage',
  tag: 'Rural broadband raises small business growth',
  cite: 'Rivera 24 (Dana Rivera, fellow at the Center for Regional Economics, "Connected Counties," Journal of Rural Policy, March 2024)',
  author: 'Rivera 24',
  body: 'Counties that gained fast internet between 2015 and 2022 saw new business filings rise faster than similar counties that did not. The effect was largest for firms with fewer than ten employees, which used the connection to reach customers outside their region. These gains held after controlling for population, income and existing industry.',
  sentence: 'The effect was largest for firms with fewer than ten employees',
};
export function sampleDoc(): PMNode {
  const p = (text: string) => schema.node('paragraph', null, [schema.text(text)]);
  return schema.node('doc', null, [schema.node('paragraph', { style: 'block' }, [schema.text(SAMPLE.block)]), p(SAMPLE.tag), p(SAMPLE.cite), p(SAMPLE.body)]);
}

/** A key's name as this computer shows it (⌘K, F7), or '' when it has none. */
export const key = (id: string) => keyLabel(id);
/** A command as its button or menu names it, with its key when it has one: "Find (⌘F)". */
const named = (label: string, id: string) => (key(id) ? `${label} (${key(id)})` : label);
/** "Press F7 or click Tag", or just "Click Tag" when the command has no key. */
const pressOr = (id: string, button: string) => (key(id) ? `Press ${key(id)} or click ${button}` : `Click ${button}`);

/** Where `text` sits in the doc (within one paragraph), or null. */
export function findText(doc: PMNode, text: string): { from: number; to: number } | null {
  let at: { from: number; to: number } | null = null;
  doc.descendants((n, pos) => {
    if (at) return false;
    if (!n.isTextblock) return true;
    const i = n.textContent.indexOf(text);
    if (i >= 0) at = { from: pos + 1 + i, to: pos + 1 + i + text.length };
    return false;
  });
  return at;
}
/** Is all of `text` marked with `mark`? */
export function marked(doc: PMNode, text: string, mark: string): boolean {
  const r = findText(doc, text);
  if (!r) return false;
  let all = true;
  doc.nodesBetween(r.from, r.to, (n) => { if (n.isText && !schema.marks[mark].isInSet(n.marks)) all = false; });
  return all;
}
/** The style of the paragraph holding `text`. */
export function styleOf(doc: PMNode, text: string): string | undefined {
  const r = findText(doc, text);
  return r ? doc.resolve(r.from).parent.attrs.style as string : undefined;
}

const select = (ctx: TourCtx, text: string, caret = false) => {
  const v = ctx.view(), r = v && findText(v.state.doc, text);
  if (!v || !r) return;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, r.from, caret ? r.from : r.to)).scrollIntoView());
  v.focus();
};
/** The paragraph holding `text`, as drawn. */
const line = (ctx: TourCtx, text: string) => {
  const v = ctx.view(), r = v && findText(v.state.doc, text);
  return v && r ? v.nodeDOM(v.state.doc.resolve(r.from).before()) as Element | null : null;
};
const both = (ctx: TourCtx, text: string, button: string) => [line(ctx, text), document.querySelector(`[data-tour="${button}"]`)].filter((e): e is Element => !!e);

/** The outline step: it shows down to tags, so the tag you just made is there under the block, and then puts your own depth back. */
function outline(): Step {
  let mine: number | null = null;
  return {
    title: 'The outline',
    body: (c) => {
      const v = c.view(), made = !!v && styleOf(v.state.doc, SAMPLE.tag) === 'tag';
      return `This is the outline: the sample's block${made ? ', and under it the tag you made' : ''}. Click a row to jump to it. The numbers at the top pick how deep it goes, down to 4 for tags.`;
    },
    target: '.olp.shown',
    enter: (c) => { mine = c.depth(); c.setDepth(4); },
    leave: (c) => { if (mine !== null) c.setDepth(mine); mine = null; },
  };
}

export const STEPS: Step[] = [
  {
    title: 'Welcome to Falcon',
    body: () => 'Falcon is where you cut, organize and read debate evidence. This tour takes about two minutes, and Esc skips it.',
  },
  {
    title: 'Home',
    body: 'This button opens Home, with your recent files and new documents.',
    target: '.fstrip .sb-logo',
  },
  {
    title: 'Your open files',
    body: 'Every file you have open is here. The tour opened a sample file for you to practice on.',
    target: '.fstrip .fs-docs',
  },
  {
    title: 'Make a tag',
    body: () => `Your cursor is on the card's first line. ${pressOr('tag', 'Tag')} to make it the card's tag.`,
    target: (c) => both(c, SAMPLE.tag, 'tag'),
    near: (c) => line(c, SAMPLE.body),
    enter: (c) => select(c, SAMPLE.tag, true),
    keys: ['tag'],
    done: (c) => { const v = c.view(); return !!v && styleOf(v.state.doc, SAMPLE.tag) === 'tag'; },
  },
  {
    title: 'Mark the cite',
    body: () => `The author and year are selected. ${pressOr('cite', 'Cite')} to mark them as the cite.`,
    target: (c) => both(c, SAMPLE.cite, 'cite'),
    near: (c) => line(c, SAMPLE.body),
    enter: (c) => select(c, SAMPLE.author),
    keys: ['cite'],
    done: (c) => { const v = c.view(); return !!v && marked(v.state.doc, SAMPLE.author, 'cite'); },
  },
  {
    title: 'Underline',
    body: () => `A sentence is selected. ${pressOr('underline', 'Underline')} to underline it.`,
    target: (c) => both(c, SAMPLE.body, 'underline'),
    enter: (c) => select(c, SAMPLE.sentence),
    keys: ['underline'],
    done: (c) => { const v = c.view(); return !!v && marked(v.state.doc, SAMPLE.sentence, 'underline'); },
  },
  {
    title: 'Highlight',
    body: () => `Now highlight the part you'll read aloud. ${pressOr('highlight', 'Highlight')}.`,
    target: (c) => both(c, SAMPLE.body, 'highlight'),
    enter: (c) => select(c, SAMPLE.sentence),
    keys: ['highlight'],
    done: (c) => { const v = c.view(); return !!v && marked(v.state.doc, SAMPLE.sentence, 'highlight'); },
  },
  {
    title: 'Headings',
    body: 'Pocket, Hat and Block make the headings that organize a file, from biggest to smallest.',
    target: '[data-tour="styles"]',
  },
  outline(),
  {
    title: 'The command center',
    body: () => (key('commands')
      ? `Press ${key('commands')} to open the command center. It runs any command, changes any setting, and goes to any heading.`
      : 'The command center runs any command, changes any setting, and goes to any heading. Give it a key in Settings.'),
    target: '.cc',
    optional: true,
    keys: ['commands'],
    done: (c) => c.ccOpen(),
    leave: (c) => c.closeCc(),
    look: true,
  },
  {
    title: 'Search',
    body: () => `${named('Find', 'find')} searches this file. ${named('Search files', 'search')} finds a file by name, and ${named('Search cards', 'searchCards')} searches every card in your files.`,
    target: '.tools [aria-label="Find"]',
  },
  {
    title: 'Send to speech',
    body: () => `${key('sendToSpeech') ? `Press ${key('sendToSpeech')} to send` : 'Send to speech sends'} the card at your cursor to your speech document. This button makes a file the speech document.`,
    target: '.tools [aria-label="Speech doc"]',
  },
  {
    title: 'Settings',
    body: 'You can change every key here, and replay this tutorial.',
    target: '.fstrip [aria-label="Settings"]',
  },
];
