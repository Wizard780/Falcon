import { describe, expect, it } from 'vitest';
import { schema } from '../src/editor/schema';
import { alreadyPosted, draftReport, numberedTournament, prefill, roundField, sideLabels, sideOf, speechCode } from '../src/editor/caselist';

type H = [style: string, text: string];
const docOf = (...hs: H[]) => schema.node('doc', null, hs.map(([style, text]) => schema.node('paragraph', { style }, text ? [schema.text(text)] : [])));

describe('round report', () => {
  it('reads a speech label on either side of a heading', () => {
    expect(speechCode('1NC---Offshoring DA')).toEqual({ code: '1NC', name: 'Offshoring DA' });
    expect(speechCode('Tech Race---1NC')).toEqual({ code: '1NC', name: 'Tech Race' });
    expect(speechCode('Overview')).toBeNull();
  });
  it('lists the page\'s way, speech by speech, from the innermost headings', () => {
    const doc = docOf(['pocket', '1NC'], ['hat', '1NC'], ['block', 'Tech Race---1NC'], ['block', 'Constitutionality---1NC'],
      ['pocket', '2NC'], ['hat', 'DA---Safety'], ['block', 'Safety DA---2NC'], ['hat', 'DA---Grids'], ['block', 'Grids DA---2NC']);
    expect(draftReport(doc, 'Speech', 'N')).toBe('1NC---Tech Race, Constitutionality\n2NC---Safety DA, Grids DA');
  });
  it('a DA\'s parts roll up to the DA', () => {
    const doc = docOf(['pocket', '1NC'], ['hat', 'Offshoring DA'], ['block', 'Uniqueness'], ['block', 'Link'], ['block', 'Impact'], ['hat', 'Econ DA'], ['block', 'Link']);
    expect(draftReport(doc, 'Speech 1NC', 'N')).toBe('1NC---Offshoring DA, Econ DA');
  });
  it('a lay doc says Lay, the way the page does', () => {
    expect(draftReport(docOf(['pocket', 'Lay---1NC'], ['hat', '1NC'], ['block', 'Cards---1NC']), 'x', 'N')).toBe('1NC---Lay');
  });
  it('with no labels: the file\'s speech, else the side\'s first', () => {
    const doc = docOf(['hat', 'Econ'], ['hat', 'AGI']);
    expect(draftReport(doc, 'Speech 2AC 11-4', 'A')).toBe('2AC---Econ, AGI');
    expect(draftReport(doc, 'Speech', 'A')).toBe('1AC---Econ, AGI');
    expect(draftReport(doc, 'Speech', 'N')).toBe('1NC---Econ, AGI');
    expect(draftReport(doc, 'Speech', '')).toBe('');
  });
  it('tags alone are no positions, and duplicates count once', () => {
    expect(draftReport(docOf(['pocket', '1NC'], ['tag', 'A card']), 'x', 'N')).toBe('');
    expect(draftReport(docOf(['pocket', '1NC'], ['hat', 'Econ'], ['hat', 'econ']), 'x', 'N')).toBe('1NC---Econ');
  });
});

describe('tournament numbering', () => {
  const page = ['1---National Speech and Debate Season Opener', '2---Fullerton'];
  it('a tournament already on the page keeps the name it\'s up under', () => {
    expect(numberedTournament('Fullerton', page)).toBe('2---Fullerton');
    expect(numberedTournament('Fullerton Joe Vanderford Invitational', page)).toBe('2---Fullerton');
  });
  it('a new one takes the next number, in the page\'s own style', () => {
    expect(numberedTournament('Blake', page)).toBe('3---Blake');
    expect(numberedTournament('Blake', ['00 - Info', '01 - UKSO', '02 - CSF'])).toBe('03 - Blake');
    expect(numberedTournament('Blake', ['0. Notes', '4. Jon Schamber'])).toBe('5. Blake');
  });
  it('an empty page starts at 1; a page without numbers stays without', () => {
    expect(numberedTournament('Blake', [])).toBe('1---Blake');
    expect(numberedTournament('Blake', ['Fullerton', 'Yale'])).toBe('Blake');
    expect(numberedTournament('', page)).toBe('');
  });
});

describe('the round fields', () => {
  const pairing = { id: 7, tournament: 'Blake', round: 'Round 3', side: 'Con', opponent: ' Sharon SS ', judge: 'Raj Khan', start_time: null };
  it('prefills from the Tabroom pairing', () => {
    expect(prefill(pairing, [{ tournament: '2---Fullerton', round: '1', side: 'A' }])).toEqual({ tournament: '3---Blake', round: '3', side: 'N', opponent: 'Sharon SS', judge: 'Raj Khan' });
  });
  it('a prelim is its number; an elim keeps its name', () => {
    expect(roundField('R4')).toBe('4');
    expect(roundField('Round 6')).toBe('6');
    expect(roundField('Doubles')).toBe('Doubles');
  });
  it('knows the sides and their names', () => {
    expect([sideOf('Pro'), sideOf('aff'), sideOf('Con'), sideOf('N'), sideOf('?')]).toEqual(['A', 'A', 'N', 'N', '']);
    expect(sideLabels('pf').A).toBe('Pro');
    expect(sideLabels('HS LD 2026-27').N).toBe('Neg');
  });
  it('spots a round that\'s already up, across numbering', () => {
    const up = [{ tournament: '3---Blake', round: '3', side: 'N' }];
    expect(alreadyPosted({ tournament: '3---Blake', round: '3', side: 'N' }, up)).toBe(true);
    expect(alreadyPosted({ tournament: 'Blake', round: '3', side: 'N' }, up)).toBe(true);
    expect(alreadyPosted({ tournament: '3---Blake', round: '4', side: 'N' }, up)).toBe(false);
    expect(alreadyPosted({ tournament: '3---Blake', round: '3', side: 'A' }, up)).toBe(false);
  });
});
