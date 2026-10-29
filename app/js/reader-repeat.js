// Режим «Повтор» на экране чтения: переключатель режимов, кнопки отрывков, подсветка отрывка
// и черта-индикатор паузы под ним.
import { createRepeat } from './repeat.js';
import { chunkAt, firstChunkOfSentence } from './timeline.js';
import { h } from './ui.js';
import { icon } from './icons.js';

const realClock = {
  now: () => performance.now(),
  after(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

export function attachRepeat(api) {
  const { st, el } = api;
  const pc = api.player;
  const player = pc.player;
  let machine = null;
  let marked = [];
  let continueAfterChapter = false;

  // ---------- переключатель режима ----------
  const flowOpt = h('span', { class: 'seg-opt on' }, 'Поток');
  const repOpt = h('span', { class: 'seg-opt' }, 'Повтор');
  const modeSeg = h('button', { class: 'seg mode', 'aria-label': 'Режим воспроизведения', onclick: () => setMode(!api.repeatActive) }, flowOpt, repOpt);
  el.modeSlot.append(modeSeg);

  // ---------- кнопки «Повтора» ----------
  const prevBtn = h('button', { class: 'bar-btn', 'aria-label': 'Предыдущий отрывок', onclick: () => machine && machine.prev() }, icon('prev'));
  const playBtn = h('button', { class: 'bar-btn play', 'aria-label': 'Воспроизвести', onclick: () => togglePlay() }, icon('play', 26));
  const replayBtn = h('button', { class: 'bar-btn', 'aria-label': 'Повторить', onclick: () => machine && machine.replay() }, icon('repeat'));
  const nextBtn = h('button', { class: 'bar-btn', 'aria-label': 'Следующий отрывок', onclick: () => (machine && machine.state().phase === 'waiting' ? machine.proceed() : machine && machine.next()) }, icon('next'));
  const status = h('div', { class: 'repeat-status', 'aria-live': 'polite' });
  const repeatBar = h('div', { class: 'transport repeat', hidden: true }, prevBtn, playBtn, replayBtn, nextBtn);
  el.controls.insertBefore(status, el.rateBtn);
  el.controls.insertBefore(repeatBar, el.rateBtn);
  status.hidden = true;
  const gapBar = h('div', { class: 'gap-bar', hidden: true }, h('div', { class: 'gap-fill' }));
  el.reader.append(gapBar);

  function settings() {
    return { ...pc.settings };
  }

  function ensureMachine() {
    machine = createRepeat({ player, timeline: pc.tl, clock: realClock, getSettings: settings, onState });
  }

  function setMode(repeat) {
    if (repeat === Boolean(api.repeatActive)) return;
    const wasPlaying = player.playing;
    player.pause();
    api.repeatActive = repeat;
    flowOpt.classList.toggle('on', !repeat);
    repOpt.classList.toggle('on', repeat);
    el.transport.hidden = repeat || !pc.hasAudio;
    repeatBar.hidden = !repeat || !pc.hasAudio;
    status.hidden = !repeat;
    el.toReader.hidden = true;
    if (repeat) {
      pc.hl.clear();
      ensureMachine();
      const i = Math.max(0, chunkAt(pc.tl, player.ms));
      machine.select(i);
      markChunk(i);
      if (wasPlaying) machine.start(i);
    } else {
      if (machine) machine.stop();
      unmark();
      gapBar.hidden = true;
      pc.hl.setMode(pc.settings.highlight);
      if (wasPlaying) player.play();
    }
    refresh();
  }
  api.setRepeatMode = setMode;

  function togglePlay() {
    if (!machine) return;
    const { phase, chunk } = machine.state();
    if (phase === 'idle') machine.start(chunk);
    else machine.stop();
  }

  // ---------- отображение состояния ----------
  function onState(s) {
    const c = pc.tl.chunks[s.chunk];
    if (c) markChunk(s.chunk);
    gapBar.hidden = s.phase !== 'gap';
    if (s.phase === 'gap') runGapBar(s.gapMs);
    refresh(s);
    if (s.end) {
      const next = st.index + 1 < st.book.chapters.length ? st.index + 1 : -1;
      if (next >= 0) {
        continueAfterChapter = true;
        pc.loadedChapter = null;
        api.openChapter(next);
      }
    }
  }

  function refresh(s = machine ? machine.state() : { phase: 'idle' }) {
    const busy = s.phase === 'playing' || s.phase === 'gap' || s.phase === 'waiting';
    playBtn.replaceChildren(icon(busy ? 'pause' : 'play', 26));
    playBtn.setAttribute('aria-label', busy ? 'Остановить' : 'Воспроизвести');
    if (s.phase === 'gap') status.textContent = `Повторите вслух · ${(s.gapMs / 1000).toFixed(1)} с`;
    else if (s.phase === 'waiting') status.textContent = 'Повторите вслух и нажмите «Дальше»';
    else if (s.phase === 'playing') status.textContent = pc.settings.repeats > 1 ? `Слушайте · ${s.rep} из ${pc.settings.repeats}` : 'Слушайте';
    else status.textContent = 'Нажмите ▶, чтобы начать';
    api.setChrome(st.chrome);
  }

  function unmark() {
    marked.forEach((w) => w.classList.remove('c-on', 'c-first', 'c-last'));
    marked = [];
  }

  function markChunk(i) {
    unmark();
    const c = pc.tl.chunks[i];
    for (let w = c.first; w <= c.last; w++) {
      const node = pc.hl.words[w];
      if (node) { node.classList.add('c-on'); marked.push(node); }
    }
    if (marked.length) {
      marked[0].classList.add('c-first');
      marked[marked.length - 1].classList.add('c-last');
      const first = marked[0];
      if (!st.paginator.isVisible(first)) api.showPage(st.paginator.pageOf(first));
    }
  }

  // Черта под последней строкой отрывка, заполняется за время паузы.
  function runGapBar(ms) {
    const last = marked[marked.length - 1];
    if (!last) return;
    const lr = last.getBoundingClientRect();
    const sameLine = marked.filter((w) => Math.abs(w.getBoundingClientRect().top - lr.top) < 4);
    const left = Math.min(...sameLine.map((w) => w.getBoundingClientRect().left));
    const host = el.reader.getBoundingClientRect();
    Object.assign(gapBar.style, {
      left: `${left - host.left}px`, top: `${lr.bottom - host.top + 3}px`, width: `${lr.right - left}px`,
    });
    const fill = gapBar.firstChild;
    fill.style.transition = 'none';
    fill.style.transform = 'scaleX(0)';
    gapBar.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.transition = `transform ${ms}ms linear`;
      fill.style.transform = 'scaleX(1)';
    }));
  }

  // слово, звучащее внутри отрывка, подчёркивается
  player.addEventListener('tick', (e) => {
    if (!api.repeatActive || !pc.hl) return;
    if (pc.hl.mode !== 'word') pc.hl.setMode('word');
    pc.hl.update(e.detail.ms);
  });

  api.on('repeat-from-sentence', ({ sIdx }) => {
    if (!machine) return;
    const c = firstChunkOfSentence(pc.tl, sIdx);
    if (c >= 0) machine.start(c);
  });

  api.on('audio-ready', () => {
    if (!api.repeatActive) return;
    ensureMachine();
    unmark();
    el.transport.hidden = true;
    repeatBar.hidden = false;
    if (continueAfterChapter) {
      continueAfterChapter = false;
      machine.start(0);
    } else {
      machine.select(Math.max(0, chunkAt(pc.tl, player.ms)));
      markChunk(machine.state().chunk);
      refresh();
    }
  });

  api.on('chapter', () => {
    if (api.repeatActive && machine) machine.stop();
    gapBar.hidden = true;
  });

  api.on('page', () => { gapBar.hidden = true; });

  const onHidden = () => {
    if (document.visibilityState === 'hidden' && api.repeatActive && machine) machine.stop();
  };
  document.addEventListener('visibilitychange', onHidden);
  api.on('unmount', () => {
    document.removeEventListener('visibilitychange', onHidden);
    if (machine) machine.stop();
  });

  // кнопка play «Потока» в режиме «Повтор» не используется
  api.playOverride = async () => false;
}
