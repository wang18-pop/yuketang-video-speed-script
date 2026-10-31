import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const main = await readFile(new URL('../ykt-5x.js', import.meta.url), 'utf8');
const helper = main.includes('// video5x-catalogue:start')
  ? main.split('// video5x-catalogue:start')[1].split('// video5x-catalogue:end')[0]
  : await readFile(new URL('../catalogue-helper.txt', import.meta.url), 'utf8');
function node(attrs = {}, selectors = {}, content = '') {
  const classes = (attrs.class || '').split(/\s+/);
  return { isConnected: true, textContent: content, value: attrs.value, clicks: 0,
    getAttribute: key => Object.hasOwn(attrs, key) ? attrs[key] : null,
    querySelector: key => selectors[key] || null,
    classList: { contains: key => classes.includes(key) },
    click() { this.clicks++; } };
}
function setup(host, selector, rows, course = 'course-A') {
  const location = new URL('https://' + host + '/watch?courseId=12');
  let elements = rows;
  const document = { querySelector: sel => sel === '[data-course-id]' ? node({ 'data-course-id': course }) : null,
    querySelectorAll: sel => sel === selector ? elements : [] };
  const api = vm.runInNewContext(helper + '\ncreateCatalogue()', { document, location, URL });
  return { api, location, replace(next) { elements = next; } };
}

test('completion classifier does not confuse negatives, 99%, empty or invalid percentages with completion', () => {
  const { api } = setup('example.com', '[data-video5x-resource]', []);
  for (const value of ['未完成', '进行中', '观看 99%', '98%', '99.99%']) assert.equal(api.classify(value), 'in_progress', value);
  for (const value of ['已完成', '已学习', '观看 100%']) assert.equal(api.classify(value), 'completed', value);
  for (const value of ['', '视频', '已完成度未知', '110%', '1100%', '-100%', '+100%']) assert.equal(api.classify(value), 'unknown', value);
  assert.equal(api.classify({ progress: 100 }), 'completed');
  assert.equal(api.classify({ progress: '' }), 'unknown');
  assert.equal(api.classify({ progress: null }), 'unknown');
  assert.equal(api.classify({ progress: Infinity }), 'unknown');
  assert.equal(api.classify({ status: 'not_started', progress: 100 }), 'not_started');
  assert.equal(api.classify(null), 'unknown');
});

test('new Yuketang directory uses explicit identity, current leaf and exact completion metadata', () => {
  const active = node({ 'data-id': 'alpha', 'data-type': 'video', 'data-progress': '100' }, { '.leaf-item.is-active': node() });
  const next = node({ 'data-id': 'zeta', 'data-type': 'video', 'data-status': '未完成' });
  const homework = node({ 'data-id': 'work', 'data-type': 'exam' });
  const { api, location } = setup('www.yuketang.cn', '.nav-item-leaf-box', [active, next, homework]);
  location.href = 'https://www.yuketang.cn/ai-workspace/lms-graph/12/video/alpha';
  const result = api.scan();
  assert.equal(result.ok, true); assert.equal(result.platform, 'yuketang');
  assert.equal(result.items[0].active, true); assert.equal(result.items[0].status, 'completed');
  assert.equal(result.items[1].id, 'zeta'); assert.equal(result.items[1].status, 'in_progress');
  assert.equal(result.items[2].kind, 'other');
  assert.equal(active.clicks, 0); assert.equal(next.clicks, 0);
});

test('old Yuketang and mobile paths retain video icon and progress-label checks', () => {
  const first = node({ id: 'leafA', 'aria-current': 'page' }, { '.icon--shipin': node(), '.progress-time .progress-wrap .item': node({}, {}, '已完成') });
  const second = node({ id: 'leafB' }, { '.icon--shipin': node(), '.progress-time .progress-wrap .item': node({}, {}, '99%') });
  const { api, location } = setup('www.yuketang.cn', '.leaf-detail', [first, second]);
  location.href = 'https://www.yuketang.cn/ai-workspace/lms-graph-mobile/12/video/leafA';
  assert.equal(api.scan().items[0].kind, 'video'); assert.equal(api.scan().items[0].status, 'completed');
  assert.equal(api.scan().items[1].status, 'in_progress');
});

test('five platform fixtures recognize only verified selectors and explicit resource metadata', () => {
  const cases = [
    ['www.yuketang.cn', '.nav-item-leaf-box', 'yuketang', { '.icon--shipin': node() }, { class: 'is-active' }],
    ['mooc2-ans.chaoxing.com', '.posCatalog_select', 'chaoxing', {}, { class: 'posCatalog_active', 'data-type': 'video' }],
    ['studyvideoh5.zhihuishu.com', '.clearfix.video', 'zhihuishu', { '.time_icofinish': node() }, { class: 'current_play' }],
    ['mooc.icve.com.cn', '.s_point[itemtype]', 'icve', { '.done_icon_show': node() }, { class: 's_pointerct', itemtype: 'video' }],
    ['www.mosoteach.cn', '.hide-div > [data-value]', 'mosoteach', {}, { 'data-value': 'resource-A', 'data-type': 'video', 'data-progress': '100' }],
  ];
  for (const [host, selector, platform, children, attrs] of cases) {
    const row = node({ id: 'A', 'data-status': 'completed', ...attrs }, children);
    const result = setup(host, selector, [row]).api.scan();
    assert.equal(result.ok, true, platform); assert.equal(result.platform, platform);
    assert.equal(result.items[0].kind, 'video', platform); assert.equal(result.items[0].status, 'completed', platform);
  }
});

test('icon absence is unknown and learning-platform chapter counts do not imply a video resource', () => {
  const tree = setup('studyvideoh5.zhihuishu.com', '.clearfix.video', [node({ id: 'A' })]).api.scan();
  assert.equal(tree.items[0].status, 'unknown');
  const cx = setup('mooc2-ans.chaoxing.com', '.posCatalog_select', [node({ id: 'cur1' }, { '.jobUnfinishCount': node({ value: '0' }) })]).api.scan();
  assert.equal(cx.items[0].status, 'completed'); assert.equal(cx.items[0].kind, 'unknown');
  const cloud = setup('www.mosoteach.cn', '.hide-div > [data-value]', [node({ 'data-value': 'A', 'data-is-drag': 'N' })]).api.scan();
  assert.equal(cloud.items[0].status, 'unknown'); assert.equal(cloud.items[0].kind, 'unknown');
});

test('scanner re-reads DOM, rejects duplicates/missing identity and never generates sequential IDs', () => {
  const f = setup('www.yuketang.cn', '.nav-item-leaf-box', [node({ id: 'one', 'data-type': 'video' })]);
  const original = f.api.scan().items[0].element;
  f.replace([node({ id: 'two', 'data-type': 'video' })]);
  assert.equal(f.api.scan().items[0].id, 'two'); assert.notEqual(f.api.scan().items[0].element, original);
  f.replace([node({ id: 'dup' }), node({ id: 'dup' })]); assert.equal(f.api.scan().ok, false);
  f.replace([node()]); assert.equal(f.api.scan().ok, false);
  f.replace([node({ 'data-href': 'javascript:alert(1)' })]); assert.equal(f.api.scan().ok, false);
  f.replace([node({ 'data-href': '#' })]); assert.equal(f.api.scan().ok, false);
});

test('explicit Agent adapter validates schema, catches failures and can be removed', () => {
  const f = setup('example.com', '[data-video5x-resource]', []);
  assert.equal(f.api.register({}).ok, false);
  assert.equal(f.api.register(() => ({ platform: 'custom', courseKey: 'course-42', items: [{ id: 'vA', title: 'Video', kind: 'video', status: 'not_started', active: true, element: node() }] })).ok, true);
  assert.equal(f.api.scan().ok, true);
  f.api.register(() => { throw Error('failed'); }); assert.equal(f.api.scan().ok, false);
  f.api.register(() => ({ platform: 'custom', items: [] })); assert.equal(f.api.scan().ok, false);
  f.api.register(null); assert.equal(f.api.scan().ok, false);
});
