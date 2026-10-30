// Перелистывание в стиле «Сдвиг» Apple Books: страница — карточка с тенью.
// Вперёд: текущая карточка уезжает влево, открывая следующую страницу (притенённую, тень сходит).
// Назад: предыдущая карточка наезжает слева поверх текущей (та притеняется).

export const SHADE = 0.16;
// Сняты с записи Apple Books: половина пути за ~120–220 мс, 90 % за ~350–550 мс, видимое движение ~600 мс.
const BASE_MS = 600;
const MIN_MS = 120;
const EASE = 'cubic-bezier(.25, .46, .45, .94)';

// p — доля пройденного перелистывания, 0..1.
export function slidePositions(dir, p, width) {
  return dir > 0
    ? { cardX: -p * width, shade: SHADE * (1 - p) }
    : { cardX: -(1 - p) * width, shade: SHADE * p };
}

export function dragProgress(dir, dx, width) {
  const p = dir > 0 ? -dx / width : dx / width;
  return Math.max(0, Math.min(1, p));
}

// velocity — px/мс в сторону перелистывания (отрицательная — палец тянет обратно).
export function shouldComplete(progress, velocity) {
  if (velocity < -0.3) return false;
  return progress > 0.25 || velocity > 0.35;
}

export function finishDuration(fromP, toP, base = BASE_MS) {
  return Math.max(MIN_MS, Math.round(base * Math.abs(toP - fromP)));
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Слои анимации поверх экрана чтения (host): [under] → тень → карточка.
// Карточка — снимок всего экрана страницы: колонтитул, текст и номер страницы.
export function createSlide({ host, card, under = null, dir }) {
  const width = host.clientWidth;
  const shade = document.createElement('div');
  shade.className = 'page-shade';
  if (under && !under.isConnected) host.append(under);
  host.append(shade, card);
  let p = 0;

  function apply(np, ms) {
    p = np;
    const pos = slidePositions(dir, p, width);
    card.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none';
    shade.style.transition = ms ? `opacity ${ms}ms ${EASE}` : 'none';
    card.style.transform = `translateX(${pos.cardX}px)`;
    shade.style.opacity = String(pos.shade);
  }
  apply(0, 0);

  return {
    get progress() { return p; },
    set(np) { apply(np, 0); },
    run(to) {
      const ms = reducedMotion() ? 0 : finishDuration(p, to);
      card.getBoundingClientRect(); // зафиксировать начальное положение перед анимацией
      apply(to, ms);
      return new Promise((resolve) => setTimeout(resolve, ms + 16));
    },
    remove() {
      card.remove();
      shade.remove();
      if (under) under.remove();
    },
  };
}
