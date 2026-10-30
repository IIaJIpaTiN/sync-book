// Постраничная вёрстка главы через CSS multi-column: каждая «страница» (или разворот из двух
// колонок) — это сдвиг содержимого на ширину viewport.

export const autoSpread = () =>
  (matchMedia('(orientation: landscape) and (min-width: 1000px)').matches ? 2 : 1);

const DEFAULT_MARGIN = 0.07; // доля ширины экрана

export class Paginator {
  constructor(viewport, content, { spread } = {}) {
    this.viewport = viewport;
    this.content = content;
    this.spread = spread || autoSpread();
    this.page = 0;
    this.pages = 1;
    this.step = 1;
  }

  // Поле M у краёв и такой же зазор M между страницами разворота. В multicol расстояние между
  // любыми соседними колонками одинаково, поэтому содержимое сдвинуто внутрь на M/2, у колонок
  // отступ M/2 по краям, а шаг листания — ширина без этих M/2 с каждой стороны.
  layout() {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    const ratio = parseFloat(getComputedStyle(this.viewport).getPropertyValue('--page-margin'));
    const margin = Math.max(16, Math.round(width * (ratio > 0 && ratio < 1 ? ratio : DEFAULT_MARGIN)));
    const inner = width - margin;
    const k = this.spread;
    this.step = inner;
    this.margin = margin;
    Object.assign(this.content.style, {
      boxSizing: 'border-box',
      marginLeft: `${margin / 2}px`,
      width: `${inner}px`,
      height: `${height}px`,
      padding: `0 ${margin / 2}px`,
      columnGap: `${margin}px`,
      // явная ширина колонки: при column-count 1 без неё WebKit вообще не включает колонки
      columnWidth: `${(inner - k * margin) / k - 0.5}px`,
      columnCount: String(k),
      columnFill: 'auto',
    });
    const last = this.content.lastElementChild;
    if (last) {
      const rects = last.getClientRects();
      const right = (rects.length ? rects[rects.length - 1] : last.getBoundingClientRect()).right;
      const left = this.content.getBoundingClientRect().left;
      this.pages = Math.max(1, Math.floor((right - left - 1) / this.step) + 1);
    } else {
      this.pages = 1;
    }
    this.goTo(Math.min(this.page, this.pages - 1));
    return this.pages;
  }

  goTo(page, { animate = false } = {}) {
    this.page = Math.max(0, Math.min(page, this.pages - 1));
    this.content.style.transition = animate ? 'transform var(--turn) ease' : 'none';
    this.content.style.transform = `translateX(${-this.page * this.step}px)`;
    return this.page;
  }

  pageOf(el) {
    const rects = el.getClientRects();
    const rect = rects.length ? rects[0] : el.getBoundingClientRect();
    const x = rect.left - this.content.getBoundingClientRect().left;
    return Math.max(0, Math.min(this.pages - 1, Math.floor((x + 1) / this.step)));
  }

  isVisible(el) {
    return this.pageOf(el) === this.page;
  }
}

// Что держать на экране при пересчёте страниц: звучащую фразу — только если она и так была
// на экране, иначе первую фразу текущей страницы (иначе пауза + смена шрифта уводит к чтецу).
export function relayoutTarget({ audioEl, audioVisible, pageAnchor }) {
  return audioEl && audioVisible ? audioEl : pageAnchor;
}

export function anchorPageAfterRelayout(paginator, anchorEl) {
  const page = paginator.pageOf(anchorEl);
  paginator.goTo(page);
  return page;
}
