// Настройки чтения: значения по умолчанию, нормализация, CSS-переменные и панель «Аа».
import { getSettings, putSettings } from './store.js';
import { h } from './ui.js';

export const SIZES = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 32];
export const LEADING = { tight: 1.45, normal: 1.6, loose: 1.8 };
export const MARGINS = { narrow: 0.04, normal: 0.07, wide: 0.11 }; // доля ширины экрана
export const FONTS = {
  iowan: '"Iowan Old Style", "Palatino Linotype", Palatino, serif',
  charter: 'Charter, "Bitstream Charter", serif',
  palatino: 'Palatino, "Palatino Linotype", serif',
  newyork: 'ui-serif, "New York", Georgia, serif',
  literata: 'Literata, serif',
};
const FONT_NAMES = { iowan: 'Iowan', charter: 'Charter', palatino: 'Palatino', newyork: 'New York', literata: 'Literata' };
const THEMES = { paper: '#FFFFFF', sepia: '#F8F1E3', gray: '#4A4A4D', night: '#000000' };
const THEME_NAMES = { paper: 'Бумага', sepia: 'Сепия', gray: 'Серая', night: 'Ночь' };

export const DEFAULTS = {
  theme: 'sepia', font: 'iowan', sizeStep: 4, leading: 'normal', margins: 'normal', align: 'justify',
  hyphens: true, rate: 1.0, highlight: 'both', repeatMode: 'auto', gapFactor: 1.5, repeats: 1, pauseOnTranslate: true,
  pageNumbering: 'chapter',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

export function normalize(input) {
  const s = { ...DEFAULTS, ...(input || {}) };
  return {
    theme: pick(s.theme, Object.keys(THEMES), DEFAULTS.theme),
    font: pick(s.font, Object.keys(FONTS), DEFAULTS.font),
    sizeStep: Math.round(clamp(num(s.sizeStep, DEFAULTS.sizeStep), 0, SIZES.length - 1)),
    leading: pick(s.leading, Object.keys(LEADING), DEFAULTS.leading),
    margins: pick(s.margins, Object.keys(MARGINS), DEFAULTS.margins),
    align: pick(s.align, ['justify', 'left'], DEFAULTS.align),
    hyphens: Boolean(s.hyphens),
    rate: Math.round(clamp(num(s.rate, 1), 0.5, 2) * 20) / 20,
    highlight: pick(s.highlight, ['both', 'sentence', 'word', 'off'], DEFAULTS.highlight),
    repeatMode: pick(s.repeatMode, ['auto', 'manual'], DEFAULTS.repeatMode),
    gapFactor: Math.round(clamp(num(s.gapFactor, 1.5), 1, 3) * 10) / 10,
    repeats: Math.round(clamp(num(s.repeats, 1), 1, 3)),
    pauseOnTranslate: Boolean(s.pauseOnTranslate),
    pageNumbering: pick(s.pageNumbering, ['chapter', 'book'], DEFAULTS.pageNumbering),
  };
}

export function toCssVars(s) {
  return {
    '--book-size': `${SIZES[s.sizeStep]}px`,
    '--book-font': FONTS[s.font],
    '--book-leading': String(LEADING[s.leading]),
    '--page-margin': String(MARGINS[s.margins]),
    '--book-align': s.align,
    '--book-hyphens': s.hyphens ? 'auto' : 'manual',
  };
}

export function apply(s) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  for (const [k, v] of Object.entries(toCssVars(s))) root.style.setProperty(k, v);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[s.theme];
}

export async function loadSettings() {
  const s = normalize(await getSettings());
  apply(s);
  return s;
}

// ---------- панель «Аа» ----------

function seg(options, value, onPick) {
  const wrap = h('div', { class: 'seg wide', role: 'radiogroup' });
  for (const [v, label] of options) {
    wrap.append(h('button', {
      class: `seg-opt${v === value ? ' on' : ''}`, role: 'radio', 'aria-checked': String(v === value),
      onclick: (e) => {
        [...wrap.children].forEach((c) => {
          c.classList.toggle('on', c === e.currentTarget);
          c.setAttribute('aria-checked', String(c === e.currentTarget));
        });
        onPick(v);
      },
    }, label));
  }
  return wrap;
}

function row(label, control) {
  return h('div', { class: 'set-row' }, h('span', { class: 'set-label' }, label), control);
}

function slider({ min, max, step, value, format, onInput }) {
  const out = h('span', { class: 'set-value' }, format(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { const v = Number(e.target.value); out.textContent = format(v); onInput(v); },
  });
  return h('div', { class: 'set-slider' }, input, out);
}

function toggle(value, onChange) {
  const btn = h('button', {
    class: `switch${value ? ' on' : ''}`, role: 'switch', 'aria-checked': String(value),
    onclick: () => { const v = !btn.classList.contains('on'); btn.classList.toggle('on', v); btn.setAttribute('aria-checked', String(v)); onChange(v); },
  });
  return btn;
}

export function attachSettings(api) {
  const { el } = api;
  let s = { ...DEFAULTS };
  let panel = null;

  async function update(patch) {
    const before = s;
    s = normalize({ ...s, ...patch });
    await putSettings(s);
    apply(s);
    const pc = api.player;
    if (pc) {
      Object.assign(pc.settings, s);
      if (s.rate !== before.rate) api.setRate(s.rate);
      if (pc.hl && s.highlight !== before.highlight && !api.repeatActive) pc.hl.setMode(s.highlight);
    }
    if (s.pageNumbering !== before.pageNumbering) api.setNumbering(s.pageNumbering);
    const layoutKeys = ['sizeStep', 'font', 'leading', 'margins', 'align', 'hyphens'];
    if (layoutKeys.some((k) => s[k] !== before[k])) {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      api.relayout();
    }
  }

  function close() {
    if (!panel) return;
    panel.remove();
    panel = null;
    document.removeEventListener('pointerdown', outside, true);
  }

  function outside(e) {
    if (panel && !panel.contains(e.target) && !el.aa.contains(e.target) && !el.rateBtn.contains(e.target)) close();
  }

  function open(focusRate = false) {
    if (panel) { close(); return; }
    const sizeBtns = h('div', { class: 'size-btns' },
      h('button', { class: 'size-btn small', 'aria-label': 'Мельче', onclick: () => update({ sizeStep: s.sizeStep - 1 }) }, 'A'),
      h('button', { class: 'size-btn big', 'aria-label': 'Крупнее', onclick: () => update({ sizeStep: s.sizeStep + 1 }) }, 'A'));
    const themes = h('div', { class: 'themes' }, Object.entries(THEMES).map(([k, color]) => h('button', {
      class: `theme-dot${k === s.theme ? ' on' : ''}`, style: `background:${color}`, 'aria-label': THEME_NAMES[k],
      onclick: (e) => { themes.querySelectorAll('.theme-dot').forEach((d) => d.classList.toggle('on', d === e.currentTarget)); update({ theme: k }); },
    })));
    const fonts = h('div', { class: 'fonts' }, Object.keys(FONTS).map((k) => h('button', {
      class: `font-opt${k === s.font ? ' on' : ''}`, style: `font-family:${FONTS[k]}`,
      onclick: (e) => { fonts.querySelectorAll('.font-opt').forEach((d) => d.classList.toggle('on', d === e.currentTarget)); update({ font: k }); },
    }, FONT_NAMES[k])));
    const rate = row('Скорость', slider({
      min: 0.5, max: 2, step: 0.05, value: s.rate, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => update({ rate: v }),
    }));
    panel = h('div', { class: 'settings-panel', role: 'dialog', 'aria-label': 'Оформление и звук' },
      h('div', { class: 'set-top' }, sizeBtns, themes),
      fonts,
      row('Интервал', seg([['tight', 'Плотно'], ['normal', 'Обычно'], ['loose', 'Свободно']], s.leading, (v) => update({ leading: v }))),
      row('Поля', seg([['narrow', 'Узкие'], ['normal', 'Обычные'], ['wide', 'Широкие']], s.margins, (v) => update({ margins: v }))),
      row('Выравнивание', seg([['justify', 'По ширине'], ['left', 'Влево']], s.align, (v) => update({ align: v }))),
      row('Переносы', toggle(s.hyphens, (v) => update({ hyphens: v }))),
      row('Нумерация страниц', seg([['chapter', 'Глава'], ['book', 'Книга']], s.pageNumbering, (v) => update({ pageNumbering: v }))),
      h('h4', { class: 'set-section' }, 'Звук'),
      rate,
      row('Подсветка', seg([['both', 'Всё'], ['sentence', 'Фраза'], ['word', 'Слово'], ['off', 'Нет']], s.highlight, (v) => update({ highlight: v }))),
      h('h4', { class: 'set-section' }, 'Повтор'),
      row('Пауза', seg([['auto', 'Авто'], ['manual', 'Вручную']], s.repeatMode, (v) => update({ repeatMode: v }))),
      row('Длина паузы', slider({
        min: 1, max: 3, step: 0.1, value: s.gapFactor, format: (v) => `×${v.toFixed(1)}`, onInput: (v) => update({ gapFactor: v }),
      })),
      row('Повторов', seg([[1, '1'], [2, '2'], [3, '3']], s.repeats, (v) => update({ repeats: v }))),
      row('Пауза при переводе', toggle(s.pauseOnTranslate, (v) => update({ pauseOnTranslate: v }))));
    el.reader.append(panel);
    document.addEventListener('pointerdown', outside, true);
    if (focusRate) rate.scrollIntoView({ block: 'center' });
  }

  api.on('settings', () => open());
  api.on('rate-click', () => open(true));
  api.on('numbering-toggle', () => update({ pageNumbering: s.pageNumbering === 'book' ? 'chapter' : 'book' }));
  api.on('unmount', close);
  api.on('ready', async () => {
    s = normalize(await getSettings());
    apply(s);
    api.setNumbering(s.pageNumbering);
    if (api.player) {
      Object.assign(api.player.settings, s);
      api.setRate(s.rate);
      if (api.player.hl) api.player.hl.setMode(s.highlight);
    }
  });
}
