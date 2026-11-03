/** Synthetic mailboxes only. Test real browser font decoding/cache with a 21s download. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pageHtml } from '../world/page-view.ts';
import { LetterFonts } from '../world/fonts.ts';
import { DEFAULT_MY_FONT } from '../world/default-font.ts';
import { pageHandler, type PageDeps, type PageSnapshot } from '../world/page.ts';
const directory=mkdtempSync(join(tmpdir(),'bottle-font-repair-'));
const local=resolve('../../bottle-font-library/cloudflare-r2/upload/fonts/'+DEFAULT_MY_FONT.sha256+'.woff2');
const bytes=existsSync(local)?readFileSync(local):Buffer.from(await(await fetch(DEFAULT_MY_FONT.url)).arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'),DEFAULT_MY_FONT.sha256);
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const catalog=JSON.parse(readFileSync(new URL('../world/fonts/catalog.json',import.meta.url),'utf8'));
const chosen=catalog.fonts.find((font:any)=>font.sha256===DEFAULT_MY_FONT.sha256);
const oldKey=hash('visitor:旧笔迹'),validKey=hash('visitor:不变的笔迹');
writeFileSync(join(directory,'bottle-font-map.json'),JSON.stringify({version:1,assignments:{[oldKey]:'removed-font.ttf',[validKey]:chosen.name}}));
const fonts=new LetterFonts(directory),hints:string[][]=[];
const s:PageSnapshot={draft:null,held:null,sent:[],received:[
 {letterId:'old',from:'旧笔迹',body:'测试信件，无真实内容。',topic:'字体测试',at:'',outcome:'kept'},
 {letterId:'valid',from:'不变的笔迹',body:'保留有效笔迹。',at:'',outcome:'kept'}],quota:null,online:true,botName:'测试 Coo'};
const ok=async()=>({ok:true});
const deps:PageDeps={snapshot:ids=>{hints.push([...(ids??[])]);return fonts.decorate(s,ids);},request:ok,send:ok,rewrite:ok,dismiss:ok,keep:ok,peruse:ok,discard:ok,open:ok,forget:ok};
const setup=`<script>
Object.defineProperty(document,'hidden',{value:false,configurable:true});
window.__fontRequests=[];window.__fontErrors=[];window.__fontDeadline=[];
window.addEventListener('error',e=>window.__fontErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>window.__fontErrors.push(String(e.reason)));
const actualFetch=window.fetch.bind(window),timeout=AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout=function(ms){window.__fontDeadline.push(ms);return timeout(ms);};
window.fetch=function(url,options){
 if(String(url).startsWith('https://fontsforletters.sqnori.com/fonts/')){
  window.__fontRequests.push(String(url));
  if(sessionStorage.getItem('offline'))return Promise.reject(Error('fixture offline'));
  return actualFetch('/fixture-font?slow=1',options);
 }
 return actualFetch(url,options);
};
</script>`;
const handler=pageHandler(deps);
function makeServer(){return createServer((req,res)=>{
 if(req.url?.startsWith('/fixture-font')){
  const send=()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'font/woff2','content-length':bytes.length});res.end(bytes);}};
  if(req.url.includes('slow=1')){const timer=setTimeout(send,21000);res.on('close',()=>clearTimeout(timer));}else send();return;
 }
 if(req.url==='/fixture'){
  res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><iframe id="mailbox" src="/prime" style="width:600px;height:800px"></iframe>');return;
 }
 if(req.url==='/prime'){
  res.setHeader('content-type','text/html;charset=utf-8');res.end(`<script>(async()=>{const bytes=await(await fetch('/fixture-font')).arrayBuffer();const r=indexedDB.open('bottle-letter-fonts',1);r.onupgradeneeded=()=>r.result.createObjectStore('fonts');r.onsuccess=()=>{const db=r.result,tx=db.transaction('fonts','readwrite');tx.objectStore('fonts').put(bytes,${JSON.stringify(DEFAULT_MY_FONT.url)});tx.oncomplete=()=>{db.close();location.href='/';};};})()</script>`);return;
 }
 if(req.url==='/'){res.setHeader('content-type','text/html;charset=utf-8');res.end(pageHtml().replace('<head>','<head>'+setup));return;}
 handler(req,res);
});}
const servers=[makeServer(),makeServer()];
for(const server of servers)await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const urls=servers.map(server=>'http://127.0.0.1:'+(server.address() as {port:number}).port);
async function rpc(path:string,body?:string){const r=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body});const value=await r.json() as any;if(value.error)throw Error(JSON.stringify(value.error));return value;}
const tabs:string[]=[];
const evaluate=async(target:string,code:string)=>(await rpc('/eval?target='+target,code)).value;
const child=(code:string)=>'document.getElementById("mailbox").contentWindow.eval('+JSON.stringify(code)+')';
async function until(target:string,code:string){for(let n=0;n<160;n++){if(await evaluate(target,code))return;await new Promise(done=>setTimeout(done,250));}throw Error('Browser did not settle: '+code);}
try{
 tabs.push((await rpc('/new',urls[0]+'/fixture')).targetId);
 await until(tabs[0],child("!!document.querySelector('.mail .letter')"));
 await until(tabs[0],child("Array.from(document.fonts).some(f=>f.family==='bottle-"+chosen.id+"'&&f.status==='loaded')"));
 assert.ok(hints[0].includes(chosen.sha256));
 assert.equal(fonts.decorate(s).received[0].fontId,chosen.id);
 const dictionary=JSON.parse(readFileSync(join(directory,'bottle-font-map.json'),'utf8'));
 assert.equal(dictionary.assignments[oldKey],chosen.name);assert.equal(dictionary.assignments[validKey],chosen.name);
 assert.equal(await evaluate(tabs[0],child("window.__fontRequests.length")),0);
 await evaluate(tabs[0],child("sessionStorage.setItem('offline','1');location.reload();true"));
 await until(tabs[0],child("Array.from(document.fonts).some(f=>f.family==='bottle-"+chosen.id+"'&&f.status==='loaded')"));
 assert.equal(await evaluate(tabs[0],child("window.__fontRequests.length")),0);
 console.log('PASS: removed binding repaired from browser cache, valid mapping unchanged, offline reload stable.');
 tabs.push((await rpc('/new',urls[1]+'/')).targetId);
 await until(tabs[1],"window.__fontRequests?.length>0 && !!document.querySelector('.letter')");
 assert.ok((await evaluate(tabs[1],'window.__fontDeadline')).includes(180000));
 // Observe an actual 21s response. Keep individual waits below 60s.
 await until(tabs[1],"Array.from(document.fonts).some(f=>f.family==='bottle-"+chosen.id+"'&&f.status==='loaded')");
 assert.equal(new LetterFonts(directory).decorate(s).received[0].fontId,chosen.id);
 assert.deepEqual(await evaluate(tabs[1],'window.__fontErrors'),[]);
 await evaluate(tabs[1],"window.__cacheProbe=null;const r=indexedDB.open('bottle-letter-fonts',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('fonts','readonly'),q=tx.objectStore('fonts').count();q.onsuccess=()=>window.__cacheProbe=q.result;tx.oncomplete=()=>db.close();};true");
 await until(tabs[1],'window.__cacheProbe>0');
 console.log('PASS: separate browser origin completes 21s font download, decodes and caches, preserves shared assignment.');
}finally{
 for(const tab of tabs)await rpc('/close?target='+tab).catch(()=>{});
 for(const server of servers){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
 rmSync(directory,{recursive:true,force:true});
}
