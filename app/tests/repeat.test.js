import { test, assertEqual } from './harness.js';
import { createRepeat } from '../js/repeat.js';
import { Player } from '../js/player.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakes(settings) {
  const fp = {
    calls: [],
    pending: null,
    playRange(start, end) {
      fp.calls.push({ op: 'playRange', start, end });
      return new Promise((resolve) => { fp.pending = resolve; });
    },
    pause() { fp.calls.push({ op: 'pause' }); },
    async finish(result = 'done') {
      const p = fp.pending;
      fp.pending = null;
      p(result);
      await tick();
      await tick();
    },
  };
  const clock = {
    t: 0,
    timers: [],
    now: () => clock.t,
    after(ms, fn) {
      const timer = { at: clock.t + ms, fn };
      clock.timers.push(timer);
      return () => { clock.timers = clock.timers.filter((x) => x !== timer); };
    },
    advance(ms) {
      clock.t += ms;
      const due = clock.timers.filter((x) => x.at <= clock.t);
      clock.timers = clock.timers.filter((x) => x.at > clock.t);
      due.forEach((x) => x.fn());
    },
  };
  const timeline = { chunks: [{ s: 0, start: 1000, end: 3000 }, { s: 0, start: 3000, end: 4000 }, { s: 1, start: 4200, end: 6200 }] };
  const states = [];
  const r = createRepeat({
    player: fp, timeline, clock,
    getSettings: () => ({ repeatMode: 'auto', gapFactor: 1.5, repeats: 1, rate: 1, ...settings }),
    onState: (s) => states.push(s),
  });
  return { r, fp, clock, states, last: () => states[states.length - 1] };
}

test('repeat: auto play → gap → next', async () => {
  const { r, fp, clock, last } = fakes({});
  r.start(0);
  await fp.finish();
  assertEqual(last().phase, 'gap');
  assertEqual(last().gapMs, 3000);
  clock.advance(3000);
  assertEqual([last().phase, last().chunk], ['playing', 1]);
  assertEqual(fp.calls[1], { op: 'playRange', start: 3000, end: 4000 });
});

test('repeat: gap scales with playback rate', async () => {
  const { r, fp, last } = fakes({ rate: 0.5 });
  r.start(0);
  await fp.finish();
  assertEqual(last().gapMs, 6000);
});

test('repeat: repeats twice before moving on', async () => {
  const { r, fp, last } = fakes({ repeats: 2 });
  r.start(0);
  await fp.finish();
  assertEqual([last().phase, last().chunk, last().rep], ['playing', 0, 2]);
  await fp.finish();
  assertEqual(last().phase, 'gap');
});

test('repeat: manual waits for proceed', async () => {
  const { r, fp, clock, last } = fakes({ repeatMode: 'manual' });
  r.start(0);
  await fp.finish();
  assertEqual(last().phase, 'waiting');
  clock.advance(60000);
  assertEqual(last().chunk, 0);
  r.proceed();
  assertEqual([last().phase, last().chunk], ['playing', 1]);
});

test('repeat: next cancels pending gap', async () => {
  const { r, fp, clock } = fakes({});
  r.start(0);
  await fp.finish();
  r.next();
  clock.advance(100000);
  assertEqual(fp.calls.filter((c) => c.op === 'playRange').length, 2);
});

test('repeat: interrupted playback goes idle', async () => {
  const { r, fp, last } = fakes({});
  r.start(1);
  await fp.finish('interrupted');
  assertEqual(last().phase, 'idle');
});

test('repeat: last chunk ends the chapter', async () => {
  const { r, fp, clock, last } = fakes({});
  r.start(2);
  await fp.finish();
  clock.advance(10000);
  assertEqual([last().phase, last().end], ['idle', true]);
});

test('player: seek completes before play', async () => {
  const log = [];
  const listeners = {};
  const audio = {
    paused: true, _t: 0, playbackRate: 1, duration: 10,
    get currentTime() { return this._t; },
    set currentTime(v) {
      this._t = v;
      log.push('currentTime=');
      setTimeout(() => { log.push('seeked'); (listeners.seeked || []).forEach((f) => f()); }, 5);
    },
    addEventListener(n, f, o) {
      const wrapped = o && o.once ? () => { listeners[n] = listeners[n].filter((x) => x !== wrapped); f(); } : f;
      (listeners[n] = listeners[n] || []).push(wrapped);
    },
    removeEventListener(n, f) { listeners[n] = (listeners[n] || []).filter((x) => x !== f); },
    play() { log.push('play'); this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
  const p = new Player(audio);
  p.playRange(2000, 3000);
  await new Promise((r) => setTimeout(r, 30));
  assertEqual(log.join(','), 'currentTime=,seeked,play');
  audio.paused = true;
});

// <audio>, который, как настоящий, отправляет play/pause/seeked отдельной задачей
function asyncAudio() {
  const listeners = {};
  const fire = (n) => setTimeout(() => (listeners[n] || []).slice().forEach((f) => f()), 0);
  return {
    paused: true, playbackRate: 1, duration: 10, _t: 0, log: [],
    get currentTime() { return this._t; },
    set currentTime(v) { this._t = v; fire('seeked'); },
    addEventListener(n, f, o) {
      const w = o && o.once ? () => { listeners[n] = listeners[n].filter((x) => x !== w); f(); } : f;
      (listeners[n] = listeners[n] || []).push(w);
    },
    removeEventListener(n, f) { listeners[n] = (listeners[n] || []).filter((x) => x !== f); },
    play() { this.log.push('play'); if (this.paused) { this.paused = false; fire('play'); } return Promise.resolve(); },
    pause() { this.log.push('pause'); if (!this.paused) { this.paused = true; fire('pause'); } },
  };
}
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const state = (promise) => Promise.race([promise, settle(40).then(() => 'pending')]);

test('player: explicit pause does not cancel the range started right after it', async () => {
  const audio = asyncAudio();
  const p = new Player(audio);
  const r1 = p.playRange(0, 1000);
  await settle();
  p.pause();
  const r2 = p.playRange(2000, 3000);
  assertEqual(await r1, 'interrupted');
  assertEqual(await state(r2), 'pending');
  p.pause();
});

test('player: range end does not cancel the next range (repeats)', async () => {
  const audio = asyncAudio();
  const p = new Player(audio);
  let r2 = null;
  const r1 = p.playRange(0, 1000).then((res) => { r2 = p.playRange(0, 1000); return res; });
  await settle();
  p.endRange();
  assertEqual(await r1, 'done');
  assertEqual(await state(r2), 'pending');
  p.pause();
});

test('player: external pause interrupts the range', async () => {
  const audio = asyncAudio();
  const p = new Player(audio);
  const r1 = p.playRange(0, 1000);
  await settle();
  audio.pause();
  assertEqual(await state(r1), 'interrupted');
});

test('player: unlock is synchronous and harmless to a range started in the same gesture', async () => {
  const audio = asyncAudio();
  audio.src = 'blob:x';
  const p = new Player(audio);
  p.unlock();
  assertEqual(audio.log, ['play', 'pause']);
  const r = p.playRange(2000, 3000);
  p.unlock();
  assertEqual(audio.log.length, 2, 'unlock runs once');
  assertEqual(await state(r), 'pending');
  p.pause();
});
