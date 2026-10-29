// Таймлайн главы: плоские массивы времён слов и индексы предложений/отрывков для быстрого поиска.
// Индекс слова совпадает с data-w из render.js (сквозной порядок блоков → предложений → слов).

export function build(chapter) {
  const wStart = [];
  const wEnd = [];
  const wSent = [];
  const sentences = [];
  const chunks = [];
  const sentFirstChunk = [];
  for (const block of chapter.blocks) {
    for (const s of block.sentences) {
      const si = sentences.length;
      const first = wStart.length;
      for (const w of s.words) {
        wStart.push(w[2]);
        wEnd.push(w[3]);
        wSent.push(si);
      }
      sentences.push({ id: s.id, firstWord: first, lastWord: wStart.length - 1, t: s.t });
      sentFirstChunk.push(chunks.length);
      for (const c of s.chunks) chunks.push({ s: si, first: first + c[0], last: first + c[1], start: c[2], end: c[3] });
    }
  }
  return {
    wStart: Int32Array.from(wStart),
    wEnd: Int32Array.from(wEnd),
    wSent: Int32Array.from(wSent),
    sentences,
    chunks,
    sentFirstChunk,
  };
}

// Последний индекс i, для которого key(i) <= ms; -1, если таких нет.
function lastAtOrBefore(n, key, ms) {
  let lo = 0;
  let hi = n - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(mid) <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export const wordAt = (tl, ms) => lastAtOrBefore(tl.wStart.length, (i) => tl.wStart[i], ms);
export const chunkAt = (tl, ms) => lastAtOrBefore(tl.chunks.length, (i) => tl.chunks[i].start, ms);
export const sentenceIndexById = (tl, id) => tl.sentences.findIndex((s) => s.id === id);

export function firstChunkOfSentence(tl, sIdx) {
  const c = tl.sentFirstChunk[sIdx];
  return c < tl.chunks.length && tl.chunks[c].s === sIdx ? c : -1;
}

export function nextAudioChapter(chapters, idx) {
  for (let i = idx + 1; i < chapters.length; i++) if (chapters[i].audio) return i;
  return -1;
}
