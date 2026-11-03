import { DEFAULT_MY_FONT } from '../world/default-font.ts';
import { readMyFont, saveMyFont } from '../world/my-font.ts';
/** Local synthetic mailbox only; never reads the running pet or real letters. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pageHtml, pageHandler, type PageDeps, type PageSnapshot } from '../world/page.ts';
import { LetterFonts, fontLibrary } from '../world/fonts.ts';
import { saveBackground, readBackground } from '../world/background.ts';
import { readThemePreference, saveThemePreference } from '../world/theme.ts';
import { cardAppearance } from '../world/appearance.ts';
import { startLanServer, LanPairing } from '../world/lan.ts';
const directory=mkdtempSync(join(tmpdir(),'bottle-custom-browser-'));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
// Keep layout deterministic, but load the real distributed file bytes through both listeners.
writeFileSync(join(directory,'bottle-font-map.json'),JSON.stringify({version:1,assignments:{[hash('visitor:海风')]: 'Yozai-Regular.ttf'}}));
const snapshot:PageSnapshot={draft:null,held:null,received:[{letterId:'fixture',from:'海风',body:'愿今夜的风，替我送来一封信。\n愿你读到时，正好有一点好心情。',topic:'来自海上的一封信',at:new Date().toISOString(),outcome:'replied',myReply:'这是小满写下的回信。'}],sent:[{letterId:'my-sent',topic:'留给海风',body:'这是小满寄出的信。',at:new Date().toISOString(),reply:{from:'海风',body:'收到你的心事了。',at:new Date().toISOString()}}],quota:{bottles_left:1,catches_left:1,replies_left:1},online:true,botName:'小满'};
const fonts=new LetterFonts(directory),ok=async()=>({ok:true});
const deps:PageDeps={snapshot:()=>fonts.decorate(snapshot),theme:async()=>({available:false,preference:readThemePreference(directory)}),
 appearance:async pref=>{if(pref)saveThemePreference(directory,pref);return cardAppearance(readThemePreference(directory)??{theme:'ocean',mode:'system'},{available:false});},
 myFont:id=>readMyFont(directory,id),uploadMyFont:input=>saveMyFont(directory,input),
 background:id=>readBackground(directory,id),uploadBackground:input=>saveBackground(directory,input),request:ok,send:ok,rewrite:ok,dismiss:ok,keep:ok,peruse:ok,discard:ok,open:ok,forget:ok};
const handler=pageHandler(deps);
const server=createServer((req,res)=>{
 if(req.url==='/fixture'){res.setHeader('content-type','text/html');res.end('<!doctype html><body style="margin:0"><iframe id="mailbox" src="/" style="width:390px;height:760px;border:0;display:block"></iframe>');return;}
 if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(pageHtml({available:false,preference:readThemePreference(directory)}).replace('<head>','<head><script>window.__remoteFontRequests=[];var realFetch=window.fetch.bind(window);window.fetch=function(url,options){if(String(url).startsWith("https://fontsforletters.sqnori.com/fonts/")){window.__remoteFontRequests.push(String(url));if(sessionStorage.getItem("test-font-offline"))return Promise.reject(new Error("test offline"));}return realFetch(url,options);};window.__errors=[];window.addEventListener("error",e=>window.__errors.push(e.message));window.addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason)));</script>'));return;}
 handler(req,res);
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const base='http://127.0.0.1:'+(server.address() as any).port;
const lan=await startLanServer(deps,{port:0,pairing:new LanPairing('test-customization-only')});
const rpc=async(path:string,body?:string):Promise<any>=>{const r=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body});const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j;};
let tab:string|undefined,remote:string|undefined;
const evaluate=async(code:string,target=tab)=>(await rpc('/eval?target='+target,code)).value;
const mailbox=(code:string)=>evaluate("document.getElementById('mailbox').contentWindow.eval("+JSON.stringify(code)+")");
const wait=async(code:string,fn=mailbox)=>{for(let i=0;i<200;i++){try{if(await fn(code))return;}catch{}await new Promise(r=>setTimeout(r,150));}console.log(await fn("JSON.stringify({errors:window.__errors,stage:document.getElementById('stage')?.textContent,foot:document.getElementById('foot')?.textContent,paths:performance.getEntriesByType('resource').map(r=>r.name)})"));throw Error('Timed out: '+code);};
const output=resolve('../../scratch/bottle-customization');mkdirSync(output,{recursive:true});
try{
 tab=(await rpc('/new',base+'/fixture')).targetId;
 await wait("!!document.getElementById('letterbook')");
 await mailbox("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));true");
 await wait("!!document.querySelector('.mail')");
 await mailbox("document.querySelector('.mail').open=true; true");
 await wait("Array.from(document.fonts).some(f=>f.status==='loaded'&&f.family.startsWith('bottle-')&&!f.family.startsWith('bottle-mine-'))");
 const family=await mailbox("getComputedStyle(document.querySelector('.mail .letter')).fontFamily");
 assert.match(family,/bottle-[a-f0-9]{64}/);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail .mail-topic')).fontFamily"),family);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail-subject strong')).fontFamily.includes('bottle-')"),false);
 assert.equal(await mailbox("document.getElementById('background-options').hidden"),true);
 const loaded=await mailbox("(async()=>{await document.fonts.ready;return Array.from(document.fonts).some(f=>f.status==='loaded'&&f.family.includes('bottle-'));})()");assert.equal(loaded,true);
 await wait("Array.from(document.fonts).some(f=>f.status==='loaded'&&f.family.includes('bottle-mine-'))");
 const defaultFamily=await mailbox("getComputedStyle(document.getElementById('my-font-preview')).fontFamily");
 assert.ok(defaultFamily.includes('bottle-mine-'+DEFAULT_MY_FONT.id));
 assert.equal(await mailbox("document.getElementById('my-font-current').textContent"),'写信笔迹 · '+DEFAULT_MY_FONT.name+'（默认）');
 assert.equal(await mailbox("(async()=>{await document.fonts.ready;return Array.from(document.fonts).some(f=>f.family.includes('"+DEFAULT_MY_FONT.id+"')&&f.status==='loaded');})()"),true);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail .reply-quote .letter')).fontFamily"),defaultFamily);
 // Parse every prepared file in the real browser; this catches invalid font files or unsupported formats.
 const all=[];
 for(const file of fontLibrary())all.push(await mailbox(`(async()=>{const face=new FontFace('verify-'+${JSON.stringify(file.id)},'url("'+${JSON.stringify(file.url)}+'")');await face.load();return {name:${JSON.stringify(file.name)},status:face.status};})()`));
 assert.ok(all.length>=9);assert.ok(all.every((f:any)=>f.status==='loaded'));console.log('PASS: all '+all.length+' remote pool fonts decoded by the browser; visible letters use the assigned font');
 await mailbox("document.getElementById('theme-toggle').click(); document.getElementById('customization-settings').open=true; document.getElementById('custom-color').value='#ffa0e8'; document.getElementById('custom-color').dispatchEvent(new Event('change')); true");
 await wait("document.documentElement.dataset.theme==='custom' && document.getElementById('custom-color-value').textContent==='#FFA0E8' && document.getElementById('theme-card-note').textContent.includes('已记住')");
 for(const width of [390,1040]){
  await evaluate(`document.getElementById('mailbox').style.width='${width}px';true`);
  for(const mode of ['light','dark']){
   await mailbox(`document.getElementById('mode-${mode}').click(); true`);
   await new Promise(r=>setTimeout(r,320));
   // Finish transitions in this background fixture; Chromium pauses their visual clock.
   await mailbox("document.getAnimations().forEach(a=>a.finish());true");
   const metrics=await mailbox("(()=>{const menu=document.getElementById('theme-menu'),box=menu.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,menuFits:box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight,scrollable:menu.scrollHeight>menu.clientHeight,paper:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),color:getComputedStyle(menu).color,background:getComputedStyle(menu).backgroundColor};})()");
   const buttonColor=await mailbox("getComputedStyle(document.getElementById('write-button')).backgroundColor");
   if(buttonColor!=='rgb(255, 160, 232)') console.log('COLOR DEBUG',width,mode,await mailbox("JSON.stringify({dataset:document.documentElement.dataset,style:document.documentElement.getAttribute('style'),note:document.getElementById('customization-note').textContent,color:document.getElementById('custom-color').value,seal:getComputedStyle(document.getElementById('write-button')).getPropertyValue('--seal')})"));
   assert.equal(buttonColor,'rgb(255, 160, 232)');
   assert.equal(await mailbox("getComputedStyle(document.getElementById('catch-button')).backgroundColor"),'rgb(255, 160, 232)');
   assert.equal(metrics.overflow,false);assert.equal(metrics.menuFits,true);assert.notEqual(metrics.color,metrics.background);assert.ok(metrics.paper.startsWith('#'));
   await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(join(output,`custom-${width}-${mode}.png`)));
  }
 }
 // Trigger the actual file input handler using a synthetic File; no dialogs or user files touched.
 const bytes=readFileSync(new URL('../world/icon.png',import.meta.url)).toString('base64');
 await mailbox(`(()=>{const data=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0)), file=new File([data],'fixture.png',{type:'image/png'}), transfer=new DataTransfer();transfer.items.add(file);const input=document.getElementById('background-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));return true;})()`);
 await wait("document.documentElement.dataset.customBackground==='true' && !document.getElementById('background-file').disabled");
 await wait("document.getElementById('theme-card-note').textContent.includes('已记住')");
 assert.equal(await mailbox("document.getElementById('background-options').hidden"),false);
 await mailbox("document.getElementById('background-transparency').value='37';document.getElementById('background-transparency').dispatchEvent(new Event('input'));true");
 assert.equal(await mailbox("getComputedStyle(document.documentElement).getPropertyValue('--background-opacity')"),'0.63');
 await mailbox("document.getElementById('background-transparency').dispatchEvent(new Event('change'));true");
 await wait("document.getElementById('theme-card-note').textContent.includes('已记住')");
 // Import one of the actual font files as a private writing font, using the real input handler.
 const personal=Buffer.from(await (await fetch(fontLibrary().find(f=>f.name==='NaikaiFont-Regular-2.ttf')!.url!)).arrayBuffer()).toString('base64');
 await mailbox(`(()=>{const data=Uint8Array.from(atob(${JSON.stringify(personal)}),c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([data],'my-handwriting.ttf',{type:'font/ttf'}));const input=document.getElementById('my-font-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));return true;})()`);
 await wait("document.getElementById('my-font-name').textContent==='my-handwriting.ttf' && !document.getElementById('my-font-file').disabled");
 await wait("document.getElementById('theme-card-note').textContent.includes('已记住')");
 const privateFamily=await mailbox("getComputedStyle(document.getElementById('my-font-preview')).fontFamily");assert.match(privateFamily,/bottle-mine-/);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail .letter')).fontFamily"),family);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail .reply-quote .letter')).fontFamily"),privateFamily);
 assert.notEqual(privateFamily,defaultFamily);
 assert.equal(await mailbox("document.getElementById('my-font-current').textContent"),'写信笔迹 · my-handwriting.ttf');
 await mailbox("document.querySelector('[data-category=sent]').click();document.querySelector('.mail').open=true;true");
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail-body .letter')).fontFamily"),privateFamily);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail-body .mail-topic')).fontFamily"),privateFamily);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail-subject strong')).fontFamily.includes('bottle-')"),false);
 await mailbox("document.querySelector('[data-category=reply]').click();document.querySelector('.mail').open=true;true");
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.reply-quote .mail-topic')).fontFamily"),privateFamily);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.reply-quote .letter')).fontFamily"),privateFamily);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.mail-body > .letter-sheet .letter')).fontFamily"),family);
 snapshot.letterDraft={kind:'letter',body:'小满还没寄出的信。',topic:'今夜的风',chars:10,hints:[],at:1};
 snapshot.replyDraft={kind:'reply',body:'小满刚刚写好的回信。',chars:10,hints:[],at:1};
 snapshot.held={letterId:'fixture',from:'海风',body:'手里的来信正文。',topic:'手里的标题',hoursLeft:3};
 await mailbox("document.dispatchEvent(new Event('visibilitychange'));true");
 await wait("document.querySelectorAll('.draft-card').length===2");
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.draft-card[data-kind=letter] .title')).fontFamily"),privateFamily);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.draft-card[data-kind=reply] > .letter-sheet .letter')).fontFamily"),privateFamily);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.draft-card .original .mail-topic')).fontFamily"),family);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.draft-card .original .letter')).fontFamily"),family);
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.brand h1')).fontFamily.includes('bottle-')"),false);
 // Screenshot the reorganized controls, including imported assets and slider.
 await mailbox("scrollTo(0,0);if(document.getElementById('theme-toggle').getAttribute('aria-expanded')!=='true')document.getElementById('theme-toggle').click();document.getElementById('customization-settings').open=true;document.getAnimations().forEach(a=>a.finish());document.getElementById('theme-menu').scrollTop=1000;true");
 for(const width of [390,1040]){
  await evaluate(`document.getElementById('mailbox').style.width='${width}px';true`);
  for(const mode of ['light','dark']){await mailbox(`document.getElementById('mode-${mode}').click();true`);await new Promise(r=>setTimeout(r,320));await mailbox("document.getAnimations().forEach(a=>a.finish());true");await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(join(output,`custom-assets-${width}-${mode}.png`)));}
 }
 snapshot.letterDraft=null;snapshot.replyDraft=null;snapshot.held=null;
 const pref=readThemePreference(directory)!;assert.equal(pref.backgroundTransparency,37);assert.ok(pref.myFont);assert.equal(pref.myFontName,'my-handwriting.ttf');assert.equal(pref.theme,'custom');assert.equal(pref.customColor,'#ffa0e8');assert.ok(pref.background);
 await mailbox("window.__oldCustomization=true;location.reload();true");
 await wait("!window.__oldCustomization && document.documentElement.dataset.customBackground==='true'");
 await wait("document.documentElement.dataset.backgroundVisible==='true'");
 assert.equal(await mailbox("getComputedStyle(document.querySelector('.background-layer.visible')).backgroundImage.includes('/background/')"),true);
 assert.equal(await mailbox("document.getElementById('background-transparency').value"),'37');
 assert.equal(await mailbox("getComputedStyle(document.getElementById('my-font-preview')).fontFamily"),privateFamily);
 console.log('PASS: custom colors, light/dark, mobile menu bounds, real file input upload and reload persistence');
 // A separate paired browser origin represents a second device, with no shared localStorage.
 remote=(await rpc('/new','http://127.0.0.1:'+lan.port+'/pair')).targetId;
 await evaluate("(async()=>{const r=await fetch('/pair',{method:'POST',headers:{'x-bottle':'1','content-type':'application/json'},body:JSON.stringify({token:'test-customization-only'})});if(!r.ok)throw Error('pair failed');location.href='/';return true;})()",remote);
 const rem=(code:string)=>evaluate(code,remote);
 await wait("!!document.getElementById('letterbook')",rem);
 await rem("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));true");
 await wait("!!document.querySelector('.mail') && document.documentElement.dataset.customBackground==='true'",rem);
 await rem("document.querySelector('.mail').open=true;true");
 assert.equal(await rem("document.getElementById('custom-color').value"),'#ffa0e8');
 assert.equal(await rem("document.getElementById('background-transparency').value"),'37');
 assert.equal(await rem("getComputedStyle(document.getElementById('my-font-preview')).fontFamily"),privateFamily);
 assert.equal(await rem("getComputedStyle(document.querySelector('.mail .letter')).fontFamily"),family);
 await wait("Array.from(document.fonts).some(f=>f.status==='loaded')",rem);
 assert.equal(await rem(`(async()=>{const r=await fetch('/background/${pref.background}');const b=await r.blob();const image=await createImageBitmap(b);return image.width>0;})()`),true);
 console.log('PASS: separate paired LAN origin restores the same font, color and background without local fonts or shared storage');
 await rem("document.getElementById('background-remove').click();true");
 await wait("document.getElementById('theme-card-note').textContent.includes('已记住')",rem);
 assert.equal(readThemePreference(directory)!.background,null);
 await wait("document.getElementById('background-options').hidden",rem);
 await rem("document.getElementById('my-font-remove').click();true");
 await wait("document.getElementById('theme-card-note').textContent.includes('已记住')",rem);
 assert.equal(readThemePreference(directory)!.myFont,null);
 assert.equal(await rem("getComputedStyle(document.getElementById('my-font-preview')).fontFamily"),defaultFamily);
 assert.equal(await rem("document.getElementById('my-font-current').textContent"),'写信笔迹 · '+DEFAULT_MY_FONT.name+'（默认）');
 await wait("Array.from(document.fonts).some(f=>f.family.includes('"+DEFAULT_MY_FONT.id+"')&&f.status==='loaded')",rem);
 assert.equal(await rem("getComputedStyle(document.querySelector('.mail-body > .letter-sheet .letter')).fontFamily"),family);
 console.log('PASS: exact pink in both modes, background transparency, private font scope, content-only titles, removal, remote persistence');
 // Simulate remote font network loss on reload. The first origin must use IndexedDB.
 await mailbox("sessionStorage.setItem('test-font-offline','1');location.reload();true");
 await wait("window.__remoteFontRequests && !!document.getElementById('letterbook')");
 await mailbox("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));true");
 await wait("Array.from(document.fonts).some(f=>f.family.includes('"+DEFAULT_MY_FONT.id+"')&&f.status==='loaded')");
 await wait("!!document.querySelector('.mail')");await mailbox("document.querySelector('.mail').open=true;true");
 await wait("Array.from(document.fonts).some(f=>f.family.startsWith('bottle-')&&!f.family.startsWith('bottle-mine-')&&f.status==='loaded')");
 assert.deepEqual(await mailbox("window.__remoteFontRequests"),[]);
 console.log('PASS: R2 fonts restored from browser IndexedDB after reload with remote font requests blocked');
}finally{
 if(remote)await rpc('/close?target='+remote).catch(()=>{});if(tab)await rpc('/close?target='+tab).catch(()=>{});
 await lan.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));rmSync(directory,{recursive:true,force:true});
}
