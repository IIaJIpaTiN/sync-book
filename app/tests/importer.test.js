import { test, assertEqual, assertRejects, makeStoreZip } from './harness.js';
import { importSyncbook, cleanupIncomplete } from '../js/importer.js';
import { getBook, getChapter, getDict, audioFile, putBook, deleteBook, hasAllAudio } from '../js/store.js';

test('import: mini book', async () => {
  const blob = await (await fetch('/output/mini.syncbook')).blob();
  const seen = [];
  const rec = await importSyncbook(blob, (f) => seen.push(f));
  assertEqual(rec.status, 'ready');
  assertEqual(rec.title, 'The Lantern Keeper');
  assertEqual((await getChapter(rec.id, '01')).en.blocks.length > 0, true);
  assertEqual((await getChapter(rec.id, '01')).ru.align.length > 0, true);
  assertEqual((await getDict(rec.id)).entries.length, 10);
  assertEqual((await audioFile(rec.id, '01.m4a')).size > 0, true);
  assertEqual(await hasAllAudio(rec), true);
  assertEqual(seen[seen.length - 1], 1);
});

test('import: wrong format rejected and nothing left', async () => {
  await assertRejects(importSyncbook(makeStoreZip({ 'manifest.json': '{"format":2,"id":"x"}' }), () => {}), /format/);
  assertEqual(await getBook('x'), undefined);
});

test('import: corrupt book cleaned up', async () => {
  const zip = makeStoreZip({
    'manifest.json': JSON.stringify({ format: 1, id: 'broken', title: 'B', chapters: [{ id: '01', text: 'text/01.json', ru: null, audio: null }] }),
  });
  await assertRejects(importSyncbook(zip, () => {}), /corrupt/);
  assertEqual(await getBook('broken'), undefined);
});

test('import: cleanupIncomplete removes half-imported', async () => {
  await putBook({ id: 'half', status: 'importing', chapters: [] });
  assertEqual(await cleanupIncomplete(), 1);
  assertEqual(await getBook('half'), undefined);
});

test('import: delete removes audio', async () => {
  const rec = await importSyncbook(await (await fetch('/output/mini.syncbook')).blob(), () => {});
  await deleteBook(rec.id);
  assertEqual(await getBook(rec.id), undefined);
  assertEqual(await audioFile(rec.id, '01.m4a'), null);
});

test('store: worker write path (Safari fallback)', async () => {
  const { writeViaWorker } = await import('../js/store.js');
  const data = new Blob([new Uint8Array(20 * 1024 * 1024).fill(3)]);
  let bytes = 0;
  await writeViaWorker('wtest', 'x.m4a', data, (n) => { bytes += n; });
  const f = await audioFile('wtest', 'x.m4a');
  assertEqual([f.size, bytes, new Uint8Array(await f.slice(0, 2).arrayBuffer())[1]], [20 * 1024 * 1024, 20 * 1024 * 1024, 3]);
  await deleteBook('wtest');
});
