/** Isolated browser checks: never loads the user's letters or restarts their World. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeHarness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';

const h = makeHarness({config:{lanEnabled:true,lanPort:0}});
await h.world.start(new FakeHost());
const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const app = `<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>
*{box-sizing:border-box}body{margin:0;padding:16px;font:14px/1.6 system-ui;background:var(--sheet-1);color:var(--ink);--sheet-1:#f6f8fc;--sheet-2:#fff;--ink:#233b54;--ink-soft:#526a80;--line-2:#cad5e1;--accent:#3d679b}body.dark{--sheet-1:#161e2a;--sheet-2:#202d3d;--ink:#eef4ff;--ink-soft:#b8cbe0;--line-2:#47607c}button{padding:8px 14px;background:var(--sheet-2);color:var(--ink);border:1px solid var(--line-2);border-radius:6px;cursor:pointer}h3{font-size:18px}</style>
<div id="root"></div><script type="module">
import bundle from '/client.js';const abort=new AbortController();
const ctx={language:'zh',root:document.getElementById('root'),signal:abort.signal,
invoke:async(method,args=[])=>{const res=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args})});if(!res.ok)throw Error();return res.json()},
refresh:async()=>{},interval:()=>{},setConfig:async()=>{},
ui:{h:(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n},button:(text,opts)=>{const n=document.createElement('button');n.textContent=text;n.onclick=opts.onClick;return n}}};
await bundle.panels.mailbox.mount(ctx);window.ready=true;
</script></html>`;
const server=createServer((req,res)=>{
 res.setHeader('cache-control','no-store');
 if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<iframe id="panel" src="/panel" style="border:0;width:1000px;height:1250px"></iframe>');return;}
 if(req.url==='/panel'){res.setHeader('content-type','text/html; charset=utf-8');res.end(app);return;}
 if(req.url==='/client.js'||req.url==='/style.css'){res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(new URL('../'+manifest.cortico[req.url.endsWith('.js')?'webUiClient':'webUiStyle'],import.meta.url)));return;}
 if(req.url==='/rpc'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{void(async()=>{const {method,args}=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify(await h.world.webUi().invoke!('mailbox',method,args)));})().catch(()=>{res.statusCode=500;res.end('{}')})});return;}
 res.statusCode=404;res.end();
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const port=(server.address() as {port:number}).port;
const proxy='http://localhost:3456';let tab:string|undefined;
const sleep=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function rpc(path:string,body?:string){const res=await fetch(proxy+path,{method:body===undefined?'GET':'POST',body});const data=await res.json() as any;if(data.error)throw Error(JSON.stringify(data.error));return data;}
async function evaluate(code:string){return (await rpc('/eval?target='+tab,code)).value;}
async function panel(code:string){return evaluate(`document.getElementById('panel').contentWindow.eval(${JSON.stringify(code)})`);}
async function until(code:string){for(let n=0;n<60;n++){if(await evaluate(code))return;await sleep(150)}throw Error('Browser did not settle');}
try {
 tab=(await rpc('/new',`http://127.0.0.1:${port}/`)).targetId;
 await until("document.getElementById('panel')?.contentWindow.ready");
 assert.equal(await panel("document.getElementById('root').lastElementChild.classList.contains('bottle-archive-tools')"),true);
 assert.equal(await panel("document.querySelector('.bottle-archive-tools').open"),false);
 await panel("window.backupBlob=null;window.backupName=null;URL.createObjectURL=function(b){window.backupBlob=b;return 'blob:fixture'};URL.revokeObjectURL=function(){};HTMLAnchorElement.prototype.click=function(){window.backupName=this.download};document.querySelector('.bottle-archive-tools').open=true;Array.from(document.querySelectorAll('.bottle-archive-tools button')).find(b=>b.textContent==='导出信册').click();true");
 await until("!!document.getElementById('panel').contentWindow.backupBlob");
 assert.match(await panel('window.backupName'),/明文请勿转发/);
 assert.equal(await panel("window.backupBlob.text().then(t=>JSON.parse(t).schemaVersion)"),1);
 await panel("(async()=>{var file=new File([await window.backupBlob.text()],'book.json',{type:'application/json'}),dt=new DataTransfer();dt.items.add(file);var input=document.querySelector('.bottle-archive-tools input');input.files=dt.files;input.dispatchEvent(new Event('change'));return true})()");
 await until("document.getElementById('panel').contentDocument.querySelector('.bottle-archive-result').textContent.includes('合并了')");
 await panel("document.querySelector('.bottle-archive-tools').open=false;true");
 assert.equal(await panel("document.querySelectorAll('.bottle-lan-qr img').length"),0);
 await panel("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='显示配对二维码').click();true");
 await until("document.getElementById('panel').contentDocument.querySelector('.bottle-lan-qr img')?.complete");
 for(const width of [1000,390]){
  await evaluate(`document.getElementById('panel').style.width='${width}px';true`);
  for(const dark of [false,true]){
   await panel(`document.body.classList.toggle('dark',${dark});true`);
   const layout=await panel("(()=>{const img=document.querySelector('.bottle-lan-qr img'),warning=document.querySelector('.bottle-lan-warning'),s=getComputedStyle(warning);return{overflow:document.documentElement.scrollWidth>innerWidth,qr:img.naturalWidth,warning:s.color,background:s.backgroundColor}})()");
   assert.equal(layout.overflow,false,`No overflow at ${width}, dark=${dark}`);assert.ok(layout.qr>=224);assert.notEqual(layout.warning,'rgb(0, 0, 0)');
   assert.equal(await panel("document.querySelectorAll('.bottle-lan-qr img').length"),1);
   const positions=await panel("(()=>{const a=document.querySelector('.bottle-lan-settings').getBoundingClientRect(),b=document.querySelector('.bottle-lan-pairing').getBoundingClientRect();return{a:{top:a.top,bottom:a.bottom,right:a.right},b:{top:b.top,left:b.left}}})()");
   if(width===1000)assert.ok(positions.b.left>positions.a.right,'Wide layout has separated columns');
   else assert.ok(positions.b.top>=positions.a.bottom,'Narrow layout stacks sections');
  }
 }
 const output=resolve('../../scratch/bottle-lan');mkdirSync(output,{recursive:true});
 await panel("document.querySelector('.bottle-lan-card').scrollIntoView();true");
 if(process.env.BOTTLE_BROWSER_SCREENSHOTS !== '0') await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(resolve(output,'mobile.png')));
 await evaluate("document.getElementById('panel').style.width='1000px';true");
 await panel("document.querySelector('.bottle-lan-card').scrollIntoView();true");
 if(process.env.BOTTLE_BROWSER_SCREENSHOTS !== '0') await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(resolve(output,'desktop.png')));
 // Use the generated QR destination, including the actual local interface address.
 const pairUrl=await panel("document.querySelector('.bottle-lan-qr input').value");
 await rpc('/navigate?target='+tab,pairUrl);
 await until("location.pathname==='/' && !!document.getElementById('bottle-mailbox')");
 assert.equal(await evaluate("location.hash"),'');
 assert.equal(await evaluate("document.cookie.includes('bottle_lan_')"),false,'Session stays HttpOnly');
 assert.equal(await evaluate("fetch('/draft').then(r=>r.status)"),200);
 await rpc('/navigate?target='+tab,new URL('/',pairUrl).href);
 await until("!!document.getElementById('bottle-mailbox')");
 assert.equal(await evaluate("fetch('/draft').then(r=>r.status)"),200,'Cookie reused');
 await h.world.webUi().invoke!('mailbox','resetPairing',[]);
 assert.equal(await evaluate("fetch('/draft').then(r=>r.status)"),401,'Reset revokes browser session');
 console.log('PASS: responsive pairing card, light/dark warning, QR link auto-pair, cleared URL fragment, HttpOnly cookie, revisit, and revocation.');
} finally {
 if(tab)await rpc('/close?target='+tab).catch(()=>undefined);
 server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await h.stop();
}
