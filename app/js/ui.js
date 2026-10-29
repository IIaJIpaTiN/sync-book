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
export function sheet({ title, text, body = [], actions = [] }) {
  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 150);
  };
  const buttons = actions.map((a) => h('button', {
    class: `sheet-btn${a.danger ? ' danger' : ''}`,
    onclick: async () => { close(); if (a.run) await a.run(); },
  }, a.label));
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    title && h('h3', { class: 'sheet-title' }, title),
    text && h('p', { class: 'sheet-text' }, text),
    ...body,
    buttons.length > 0 && h('div', { class: 'sheet-actions' }, buttons));
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  return { close, panel };
}
