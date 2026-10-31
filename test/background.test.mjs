import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../ykt-5x.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('  function createBackground('), source.indexOf('  function installUniversal('));
class Hub {
  handlers = new Map();
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  emit(name, event = {}) { for (const fn of [...(this.handlers.get(name) || [])]) fn(event); }
  count(name) { return this.handlers.get(name)?.size || 0; }
}
function fixture() {
  let time = 2000, serial = 0, current;
  const tasks = new Map();
  const doc = new Hub(); doc.hidden = false; doc.URL = 'https://example.com/video';
  const stats = { play: 0, corrected: 0, ended: 0, stopped: 0 };
  const makeVideo = () => Object.assign(new Hub(), { ownerDocument: doc, isConnected: true,
    readyState: 4, currentSrc: 'fixture:one', srcObject: null, currentTime: 0, playbackRate: 5,
    paused: false, ended: false, error: null, seeking: false,
    pause() { this.paused = true; this.emit('pause'); },
    async play() { stats.play++; if (this.reject) throw this.reject; this.paused = false; this.emit('playing'); },
  });
  const v = makeVideo(); current = v;
  const hooks = { getVideo: () => current,
    correctRate() { stats.corrected++; if (hooks.failRate) return { ok: false }; current.playbackRate = 5; current.emit('ratechange'); return { ok: true }; },
    stopKeeper() { stats.stopped++; }, onEnded() { stats.ended++; } };
  const make = vm.runInNewContext(helper + ';createBackground', { document: doc, performance: { now: () => time },
    setTimeout(fn, delay) { const id = ++serial; tasks.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { tasks.delete(id); } });
  const api = make(hooks); api.bind(v);
  const advance = async ms => {
    const end = time + ms;
    for (;;) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      time = next[1].at; tasks.delete(next[0]); await next[1].fn(); await Promise.resolve();
    }
    time = end;
  };
  const hide = () => { doc.hidden = true; doc.emit('visibilitychange'); };
  return { api, v, doc, stats, hooks, advance, hide, tasks, makeVideo, select(next) { current = next; api.bind(next); } };
}

test('background defaults off; front/hidden progress is measured rather than inferred from playbackRate', async () => {
  const f = fixture();
  assert.equal(f.api.state().enabled, false);
  await f.advance(1000); f.v.currentTime = 5;
  assert.equal(f.api.state().progress.effectiveRate, 5);
  f.api.enable(); f.hide(); f.api.state();
  await f.advance(1000); f.v.currentTime += 5;
  assert.equal(f.api.state().progress.effectiveRate, 5);
  assert.equal(f.api.state().progress.observedHidden, true);
  await f.advance(1000);
  assert.equal(f.api.state().progress.status, 'no_progress');
  f.api.dispose();
});

test('only an enabled playing-to-hidden correlated pause can resume', async () => {
  const f = fixture();
  f.hide(); f.v.pause(); await f.advance(1000); assert.equal(f.stats.play, 0);
  f.v.paused = false; f.doc.hidden = false; f.api.enable(); f.hide(); f.v.pause();
  await f.advance(300);
  assert.equal(f.stats.play, 1); assert.equal(f.v.paused, false);
  f.api.dispose();
});

test('trusted user interaction, ambiguous hidden pause and waiting never force resume', async () => {
  for (const kind of ['user', 'late', 'waiting', 'visible']) {
    const f = fixture(); f.api.enable();
    if (kind !== 'visible') f.hide();
    if (kind === 'user') f.doc.emit('pointerdown', { isTrusted: true });
    if (kind === 'late') await f.advance(1100);
    if (kind === 'waiting') f.v.emit('waiting');
    f.v.pause(); await f.advance(10000);
    assert.equal(f.stats.play, 0, kind); f.api.dispose();
  }
});

test('resume rejection uses finite exponential retries; autoplay denial stops immediately', async () => {
  for (const name of ['AbortError', 'NotAllowedError']) {
    const f = fixture(); f.api.enable(); f.hide(); f.v.reject = { name }; f.v.pause();
    await f.advance(10000);
    assert.equal(f.stats.play, name === 'AbortError' ? 3 : 1);
    assert.equal(f.tasks.size, 0);
    assert.equal(f.api.state().reason, name === 'AbortError' ? 'resume_limit' : 'autoplay_denied');
    f.api.dispose();
  }
});

test('disable cancels scheduled resume, corrections and all subsequent automatic play', async () => {
  const f = fixture(); f.api.enable(); f.hide(); f.v.pause(); f.v.emit('ratechange'); f.api.disable();
  await f.advance(10000); f.v.emit('pause'); await f.advance(10000);
  assert.equal(f.stats.play, 0); assert.equal(f.stats.corrected, 0); assert.equal(f.tasks.size, 0);
  f.api.dispose();
});

test('ratechange correction coalesces synchronous reentry and stops after three failures', async () => {
  const f = fixture(); f.api.enable(); f.v.playbackRate = 1;
  for (let i = 0; i < 10; i++) f.v.emit('ratechange');
  await f.advance(1); assert.equal(f.stats.corrected, 1); assert.equal(f.v.playbackRate, 5);
  f.hooks.failRate = true;
  for (let i = 0; i < 5; i++) { f.v.emit('ratechange'); await f.advance(600); }
  assert.equal(f.stats.corrected, 4); assert.equal(f.stats.stopped, 1);
  assert.equal(f.api.state().reason, 'rate_failed'); f.api.dispose();
});

test('rebinding and dispose remove old media/document listeners and pending actions', async () => {
  const f = fixture(); f.api.enable(); f.hide(); f.v.pause();
  const next = f.makeVideo(); next.currentSrc = 'fixture:two'; f.select(next);
  assert.equal(f.v.count('pause'), 0); assert.equal(f.v.count('ended'), 0);
  assert.equal(f.doc.count('visibilitychange'), 1);
  await f.advance(1000); assert.equal(f.stats.play, 0);
  next.ended = true; next.emit('ended');
  next.emit('ended'); // Browsers/adapters can deliver a duplicate completion signal.
  assert.equal(f.stats.ended, 1); assert.equal(f.stats.stopped, 1);
  next.ended = false; next.emit('playing'); next.ended = true; next.emit('ended');
  assert.equal(f.stats.ended, 2); // A genuinely replayed video can complete in a new run.
  f.api.dispose(); assert.equal(f.doc.count('visibilitychange'), 0);
  assert.equal(next.count('ended'), 0); assert.equal(f.tasks.size, 0);
});

test('a late automatic play resolution after disable is paused instead of restarting playback', async () => {
  const f = fixture(); let finish;
  f.v.play = () => { f.stats.play++; return new Promise(resolve => { finish = () => { f.v.paused = false; f.v.emit('playing'); resolve(); }; }); };
  f.api.enable(); f.hide(); f.v.pause();
  // Run just the scheduled callback without awaiting its deliberately pending play promise.
  const task = [...f.tasks.values()][0]; f.tasks.clear(); const pending = task.fn();
  f.api.disable(); finish(); await pending;
  assert.equal(f.v.paused, true); assert.equal(f.stats.play, 1); assert.equal(f.api.state().enabled, false);
  await f.advance(10000); assert.equal(f.stats.play, 1); f.api.dispose();
});

test('late automatic play is cancelled after unbind and dispose, including the old video', async () => {
  for (const action of ['unbind', 'dispose']) {
    const f = fixture(); let finish;
    f.v.play = () => new Promise(resolve => { finish = () => { f.v.paused = false; resolve(); }; });
    f.api.enable(); f.hide(); f.v.pause();
    const task = [...f.tasks.values()][0]; f.tasks.clear(); const pending = task.fn();
    if (action === 'unbind') { f.api.disable(); f.api.bind(null); } else f.api.dispose();
    finish(); await pending;
    assert.equal(f.v.paused, true); f.api.dispose();
  }
});

test('source replacement or media errors suppress pending automatic play', async () => {
  for (const changed of ['source', 'error']) {
    const f = fixture(); f.api.enable(); f.hide(); f.v.pause();
    if (changed === 'source') f.v.currentSrc = 'fixture:next'; else f.v.error = { code: 3 };
    await f.advance(1000); assert.equal(f.stats.play, 0);
    assert.equal(f.api.state().progress.status, changed === 'source' ? 'replaced' : 'error');
    f.api.dispose();
  }
});

test('a seek between samples cannot fabricate observed playback progress', async () => {
  const f = fixture(); f.api.enable(); f.api.state(); await f.advance(1000);
  f.v.emit('seeking'); f.v.currentTime = 500; f.v.emit('seeked');
  assert.equal(f.api.state().progress.effectiveRate, null);
  await f.advance(1000); f.v.currentTime += 5;
  assert.equal(f.api.state().progress.effectiveRate, 5);
  f.api.dispose();
});
