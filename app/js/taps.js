// Что означает тап на странице книги (спека §5.2).
export function classifyTap({ x, width, onWord, cardOpen }) {
  if (cardOpen) return 'close-card';
  if (onWord) return 'word';
  if (x < width / 3) return 'prev';
  if (x > (2 * width) / 3) return 'next';
  return 'chrome';
}
