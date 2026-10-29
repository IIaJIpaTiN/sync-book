// Плеер на экране чтения: нижняя панель, подсветка «Потока», следование за чтецом, «К чтецу»,
// долгое нажатие по слову, переход к следующей главе по окончании аудио, сохранение позиции.
import { Player } from './player.js';
import { build, nextAudioChapter, sentenceIndexById } from './timeline.js';
import { Highlighter } from './sync.js';
import { audioFile, audioName, putProgress } from './store.js';
import { h, sheet } from './ui.js';
import { icon } from './icons.js';

const LONG_PRESS_MS = 500;
const SAVE_EVERY_MS = 2000;

export function attachPlayer(api) {
  const { st, el } = api;
  const player = new Player();
  const ctx = {
    player,
    tl: null,
    hl: null,
    follow: true,
    hasAudio: false,
    lastSave: 0,
    lastSentence: -1,
    autoplayNext: false,
    longPress: null,
    longFired: false,
    settings: { rate: 1, highlight: 'both', repeatMode: 'auto', gapFactor: 1.5, repeats: 1, pauseOnTranslate: true },
  };
  api.player = ctx;
  api.currentMs = () => player.ms;
  api.isPlaying = () => player.playing;

  // ---------- нижняя панель ----------
  const playBtn = h('button', { class: 'bar-btn play', 'aria-label': 'Воспроизвести', onclick: () => toggle() }, icon('play', 26));
  const back = h('button', { class: 'bar-btn', 'aria-label': 'Назад на 15 секунд', onclick: () => skip(-15000) }, icon('back15'));
  const fwd = h('button', { class: 'bar-btn', 'aria-label': 'Вперёд на 15 секунд', onclick: () => skip(15000) }, icon('fwd15'));
  const rateBtn = h('button', { class: 'chip', 'aria-label': 'Скорость', onclick: () => api.emit('rate-click') }, '1.0×');
  const transport = h('div', { class: 'transport' }, back, playBtn, fwd);
  const noAudio = h('div', { class: 'no-audio', hidden: true }, 'Аудио этой главы недоступно');
  el.modeSlot = h('div', { class: 'mode-slot' });
  el.controls.append(el.modeSlot, transport, rateBtn, noAudio);
  el.toReader = h('button', { class: 'to-reader', hidden: true, onclick: () => backToReader() }, 'К чтецу');
  el.reader.append(el.toReader);
  el.transport = transport;
  el.rateBtn = rateBtn;

  function setRate(r) {
    ctx.settings.rate = r;
    player.rate = r;
    rateBtn.textContent = `${r.toFixed(r * 100 % 10 ? 2 : 1)}×`;
  }
  api.setRate = setRate;

  function refreshPlayBtn() {
    playBtn.replaceChildren(icon(player.playing ? 'pause' : 'play', 26));
    playBtn.setAttribute('aria-label', player.playing ? 'Пауза' : 'Воспроизвести');
    api.setChrome(st.chrome);
  }
  player.addEventListener('playstate', refreshPlayBtn);

  async function toggle() {
    if (!ctx.hasAudio) return;
    if (player.playing) { player.pause(); return; }
    api.emit('play-request');
    if (api.playOverride && (await api.playOverride())) return;
    // если пользователь ушёл листать — начинаем с первого предложения на странице
    if (!ctx.follow || !currentWordVisible()) await seekToSentenceEl(firstSentenceOnPage());
    ctx.follow = true;
    await player.play();
  }

  async function skip(delta) {
    if (!ctx.hasAudio) return;
    await player.seek(Math.max(0, Math.min(player.ms + delta, player.durationMs - 100)));
    ctx.follow = true;
    onTick(player.ms);
  }

  function firstSentenceOnPage() {
    return st.anchor;
  }

  async function seekToSentenceEl(sEl) {
    if (!sEl || !ctx.tl || st.lang !== 'en') return;
    const idx = sentenceIndexById(ctx.tl, Number(sEl.dataset.s));
    if (idx >= 0) await player.seek(ctx.tl.sentences[idx].t[0]);
  }
  api.seekToSentence = async (sIdx) => {
    await player.seek(ctx.tl.sentences[sIdx].t[0]);
    ctx.follow = true;
    onTick(player.ms);
  };

  // ---------- подсветка и следование ----------
  function currentWordVisible() {
    const w = ctx.hl && ctx.hl.wordEl;
    return Boolean(w && st.paginator && st.paginator.isVisible(w));
  }

  function onTick(ms) {
    if (!ctx.hl || st.lang !== 'en' || api.repeatActive) return;
    const { wordEl, sentence } = ctx.hl.update(ms);
    if (wordEl) {
      const visible = st.paginator.isVisible(wordEl);
      if (visible) ctx.follow = true;
      if (!visible && ctx.follow && player.playing) {
        api.showPage(st.paginator.pageOf(wordEl));
      }
      el.toReader.hidden = ctx.follow || !player.playing;
    }
    if (sentence !== ctx.lastSentence && Date.now() - ctx.lastSave > SAVE_EVERY_MS) {
      ctx.lastSentence = sentence;
      ctx.lastSave = Date.now();
      saveAt(sentence);
    }
    updateRemaining(ms);
  }
  player.addEventListener('tick', (e) => onTick(e.detail.ms));

  function saveAt(sIdx) {
    if (sIdx < 0) return;
    const meta = st.book.chapters[st.index];
    putProgress(st.book.id, { chapterId: meta.id, lang: st.lang, sentenceId: ctx.tl.sentences[sIdx].id, ms: player.ms });
  }

  function updateRemaining(ms) {
    const left = Math.max(0, (player.durationMs - ms) / ctx.settings.rate);
    const min = Math.round(left / 60000);
    el.pageinfo.textContent = `${el.folio.textContent} · осталось ${min < 1 ? 'меньше минуты' : `${min} мин`}`;
  }

  async function backToReader() {
    ctx.follow = true;
    const w = ctx.hl && ctx.hl.wordEl;
    if (w) api.showPage(st.paginator.pageOf(w));
    el.toReader.hidden = true;
  }

  api.on('manual-turn', () => {
    if (!player.playing) return;
    ctx.follow = currentWordVisible();
    el.toReader.hidden = ctx.follow;
  });

  api.on('page', () => {
    if (ctx.hasAudio && !player.playing) updateRemaining(player.ms);
  });

  // ---------- главы ----------
  api.on('chapter', async ({ meta }) => {
    const wasPlaying = player.playing || ctx.autoplayNext;
    ctx.autoplayNext = false;
    if (ctx.hl) ctx.hl.clear();
    ctx.tl = build(st.data.en);
    ctx.hl = st.lang === 'en' ? new Highlighter(el.content, ctx.tl, ctx.settings.highlight) : null;
    const file = meta.audio ? await audioFile(st.book.id, audioName(meta.audio)) : null;
    ctx.hasAudio = Boolean(file);
    transport.hidden = !file;
    rateBtn.hidden = !file;
    el.modeSlot.hidden = !file;
    noAudio.hidden = Boolean(file) || !meta.audio;
    if (!file) { player.unload(); el.toReader.hidden = true; return; }
    if (ctx.loadedChapter !== meta.id) {
      try {
        await player.load(file);
      } catch {
        ctx.hasAudio = false;
        transport.hidden = true;
        rateBtn.hidden = true;
        el.modeSlot.hidden = true;
        noAudio.hidden = false;
        return;
      }
      ctx.loadedChapter = meta.id;
      player.rate = ctx.settings.rate;
      // начало звука — первое предложение открытой страницы
      await seekToSentenceEl(st.anchor);
    }
    ctx.follow = true;
    onTick(player.ms);
    setMediaMeta(meta);
    if (wasPlaying) await player.play();
    api.emit('audio-ready');
  });

  // ---------- экран блокировки и наушники ----------
  let coverUrl = null;
  function setMediaMeta(meta) {
    if (!('mediaSession' in navigator)) return;
    if (!coverUrl && st.book.cover) coverUrl = URL.createObjectURL(st.book.cover);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: st.book.author,
      album: st.book.title,
      artwork: coverUrl ? [{ src: coverUrl, sizes: '600x900', type: 'image/jpeg' }] : [],
    });
  }

  function setHandlers() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => toggle(),
      pause: () => player.pause(),
      seekbackward: () => skip(-15000),
      seekforward: () => skip(15000),
      previoustrack: () => { if (st.index > 0) { ctx.loadedChapter = null; ctx.autoplayNext = player.playing; api.openChapter(st.index - 1); } },
      nexttrack: () => {
        const next = nextAudioChapter(st.book.chapters, st.index);
        if (next >= 0) { ctx.loadedChapter = null; ctx.autoplayNext = player.playing; api.openChapter(next); }
      },
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(action, fn); } catch { /* действие не поддерживается */ }
    }
  }
  setHandlers();

  player.addEventListener('ended', async () => {
    if (api.repeatActive) return;
    const next = nextAudioChapter(st.book.chapters, st.index);
    if (next < 0) return;
    ctx.autoplayNext = true;
    ctx.loadedChapter = null;
    await api.openChapter(next);
  });

  api.on('ready', async ({ progress }) => {
    if (progress && progress.ms && ctx.hasAudio && progress.chapterId === st.book.chapters[st.index].id) {
      await player.seek(progress.ms);
      onTick(player.ms);
      const w = ctx.hl && ctx.hl.wordEl;
      if (w) api.showPage(st.paginator.pageOf(w), false);
    }
  });

  api.on('lang', () => { if (ctx.hl) ctx.hl.clear(); });

  // ---------- долгое нажатие по слову ----------
  // первый жест на экране чтения разблокирует звук для iOS
  const unlock = () => { if (ctx.hasAudio) player.unlock(); };
  el.reader.addEventListener('pointerdown', unlock, true);

  api.on('pointerdown', ({ start }) => {
    clearTimeout(ctx.longPress);
    ctx.longFired = false;
    const word = start.target.closest && start.target.closest('.w');
    if (!word || st.lang !== 'en') return;
    ctx.longPress = setTimeout(() => {
      ctx.longFired = true;
      wordMenu(word);
    }, LONG_PRESS_MS);
  });
  api.consumeTap = (s) => {
    clearTimeout(ctx.longPress);
    if (ctx.longFired) { ctx.longFired = false; return true; }
    return false;
  };

  function wordMenu(wordEl) {
    const sIdx = ctx.tl.wSent[Number(wordEl.dataset.w)];
    const actions = [];
    if (ctx.hasAudio) {
      actions.push({
        label: 'Читать отсюда',
        run: async () => {
          await player.seek(ctx.tl.wStart[Number(wordEl.dataset.w)]);
          ctx.follow = true;
          onTick(player.ms);
          if (api.repeatActive) api.emit('repeat-from-sentence', { sIdx });
          else await player.play();
        },
      });
    }
    actions.push({ label: 'Перевести предложение', run: () => api.emit('translate-sentence', { sIdx, el: wordEl }) });
    actions.push({ label: 'Отмена' });
    sheet({ title: wordEl.closest('[data-s]').textContent.slice(0, 90), actions });
  }

  api.on('unmount', () => {
    player.unload();
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) {
        try { navigator.mediaSession.setActionHandler(a, null); } catch { /* нет */ }
      }
    }
  });

  return ctx;
}
