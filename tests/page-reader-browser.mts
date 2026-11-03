/** Synthetic mailbox only, via the shared web-access proxy. No live pet data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import { pageHtml, pageHandler, type PageSnapshot, type PageDeps } from '../world/page.ts';
import { LetterFonts } from '../world/fonts.ts';

const directory = mkdtempSync(join(tmpdir(), 'bottle-reader-browser-'));
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
writeFileSync(join(directory, 'bottle-font-map.json'), JSON.stringify({ version: 1, assignments: {
  [hash('seed:短街开铺子的')]: 'Yozai-Regular.ttf',
  [hash('visitor:海风')]: 'LXGWWenKaiMono-Medium.ttf',
} }));
const text = '今天开门的时候，风把门口的小铃铛吹响了。\n\n要是你正好路过，进来坐坐吧。\n' + 'longword'.repeat(30);
const snapshot: PageSnapshot = {
  draft: null, held: { letterId: 'seed-held', seed: true, from: '海边邮局', signature: '短街开铺子的', topic: '门口的小铃铛', body: text, hoursLeft: 12 },
  received: [{ letterId: 'seed-kept', seed: true, from: '海边邮局', signature: '短街开铺子的', topic: '一盏灯', body: text, at: new Date().toISOString(), outcome: 'kept' },
    { letterId: 'ordinary', from: '海风', topic: '海风来信', body: text, myReply: '下回再聊。', outcome: 'replied', at: new Date().toISOString() }],
  sent: [{ letterId: 'own', topic: '小满的信', body: text, at: new Date().toISOString(), state: 'replied', reply: { from: '海风', body: text, at: new Date().toISOString() } }],
  online: true, quota: { bottles_left: 2, catches_left: 2, replies_left: 2 }, botName: '小满',
};
const fonts = new LetterFonts(directory), ok = async () => ({ ok: true });
const theme = { available: true as const, palettes: Object.values(BUILTIN_PALETTES)[0] };
const deps: PageDeps = { snapshot: () => fonts.decorate(snapshot), theme: async () => theme, request: ok, send: ok, rewrite: ok, dismiss: ok, keep: ok, peruse: ok, discard: ok, open: ok, forget: ok };
const handler = pageHandler(deps);
const server = createServer((req, res) => {
  if (req.url === '/fixture') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><body style="margin:0"><iframe id="mailbox" src="/" style="width:390px;height:820px;border:0;display:block"></iframe>'); return; }
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml(theme).replace('<head>', '<head><script>window.__errors=[];window.addEventListener("error",e=>window.__errors.push(e.message));window.addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason)));</script>')); return; }
  handler(req, res);
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + (server.address() as any).port;
const rpc = async (path: string, body?: string): Promise<any> => { const res = await fetch('http://localhost:3456' + path, { method: body === undefined ? 'GET' : 'POST', body }); const value = await res.json(); if (value.error) throw Error(JSON.stringify(value.error)); return value; };
let tab: string | undefined;
const evaluate = async (code: string) => (await rpc('/eval?target=' + tab, code)).value;
const mailbox = (code: string) => evaluate('document.getElementById("mailbox").contentWindow.eval(' + JSON.stringify(code) + ')');
const wait = async (code: string) => { for (let i = 0; i < 100; i++) { try { if (await mailbox(code)) return; } catch {} await new Promise(r => setTimeout(r, 150)); } throw Error('Timeout: ' + code); };
const output = resolve('../../scratch/bottle-reader'); mkdirSync(output, { recursive: true });
try {
  tab = (await rpc('/new', base + '/fixture')).targetId;
  await wait('!!document.getElementById("reader-toggle")');
  await mailbox('Object.defineProperty(document,"hidden",{value:false,configurable:true});document.dispatchEvent(new Event("visibilitychange"));true');
  await wait('!!document.querySelector("#stage .letter-signature")');
  await mailbox('document.querySelector("[data-category=seed]").click();document.querySelector(".mail").open=true;true');
  await wait('!!document.querySelector(".mail .letter-signature")');
  await wait('[...document.fonts].some(f=>f.status==="loaded")');
  const seed = await mailbox(`['#stage','.mail-body'].map(selector=>{const n=document.querySelector(selector),body=n.querySelector('.letter'),signature=n.querySelector('.letter-signature');return {body:getComputedStyle(body).fontFamily,signature:getComputedStyle(signature).fontFamily,size:getComputedStyle(body).fontSize,text:signature.textContent};})`);
  for (const entry of seed) { assert.match(entry.body, /bottle-[a-f0-9]{64}/); assert.equal(entry.body, entry.signature); assert.equal(entry.size, '26px'); assert.equal(entry.text, '—— 短街开铺子的'); }
  assert.equal(seed[0].body, seed[1].body, 'held and archived seed retain the same author font');
  const stableSizes = "['.brand h1','#write-button','.mail-subject strong','.mail-body .head','#reader-toggle'].map(s=>{const n=document.querySelector(s);return n?getComputedStyle(n).fontSize:null})";
  for (const width of [1320, 390, 320]) {
    await evaluate(`document.getElementById('mailbox').style.width='${width}px';true`);
    for (const palette of ['ocean', 'paper', 'coopanion', 'custom']) for (const mode of ['light', 'dark']) {
      await mailbox(`document.getElementById('theme-${palette}').click();document.getElementById('mode-${mode}').click();document.getAnimations().forEach(a=>a.finish());true`);
      const before = await mailbox(stableSizes);
      await mailbox("document.getElementById('reader-toggle').click();true");
      for (const size of [18, 26, 40]) {
        const metrics = await mailbox(`(()=>{const input=document.getElementById('reader-size');input.value='${size}';input.dispatchEvent(new Event('input',{bubbles:true}));const panel=document.getElementById('reader-panel'),r=panel.getBoundingClientRect();return {titles:[...document.querySelectorAll('.letter-title')].map(n=>parseFloat(getComputedStyle(n).fontSize)),sizes:[...document.querySelectorAll('.letter,.letter-signature')].map(n=>getComputedStyle(n).fontSize),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,bodyOverflow:[...document.querySelectorAll('.letter')].some(n=>n.scrollWidth>n.clientWidth),white:getComputedStyle(document.querySelector('#stage .letter')).whiteSpace,text:document.querySelector('#stage .letter').textContent};})()`);
        assert.ok(metrics.sizes.every((s: string) => s === size + 'px'), `${width}/${palette}/${mode}: live size ${size}`);
        assert.ok(metrics.titles.length>=2 && metrics.titles.every((s: number) => Math.abs(s - size * 1.16) < 0.02), 'only letter titles scale with body');
        assert.equal(metrics.inside, true, 'floating control stays inside viewport');
        assert.equal(metrics.overflow, false, 'page fits viewport'); assert.equal(metrics.bodyOverflow, false, 'long text wraps at maximum size');
        assert.equal(metrics.white, 'pre-wrap'); assert.equal(metrics.text, text);
        assert.deepEqual(await mailbox(stableSizes), before, 'headers/buttons/status/subject keep their sizes');
      }
      if (width === 390 && palette === 'ocean') {
        await mailbox("document.getElementById('reader-reset').click();document.getElementById('stage').scrollIntoView({block:'start',behavior:'instant'});document.getAnimations().forEach(a=>a.finish());true");
        if (process.env.BOTTLE_READER_SCREENSHOTS !== '0') await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(join(output, 'reader-390-' + mode + '.png')));
      }
      await mailbox("document.getElementById('reader-tools').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.getAnimations().forEach(a=>a.finish());true");
      await wait('document.getElementById("reader-panel").hidden');
      assert.equal(await mailbox('document.activeElement.id'), 'reader-toggle');
    }
  }
  // Own letters, replies and quoted bodies share the setting, but no UI font changes.
  await mailbox("document.getElementById('reader-size').value='33';document.getElementById('reader-size').dispatchEvent(new Event('input'));true");
  for (const category of ['received', 'reply', 'sent']) {
    await mailbox(`document.querySelector('[data-category=${category}]').click();document.querySelectorAll('.mail').forEach(n=>n.open=true);true`);
    assert.equal(await mailbox("[...document.querySelectorAll('.mail .letter')].every(n=>getComputedStyle(n).fontSize==='33px')"), true);
    assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail-subject strong')).fontSize==='33px'"), false);
    assert.equal(await mailbox("[...document.querySelectorAll('.mail .letter-title')].every(n=>Math.abs(parseFloat(getComputedStyle(n).fontSize)-38.28)<.02)"), true);
    if(category==='reply') assert.equal(await mailbox("document.querySelector('.mail-body > .letter-sheet .letter-title')===null"), true, 'replies have no invented title');
  }
  await evaluate("document.getElementById('mailbox').contentWindow.location.reload();true");
  await wait('document.getElementById("reader-size")?.value==="33"');
  await mailbox('Object.defineProperty(document,"hidden",{value:false,configurable:true});document.dispatchEvent(new Event("visibilitychange"));true');
  await wait('!!document.querySelector("#stage .letter")');
  assert.equal(await mailbox("getComputedStyle(document.querySelector('#stage .letter')).fontSize"), '33px');
  await mailbox("document.getElementById('reader-reset').click();true");
  assert.equal(await mailbox("localStorage.getItem('bottle-reading-size')"), '26');
  // Short, synthetic correspondence for visual review of the actual mailbox layout.
  snapshot.held = null;
  snapshot.received[1].topic = '留了一盏灯';
  snapshot.received[1].body = '今晚收摊比平时晚，走到桥边时，发现卖糖水的小铺还亮着。\n\n老板没问我怎么这么迟，只把最后一碗热的推了过来。有些话不用说出口，也会被人接住。';
  snapshot.received[1].myReply = '听你说完，我也想起一盏灯。\n\n不一定很亮，只要回头时它还在那里，就觉得路没有那么长了。下次经过那间小铺，替我也闻一闻糖水的香吧。';
  await mailbox("document.dispatchEvent(new Event('visibilitychange'));true");
  await wait('!document.querySelector("#stage .letter-sheet")');
  await mailbox("document.querySelector('[data-category=received]').click();document.querySelector('.mail').open=true;true");
  assert.equal(await mailbox("document.querySelector('.mail-body > .letter-sheet .letter').textContent"), snapshot.received[1].body);
  assert.equal(await mailbox("document.querySelector('.reply-quote .letter').textContent"), snapshot.received[1].myReply);
  assert.equal(await mailbox("document.querySelector('.reply-quote .letter-title')===null"), true);
  assert.equal(await mailbox("document.querySelectorAll('.mail-body .letter-sheet').length"), 2);
  assert.equal(await mailbox("document.querySelector('.mail-body > .letter-sheet .letter-signature').textContent"), '—— 海风');
  assert.equal(await mailbox("document.querySelector('.reply-quote .letter-signature').textContent"), '—— 小满');
  assert.equal(await mailbox("document.querySelector('.letter-sheet button')===null"), true, 'controls remain outside the paper');
  for(const width of [1100,390]) for(const mode of ['light','dark']) {
    await evaluate(`document.getElementById('mailbox').style.width='${width}px';document.getElementById('mailbox').style.height='1320px';true`);
    await mailbox(`document.getElementById('theme-ocean').click();document.getElementById('mode-${mode}').click();document.getAnimations().forEach(a=>a.finish());document.querySelector('.mail').scrollIntoView({block:'start',behavior:'instant'});true`);
    if (process.env.BOTTLE_READER_SCREENSHOTS !== '0') await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(join(output, 'stationery-'+width+'-'+mode+'.png')));
  }
  // Draft and original-letter titles must scale too; reply/status headings stay outside.
  snapshot.letterDraft = { kind:'letter',topic:'长标题'.repeat(20),body:'原文 <img src=x onerror=alert(1)>\n\n保留换行。',chars:20,hints:[],at:1 };
  snapshot.replyDraft = { kind:'reply',body:'不需要再加一个标题的回信。',chars:14,hints:[],at:1 };
  snapshot.held = {letterId:'ordinary',from:'海风',topic:'原来那封信',body:'原信内容。',hoursLeft:3};
  await mailbox("document.dispatchEvent(new Event('visibilitychange'));true");
  await wait("document.querySelectorAll('.draft-card').length===2");
  await mailbox("document.querySelector('.original').open=true;document.getElementById('reader-size').value='40';document.getElementById('reader-size').dispatchEvent(new Event('input'));true");
  assert.equal(await mailbox("[...document.querySelectorAll('.draft-card .letter-title')].every(n=>Math.abs(parseFloat(getComputedStyle(n).fontSize)-46.4)<.02)"),true);
  assert.equal(await mailbox("document.querySelector('.draft-card[data-kind=reply] > .letter-sheet .letter-title')===null"),true);
  assert.equal(await mailbox("document.querySelector('.draft-card[data-kind=letter] .letter').textContent"), snapshot.letterDraft.body);
  assert.equal(await mailbox("document.querySelector('.letter-sheet img')===null"),true,'letter markup is plain text');
  assert.equal(await mailbox("document.documentElement.scrollWidth>innerWidth"),false,'long draft titles wrap on mobile at maximum size');
  assert.equal(await mailbox("getComputedStyle(document.querySelector('.draft-card[data-kind=reply] > .title')).fontSize==='46.4px'"),false,'reply state heading is not a letter title');
  assert.deepEqual(await mailbox('window.__errors'), []);
  console.log('PASS: real seed fonts, held/archive signature, live body/title size 18–40, 3 widths × 4 themes × 2 modes, long text wrapping, focus, persistence and reset');
} finally {
  if (tab) await rpc('/close?target=' + tab).catch(() => {});
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  // Only remove the unique fixture directory created above.
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
  rmSync(directory, { recursive: true, force: true });
}
