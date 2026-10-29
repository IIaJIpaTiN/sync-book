// Перевод на экране чтения: тап по слову — карточка слова; «Предложение» — карточка предложения.
import { getDict } from './store.js';
import { entryFor } from './dict.js';
import { groupFor } from './bilingual.js';
import * as cards from './cards.js';

export function attachTranslate(api) {
  const { st, el } = api;
  let dict = null;
  let resume = false;
  let selected = null;

  api.cardOpen = () => cards.isOpen();

  api.on('ready', async () => { dict = await getDict(st.book.id); });

  function pauseForCard() {
    const pc = api.player;
    if (!pc || !pc.settings.pauseOnTranslate) return;
    if (api.repeatActive) return;
    if (pc.player.playing) { resume = true; pc.player.pause(); }
  }

  function onClose() {
    if (selected) selected.classList.remove('w-sel');
    selected = null;
    if (resume) { resume = false; api.player.player.play(); }
  }

  function sentenceText(sIdx) {
    const id = api.player.tl.sentences[sIdx].id;
    const sEl = el.content.querySelector(`[data-s="${id}"]`);
    return { id, sEl, text: sEl ? sEl.textContent.trim() : '' };
  }

  function ruText(enId) {
    if (!st.data.ru) return null;
    const g = groupFor(enId, st.data.ru.align);
    if (!g.ru.length) return null;
    const parts = [];
    for (const block of st.data.ru.blocks) {
      for (const s of block.sentences) if (g.ru.includes(s.id)) parts.push(block.text.slice(s.range[0], s.range[1]));
    }
    return parts.join(' ');
  }

  function showSentence(sIdx, anchor) {
    const { id, sEl, text } = sentenceText(sIdx);
    cards.showSentenceCard(anchor || sEl, el.reader, { en: text, ru: ruText(id), onClose });
  }

  api.on('word', ({ el: wordEl }) => {
    pauseForCard();
    selected = wordEl;
    wordEl.classList.add('w-sel');
    const w = Number(wordEl.dataset.w);
    const pc = api.player;
    const sIdx = pc.tl.wSent[w];
    const canVoice = pc.hasAudio && !api.repeatActive;
    cards.showWordCard(wordEl, el.reader, {
      surface: wordEl.textContent,
      entry: entryFor(dict, Number(wordEl.dataset.d)),
      onVoice: canVoice ? async () => {
        const back = pc.player.ms;
        await pc.player.playRange(Math.max(0, pc.tl.wStart[w] - 40), pc.tl.wEnd[w] + 60);
        await pc.player.seek(back);
      } : null,
      onSentence: () => {
        const keep = resume;
        resume = false;
        cards.close();
        resume = keep;
        showSentence(sIdx, wordEl);
      },
      onClose,
    });
  });

  api.on('translate-sentence', ({ sIdx, el: anchor }) => {
    pauseForCard();
    showSentence(sIdx, anchor);
  });

  api.on('close-card', () => cards.close());
  api.on('chapter', () => cards.close());
  api.on('page', () => cards.close());
  api.on('unmount', () => cards.close());
}
