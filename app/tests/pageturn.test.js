import { test, assertEqual } from './harness.js';
import { slidePositions, dragProgress, shouldComplete, finishDuration, SHADE } from '../js/pageturn.js';

test('pageturn: forward — current page slides out to the left, shade lifts', () => {
  assertEqual(slidePositions(1, 0, 1000), { cardX: 0, shade: SHADE });
  assertEqual(slidePositions(1, 0.5, 1000), { cardX: -500, shade: SHADE / 2 });
  assertEqual(slidePositions(1, 1, 1000), { cardX: -1000, shade: 0 });
});

test('pageturn: backward — previous page slides in from the left, shade grows', () => {
  assertEqual(slidePositions(-1, 0, 1000), { cardX: -1000, shade: 0 });
  assertEqual(slidePositions(-1, 1, 1000), { cardX: 0, shade: SHADE });
});

test('pageturn: drag progress follows the finger in the turn direction only', () => {
  assertEqual(dragProgress(1, -250, 1000), 0.25);
  assertEqual(dragProgress(1, 80, 1000), 0);
  assertEqual(dragProgress(-1, 400, 1000), 0.4);
  assertEqual(dragProgress(-1, 5000, 1000), 1);
});

test('pageturn: release completes past a quarter or on a flick', () => {
  assertEqual(shouldComplete(0.3, 0), true);
  assertEqual(shouldComplete(0.1, 0.6), true);
  assertEqual(shouldComplete(0.1, 0.1), false);
  assertEqual(shouldComplete(0.4, -0.6), false, 'flick back cancels');
});

test('pageturn: remaining distance sets the duration', () => {
  assertEqual(finishDuration(0, 1), 600);
  assertEqual(finishDuration(0.5, 1), 300);
  assertEqual(finishDuration(0.95, 1), 120);
});
