import {readLocalDocument} from '../world/local-db.ts';
/** Synthetic panel -> real World RPC -> own snapshot -> standalone mailbox. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {makeHarness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {readHostTheme,HOST_THEME_KEYS} from '../world/host-theme.ts';
import {saveThemePreference} from '../world/theme.ts';
const h=makeHarness({port:0,config:{surface:'page'}});await h.world.start(new FakeHost());
const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const palette=Object.fromEntries(HOST_THEME_KEYS.map(key=>[key,key==='ink'?'#f1f6ff':key==='paper'?'#123456':key==='sheet'?'#23344a':'#abcdee']));
let requests=0,unavailable=false;
const html=`<!doctype html><html style="color-scheme:dark;${Object.entries(palette).map(([key,value])=>'--'+key+':'+value).join(';')}"><meta charset="utf-8"><div id="root"></div><script type="module">
import bundle from '/client.js';const abort=new AbortController();window.errors=[];addEventListener('error',e=>errors.push(e.message));
window.open=()=>({opener:window,closed:false,location:{replace:url=>{window.__bottleTestTarget=url}},close(){},document:{createElement:()=>({}),head:{append(){}}}});
const ctx={language:'zh',root:document.getElementById('root'),signal:abort.signal,invoke:async(method,args=[])=>{const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args})});if(!r.ok)throw Error();return r.json()},refresh:async()=>{},interval:()=>{},setConfig:async()=>{},own:x=>x,timeout:(fn,ms)=>({dispose(){},id:setTimeout(fn,ms)}),
ui:{h:(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n},button:(label,opts)=>{const n=document.createElement('button');n.textContent=label;n.onclick=opts.onClick;return n}}};
await bundle.panels.mailbox.mount(ctx);window.ready=true;
</script>`;
const server=createServer((req,res)=>{
  res.setHeader('cache-control','no-store');
  if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
  if(req.url==='/client.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(new URL('../'+manifest.cortico.webUiClient,import.meta.url)));return;}
  if(req.url==='/api/theme'){requests++;res.setHeader('content-type','application/json');res.statusCode=unavailable?503:200;res.end(JSON.stringify({theme:{selectedId:'mint',mode:'dark',custom:[{note:'DO-NOT-STORE'}]}}));return;}
  if(req.url==='/rpc'){let body='';req.on('data',data=>body+=data);req.on('end',()=>{void(async()=>{const {method,args}=JSON.parse(body);const result=await h.world.webUi().invoke!('mailbox',method,args);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));})().catch(()=>{res.statusCode=500;res.end('{}')});});return;}
  res.statusCode=404;res.end();
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
const tabs:string[]=[];
async function rpc(path:string,body?:string):Promise<any>{const r=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body});const data=await r.json();if(data.error)throw Error(JSON.stringify(data.error));return data;}
async function open(url:string){const id=(await rpc('/new',url)).targetId;tabs.push(id);return id;}
const evaluate=async(id:string,code:string)=>(await rpc('/eval?target='+id,code)).value;
async function until(id:string,code:string){for(let n=0;n<80;n++){try{if(await evaluate(id,code))return;}catch{}await new Promise(done=>setTimeout(done,100));}throw Error('Fixture did not settle: '+code);}
try{
  saveThemePreference(h.dir,{theme:'host',mode:'light'});
  const panel=await open(base);await until(panel,'window.ready===true');
  await evaluate(panel,"document.querySelector('.bottle-open-mailbox').click();true");
  await until(panel,'!!window.__bottleTestTarget');
  const target=await evaluate(panel,'window.__bottleTestTarget');assert.equal(target,Reflect.get(h.world,'page').url);
  const snapshot=readHostTheme(h.dir)!;assert.equal(snapshot.selectedId,'mint');assert.equal(Object.keys(snapshot.palette).length,14);
  assert.ok(!JSON.stringify(readLocalDocument(join(h.dir,'bottle-host-theme.json'))).includes('DO-NOT-STORE'));
  assert.equal(await evaluate(panel,"document.querySelector('.bottle-host-theme-note')"),null);
  await rpc('/close?target='+panel);tabs.splice(tabs.indexOf(panel),1);
  const mailbox=await open(target);await until(mailbox,"document.documentElement.dataset.theme==='host'");
  assert.equal(await evaluate(mailbox,'document.documentElement.dataset.appearance'),'dark');
  assert.equal(await evaluate(mailbox,"getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()"),'#123456');
  await evaluate(mailbox,'location.reload();true');await until(mailbox,"document.getElementById('theme-sync-note')?.textContent.includes('mint')");
  assert.equal(requests,1,'standalone reload must not query the host');
  const before=JSON.stringify(readLocalDocument(join(h.dir,'bottle-host-theme.json')));unavailable=true;
  const failed=await open(base);await until(failed,'window.ready===true');await evaluate(failed,"document.querySelector('.bottle-open-mailbox').click();true");await until(failed,'!!window.__bottleTestTarget');
  assert.equal(JSON.stringify(readLocalDocument(join(h.dir,'bottle-host-theme.json'))),before);
  assert.deepEqual(await evaluate(failed,'window.errors'),[]);
  console.log('PASS: built panel captures 14 colors, RPC saves before mailbox navigation, independent refresh retains colors after panel closure, host failure preserves last snapshot');
}finally{
  for(const tab of tabs)await rpc('/close?target='+tab).catch(()=>{});
  server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
  assert.ok(resolve(h.dir).startsWith(resolve(tmpdir())+sep+'bottle-world-'));await h.stop();
}
