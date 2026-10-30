// Переключение EN ↔ RU: открывает другой язык в том же месте главы.
import { ruFor, enFor, groupFor } from './bilingual.js';

const FLASH_MS = 4000;

export function attachLang(api) {
  const { st, el } = api;
  let back = null; // откуда ушли на русский: { enId, chapter, page }

  // Подсветить в русском тексте место, где был чтец, с плавным угасанием.
  function flash(ruIds) {
    for (const id of ruIds) {
      const s = el.content.querySelector(`[data-rs="${id}"]`);
      if (!s) continue;
      s.classList.add('rs-flash');
      setTimeout(() => s.classList.remove('rs-flash'), FLASH_MS + 100);
    }
  }

  api.on('lang', async ({ to }) => {
    const align = st.data.ru.align;
    if (to === 'ru') {
      if (api.repeatActive && api.setRepeatMode) api.setRepeatMode(false);
      const pc = api.player;
      // звучащая фраза на экране — открываем русский текст на ней, иначе на первой фразе страницы
      const readerHere = Boolean(api.audioOnScreen && api.audioOnScreen());
      const anchor = readerHere ? pc.hl.sentEl : st.anchor;
      const enId = anchor ? Number(anchor.dataset.s) : 0;
      const rsId = ruFor(enId, align) ?? 0;
      await api.setLang('ru', { rsId });
      // если в русском тексте не листали, обратно вернёмся ровно на эту английскую фразу
      back = { enId: anchor ? enId : null, chapter: st.index, page: st.paginator.page };
      // подсвечиваем место чтеца, а если его нет на экране — перевод первой английской фразы страницы
      if (anchor && (!pc || pc.settings.highlight !== 'off')) {
        const g = groupFor(enId, align);
        flash(g.ru.length ? g.ru : [rsId]);
      }
    } else {
      // обратно — к тому, что сейчас на экране, а не к месту чтеца
      const unchanged = back && back.enId != null && back.chapter === st.index && back.page === st.paginator.page;
      const ruId = st.anchor ? Number(st.anchor.dataset.rs) : 0;
      await api.setLang('en', { sentenceId: unchanged ? back.enId : (enFor(ruId, align) ?? 0) });
      back = null;
    }
  });
}
