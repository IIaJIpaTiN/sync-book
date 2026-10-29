// Постраничная вёрстка главы через CSS multi-column: каждая «страница» (или разворот из двух
// колонок) — это сдвиг содержимого на ширину viewport.

export const autoSpread = () =>
  (matchMedia('(orientation: landscape) and (min-width: 1000px)').matches ? 2 : 1);

export class Paginator {
  constructor(viewport, content, { spread } = {}) {
    this.viewport = viewport;
    this.content = content;
    this.spread = spread || autoSpread();
    this.page = 0;
    this.pages = 1;
    this.step = 1;
  }

  layout() {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    const margin = parseFloat(getComputedStyle(this.viewport).getPropertyValue('--page-margin')) || 48;
    this.step = width;
    Object.assign(this.content.style, {
      boxSizing: 'border-box',
      width: `${width}px`,
      height: `${height}px`,
      padding: `0 ${margin}px`,
      columnCount: String(this.spread),
      columnGap: `${2 * margin}px`,
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

export function anchorPageAfterRelayout(paginator, anchorEl) {
  const page = paginator.pageOf(anchorEl);
  paginator.goTo(page);
  return page;
}
