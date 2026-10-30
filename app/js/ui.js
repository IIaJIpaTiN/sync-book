// Мелкие помощники интерфейса: создание элементов и нижний лист с действиями.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Лист по центру снизу: заголовок, текст/элементы, кнопки. Тап по фону закрывает.
// kind: 'page' — большой лист снизу, как оглавление в Books: выезжает снизу, уезжает вниз.
export function sheet({ title, text, body = [], actions = [], kind = null }) {
  const page = kind === 'page';
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    backdrop.classList.remove('open');
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), page ? PAGE_CLOSE_MS : 150);
  };
  const buttons = actions.map((a) => h('button', {
    class: `sheet-btn${a.danger ? ' danger' : ''}`,
    onclick: async () => { close(); if (a.run) await a.run(); },
  }, a.label));
  const panel = h('div', { class: `sheet${page ? ' page' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    title && h('h3', { class: 'sheet-title' }, title),
    text && h('p', { class: 'sheet-text' }, text),
    ...body,
    buttons.length > 0 && h('div', { class: 'sheet-actions' }, buttons));
  const backdrop = h('div', {
    class: `backdrop${page ? ' page-sheet' : ''}`,
    onclick: (e) => { if (e.target === backdrop) close(); },
  }, panel);
  document.body.append(backdrop);
  panel.getBoundingClientRect(); // зафиксировать начальное положение (за нижним краем) до анимации
  backdrop.classList.add('open');
  return { close, panel };
}

const PAGE_CLOSE_MS = 400;
