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

test('ui: h() flattens nested child arrays', async () => {
  const { h } = await import('../js/ui.js');
  const dl = h('dl', {}, [['a', 'b'].map((x) => [h('dt', {}, x), h('dd', {}, x.toUpperCase())])]);
  assertEqual([...dl.children].map((c) => c.tagName + c.textContent), ['DTa', 'DDA', 'DTb', 'DDB']);
});
