import vm from 'node:vm';

class Element extends EventTarget {
  constructor(tag) {
    super(); this.tag = tag; this.children = []; this.attrs = new Map(); this.isConnected = true;
    this.style = {}; this.content = '';
    this.classList = {
      contains: name => (this.getAttribute('class') || '').split(' ').includes(name),
      remove: name => this.setAttribute('class', (this.getAttribute('class') || '').split(' ').filter(x => x !== name).join(' ')),
      add: name => this.setAttribute('class', `${this.getAttribute('class') || ''} ${name}`.trim()),
    };
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
  get textContent() { return this.content; }
  set textContent(v) { this.content = v; }
  get innerHTML() { return this.content; }
  set innerHTML(v) { this.content = v; }
  appendChild(el) { this.children.push(el); return el; }
  remove() { this.isConnected = false; }
  querySelectorAll(selector) {
    const tag = selector.startsWith('li') ? 'li' : selector;
    return this.children.flatMap(el => [...(el.tag === tag ? [el] : []), ...el.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
class Video extends Element {
  constructor() {
    super('video'); this.r = 1.25; this.t = 0; this.duration = 1000; this.readyState = 4;
    this.paused = false; this.ended = false; this.seeking = false; this.currentSrc = 'fixture:one';
  }
  get playbackRate() { return this.r; }
  set playbackRate(v) { this.r = v; this.dispatchEvent(new Event('ratechange')); }
  get currentTime() { return this.t; }
  set currentTime(v) { this.t = v; this.dispatchEvent(new Event('seeking')); this.dispatchEvent(new Event('seeked')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
}
export function fixture(source) {
  const cache = new WeakMap();
  const jq = el => ({
    data(k, v) { if (arguments.length === 2) { jq.data(el, k, v); return this; }
      return jq.data(el, k) ?? Number(el.getAttribute(`data-${k}`)); },
    removeData(k) { delete (cache.get(el) || {})[k]; },
  });
  jq.data = function(el, k, v) {
    if (!cache.has(el)) cache.set(el, {});
    if (arguments.length === 3) cache.get(el)[k] = v;
    return cache.get(el)[k];
  };
  let host;
  const makePlayer = () => {
    const root = new Element('.xtplayer'), v = new Video(), menu = new Element('xt-speedbutton');
    const label = new Element('xt-speedvalue'); label.textContent = '1.25X';
    const p = { video: v, options: { isDrag: false, speed: { value: 1.25, speedValue: [2, 1.5, 1.25, 1] } } };
    let selected = 1.25;
    let clicks = 0, broken = false;
    for (const value of [2, 1.5, 1.25, 1]) {
      const li = new Element('li'); li.setAttribute('data-speed', value); li.innerHTML = `${value}X`;
      if (value === 1.25) li.classList.add('xt_video_player_common_active');
      li.addEventListener('click', () => {
        clicks++;
        if (broken || li.classList.contains('xt_video_player_common_active')) return;
        selected = jq(li).data('speed'); p.options.speed.value = selected; v.playbackRate = selected;
        label.textContent = `${Number(selected).toFixed(2)}X`;
        for (const x of menu.children) x.classList.remove('xt_video_player_common_active');
        li.classList.add('xt_video_player_common_active');
      });
      menu.appendChild(li);
    }
    root.__vue__ = { $data: { player: p } };
    root.appendChild(v); root.appendChild(menu); root.appendChild(label);
    return { root, v, p, menu, label, get selected() { return selected; }, get clicks() { return clicks; },
      rebuildMenu() {
        const old = [...menu.children];
        for (const el of old) el.isConnected = false;
        // New DOM nodes and handlers, while video/player identity stays the same.
        menu.children = old.map(el => {
          const li = new Element('li');
          li.setAttribute('data-speed', el.getAttribute('data-speed'));
          li.innerHTML = el.innerHTML;
          li.addEventListener('click', () => {
            selected = jq(li).data('speed'); p.options.speed.value = selected; v.playbackRate = selected;
            label.textContent = `${Number(selected).toFixed(2)}X`;
            for (const x of menu.children) x.classList.remove('xt_video_player_common_active');
            li.classList.add('xt_video_player_common_active');
          });
          return li;
        });
      },
      set broken(x) { broken = x; } };
  };
  let player = makePlayer(); host = player.root;
  const window = new EventTarget(); window.jQuery = jq;
  const document = {
    body: new Element('body'), createElement: tag => new Element(tag),
    querySelectorAll: sel => sel === '.xtplayer' ? (host ? [host] : []) : [],
  };
  const location = new URL('https://www.yuketang.cn/ai-workspace/lms-graph/CLASSROOM_ID/video/VIDEO_ID');
  const sandbox = vm.createContext({ window, document, location, HTMLMediaElement: Video, MouseEvent: Event,
    performance, setTimeout, clearTimeout, setInterval, clearInterval, console });
  const installed = vm.runInContext(source, sandbox);
  return { window, document, location, sandbox, installed, jq, get api() { return window.ykt5x; },
    get player() { return player; }, hide() { host = null; },
    replace() { player.root.isConnected = false; player.v.isConnected = false;
      player = makePlayer(); host = player.root; return player; } };
}
