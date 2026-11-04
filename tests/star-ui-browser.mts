/** Run web-access/check-deps.mjs first, then pnpm exec tsx tests/star-ui-browser.mts. Synthetic letters only. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import { pageHtml } from '../world/page-view.ts';
import type { PageSnapshot } from '../world/page.ts';

const snapshot: PageSnapshot = {
  botName: '小满', online: true, quota: { bottles_left: 3, catches_left: 3 }, draft: null,
  held: { letterId: 'received', from: '灯塔边的人', body: 'PRIVATE received body', topic: '海风里的一盏灯', hoursLeft: 72 },
  received: [{ letterId: 'received', from: '灯塔边的人', body: 'PRIVATE received body', topic: '海风里的一盏灯', at: '2026-11-04T09:00:00+08:00', outcome: 'caught' },
    { letterId: 'seed', from: '海边邮局', signature: '守灯人', seed: true, body: 'PRIVATE seed body', topic: '邮局寄来的长长长长长长长长长长长长长长标题', at: '2026-11-03T09:00:00+08:00', outcome: 'kept' }],
  sent: [{ letterId: 'sent', body: 'PRIVATE sent body', topic: '写给海风', at: '2026-11-02T09:00:00+08:00', state: 'replied',
    reply: { from: '晚归的人', body: 'PRIVATE reply body', at: '2026-11-04T10:00:00+08:00' } }],
  starMemoryEnabled: false,
  stars: [{ letterId: 'sent', starredAt: 1, category: 'sent', title: '写给海风', from: '小满', at: '2026-11-02T09:00:00+08:00', memorySelected: false, memoryActive: false },
    { letterId: 'sent', starredAt: 2, category: 'reply', title: '晚归的人的回信', from: '晚归的人', at: '2026-11-04T10:00:00+08:00', memorySelected: false, memoryActive: false },
    { letterId: 'seed', starredAt: 3, category: 'seed', title: '邮局寄来的长长长长长长长长长长长长长长标题', from: '守灯人', at: '2026-11-03T09:00:00+08:00', memorySelected: false, memoryActive: false }],
};
const calls: { path: string; payload: any }[] = [];
let failNext = false;
// The shared browser opens background tabs; keep only this synthetic document polling.
const instrumentation = `<script>Object.defineProperty(document,'hidden',{get:function(){return false}});window.__starErrors=[];window.addEventListener('error',function(e){window.__starErrors.push(e.message)});window.addEventListener('unhandledrejection',function(e){window.__starErrors.push(String(e.reason))});window.__starScrolls=[];var originalScroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){window.__starScrolls.push({key:this.dataset.foldKey,options:options});originalScroll.call(this,options)};</script>`;
const server = createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/fixture') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><body style="margin:0"><iframe id="mailbox" src="/" style="width:1040px;height:1000px;display:block;border:0"></iframe>'); return; }
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml({ available: true, palettes: Object.values(BUILTIN_PALETTES)[0] }).replace('<head>', '<head>' + instrumentation)); return; }
  if (req.url === '/icon.png') { res.setHeader('content-type', 'image/png'); res.end(readFileSync(resolve('world/icon.png'))); return; }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/draft') { res.end(JSON.stringify(snapshot)); return; }
  if (req.url === '/sounds') { res.end(JSON.stringify({ files: [] })); return; }
  if (req.method === 'POST' && ['/star', '/star-memory', '/star-memory-setting'].includes(req.url || '')) {
    assert.equal(req.headers['x-bottle'], '1');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw); calls.push({ path: req.url!, payload });
    assert.equal(raw.includes('PRIVATE'), false);
    if (failNext) { failNext = false; res.end(JSON.stringify({ ok: false, message: '测试保存失败' })); return; }
    if (req.url === '/star-memory-setting') {
      snapshot.starMemoryEnabled = payload.enabled;
      if (!payload.enabled) snapshot.stars!.forEach(row => { row.memorySelected = false; row.memoryActive = false; });
    } else if (req.url === '/star-memory') {
      snapshot.stars!.filter(row => row.letterId === payload.letterId).forEach(row => { row.memorySelected = payload.enabled; row.memoryActive = payload.enabled; });
    } else {
      snapshot.stars = snapshot.stars!.filter(row => row.letterId !== payload.letterId);
      if (payload.starred) snapshot.stars.push({ letterId: payload.letterId, starredAt: Date.now(), category: 'received', title: '海风里的一盏灯', from: '灯塔边的人', at: '2026-11-04T09:00:00+08:00', memorySelected: false, memoryActive: false });
    }
    res.end(JSON.stringify({ ok: true })); return;
  }
  res.end(JSON.stringify({ ok: true }));
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const port = (server.address() as { port: number }).port;
let tab: string | undefined;
async function rpc(path: string, body?: string) {
  const response = await fetch('http://localhost:3456' + path, { method: body === undefined ? 'GET' : 'POST', body });
  const data = await response.json() as any;
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}
async function evaluate(code: string) { return (await rpc('/eval?target=' + tab, code)).value; }
async function mailbox(code: string) { return evaluate('document.getElementById("mailbox").contentWindow.eval(' + JSON.stringify(code) + ')'); }
async function until(code: string) {
  for (let i = 0; i < 60; i++) { if (await mailbox(code)) return; await new Promise(done => setTimeout(done, 150)); }
  throw new Error('Browser state did not settle: ' + code + '\n' + JSON.stringify(await mailbox('window.__starErrors')));
}
const output = resolve('../../scratch/bottle-stars');
mkdirSync(output, { recursive: true });
try {
  assert.equal((await rpc('/health')).connected, true);
  tab = (await rpc('/new', 'http://127.0.0.1:' + port + '/fixture')).targetId;
  await until('!!document.querySelector("#stage .letter-star")');
  await mailbox(`document.getElementById('letterbook').open=true;document.querySelector('[data-category=received]').click();document.querySelector('#mail-list .letter-star').click();true`);
  await until(`document.querySelector('#mail-list .letter-star').getAttribute('aria-pressed')==='true'`);
  assert.equal(await mailbox(`document.querySelector('#mail-list .mail').open`), false, 'Star must not toggle the containing summary');
  assert.equal(await mailbox(`document.querySelector('#stage .letter-star').getAttribute('aria-pressed')`), 'true', 'Held and archived mail share the star');
  assert.deepEqual(calls[0], { path: '/star', payload: { letterId: 'received', starred: true } });
  // Every real archive renderer gets a working button; sent and reply share one flag.
  for (const folder of ['received', 'seed', 'sent', 'reply']) {
    await mailbox(`document.querySelector('[data-category=${folder}]').click();true`);
    assert.equal(await mailbox(`document.querySelector('#mail-list .letter-star').getAttribute('aria-pressed')`), 'true', folder + ': star accessible while collapsed');
    await mailbox(`document.querySelector('#mail-list .letter-star').click();true`);
    await until(`document.querySelector('#mail-list .letter-star').getAttribute('aria-pressed')==='false'`);
    assert.equal(await mailbox(`document.querySelector('#mail-list .mail').open`), false, folder + ': clicking star must keep mail collapsed');
    await mailbox(`document.querySelector('#mail-list .letter-star').click();true`);
    await until(`document.querySelector('#mail-list .letter-star').getAttribute('aria-pressed')==='true'`);
    const id = folder === 'received' ? 'received' : folder === 'seed' ? 'seed' : 'sent';
    assert.deepEqual(calls.slice(-2), [{ path: '/star', payload: { letterId: id, starred: false } }, { path: '/star', payload: { letterId: id, starred: true } }]);
  }
  await mailbox(`document.querySelector('#stage .letter-star').click();true`);
  await until(`document.querySelector('#stage .letter-star').getAttribute('aria-pressed')==='false'`);
  await mailbox(`document.querySelector('#stage .letter-star').click();true`);
  await until(`document.querySelector('#stage .letter-star').getAttribute('aria-pressed')==='true'`);
  // Recreate both metadata entries to exercise UI dedup even with duplicate snapshot rows.
  snapshot.stars = [
    { letterId: 'sent', starredAt: 1, category: 'sent', title: '写给海风', from: '小满', at: '2026-11-02T09:00:00+08:00', memorySelected: false, memoryActive: false },
    { letterId: 'sent', starredAt: 2, category: 'reply', title: '晚归的人的回信', from: '晚归的人', at: '2026-11-04T10:00:00+08:00', memorySelected: false, memoryActive: false },
    { letterId: 'seed', starredAt: 3, category: 'seed', title: '邮局寄来的长长长长长长长长长长长长长长标题', from: '守灯人', at: '2026-11-03T09:00:00+08:00', memorySelected: false, memoryActive: false },
    { letterId: 'received', starredAt: 4, category: 'received', title: '海风里的一盏灯', from: '灯塔边的人', at: '2026-11-04T09:00:00+08:00', memorySelected: false, memoryActive: false },
  ];
  await mailbox(`document.dispatchEvent(new Event('visibilitychange'));true`);
  await mailbox(`document.querySelector('[data-category=stars]').click();true`);
  await until(`document.querySelectorAll('.star-row').length===3&&Array.from(document.querySelectorAll('.star-open')).some(n=>n.textContent.includes('晚归'))`);
  assert.equal(await mailbox(`document.getElementById('stars-count').textContent`), '3');
  assert.equal(await mailbox(`document.querySelectorAll('.star-row').length`), 3);
  assert.equal(await mailbox(`Array.from(document.querySelectorAll('.star-memory-choice input')).every(n=>n.disabled&&!n.checked)`), true);
  assert.equal(await mailbox(`document.querySelector('.star-memory-choice label').textContent`), '让小满记住');
  assert.equal(await mailbox(`document.querySelector('.star-memory-privacy').textContent.includes('不会撤回已经进入对话上下文或摘要的内容')`), true);
  await mailbox(`document.querySelector('.star-memory-global input').click();true`);
  await until(`Array.from(document.querySelectorAll('.star-memory-choice input')).every(n=>!n.disabled)`);
  failNext = true;
  await mailbox(`document.querySelector('.star-memory-choice input').click();true`);
  await until(`!document.querySelector('.star-memory-choice input').disabled&&document.getElementById('toast').textContent==='测试保存失败'`);
  assert.equal(await mailbox(`document.querySelector('.star-memory-choice input').checked`), false);
  await mailbox(`document.querySelector('.star-memory-choice input').click();true`);
  await until(`document.querySelector('.star-memory-choice input').checked`);
  assert.equal(await mailbox(`document.querySelector('.star-memory-choice').textContent.includes('记忆已生效')`), true);
  await mailbox(`document.querySelector('.star-memory-global input').click();true`);
  await until(`Array.from(document.querySelectorAll('.star-memory-choice input')).every(n=>n.disabled&&!n.checked)`);
  assert.equal(snapshot.stars!.some(row => row.memorySelected), false, 'Global off clears selections');
  await mailbox(`document.getElementById('letter-date').value='1999-01-01';Array.from(document.querySelectorAll('.star-open')).find(n=>n.textContent.includes('晚归')).click();true`);
  assert.equal(await mailbox(`document.getElementById('letter-date').value`), '');
  assert.equal(await mailbox(`document.querySelector('[data-category=reply]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await mailbox(`document.querySelector('#mail-list .mail').open`), true);
  assert.deepEqual(await mailbox(`window.__starScrolls.slice(-1)[0]`), { key: 'reply:sent', options: { block: 'center', inline: 'nearest', behavior: 'smooth' } });
  for (const theme of ['ocean', 'paper', 'coopanion', 'custom']) {
    for (const mode of ['light', 'dark']) {
      await mailbox(`document.getElementById('theme-${theme}').click();document.getElementById('mode-${mode}').click();true`);
      for (const width of [1040, 390, 320]) {
        await evaluate(`document.getElementById('mailbox').style.width='${width}px';true`);
        await mailbox(`document.querySelector('[data-category=stars]').click();document.getElementById('letterbook').scrollIntoView();true`);
        assert.equal(await mailbox(`document.documentElement.scrollWidth<=window.innerWidth`), true, `${theme}/${mode}/${width}: overflow`);
        assert.equal(await mailbox(`Array.from(document.querySelectorAll('.star-memory-choice input')).every(n=>{var r=n.getBoundingClientRect();return r.width>=22&&r.height>=22})`), true, 'Checkboxes must remain obvious');
        const colors = await mailbox(`({fill:getComputedStyle(document.querySelector('.star-row .star-icon')).fill,gold:getComputedStyle(document.body).getPropertyValue('--star-gold').trim()})`);
        assert.equal(colors.fill, mode === 'dark' ? 'rgb(239, 195, 93)' : 'rgb(172, 120, 11)', `${theme}/${mode}: gold fill`);
      }
    }
  }
  await evaluate(`document.getElementById('mailbox').style.width='390px';true`);
  await mailbox(`document.getElementById('theme-ocean').click();document.getElementById('mode-light').click();document.getElementById('letterbook').scrollIntoView();true`);
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'stars-mobile.png')));
  await evaluate(`document.getElementById('mailbox').style.width='1040px';true`);
  await mailbox(`document.getElementById('mode-dark').click();document.getElementById('letterbook').scrollIntoView();true`);
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'stars-dark.png')));
  assert.deepEqual(await mailbox('window.__starErrors'), []);
  assert.equal(calls.every(call => Object.keys(call.payload).every(key => ['letterId', 'enabled', 'starred'].includes(key))), true);
  console.log('PASS: actual protected API wrapper; received/seed/sent/reply/held star buttons; shared flag; dedup; summary stays collapsed; global/per-letter controls; context warning; failure recovery; global off clears selections; reply jump centred; all 8 theme/mode combinations at 1040/390/320px; gold SVG; no body in star requests; no browser errors.');
  console.log('Screenshots: ' + output);
} finally {
  if (tab) await rpc('/close?target=' + tab).catch(() => {});
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
}
