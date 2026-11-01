/** Run with the shared web-access proxy: pnpm exec tsx tests/page-letter-layout-browser.mts. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import { pageHtml } from '../world/page-view.ts';
import type { PageSnapshot } from '../world/page.ts';
import type { MailboxTheme } from '../world/theme.ts';

const theme: MailboxTheme = { available: true, palettes: Object.values(BUILTIN_PALETTES)[0] };
const body = '第一行留给海风。\nhttps://example.test/' + 'a'.repeat(85) + '\n最后一行保留原来的换行。';
const snapshot: PageSnapshot = {
  botName: '小满', online: true, quota: { bottles_left: 2, catches_left: 5, replies_left: 0 },
  draft: null, held: null, received: [{ letterId: 'caught', from: '灯塔边的人', topic: '来自灯塔的一封信',
    body, at: '2026-11-01T10:00:00+08:00', outcome: 'replied', myReply: '回信第一行。\n回信第二行。' }],
  sent: [{ letterId: 'sent', topic: '给远方留一点灯光', body, at: '2026-11-01T10:00:00+08:00', state: 'replied',
    reply: { from: '海边的旅人', body: '收到你的信了。\n愿你今晚好梦。', at: '2026-11-01T11:00:00+08:00' } }],
};
const server = createServer((req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/fixture') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><body style="margin:0"><iframe id="mailbox" src="/" style="display:block;width:1040px;height:1800px;border:0"></iframe>'); return;
  }
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml(theme)); return; }
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
  for (let i = 0; i < 60; i++) { if (await inMailbox(code)) return; await sleep(150); }
  throw new Error('Browser state did not settle: ' + code);
}
try {
  assert.equal((await rpc('/health')).connected, true);
  tab = (await rpc('/new', 'http://127.0.0.1:' + port + '/fixture')).targetId;
  await until("!!document.getElementById('letterbook')");
  // Only the fixture simulates visibility; never focus or alter the user's tabs.
  await inMailbox("Object.defineProperty(document,'hidden',{value:false,configurable:true}); document.dispatchEvent(new Event('visibilitychange')); var style=document.createElement('style');style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.appendChild(style); true");
  await until("document.getElementById('hero-note').textContent.includes('小满')");
  for (const width of [1040, 390]) {
    await evaluate(`document.getElementById('mailbox').style.width='${width}px'; true`);
    for (const palette of ['ocean', 'paper', 'coopanion']) {
      for (const mode of ['light', 'dark']) {
        await inMailbox(`document.getElementById('theme-${palette}').click(); document.getElementById('mode-${mode}').click(); true`);
        for (const category of ['reply', 'received', 'sent']) {
          await inMailbox(`document.querySelector('[data-category=${category}]').click(); document.querySelectorAll('.mail').forEach(n=>n.open=true); true`);
          const metrics = await inMailbox(`(()=>{
            var mail=document.querySelector('.mail'),body=mail.querySelector('.mail-body'),style=getComputedStyle(body),box=body.getBoundingClientRect();
            var inside=Array.from(body.querySelectorAll('.head,.letter,.reply-quote,.mail-foot')).every(n=>{var r=n.getBoundingClientRect();return r.left>=box.left+parseFloat(style.paddingLeft)-1&&r.right<=box.right-parseFloat(style.paddingRight)+1;});
            var letter=body.querySelector('.letter');
            return {paddingLeft:parseFloat(style.paddingLeft),paddingRight:parseFloat(style.paddingRight),paddingBottom:parseFloat(style.paddingBottom),border:style.borderTopStyle,inside,overflow:document.documentElement.scrollWidth>innerWidth,whiteSpace:getComputedStyle(letter).whiteSpace,text:letter.textContent,footer:body.querySelector('.mail-foot').getBoundingClientRect().bottom<=box.bottom-parseFloat(style.paddingBottom)+1};
          })()`);
          const label = `${width}px ${palette}/${mode} ${category}`;
          assert.equal(metrics.paddingLeft, width > 560 ? 24 : 16, label + ': inset');
          assert.equal(metrics.paddingRight, metrics.paddingLeft, label + ': equal insets');
          assert.equal(metrics.paddingBottom, width > 560 ? 22 : 18, label + ': footer spacing');
          assert.equal(metrics.border, 'dashed', label + ': body separator');
          assert.equal(metrics.inside, true, label + ': letter, quote and controls stay inside');
          assert.equal(metrics.footer, true, label + ': footer stays inside');
          assert.equal(metrics.overflow, false, label + ': no horizontal overflow');
          assert.equal(metrics.whiteSpace, 'pre-wrap', label + ': preserve line breaks');
          assert.ok(metrics.text.includes('\n'), label + ': original line breaks remain');
        }
        console.log(`PASS: ${width}px ${palette}/${mode}, replies/received/sent with multiline text and long URL`);
      }
    }
  }
  const output = resolve('../../scratch/bottle-letter-layout');
  mkdirSync(output, { recursive: true });
  await inMailbox("document.getElementById('theme-ocean').click(); document.getElementById('mode-light').click(); document.querySelector('[data-category=reply]').click(); document.querySelector('.mail').open=true; document.querySelector('.mail').scrollIntoView({block:'start'}); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'mobile.png')));
  await evaluate("document.getElementById('mailbox').style.width='1040px'; true");
  await inMailbox("document.querySelector('.mail').scrollIntoView({block:'start'}); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'desktop.png')));
} finally {
  if (tab) await rpc('/close?target=' + tab).catch(() => undefined);
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
}
