import { test, assertEqual } from './harness.js';
import { DEFAULTS, normalize, toCssVars } from '../js/settings.js';

test('settings: empty input gives defaults', () => {
  assertEqual(normalize({}), DEFAULTS);
  assertEqual(normalize(undefined), DEFAULTS);
});
test('settings: rate clamped and rounded to 0.05', () => {
  assertEqual(normalize({ rate: 2.33 }).rate, 2.0);
  assertEqual(normalize({ rate: 0.87 }).rate, 0.85);
  assertEqual(normalize({ rate: 0.1 }).rate, 0.5);
});
test('settings: repeat values clamped', () => {
  const s = normalize({ gapFactor: 9, repeats: 0, sizeStep: 40, theme: 'neon' });
  assertEqual([s.gapFactor, s.repeats, s.sizeStep, s.theme], [3, 1, 11, 'sepia']);
});
test('settings: css variables', () => {
  const v = toCssVars({ ...DEFAULTS, sizeStep: 7, font: 'charter', leading: 'loose', margins: 'wide', align: 'left', hyphens: false });
  assertEqual(v, {
    '--book-size': '22px', '--book-font': 'Charter, "Bitstream Charter", serif', '--book-leading': '1.8',
    '--page-margin': '80px', '--book-align': 'left', '--book-hyphens': 'manual',
  });
});
