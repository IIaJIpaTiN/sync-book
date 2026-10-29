// JSON главы → DOM. Английский текст: предложения <span class="s" data-s>, слова <span class="w"
// data-w data-d>; индекс слова сквозной по главе (как в таймлайне). Русский: только предложения.

function boundaries(len, ranges) {
  const set = new Set([0, len]);
  for (const [a, b] of ranges) { set.add(a); set.add(b); }
  return [...set].filter((x) => x >= 0 && x <= len).sort((a, b) => a - b);
}

const inside = (ranges, a, b) => ranges.find(([x, y]) => x <= a && b <= y);

function blockEl(block) {
  if (block.kind === 'sep') {
    const d = document.createElement('div');
    d.className = 'sep';
    d.textContent = block.text;
    return d;
  }
  if (block.kind === 'h') {
    const h = document.createElement('h2');
    if (/^\d+$/.test(block.text.trim())) h.className = 'chapnum';
    return h;
  }
  return document.createElement('p');
}

function textNode(text, italic) {
  if (!italic) return document.createTextNode(text);
  const i = document.createElement('i');
  i.textContent = text;
  return i;
}

// Общий проход: делит текст блока на сегменты по границам предложений, слов и курсива.
function renderBlock(block, { sentenceAttr, words }) {
  const el = blockEl(block);
  if (block.kind === 'sep') return el;
  const italic = block.italic || [];
  const sents = block.sentences.map((s) => ({ s, range: s.range }));
  const wordRanges = [];
  for (const { s } of sents) {
    for (const w of (words ? s.words : [])) wordRanges.push({ range: [w[0], w[1]], w });
  }
  const cuts = boundaries(block.text.length, [
    ...sents.map((x) => x.range), ...wordRanges.map((x) => x.range), ...italic,
  ]);
  let sEl = null;
  let sCur = null;
  let wEl = null;
  let wCur = null;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k];
    const b = cuts[k + 1];
    if (a === b) continue;
    const sent = sents.find((x) => x.range[0] <= a && b <= x.range[1]) || null;
    const word = wordRanges.find((x) => x.range[0] <= a && b <= x.range[1]) || null;
    if (sent !== sCur) {
      wEl = null; wCur = null;
      sCur = sent;
      if (sent) {
        sEl = document.createElement('span');
        sEl.className = sentenceAttr === 'rs' ? 'rs' : 's';
        sEl.dataset[sentenceAttr] = String(sent.s.id);
        el.append(sEl);
      } else {
        sEl = null;
      }
    }
    if (word !== wCur) {
      wCur = word;
      if (word) {
        wEl = document.createElement('span');
        wEl.className = 'w';
        wEl.dataset.w = String(word.w.global);
        wEl.dataset.d = String(word.w[4]);
        (sEl || el).append(wEl);
      } else {
        wEl = null;
      }
    }
    (wEl || sEl || el).append(textNode(block.text.slice(a, b), Boolean(inside(italic, a, b))));
  }
  return el;
}

export function renderEn(chapter) {
  const root = document.createElement('div');
  let g = 0;
  for (const block of chapter.blocks) {
    for (const s of block.sentences) for (const w of s.words) w.global = g++;
    root.append(renderBlock(block, { sentenceAttr: 's', words: true }));
  }
  return root;
}

export function renderRu(ruChapter) {
  const root = document.createElement('div');
  for (const block of ruChapter.blocks) root.append(renderBlock(block, { sentenceAttr: 'rs', words: false }));
  return root;
}
