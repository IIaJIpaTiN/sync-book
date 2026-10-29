// Конечный автомат режима «Повтор»: отрывок → (повторы) → пауза или ожидание → следующий отрывок.
// Не зависит от DOM: плеер, часы и настройки передаются снаружи.

export function createRepeat({ player, timeline, clock, getSettings, onState }) {
  const s = { phase: 'idle', chunk: 0, rep: 0, gapMs: 0, gapEndsAt: 0, end: false };
  let token = 0;
  let cancelGap = null;

  const emit = () => onState({ ...s });

  function cancel() {
    token++;
    if (cancelGap) { cancelGap(); cancelGap = null; }
  }

  function enter(phase, extra = {}) {
    Object.assign(s, { phase, end: false }, extra);
    emit();
  }

  async function play(i, rep) {
    const my = token;
    const c = timeline.chunks[i];
    enter('playing', { chunk: i, rep, gapMs: 0, gapEndsAt: 0 });
    const result = await player.playRange(c.start, c.end);
    if (my !== token) return;
    if (result !== 'done') { enter('idle'); return; }
    const cfg = getSettings();
    if (rep < cfg.repeats) { play(i, rep + 1); return; }
    if (cfg.repeatMode === 'manual') { enter('waiting'); return; }
    const gapMs = Math.round(((c.end - c.start) * cfg.gapFactor) / (cfg.rate || 1));
    enter('gap', { gapMs, gapEndsAt: clock.now() + gapMs });
    cancelGap = clock.after(gapMs, () => { cancelGap = null; if (my === token) start(i + 1); });
  }

  function start(i) {
    cancel();
    if (i >= timeline.chunks.length) {
      enter('idle', { chunk: timeline.chunks.length - 1 });
      s.end = true;
      emit();
      return;
    }
    play(Math.max(0, i), 1);
  }

  return {
    state: () => ({ ...s }),
    start,
    next: () => start(s.chunk + 1),
    prev: () => start(Math.max(0, s.chunk - 1)),
    replay: () => start(s.chunk),
    proceed: () => { if (s.phase === 'waiting' || s.phase === 'gap') start(s.chunk + 1); },
    stop() {
      const wasPlaying = s.phase === 'playing';
      cancel();
      if (wasPlaying) player.pause();
      enter('idle');
    },
    // Перейти к отрывку без воспроизведения (смена позиции в паузе).
    select(i) {
      cancel();
      enter('idle', { chunk: Math.max(0, Math.min(i, timeline.chunks.length - 1)) });
    },
  };
}
