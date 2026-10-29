import { test, assertEqual } from './harness.js';
import { ruFor, enFor, groupFor } from '../js/bilingual.js';

const align = [[[0], [0]], [[1, 2], [1]], [[3], []], [[4], [2, 3]], [[], [4]]];

test('bilingual: EN sentence to first RU of its group', () => {
  assertEqual(ruFor(0, align), 0);
  assertEqual(ruFor(2, align), 1);
  assertEqual(ruFor(4, align), 2);
});
test('bilingual: untranslated EN sentence falls back to previous group', () => {
  assertEqual(ruFor(3, align), 1);
});
test('bilingual: RU sentence to first EN of its group', () => {
  assertEqual(enFor(3, align), 4);
  assertEqual(enFor(1, align), 1);
});
test('bilingual: RU-only group falls back to previous group', () => {
  assertEqual(enFor(4, align), 4);
});
test('bilingual: group for sentence', () => {
  assertEqual(groupFor(1, align), { en: [1, 2], ru: [1] });
  assertEqual(groupFor(99, align), { en: [], ru: [] });
});
test('bilingual: first untranslated with no previous uses next', () => {
  assertEqual(ruFor(0, [[[0], []], [[1], [0]]]), 0);
});
