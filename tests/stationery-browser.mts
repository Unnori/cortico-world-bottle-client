/** Run with the shared web-access proxy: pnpm exec tsx tests/stationery-browser.mts. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import { pageHtml } from '../world/page-view.ts';
import type { PageSnapshot } from '../world/page.ts';
import type { MailboxTheme } from '../world/theme.ts';
import { checkStationery } from '../shared/stationery.ts';
import { doodleAsset } from '../world/stationery.ts';

const art=checkStationery({v:2,paper:'plain',paperColor:'#fff8ed',decorations:[
  {doodle:'rain-cloud',color:'#486b99',x:14,y:14,width:25,rotation:-12,opacity:.5},
  {doodle:'loose-daisy',color:'#c7788e',x:83,y:85,width:23,rotation:20,opacity:.6},
  {doodle:'paper-plane',color:'#7e9d85',placement:'center',width:65,rotation:10,opacity:.12},
  {customSvg:'<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#ad8855"/></svg>',x:95,y:8,width:12,opacity:.3,layer:'front',z:7,flipX:true},
]});
if(!art.ok||!art.value)throw Error('bad layout fixture');

const theme: MailboxTheme = { available: true, palettes: Object.values(BUILTIN_PALETTES)[0] };
const snapshot: PageSnapshot = {
  wake: { version: 1, day: '2026-11-13', lastInviteAt: 0, active: null, lanes: {
    write: { count: 0, dayLimit: 5, intervalHours: 4, nextAt: null, paused: false, declined: false, failed: false },
    catch: { count: 0, dayLimit: 2, nextAt: null, paused: false, declined: false, failed: false },
    remind: { count: 0, dayLimit: 3, nextAt: null, paused: false, declined: false, failed: false } },
    history: [] },
  botName: '小满', online: true, quota: { bottles_left: 2, catches_left: 5, replies_left: 0, stationery: 1 },
  draft: { kind: 'letter', body: '信稿正文', chars: 4, at: Date.now(), stationery: { v: 1, paper: 'grid', doodle: 'wave-line' } },
  held: null,
  received: [{
    letterId: 'with-decor', from: '灯塔', body: '带装饰的来信', at: '2026-11-13T10:00:00+08:00',
    outcome: 'replied', readCount: 1, myReply: '我的回信',
    stationery: { v: 1, paper: 'line', customSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#38566b"/></svg>' },
    myReplyStationery: { v: 1, paper: 'plain' }
  },{letterId:'layered',from:'海风',body:'把云朵放在左上角，\n把花留在落款旁。\n今天的风有一点颜色。',topic:'风的颜色',at:'2026-11-12T10:00:00+08:00',outcome:'replied',readCount:1,
    stationery:art.value,myReply:'夜里的纸也能看清。',myReplyStationery:{v:2,paper:'plain',paperColor:'#101827',decorations:art.value.decorations}}],
  sent: [],
};

const server = createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/fixture') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><body style="margin:0"><iframe id="mailbox" src="/" style="display:block;width:800px;height:1200px;border:0"></iframe>');
    return;
  }
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml(theme)); return; }
  if (req.url?.startsWith('/doodle/')) {
    const parts=req.url.slice(8).split('/');const asset=doodleAsset(parts[0],undefined,parts[1]?'#'+parts[1]:undefined);
    if (asset) {
      res.setHeader('content-type', 'image/svg+xml');
      res.end(asset.bytes);
      return;
    }
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(req.url === '/draft' ? snapshot : req.url === '/theme' ? theme : {}));
});

await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const port = (server.address() as { port: number }).port;
const proxy = 'http://localhost:3456';
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function rpc(path: string, body?: string) {
  const res = await fetch(proxy + path, { method: body === undefined ? 'GET' : 'POST', body });
  const data = await res.json() as any;
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}

let tab: string | undefined;
async function evaluate(code: string): Promise<any> { return (await rpc('/eval?target=' + tab, code)).value; }
async function inMailbox(code: string) {
  return evaluate("document.getElementById('mailbox').contentWindow.eval(" + JSON.stringify(code) + ")");
}
async function until(code: string) {
  for (let i = 0; i < 60; i++) {
    try { if (await inMailbox(code)) return; } catch { /* iframe navigation */ }
    await sleep(150);
  }
  throw new Error('Browser state did not settle: ' + code);
}

try {
  assert.equal((await rpc('/health')).connected, true);
  tab = (await rpc('/new', 'http://127.0.0.1:' + port + '/fixture')).targetId;
  await until("!!document.getElementById('letterbook')");
  await inMailbox("Object.defineProperty(document,'hidden',{value:false,configurable:true}); document.dispatchEvent(new Event('visibilitychange')); var style=document.createElement('style');style.textContent='*{animation:none!important;transition:none!important}';document.head.appendChild(style); true");

  // Draft card with grid paper and doodle
  await until("document.querySelector('.draft-card .letter-sheet')");
  const draftSheet = await inMailbox(`(()=>{
    var sheet=document.querySelector('.draft-card .letter-sheet');
    return {hasGridClass:sheet.classList.contains('paper-grid'),hasDecor:!!sheet.querySelector('.letter-decor'),hasDoodleImg:!!sheet.querySelector('.letter-doodle'),doodleSrc:sheet.querySelector('.letter-doodle')?.src};
  })()`);
  assert.equal(draftSheet.hasGridClass, true, 'draft: paper-grid class applied');
  assert.equal(draftSheet.hasDecor, true, 'draft: letter-decor container present');
  assert.equal(draftSheet.hasDoodleImg, true, 'draft: letter-doodle img present');
  assert.ok(draftSheet.doodleSrc?.includes('/doodle/wave-line'), 'draft: doodle route correct');

  // Received letter with line paper and custom SVG
  await inMailbox("document.querySelector('[data-category=received]').click(); document.querySelectorAll('.mail').forEach(n=>n.open=true); true");
  await until("document.querySelector('.mail[open] .letter-sheet')");
  const receivedSheet = await inMailbox(`(()=>{
    var sheets=document.querySelectorAll('.mail[open] .letter-sheet');
    var original=sheets[0],reply=sheets[1];
    return {
      originalLine:original.classList.contains('paper-line'),
      originalBlob:original.querySelector('.letter-doodle')?.src?.startsWith('blob:'),
      replyPlain:reply.classList.contains('paper-plain'),
      replyNoDecor:!reply.querySelector('.letter-decor')
    };
  })()`);
  assert.equal(receivedSheet.originalLine, true, 'received: paper-line class on original');
  assert.equal(receivedSheet.originalBlob, true, 'received: custom SVG as blob URL');
  assert.equal(receivedSheet.replyPlain, true, 'reply: paper-plain class');
  assert.equal(receivedSheet.replyNoDecor, true, 'reply: no doodle means no decor container');

  await until("Array.from(document.querySelectorAll('.letter-doodle')).every(img => img.complete && img.naturalWidth > 0)");
  await until("document.querySelectorAll('.layout-sheet').length===2 && Array.from(document.querySelectorAll('.letter-stamp img')).every(img=>img.complete&&img.naturalWidth>0)");
  const advanced=await inMailbox(`(()=>{
    var sheets=document.querySelectorAll('.layout-sheet'),s=sheets[0],d=s.querySelectorAll('.letter-stamp');
    return {drawings:d.length,behind:s.querySelector('.letter-decor-behind').children.length,front:s.querySelector('.letter-decor-front').children.length,
      frontOpacity:getComputedStyle(s.querySelector('.letter-decor-front')).opacity,
      behindZ:getComputedStyle(s.querySelector('.letter-decor-behind')).zIndex,copyZ:getComputedStyle(s.querySelector('.letter-copy')).zIndex,
      frontZ:getComputedStyle(s.querySelector('.letter-decor-front')).zIndex,
      pointer:getComputedStyle(s.querySelector('.letter-decor')).pointerEvents,clip:getComputedStyle(s.querySelector('.letter-decor')).overflow,
      lightInk:getComputedStyle(s).color,darkInk:getComputedStyle(sheets[1]).color,
      text:s.querySelector('.letter').textContent,position:[d[0].style.left,d[0].style.top,d[0].style.width],transform:d[0].style.transform,
      tinted:d[0].querySelector('img').src.includes('/rain-cloud/486b99'),ratio:d[0].offsetWidth/d[0].offsetHeight};
  })()`);
  assert.equal(advanced.drawings,4);assert.equal(advanced.behind,3);assert.equal(advanced.front,1);
  assert.equal(advanced.frontOpacity,'0.35');assert.equal(advanced.pointer,'none');assert.equal(advanced.clip,'hidden');
  assert.ok(+advanced.behindZ<+advanced.copyZ&&+advanced.copyZ<+advanced.frontZ);
  assert.deepEqual(advanced.position,['14%','14%','25%']);assert.ok(advanced.transform.includes('-12deg'));
  assert.equal(advanced.tinted,true);assert.ok(Math.abs(advanced.ratio-1)<.03);
  assert.equal(advanced.lightInk,'rgb(0, 0, 0)');assert.equal(advanced.darkInk,'rgb(255, 255, 255)');
  assert.equal(advanced.text,snapshot.received[1].body);
  const screenshots=resolve('../../artifacts/validation/bottle-090-layout-20261113');mkdirSync(screenshots,{recursive:true});
  for (const width of [320, 800, 1440]) {
    await evaluate("document.getElementById('mailbox').style.width=" + JSON.stringify(width + 'px'));
    await sleep(200);
    for(const mode of ['light','dark']) {
      await inMailbox("document.documentElement.dataset.appearance="+JSON.stringify(mode));
      const layout = await inMailbox('({width:innerWidth,content:document.documentElement.scrollWidth,clipped:Array.from(document.querySelectorAll(".letter-decor")).every(n=>n.offsetWidth<=n.parentElement.clientWidth+2)})');
      assert.ok(layout.content <= layout.width + 1, 'no horizontal overflow at ' + width+' '+mode);assert.equal(layout.clipped,true);
      if(width<1000){
        await inMailbox("document.querySelector('.layout-sheet').scrollIntoView({block:'start',behavior:'instant'});true");
        const shot=await fetch(proxy+'/screenshot?target='+tab);if(!shot.ok)throw Error('screenshot failed: '+await shot.text());
        writeFileSync(resolve(screenshots,'layout-'+width+'-'+mode+'.png'),Buffer.from(await shot.arrayBuffer()));
      }
    }
  }

  // A confirmed reply that can no longer be delivered remains readable, with only discard.
  snapshot.draft=null;
  snapshot.replyDraft={kind:'reply',body:'保留下来的未寄回信。',chars:11,hints:[],sendPolicy:'manual',sendFailure:'expired',draftId:'expired-reply',revision:2};
  await inMailbox("document.dispatchEvent(new Event('visibilitychange'));true");
  await until("document.querySelector('.draft-card')?.textContent.includes('补寄已停止')");
  const retained=await inMailbox("({body:document.querySelector('.draft-card .letter').textContent,buttons:Array.from(document.querySelectorAll('.draft-card button')).map(n=>n.textContent)})");
  assert.equal(retained.body,snapshot.replyDraft.body);
  assert.deepEqual(retained.buttons,['放弃这份未寄稿']);

  console.log('PASS: legacy and v2 layers, real tinted assets, SVG blobs, exact text, paper contrast, clipping and 320/800/1440px light/dark layout');
  process.exitCode = 0;
} catch (err) {
  console.error('FAIL:', err);
  process.exitCode = 1;
} finally {
  if (tab) await rpc('/close?target=' + encodeURIComponent(tab)).catch(() => {});
  await new Promise<void>(done => server.close(() => done()));
}
