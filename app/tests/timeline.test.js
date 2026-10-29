import { test, assertEqual } from './harness.js';
import { build, wordAt, chunkAt, firstChunkOfSentence, nextAudioChapter } from '../js/timeline.js';
import { readZipIndex, entryBlob } from '../js/zip.js';

async function chapter() {
  const blob = await (await fetch('/output/mini.syncbook')).blob();
  const idx = await readZipIndex(blob);
  return JSON.parse(await entryBlob(blob, idx.get('text/01.json')).text());
}

test('timeline: word lookup by time', async () => {
  const tl = build(await chapter());
  assertEqual(wordAt(tl, -1), -1);
  assertEqual(wordAt(tl, tl.wStart[5]), 5);
  assertEqual(wordAt(tl, tl.wEnd[5] + 1), 5, 'pause between words keeps previous word');
  assertEqual(wordAt(tl, 10 ** 9), tl.wStart.length - 1);
});

test('timeline: sentences and chunks are consistent', async () => {
  const tl = build(await chapter());
  const s = tl.wSent[7];
  assertEqual(tl.sentences[s].firstWord <= 7 && 7 <= tl.sentences[s].lastWord, true);
  const c = firstChunkOfSentence(tl, s);
  assertEqual(tl.chunks[c].s, s);
  assertEqual(tl.chunks[c].first, tl.sentences[s].firstWord);
  assertEqual(chunkAt(tl, tl.chunks[c].start + 1), c);
});

test('timeline: global word indexes match render order', async () => {
  const ch = await chapter();
  const tl = build(ch);
  const total = ch.blocks.reduce((n, b) => n + b.sentences.reduce((m, s) => m + s.words.length, 0), 0);
  assertEqual(tl.wStart.length, total);
});

test('timeline: next chapter with audio', () => {
  assertEqual(nextAudioChapter([{ audio: 'a' }, { audio: null }, { audio: 'b' }], 0), 2);
  assertEqual(nextAudioChapter([{ audio: 'a' }, { audio: null }, { audio: 'b' }], 2), -1);
});
