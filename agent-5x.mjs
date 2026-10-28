#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const VERSION = '3.1.0';
const range = (x, low, high) => Number.isFinite(x) && x >= low && x <= high;
export function validPage(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'www.yuketang.cn' && !u.username && !u.password && !u.port
      && /^\/ai-workspace\/lms-graph\/[^/]+\/video\/[^/]+\/?$/.test(u.pathname);
  } catch { return false; }
}
export function localEndpoint(value, websocket = false) {
  const u = new URL(value);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) || u.username || u.password
    || !(websocket ? ['ws:'] : ['http:']).includes(u.protocol)
    || (!websocket && (u.pathname !== '/' || u.search || u.hash))) throw new Error('CDP must be a loopback endpoint');
  return u;
}
export function parseArgs(args) {
  const o = { action: 'state', cdp: 'http://127.0.0.1:9222', timeout: 10000 };
  let actions = 0;
  for (const arg of args) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error('Invalid argument');
    const [, key, value] = m;
    if (['state', 'restore', 'list', 'help', 'apply'].includes(key)) {
      if (++actions > 1 || (key !== 'apply' && value !== undefined)) throw new Error('Choose one action');
      o.action = key;
      if (key === 'apply') o.factor = value === undefined ? 5 : Number(value);
    } else if (['cdp', 'timeout', 'measure', 'match', 'target', 'url'].includes(key) && value) {
      o[key] = ['timeout', 'measure'].includes(key) ? Number(value) : value;
    } else if (key !== 'json' || value !== undefined) throw new Error('Unknown or empty option');
  }
  localEndpoint(o.cdp);
  if (!range(o.timeout, 100, 60000) || !Number.isInteger(o.timeout)) throw new Error('Timeout: 100–60000 ms');
  if (o.action === 'apply' && !range(o.factor, .25, 16)) throw new Error('Factor: 0.25–16');
  if (o.measure !== undefined && (!range(o.measure, .01, 300) || o.action !== 'apply')) throw new Error('Measure: 0.01–300 seconds, with apply');
  if (o.url && !validPage(o.url)) throw new Error('Unsupported target URL');
  return o;
}
export function selectTarget(targets, o) {
  if (!Array.isArray(targets)) throw new Error('Invalid target response');
  const found = targets.filter(t => t.type === 'page' && validPage(t.url)
    && (!o.target || t.id === o.target) && (!o.match || t.url.includes(o.match)) && (!o.url || t.url === o.url));
  if (found.length !== 1) throw new Error('Expected exactly one matching video page; use --target');
  localEndpoint(found[0].webSocketDebuggerUrl, true);
  return found[0];
}
export function connect(url, timeout, Socket = WebSocket) {
  localEndpoint(url, true);
  return new Promise((resolve, reject) => {
    const ws = new Socket(url), pending = new Map();
    let id = 0, closed = false;
    const on = (event, fn) => ws.addEventListener(event, fn);
    const off = (event, fn) => ws.removeEventListener(event, fn);
    const stop = message => {
      if (closed) return;
      closed = true; clearTimeout(openTimer);
      for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(message)); }
      pending.clear();
      off('open', opened); off('message', received); off('error', errored); off('close', ended);
      // A closing CONNECTING socket can dispatch a final error. Consume it without retaining the client.
      ws.addEventListener('error', () => {}, { once: true });
      try { ws.close(); } catch { /* already closed */ }
      reject(new Error(message));
    };
    const opened = () => {
      clearTimeout(openTimer);
      resolve({
        send(method, params = {}, ms = timeout) {
          if (closed) return Promise.reject(new Error('CDP closed'));
          const msgId = ++id;
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => stop('CDP request timeout'), ms);
            pending.set(msgId, { resolve, reject, timer });
            try { ws.send(JSON.stringify({ id: msgId, method, params })); }
            catch { stop('CDP send failed'); }
          });
        },
        close: () => stop('CDP closed'),
      });
    };
    const received = event => {
      let m; try { m = JSON.parse(event.data); } catch { stop('Invalid CDP JSON'); return; }
      if (m.method === 'Runtime.executionContextsCleared' || m.method === 'Inspector.detached'
        || m.method === 'Runtime.executionContextDestroyed') { stop('Page context changed'); return; }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(new Error('CDP command rejected')) : p.resolve(m.result);
    };
    const errored = () => stop('WebSocket connection failed');
    const ended = () => stop('WebSocket disconnected');
    const openTimer = setTimeout(() => stop('WebSocket connection timeout'), timeout);
    on('open', opened); on('message', received); on('error', errored); on('close', ended);
  });
}
export async function evaluate(cdp, expression, ms) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, ms);
  if (r?.exceptionDetails || !r?.result || r.result.subtype === 'error') throw new Error('Page evaluation failed');
  return r.result.value;
}
export async function install(cdp, source) {
  const result = await evaluate(cdp, source); // Execute source itself, never JSON.stringify(source).
  const api = await evaluate(cdp, `({version:window.ykt5x?.version,ready:['apply','restore','state','measure','cancelMeasure'].every(k=>typeof window.ykt5x?.[k]==='function')})`);
  if (result?.ok !== true || result.version !== VERSION || api?.version !== VERSION || !api.ready)
    throw new Error('Controller installation failed');
}
export async function run(o, dependencies = {}) {
  const fetcher = dependencies.fetch || fetch;
  const response = await fetcher(new URL('/json/list', o.cdp), { signal: AbortSignal.timeout(o.timeout), redirect: 'error' });
  if (!response.ok) throw new Error('CDP target discovery failed');
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error('Invalid target list');
  if (o.action === 'list') return { ok: true, targets: targets.filter(t => t.type === 'page' && validPage(t.url)).map(t => ({ id: t.id })) };
  const target = selectTarget(targets, o);
  const cdp = await (dependencies.connect || connect)(target.webSocketDebuggerUrl, o.timeout);
  let measuring = false;
  try {
    await cdp.send('Runtime.enable');
    await install(cdp, await readFile(new URL('./ykt-5x.js', import.meta.url), 'utf8'));
    const deadline = Date.now() + o.timeout;
    let ready;
    do {
      ready = await evaluate(cdp, 'window.ykt5x.state()');
      if (ready?.ok) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    // Restore must remain possible when the old player has already been detached.
    if (!ready?.ok && o.action !== 'restore') throw new Error('Player readiness timeout');
    const result = o.action === 'apply' ? await evaluate(cdp, `window.ykt5x.apply(${o.factor})`)
      : o.action === 'restore' ? await evaluate(cdp, 'window.ykt5x.restore()') : ready;
    const out = { ok: result?.ok === true, result };
    if (out.ok && o.measure !== undefined) {
      measuring = true;
      out.measure = await evaluate(cdp, `window.ykt5x.measure(${o.measure * 1000})`, o.measure * 1000 + o.timeout);
      measuring = false;
      out.ok = out.measure?.ok === true;
    }
    return out;
  } finally {
    if (measuring) {
      try { await evaluate(cdp, 'window.ykt5x?.cancelMeasure()', 500); } catch { /* context gone; page timers are bounded */ }
    }
    cdp.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const o = parseArgs(process.argv.slice(2));
    const out = o.action === 'help' ? { ok: true, usage: 'node agent-5x.mjs --list|--state|--apply=5|--restore [--target=<id>] [--measure=60] [--timeout=10000] [--cdp=http://127.0.0.1:9222]' } : await run(o);
    console.log(JSON.stringify(out, null, 2));
    if (!out.ok) process.exitCode = 1;
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Operation failed' }));
    process.exitCode = 1;
  }
}
