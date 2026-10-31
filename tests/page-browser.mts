/** 本机浏览器回归：先运行 web-access/check-deps.mjs，再 pnpm exec tsx tests/page-browser.mts。 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pageHtml } from '../world/page-view.ts';
import type { PageSnapshot } from '../world/page.ts';

const snapshot: PageSnapshot = {
  botName: '小满', online: true, quota: { bottles_left: 5, catches_left: 3, replies_left: 2 },
  draft: { kind: 'reply', letterId: 'r1', body: '希望你明天也有一片晴天。', chars: 14, hints: [] },
  replyDraft: { kind: 'reply', topic: '不应显示的旧回信标题', letterId: 'r1', body: '希望你明天也有一片晴天。', chars: 14, hints: [] },
  letterDraft: { kind: 'letter', topic: '晚风写进信里', body: '傍晚的风吹进窗子，像一封没有写字的信。', chars: 21, hints: [] },
  held: { topic: '绕路遇见晚霞', letterId: 'r1', from: '沿岸散步的人', body: '今天绕了远路，却看见了很好看的晚霞。', hoursLeft: 72 },
  sent: [
    { letterId: 's1', topic: '原信的独立标题', body: '把一小块晴天寄给你。', at: '2026-10-29T09:00:00+08:00', state: 'replied', reply: { from: '窗边的猫', body: '收到了，也分给你一点暖意。', at: '2026-10-31T15:30:00+08:00' } },
    { letterId: 's2', body: '海风带来了桂花香。', at: '2026-10-30T17:00:00+08:00', state: 'drifting' },
  ],
  received: [
    { letterId: 'r1', from: '沿岸散步的人', body: '今天绕了远路，却看见了很好看的晚霞。', at: '2026-10-31T09:00:00+08:00', outcome: 'caught' },
    { letterId: 'seed1', from: '海边邮局', body: '灯塔的灯一夜没熄，守灯人说，是在等一封信。', topic: '凌晨四点的灯塔', signature: '守灯人', seed: true, at: '2026-10-31T12:00:00+08:00', outcome: 'kept' },
    { letterId: 'r2', from: '海边邮局', body: '<script>window.bad = true</script>', at: '2026-10-31T18:00:00+08:00', outcome: 'replied', myReply: '这封信来自海上来客，署名不代表它经由邮局寄来。' },
    { letterId: 'r3', from: '晚归的人', body: '今天终于赶上了末班车。', at: '2026-10-28T08:00:00+08:00', outcome: 'kept' },
  ],
};
const calls: string[] = [];
const server = createServer((req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml()); return; }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/draft') { res.end(JSON.stringify(snapshot)); return; }
  if (req.method === 'POST') calls.push(req.url || '');
  res.end(JSON.stringify({ ok: true, message: '小满收到了。' }));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const port = (server.address() as { port: number }).port;
const proxy = 'http://localhost:3456';
const tabIds: string[] = [];
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function rpc(path: string, body?: string) {
  const response = await fetch(proxy + path, { method: body === undefined ? 'GET' : 'POST', body });
  const data = await response.json() as any;
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}
async function evaluate(tab: string, code: string) { return (await rpc('/eval?target=' + tab, code)).value; }
async function until(test: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) { if (await test()) return; await sleep(250); }
  throw new Error('Browser state did not settle');
}
try {
  assert.equal((await rpc('/health')).connected, true, 'Run web-access check-deps first');
  const tab = (await rpc('/new', 'http://127.0.0.1:' + port + '/')).targetId;
  tabIds.push(tab);
  await until(() => evaluate(tab, "!!document.querySelector('.original')"));
  assert.equal(await evaluate(tab, "document.querySelector('.draft-card[data-kind=letter] .title').textContent"), '晚风写进信里');
  assert.equal(await evaluate(tab, "document.querySelector('.draft-card[data-kind=reply] .title').textContent"), '回信');
  assert.equal(await evaluate(tab, "document.querySelector('.draft-card[data-kind=reply]').textContent.includes('不应显示的旧回信标题')"), false);
  assert.equal(await evaluate(tab, "document.querySelector('.draft-card[data-kind=letter] .eyebrow').textContent"), '信稿 · 尚未寄出');
  assert.equal(await evaluate(tab, "!/真实用户|用户来信|用户回信|种子瓶/.test(document.body.innerText)"), true);
  snapshot.letterDraft!.topic = '只有标题改了';
  await until(() => evaluate(tab, "document.querySelector('.draft-card[data-kind=letter] .title').textContent==='只有标题改了'"));
  snapshot.letterDraft!.topic = undefined;
  await until(() => evaluate(tab, "document.querySelector('.draft-card[data-kind=letter] .title').textContent==='无题信'"));
  snapshot.letterDraft!.topic = '<img src=x>';
  await until(() => evaluate(tab, "document.querySelector('.draft-card[data-kind=letter] .title').textContent==='<img src=x>'"));
  assert.equal(await evaluate(tab, "document.querySelectorAll('.draft-card .title img').length"), 0);
  snapshot.letterDraft!.topic = '晚风写进信里';
  await until(() => evaluate(tab, "document.querySelector('.draft-card[data-kind=letter] .title').textContent==='晚风写进信里'"));

  assert.equal(await evaluate(tab, "document.getElementById('hero-note').textContent.includes('小满')"), true);
  await evaluate(tab, `document.getElementById('letterbook').open=true; document.querySelector('[data-category=received]').click(); document.querySelector('.original summary').click(); window.originalNode=document.querySelector('.original'); true`);
  await sleep(3200);
  assert.equal(await evaluate(tab, "document.querySelector('.original')===window.originalNode && window.originalNode.open"), true, 'Unchanged polls must retain the original DOM');
  snapshot.quota!.bottles_left = 4;
  await until(() => evaluate(tab, "document.querySelector('.original')!==window.originalNode"));
  assert.equal(await evaluate(tab, "document.querySelector('.original').open"), true, 'Changing quota must not collapse the original');
  assert.equal(await evaluate(tab, "document.querySelectorAll('#mail-list .mail').length"), 3);
  assert.equal(await evaluate(tab, "document.querySelectorAll('#mail-list .day-group').length"), 2);
  assert.equal(await evaluate(tab, "document.getElementById('book-count').textContent"), '收到 5 封 · 寄出 2 封');
  assert.equal(await evaluate(tab, "!/\\d{1,2}:\\d{2}/.test(document.getElementById('mail-list').textContent)"), true);
  assert.equal(await evaluate(tab, "document.querySelectorAll('#mail-list script').length"), 0);
  await evaluate(tab, "document.querySelector('[data-category=seed]').click(); true");
  assert.equal(await evaluate(tab, "document.querySelectorAll('#mail-list .mail').length"), 1);
  assert.equal(await evaluate(tab, "document.getElementById('mail-list').textContent.includes('海边邮局 · 守灯人')"), true);
  assert.equal(await evaluate(tab, "document.querySelector('#mail-list summary .mail-subject small').textContent"), '海边邮局 · 守灯人');
  await evaluate(tab, "document.querySelector('[data-category=sent]').click(); true");
  assert.equal(await evaluate(tab, "document.querySelectorAll('#mail-list summary .mail-status').length"), 2);
  assert.equal(await evaluate(tab, "document.querySelector('#mail-list summary .status-replied').textContent"), '收到回信');
  assert.equal(await evaluate(tab, "document.querySelector('#mail-list summary .status-drifting').textContent"), '还在漂');
  const green = await evaluate(tab, "getComputedStyle(document.querySelector('#mail-list summary .status-replied')).color");
  snapshot.sent[1].state = 'picked';
  await until(() => evaluate(tab, "!!document.querySelector('#mail-list summary .status-picked')"));
  assert.notEqual(await evaluate(tab, "getComputedStyle(document.querySelector('#mail-list summary .status-picked')).color"), green);
  snapshot.sent[1].state = 'tsunami';
  await until(() => evaluate(tab, "!!document.querySelector('#mail-list summary .status-tsunami')"));
  snapshot.sent[1].state = 'sunk';
  await until(() => evaluate(tab, "!!document.querySelector('#mail-list summary .status-sunk')"));
  snapshot.sent[1].state = 'drifting';
  await evaluate(tab, "document.querySelector('[data-category=reply]').click(); true");
  assert.equal(await evaluate(tab, "document.querySelector('#mail-list summary strong').textContent"), '窗边的猫的回信');
  assert.equal(await evaluate(tab, "document.querySelectorAll('#mail-list .mail-body > .mail-topic').length"), 0);

  await evaluate(tab, "document.querySelector('[data-category=received]').click(); document.getElementById('letter-date').value='2026-10-31'; document.getElementById('letter-date').dispatchEvent(new Event('change')); true");
  assert.equal(await evaluate(tab, "document.querySelectorAll('#mail-list .mail').length"), 2);
  await evaluate(tab, "document.getElementById('clear-date').click(); document.querySelector('#letterbook > summary').click(); true");
  snapshot.quota!.bottles_left = 3;
  await sleep(3200);
  assert.equal(await evaluate(tab, "document.getElementById('letterbook').open"), false);
  await evaluate(tab, "document.querySelector('#letterbook > summary').click(); document.querySelector('#mail-list summary').click(); true");
  const outputDir = resolve('../../scratch/bottle-immersion');
  mkdirSync(outputDir, { recursive: true });
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(outputDir, 'desktop.png')));
  const mobile = (await rpc('/new', 'http://127.0.0.1:' + port + '/')).targetId;
  tabIds.push(mobile);
  await evaluate(mobile, "var frame=document.createElement('iframe'); frame.src='/'; frame.style.cssText='width:390px;height:1100px;display:block;border:0;margin:auto'; document.body.replaceChildren(frame); true");
  await until(() => evaluate(mobile, "!!document.querySelector('iframe').contentDocument.querySelector('.original')"));
  assert.equal(await evaluate(mobile, "(()=>{var f=document.querySelector('iframe');return f.contentDocument.documentElement.scrollWidth<=f.contentWindow.innerWidth;})()"), true, 'Mobile overflow');
  snapshot.letterDraft!.topic = '潮'.repeat(20);
  await until(() => evaluate(mobile, "document.querySelector('iframe').contentDocument.querySelector('.draft-card[data-kind=letter] .title').textContent==='潮'.repeat(20)"));
  assert.equal(await evaluate(mobile, "(()=>{var d=document.querySelector('iframe').contentDocument;var title=d.querySelector('.draft-card[data-kind=letter] .title');var card=title.closest('.card');return title.getBoundingClientRect().right<=card.getBoundingClientRect().right && d.documentElement.scrollWidth<=390;})()"), true, 'Long title must stay inside the mobile draft');
  snapshot.letterDraft!.topic = '晚风写进信里';
  await until(() => evaluate(mobile, "document.querySelector('iframe').contentDocument.querySelector('.draft-card[data-kind=letter] .title').textContent==='晚风写进信里'"));

  await rpc('/screenshot?target=' + mobile + '&file=' + encodeURIComponent(resolve(outputDir, 'mobile.png')));
  snapshot.held = null; snapshot.draft = null; snapshot.letterDraft = null; snapshot.replyDraft = null;
  await until(() => evaluate(tab, "!document.getElementById('write-button').disabled && !document.getElementById('catch-button').disabled"));
  await evaluate(tab, "document.querySelectorAll('#mail-list details[open]').forEach(n=>n.open=false); window.scrollTo(0,0); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(outputDir, 'overview.png')));
  await evaluate(mobile, "(()=>{var d=document.querySelector('iframe').contentDocument;d.querySelector('[data-category=seed]').click();d.getElementById('letterbook').scrollIntoView();})()");
  assert.equal(await evaluate(mobile, "document.querySelector('iframe').contentDocument.querySelectorAll('#mail-list .seed').length"), 1);
  await rpc('/screenshot?target=' + mobile + '&file=' + encodeURIComponent(resolve(outputDir, 'mobile-mailbox.png')));
  await evaluate(tab, "document.getElementById('write-button').click(); true");
  await until(async () => calls.includes('/write'));
  await until(() => evaluate(tab, "!document.getElementById('write-button').disabled"));
  assert.equal(await evaluate(tab, "!!document.querySelector('#write-button svg')"), true, 'Action must preserve icon');
  await evaluate(tab, "document.getElementById('catch-button').click(); true");
  await until(async () => calls.includes('/catch'));
  snapshot.botName = '<img src=x onerror=alert(1)>';
  await until(() => evaluate(tab, "document.getElementById('hero-note').textContent.includes('<img')"));
  assert.equal(await evaluate(tab, "document.querySelectorAll('#hero-note img').length"), 0);
  console.log('PASS: seed signatures, collapsed colored sent statuses, title-free reply drafts and list, title-only refresh, legacy fallback, literal HTML title, long mobile title, immersive source labels; original stays open on unchanged and changed polls; 4 source folders; date-only grouping/filter; collapsed total; literal text; dynamic botName; action icons; desktop and 390px layout.');
  console.log('Screenshots: ' + outputDir);
} finally {
  for (const id of tabIds) await rpc('/close?target=' + id).catch(() => undefined);
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}
