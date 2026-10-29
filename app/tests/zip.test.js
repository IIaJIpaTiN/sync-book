import { test, assertEqual, assertRejects, makeStoreZip } from './harness.js';
import { readZipIndex, entryBlob } from '../js/zip.js';

test('zip: index and read two entries', async () => {
  const blob = makeStoreZip({ 'manifest.json': '{"a":1}', 'audio/01.m4a': 'xyz' });
  const idx = await readZipIndex(blob);
  assertEqual([...idx.keys()], ['manifest.json', 'audio/01.m4a']);
  assertEqual(await entryBlob(blob, idx.get('manifest.json')).text(), '{"a":1}');
  assertEqual(await entryBlob(blob, idx.get('audio/01.m4a')).text(), 'xyz');
});

test('zip: compressed entry rejected', async () => {
  await assertRejects(readZipIndex(makeStoreZip({ 'a.txt': 'hello' }, { method: 8 })), /compressed/);
});

test('zip: random bytes rejected', async () => {
  await assertRejects(readZipIndex(new Blob([new Uint8Array(500).fill(7)])), /not-zip/);
});

test('zip: mini.syncbook has manifest first', async () => {
  const blob = await (await fetch('/output/mini.syncbook')).blob();
  const idx = await readZipIndex(blob);
  assertEqual([...idx.keys()][0], 'manifest.json');
  const m = JSON.parse(await entryBlob(blob, idx.get('manifest.json')).text());
  assertEqual(m.format, 1);
});
