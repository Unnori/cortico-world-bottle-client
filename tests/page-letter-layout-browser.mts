import { feedbackQr, WORLD_VERSION, FEEDBACK_FORM_URL } from '../world/feedback.ts';
/** Run with the shared web-access proxy: pnpm exec tsx tests/page-letter-layout-browser.mts. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import { pageHtml } from '../world/page-view.ts';
import { soundLibrary, soundOptions, packSound, DEFAULT_SOUND_PACK } from '../world/sound.ts';
import type { PageSnapshot } from '../world/page.ts';
import type { MailboxTheme } from '../world/theme.ts';

const theme: MailboxTheme = { available: true, palettes: Object.values(BUILTIN_PALETTES)[0] };
const body = '第一行留给海风。\nhttps://example.test/' + 'a'.repeat(85) + '\n最后一行保留原来的换行。';
const snapshot: PageSnapshot = {
  wake: { version: 1, day: '2026-11-03', lastInviteAt: 0, active: null, lanes: {
    write: { count: 1, dayLimit: 5, intervalHours: 4, nextAt: null, paused: false, declined: false, failed: false },
    catch: { count: 0, dayLimit: 2, nextAt: null, paused: false, declined: false, failed: false },
    remind: { count: 0, dayLimit: 3, nextAt: null, paused: false, declined: false, failed: false } },
    history: [{ id: 'fixture', action: 'write', result: 'failed', reason: 'turn_ended', at: Date.now(), attempts: 1 }] },
  botName: '小满', online: true, quota: { bottles_left: 2, catches_left: 5, replies_left: 0 },
  draft: null, held: null, received: [{ letterId: 'caught', from: '灯塔边的人', topic: '来自灯塔的一封信',
    body, readCount:2, at: '2026-11-01T10:00:00+08:00', outcome: 'replied', myReply: '回信第一行。\n回信第二行。' },{letterId:'unread',from:'海边',body:'未读的新信',at:'2026-10-31T10:00:00+08:00',outcome:'kept'}],
  sent: [{ letterId: 'sent', topic: '给远方留一点灯光', body, at: '2026-11-01T10:00:00+08:00', state: 'replied',
    reply: { readCount:1, from: '海边的旅人', body: '收到你的信了。\n愿你今晚好梦。', at: '2026-11-01T11:00:00+08:00' } }],
};
const server = createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/fixture') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><body style="margin:0"><iframe id="mailbox" src="/" style="display:block;width:1040px;height:1800px;border:0"></iframe>'); return;
  }
  if (req.url === '/feedback-qr.png') { res.setHeader('content-type','image/png'); res.end(await feedbackQr()); return; }
  if (req.url === '/icon.png') { res.setHeader('content-type','image/png'); res.end(readFileSync(resolve('world/icon.png'))); return; }
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
  console.log(await inMailbox("JSON.stringify({scrolls:window.__deskScrolls,stage:document.getElementById('stage')?.textContent,hidden:document.hidden,dialog:document.getElementById('feedback-dialog')?.open})"));
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
            var inside=Array.from(body.querySelectorAll('.head,.letter-sheet,.letter-title,.letter,.letter-signature,.reply-quote,.mail-foot')).every(n=>{var r=n.getBoundingClientRect();return r.left>=box.left+parseFloat(style.paddingLeft)-1&&r.right<=box.right-parseFloat(style.paddingRight)+1;});
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
          assert.equal(metrics.paddingLeft, width > 560 ? 24 : 10, label + ': inset');
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
        const invitation = await inMailbox(`(()=>{
          const node=document.getElementById('wake-outcome'),box=node.closest('.invitation-outcome'),button=document.getElementById('catch-button');
          document.querySelector('.invitation-settings').open=false;
          return {text:node.textContent,rect:box.getBoundingClientRect().toJSON(),button:button.getBoundingClientRect().toJSON(),
            color:getComputedStyle(box).color,background:getComputedStyle(box).backgroundColor,hidden:!!node.closest('details'),
            limit:document.getElementById('wake-write-limit').value,status:document.getElementById('wake-write-status').textContent};
        })()`);
        assert.match(invitation.text,/小满没有回应邀请/);
        assert.equal(invitation.hidden,false);assert.ok(invitation.rect.top>=invitation.button.bottom);
        assert.ok(invitation.rect.left>=0&&invitation.rect.right<=width);assert.notEqual(invitation.color,invitation.background);
        assert.equal(invitation.limit,'5');assert.match(invitation.status,/1\/5/);
        await inMailbox("document.getElementById('feedback-entry').click(); document.querySelector('.feedback-qr').open=true; true");
        await until("document.querySelector('.feedback-qr img').naturalWidth > 0");
        const feedback = await inMailbox(`(()=>{
          const dialog=document.getElementById('feedback-dialog'), badge=dialog.querySelector('.feedback-version'), style=getComputedStyle(badge), rect=badge.getBoundingClientRect();
          const qr=dialog.querySelector('img');
          return {text:badge.textContent, border:parseFloat(style.borderTopWidth), color:style.color, background:style.backgroundColor,
            href:dialog.querySelector('.feedback-form').href, target:dialog.querySelector('.feedback-form').target,
            inside:rect.left>=0&&rect.right<=innerWidth, overflow:dialog.scrollWidth>dialog.clientWidth,
            qrLoaded:qr.complete&&qr.naturalWidth===240};
        })()`);
        assert.ok(feedback.text.includes('V'+WORLD_VERSION)); assert.ok(feedback.border>=2);
        assert.notEqual(feedback.color,feedback.background); assert.equal(feedback.href,FEEDBACK_FORM_URL);
        assert.equal(feedback.target,'_blank');assert.equal(feedback.inside,true);assert.equal(feedback.overflow,false);assert.equal(feedback.qrLoaded,true);
        await inMailbox("document.getElementById('feedback-dialog').close(); true");
        console.log(`PASS: ${width}px ${palette}/${mode}, letter layout + reading badges + sound settings`);
      }
    }
  }
  // Exercise actual audio selection with decoded WAV bytes, without sounding the user's speakers.
  await inMailbox(`(()=>{
    window.__played=[];
    window.AudioContext=class {
      state='running';currentTime=0;destination={};resume(){return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
      async decodeAudioData(bytes){const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');const buffer=await new OfflineAudioContext(1,1,44100).decodeAudioData(bytes);buffer.testId=id;return buffer;}
      createBufferSource(){const source={buffer:null,connect(){},disconnect(){},start(){__played.push(this.buffer.testId);queueMicrotask(()=>this.onended());},stop(){this.onended?.();}};return source;}
      createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(){}}};}
    };
    return true;
  })()`);
  for(const id of ['incoming/memes_奶龙大笑_cut.wav','incoming/New_notifications_1.wav']){
    const expected=await inMailbox(`(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch('/sounds/'+encodeURIComponent(${JSON.stringify(id)}))).arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join(''))()`);
    const before=await inMailbox('__played.length');
    await inMailbox(`document.getElementById('sound-incoming').value=${JSON.stringify('pack:'+id)};document.getElementById('sound-incoming-preview').click();true`);
    await until('__played.length==='+(before+1));
    assert.equal(await inMailbox('__played.at(-1)'),expected,'selected file bytes are the bytes actually played');
  }
  console.log('PASS: switching meme/default sounds plays the matching decoded file, even before change commits');
  // Record real scrolling while preserving native behavior. Mobile viewport is deliberately short.
  await evaluate("document.getElementById('mailbox').style.width='390px';document.getElementById('mailbox').style.height='720px';true");
  await inMailbox(`var originalMatchMedia=window.matchMedia.bind(window);window.matchMedia=function(query){return query.includes('prefers-reduced-motion')?{matches:true}:originalMatchMedia(query);};window.__deskScrolls=[];var nativeScroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){if(this.parentElement?.id==='stage')__deskScrolls.push(options);return nativeScroll.call(this,options);};scrollTo(0,0);true`);
  const refresh = async()=>{await inMailbox("document.dispatchEvent(new Event('visibilitychange'));true");};
  snapshot.held={letterId:'arrival-fixture',from:'远方的来客',body:'这一封刚刚靠岸。',hoursLeft:72};
  await refresh();await until('__deskScrolls.length===1');
  await until("(()=>{var r=document.querySelector('#stage .card').getBoundingClientRect();return Math.abs((r.top+r.bottom)/2-innerHeight/2)<8;})()");
  snapshot.quota!.catches_left=4;await refresh();await until("document.getElementById('tide').textContent.includes('4')");
  assert.equal(await inMailbox('__deskScrolls.length'),1,'quota refresh does not scroll again');
  snapshot.letterDraft={kind:'letter',body:'新写的信也该看得到。',at:1,chars:12,hints:[]};
  await refresh();await until('__deskScrolls.length===2');
  await until("(()=>{var r=document.querySelector('#stage .card').getBoundingClientRect();return Math.abs((r.top+r.bottom)/2-innerHeight/2)<8;})()");
  snapshot.letterDraft={...snapshot.letterDraft,at:2,body:'这是一份重新写好的草稿。'};
  await refresh();await until('__deskScrolls.length===3');
  await inMailbox("document.getElementById('feedback-entry').click();true");
  snapshot.replyDraft={kind:'reply',letterId:'arrival-fixture',body:'这是回信草稿。',at:3,chars:8,hints:[]};
  await refresh();await until("document.getElementById('stage').textContent.includes('这是回信草稿。')");
  assert.equal(await inMailbox('__deskScrolls.length'),3,'modal keeps reading position until closed');
  await inMailbox("document.getElementById('feedback-close').click();true");await until('__deskScrolls.length===4');
  console.log('PASS: incoming letters, drafts and rewrites center on mobile; polls stay still and dialogs defer scrolling');
  snapshot.held=null;snapshot.letterDraft=null;snapshot.replyDraft=null;
  await refresh();await until("document.getElementById('stage').textContent.includes('海面很安静')");
  await evaluate("document.getElementById('mailbox').style.height='1800px';true");
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
  await evaluate("document.getElementById('mailbox').style.height='720px'; document.getElementById('mailbox').style.width='390px'; true");
  await inMailbox("document.getElementById('theme-ocean').click(); document.getElementById('mode-dark').click(); document.getElementById('feedback-entry').click(); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'feedback-mobile-dark.png')));
  await inMailbox("document.querySelector('.feedback-qr').open=true; document.querySelector('.feedback-qr img').scrollIntoView({block:'center'}); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'feedback-qr-mobile-dark.png')));
  await evaluate("document.getElementById('mailbox').style.width='1040px'; true");
  await inMailbox("document.getElementById('mode-light').click(); document.querySelector('.feedback-qr').open=false; document.getElementById('feedback-dialog').scrollTop=0; true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'feedback-desktop-light.png')));
  await inMailbox("document.getElementById('feedback-dialog').close(); true");
  await evaluate("document.getElementById('mailbox').style.width='390px'; document.getElementById('mailbox').style.height='1800px'; true");
  await inMailbox("document.getElementById('theme-ocean').click(); document.getElementById('mode-dark').click(); scrollTo(0,0); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'invitation-mobile-dark.png')));
  await evaluate("document.getElementById('mailbox').style.width='1040px'; true");
  await inMailbox("document.getElementById('mode-light').click(); scrollTo(0,0); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'invitation-desktop-light.png')));
  await evaluate("document.getElementById('mailbox').style.width='390px'; true");
  await inMailbox("document.getElementById('theme-ocean').click(); document.getElementById('mode-light').click(); document.querySelector('[data-category=reply]').click(); document.querySelector('.mail').open=true; document.getAnimations().forEach(a=>a.finish()); document.querySelector('.mail').scrollIntoView({block:'start',behavior:'instant'}); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'mobile.png')));
  await evaluate("document.getElementById('mailbox').style.width='1040px'; true");
  await inMailbox("document.getAnimations().forEach(a=>a.finish()); document.querySelector('.mail').scrollIntoView({block:'start',behavior:'instant'}); true");
  await rpc('/screenshot?target=' + tab + '&file=' + encodeURIComponent(resolve(output, 'desktop.png')));
} finally {
  if (tab) await rpc('/close?target=' + tab).catch(() => undefined);
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
}
