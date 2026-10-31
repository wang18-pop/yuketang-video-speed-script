// Real Chromium test on loopback fixtures only; no course/session is opened.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { connect, evaluate, parseArgs, run } from '../agent-5x.mjs';

if (!process.env.BROWSER) throw new Error('Set BROWSER to a Chromium executable');
const source = await readFile(new URL('../ykt-5x.js', import.meta.url), 'utf8');
const dir = await mkdtemp(join(tmpdir(), 'video-speed-smoke-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const wav = Buffer.alloc(44 + 8000 * 30 * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const server = createServer((req, res) => {
  if (req.url === '/tone.wav') { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length }); res.end(wav); }
  else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><body><video id="v" muted preload="auto" src="/tone.wav"></video><video id="unready"></video>'); }
});
let browser, cdp, spawnError;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const pageURL = 'http://127.0.0.1:' + server.address().port + '/';
  browser = spawn(process.env.BROWSER, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + dir, pageURL],
    { windowsHide: true, stdio: 'ignore' });
  browser.once('error', error => { spawnError = error; });
  const deadline = Date.now() + 15000;
  let endpoint, target;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    try {
      const port = (await readFile(join(dir, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      endpoint = 'http://127.0.0.1:' + port;
      const targets = await (await fetch(endpoint + '/json/list')).json();
      target = targets.find(t => t.type === 'page' && t.url === pageURL);
      if (target) break;
    } catch { /* browser starting */ }
    await wait(50);
  }
  assert.ok(target, 'Local Chromium did not become ready');
  cdp = await connect(target.webSocketDebuggerUrl, 10000);
  let page;
  while (Date.now() < deadline) {
    page = await evaluate(cdp, `({url:location.href,title:document.title,hasVideo:!!document.querySelector('#v'),body:document.body?.innerText.slice(0,250)})`);
    if (page.hasVideo) break;
    await wait(50);
  }
  assert.equal(page.hasVideo, true, JSON.stringify(page));
  await evaluate(cdp, `new Promise((resolve,reject)=>{const v=document.querySelector('#v');if(v.readyState>=1)return resolve(true);v.addEventListener('loadedmetadata',()=>resolve(true),{once:true});v.addEventListener('error',()=>reject(Error('fixture media failed')),{once:true});})`, 10000);
  const install = await evaluate(cdp, source);
  assert.equal(install.ok, true);
  const discovery = await evaluate(cdp, `(async()=>{
    const host=document.createElement('div');document.body.append(host);host.attachShadow({mode:'open'}).innerHTML='<video></video>';
    for(const sandbox of [false,true]) { const frame=document.createElement('iframe');if(sandbox)frame.setAttribute('sandbox','');frame.srcdoc='<video></video>';const loaded=new Promise(resolve=>frame.onload=resolve);document.body.append(frame);await loaded; }
    const v=document.querySelector('#v');v.playbackRate=1.25;
    return {listed:video5x.videos(),ambiguous:video5x.apply(),paused:v.paused};
  })()`, 10000);
  assert.equal(discovery.listed.videos.length, 4);
  assert.equal(discovery.listed.blockedFrames, 1);
  assert.equal(discovery.ambiguous.ok, false);
  assert.equal(discovery.paused, true);
  const options = ['--cdp=' + endpoint, '--target=' + target.id];
  const applied = await run(parseArgs([...options, '--apply=5', '--video=0']));
  assert.equal(applied.ok, true); assert.equal(applied.result.real, 5);
  const kept = await evaluate(cdp, `(async()=>{const v=document.querySelector('#v');v.playbackRate=2;await new Promise(r=>setTimeout(r,650));return {rate:v.playbackRate,paused:v.paused,state:video5x.state()};})()`);
  assert.equal(kept.rate, 5); assert.equal(kept.paused, true); assert.equal(kept.state.keeping, true);
  await evaluate(cdp, `(async()=>{const v=document.querySelector('#v');await v.play();await new Promise(r=>setTimeout(r,200));return true;})()`);
  const measured = await run(parseArgs([...options, '--apply=5', '--video=0', '--measure=1.2']));
  assert.equal(measured.ok, true, JSON.stringify(measured));
  assert.ok(measured.measure.overallRate > 4.4 && measured.measure.overallRate < 5.6, JSON.stringify(measured.measure));
  await evaluate(cdp, `document.querySelector('#v').pause();true`);
  const restored = await run(parseArgs([...options, '--restore']));
  assert.equal(restored.ok, true); assert.equal(restored.result.real, 1.25);
  const generic = await evaluate(cdp, `(async()=>{await new Promise(r=>setTimeout(r,600));const v=document.querySelector('#v');const result={rate:v.playbackRate,paused:v.paused,keeping:video5x.state().keeping};video5x.dispose();return result;})()`);
  assert.deepEqual(generic, { rate: 1.25, paused: true, keeping: false });

  // Native media keeps running while another real headless-browser tab is active.
  assert.equal((await evaluate(cdp, source)).ok, true);
  await evaluate(cdp, `(async()=>{video5x.apply(5,document.querySelector('#v'));video5x.background.enable();await document.querySelector('#v').play();return true;})()`);
  const other = await cdp.send('Target.createTarget', { url: 'about:blank' });
  await cdp.send('Target.activateTarget', { targetId: other.targetId });
  const background = await evaluate(cdp, `(async()=>{const v=document.querySelector('#v');const hidden=document.hidden;const t=v.currentTime;const start=performance.now();await new Promise(r=>setTimeout(r,1200));return {hidden,advance:v.currentTime-t,elapsed:(performance.now()-start)/1000,state:video5x.background.state()};})()`);
  assert.ok(background.advance > 4, JSON.stringify(background));
  assert.equal(background.state.real, 5); assert.equal(background.state.paused, false);
  await cdp.send('Target.closeTarget', { targetId: other.targetId });
  await cdp.send('Target.activateTarget', { targetId: target.id });

  // Fixture completion metadata changes only on a real native ended event.
  const autonext = await evaluate(cdp, `(async()=>{
    video5x.restore();
    let active='one',completed=false,clicks=0;
    const button=document.createElement('button');button.textContent='第二个测试视频';document.body.append(button);
    button.onclick=()=>{clicks++;active='two';const old=document.querySelector('#v');old.remove();const v=document.createElement('video');v.id='v';v.muted=true;v.preload='auto';v.src='/tone.wav';document.body.append(v);};
    const first=document.querySelector('#v');first.addEventListener('ended',()=>{completed=true;},{once:true});
    video5x.catalogue.register(()=>({ok:true,platform:'local-fixture',courseKey:'fixture-course',items:[
      {id:'one',title:'第一集',kind:'video',status:completed?'completed':'in_progress',active:active==='one',element:button},
      {id:'done',title:'已看',kind:'video',status:'completed',active:false,element:button},
      {id:'two',title:'未看',kind:'video',status:'not_started',active:active==='two',element:button}
    ]}));
    const started=video5x.autonext.enable();if(!started.enabled)throw Error(JSON.stringify(started));
    first.pause();await new Promise(resolve=>{first.addEventListener('seeked',resolve,{once:true});first.currentTime=first.duration-.8;});await first.play();
    const deadline=performance.now()+7500;
    while(performance.now()<deadline){const s=video5x.autonext.state();if(s.currentId==='two'&&s.phase==='watching')break;if(s.reason)throw Error(s.reason);await new Promise(r=>setTimeout(r,50));}
    const state=video5x.autonext.state(),v=document.querySelector('#v');const out={clicks,completed,state,real:v.playbackRate,paused:v.paused,firstTime:first.currentTime,firstEnded:first.ended,duration:first.duration,background:video5x.background.state()};
    video5x.stop();v.pause();video5x.dispose();button.remove();return out;
  })()`, 10000);
  assert.equal(autonext.clicks, 1, JSON.stringify(autonext)); assert.equal(autonext.completed, true);
  assert.equal(autonext.state.currentId, 'two'); assert.equal(autonext.real, 5); assert.equal(autonext.paused, false);

  // Local simulated Yuketang menu, with real native media setters and Vue-style accessors.
  await evaluate(cdp, `(()=>{
    document.body.innerHTML='<div class="xtplayer"><video></video><xt-speedbutton><li data-speed="2">2X</li><li data-speed="1.25" class="xt_video_player_common_active">1.25X</li></xt-speedbutton><xt-speedvalue>1.25X</xt-speedvalue></div>';
    const host=document.querySelector('.xtplayer'),v=host.querySelector('video');
    Object.defineProperty(v,'duration',{configurable:true,value:100});Object.defineProperty(v,'readyState',{configurable:true,value:4});v.playbackRate=1.25;
    const p={video:v,options:{isDrag:false,speed:{value:1.25}}};host.__vue__={$data:{player:p}};
    for(const [obj,key] of [[p.options,'isDrag'],[p.options.speed,'value']]){let value=obj[key];Object.defineProperty(obj,key,{enumerable:true,configurable:false,get(){return value;},set(next){value=next;}});}
    const cache=new WeakMap();const jq=el=>({data(k,x){if(arguments.length===2){jq.data(el,k,x);return this;}return jq.data(el,k)??Number(el.getAttribute('data-'+k));},removeData(k){delete(cache.get(el)||{})[k];}});
    jq.data=function(el,k,x){if(!cache.has(el))cache.set(el,{});if(arguments.length===3)cache.get(el)[k]=x;return cache.get(el)[k];};window.jQuery=jq;
    window.smoke={host,v,p,selected:1.25,before:host.innerHTML};
    for(const li of host.querySelectorAll('li'))li.addEventListener('click',()=>{if(li.classList.contains('xt_video_player_common_active'))return;const selected=jq(li).data('speed');smoke.selected=selected;p.options.speed.value=selected;v.playbackRate=selected;host.querySelector('xt-speedvalue').textContent=Number(selected).toFixed(2)+'X';for(const item of host.querySelectorAll('li'))item.classList.remove('xt_video_player_common_active');li.classList.add('xt_video_player_common_active');});return true;
  })()`);
  const yktInstall = `(()=>{const location=new URL('https://www.yuketang.cn/ai-workspace/lms-graph/fixture/video/fixture');return (${source});})()`;
  assert.equal((await evaluate(cdp, yktInstall)).ok, true);
  const yuketang = await evaluate(cdp, `(()=>{const a=video5x.apply(5),b=video5x.apply(4),r=video5x.restore();const {host,v,p}=smoke;const out={ok:a.ok&&b.ok&&r.ok,mode:a.mode,native:v.playbackRate,selected:smoke.selected,isDrag:p.options.isDrag,paused:v.paused,menuRestored:host.innerHTML===smoke.before};video5x.dispose();return out;})()`);
  assert.deepEqual(yuketang, { ok: true, mode: 'yuketang', native: 1.25, selected: 1.25, isDrag: false, paused: true, menuRestored: true });
  console.log(JSON.stringify({ browserSmoke: 'PASS', generic, actualMedia: measured.measure, background, autonext, yuketang }));
} finally {
  if (cdp) { try { await cdp.send('Browser.close', {}, 1000); } catch { /* browser closing */ } cdp.close(); }
  if (browser && browser.exitCode === null) {
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), wait(1500)]);
    if (browser.exitCode === null) browser.kill();
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (resolve(dirname(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('video-speed-smoke-')) throw new Error('Unexpected temporary directory; refusing cleanup');
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
