// «Линия чтеца»: подсветка звучащего предложения (.s-on) и слова (.w-on).
import { wordAt } from './timeline.js';

export class Highlighter {
  constructor(root, tl, mode = 'both') {
    this.tl = tl;
    this.mode = mode;
    this.words = [...root.querySelectorAll('[data-w]')];
    this.sents = new Map([...root.querySelectorAll('[data-s]')].map((el) => [Number(el.dataset.s), el]));
    this.w = -1;
    this.wordEl = null;
    this.sentEl = null;
  }

  update(ms) {
    const w = wordAt(this.tl, ms);
    if (w !== this.w) {
      this.w = w;
      this.clear(true);
      this.w = w;
      if (w >= 0) {
        this.wordEl = this.words[w] || null;
        this.sentEl = this.sents.get(this.tl.sentences[this.tl.wSent[w]].id) || null;
        this.paint();
      }
    }
    return { wordEl: this.wordEl, sentEl: this.sentEl, word: this.w, sentence: w >= 0 ? this.tl.wSent[w] : -1 };
  }

  // Подсветить отрывок/предложение целиком (режим «Повтор»).
  showSentence(sIdx) {
    this.clear(false);
    this.w = -2;
    this.sentEl = this.sents.get(this.tl.sentences[sIdx].id) || null;
    if (this.sentEl && this.mode !== 'off') this.sentEl.classList.add('s-on');
    return this.sentEl;
  }

  paint() {
    if (this.sentEl && (this.mode === 'both' || this.mode === 'sentence')) this.sentEl.classList.add('s-on');
    if (this.wordEl && (this.mode === 'both' || this.mode === 'word')) this.wordEl.classList.add('w-on');
  }

  setMode(mode) {
    this.mode = mode;
    this.clear(false);
    this.paint();
  }

  clear(reset = true) {
    if (this.sentEl) this.sentEl.classList.remove('s-on');
    if (this.wordEl) this.wordEl.classList.remove('w-on');
    if (reset) { this.w = -1; this.wordEl = null; this.sentEl = null; }
  }
}
