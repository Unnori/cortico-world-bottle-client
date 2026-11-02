/** Run with the shared web-access proxy: pnpm exec tsx tests/page-letter-layout-browser.mts. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import { pageHtml } from '../world/page-view.ts';
import { soundLibrary, soundOptions, packSound, DEFAULT_SOUND_PACK } from '../world/sound.ts';
import type { PageSnapshot } from '../world/page.ts';
import type { MailboxTheme } from '../world/theme.ts';

const theme: MailboxTheme = { available: true, palettes: Object.values(BUILTIN_PALETTES)[0] };
const body = '第一行留给海风。\nhttps://example.test/' + 'a'.repeat(85) + '\n最后一行保留原来的换行。';
const snapshot: PageSnapshot = {
  botName: '小满', online: true, quota: { bottles_left: 2, catches_left: 5, replies_left: 0 },
  draft: null, held: null, received: [{ letterId: 'caught', from: '灯塔边的人', topic: '来自灯塔的一封信',
    body, readCount:2, at: '2026-11-01T10:00:00+08:00', outcome: 'replied', myReply: '回信第一行。\n回信第二行。' },{letterId:'unread',from:'海边',body:'未读的新信',at:'2026-10-31T10:00:00+08:00',outcome:'kept'}],
  sent: [{ letterId: 'sent', topic: '给远方留一点灯光', body, at: '2026-11-01T10:00:00+08:00', state: 'replied',
    reply: { readCount:1, from: '海边的旅人', body: '收到你的信了。\n愿你今晚好梦。', at: '2026-11-01T11:00:00+08:00' } }],
};
const server = createServer((req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/fixture') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><body style="margin:0"><iframe id="mailbox" src="/" style="display:block;width:1040px;height:1800px;border:0"></iframe>'); return;
  }
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml(theme)); return; }
  if (req.url?.startsWith('/sounds/')) {
    const id=decodeURIComponent(req.url.slice(8));
    const file=packSound(id==='fixture-shared.wav'?DEFAULT_SOUND_PACK.incoming:id);
    if(file){res.setHeader('content-type',file.mime);res.end(file.bytes);}else{res.statusCode=404;res.end();}return;
  }
  if(req.url==='/sounds'){res.setHeader('content-type','application/json');res.end(JSON.stringify({files:[...soundLibrary(),{id:'fixture-shared.wav',label:'共同提示音',kind:'shared'}]}));return;}
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
    try { if (await inMailbox(code)) return; } catch { /* The isolated iframe may be between documents during reload. */ }
    await sleep(150);
  }
  throw new Error('Browser state did not settle: ' + code);
}
try {
  assert.equal((await rpc('/health')).connected, true);
  tab = (await rpc('/new', 'http://127.0.0.1:' + port + '/fixture')).targetId;
  await until("!!document.getElementById('letterbook')");
  // Only the fixture simulates visibility; never focus or alter the user's tabs.
  await inMailbox("Object.defineProperty(document,'hidden',{value:false,configurable:true}); document.dispatchEvent(new Event('visibilitychange')); var style=document.createElement('style');style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.appendChild(style); true");
  await until("document.getElementById('hero-note').textContent.includes('小满')");
  await until("Array.from(document.getElementById('sound-incoming').options).some(option=>option.value==='pack:fixture-shared.wav')");
  for(const kind of ['incoming','reply'] as const){
    const choices=await inMailbox(`Array.from(document.getElementById('sound-${kind}').options).map(option=>({value:option.value,label:option.textContent}))`);
    assert.deepEqual(choices.map((item:any)=>item.value),[...soundOptions(kind).map(item=>'pack:'+item.id),'pack:fixture-shared.wav','local','off'],kind+': only own subdirectory + root shared sounds');
    assert.equal(choices.find((item:any)=>item.value==='pack:fixture-shared.wav')?.label,'通用 · 共同提示音');
    assert.equal(await inMailbox(`document.getElementById('sound-${kind}').value`),'pack:'+DEFAULT_SOUND_PACK[kind],kind+': correct default selected');
    const seconds=await inMailbox(`(async()=>{var bytes=await(await fetch('/sounds/'+encodeURIComponent(${JSON.stringify(DEFAULT_SOUND_PACK[kind])}))).arrayBuffer();var context=new OfflineAudioContext(1,1,22050);var buffer=await context.decodeAudioData(bytes);return buffer.duration;})()`);
    assert.ok(seconds>0,kind+': real default file decodes without speaker output');
  }
  console.log('PASS: isolated sound menus, shared root options, both new defaults, and real WAV decoding');
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
            var letter=body.querySelector('.letter'),subject=mail.querySelector('.mail-subject').getBoundingClientRect(),badges=mail.querySelector('.mail-badges').getBoundingClientRect();
            return {badgeTexts:Array.from(mail.querySelectorAll('.mail-badges .mail-status')).map(n=>n.textContent),together:!!mail.querySelector('.read-together'),subjectWidth:subject.width,badgesBelow:badges.top>=subject.bottom,paddingLeft:parseFloat(style.paddingLeft),paddingRight:parseFloat(style.paddingRight),paddingBottom:parseFloat(style.paddingBottom),border:style.borderTopStyle,inside,overflow:document.documentElement.scrollWidth>innerWidth,whiteSpace:getComputedStyle(letter).whiteSpace,text:letter.textContent,footer:body.querySelector('.mail-foot').getBoundingClientRect().bottom<=box.bottom-parseFloat(style.paddingBottom)+1};
          })()`);
          const label = `${width}px ${palette}/${mode} ${category}`;
          if(category==='sent'){
            assert.deepEqual(metrics.badgeTexts,['收到回信'],label+': only delivery status, no reading counter');
            assert.equal(metrics.together,false,label+': original cannot be read separately');
          }else{
            assert.deepEqual(metrics.badgeTexts,[category==='reply'?'已读1次':'已读2次'],label+': incoming reading count remains');
          }
          assert.equal(metrics.paddingLeft, width > 560 ? 24 : 16, label + ': inset');
          assert.equal(metrics.paddingRight, metrics.paddingLeft, label + ': equal insets');
          assert.equal(metrics.paddingBottom, width > 560 ? 22 : 18, label + ': footer spacing');
          assert.equal(metrics.border, 'dashed', label + ': body separator');
          assert.equal(metrics.inside, true, label + ': letter, quote and controls stay inside');
          assert.equal(metrics.footer, true, label + ': footer stays inside');
          assert.equal(metrics.overflow, false, label + ': no horizontal overflow');
          assert.equal(metrics.whiteSpace, 'pre-wrap', label + ': preserve line breaks');
          assert.ok(metrics.text.includes('\n'), label + ': original line breaks remain');
          if(width<560){assert.ok(metrics.subjectWidth>=140,label+': badges do not squeeze the subject');assert.equal(metrics.badgesBelow,true,label+': badges occupy their own row');}
        }
        await inMailbox("document.getElementById('sound-settings').open=true; document.querySelector('[data-category=received]').click(); true");
        const extras=await inMailbox(`(()=>{
          var settings=document.getElementById('sound-settings');
          var badges=Array.from(document.querySelectorAll('.mail-badges .mail-status')).map(n=>({text:n.textContent,color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor,box:n.getBoundingClientRect().toJSON()}));
          var select=settings.querySelector('select'),style=getComputedStyle(select),r=select.getBoundingClientRect();
          return {badges,color:style.color,background:style.backgroundColor,optionCount:select.options.length,overflow:document.documentElement.scrollWidth>innerWidth,inset:r.left>=0&&r.right<=innerWidth};
        })()`);
        assert.equal(extras.overflow,false,`${width} ${palette}/${mode}: sound settings fit`);
        assert.equal(extras.inset,true,`${width} ${palette}/${mode}: sound select within viewport`);
        assert.ok(extras.optionCount>=4,'pack/local/silent sources');
        assert.ok(extras.badges.some((b:any)=>b.text==='已读2次'),'read count visible');
        assert.ok(extras.badges.some((b:any)=>b.text==='尚未阅读'),'unread badge visible');
        assert.notEqual(extras.badges[0].color,extras.badges[1].color,'green and yellow statuses differ');
        assert.ok(extras.badges.every((b:any)=>b.box.left>=0&&b.box.right<=width),'badges stay within viewport');
        assert.notEqual(extras.color,extras.background,'sound control text is legible');
        console.log(`PASS: ${width}px ${palette}/${mode}, letter layout + reading badges + sound settings`);
      }
    }
  }
  await inMailbox(`(async()=>{
    var bytes=await (await fetch('/sounds/incoming%2FNew_notifications_1.wav')).arrayBuffer();
    var transfer=new DataTransfer();transfer.items.add(new File([bytes],'phone-test.wav',{type:'audio/wav'}));
    var picker=document.getElementById('sound-incoming-file');picker.files=transfer.files;picker.dispatchEvent(new Event('change'));
    return true;
  })()`);
  await until("document.getElementById('sound-incoming-name').textContent==='phone-test.wav'");
  const devicePrefs=await inMailbox("JSON.parse(localStorage.getItem('bottle-device-sound'))");
  assert.equal(devicePrefs.incoming,'local','local source saved per device');
  await inMailbox("window.__soundReloadMarker=true;location.reload();true");
  await until("!window.__soundReloadMarker && document.getElementById('sound-incoming-name')?.textContent==='phone-test.wav'");
  console.log('PASS: selected local sound survives reload in IndexedDB without being uploaded');
  await inMailbox("Object.defineProperty(document,'hidden',{value:false,configurable:true}); document.dispatchEvent(new Event('visibilitychange')); true");
  await until("document.getElementById('hero-note').textContent.includes('小满') && !!document.querySelector('.mail')");
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
