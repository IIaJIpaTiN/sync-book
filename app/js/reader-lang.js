// Переключение EN ↔ RU: открывает другой язык в том же месте главы.
import { ruFor, enFor } from './bilingual.js';

export function attachLang(api) {
  const { st } = api;
  api.on('lang', async ({ to }) => {
    const align = st.data.ru.align;
    if (to === 'ru') {
      if (api.repeatActive && api.setRepeatMode) api.setRepeatMode(false);
      const pc = api.player;
      const playingSentence = pc && pc.player.playing && pc.hl && pc.hl.sentEl;
      const anchor = playingSentence || st.anchor;
      const enId = anchor ? Number(anchor.dataset.s) : 0;
      await api.setLang('ru', { rsId: ruFor(enId, align) ?? 0 });
    } else {
      const ruId = st.anchor ? Number(st.anchor.dataset.rs) : 0;
      await api.setLang('en', { sentenceId: enFor(ruId, align) ?? 0 });
      if (api.player) api.player.follow = true;
    }
  });
}
