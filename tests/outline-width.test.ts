import { expect, it } from 'vitest';
import { OL_DEFAULT, OL_MAX, OL_MIN, loadOutlineWidth, outlineWidth } from '../src/ui/outline-width';

it('keeps the outline between its narrowest and widest', () => {
  expect(outlineWidth(350)).toBe(350);
  expect(outlineWidth(10)).toBe(OL_MIN);
  expect(outlineWidth(5000)).toBe(OL_MAX);
  expect(outlineWidth(450, 400)).toBe(400); // a narrow window caps it
  expect(outlineWidth(NaN)).toBe(OL_DEFAULT);
});

it('holds a saved width to what a narrower window allows', () => {
  localStorage.setItem('falcon.outlineWidth', '560');
  window.innerWidth = 1000;
  expect(loadOutlineWidth()).toBe(400);
  window.innerWidth = 1600;
  expect(loadOutlineWidth()).toBe(560);
  localStorage.removeItem('falcon.outlineWidth');
});
