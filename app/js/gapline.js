// Черта-индикатор паузы «Повтора» под всеми строками отрывка: она заполняется строка за строкой,
// как при чтении, и заканчивается вместе с паузой.

// Прямоугольники слов (в порядке текста) → отрезки строк { left, right, bottom }.
export function lineSegments(rects) {
  const lines = [];
  let cur = null;
  for (const r of rects) {
    if (cur && Math.abs(r.top - cur.top) < 4 && r.left >= cur.right - 2) {
      cur.right = Math.max(cur.right, r.right);
      cur.bottom = Math.max(cur.bottom, r.bottom);
    } else {
      cur = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      lines.push(cur);
    }
  }
  return lines.map(({ left, right, bottom }) => ({ left, right, bottom }));
}

// Время заполнения каждой строки пропорционально её ширине.
export function fillSchedule(segments, totalMs) {
  const total = segments.reduce((s, x) => s + (x.right - x.left), 0) || 1;
  let acc = 0;
  return segments.map((seg) => {
    const delay = Math.round((acc / total) * totalMs);
    acc += seg.right - seg.left;
    return { ...seg, delay, duration: Math.round((acc / total) * totalMs) - delay };
  });
}
