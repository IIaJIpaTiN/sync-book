// Небольшой набор линейных иконок (stroke = currentColor).
const P = {
  library: '<path d="M4 5h3v14H4zM9 5h3v14H9z"/><path d="M14.5 5.6l2.9-.8 3.6 13.6-2.9.8z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="18" r=".6"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z" fill="currentColor" stroke="none"/>',
  back15: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v3.7h3.7"/><text x="12" y="15.2" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-weight="600">15</text>',
  fwd15: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v3.7h-3.7"/><text x="12" y="15.2" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-weight="600">15</text>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
  voice: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;
  return span;
}
