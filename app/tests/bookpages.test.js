import { test, assertEqual } from './harness.js';
import { chapterStartPages, bookPosition, formatDuration, folioText } from '../js/bookpages.js';

test('bookpages: chapter start pages', () => {
  assertEqual(chapterStartPages([14, 20, 3]), [1, 15, 35]);
});

test('bookpages: global position', () => {
  assertEqual(bookPosition([14, 20, 3], 1, 4), { page: 19, total: 37 });
});

test('bookpages: audio duration at playback speed', () => {
  assertEqual(formatDuration(45 * 60000, 1), '45 мин');
  assertEqual(formatDuration(45 * 60000, 0.5), '1 ч 30 мин');
  assertEqual(formatDuration(65 * 60000, 1), '1 ч 05 мин');
  assertEqual(formatDuration(20000, 1), '1 мин');
});

test('bookpages: folio by chapter or by book', () => {
  assertEqual(folioText({ mode: 'chapter', page: 3, pages: 14, counts: [14, 20], index: 0 }), '4 из 14');
  assertEqual(folioText({ mode: 'book', page: 3, pages: 20, counts: [14, 20], index: 1 }), '18 из 34');
  assertEqual(folioText({ mode: 'book', page: 3, pages: 14, counts: null, index: 0 }), '4 из 14');
});
