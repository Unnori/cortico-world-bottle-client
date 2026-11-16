/** Real DOM + official UI helpers + World RPC. Synthetic letters only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep,join} from 'node:path';
import ts from 'typescript';
import {gunzipSync} from 'node:zlib';
import {makeHarness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {captureBackup} from '../world/data-backup.ts';
import {readLocalDocument,putAsset,digest,readSetting} from '../world/local-db.ts';
import {LocalStore} from '../world/store.ts';
import {MAILBOX_PALETTES} from '../world/appearance.ts';

const h=makeHarness({port:0,config:{randomWake:false}}),source=makeHarness({port:0,config:{randomWake:false}});
const host=new FakeHost();await h.world.start(host);await source.world.start(new FakeHost());
await Reflect.get(h.world,'syncPending');await Reflect.get(source.world,'syncPending');
const store=Reflect.get(h.world,'store')as LocalStore,sourceStore=Reflect.get(source.world,'store')as LocalStore;
store.addReceived({letterId:'local',from:'Current',body:'本机已有的一封信',at:h.clock.t,outcome:'kept'});
sourceStore.addSent({letterId:'backup-sent',body:'备份带来的信',at:h.clock.t});
sourceStore.addReceived({letterId:'backup-system',from:'Post',body:'备份里的系统信',at:h.clock.t,outcome:'kept',seed:true});
const bytes=Buffer.from('RIFF0000WAVEbrowser-custom'),audioId=digest(bytes)+'.wav';putAsset(source.dir,{kind:'sound',id:audioId,name:'自己的声音.wav',mime:'audio/wav',bytes,metadata:{}});
const backup=captureBackup(source.dir),empty={...backup,archive:{...backup.archive,entries:[]},drafts:[],assets:[],settings:{}};
const framework=resolve('node_modules/cortico/src'),manifest=JSON.parse(readFileSync('package.json','utf8'));
const palette=Object.fromEntries(Object.entries(MAILBOX_PALETTES.ocean).map(([mode,p])=>[mode,{...p,sheet:p.card,'sheet-2':p.panel,'sheet-3':p.soft,'ink-soft':p.muted,'line-2':p.line,'line-strong':p.line}]));
const html=`<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/client.css"><style>*,*::before,*::after{box-sizing:border-box}body{display:block;overflow:auto;margin:0;padding:16px;background:var(--paper);color:var(--ink)}#root{container:webui-content / inline-size;width:100%;max-width:1080px;margin:auto}</style><div id="root"></div><script type="module">
import {mountDataManager} from '/client.js';import {h} from '/framework/web/client/ui/dom.ts';import {button} from '/framework/web/client/ui/sheet.ts';import {Lifecycle} from '/framework/web/client/core/lifecycle.ts';
window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));const life=new Lifecycle(e=>errors.push(String(e)));
const originalCreate=URL.createObjectURL.bind(URL);window.blobs=[];URL.createObjectURL=blob=>{window.blobs.push(blob);return originalCreate(blob)};const oldClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.downloadName=this.download;return;}oldClick.call(this)};
const ctx={language:'zh',root:document.getElementById('root'),signal:life.signal,ui:{h:(...args)=>h(document,...args),button:(label,opts)=>button(document,life.signal,label,opts)},invoke:async(method,args=[])=>{const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args})});const data=await r.json();if(!r.ok)throw Error(data.message);return data;},timeout:(fn,ms)=>life.timeout(fn,ms),own:x=>life.own(x)};
mountDataManager(ctx);window.ready=true;window.setTheme=mode=>{for(const [key,value]of Object.entries((${JSON.stringify(palette)})[mode]))document.documentElement.style.setProperty('--'+key,value);document.documentElement.style.colorScheme=mode};window.setTheme('light');addEventListener('pagehide',()=>life.dispose());
</script></html>`;
const server=createServer((req,res)=>{void(async()=>{
  const path=req.url?.split('?')[0];res.setHeader('cache-control','no-store');
  if(path==='/fixture'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<iframe id="panel" src="/" style="border:0;width:1040px;height:1700px"></iframe>');return;}
  if(path==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
  if(path==='/client.js'||path==='/client.css'){res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(path.endsWith('.js')?manifest.cortico.webUiClient:manifest.cortico.webUiStyle));return;}
  if(path==='/styles.css'){res.setHeader('content-type','text/css');res.end(readFileSync(resolve(framework,'web/public/styles.css'),'utf8').replace('@import "tailwindcss";',''));return;}
  if(path?.startsWith('/framework/')){const file=resolve(framework,decodeURIComponent(path.slice(11))),rel=relative(framework,file);if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||!file.endsWith('.ts')){res.statusCode=404;res.end();return;}res.setHeader('content-type','text/javascript');res.end(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);return;}
  if(path==='/rpc'){let body='';for await(const chunk of req)body+=chunk;const {method,args}=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify(await h.world.webUi().invoke!('mailbox',method,args)));return;}
  res.statusCode=404;res.end();
})().catch(error=>{res.statusCode=400;res.end(JSON.stringify({message:error.message}));});});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));let tab:string|undefined;
async function rpc(path:string,body?:string):Promise<any>{const res=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body,signal:AbortSignal.timeout(20000)});const data=await res.json();if(Object.hasOwn(data,'error'))throw Error(JSON.stringify(data.error));return data;}
const evaluate=async(code:string)=>(await rpc('/eval?target='+tab,code)).value;
const panel=(code:string)=>evaluate("document.getElementById('panel').contentWindow.eval("+JSON.stringify(code)+')');
async function until(code:string){for(let n=0;n<100;n++){try{if(await panel(code))return;}catch{}await new Promise(done=>setTimeout(done,100));}throw Error('Timed out '+code+' errors='+await panel('JSON.stringify(window.errors)'));}
const click=async(text:string)=>panel(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click();true`);
async function choose(document:unknown){await panel(`(()=>{const input=document.querySelector('.bottle-data-card input[type=file]'),data=new DataTransfer();data.items.add(new File([${JSON.stringify(JSON.stringify(document))}],'synthetic.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change'));return true;})()`);await until("!document.querySelector('.bottle-data-comparison').hidden && document.querySelector('.bottle-data-card').getAttribute('aria-busy')!=='true'");}
try{
  console.log('browser: opening synthetic panel');
  tab=(await rpc('/new','http://127.0.0.1:'+(server.address()as{port:number}).port+'/fixture')).targetId;
  console.log('browser: checking panel ready');
  await until("window.ready && document.querySelector('.bottle-data-note').textContent.includes('SQLite')");
  assert.equal(await panel("document.querySelectorAll('.bottle-data-types input:checked').length"),10);
  console.log('browser: export');
  await click('导出备份');await until('window.blobs.length===1 && document.querySelector(\'.bottle-data-card\').getAttribute(\'aria-busy\')!==\'true\'');
  const encoded=await panel("window.blobs[0].arrayBuffer().then(b=>{const bytes=new Uint8Array(b);let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)})");
  const exported=JSON.parse(gunzipSync(Buffer.from(encoded,'base64')).toString());assert.equal(exported.archive.entries[0].value.body,'本机已有的一封信');assert.match(await panel('window.downloadName'),/明文请勿转发/);
  console.log('browser: preview and cancel');
  await choose(backup);assert.equal(await panel("document.querySelector('.bottle-data-comparison tbody tr:last-child').innerText.replace(/\\s+/g,' ').trim()"),'合计 1 2');assert.equal(store.received.length,1);
  await click('保留本机，不导入');await until("document.querySelector('.bottle-data-comparison').hidden");assert.equal(store.sent.length,0);
  console.log('browser: merge');
  await choose(backup);await click('合并，本机已有优先');await until("document.querySelector('.bottle-data-note[aria-live]').textContent.includes('已合并')");assert.equal(store.sent.length,1);assert.equal(store.received.length,2);
  console.log('browser: replace');
  await choose(empty);await click('使用备份，替换所选类别');await until("document.querySelector('.bottle-data-note[aria-live]').textContent.includes('已替换')");assert.equal(store.sent.length,0);assert.equal(store.received.length,0);assert.ok(await panel("document.querySelectorAll('.bottle-data-backup-row').length>=1"));
  const layouts=[];for(const width of [1040,390,320])for(const mode of ['light','dark']){console.log('browser: layout',width,mode);await evaluate(`document.getElementById('panel').style.width='${width}px';true`);await panel(`window.setTheme('${mode}');true`);const result=await panel("(()=>{const card=document.querySelector('.bottle-data-card');return {width:innerWidth,body:document.documentElement.scrollWidth,card:card.getBoundingClientRect().width,types:getComputedStyle(document.querySelector('.bottle-data-types')).gridTemplateColumns}})()");assert.ok(result.body<=width+2,JSON.stringify(result));assert.ok(result.card>=width-70,JSON.stringify(result));layouts.push({...result,mode});}
  assert.deepEqual(await panel('window.errors'),[]);
  const dir=resolve('../../artifacts/validation');mkdirSync(dir,{recursive:true});await panel("document.querySelector('.bottle-data-card').scrollIntoView();true");
  if(process.argv.includes('--screenshot'))await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(join(dir,'bottle-data-backup-browser.png')));
  const report={synthetic:true,officialUi:true,exportDownload:true,previewCancel:true,merge:true,replacementWithBackup:true,layouts};writeFileSync(join(dir,'bottle-data-backup-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(tab)await rpc('/close?target='+tab).catch(()=>{});server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await h.stop();await source.stop();}
