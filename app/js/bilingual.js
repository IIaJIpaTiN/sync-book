// Соответствие предложений английского и русского текста по карте выравнивания главы:
// align = [[[en ids], [ru ids]], ...] в порядке текста.

function find(id, align, side) {
  const other = 1 - side;
  const i = align.findIndex((g) => g[side].includes(id));
  if (i < 0) return null;
  for (let k = i; k >= 0; k--) if (align[k][other].length) return align[k][other][0];
  for (let k = i + 1; k < align.length; k++) if (align[k][other].length) return align[k][other][0];
  return null;
}

export const ruFor = (enId, align) => find(enId, align, 0);
export const enFor = (ruId, align) => find(ruId, align, 1);

export function groupFor(enId, align) {
  const g = align.find((x) => x[0].includes(enId));
  return g ? { en: [...g[0]], ru: [...g[1]] } : { en: [], ru: [] };
}
