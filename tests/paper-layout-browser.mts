/** Isolated real-browser regression for stationary paper drafts and expanded correspondence. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pageHtml } from '../world/page-view.ts';
import type { PageSnapshot } from '../world/page.ts';
const original='今晚看见了窗边的一盏灯，想起远方也有人醒着。\n愿这封信经过的海，今晚都平静。';
const reply='你的信已经读到了。\n这里也有一盏灯，替你留到天亮。';
const draft='那就让两盏灯隔海作伴吧。今晚也愿你好梦。';
const snapshot:PageSnapshot={botName:'云汐',online:true,quota:{bottles_left:2,catches_left:3,replies_left:3},draft:null,held:null,received:[],sent:[{letterId:'fixture-correspondence',topic:'隔海的一盏灯',body:original,at:'2026-11-05T10:00:00Z',state:'replied',reply:{from:'灯塔边的来客',body:reply,at:'2026-11-06T10:00:00Z'}}],noteDraft:{letterId:'fixture-correspondence',body:draft,at:1}};
let rows:any[]=[];
const server=createServer((req,res)=>{
 res.setHeader('cache-control','no-store');
 if(req.url==='/fixture'){res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><body style="margin:0"><iframe id="mailbox" src="/" style="display:block;width:1040px;height:1700px;border:0"></iframe>');return;}
 if(req.url==='/'){res.setHeader('content-type','text/html;charset=utf-8');res.end(pageHtml({available:false}));return;}
 if(req.url==='/icon.png'){res.setHeader('content-type','image/png');res.end(readFileSync(resolve('world/icon.png')));return;}
 res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/draft'?snapshot:req.url==='/notes'?rows:req.url==='/theme'?{available:false}:{}));
});
const rpc=async(path:string,body?:string)=>{const response=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body});const data=await response.json() as any;if(data.error)throw Error(JSON.stringify(data.error));return data;};
let tab:string|undefined;const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const evaluate=async(code:string)=>(await rpc('/eval?target='+tab,code)).value;
const inMail=(code:string)=>evaluate('document.getElementById("mailbox").contentWindow.eval('+JSON.stringify(code)+')');
async function until(code:string){for(let n=0;n<70;n++){try{if(await inMail(code))return;}catch{}await pause(100);}throw Error('Timed out: '+code);}
const refresh=async()=>{await inMail("document.dispatchEvent(new Event('visibilitychange'));true");await pause(200);};
const out=resolve('../../scratch/bottle-080-evidence');mkdirSync(out,{recursive:true});
try{
 await new Promise<void>(r=>server.listen(18885,'127.0.0.1',r));
 tab=(await rpc('/new','http://127.0.0.1:18885/fixture')).targetId;
 await until("!!document.getElementById('paper-compose')");
 await inMail("Object.defineProperty(document,'hidden',{value:false,configurable:true});window.testErrors=[];addEventListener('error',e=>testErrors.push(e.message));document.dispatchEvent(new Event('visibilitychange'));true");
 await until("document.querySelector('.mail .paper-compose')?.textContent.includes('两盏灯')");await pause(700);
 await inMail(`window.oldMail=document.querySelector('.mail');window.oldSlot=document.querySelector('.paper-slot');window.oldDraft=document.getElementById('paper-compose');window.paperMutations=0;window.paperScrolls=0;window.watchPaper=new MutationObserver(ms=>ms.forEach(m=>{for(const n of m.removedNodes)if(n===oldDraft||n.contains?.(oldDraft))paperMutations++}));watchPaper.observe(document.getElementById('mail-list'),{childList:true,subtree:true});const scroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(...args){if(this.id==='paper-compose')paperScrolls++;return scroll.apply(this,args)};document.getElementById('paper-rewrite').focus({preventScroll:true});true`);
 for(let n=0;n<6;n++){snapshot.quota!.catches_left=3+n;await refresh();}
 assert.deepEqual(await inMail("({sameMail:oldMail===document.querySelector('.mail'),sameSlot:oldSlot===oldDraft.parentElement,moves:paperMutations,scrolls:paperScrolls,focused:document.activeElement.id})"),{sameMail:true,sameSlot:true,moves:0,scrolls:0,focused:'paper-rewrite'});
 rows=[{id:'note-fixture',letterId:'fixture-correspondence',from:'灯塔边的来客',body:'灯光已经看到了。',at:'2026-11-06T11:00:00Z',expiresAt:'2026-11-13T11:00:00Z',read:false}];await refresh();await until("!!document.querySelector('[data-note-id]')");
 rows[0].read=true;await refresh();await until("document.querySelector('.paper-status').textContent==='已读'");
 assert.equal(await inMail('paperMutations'),0);
 snapshot.noteRewriting=true;await refresh();await until("document.getElementById('paper-rewrite').textContent.includes('正在重写')");
 assert.equal(await inMail("document.getElementById('paper-body').textContent"),draft);
 snapshot.noteDraft!.body='再写一句：谢谢你接住这一点灯光。';snapshot.noteRewriting=false;await refresh();await until("document.getElementById('paper-body').textContent.includes('谢谢你')");
 assert.equal(await inMail('paperScrolls'),0);assert.equal(await inMail('paperMutations'),0);
 // Closing the letter or browsing another folder must not be undone by periodic refresh.
 await inMail("document.querySelector('.mail').open=false;true");await pause(100);await refresh();assert.equal(await inMail("document.querySelector('.mail').open"),false);
 await inMail("document.querySelector('[data-category=sent]').click();true");await refresh();assert.equal(await inMail("document.querySelector('[data-category=sent]').getAttribute('aria-pressed')"),'true');
 await inMail("document.querySelector('[data-category=reply]').click();document.querySelector('.mail').open=true;true");
 assert.equal(await inMail("!!document.querySelector('.mail-foot .paper-invite-button')"),false);
 assert.equal(await inMail("document.querySelector('.paper-invite').hidden"),true);
 assert.equal(await inMail("!!document.querySelector('textarea#paper-body,[contenteditable=true]#paper-body')"),false);
 for(const width of [1040,390,320]){
  await evaluate(`document.getElementById('mailbox').style.width='${width}px';true`);
  for(const theme of ['ocean','paper','epistle','coopanion'])for(const mode of ['light','dark']){
   await inMail(`document.getElementById('theme-${theme}').click();document.getElementById('mode-${mode}').click();true`);await pause(280);
   const result=await inMail(`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const a=r('.mail-body>.letter-sheet'),b=r('.reply-quote .letter-sheet'),f=r('.mail-foot'),t=r('.paper-tray');return {overflow:document.documentElement.scrollWidth>innerWidth,aligned:Math.abs(a.left-b.left)<1&&Math.abs(a.right-b.right)<1,paperAfter:t.top>=f.bottom,centered:Array.from(document.querySelectorAll('.paper-slot > .paper-slip')).every(n=>{const p=n.getBoundingClientRect();return Math.abs((p.left+p.right)-(t.left+t.right))<2}),animation:getComputedStyle(document.getElementById('paper-compose')).animationName,original:document.querySelector('.reply-quote .letter').textContent,reply:document.querySelector('.mail-body>.letter-sheet .letter').textContent}})()`);
   assert.deepEqual(result,{overflow:false,aligned:true,paperAfter:true,centered:true,animation:'none',original,reply},JSON.stringify({width,theme,mode,result}));
  }
 }
 const stableSizes=await inMail("['.mail-subject strong','.mail-foot button'].map(s=>getComputedStyle(document.querySelector(s)).fontSize)");
 for(const size of [18,26,40]){
  const metrics=await inMail(`(()=>{const input=document.getElementById('reader-size');input.value='${size}';input.dispatchEvent(new Event('input',{bubbles:true}));return {sizes:Array.from(document.querySelectorAll('.mail .letter,.mail .letter-signature')).map(n=>parseFloat(getComputedStyle(n).fontSize)),title:parseFloat(getComputedStyle(document.querySelector('.letter-title')).fontSize),overflow:document.documentElement.scrollWidth>innerWidth,bodyOverflow:Array.from(document.querySelectorAll('.mail .letter')).some(n=>n.scrollWidth>n.clientWidth)}})()`);
  assert.ok(metrics.sizes.every((n:number)=>n===size));assert.ok(Math.abs(metrics.title-size*1.16)<.02);assert.equal(metrics.overflow,false);assert.equal(metrics.bodyOverflow,false);
  assert.deepEqual(await inMail("['.mail-subject strong','.mail-foot button'].map(s=>getComputedStyle(document.querySelector(s)).fontSize)"),stableSizes);
 }
 await inMail("document.getElementById('reader-size').value='26';document.getElementById('reader-size').dispatchEvent(new Event('input',{bubbles:true}));true");
 await inMail("dispatchEvent(new PageTransitionEvent('pagehide'));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));true");await until("document.getElementById('paper-body').textContent.includes('谢谢你')");
 await evaluate("document.getElementById('mailbox').style.width='1040px';true");await inMail("document.getElementById('theme-paper').click();document.getElementById('mode-light').click();document.querySelector('.mail').open=true;true");await pause(600);await inMail("document.querySelector('.mail').scrollIntoView({block:'start',behavior:'instant'});true");await pause(100);
 await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(resolve(out,'correspondence-paper-desktop.png')));
 await evaluate("document.getElementById('mailbox').style.width='390px';true");await inMail("document.getElementById('paper-compose').scrollIntoView({block:'center',behavior:'instant'});true");await pause(350);
 await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(resolve(out,'correspondence-paper-mobile.png')));
 snapshot.noteDraft=null;await refresh();await until("!document.querySelector('.paper-invite').hidden");
 assert.equal(await inMail("document.getElementById('paper-compose').hidden"),true);
 assert.deepEqual(await inMail('testErrors'),[]);
 console.log('PASS: repeated polls/quota changes keep draft DOM, focus and scroll; note receipts/read status/rewrite; collapse/folder selection preserved; page restoration; 24 theme/width layouts; original text unchanged.');
}finally{if(tab)await rpc('/close?target='+tab).catch(()=>{});server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
