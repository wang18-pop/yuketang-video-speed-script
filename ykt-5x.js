// ==UserScript==
// @name         网页视频五倍速脚本
// @version      4.0.0
// @description  AI 选择网页视频，保持五倍速并支持恢复原倍速
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  const VERSION = '4.0.0';
  const validPage = () => ['http:', 'https:'].includes(location.protocol)
    && !location.username && !location.password;
  if (!validPage()) return { ok: false, error: 'Unsupported page' };
  const existing = window.video5x || window.ykt5x;
  if (existing) return existing.version === VERSION && (!window.video5x || !window.ykt5x || window.video5x === window.ykt5x)
    ? { ok: true, version: VERSION } : { ok: false, error: 'Existing controller conflict' };
  const rate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  let saved = null, measuring = null;
  let selected = null;
  const activeClass = 'xt_video_player_common_active';
  const number = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  const fail = error => ({ ok: false, error });

  function discover() {
    const videos = [], seen = new Set();
    let blockedFrames = 0;
    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      for (const v of root.querySelectorAll('video')) if (!videos.includes(v)) videos.push(v);
      // ponytail: open DOM trees only; a site's agent must inject inside inaccessible frames/closed roots.
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot);
        if (el.tagName === 'IFRAME') {
          try { const doc = el.contentDocument; if (doc) walk(doc); else blockedFrames++; }
          catch { blockedFrames++; }
        }
      }
    }
    walk(document);
    return { videos, blockedFrames };
  }
  function choose(target) {
    const list = discover().videos.filter(v => v.isConnected);
    if (target !== undefined) return Number.isInteger(target) ? list[target] || null : list.includes(target) ? target : null;
    return list.includes(selected) ? selected : list.length === 1 ? list[0] : null;
  }
  function snapshot(v, detached = false) {
    if (!v || (!detached && (!v.isConnected || v.error || v.readyState < 1))) return null;
    try {
      const doc = v.ownerDocument || document;
      for (let w = doc.defaultView; w?.frameElement; w = w.frameElement.ownerDocument.defaultView)
        if (!detached && !w.frameElement.isConnected) return null;
      return { v, doc, src: v.currentSrc, stream: v.srcObject, url: location.href,
        frameURL: doc.defaultView?.location.href || location.href };
    } catch { return null; }
  }
  const sameVideo = (a, b) => !!a && !!b && ['v', 'doc', 'src', 'stream', 'url', 'frameURL'].every(k => a[k] === b[k]);

  function installUniversal(legacy, panel) {
    let backup = null, binding = null, timer = null, keeperError = null;
    const stop = () => { clearInterval(timer); timer = null; };
    function restoreAll() {
      stop(); measuring?.abort('restore');
      let result;
      if (!backup) result = legacy.restore();
      else if (!sameVideo(backup, snapshot(backup.v, true))) {
        backup = null;
        result = { ok: true, restored: false, skippedReusedInstance: true };
      } else {
        try {
          rate.set.call(backup.v, backup.original);
          if (rate.get.call(backup.v) !== backup.original) throw Error('Native rate mismatch');
          result = { ok: true, restored: true, real: backup.original };
          backup = null;
        } catch { result = { ok: false, restored: false, retryable: true, error: 'Speed restore failed' }; }
      }
      if (result.ok) { binding = null; keeperError = null; }
      return result;
    }
    function write(c, mode, factor) {
      if (mode === 'yuketang') return legacy.apply(factor);
      try {
        if (!backup) {
          const original = rate.get.call(c.v);
          if (!number(original, 0, 16)) return fail('Invalid original speed');
          backup = { ...c, original };
        }
        rate.set.call(c.v, factor);
        if (rate.get.call(c.v) !== factor) throw Error('Native rate mismatch');
        return { ok: true };
      } catch { return { ok: false, error: 'Browser/player rejected this speed', rollback: restoreAll() }; }
    }
    function stateAll() {
      const c = snapshot(selected || choose());
      const mode = c && context()?.v === c.v ? 'yuketang' : 'html5';
      const stale = !!binding && (binding.mode !== mode || !sameVideo(binding.c, c)
        || (binding.mode === 'yuketang' && !same(saved, context())));
      if (!c) return { ok: false, attached: false, stale, keeping: timer !== null,
        error: keeperError || 'No selected ready video; use videos() then apply(5, index)' };
      try {
        const info = mode === 'yuketang' ? legacy.state() : { ok: true, real: rate.get.call(c.v), paused: c.v.paused, ready: c.v.readyState };
        return { ...info, ok: info.ok && !stale && !keeperError && (!binding || rate.get.call(c.v) === binding.factor),
          attached: true, mode, target: !stale && binding ? binding.factor : null, stale,
          keeping: timer !== null, ...(keeperError ? { error: keeperError } : {}) };
      } catch { return fail('Native speed getter unavailable'); }
    }
    function applyAll(factor = 5, target) {
      if (!number(factor, .25, 16)) return fail('Factor must be finite, 0.25–16');
      const v = choose(target), c = snapshot(v);
      if (!c) return fail('No unique ready video; use videos() then apply(5, index). Inaccessible frames need separate injection');
      const mode = context(v)?.v === v ? 'yuketang' : 'html5';
      if (binding && (binding.mode !== mode || !sameVideo(binding.c, c) || (binding.mode === 'yuketang' && !same(saved, context())))) {
        const old = restoreAll(); if (!old.ok) return old;
      }
      stop(); selected = v; keeperError = null;
      const result = write(c, mode, factor);
      if (!result.ok) return result;
      binding = { c, mode, factor };
      // A bounded-frequency keeper runs only after explicit apply; never plays or seeks.
      timer = setInterval(() => {
        if (binding.mode !== (context(v)?.v === v ? 'yuketang' : 'html5')
          || !sameVideo(binding.c, snapshot(v)) || (mode === 'yuketang' && !same(saved, context()))) {
          stop(); keeperError = 'Video or player changed; apply again'; return;
        }
        try {
          const info = mode === 'yuketang' ? legacy.state() : null;
          if (rate.get.call(v) === factor && (!info || (info.sp === factor && info.isDrag === true))) return;
          const correction = write(binding.c, mode, factor);
          if (!correction.ok) { stop(); keeperError = correction.error; }
        } catch { stop(); keeperError = 'Speed keeper failed; restore or apply again'; }
      }, 500);
      return stateAll();
    }
    const api = { version: VERSION, apply: applyAll, restore: restoreAll, state: stateAll, measure,
      videos: () => {
        const found = discover();
        return { ok: true, blockedFrames: found.blockedFrames, videos: found.videos.map((v, index) => {
          try { return { index, ready: !!snapshot(v), paused: v.paused, real: rate.get.call(v), selected: v === selected }; }
          catch { return { index, ready: false, error: 'Native getter unavailable' }; }
        }) };
      },
      cancelMeasure: () => { measuring?.abort('cancelled'); return { ok: true }; },
      dispose: () => {
        const result = restoreAll(); if (!result.ok) return result;
        for (const b of panel.querySelectorAll('button')) b.onclick = null;
        panel.remove();
        if (window.video5x === api) delete window.video5x;
        if (window.ykt5x === api) delete window.ykt5x;
        return { ok: true };
      } };
    return api;
  }

  function context(video = selected) {
    if (!validPage() || location.hostname !== 'www.yuketang.cn') return null;
    const hosts = [...document.querySelectorAll('.xtplayer')];
    const found = hosts.map(host => {
      const p = host.__vue__?.$data?.player;
      const videos = [...host.querySelectorAll('video')];
      const v = p?.video;
      const menu = host.querySelector('xt-speedbutton');
      const label = host.querySelector('xt-speedvalue');
      const items = menu ? [...menu.querySelectorAll('li[data-speed]')] : [];
      return v && (!video || v === video) && videos.includes(v) && v.isConnected && Number.isFinite(v.duration) && v.duration > 0
        && v.readyState >= 1 && p.options?.speed && menu && label && items.length
        ? { host, v, p, options: p.options, speed: p.options.speed, menu, label, items,
          src: v.currentSrc, url: location.href } : null;
    }).filter(Boolean);
    return found.length === 1 ? found[0] : null;
  }
  const same = (a, b) => a && b && ['v', 'p', 'options', 'speed', 'menu', 'src', 'url'].every(k => a[k] === b[k])
    && a.items.length === b.items.length && a.items.every((el, i) => el === b.items[i]);
  function state() {
    const c = context();
    return c ? { ok: true, attached: true, real: rate.get.call(c.v), sp: c.speed.value,
      ui: c.label.textContent, isDrag: c.options.isDrag, paused: c.v.paused,
      ended: c.v.ended, ready: c.v.readyState, target: same(saved, c) ? saved.factor : null,
      stale: !!saved && !same(saved, c) } : { ok: false, attached: false, error: 'Player missing, ambiguous or not ready' };
  }
  const descriptor = (obj, key) => ({ obj, key, original: obj[key], value: Object.getOwnPropertyDescriptor(obj, key) });
  function put(d) {
    if (d.value && !('value' in d.value)) {
      d.value.set.call(d.obj, d.original);
      if (!Object.is(d.obj[d.key], d.original)) throw Error('Accessor value not restored');
      return;
    }
    if (d.value) Object.defineProperty(d.obj, d.key, d.value);
    else delete d.obj[d.key];
  }
  function click(c, el) {
    el.classList.remove(activeClass);
    for (const type of ['mouseover', 'mousemove']) c.menu.dispatchEvent(new MouseEvent(type,
      { bubbles: true, clientX: type === 'mouseover' ? 10 : 40, clientY: 35 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 40, clientY: 35 }));
  }
  function restore() {
    measuring?.abort('restore');
    if (!saved) return { ok: true, restored: false };
    const s = saved;
    // Never replay a prior video's state into a reused video/player instance.
    const sameSource = s.v.currentSrc === s.src;
    const current = context();
    const owned = sameSource && s.p.video === s.v && s.p.options === s.options && s.options.speed === s.speed
      && s.host.__vue__?.$data?.player === s.p && (location.href === s.url || !s.v.isConnected);
    const replay = owned && (!current || current.v !== s.v || current.p === s.p);
    const errors = [];
    const attempt = fn => { try { fn(); } catch { errors.push('Restore step failed'); } };
    if (replay) attempt(() => {
      // Use the original handler to restore its closure-held selection, not just options.value.
      const live = current?.p === s.p ? current : s;
      const li = live.items.includes(s.li) ? s.li : live.items[0];
      const cache = s.jq.data(li, 'speed');
      const attr = li.getAttribute('data-speed');
      try {
        s.jq(li).data('speed', s.originalSpeed);
        li.setAttribute('data-speed', String(s.originalSpeed));
        click(live, li);
      } finally {
        if (cache === undefined) s.jq(li).removeData('speed'); else s.jq(li).data('speed', cache);
        if (attr === null) li.removeAttribute('data-speed'); else li.setAttribute('data-speed', attr);
      }
      if (Math.abs(rate.get.call(s.v) - Number(s.originalSpeed)) > .001
        || s.speed.value !== s.originalSpeed) throw new Error('Handler did not restore selection');
    });
    for (const item of s.menuBackup) attempt(() => {
      if (!owned && item.el.isConnected) return;
      for (const [name, value] of Object.entries(item.attrs)) {
        if (value === null) item.el.removeAttribute(name); else item.el.setAttribute(name, value);
      }
      item.el.innerHTML = item.html;
    });
    if (owned || !s.li.isConnected)
      attempt(() => s.hadCache ? s.jq(s.li).data('speed', s.cache) : s.jq(s.li).removeData('speed'));
    if (owned) {
      for (const d of s.descriptors) attempt(() => put(d));
      if (replay) {
        attempt(() => rate.set.call(s.v, s.originalRate));
        if (rate.get.call(s.v) !== s.originalRate) errors.push('Native rate mismatch');
      }
      attempt(() => { s.label.textContent = s.labelText; });
    }
    if (errors.length) return { ok: false, restored: false, error: errors.join('; '), retryable: true };
    saved = null;
    return { ok: true, restored: replay, skippedReusedInstance: !replay };
  }
  function apply(factor = 5) {
    if (!number(factor, .25, 16)) return fail('Factor must be finite, 0.25–16');
    const c = context();
    if (!c) return fail('Player missing, ambiguous or not ready');
    if (saved && !same(saved, c)) {
      const old = restore();
      if (!old.ok) return old;
    }
    if (!saved) {
      const jq = window.jQuery;
      if (typeof jq !== 'function' || typeof jq.data !== 'function') return fail('Supported jQuery required');
      const li = c.items.find(el => !el.classList.contains(activeClass));
      if (!li || !number(c.speed.value, .25, 16)) return fail('No usable speed menu / original selection');
      const descriptors = [descriptor(c.options, 'isDrag'), descriptor(c.speed, 'value')];
      if (descriptors.some(d => d.value && ('value' in d.value
        ? !d.value.writable : typeof d.value.get !== 'function' || typeof d.value.set !== 'function')))
        return fail('Unsupported configuration descriptors');
      // Static jQuery.data avoids lazy hydration from DOM attributes when taking the backup.
      const cache = jq.data(li, 'speed');
      saved = { ...c, jq, li, cache, hadCache: cache !== undefined, descriptors,
        originalRate: rate.get.call(c.v), originalSpeed: c.speed.value, labelText: c.label.textContent, factor: null,
        menuBackup: c.items.map(el => ({ el, html: el.innerHTML,
          attrs: Object.fromEntries(['data-speed', 'keyt', 'class'].map(k => [k, el.getAttribute(k)])) })) };
    }
    const s = saved;
    if (s.factor === factor && rate.get.call(c.v) === factor && c.speed.value === factor && c.options.isDrag === true)
      return { ...state(), ok: true };
    try {
      s.jq(s.li).data('speed', factor);
      s.li.setAttribute('data-speed', String(factor));
      s.li.setAttribute('keyt', factor.toFixed(2));
      s.li.textContent = `${factor.toFixed(2)}X`;
      click(c, s.li);
      c.options.isDrag = true;
      if (rate.get.call(c.v) !== factor || c.speed.value !== factor || c.options.isDrag !== true)
        throw new Error('Native rate / selection / drag configuration mismatch');
      s.factor = factor;
      return { ...state(), ok: true };
    } catch {
      const rollback = restore();
      return { ok: false, error: 'Apply failed', rollback };
    }
  }
  async function measure(ms = 60000) {
    if (!number(ms, 10, 300000)) return fail('Measurement must be finite, 10–300000 ms');
    if (measuring) return fail('Measurement already running');
    const c = snapshot(selected || choose());
    if (!c) return fail('Player not ready');
    const v = c.v, start = performance.now(), initial = v.currentTime;
    let last = start, mode = v.seeking ? 'seeking' : v.paused ? 'paused' : v.readyState < 3 ? 'waiting' : 'playing';
    const times = { paused: 0, waiting: 0, playing: 0, seeking: 0 };
    let reason = 'elapsed', seek = v.seeking, invalid = v.seeking;
    let resolveDone, timer, poll;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const account = () => { const now = performance.now(); times[mode] += now - last; last = now; };
    const finish = why => {
      account(); reason = why === 'elapsed' && !sameVideo(c, snapshot(c.v)) ? 'replaced' : why; resolveDone();
    };
    const handlers = {
      waiting: () => { account(); mode = v.paused ? 'paused' : 'waiting'; },
      playing: () => { account(); mode = 'playing'; },
      pause: () => { account(); mode = 'paused'; },
      seeking: () => { account(); seek = true; invalid = true; mode = 'seeking'; },
      seeked: () => { account(); mode = v.paused ? 'paused' : v.readyState < 3 ? 'waiting' : 'playing'; },
      ended: () => finish('ended'), emptied: () => finish('replaced'),
    };
    measuring = { abort: finish };
    try {
      for (const [event, fn] of Object.entries(handlers)) v.addEventListener(event, fn);
      window.addEventListener('pagehide', onPageHide);
      timer = setTimeout(() => finish('elapsed'), ms);
      poll = setInterval(() => { if (!sameVideo(c, snapshot(c.v))) finish('replaced'); }, 25);
      await done;
      account();
      const wall = (last - start) / 1000, advance = v.currentTime - initial;
      const playing = times.playing / 1000;
      const ok = reason === 'elapsed' || reason === 'ended';
      const reliable = ok && !invalid && advance >= 0;
      return { ok, reason, wallSec: wall, mediaAdvanceSec: advance, seek,
        overallRate: reliable && wall > 0 ? advance / wall : null,
        netRate: reliable && playing > 0 ? advance / playing : null,
        waitSec: times.waiting / 1000, pauseSec: times.paused / 1000,
        seekSec: times.seeking / 1000, real: rate.get.call(v), ended: v.ended };
    } finally {
      clearTimeout(timer); clearInterval(poll);
      for (const [event, fn] of Object.entries(handlers)) v.removeEventListener(event, fn);
      window.removeEventListener('pagehide', onPageHide);
      measuring = null;
    }
    function onPageHide() { finish('navigation'); }
  }
  // Keep the tested Yuketang menu adapter; other videos use native media APIs.
  const panel = document.createElement('div');
  panel.id = 'ykt5x-panel';
  panel.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483646;padding:8px;background:#fff;color:#111;border:1px solid #555';
  const status = document.createElement('span');
  for (const f of [5, 'restore']) {
    const b = document.createElement('button');
    b.textContent = f === 'restore' ? '恢复' : `${f}×`;
    b.onclick = () => { status.textContent = JSON.stringify(f === 'restore' ? api.restore() : api.apply(f)); };
    panel.appendChild(b);
  }
  panel.appendChild(status);
  document.body.appendChild(panel);
  const api = installUniversal({ apply, restore, state }, panel);
  window.video5x = window.ykt5x = api;
  return { ok: true, version: VERSION };
})()
