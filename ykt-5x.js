// ==UserScript==
// @name         网页视频五倍速脚本
// @version      4.1.0
// @description  AI 选择网页视频，保持五倍速并支持恢复原倍速
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  const VERSION = '4.1.0';
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

  // video5x-catalogue:start
  function createCatalogue() {
    let custom = null;
    const statuses = ['completed', 'in_progress', 'not_started', 'unknown'];
    const kinds = ['video', 'other', 'unknown'];
    const text = value => String(value ?? '').trim();
    function classify(input = {}) {
      if (typeof input === 'string') input = { label: input };
      if (!input || typeof input !== 'object') return 'unknown';
      const state = text(input.status).toLowerCase();
      if (statuses.includes(state) && state !== 'unknown') return state;
      if (['已完成', '已学习', '已看完', 'completed', 'finished'].includes(state)) return 'completed';
      if (['进行中', '未完成', 'incomplete'].includes(state)) return 'in_progress';
      if (['未开始', '未观看', 'not_started'].includes(state)) return 'not_started';
      const raw = input.progress;
      if (raw !== undefined && raw !== null && text(raw) !== '') {
        const p = typeof raw === 'number' ? raw : /^\d+(?:\.\d+)?%?$/.test(text(raw)) ? Number(text(raw).replace('%', '')) : NaN;
        if (Number.isFinite(p) && p >= 0 && p <= 100) return p === 100 ? 'completed' : p === 0 ? 'not_started' : 'in_progress';
      }
      const label = text(input.label);
      if (/(?:未完成|未看完|未学完|进行中|学习中)/.test(label)) return 'in_progress';
      if (/(?:未开始|未观看|未学习)/.test(label)) return 'not_started';
      const percents = [...label.matchAll(/(?:^|[^\d.+-])(\d+(?:\.\d+)?)\s*%/g)].map(m => Number(m[1]));
      if (percents.length === 1 && percents[0] <= 100) return classify({ progress: percents[0] });
      if (/(?:^|[\s:：])(?:已完成|已学习|已看完)(?:$|\s)/.test(label)) return 'completed';
      return 'unknown';
    }
    const attr = (el, name) => el?.getAttribute?.(name);
    const has = (el, selector) => !!el?.querySelector?.(selector);
    function validate(result) {
      if (!result || typeof result.platform !== 'string' || !result.courseKey || !Array.isArray(result.items))
        return { ok: false, platform: result?.platform || 'unknown', courseKey: null, items: [], error: 'Course identity or catalogue unavailable' };
      const seen = new Set();
      for (const item of result.items) {
        if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)
          || !kinds.includes(item.kind) || !statuses.includes(item.status) || typeof item.active !== 'boolean'
          || !item.element || typeof item.element.click !== 'function' || item.element.isConnected === false)
          return { ok: false, platform: result.platform, courseKey: result.courseKey, items: [], error: 'Missing/duplicate resource identity, invalid metadata or detached navigation' };
        seen.add(item.id);
      }
      return { ...result, ok: result.items.length > 0, error: result.items.length ? null : 'Catalogue empty' };
    }
    function scan() {
      try {
        if (custom) return validate(custom());
        const host = location.hostname;
        const inDomain = domain => host === domain || host.endsWith('.' + domain);
        const platform = inDomain('yuketang.cn') ? 'yuketang' : inDomain('chaoxing.com') ? 'chaoxing'
          : inDomain('zhihuishu.com') ? 'zhihuishu' : inDomain('icve.com.cn') ? 'icve'
          : inDomain('mosoteach.cn') ? 'mosoteach' : 'generic';
        const layouts = {
          yuketang: ['.nav-item-leaf-box', '.leaf-detail'],
          chaoxing: ['.posCatalog_select'],
          zhihuishu: ['.clearfix.video'],
          icve: ['.s_point[itemtype]', '.panelList .node'],
          mosoteach: ['.hide-div > [data-value]'],
          generic: ['[data-video5x-resource]'],
        };
        let rows = [], layout = '';
        for (const selector of layouts[platform]) {
          rows = [...document.querySelectorAll(selector)];
          if (rows.length) { layout = selector; break; }
        }
        // Explicit metadata is an Agent extension contract, not an inferred site API.
        if (!rows.length) rows = [...document.querySelectorAll('[data-video5x-resource]')];
        const url = new URL(location.href), keys = ['courseId', 'courseid', 'course_id', 'classroomId', 'clazzid', 'clazz_course_id', 'recruitAndCourseId', 'courseOpenId', 'openClassId'];
        const ids = keys.filter(k => url.searchParams.has(k)).map(k => k + '=' + url.searchParams.get(k));
        const graph = /^\/ai-workspace\/lms-graph(?:-mobile)?\/([^/]+)/.exec(url.pathname);
        const explicitCourse = attr(document.querySelector('[data-course-id]'), 'data-course-id');
        const courseKey = explicitCourse ? url.origin + ':course=' + explicitCourse : ids.length ? url.origin + ':' + ids.join('&')
          : graph ? url.origin + ':classroom=' + graph[1] : null;
        const items = rows.map(row => {
          const element = row.querySelector('.leaf-item') || row.querySelector('a[href]') || row;
          const href = attr(element, 'href') || attr(row, 'data-href');
          let id = attr(row, 'data-resource-id') || attr(row, 'data-id') || attr(row, 'data-value') || attr(row, 'id');
          if (!id && href && !/^\s*#/.test(href)) {
            const link = new URL(href, url.href);
            if (['http:', 'https:'].includes(link.protocol) && link.origin === url.origin && link.href !== url.href && link.hash !== '#') id = link.href;
          }
          const declaredType = text(attr(row, 'data-type') || attr(row, 'data-resource-type') || attr(row, 'itemtype')).toLowerCase();
          let kind = ['video', '视频', 'mp4'].includes(declaredType) ? 'video'
            : ['exam', 'quiz', 'homework', 'document', 'audio', 'ppt', '作业', '考试', '测验', '课件'].includes(declaredType) ? 'other' : 'unknown';
          if (kind === 'unknown' && (platform === 'zhihuishu' && layout === '.clearfix.video'
            || platform === 'yuketang' && (has(row, '.icon--shipin') || href && /\/video\/[^/?#]+/.test(href))
            || href && /\.mp4(?:[?#]|$)/i.test(href))) kind = 'video';
          let status = classify({ status: attr(row, 'data-status'), progress: attr(row, 'data-progress'),
            label: row.querySelector('.progress-time .progress-wrap .item')?.textContent || attr(row, 'data-state-label') || row.textContent });
          if (status === 'unknown' && (platform === 'zhihuishu' && has(row, '.time_icofinish')
            || platform === 'icve' && (has(row, '.done_icon_show') || has(row, 'i.wc')))) status = 'completed';
          const count = row.querySelector('.jobUnfinishCount');
          if (status === 'unknown' && platform === 'chaoxing' && count && /^\d+$/.test(text(count.value)))
            status = Number(count.value) === 0 ? 'completed' : 'in_progress';
          const active = ['true', 'page'].includes(attr(element, 'aria-current')) || attr(row, 'data-active') === 'true'
            || row.classList?.contains('current_play') || row.classList?.contains('s_pointerct')
            || row.classList?.contains('posCatalog_active') || row.classList?.contains('active')
            || row.classList?.contains('is-active') || has(row, '.leaf-item.is-active');
          return { id: text(id), title: text(attr(row, 'title') || row.querySelector('.catalogue_title,.res-name')?.textContent || row.textContent),
            kind, status, active: !!active, element };
        });
        return validate({ platform, courseKey, items });
      } catch {
        return { ok: false, platform: 'unknown', courseKey: null, items: [], error: 'Catalogue inaccessible; inspect target frame or register a verified adapter' };
      }
    }
    function register(adapter) {
      if (adapter !== null && typeof adapter !== 'function') return { ok: false, error: 'Adapter must be a scan function or null' };
      custom = adapter;
      return { ok: true };
    }
    return { scan, classify, register };
  }
  // video5x-catalogue:end


  function createBackground(hooks) {
    let enabled = false, video = null, doc = null, source, stream, route;
    let epoch = 0, resumeTimer = null, rateTimer = null, attempts = 0, rateFailures = 0;
    let waiting = false, hiddenAt = -Infinity, intentAt = -Infinity, wasPlaying = false;
    let reason = 'disabled', lastRateCheck = -Infinity, correcting = false, endedNotified = false, baseline = null, observation = null;
    const now = () => performance.now();
    const cancel = () => { epoch++; clearTimeout(resumeTimer); clearTimeout(rateTimer); resumeTimer = rateTimer = null; };
    const valid = () => video && video.isConnected !== false && hooks.getVideo() === video
      && video.currentSrc === source && video.srcObject === stream && doc.URL === route;
    function sample() {
      if (!video) return { status: 'unbound', elapsedSec: 0, mediaAdvanceSec: 0, effectiveRate: null };
      if (!valid()) { cancel(); reason = 'player_changed'; return { status: 'replaced', effectiveRate: null }; }
      const stamp = now(), current = video.currentTime;
      const status = video.error ? 'error' : video.ended ? 'ended' : video.paused ? 'paused'
        : waiting || video.readyState < 3 ? 'waiting' : video.seeking ? 'seeking' : 'playing';
      if (!baseline) baseline = { stamp, current, status, hidden: !!doc.hidden };
      const elapsed = (stamp - baseline.stamp) / 1000, advance = current - baseline.current;
      if (elapsed >= .2) {
        const reliable = status === 'playing' && baseline.status === 'playing' && !video.seeking && advance >= 0;
        observation = { status: reliable ? advance > 0 ? 'advancing' : 'no_progress' : status,
          elapsedSec: elapsed, mediaAdvanceSec: advance, effectiveRate: reliable ? advance / elapsed : null,
          observedHidden: baseline.hidden && !!doc.hidden };
        baseline = { stamp, current, status, hidden: !!doc.hidden };
      }
      return status === 'playing' ? observation || { status, effectiveRate: null }
        : { ...observation, status, effectiveRate: null };
    }
    const state = () => { const progress = sample(); return { ok: true, enabled, reason, attempts, waiting,
      paused: video?.paused ?? null, readyState: video?.readyState ?? null,
      real: video ? hooks.getRate ? hooks.getRate(video) : video.playbackRate : null, ended: video?.ended ?? null,
      mediaError: video?.error?.code ?? null, progress }; };
    function userIntent(event) {
      if (event.isTrusted !== true) return;
      intentAt = now(); wasPlaying = false; cancel(); reason = 'user_interaction';
    }
    function canResume(token) {
      return enabled && token === epoch && valid() && !!doc.hidden && wasPlaying
        && intentAt < hiddenAt && !waiting && !video.ended && !video.error && video.readyState >= 3;
    }
    function scheduleResume(token, delay = 250) {
      if (!canResume(token) || resumeTimer !== null) return;
      if (attempts >= 3) { reason = 'resume_limit'; wasPlaying = false; return; }
      resumeTimer = setTimeout(async () => {
        resumeTimer = null;
        if (!canResume(token) || !video.paused) return;
        const requested = video;
        attempts++; reason = 'resuming';
        try {
          await requested.play();
          if (token !== epoch || !enabled || !valid()) {
            // An already-issued play promise cannot be cancelled; stop its late automatic start.
            if (!requested.paused) requested.pause();
            return;
          }
          reason = requested.paused ? 'resume_unconfirmed' : 'playing';
          wasPlaying = false;
        } catch (error) {
          if (!canResume(token)) return;
          if (error?.name === 'NotAllowedError') { reason = 'autoplay_denied'; wasPlaying = false; return; }
          reason = 'resume_failed'; scheduleResume(token, 500 * 2 ** (attempts - 1));
        }
      }, delay);
    }
    function visibility() {
      cancel(); baseline = null; observation = null;
      if (!enabled || !valid()) return;
      if (!doc.hidden) { wasPlaying = false; reason = 'visible'; return; }
      hiddenAt = now();
      wasPlaying = !video.paused && !video.ended && !video.error && !waiting && video.readyState >= 3
        && hiddenAt - intentAt > 1500;
      reason = wasPlaying ? 'observing_background' : 'pause_cause_unknown';
    }
    function onPause() {
      sample();
      // Only a pause immediately correlated with a playing -> hidden transition is eligible.
      if (!canResume(epoch) || now() - hiddenAt > 1000) {
        wasPlaying = false; clearTimeout(resumeTimer); resumeTimer = null;
        reason = video?.ended ? 'ended' : waiting ? 'waiting' : 'pause_cause_unknown'; return;
      }
      scheduleResume(epoch);
    }
    function onRate() {
      if (!enabled || !valid() || video.ended || correcting || rateFailures >= 3 || rateTimer !== null) return;
      rateTimer = setTimeout(() => {
        rateTimer = null;
        if (!enabled || !valid() || video.ended || rateFailures >= 3) return;
        correcting = true; lastRateCheck = now();
        try {
          if (hooks.correctRate()?.ok !== true) {
            reason = 'rate_correction_failed';
            if (++rateFailures >= 3) { reason = 'rate_failed'; hooks.stopKeeper(); }
          } else rateFailures = 0;
        } catch { if (++rateFailures >= 3) { reason = 'rate_failed'; hooks.stopKeeper(); } }
        finally { correcting = false; }
      }, Math.max(0, 500 - (now() - lastRateCheck)));
    }
    function onPlaying() { if (!video?.ended) endedNotified = false; waiting = false; reason = 'playing'; baseline = null; sample(); }
    function onSeek() { cancel(); wasPlaying = false; baseline = observation = null; reason = 'seeking'; }
    function onWaiting() { sample(); waiting = true; wasPlaying = false; cancel(); reason = 'waiting'; }
    function onEnded() {
      if (endedNotified) return;
      endedNotified = true; cancel(); wasPlaying = false; reason = 'ended'; sample(); hooks.stopKeeper(); hooks.onEnded();
    }
    const mediaHandlers = { ratechange: onRate, pause: onPause, playing: onPlaying, waiting: onWaiting,
      seeking: onSeek, seeked: onSeek, ended: onEnded };
    function detach() {
      cancel();
      if (video) for (const [name, fn] of Object.entries(mediaHandlers)) video.removeEventListener(name, fn);
      if (doc?.removeEventListener) {
        doc.removeEventListener('visibilitychange', visibility);
        doc.removeEventListener('pointerdown', userIntent, true);
        doc.removeEventListener('keydown', userIntent, true);
      }
      video = doc = null; baseline = observation = null; wasPlaying = false; endedNotified = false;
    }
    function bind(next) {
      if (next === video && valid()) return state();
      detach(); video = next;
      if (!video) { reason = 'unbound'; return state(); }
      doc = video.ownerDocument || document; source = video.currentSrc; stream = video.srcObject; route = doc.URL;
      waiting = video.readyState < 3; baseline = observation = null; reason = enabled ? 'bound' : 'disabled';
      for (const [name, fn] of Object.entries(mediaHandlers)) video.addEventListener(name, fn);
      if (doc.addEventListener) {
        doc.addEventListener('visibilitychange', visibility);
        doc.addEventListener('pointerdown', userIntent, true);
        doc.addEventListener('keydown', userIntent, true);
      }
      sample(); return state();
    }
    return { bind, state, sample,
      enable() {
        if (enabled) return state();
        enabled = true; attempts = rateFailures = 0; reason = 'enabled'; bind(hooks.getVideo()); return state();
      },
      disable() { enabled = false; cancel(); wasPlaying = false; reason = 'disabled'; return state(); },
      dispose() { enabled = false; detach(); reason = 'disposed'; return { ok: true }; },
    };
  }

  function installUniversal(legacy, panel) {
    let backup = null, binding = null, timer = null, keeperError = null;
    let lifecycleWindow = null;
    const stop = () => { clearInterval(timer); timer = null; };
    const detachLifecycle = () => { lifecycleWindow?.removeEventListener('pagehide', onPageHide); lifecycleWindow = null; };
    function onPageHide() { stopAutomation(); render(); }
    const catalogue = createCatalogue();
    const boundVideo = () => binding && sameVideo(binding.c, snapshot(binding.c.v)) ? binding.c.v : null;
    const background = createBackground({ getVideo: boundVideo, getRate: v => rate.get.call(v), correctRate, stopKeeper: stop,
      onEnded: () => { void autonext.onEnded(); render(); } });
    const autonext = createAutonext({ scan: () => catalogue.scan(), factor: () => binding?.factor || 5,
      getVideo: () => {
        const list = discover().videos.filter(v => snapshot(v));
        return list.length === 1 ? list[0] : null;
      }, identity: v => snapshot(v, true), apply: applyAll,
      beforeNavigate: () => { background.bind(null); stop(); const result = restoreAll(); if (!result.ok) throw Error('导航前恢复失败'); }, onChange: render,
    });
    function correctRate() {
      if (!binding || !boundVideo() || binding.c.v.ended) return fail('Video changed or ended');
      const { c, mode, factor } = binding;
      const info = mode === 'yuketang' ? legacy.state() : null;
      if (rate.get.call(c.v) === factor && (!info || (info.sp === factor && info.isDrag === true))) return { ok: true };
      return write(c, mode, factor);
    }
    function restoreAll() {
      detachLifecycle(); background.bind(null); stop(); measuring?.abort('restore');
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
      background.bind(v);
      detachLifecycle(); lifecycleWindow = (v.ownerDocument || document).defaultView || null;
      lifecycleWindow?.addEventListener('pagehide', onPageHide, { once: true });
      // A bounded-frequency keeper runs only after explicit apply; never plays or seeks.
      timer = setInterval(() => {
        if (binding.mode !== (context(v)?.v === v ? 'yuketang' : 'html5')
          || !sameVideo(binding.c, snapshot(v)) || (mode === 'yuketang' && !same(saved, context()))) {
          background.bind(null); stop(); keeperError = 'Video or player changed; apply again'; render(); return;
        }
        if (v.ended) { stop(); render(); return; }
        try {
          background.sample();
          const correction = correctRate();
          if (!correction.ok) { stop(); keeperError = correction.error; }
        } catch { stop(); keeperError = 'Speed keeper failed; restore or apply again'; }
        render();
      }, 500);
      render();
      return stateAll();
    }
    const stopAutomation = () => { detachLifecycle(); autonext.disable(); background.disable(); background.bind(null); stop(); return { ok: true }; };
    const api = { version: VERSION, apply: applyAll,
      restore: () => { stopAutomation(); const result = restoreAll(); render(); return result; }, state: stateAll, measure,
      background, autonext, catalogue, stop: () => { const result = stopAutomation(); render(); return result; },
      videos: () => {
        const found = discover();
        return { ok: true, blockedFrames: found.blockedFrames, videos: found.videos.map((v, index) => {
          try { return { index, ready: !!snapshot(v), paused: v.paused, real: rate.get.call(v), selected: v === selected }; }
          catch { return { index, ready: false, error: 'Native getter unavailable' }; }
        }) };
      },
      cancelMeasure: () => { measuring?.abort('cancelled'); return { ok: true }; },
      dispose: () => {
        stopAutomation(); background.dispose();
        const result = restoreAll(); if (!result.ok) return result;
        for (const b of panel.querySelectorAll('button')) b.onclick = null;
        panel.remove();
        if (window.video5x === api) delete window.video5x;
        if (window.ykt5x === api) delete window.ykt5x;
        return { ok: true };
      } };
    const output = document.createElement('div');
    output.style.cssText = 'max-width:340px;white-space:pre-wrap;font:12px/1.5 sans-serif';
    function render() {
      const bg = background.state(), auto = autonext.state(), v = boundVideo();
      const reasons = { disabled: '已关闭', unbound: '未绑定视频', enabled: '已启用', playing: '正常播放', bound: '已绑定视频',
        observing_background: '正在观察后台进度', pause_cause_unknown: '暂停原因未知，保持暂停', autoplay_denied: '浏览器拒绝自动播放',
        user_interaction: '尊重用户操作', seeking: '拖动中', waiting: '缓冲中', ended: '视频结束', visible: '前台播放',
        rate_failed: '倍速纠正失败', resume_limit: '续播重试已达上限', resume_failed: '续播失败', disposed: '已卸载' };
      output.textContent = '后台续播：' + (bg.enabled ? '开启' : '关闭') + ' · 自动连播：' + (auto.enabled ? '开启' : '关闭')
        + '\n倍率：' + (v ? rate.get.call(v) : '未绑定') + ' · ' + (v?.ended ? '视频结束' : v?.paused ? '已暂停' : v ? '播放中' : '未选择视频')
        + '\n实际进度：' + (bg.progress?.mediaAdvanceSec ?? '待采样') + ' 秒 · 下一视频：' + (auto.nextId || '未确认')
        + '\n' + (auto.reason || keeperError || reasons[bg.reason] || bg.reason);
    }
    for (const [label, action] of [
      ['后台续播', () => background.state().enabled ? background.disable() : background.enable()],
      ['自动连播', () => autonext.state().enabled ? autonext.disable() : autonext.enable()],
      ['状态', () => ({ playback: stateAll(), background: background.state(), autonext: autonext.state() })],
      ['停止自动化', stopAutomation],
    ]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.onclick = () => { action(); render(); }; panel.appendChild(b);
    }
    panel.appendChild(output);
    render();
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
  // AUTONEXT_BEGIN: only native directory clicks and platform-confirmed completion.
  function createAutonext(hooks) {
    let enabled = false, running = false, epoch = 0, timer = null, wake = null;
    let playTimer = null, cancelPlay = null;
    let phase = 'disabled', reason = null, course = null, current = null, candidate = null;
    const visited = new Set();
    const cancelWait = () => { clearTimeout(timer); timer = null; const done = wake; wake = null; done?.(); };
    const sleep = () => new Promise(resolve => { wake = resolve; timer = setTimeout(() => { timer = null; wake = null; resolve(); }, 500); });
    function state() {
      return { ok: !reason, enabled, running, phase, reason, courseKey: course,
        currentId: current, nextId: candidate, visited: [...visited] };
    }
    function disable(why = null) {
      enabled = false; running = false; epoch++; cancelWait();
      clearTimeout(playTimer); playTimer = null;
      const cancel = cancelPlay; cancelPlay = null; cancel?.();
      phase = why ? 'stopped' : 'disabled'; reason = why; candidate = null;
      hooks.onChange?.();
      return state();
    }
    function scan() {
      const result = hooks.scan();
      if (!result?.ok || !result.courseKey || !Array.isArray(result.items)) throw Error(result?.error || '目录不可识别，需要 Agent 适配');
      if (course && result.courseKey !== course) throw Error('课程已改变，自动连播停止');
      const ids = result.items.map(x => x.id);
      if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw Error('目录资源标识缺失或重复');
      const active = result.items.filter(x => x.active);
      if (active.length !== 1) throw Error('无法唯一确认当前资源');
      return { ...result, active: active[0] };
    }
    function enable() {
      if (enabled) return state();
      disable(); reason = null; course = null; current = null; visited.clear();
      try {
        const result = scan(), video = hooks.getVideo();
        if (result.active.kind !== 'video' || !video || video.error || video.readyState < 1) throw Error('当前项目不是可操作的视频');
        course = result.courseKey; current = result.active.id; visited.add(current);
        const applied = hooks.apply(hooks.factor(), video);
        if (!applied?.ok) throw Error(applied?.error || '无法应用目标倍速');
        enabled = true; phase = 'watching'; hooks.onChange?.(); return state();
      } catch (error) { return disable(error.message); }
    }
    async function onEnded() {
      if (!enabled || running) return state();
      const video = hooks.getVideo();
      if (!video?.ended || video.error) return state();
      running = true;
      const token = epoch, old = hooks.identity(video), originalId = current, factor = hooks.factor();
      const alive = () => enabled && epoch === token;
      try {
        phase = 'waiting_completion'; hooks.onChange?.();
        let result, completed = false, deadline = Date.now() + 15000;
        while (alive() && Date.now() < deadline) {
          result = scan();
          if (result.active.id !== originalId) throw Error('当前资源被手动切换');
          if (result.active.status === 'completed') { completed = true; break; }
          await sleep();
        }
        if (!alive()) return state();
        if (!completed) throw Error('平台完成状态更新超时');
        const start = result.items.findIndex(x => x.id === originalId);
        let next = null;
        for (const item of result.items.slice(start + 1)) {
          if (item.kind === 'other') continue;
          if (item.kind !== 'video') throw Error('下一项目类型未知，需要人工选择');
          if (item.status === 'completed') continue;
          if (!['in_progress', 'not_started'].includes(item.status)) throw Error('下一视频观看状态未知，需要人工选择');
          if (visited.has(item.id)) throw Error('检测到重复访问，停止自动连播');
          next = item; break;
        }
        if (!next) { disable(); phase = 'finished'; return state(); }
        candidate = next.id; phase = 'navigating'; hooks.onChange?.();
        // Re-scan immediately before clicking: never retain a stale directory node.
        result = scan();
        if (result.active.id !== originalId) throw Error('导航前当前项目已改变');
        const target = result.items.find(x => x.id === candidate);
        if (!target || target.kind !== 'video' || !['in_progress', 'not_started'].includes(target.status)
          || !target.element?.isConnected || typeof target.element.click !== 'function') throw Error('候选目录已改变或不可点击');
        hooks.beforeNavigate();
        if (!alive()) return state();
        target.element.click(); // One attempt; a failed click must not become a navigation loop.
        deadline = Date.now() + 20000;
        let nextVideo = null;
        while (alive() && Date.now() < deadline) {
          const loaded = hooks.scan();
          if (!loaded?.ok || !loaded.items?.some(item => item.active)) { await sleep(); continue; }
          result = scan();
          if (![originalId, candidate].includes(result.active.id)) throw Error('导航进入了非预期资源');
          const v = hooks.getVideo(), identity = v && hooks.identity(v);
          if (result.active.id === candidate && v && !v.error && v.readyState >= 1 && !v.ended
            && identity && (identity.v !== old.v || identity.src !== old.src || identity.stream !== old.stream || identity.doc !== old.doc)) {
            nextVideo = v; break;
          }
          await sleep();
        }
        if (!alive()) return state();
        if (!nextVideo) throw Error('导航或新视频加载超时；整页跳转需重新注入并启用');
        phase = 'starting'; hooks.onChange?.();
        const applied = hooks.apply(factor, nextVideo);
        if (!applied?.ok) throw Error(applied?.error || '下一视频倍速设置失败');
        if (!alive()) return state();
        await new Promise((resolve, reject) => {
          cancelPlay = () => reject(Error('自动播放已取消'));
          playTimer = setTimeout(() => reject(Error('自动播放启动超时')), 10000);
          Promise.resolve().then(() => { if (!alive()) throw Error('自动播放已取消'); return nextVideo.play(); }).then(() => {
            if (!alive() && !nextVideo.paused) nextVideo.pause();
            resolve();
          }, reject);
        }).finally(() => {
          if (epoch === token) { clearTimeout(playTimer); playTimer = null; cancelPlay = null; }
        });
        if (!alive()) { if (!nextVideo.paused) nextVideo.pause(); return state(); }
        if (nextVideo.paused || nextVideo.error) throw Error('浏览器拒绝自动播放');
        current = candidate; candidate = null; visited.add(current); phase = 'watching';
      } catch (error) { if (alive()) disable(error.message || '自动连播失败'); }
      finally { if (epoch === token) { running = false; hooks.onChange?.(); } }
      return state();
    }
    return { enable, disable, state, onEnded, dispose: disable };
  }
  // AUTONEXT_END

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
