import { test, assertEqual, assertRejects } from './harness.js';
import { entryFor, formatSenses } from '../js/dict.js';
import { translate } from '../js/online.js';

const dict = { entries: [{ lemma: 'young', ipa: '/jʌŋ/', senses: [{ pos: 'adj', tr: ['молодой', 'юный'] }, { pos: 'noun', tr: ['детёныш'] }] }, { lemma: 'Burrich', name: true }] };

test('dict: entry by index', () => {
  assertEqual(entryFor(dict, -1), null);
  assertEqual(entryFor(dict, 0).lemma, 'young');
  assertEqual(entryFor(dict, 7), null);
});

test('dict: senses formatted with Russian part of speech', () => {
  assertEqual(formatSenses(entryFor(dict, 0)), [{ pos: 'прил.', tr: 'молодой, юный' }, { pos: 'сущ.', tr: 'детёныш' }]);
  assertEqual(formatSenses(entryFor(dict, 1)), []);
});

test('online: falls back to second provider', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('googleapis')) throw new TypeError('network');
    return { ok: true, json: async () => ({ responseData: { translatedText: 'Привет' } }) };
  };
  assertEqual(await translate('Hello', 'en', 'ru', { fetchImpl, online: true }), 'Привет');
  assertEqual(urls.length, 2);
});

test('online: Google response is joined', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [[['Мальчик ', 'The boy '], ['зажёг фонарь.', 'lit the lantern.']]] });
  assertEqual(await translate('The boy lit the lantern.', 'en', 'ru', { fetchImpl, online: true }), 'Мальчик зажёг фонарь.');
});

test('online: offline is reported', async () => {
  await assertRejects(translate('x', 'en', 'ru', { fetchImpl: async () => { throw new Error('no'); }, online: false }), /offline/);
});
