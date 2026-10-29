// Карточки перевода: слово (словарь книги, голос чтеца) и предложение (русское издание, онлайн).
import { h } from './ui.js';
import { icon } from './icons.js';
import { formatSenses } from './dict.js';
import { translate } from './online.js';

const WIDTH = 320;
let current = null;

export const isOpen = () => Boolean(current);

export function close() {
  if (!current) return;
  const c = current;
  current = null;
  c.el.classList.remove('open');
  c.abort.abort();
  setTimeout(() => c.el.remove(), 150);
  if (c.onClose) c.onClose();
}

function place(card, anchor, host) {
  const a = anchor.getBoundingClientRect();
  const r = host.getBoundingClientRect();
  card.style.width = `${Math.min(WIDTH, r.width - 24)}px`;
  host.append(card);
  const ch = card.offsetHeight;
  const cw = card.offsetWidth;
  let top = a.bottom - r.top + 10;
  if (top + ch > r.height - 70) top = a.top - r.top - ch - 10;
  const left = Math.max(12, Math.min(a.left - r.left + a.width / 2 - cw / 2, r.width - cw - 12));
  card.style.top = `${Math.max(64, top)}px`;
  card.style.left = `${left}px`;
  requestAnimationFrame(() => card.classList.add('open'));
}

function open(anchor, host, children, onClose) {
  close();
  const abort = new AbortController();
  const card = h('div', { class: 'card', role: 'dialog' }, children);
  current = { el: card, abort, onClose };
  place(card, anchor, host);
  return { card, signal: abort.signal };
}

function onlineBlock(text, signal) {
  const out = h('p', { class: 'card-online' });
  const btn = h('button', {
    class: 'card-btn',
    onclick: async () => {
      btn.disabled = true;
      out.textContent = 'Перевожу…';
      try {
        out.textContent = await translate(text, 'en', 'ru', { signal });
        btn.remove();
      } catch (err) {
        out.textContent = err.message === 'offline' ? 'Нет подключения к интернету' : 'Не получилось перевести. Попробуйте ещё раз';
        out.classList.add('error');
        btn.disabled = false;
      }
    },
  }, 'Перевести онлайн');
  return { out, btn };
}

export function showWordCard(anchor, host, { surface, entry, onVoice, onSentence, onClose }) {
  const senses = formatSenses(entry);
  const lemma = entry && !entry.name && entry.lemma.toLowerCase() !== surface.toLowerCase() ? entry.lemma : null;
  const meta = [entry && entry.ipa, senses.length === 1 ? senses[0].pos : null].filter(Boolean).join(' · ');
  const body = [];
  body.push(h('div', { class: 'card-head' },
    h('span', { class: 'card-word' }, surface),
    meta && h('span', { class: 'card-meta' }, meta)));
  if (lemma) body.push(h('div', { class: 'card-lemma' }, `начальная форма: ${lemma}`));
  if (entry && entry.name) body.push(h('p', { class: 'card-tr muted' }, 'Имя собственное'));
  if (senses.length === 1) body.push(h('p', { class: 'card-tr' }, senses[0].tr));
  if (senses.length > 1) {
    body.push(h('dl', { class: 'card-senses' }, senses.map((s) => [h('dt', {}, s.pos), h('dd', {}, s.tr)])));
  }
  const actions = h('div', { class: 'card-actions' });
  if (onVoice) actions.append(h('button', { class: 'card-btn', onclick: onVoice }, icon('voice', 16), 'Голос чтеца'));
  actions.append(h('button', { class: 'card-btn', onclick: onSentence }, 'Предложение'));
  const { signal } = open(anchor, host, [...body, actions], onClose);
  if (!entry) {
    const { out, btn } = onlineBlock(surface, signal);
    actions.prepend(btn);
    current.el.insertBefore(out, actions);
    current.el.insertBefore(h('p', { class: 'card-tr muted' }, 'Этого слова нет в словаре книги'), out);
  }
}

export function showSentenceCard(anchor, host, { en, ru, onClose }) {
  const body = [
    h('p', { class: 'card-en' }, en),
    ru ? h('p', { class: 'card-ru' }, ru) : h('p', { class: 'card-tr muted' }, 'В русском издании этого места нет'),
  ];
  const actions = h('div', { class: 'card-actions' });
  const { signal } = open(anchor, host, [...body, actions], onClose);
  const { out, btn } = onlineBlock(en, signal);
  btn.textContent = 'Машинный перевод';
  actions.append(btn);
  current.el.insertBefore(out, actions);
}
