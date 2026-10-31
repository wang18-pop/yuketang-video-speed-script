import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../ykt-5x.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('  function createAutonext('), source.indexOf('  // AUTONEXT_END'));
function fixture() {
  let clock = 0, active = 'one', video, clicks = 0, scans = 0;
  const stats = { applied: [], plays: 0 };
  const old = { readyState: 4, paused: false, ended: false, currentSrc: 'media:one' };
  const next = { readyState: 4, paused: true, ended: false, currentSrc: 'media:two',
    async play() { stats.plays++; if (f.deny) throw Error('autoplay denied'); this.paused = false; },
    pause() { this.paused = true; } };
  video = old;
  const rows = [
    { id: 'one', kind: 'video', status: 'completed' },
    { id: 'done', kind: 'video', status: 'completed' },
    { id: 'exam', kind: 'other', status: 'unknown' },
    { id: 'two', kind: 'video', status: 'not_started' },
  ];
  const f = { stats, rows, old, next, course: 'course:one', failNav: false, deny: false,
    get clicks() { return clicks; }, get scans() { return scans; },
    scan() { scans++; return { ok: true, platform: 'fixture', courseKey: f.course, items: rows.map(row => ({ ...row, active: row.id === active,
      element: { isConnected: true, click() { clicks++; if (!f.failNav) { active = row.id; video = next; } f.onClick?.(); } } })) }; },
  };
  const make = vm.runInNewContext(helper + ';createAutonext', { Date: { now: () => clock },
    setTimeout(fn, ms) { return setTimeout(() => { clock += ms; fn(); }, 0); }, clearTimeout });
  f.api = make({ scan: () => f.scan(), getVideo: () => video, factor: () => 5,
    identity: v => ({ v, src: v.currentSrc, doc: 'same' }),
    apply(factor, v) { stats.applied.push([factor, v.currentSrc]); return f.applyFail ? { ok: false } : { ok: true }; },
    beforeNavigate() { f.before?.(); },
  });
  f.end = () => { old.ended = true; return f.api.onEnded(); };
  return f;
}
test('autonext defaults off; requires explicit enable and natural ended, skips completed and nonvideo tasks', async () => {
  const f = fixture();
  await f.end(); assert.equal(f.clicks, 0);
  f.old.ended = false; assert.equal(f.api.enable().enabled, true);
  await f.api.onEnded(); assert.equal(f.clicks, 0);
  await f.end();
  assert.equal(f.clicks, 1); assert.equal(f.stats.plays, 1);
  assert.deepEqual(f.stats.applied, [[5, 'media:one'], [5, 'media:two']]);
  assert.equal(f.api.state().currentId, 'two'); assert.equal(f.api.state().phase, 'watching');
  assert.ok(f.scans > 3); f.api.disable();
});
test('completion waits for platform metadata, never treats media ended as completed', async () => {
  const f = fixture(); f.rows[0].status = 'in_progress'; f.api.enable();
  const original = f.scan; f.scan = () => { if (f.scans >= 4) f.rows[0].status = 'completed'; return original(); };
  await f.end(); assert.equal(f.clicks, 1); f.api.disable();
  const missing = fixture(); missing.rows[0].status = 'unknown'; missing.api.enable();
  await missing.end(); assert.equal(missing.clicks, 0); assert.match(missing.api.state().reason, /超时/);
});
test('unknown next status or kind stops safely rather than interpreting next position as unwatched', async () => {
  for (const property of ['status', 'kind']) {
    const f = fixture(); f.rows[3][property] = 'unknown'; f.api.enable(); await f.end();
    assert.equal(f.clicks, 0); assert.equal(f.api.state().enabled, false); assert.match(f.api.state().reason, /未知/);
  }
});
test('failed navigation clicks once and stops within its deadline; duplicate ended never starts competing runs', async () => {
  const f = fixture(); f.failNav = true; f.api.enable();
  const pending = f.end(); await f.api.onEnded(); await pending;
  assert.equal(f.clicks, 1); assert.equal(f.api.state().enabled, false); assert.match(f.api.state().reason, /超时/);
});
test('stop cancels completion wait and navigation wait, without future clicks or playback', async () => {
  const a = fixture(); a.rows[0].status = 'in_progress'; a.api.enable();
  const pending = a.end(); a.api.disable(); await pending; assert.equal(a.clicks, 0);
  const b = fixture(); b.api.enable(); b.onClick = () => b.api.disable();
  await b.end(); assert.equal(b.clicks, 1); assert.equal(b.stats.plays, 0);
  const c = fixture(); c.api.enable(); c.before = () => c.api.disable();
  await c.end(); assert.equal(c.clicks, 0);
});

test('a never-settling play promise has a deadline and cancellation settles an in-flight start', async () => {
  const f = fixture(); f.next.play = () => new Promise(() => {}); f.api.enable();
  await f.end(); assert.match(f.api.state().reason, /启动超时/); assert.equal(f.api.state().running, false);
  const late = fixture(); late.api.enable();
  late.next.play = () => new Promise(resolve => { late.api.disable(); setTimeout(() => { late.next.paused = false; resolve(); }, 0); });
  await late.end(); await new Promise(r => setTimeout(r, 10));
  assert.equal(late.next.paused, true); assert.equal(late.api.state().enabled, false);
});
test('changed course, duplicate resource IDs, play rejection and failed speed application are surfaced', async () => {
  const f = fixture(); f.api.enable(); f.course = 'other'; await f.end(); assert.equal(f.clicks, 0);
  const duplicate = fixture(); duplicate.rows[3].id = 'one'; assert.equal(duplicate.api.enable().enabled, false);
  const denied = fixture(); denied.api.enable(); denied.deny = true; await denied.end(); assert.match(denied.api.state().reason, /denied/);
  const failed = fixture(); failed.applyFail = true; assert.equal(failed.api.enable().enabled, false);
});
test('a directory rebuilt during navigation is scanned again and no repeated resource is opened', async () => {
  const f = fixture(); f.api.enable(); let reloads = 0;
  f.onClick = () => { const prior = f.scan; f.scan = () => ++reloads < 3 ? { ok: false, items: [] } : prior(); };
  await f.end(); assert.equal(f.stats.plays, 1);
  f.next.ended = true; f.rows.push({ id: 'one', kind: 'video', status: 'not_started' });
  await f.api.onEnded(); assert.equal(f.clicks, 1); assert.match(f.api.state().reason, /重复/);
});
