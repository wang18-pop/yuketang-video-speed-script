// Optional real Chromium DOM/native media smoke test; no network or course session.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

if (!process.env.BROWSER) throw new Error('Set BROWSER to a Chromium executable');
const dir = await mkdtemp(join(tmpdir(), 'video-speed-smoke-'));
const source = await readFile(new URL('../ykt-5x.js', import.meta.url), 'utf8');
const page = `<!doctype html><meta charset="utf-8"><body><div class="xtplayer"><video></video>
<xt-speedbutton><li data-speed="2">2X</li><li data-speed="1.5">1.5X</li><li data-speed="1.25" class="xt_video_player_common_active">1.25X</li></xt-speedbutton>
<xt-speedvalue>1.25X</xt-speedvalue></div><pre id="result">PENDING</pre><script>
const result = document.querySelector('#result');
try {
  const host = document.querySelector('.xtplayer'), v = host.querySelector('video');
  Object.defineProperty(v, 'duration', {configurable:true,value:100});
  Object.defineProperty(v, 'readyState', {configurable:true,value:4});
  v.playbackRate = 1.25;
  const p = {video:v,options:{isDrag:false,speed:{value:1.25}}}; host.__vue__ = {$data:{player:p}};
  const cache = new WeakMap();
  const jq = el => ({data(k,x){if(arguments.length===2){jq.data(el,k,x);return this;}return jq.data(el,k)??Number(el.getAttribute('data-'+k));},removeData(k){delete (cache.get(el)||{})[k];}});
  jq.data = function(el,k,x){if(!cache.has(el))cache.set(el,{});if(arguments.length===3)cache.get(el)[k]=x;return cache.get(el)[k];};
  window.jQuery=jq;
  let selected=1.25;
  for(const li of host.querySelectorAll('li'))li.addEventListener('click',()=>{
    if(li.classList.contains('xt_video_player_common_active'))return;
    selected=jq(li).data('speed');p.options.speed.value=selected;v.playbackRate=selected;
    host.querySelector('xt-speedvalue').textContent=Number(selected).toFixed(2)+'X';
    for(const item of host.querySelectorAll('li'))item.classList.remove('xt_video_player_common_active');
    li.classList.add('xt_video_player_common_active');
  });
  const before=host.innerHTML;
  // Lexical URL fixture only. The actual page is a local file; no target domain is contacted.
  const install = () => { const location = new URL('https://www.yuketang.cn/ai-workspace/lms-graph/CLASSROOM_ID/video/VIDEO_ID'); return (\n${source}\n); };
  const a=install(), b=window.ykt5x.apply(5), c=window.ykt5x.apply(4);
  v.pause();const d=window.ykt5x.restore();
  const native=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'playbackRate').get.call(v);
  const ok=a.ok&&b.ok&&c.ok&&d.ok&&native===1.25&&selected===1.25&&p.options.isDrag===false&&v.paused&&host.innerHTML===before;
  window.ykt5x.dispose();
  result.textContent=JSON.stringify({ok,native,selected,paused:v.paused,menuRestored:host.innerHTML===before});
}catch(e){result.textContent=JSON.stringify({ok:false,error:e.message});}
</script>`;
try {
  const file = join(dir, 'fixture.html'); await writeFile(file, page);
  const output = execFileSync(process.env.BROWSER, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${join(dir, 'profile')}`,
    '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const raw = /<pre id="result">([^<]*)<\/pre>/.exec(output)?.[1];
  const result = JSON.parse(raw || '{}');
  assert.equal(result.ok, true, JSON.stringify(result));
  console.log(JSON.stringify({ browserSmoke: 'PASS', ...result }));
} finally {
  if (resolve(dirname(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('video-speed-smoke-'))
    throw new Error('Unexpected temporary directory; refusing cleanup');
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
}
