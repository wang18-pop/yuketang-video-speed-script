import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { parseArgs, selectTarget, localEndpoint, connect, install, evaluate, run } from '../agent-5x.mjs';
import { fixture } from './fixture.mjs';
const source = await readFile(new URL('../ykt-5x.js', import.meta.url), 'utf8');
const target = { id: 'fixture', type: 'page', url: 'https://www.yuketang.cn/ai-workspace/lms-graph/CLASSROOM_ID/video/VIDEO_ID',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/fixture' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function generic() {
  const f = fixture(source);
  f.location.href = 'https://example.com/watch';
  return f;
}

test('generic videos preserve the original rate and pause; explicit selection rejects ambiguous and invalid targets', () => {
  const f = generic(), first = f.player.v, second = f.document.createElement('video');
  const query = f.document.querySelectorAll;
  f.document.querySelectorAll = sel => sel === 'video' ? [first, second] : query(sel);
  assert.equal(f.api.apply(5).ok, false);
  for (const target of [null, -1, 2, 1.5, '0', {}, Infinity]) assert.equal(f.api.apply(5, target).ok, false);
  assert.equal(first.playbackRate, 1.25);
  first.pause();
  assert.equal(f.api.videos().videos.length, 2);
  assert.equal(f.api.apply(5, 0).mode, 'html5');
  assert.equal(first.playbackRate, 5);
  assert.equal(second.playbackRate, undefined);
  assert.equal(f.api.apply(4, first).real, 4);
  assert.equal(f.api.restore().real, 1.25);
  assert.equal(first.paused, true);
  assert.equal(f.window.video5x, f.api);
  f.api.dispose();
  assert.equal(f.window.video5x, undefined);
});

test('generic discovery walks open shadow trees and same-origin frames, and reports inaccessible frames', () => {
  const f = generic(), v = f.player.v;
  const shadow = f.document.createElement('div');
  shadow.shadowRoot = { querySelectorAll: sel => sel === 'video' ? [v] : [] };
  const frame = f.document.createElement('iframe');
  frame.contentDocument = { querySelectorAll: sel => sel === 'video' ? [v] : [] };
  const blocked = f.document.createElement('iframe');
  Object.defineProperty(blocked, 'contentDocument', { get() { throw Error('SecurityError'); } });
  f.document.querySelectorAll = sel => sel === '*' ? [shadow, frame, blocked] : [];
  assert.equal(f.api.videos().videos.length, 1);
  assert.equal(f.api.videos().blockedFrames, 1);
  assert.equal(f.api.apply().real, 5);
  f.api.dispose();
});

test('generic empty/unready media and native rejection fail without losing restoration state', () => {
  const f = generic(), v = f.player.v;
  const query = f.document.querySelectorAll;
  f.document.querySelectorAll = () => [];
  assert.equal(f.api.apply().ok, false);
  assert.equal(f.api.videos().videos.length, 0);
  f.document.querySelectorAll = query;
  v.readyState = 0; assert.equal(f.api.apply().ok, false);
  v.readyState = 4; v.duration = Infinity;
  assert.equal(f.api.apply().ok, true); // No finite-duration gate on standard HTML5 media.
  assert.equal(f.api.restore().ok, true);
  const proto = Object.getPrototypeOf(v);
  const native = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
  Object.defineProperty(proto, 'playbackRate', { ...native, set(x) { if (x === 5) throw Error('rejected'); native.set.call(this, x); } });
  // Reinstall to capture the rejecting native descriptor.
  f.api.dispose(); vm.runInContext(source, f.sandbox);
  const rejected = f.api.apply();
  assert.equal(rejected.ok, false); assert.equal(rejected.rollback.ok, true); assert.equal(v.playbackRate, 1.25);
  f.api.dispose(); Object.defineProperty(proto, 'playbackRate', native);
});

test('keeper corrects site resets, stops on source/route replacement and stays stopped after restore/dispose', async () => {
  for (const mode of ['html5', 'yuketang']) {
    const f = mode === 'html5' ? generic() : fixture(source), v = f.player.v;
    try {
      assert.equal(f.api.apply().keeping, true);
      v.playbackRate = 1;
      if (mode === 'yuketang') f.player.p.options.speed.value = 1;
      await wait(650);
      assert.equal(v.playbackRate, 5);
      if (mode === 'yuketang') assert.equal(f.player.selected, 5);
      assert.equal(f.api.restore().ok, true);
      v.playbackRate = 2; await wait(550); assert.equal(v.playbackRate, 2);
      assert.equal(f.api.apply().ok, true);
      v.currentSrc = 'fixture:replacement'; v.playbackRate = 1.5;
      await wait(550);
      assert.equal(v.playbackRate, 1.5); assert.equal(f.api.state().keeping, false);
      assert.equal(f.api.state().stale, true); assert.equal(f.api.state().ok, false);
      assert.equal(f.api.restore().skippedReusedInstance, true);
      assert.equal(f.api.apply().ok, true);
      f.location.search = '?next'; v.playbackRate = 3;
      await wait(550); assert.equal(v.playbackRate, 3); assert.equal(f.api.state().keeping, false);
    } finally { f.api.dispose(); }
  }
});

test('generic restore failure is retryable; selected video changes restore only the old baseline', () => {
  const f = generic(), old = f.player.v;
  let reject = false;
  const proto = Object.getPrototypeOf(old), native = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
  f.api.dispose();
  Object.defineProperty(proto, 'playbackRate', { ...native, set(x) { if (reject && x === 1.25) throw Error('restore rejected'); native.set.call(this, x); } });
  vm.runInContext(source, f.sandbox);
  assert.equal(f.api.apply().ok, true);
  reject = true;
  assert.equal(f.api.restore().retryable, true);
  assert.equal(f.api.state().keeping, false);
  reject = false; assert.equal(f.api.restore().ok, true);
  assert.equal(f.api.apply().ok, true);
  const next = f.replace().v; next.playbackRate = 2;
  assert.equal(f.api.apply().real, 5);
  assert.equal(old.playbackRate, 1.25);
  assert.equal(f.api.restore().real, 2);
  f.api.dispose(); Object.defineProperty(proto, 'playbackRate', native);
});

test('a late Yuketang adapter restores the generic baseline before taking its own backup', () => {
  const f = fixture(source), p = f.player;
  p.p.video = null;
  assert.equal(f.api.apply().mode, 'html5');
  p.p.video = p.v;
  assert.equal(f.api.state().stale, true);
  assert.equal(f.api.state().ok, false);
  assert.equal(f.api.apply().mode, 'yuketang');
  assert.equal(f.api.restore().ok, true);
  assert.equal(p.v.playbackRate, 1.25); assert.equal(p.p.options.speed.value, 1.25);
  assert.equal(p.p.options.isDrag, false);
  assert.equal(f.api.dispose().ok, true); assert.equal(p.v.playbackRate, 1.25);
});

test('media errors or temporarily missing metadata do not erase the original backup', () => {
  for (const state of ['error', 'unready']) {
    const f = generic(), v = f.player.v;
    assert.equal(f.api.apply().ok, true);
    if (state === 'error') v.error = { code: 3 }; else v.readyState = 0;
    assert.equal(f.api.restore().restored, true);
    assert.equal(v.playbackRate, 1.25);
    f.api.dispose();
  }
});

test('a rejected keeper correction stops and rolls back instead of leaving an endless writer', async () => {
  const f = generic(), v = f.player.v, proto = Object.getPrototypeOf(v);
  const native = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
  let reject = false;
  f.api.dispose();
  Object.defineProperty(proto, 'playbackRate', { ...native, set(x) { if (reject && x === 5) throw Error('site rejects speed'); native.set.call(this, x); } });
  vm.runInContext(source, f.sandbox);
  try {
    assert.equal(f.api.apply().ok, true);
    reject = true; v.playbackRate = 2;
    await wait(650);
    assert.equal(v.playbackRate, 1.25);
    assert.equal(f.api.state().ok, false); assert.equal(f.api.state().keeping, false);
    assert.match(f.api.state().error, /rejected/);
    assert.equal(f.api.restore().ok, true);
  } finally { reject = false; f.api.dispose(); Object.defineProperty(proto, 'playbackRate', native); }
});

test('generic CLI enumerates videos before explicit multi-video selection and closes its connection', async () => {
  const f = generic(), first = f.player.v;
  const query = f.document.querySelectorAll;
  f.document.querySelectorAll = sel => sel === 'video' ? [first, first] : query(sel);
  let closed = 0;
  const deps = { fetch: async () => ({ ok: true, json: async () => [{ ...target, url: f.location.href }] }),
    connect: async () => ({ close() { closed++; }, send: async (method, p) => method !== 'Runtime.evaluate' ? {}
      : { result: { value: await vm.runInContext(p.expression, f.sandbox) } } }) };
  assert.equal((await run(parseArgs(['--videos']), deps)).result.videos.length, 1);
  const result = await run(parseArgs(['--apply', '--video=0']), deps);
  assert.equal(result.ok, true); assert.equal(result.result.real, 5);
  first.currentSrc = 'fixture:next'; first.playbackRate = 2;
  assert.equal((await run(parseArgs(['--apply']), deps)).ok, true);
  assert.equal((await run(parseArgs(['--restore']), deps)).ok, true);
  assert.equal(first.playbackRate, 2);
  assert.equal(closed, 4);
  for (const args of [['--apply', '--video=-1'], ['--apply', '--video=1.5'], ['--apply', '--video=NaN'], ['--apply', '--video= '], ['--apply', '--video='], ['--state', '--video=0']])
    assert.throws(() => parseArgs(args));
  f.api.dispose();
});

test('a setter that silently ignores isDrag cannot report successful apply', () => {
  const f = fixture(source);
  Object.defineProperty(f.player.p.options, 'isDrag', { get: () => false, set() {} });
  const result = f.api.apply(5);
  assert.equal(result.ok, false);
  assert.equal(result.rollback.ok, true);
  assert.equal(f.player.v.playbackRate, 1.25);
  assert.equal(f.player.p.options.speed.value, 1.25);
  f.api.dispose();
});

test('Vue accessors retain identity and restore closure-held values', () => {
  const f = fixture(source), p = f.player;
  const before = [];
  for (const [obj, key] of [[p.p.options, 'isDrag'], [p.p.options.speed, 'value']]) {
    let value = obj[key];
    Object.defineProperty(obj, key, { configurable: false, enumerable: true,
      get() { return value; }, set(next) { value = next; } });
    before.push([obj, key, Object.getOwnPropertyDescriptor(obj, key)]);
  }
  assert.equal(f.api.apply(5).real, 5);
  assert.equal(f.api.apply(4).sp, 4);
  assert.equal(f.api.restore().ok, true);
  assert.equal(p.p.options.isDrag, false);
  assert.equal(p.p.options.speed.value, 1.25);
  for (const [obj, key, d] of before) assert.deepEqual(Object.getOwnPropertyDescriptor(obj, key), d);
  f.api.dispose();
});

test('getter-only configuration is rejected without modifying media or menus', () => {
  const f = fixture(source), p = f.player;
  const menu = p.menu.children.map(el => el.innerHTML);
  Object.defineProperty(p.p.options, 'isDrag', { get: () => false });
  assert.equal(f.api.apply(5).ok, false);
  assert.equal(p.v.playbackRate, 1.25);
  assert.deepEqual(p.menu.children.map(el => el.innerHTML), menu);
  f.api.dispose();
});

test('strict arguments reject NaN, Infinity, empty, out of range, conflicting and unknown inputs', () => {
  for (const args of [['--apply=NaN'], ['--apply=Infinity'], ['--apply='], ['--apply=0'], ['--apply=17'],
    ['--measure=1'], ['--timeout=-1'], ['--timeout=1.1'], ['--timeout=Infinity'], ['--apply', '--measure=301'],
    ['--apply', '--measure=NaN'], ['--state', '--apply'], ['--unknown'], ['--cdp=https://example.com']])
    assert.throws(() => parseArgs(args), args.join(' '));
  assert.equal(parseArgs(['--apply']).factor, 5);
  for (const value of ['http://example.com', 'http://127.0.0.1.example.com', 'http://user@localhost', 'http://localhost/path'])
    assert.throws(() => localEndpoint(value));
});
test('generic HTTP(S) targets still reject credentials, internal pages, ambiguity and remote websockets', () => {
  assert.equal(selectTarget([target], {}).id, 'fixture');
  assert.equal(selectTarget([{ ...target, url: 'http://localhost:1234/video' }], {}).id, 'fixture');
  assert.equal(selectTarget([{ ...target, url: 'https://example.com/video' }], {}).id, 'fixture');
  for (const targets of [[], [{ ...target, type: 'iframe' }], [{ ...target, url: 'chrome://settings/' }], [{ ...target, url: 'file:///private.html' }],
    [{ ...target, url: 'https://user:pass@example.com/' }], [target, { ...target, id: 'second' }],
    [{ ...target, webSocketDebuggerUrl: 'ws://example.com/socket' }]]) assert.throws(() => selectTarget(targets, {}));
  assert.throws(() => selectTarget([target], { match: 'absent' }));
  assert.throws(() => selectTarget([target], { url: `${target.url}?other=1` }));
});
test('installation executes source and rejects string results, exceptions and stale API', async () => {
  const f = fixture(source);
  const cdp = { send: async (_, p) => ({ result: { value: vm.runInContext(p.expression, f.sandbox) } }) };
  await install(cdp, source);
  await assert.rejects(install(cdp, JSON.stringify(source)), /installation failed/);
  await assert.rejects(evaluate({ send: async () => ({ exceptionDetails: {} }) }, 'x'), /evaluation failed/);
  assert.equal(f.document.body.children.length, 1);
  f.api.dispose();
});
test('apply is repeatable; jQuery cache and native getter agree; restore recovers descriptors/menu/internal selection', () => {
  const f = fixture(source), p = f.player, before = p.menu.children.map(x => [x.innerHTML, [...x.attrs]]);
  const drag = Object.getOwnPropertyDescriptor(p.p.options, 'isDrag');
  f.jq(p.menu.children[0]).data('speed', 2); // Preexisting stale cache must be restored.
  assert.equal(f.api.apply(5).ok, true);
  const clicks = p.clicks;
  assert.equal(f.api.apply(5).ok, true); assert.equal(p.clicks, clicks);
  assert.equal(f.api.apply(4).real, 4); assert.equal(p.selected, 4);
  assert.equal(f.api.restore().ok, true);
  assert.equal(p.v.playbackRate, 1.25); assert.equal(p.p.options.speed.value, 1.25); assert.equal(p.selected, 1.25);
  assert.deepEqual(Object.getOwnPropertyDescriptor(p.p.options, 'isDrag'), drag);
  assert.deepEqual(p.menu.children.map(x => [x.innerHTML, [...x.attrs]]), before);
  assert.equal(f.jq(p.menu.children[0]).data('speed'), 2);
  assert.equal(Object.hasOwn(p.v, 'playbackRate'), false);
  assert.equal(f.api.restore().ok, true); f.api.dispose();
});
test('invalid input and unsupported players do not mutate; failed apply is not reported as success', () => {
  const f = fixture(source);
  for (const n of [NaN, Infinity, 0, 17, '5']) assert.equal(f.api.apply(n).ok, false);
  f.player.broken = true;
  assert.equal(f.api.apply(5).ok, false);
  f.player.broken = false; assert.equal(f.api.restore().ok, true);
  f.player.p.video = null;
  assert.equal(f.api.apply().mode, 'html5'); // A standard video remains usable without the platform's private player.
  f.api.dispose();
});
test('replacement restores the old instance and preserves the new baseline, including source reuse', () => {
  const f = fixture(source), old = f.player;
  f.api.apply(5); const next = f.replace(); next.v.playbackRate = 1.5; next.p.options.speed.value = 1.5;
  assert.equal(f.api.state().stale, true);
  assert.equal(f.api.apply(4).ok, true); assert.equal(old.v.playbackRate, 1.25);
  assert.equal(f.api.restore().ok, true); assert.equal(next.v.playbackRate, 1.5);
  f.api.apply(5); next.v.currentSrc = 'fixture:two'; next.v.playbackRate = 2; next.p.options.speed.value = 2;
  assert.equal(f.api.restore().skippedReusedInstance, true); assert.equal(next.v.playbackRate, 2);
  f.api.dispose();
});
test('manual pause stays paused; no play calls or descriptor wrappers', () => {
  const f = fixture(source), v = f.player.v;
  const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(v), 'playbackRate');
  const external = { configurable: true, enumerable: false, get() { return 9; }, set(x) { native.set.call(this, x); } };
  Object.defineProperty(v, 'playbackRate', external);
  assert.equal(f.api.apply(5).real, 5); // Must read prototype getter, not the external getter.
  v.pause(); assert.equal(f.api.restore().ok, true); assert.equal(v.paused, true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(v, 'playbackRate'), external); f.api.dispose();
});
test('menu rebuild and player rebuild on the same video do not reuse an old baseline', () => {
  const f = fixture(source), p = f.player;
  assert.equal(f.api.apply(5).ok, true);
  p.rebuildMenu();
  assert.equal(f.api.state().stale, true);
  assert.equal(f.api.apply(4).ok, true); assert.equal(p.selected, 4);
  assert.equal(f.api.restore().ok, true); assert.equal(p.selected, 1.25);
  f.api.apply(5);
  const next = { video: p.v, options: { isDrag: false, speed: { value: 2 } } };
  p.root.__vue__.$data.player = next; p.v.playbackRate = 2;
  assert.equal(f.api.restore().skippedReusedInstance, true);
  assert.equal(p.v.playbackRate, 2); assert.equal(next.options.speed.value, 2);
  f.api.dispose();
});
test('restore failure remains visible and retryable, including external frozen configuration', () => {
  const f = fixture(source);
  f.api.apply(5); f.player.broken = true;
  const r = f.api.restore(); assert.equal(r.ok, false); assert.equal(r.retryable, true);
  f.player.broken = false; assert.equal(f.api.restore().ok, true);
  Object.defineProperty(f.player.p.options, 'isDrag', { value: false, writable: false });
  assert.equal(f.api.apply(5).ok, false); assert.equal(f.player.v.playbackRate, 1.25);
  f.api.dispose();
});
test('SPA route reuse never applies old backups to the current video/configuration', () => {
  const f = fixture(source), p = f.player;
  f.api.apply(5);
  f.location.pathname = '/ai-workspace/lms-graph/CLASSROOM_ID/video/OTHER_VIDEO_ID';
  p.v.playbackRate = 2; p.p.options.speed.value = 2; p.p.options.isDrag = false;
  const menu = p.menu.children.map(x => x.innerHTML);
  const result = f.api.restore();
  assert.equal(result.skippedReusedInstance, true); assert.equal(result.restored, false);
  assert.equal(p.v.playbackRate, 2); assert.equal(p.p.options.speed.value, 2);
  assert.deepEqual(p.menu.children.map(x => x.innerHTML), menu); f.api.dispose();
});
test('measurement counts trailing waiting, pause and seek; excludes seek-contaminated rates', async () => {
  const f = fixture(source), v = f.player.v;
  v.readyState = 2;
  const waiting = await f.api.measure(40);
  assert.ok(waiting.waitSec >= .03); assert.equal(waiting.netRate, null);
  v.readyState = 4;
  const m = f.api.measure(50);
  v.pause(); await wait(15); v.currentTime = 50;
  const result = await m;
  assert.equal(result.seek, true); assert.equal(result.overallRate, null); assert.ok(result.pauseSec > 0);
  assert.equal((await f.api.measure(NaN)).ok, false); f.api.dispose();
});
test('uninterrupted simulated 5x reports actual media advance and removes all sampling listeners', async () => {
  const f = fixture(source), v = f.player.v;
  const start = performance.now();
  Object.defineProperty(v, 'currentTime', { configurable: true, get: () => (performance.now() - start) / 1000 * 5 });
  const result = await f.api.measure(40);
  assert.equal(result.ok, true); assert.ok(Math.abs(result.overallRate - 5) < .05);
  assert.ok(Math.abs(result.netRate - 5) < .05);
  for (const event of ['waiting', 'playing', 'pause', 'seeking', 'seeked', 'ended', 'emptied'])
    assert.equal(getEventListeners(v, event).length, 0);
  assert.equal(getEventListeners(f.window, 'pagehide').length, 0); f.api.dispose();
});
test('measurement cancellation, navigation, ending, replacement and concurrent request terminate', async () => {
  for (const reason of ['cancelled', 'navigation', 'ended', 'replaced', 'restore']) {
    const f = fixture(source); const m = f.api.measure(200);
    assert.equal((await f.api.measure(20)).ok, false);
    if (reason === 'cancelled') f.api.cancelMeasure();
    if (reason === 'navigation') f.window.dispatchEvent(new Event('pagehide'));
    if (reason === 'ended') { f.player.v.ended = true; f.player.v.dispatchEvent(new Event('ended')); }
    if (reason === 'replaced') f.replace();
    if (reason === 'restore') f.api.restore();
    assert.equal((await m).reason, reason);
    assert.equal((await f.api.measure(10)).ok, true); // Previous lock/listeners cleared.
    f.api.dispose();
  }
});
class Socket extends EventTarget {
  static instances = [];
  constructor() { super(); this.closed = false; Socket.instances.push(this); }
  send() {}
  close() { this.closed = true; }
  message(data) { const event = new Event('message'); event.data = JSON.stringify(data); this.dispatchEvent(event); }
}
test('CDP open timeout, error, close, request timeout, send failure and navigation reject promptly', async () => {
  await assert.rejects(connect(target.webSocketDebuggerUrl, 10, Socket), /connection timeout/);
  for (const action of ['error', 'close', 'navigation', 'timeout', 'send']) {
    const connected = connect(target.webSocketDebuggerUrl, 30, Socket), socket = Socket.instances.at(-1);
    socket.dispatchEvent(new Event('open')); const cdp = await connected;
    if (action === 'send') socket.send = () => { throw Error('fixture'); };
    const p = cdp.send('Runtime.evaluate');
    if (action === 'error' || action === 'close') socket.dispatchEvent(new Event(action));
    if (action === 'navigation') socket.message({ method: 'Runtime.executionContextsCleared' });
    await assert.rejects(p); assert.equal(socket.closed, true);
    await assert.rejects(cdp.send('Runtime.evaluate'), /closed/); cdp.close();
  }
});
test('CDP response and protocol error resolve/reject respective requests', async () => {
  const pending = connect(target.webSocketDebuggerUrl, 30, Socket), socket = Socket.instances.at(-1);
  socket.dispatchEvent(new Event('open')); const c = await pending;
  const p = c.send('test'); socket.message({ id: 1, result: { value: 5 } }); assert.equal((await p).value, 5);
  const q = c.send('test'); socket.message({ id: 2, error: { message: 'fixture' } }); await assert.rejects(q);
  c.close();
});
test('driver closes connection on installation error and top-level ok follows failed apply', async () => {
  for (const broken of [false, true]) {
    const f = fixture(source); f.player.broken = true; let closed = false;
    const deps = { fetch: async () => ({ ok: true, json: async () => [target] }),
      connect: async () => ({ close() { closed = true; }, send: async (method, p) => method !== 'Runtime.evaluate' ? {}
        : broken ? { exceptionDetails: {} } : { result: { value: vm.runInContext(p.expression, f.sandbox) } } }) };
    if (broken) await assert.rejects(run(parseArgs(['--apply']), deps));
    else assert.equal((await run(parseArgs(['--apply']), deps)).ok, false);
    assert.equal(closed, true);
  }
});
test('CLI invalid arguments exit nonzero without connecting', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../agent-5x.mjs', import.meta.url)), '--apply=NaN'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).ok, false);
});
test('native WebSocket rejects in-flight request when local mock CDP disconnects', async () => {
  const server = createServer();
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.once('data', () => socket.destroy());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let cdp;
  try {
    cdp = await connect(`ws://127.0.0.1:${server.address().port}/mock`, 1000);
    await assert.rejects(cdp.send('Runtime.evaluate'), /disconnected|connection failed/);
  } finally {
    cdp?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
test('actual loopback discovery timeout aborts and malformed discovery fails', async () => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(run(parseArgs([`--cdp=http://127.0.0.1:${server.address().port}`, '--timeout=100'])), { name: 'TimeoutError' });
    await assert.rejects(run(parseArgs([]), { fetch: async () => ({ ok: true, json: async () => null }) }), /Invalid target list/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});


