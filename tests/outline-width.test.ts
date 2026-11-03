import { expect, it } from 'vitest';
import { OL_DEFAULT, OL_MAX, OL_MIN, outlineWidth } from '../src/ui/outline-width';

it('keeps the outline between its narrowest and widest', () => {
  expect(outlineWidth(350)).toBe(350);
  expect(outlineWidth(10)).toBe(OL_MIN);
  expect(outlineWidth(5000)).toBe(OL_MAX);
  expect(outlineWidth(450, 400)).toBe(400); // a narrow window caps it
  expect(outlineWidth(NaN)).toBe(OL_DEFAULT);
});
