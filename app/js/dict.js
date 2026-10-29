// Словарь книги: запись по индексу из data-d и подписи частей речи по-русски.
const POS = {
  noun: 'сущ.', verb: 'гл.', adj: 'прил.', adv: 'нар.', prep: 'предл.', pron: 'мест.', conj: 'союз',
  intj: 'межд.', num: 'числ.', det: 'опр.', article: 'арт.', particle: 'част.', phrase: 'фраза', name: 'имя',
};

export function entryFor(dict, index) {
  if (!dict || index < 0) return null;
  return dict.entries[index] || null;
}

export function formatSenses(entry) {
  if (!entry || !entry.senses) return [];
  return entry.senses.map((s) => ({ pos: POS[s.pos] || s.pos, tr: s.tr.join(', ') }));
}
