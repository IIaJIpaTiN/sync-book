import { test, assertEqual } from './harness.js';
import { lineSegments, fillSchedule } from '../js/gapline.js';

const r = (left, top, right) => ({ left, right, top, bottom: top + 20 });

test('gapline: word boxes grouped into lines in reading order', () => {
  const segs = lineSegments([r(300, 100, 360), r(370, 100, 420), r(50, 130, 120), r(130, 131, 200)]);
  assertEqual(segs, [{ left: 300, right: 420, bottom: 120 }, { left: 50, right: 200, bottom: 151 }]);
});

test('gapline: words in two columns are separate lines', () => {
  const segs = lineSegments([r(400, 500, 460), r(600, 40, 660)]);
  assertEqual(segs.map((s) => s.left), [400, 600]);
});

test('gapline: fill time split by line width', () => {
  const plan = fillSchedule([{ left: 0, right: 300, bottom: 0 }, { left: 0, right: 100, bottom: 0 }], 2000);
  assertEqual(plan.map((p) => [p.delay, p.duration]), [[0, 1500], [1500, 500]]);
});
