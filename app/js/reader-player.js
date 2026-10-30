// Плеер на экране чтения: нижняя панель, подсветка «Потока», следование за чтецом, «К чтецу»,
// долгое нажатие по слову, переход к следующей главе по окончании аудио, сохранение позиции.
import { Player } from './player.js';
import { build, nextAudioChapter, sentenceIndexById, wordAt } from './timeline.js';
import { Highlighter } from './sync.js';
import { relayoutTarget } from './paginator.js';
import { ruFor } from './bilingual.js';
import { audioFile, audioName, putProgress } from './store.js';
import { h, sheet } from './ui.js';
import { icon } from './icons.js';

const LONG_PRESS_MS = 500;
const SAVE_EVERY_MS = 2000;
const BACKGROUND_SAVE_MS = 5000;

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
    chapterGen: 0,
    longPress: null,
    longFired: false,
    settings: { rate: 1, highlight: 'both', repeatMode: 'auto', gapFactor: 1.5, repeats: 1, pauseOnTranslate: true },
  };
  api.player = ctx;
  api.currentMs = () => player.ms;
  api.isPlaying = () => player.playing;

  // ---------- нижняя панель ----------
  const playBtn = h('button', { class: 'bar-btn play', 'aria-label': 'Воспроизвести', onclick: () => toggle() }, icon('play', 34));
  const back = h('button', { class: 'bar-btn', 'aria-label': 'Назад на 15 секунд', onclick: () => skip(-15000) }, icon('back15', 30));
  const fwd = h('button', { class: 'bar-btn', 'aria-label': 'Вперёд на 15 секунд', onclick: () => skip(15000) }, icon('fwd15', 30));
  const rateBtn = h('button', { class: 'chip', 'aria-label': 'Скорость', onclick: () => api.emit('rate-click') }, '1.0×');
  const transport = h('div', { class: 'transport' }, back, playBtn, fwd);
  const noAudio = h('div', { class: 'no-audio', hidden: true }, 'Аудио этой главы недоступно');
  el.modeSlot = h('div', { class: 'mode-slot' });
  el.left.append(el.modeSlot);
  el.center.append(transport, noAudio);
  el.right.prepend(rateBtn);
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
    playBtn.replaceChildren(icon(player.playing ? 'pause' : 'play', 34));
    playBtn.setAttribute('aria-label', player.playing ? 'Пауза' : 'Воспроизвести');
    api.setChrome(st.chrome);
  }
  player.addEventListener('playstate', refreshPlayBtn);

  async function toggle() {
    if (!ctx.hasAudio) return;
    if (player.playing) { player.pause(); return; }
    api.emit('play-request');
    if (api.playOverride && (await api.playOverride())) return;
    // продолжаем с места чтеца: если пользователь ушёл листать, возвращаем страницу к нему
    // (начать с другого места — долгое нажатие на слово → «Читать отсюда»)
    showReader();
    await player.play();
  }

  async function skip(delta) {
    if (!ctx.hasAudio) return;
    await player.seek(Math.max(0, Math.min(player.ms + delta, player.durationMs - 100)));
    ctx.follow = true;
    onTick(player.ms);
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

  // Элемент на экране, соответствующий месту чтеца: слово в английском тексте или
  // соответствующая фраза русского издания.
  function readerEl() {
    if (st.lang === 'en') return (ctx.hl && ctx.hl.wordEl) || null;
    if (!ctx.tl || !st.data.ru) return null;
    const w = wordAt(ctx.tl, player.ms);
    if (w < 0) return null;
    const enId = ctx.tl.sentences[ctx.tl.wSent[w]].id;
    if (enId !== ctx.ruEnId) {
      ctx.ruEnId = enId;
      const rid = ruFor(enId, st.data.ru.align);
      ctx.ruEl = rid == null ? null : el.content.querySelector(`[data-rs="${rid}"]`);
    }
    return ctx.ruEl;
  }

  function readerVisible() {
    const r = readerEl();
    return Boolean(r && st.paginator && st.paginator.isVisible(r));
  }

  function showReader() {
    const r = readerEl();
    if (r && !st.paginator.isVisible(r)) api.goPage(st.paginator.pageOf(r));
    ctx.follow = true;
    el.toReader.hidden = true;
  }

  // Место чтеца в русском тексте: страницы следуют за ним, «К чтецу» возвращает к нему.
  function onTickRu() {
    const r = readerEl();
    if (!r) { el.toReader.hidden = true; return; }
    const visible = st.paginator.isVisible(r);
    if (visible) ctx.follow = true;
    if (!visible && ctx.follow && player.playing) api.goPage(st.paginator.pageOf(r));
    el.toReader.hidden = ctx.follow || !player.playing;
  }

  function onTick(ms) {
    if (api.repeatActive) return;
    if (st.lang !== 'en') { if (ctx.tl) onTickRu(); updateRemaining(ms); return; }
    if (!ctx.hl) return;
    const { wordEl, sentence } = ctx.hl.update(ms);
    if (wordEl) {
      const visible = st.paginator.isVisible(wordEl);
      if (visible) ctx.follow = true;
      if (!visible && ctx.follow && player.playing) {
        api.goPage(st.paginator.pageOf(wordEl));
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
    el.remaining.textContent = ` · осталось ${min < 1 ? 'меньше минуты' : `${min} мин`}`;
  }

  function backToReader() {
    showReader();
  }

  api.on('manual-turn', () => {
    if (!player.playing) return;
    ctx.follow = readerVisible();
    el.toReader.hidden = ctx.follow;
  });

  api.on('page', () => {
    if (ctx.hasAudio && !player.playing) updateRemaining(player.ms);
  });

  // ---------- главы ----------
  api.on('chapter', async ({ meta }) => {
    const gen = ++ctx.chapterGen;
    const wasPlaying = player.playing || ctx.autoplayNext;
    let jumpToReader = false;
    ctx.autoplayNext = false;
    if (ctx.hl) ctx.hl.clear();
    ctx.tl = build(st.data.en);
    ctx.hl = st.lang === 'en' ? new Highlighter(el.content, ctx.tl, ctx.settings.highlight) : null;
    ctx.ruEnId = null; // место чтеца в русском тексте ищется заново
    const file = meta.audio ? await audioFile(st.book.id, audioName(meta.audio)) : null;
    if (gen !== ctx.chapterGen) return; // пока читали файл, открыли другую главу
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
      if (gen !== ctx.chapterGen) return;
      ctx.loadedChapter = meta.id;
      player.rate = ctx.settings.rate;
      const resume = api.initialProgress;
      api.initialProgress = null;
      if (resume && resume.chapterId === meta.id && resume.ms) {
        // точное место прошлого сеанса, а не начало страницы
        await player.seek(resume.ms);
        jumpToReader = true;
      } else {
        // начало звука — первое предложение открытой страницы
        await seekToSentenceEl(st.anchor);
      }
      if (gen !== ctx.chapterGen) return;
    }
    // подсветка обновляется без перелистывания: к чтецу переходим только при возобновлении сеанса,
    // а при возврате с русского текста остаёмся на той странице, которую читали
    ctx.follow = false;
    onTick(player.ms);
    const w = ctx.hl && ctx.hl.wordEl;
    if (jumpToReader && w && !st.paginator.isVisible(w)) api.showPage(st.paginator.pageOf(w), false);
    ctx.follow = readerVisible();
    el.toReader.hidden = ctx.follow || !wasPlaying;
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


  // при перерасчёте страниц держим на экране звучащее предложение, если читаем вслед за чтецом
  api.audioOnScreen = () => Boolean(ctx.hasAudio && st.lang === 'en' && ctx.hl && ctx.hl.sentEl && currentWordVisible());
  api.relayoutAnchor = () => relayoutTarget({
    audioEl: ctx.hl && ctx.hl.sentEl, audioVisible: api.audioOnScreen(), pageAnchor: st.anchor,
  });

  // ---------- сохранение позиции в фоне ----------
  // при заблокированном экране requestAnimationFrame не работает, а timeupdate — работает
  function saveNow() {
    if (!ctx.tl || !ctx.hasAudio) return;
    const w = wordAt(ctx.tl, player.ms);
    if (w >= 0) saveAt(ctx.tl.wSent[w]);
  }
  player.audio.addEventListener('timeupdate', () => {
    if (Date.now() - ctx.lastSave < BACKGROUND_SAVE_MS) return;
    ctx.lastSave = Date.now();
    saveNow();
  });
  const onHidden = () => { if (document.visibilityState === 'hidden') saveNow(); };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', saveNow);

  // ---------- разблокировка звука для iOS ----------
  // активацией считаются click и touchend (не pointerdown); вызов синхронный, внутри жеста
  const unlock = () => { if (ctx.hasAudio) player.unlock(); };
  el.reader.addEventListener('click', unlock, true);
  el.reader.addEventListener('touchend', unlock, true);

  // ---------- долгое нажатие по слову ----------

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
  api.on('drag-start', () => clearTimeout(ctx.longPress));
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
    saveNow();
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', saveNow);
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
