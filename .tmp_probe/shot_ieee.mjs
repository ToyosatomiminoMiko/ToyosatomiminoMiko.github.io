import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const ROOT='/mnt/IVSTINIANVS/ToyosatomiminoMiko.github.io', DIST=join(ROOT,'dist');
const PORT=8809, CDP_PORT=9729, PROFILE=join(tmpdir(),'shot-ieee-profile');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.gif':'image/gif','.ico':'image/x-icon','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
const srv=createServer(async(req,res)=>{try{const url=new URL(req.url,`http://127.0.0.1:${PORT}`);const rel=normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/,'');const file=join(DIST,rel==='/'?'index.html':rel);if(!file.startsWith(DIST)){res.writeHead(403).end('forbidden');return;}const body=await readFile(file);res.writeHead(200,{'content-type':MIME[extname(file)]??'application/octet-stream'});res.end(body);}catch{if(!res.headersSent){try{res.writeHead(404).end('not found');}catch{}}}});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
rmSync(PROFILE,{recursive:true,force:true});
const chrome=spawn('chromium-browser',['--headless=new',`--remote-debugging-port=${CDP_PORT}`,'--remote-allow-origins=*','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${PROFILE}`,'--no-first-run','--window-size=1400,760','--force-device-scale-factor=1','about:blank'],{stdio:['ignore','ignore','ignore']});
for(let i=0;i<80;i++){try{await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();break;}catch{await sleep(250);}}
const list=await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page=list.find(t=>t.type==='page');
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const pending=new Map();
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)return 'ERR '+JSON.stringify(r.result.exceptionDetails.text);return r.result?.result?.value;};
await send('Page.enable');await send('Runtime.enable');
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/`});
await sleep(2500);
console.log('before open:', JSON.stringify(await ev(`(() => {
  const t = document.querySelector('#ieee-format');
  return { triggerHasCode: t.querySelector('code') !== null, text: t.textContent,
    groupTitles: document.querySelectorAll('.menu-group-title').length,
    groupAria: (document.querySelector('.menu-group')||{}).getAttribute ? document.querySelector('.menu-group').getAttribute('aria-label') : null };
})()`)));
await ev(`document.querySelector('a[href="#ieee754"]').click()`);
await sleep(500);
await ev(`document.querySelector('#ieee-format').click()`);
await sleep(400);
const shot=await send('Page.captureScreenshot',{format:'png'});
await writeFile(join(ROOT,'.tmp_probe','ieee_menu.png'),Buffer.from(shot.result.data,'base64'));
// 切到第一项(单精度),看按钮里的 <code> 还在不在
console.log('after switch:', JSON.stringify(await ev(`(async () => {
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.querySelectorAll('.menu-anchor .menu-item')[0].click();
  await nextFrame();
  const t = document.querySelector('#ieee-format');
  return { text: t.textContent, hasCode: t.querySelector('code') !== null, codeText: t.querySelector('code') ? t.querySelector('code').textContent : null };
})()`)));
const shot2=await send('Page.captureScreenshot',{format:'png'});
await writeFile(join(ROOT,'.tmp_probe','ieee_after.png'),Buffer.from(shot2.result.data,'base64'));
ws.close();chrome.kill();srv.close();
console.log('saved');
