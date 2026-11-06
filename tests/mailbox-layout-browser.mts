/** Local-only layout and built World panel checks. Uses the installed web-access CDP proxy. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { makeHarness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const h = makeHarness({ port: 18884, fetchImpl: async () => new Response('{}', { status: 503 }), config: { randomWake: false } });
const fixture = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/panel.css"><style>body{background:#f7f2e8;color:#352f28;--ink:#352f28;--muted:#756147;--ink-soft:#756147;--sheet:#fffaf1;--sheet-2:#fffaf1;--sheet-3:#f2e6cc;--line-2:#dacdb7;max-width:850px;margin:20px auto;font:14px sans-serif}button,input,select{font:inherit}</style><div id="root"></div><script type="module">
import bundle from '/panel.js';
const abort=new AbortController();window.calls=[];window.panelErrors=[];window.downloadName='';
URL.createObjectURL=b=>{window.backupBlob=b;return 'blob:test'};URL.revokeObjectURL=()=>{};
HTMLAnchorElement.prototype.click=function(){window.downloadName=this.download};
const ui={h:(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n},button:(label,opts)=>{const b=document.createElement('button');b.textContent=label;b.onclick=opts.onClick;return b}};
const ctx={root:document.getElementById('root'),ui,language:'zh',signal:abort.signal,interval:()=>({dispose(){}}),timeout:(fn,ms)=>{const id=setTimeout(fn,ms);return {dispose(){clearTimeout(id)}}},own:r=>r,refresh:async()=>{},invoke:async(method,args)=>{calls.push([method,args]);if(method==='archiveExport')return {schemaVersion:1,entries:[]};if(method==='archiveImport')return {ok:true,message:'合并了 0 封信，本机已有记录优先。'};return {url:'http://127.0.0.1:7796/',version:'0.8.0'};}};
try{await bundle.panels.mailbox.mount(ctx);window.panelReady=true}catch(e){panelErrors.push(String(e))}
</script>`;
const server=createServer((req,res)=>{const path=req.url==='/panel.js'?manifest.cortico.webUiClient:req.url==='/panel.css'?manifest.cortico.webUiStyle:null;res.setHeader('content-type',req.url==='/panel.js'?'text/javascript':req.url==='/panel.css'?'text/css':'text/html;charset=utf-8');res.end(path?readFileSync(path):fixture);});
const rpc=async(path:string,body?:string)=>{const r=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body});const j=await r.json() as any;if(j.error)throw Error(JSON.stringify(j.error));return j;};
let tab:string|undefined;const evaluate=async(code:string)=>(await rpc('/eval?target='+tab,code)).value;
const out=resolve('../../scratch/bottle-080-evidence');mkdirSync(out,{recursive:true});
try {
 await h.world.start(new FakeHost());
 tab=(await rpc('/new',(h.world as any).page.url)).targetId;
 // An actual iframe viewport exercises the CSS media queries without resizing a user's browser.
 await evaluate(`(async()=>{document.querySelector('.shell').hidden=true;document.body.style.padding='0';window.layoutFrame=document.createElement('iframe');layoutFrame.style.cssText='border:0;height:1100px;display:block;margin:auto;';layoutFrame.src=location.href;document.body.prepend(layoutFrame);await new Promise(r=>layoutFrame.onload=r);return true})()`);
 const reports=[];
 for(const width of [1440,1024,960,768,560,390,320]) {
  for(const mode of ['light','dark']) {
   const result=await evaluate(`(async()=>{layoutFrame.style.width='${width}px';const w=layoutFrame.contentWindow,d=w.document;d.getElementById('theme-paper').click();d.getElementById('mode-${mode}').click();d.getElementById('actor-bot').textContent='让 星海里的云汐 来吧';await new Promise(r=>setTimeout(r,350));const rect=s=>{const b=d.querySelector(s).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height}};return {width:w.innerWidth,scroll:d.documentElement.scrollWidth,actor:rect('.actor-switch'),label:rect('#actor-bot'),hint:rect('#actor-hint'),actions:rect('.toolbar .actions'),outcome:rect('.invitation-outcome'),artVisible:w.getComputedStyle(d.querySelector('.hero-art')).display!=='none',postmark:rect('.hero .postmark'),envelope:rect('.envelope-art'),toolbar:rect('.toolbar'),foot:!!d.querySelector('.mailbox-footer #archive-export'),bookHasBackup:!!d.querySelector('#letterbook #archive-export'),color:w.getComputedStyle(d.body).getPropertyValue('--paper').trim()}})()`);
   assert.equal(result.width,width);assert.ok(result.scroll<=width,JSON.stringify({width,mode,result}));
   assert.ok(result.label.height<48,'actor text must not wrap vertically');
   if(result.artVisible){assert.ok(result.postmark.bottom<=result.toolbar.top-8,'rotated postmark clears invitation card');assert.ok(result.envelope.bottom<=result.toolbar.top-8,'envelope clears invitation card '+JSON.stringify({width,mode,envelope:result.envelope,toolbar:result.toolbar}));assert.ok(result.postmark.left>=0&&result.postmark.right<=width,'postmark remains within viewport');}
   assert.ok(result.hint.top>=result.actor.bottom-1,'hint has its own row');
   assert.ok(result.actions.top>=result.hint.bottom-1,'actions follow actor explanation');
   assert.ok(result.outcome.top>=result.actions.bottom-1,'outcome follows actions');
   assert.ok(result.foot&&!result.bookHasBackup,'backup is outside letterbook at bottom');
   assert.equal(result.color,mode==='light'?'#f2e6cc':'#251e16');reports.push({width,mode,pass:true});
  }
 }
 await evaluate(`layoutFrame.style.width='390px';layoutFrame.contentDocument.getElementById('mode-light').click();true`);
 await new Promise(r=>setTimeout(r,600));
 await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(join(out,'layout-mobile.png')));
 await rpc('/close?target='+tab);tab=undefined;
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 tab=(await rpc('/new','http://127.0.0.1:'+(server.address() as any).port)).targetId;
 for(let n=0;n<60&&!await evaluate('window.panelReady');n++)await new Promise(r=>setTimeout(r,50));
 assert.deepEqual(await evaluate('panelErrors'),[]);
 assert.equal(await evaluate(`document.getElementById('root').lastElementChild.className`),'bottle-archive');
 await evaluate(`document.querySelector('.bottle-archive-button').click();true`);await new Promise(r=>setTimeout(r,100));
 assert.match(await evaluate('downloadName'),/明文请勿转发/);
 await evaluate(`const data=new DataTransfer();data.items.add(new File(['{"schemaVersion":1,"entries":[]}'],'backup.json'));const input=document.querySelector('.bottle-archive input');input.files=data.files;input.dispatchEvent(new Event('change'));true`);await new Promise(r=>setTimeout(r,100));
 assert.equal(await evaluate(`document.querySelector('.bottle-archive-result').textContent`),'合并了 0 封信，本机已有记录优先。');
 assert.equal(await evaluate(`calls.some(c=>c[0]==='archiveImport'&&c[1][0].schemaVersion===1)`),true);
 await evaluate(`document.querySelector('.bottle-archive').scrollIntoView();true`);
 await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(join(out,'world-backup-footer.png')));
 console.log('PASS',JSON.stringify(reports),'built World panel footer / JSON download / import RPC');
} finally {if(tab)await rpc('/close?target='+tab);await h.world.stop();server.close();}
