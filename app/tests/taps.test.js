import { test, assertEqual } from './harness.js';
import { classifyTap } from '../js/taps.js';

const W = 900;

test('taps: card open closes card even over a word', () => {
  assertEqual(classifyTap({ x: 450, width: W, onWord: true, cardOpen: true }), 'close-card');
});
test('taps: word', () => {
  assertEqual(classifyTap({ x: 50, width: W, onWord: true, cardOpen: false }), 'word');
});
test('taps: left third goes back', () => {
  assertEqual(classifyTap({ x: 100, width: W, onWord: false, cardOpen: false }), 'prev');
});
test('taps: right third goes forward', () => {
  assertEqual(classifyTap({ x: 800, width: W, onWord: false, cardOpen: false }), 'next');
});
test('taps: center toggles chrome', () => {
  assertEqual(classifyTap({ x: 450, width: W, onWord: false, cardOpen: false }), 'chrome');
});
