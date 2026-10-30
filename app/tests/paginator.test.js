import { test, assertEqual } from './harness.js';
import { Paginator, anchorPageAfterRelayout } from '../js/paginator.js';
import { renderEn } from '../js/render.js';

function mk({ width = 800, height = 600, paragraphs = 40 } = {}) {
  const sandbox = document.getElementById('sandbox');
  sandbox.replaceChildren();
  const viewport = document.createElement('div');
  viewport.style.cssText = `width:${width}px;height:${height}px;position:relative;overflow:hidden`;
  const content = document.createElement('div');
  for (let i = 0; i < paragraphs; i++) {
    const p = document.createElement('p');
    p.textContent = `Paragraph ${i}. ` + 'The quick brown fox jumps over the lazy dog. '.repeat(6);
    content.append(p);
  }
  viewport.append(content);
  sandbox.append(viewport);
  const p = new Paginator(viewport, content, { spread: 1 });
  p.content = content;
  return p;
}

test('paginator: pageOf finds element page', () => {
  const p = mk();
  const n = p.layout();
  assertEqual(n > 2, true, 'pages');
  assertEqual(p.pageOf(p.content.lastElementChild), n - 1);
  assertEqual(p.pageOf(p.content.firstElementChild), 0);
});

test('paginator: goTo clamps and moves', () => {
  const p = mk();
  const n = p.layout();
  p.goTo(999);
  assertEqual(p.page, n - 1);
  p.goTo(-3);
  assertEqual(p.page, 0);
});

test('paginator: anchor survives font change', () => {
  const p = mk();
  p.layout();
  const el = p.content.children[20];
  p.goTo(p.pageOf(el));
  p.content.style.fontSize = '24px';
  p.layout();
  assertEqual(anchorPageAfterRelayout(p, el), p.pageOf(el));
  assertEqual(p.page, p.pageOf(el));
});

test('paginator: spread of two halves the page count', () => {
  const one = mk({ width: 1000 });
  const n1 = one.layout();
  const two = mk({ width: 1000 });
  two.spread = 2;
  const n2 = two.layout();
  assertEqual(Math.abs(n2 - Math.ceil(n1 / 2)) <= 1, true, `${n1} vs ${n2}`);
});

test('render: spans for sentences and words with global word index', () => {
  const chapter = {
    blocks: [
      { kind: 'h', text: 'One', sentences: [{ id: 0, range: [0, 3], t: [0, 1], words: [[0, 3, 0, 1, -1]], chunks: [] }] },
      { kind: 'sep', text: '*', sentences: [] },
      {
        kind: 'p', text: 'He said no. Go.', italic: [[3, 7]], sentences: [
          { id: 1, range: [0, 11], t: [0, 1], words: [[0, 2, 0, 1, 4], [3, 7, 0, 1, -1], [8, 10, 0, 1, -1]], chunks: [] },
          { id: 2, range: [12, 15], t: [0, 1], words: [[12, 14, 0, 1, -1]], chunks: [] },
        ],
      },
    ],
  };
  const el = renderEn(chapter);
  assertEqual(el.querySelector('h2').textContent, 'One');
  assertEqual(el.querySelector('.sep') !== null, true);
  const p = el.querySelector('p');
  assertEqual(p.textContent, 'He said no. Go.');
  assertEqual([...p.querySelectorAll('[data-w]')].map((w) => [w.dataset.w, w.textContent]),
    [['1', 'He'], ['2', 'said'], ['3', 'no'], ['4', 'Go']]);
  assertEqual(p.querySelector('[data-w="1"]').dataset.d, '4');
  assertEqual([...p.querySelectorAll('[data-s]')].map((s) => s.textContent), ['He said no.', 'Go.']);
  assertEqual(p.querySelector('i').textContent, 'said');
});

function mkMargins({ width, spread, ratio }) {
  const p = mk({ width, height: 600, paragraphs: 30 });
  p.viewport.style.setProperty('--page-margin', String(ratio));
  p.spread = spread;
  p.layout();
  return p;
}

test('paginator: spread gap between pages equals outer margin', () => {
  const p = mkMargins({ width: 1000, spread: 2, ratio: 0.1 });
  const vp = p.viewport.getBoundingClientRect();
  const onPage = [...p.content.children].filter((el) => p.pageOf(el) === 0);
  const rects = onPage.flatMap((el) => [...el.getClientRects()]);
  const left = Math.min(...rects.map((r) => r.left)) - vp.left;
  const leftColRight = Math.max(...rects.filter((r) => r.left - vp.left < 500).map((r) => r.right)) - vp.left;
  const rightColLeft = Math.min(...rects.filter((r) => r.left - vp.left > 500).map((r) => r.left)) - vp.left;
  const right = vp.right - Math.max(...rects.map((r) => r.right));
  assertEqual([Math.round(left), Math.round(rightColLeft - leftColRight), Math.round(right)], [100, 100, 100]);
});

test('paginator: single column sets an explicit column width (WebKit ignores column-count 1)', () => {
  const p = mkMargins({ width: 800, spread: 1, ratio: 0.1 });
  assertEqual(p.content.style.columnWidth.endsWith('px'), true);
  assertEqual(p.layout() > 2, true);
  const vp = p.viewport.getBoundingClientRect();
  const r = p.content.firstElementChild.getBoundingClientRect();
  assertEqual([Math.round(r.left - vp.left), Math.round(vp.right - r.right)], [80, 80]);
});

test('paginator: relayout keeps the spoken sentence only if it was on screen', async () => {
  const { relayoutTarget } = await import('../js/paginator.js');
  const audio = { id: 'audio' };
  const page = { id: 'page' };
  assertEqual(relayoutTarget({ audioEl: audio, audioVisible: true, pageAnchor: page }).id, 'audio');
  assertEqual(relayoutTarget({ audioEl: audio, audioVisible: false, pageAnchor: page }).id, 'page');
  assertEqual(relayoutTarget({ audioEl: null, audioVisible: false, pageAnchor: page }).id, 'page');
});
