// ==UserScript==
// @name         雨课堂视频加速脚本
// @version      3.1.0
// @description  显式调整倍速、原生读回及可恢复的本地诊断
// @match        https://www.yuketang.cn/ai-workspace/lms-graph/*/video/*
// @match        https://www.yuketang.cn/ai-workspace/lms-graph-mobile/*/video/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  const VERSION = '3.1.0';
  const validPage = () => location.protocol === 'https:' && location.hostname === 'www.yuketang.cn'
    && !location.port && !location.username && !location.password
    && /^\/ai-workspace\/lms-graph(?:-mobile)?\/[^/]+\/video\/[^/]+\/?$/.test(location.pathname);
  if (!validPage()) return { ok: false, error: 'Unsupported page' };
  if (window.ykt5x) return window.ykt5x.version === VERSION
    ? { ok: true, version: VERSION } : { ok: false, error: 'Existing controller conflict' };
  const rate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  let saved = null, measuring = null;
  const mobilePage = /^\/ai-workspace\/lms-graph-mobile\//.test(location.pathname);
  const activeClass = 'xt_video_player_common_active';
  const number = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  const fail = error => ({ ok: false, error });

  // Dedicated HTML5 video controller for Android / iOS mobile web pages.
  // Never seeks, starts playback, edits platform progress or runs a speed keeper.
  if (mobilePage) return installMobile();
  function installMobile() {
    let backup = null, measuring = null;
    const get = () => {
      if (!validPage()) return null;
      const vs = [...document.querySelectorAll('video')].filter(v =>
        v.isConnected && !v.error && v.readyState >= 1 && Number.isFinite(v.duration) && v.duration > 0);
      return vs.length === 1 ? { v: vs[0], src: vs[0].currentSrc, url: location.href } : null;
    };
    const sameMobile = (a, b) => !!a && !!b && a.v === b.v && a.src === b.src && a.url === b.url;
    const native = v => rate.get.call(v);
    function stateMobile() {
      const c = get();
      if (!c) return { ok: false, attached: false, mode: 'mobile-html5',
        error: 'No unique ready HTML5 video' };
      try {
        return { ok: true, attached: true, mode: 'mobile-html5', real: native(c.v),
          paused: c.v.paused, ready: c.v.readyState,
          target: sameMobile(backup, c) ? backup.factor : null,
          stale: !!backup && !sameMobile(backup, c) };
      } catch { return fail('Native speed getter unavailable'); }
    }
    function restoreMobile() {
      measuring?.abort('restore');
      if (!backup) return { ok: true, restored: false };
      const c = get(), prior = backup;
      if (!sameMobile(prior, c)) {
        backup = null;
        return { ok: true, restored: false, skippedReusedInstance: true };
      }
      try {
        rate.set.call(c.v, prior.original);
        if (Math.abs(native(c.v) - prior.original) > .01) throw Error('Speed not restored');
        backup = null;
        return { ok: true, restored: true, real: native(c.v) };
      } catch {
        return { ok: false, restored: false, retryable: true, error: 'Speed restore failed' };
      }
    }
    function applyMobile(factor = 5) {
      if (!number(factor, .25, 16)) return fail('Invalid factor (0.25–16)');
      const c = get();
      if (!c) return fail('No unique ready HTML5 video; wait for video');
      if (backup && !sameMobile(backup, c)) {
        const old = restoreMobile();
        if (!old.ok) return old;
      }
      if (!backup) {
        let original;
        try { original = native(c.v); } catch { return fail('Native speed getter unavailable'); }
        if (!number(original, .25, 16)) return fail('Invalid original speed');
        backup = { ...c, original, factor: null };
      }
      try {
        rate.set.call(c.v, factor);
        if (Math.abs(native(c.v) - factor) > .01) throw Error('Unsupported speed');
        backup.factor = factor;
        return { ...stateMobile(), ok: true };
      } catch {
        const rollback = restoreMobile();
        return { ok: false, error: 'Browser/player rejected this speed', rollback };
      }
    }
    async function measureMobile(ms = 3000) {
      if (!number(ms, 100, 300000)) return fail('Measurement must be 100–300000 ms');
      if (measuring) return fail('Measurement already running');
      const c = get();
      if (!c || c.v.paused) return fail('Start video before measuring');
      const v = c.v, from = v.currentTime, start = performance.now();
      return await new Promise(resolve => {
        let timer, ended = false;
        const finish = reason => {
          if (ended) return;
          ended = true; clearTimeout(timer);
          v.removeEventListener('seeking', onSeek);
          v.removeEventListener('pause', onPause);
          v.removeEventListener('ended', onEnd);
          window.removeEventListener('pagehide', onPageHide);
          measuring = null;
          const elapsed = (performance.now() - start) / 1000, advance = v.currentTime - from;
          const ok = (reason === 'elapsed' || reason === 'ended') && sameMobile(c, get()) && advance >= 0;
          let real = null;
          try { real = native(v); } catch { /* unavailable */ }
          resolve({ ok, reason, elapsedSec: elapsed, mediaAdvanceSec: advance,
            effectiveRate: ok && elapsed > 0 ? advance / elapsed : null, real });
        };
        const onSeek = () => finish('seek');
        const onPause = () => finish('pause');
        const onEnd = () => finish('ended');
        const onPageHide = () => finish('navigation');
        v.addEventListener('seeking', onSeek);
        v.addEventListener('pause', onPause);
        v.addEventListener('ended', onEnd);
        window.addEventListener('pagehide', onPageHide);
        measuring = { abort: finish };
        timer = setTimeout(() => finish('elapsed'), ms);
      });
    }
    const panel = document.createElement('div');
    panel.id = 'ykt5x-panel';
    panel.style.cssText = 'position:fixed;right:8px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483646;max-width:min(94vw,360px);box-sizing:border-box;padding:8px;background:#fff;color:#111;border:1px solid #555;border-radius:8px;font:13px sans-serif;box-shadow:0 2px 8px #0003';
    const heading = document.createElement('div');
    heading.textContent = '雨课堂倍速 · 手机网页版';
    heading.style.cssText = 'font-weight:bold;margin-bottom:5px';
    panel.appendChild(heading);
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
    const status = document.createElement('div');
    status.style.cssText = 'font:11px/1.4 monospace;max-height:90px;overflow:auto;overflow-wrap:anywhere;margin-top:5px';
    for (const [label, action] of [
      ['2×', () => applyMobile(2)], ['3×', () => applyMobile(3)],
      ['4×', () => applyMobile(4)], ['5×', () => applyMobile(5)],
      ['恢复', restoreMobile], ['状态', stateMobile], ['测3秒', () => measureMobile(3000)],
    ]) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'background:#f6f6f6;color:#111;border:1px solid #aaa;border-radius:5px;padding:5px 7px;font:inherit';
      b.onclick = async () => {
        status.textContent = '检查中…';
        try { status.textContent = JSON.stringify(await action()); }
        catch { status.textContent = JSON.stringify(fail('Operation failed')); }
      };
      actions.appendChild(b);
    }
    panel.appendChild(actions);
    panel.appendChild(status);
    document.body.appendChild(panel);
    const api = { version: VERSION, mode: 'mobile-html5', apply: applyMobile, restore: restoreMobile,
      state: stateMobile, measure: measureMobile,
      cancelMeasure: () => { measuring?.abort('cancel'); return { ok: true }; },
      dispose: () => {
        const r = restoreMobile();
        if (!r.ok) return r;
        for (const b of actions.querySelectorAll('button')) b.onclick = null;
        panel.remove();
        if (window.ykt5x === api) delete window.ykt5x;
        return { ok: true };
      } };
    window.ykt5x = api;
    return { ok: true, version: VERSION, mode: 'mobile-html5' };
  }

  function context() {
    if (!validPage()) return null;
    const hosts = [...document.querySelectorAll('.xtplayer')];
    const found = hosts.map(host => {
      const p = host.__vue__?.$data?.player;
      const videos = [...host.querySelectorAll('video')];
      const v = p?.video;
      const menu = host.querySelector('xt-speedbutton');
      const label = host.querySelector('xt-speedvalue');
      const items = menu ? [...menu.querySelectorAll('li[data-speed]')] : [];
      return v && videos.includes(v) && v.isConnected && Number.isFinite(v.duration) && v.duration > 0
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
  const descriptor = (obj, key) => ({ obj, key, value: Object.getOwnPropertyDescriptor(obj, key) });
  function put(d) {
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
      if (descriptors.some(d => d.value && (!('value' in d.value) || !d.value.writable)))
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
      if (rate.get.call(c.v) !== factor || c.speed.value !== factor) throw new Error('Native rate / selection mismatch');
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
    const c = context();
    if (!c) return fail('Player not ready');
    const v = c.v, start = performance.now(), initial = v.currentTime;
    let last = start, mode = v.seeking ? 'seeking' : v.paused ? 'paused' : v.readyState < 3 ? 'waiting' : 'playing';
    const times = { paused: 0, waiting: 0, playing: 0, seeking: 0 };
    let reason = 'elapsed', seek = v.seeking, invalid = v.seeking;
    let resolveDone, timer, poll;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const account = () => { const now = performance.now(); times[mode] += now - last; last = now; };
    const finish = why => {
      account(); reason = why === 'elapsed' && !same(c, context()) ? 'replaced' : why; resolveDone();
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
      poll = setInterval(() => { if (!same(c, context())) finish('replaced'); }, 25);
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
  // Diagnostics are event-based: no descriptor wrapping, no write interception.
  const panel = document.createElement('div');
  panel.id = 'ykt5x-panel';
  panel.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483646;padding:8px;background:#fff;color:#111;border:1px solid #555';
  const status = document.createElement('span');
  for (const f of [2, 3, 4, 5, 'restore']) {
    const b = document.createElement('button');
    b.textContent = f === 'restore' ? '恢复' : `${f}×`;
    b.onclick = () => { status.textContent = JSON.stringify(f === 'restore' ? restore() : apply(f)); };
    panel.appendChild(b);
  }
  panel.appendChild(status);
  document.body.appendChild(panel);
  const api = { version: VERSION, apply, restore, state, measure,
    cancelMeasure: () => { measuring?.abort('cancelled'); return { ok: true }; },
    dispose: () => {
      const result = restore();
      if (!result.ok) return result;
      for (const b of panel.querySelectorAll('button')) b.onclick = null;
      panel.remove();
      if (window.ykt5x === api) delete window.ykt5x;
      return { ok: true };
    } };
  window.ykt5x = api;
  return { ok: true, version: VERSION };
})()
