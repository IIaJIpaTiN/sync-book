// Обёртка над <audio>: точный опрос времени через requestAnimationFrame, воспроизведение отрезка
// (playRange) с остановкой на его конце, ожидание seeked перед play.

export class Player extends EventTarget {
  constructor(audio = new Audio()) {
    super();
    this.audio = audio;
    this.audio.preload = 'auto';
    this.url = null;
    this.raf = 0;
    this.range = null; // { end, resolve }
    this.audio.addEventListener('play', () => { this.emit('playstate'); this.loop(); });
    this.audio.addEventListener('pause', () => {
      this.emit('playstate');
      if (this.range && !this.range.finishing) this.finishRange('interrupted');
    });
    this.audio.addEventListener('ended', () => {
      if (this.range) this.finishRange('done');
      this.emit('ended');
    });
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  async load(file, ms = 0) {
    this.finishRange('interrupted');
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    this.audio.src = this.url;
    await new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('Аудио не читается')); };
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', ok);
        this.audio.removeEventListener('error', fail);
      };
      this.audio.addEventListener('loadedmetadata', ok);
      this.audio.addEventListener('error', fail);
    });
    if (ms) await this.seek(ms);
  }

  unload() {
    this.finishRange('interrupted');
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  get ms() { return Math.round(this.audio.currentTime * 1000); }
  get playing() { return !this.audio.paused; }
  get durationMs() { return Math.round((this.audio.duration || 0) * 1000); }

  set rate(r) {
    this.audio.playbackRate = r;
    this.audio.defaultPlaybackRate = r;
    this.audio.preservesPitch = true;
    this.audio.webkitPreservesPitch = true;
  }

  get rate() { return this.audio.playbackRate; }

  async play() {
    await this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(ms) {
    return new Promise((resolve) => {
      const target = Math.max(0, ms) / 1000;
      if (Math.abs(this.audio.currentTime - target) < 0.001) { resolve(); return; }
      this.audio.addEventListener('seeked', () => resolve(), { once: true });
      this.audio.currentTime = target;
    });
  }

  // Воспроизводит [startMs, endMs) и ставит на паузу в конце. Результат: "done" | "interrupted".
  async playRange(startMs, endMs) {
    this.finishRange('interrupted');
    const result = new Promise((resolve) => { this.range = { end: endMs, resolve, finishing: false }; });
    const range = this.range;
    await this.seek(startMs);
    if (this.range !== range) return result;
    try {
      await this.play();
    } catch (err) {
      this.finishRange('interrupted');
    }
    return result;
  }

  finishRange(result) {
    const r = this.range;
    if (!r) return;
    this.range = null;
    r.resolve(result);
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.audio.paused) return;
      const ms = this.ms;
      if (this.range && ms >= this.range.end) {
        this.range.finishing = true;
        const r = this.range;
        this.audio.pause();
        if (this.range === r) this.finishRange('done');
      }
      this.emit('tick', { ms });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}
