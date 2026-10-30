// Режим «Повтор» на экране чтения: переключатель режимов, кнопки отрывков, подсветка отрывка
// и черта-индикатор паузы под ним.
import { createRepeat } from './repeat.js';
import { chunkAt, firstChunkOfSentence } from './timeline.js';
import { h, sheet } from './ui.js';
import { icon } from './icons.js';
import { lineSegments, fillSchedule } from './gapline.js';

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
  const prevBtn = h('button', { class: 'bar-btn', 'aria-label': 'Предыдущий отрывок', onclick: () => machine && machine.prev() }, icon('prev', 30));
  const playBtn = h('button', { class: 'bar-btn play', 'aria-label': 'Воспроизвести', onclick: () => togglePlay() }, icon('play', 34));
  const replayBtn = h('button', { class: 'bar-btn', 'aria-label': 'Повторить', onclick: () => machine && machine.replay() }, icon('repeat', 30));
  const nextBtn = h('button', { class: 'bar-btn', 'aria-label': 'Следующий отрывок', onclick: () => (machine && machine.state().phase === 'waiting' ? machine.proceed() : machine && machine.next()) }, icon('next', 30));
  const status = h('div', { class: 'repeat-status', 'aria-live': 'polite' });
  const repeatBar = h('div', { class: 'transport repeat', hidden: true }, prevBtn, playBtn, replayBtn, nextBtn);
  el.left.append(status);
  el.center.append(repeatBar);
  status.hidden = true;
  const gapBar = h('div', { class: 'gap-lines', hidden: true });
  el.reader.append(gapBar);

  function settings() {
    return { ...pc.settings };
  }

  function ensureMachine() {
    // состояния старого автомата (прошлой главы) игнорируются
    const m = createRepeat({
      player, timeline: pc.tl, clock: realClock, getSettings: settings,
      onState: (s) => { if (machine === m) onState(s); },
    });
    machine = m;
  }

  function dropMachine() {
    const m = machine;
    machine = null;
    if (m) m.stop();
    unmark();
    gapBar.hidden = true;
  }

  function setMode(repeat) {
    if (repeat === Boolean(api.repeatActive)) return;
    if (repeat && (st.lang !== 'en' || !pc.tl || !pc.hl)) {
      sheet({ title: 'Режим «Повтор» работает с английским текстом', text: 'Переключите текст на EN и включите режим снова.', actions: [{ label: 'Понятно' }] });
      return;
    }
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
      dropMachine();
      if (pc.hl) pc.hl.setMode(pc.settings.highlight);
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
    playBtn.replaceChildren(icon(busy ? 'pause' : 'play', 34));
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
      if (!st.paginator.isVisible(first)) api.goPage(st.paginator.pageOf(first));
    }
  }

  // Черты под всеми строками отрывка: заполняются по очереди за время паузы.
  function runGapBar(ms) {
    if (!marked.length) return;
    const host = el.reader.getBoundingClientRect();
    const vp = el.viewport.getBoundingClientRect();
    const rects = marked.flatMap((w) => [...w.getClientRects()])
      .filter((r) => r.right > vp.left && r.left < vp.right);
    const plan = fillSchedule(lineSegments(rects), ms);
    const fills = plan.map((seg) => {
      const fill = h('div', { class: 'gap-fill' });
      const bar = h('div', { class: 'gap-bar' }, fill);
      Object.assign(bar.style, {
        left: `${seg.left - host.left}px`, top: `${seg.bottom - host.top + 3}px`, width: `${seg.right - seg.left}px`,
      });
      return { fill, seg };
    });
    gapBar.replaceChildren(...fills.map((f) => f.fill.parentNode));
    gapBar.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const { fill, seg } of fills) {
        fill.style.transition = `transform ${seg.duration}ms linear ${seg.delay}ms`;
        fill.style.transform = 'scaleX(1)';
      }
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
    dropMachine();
    modeSeg.classList.toggle('disabled', st.lang !== 'en');
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
