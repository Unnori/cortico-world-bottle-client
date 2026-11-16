/** Real mailbox DOM with synthetic data and suspended transport; no user instance. */
import assert from 'node:assert/strict';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';

let releaseRegistration!:()=>void,releaseQuota!:()=>void;
const registration=new Promise<void>(resolve=>releaseRegistration=resolve);
const quota=new Promise<void>(resolve=>releaseQuota=resolve);
const requests=new Map<string,number>();
let failSend=true,h:Harness;
h=makeHarness({port:0,config:{randomWake:false},fetchImpl:async(input,init)=>{
  const url=new URL(String(input));
  if(url.hostname!=='127.0.0.1')return new Response('{}',{status:404});
  const path=url.pathname;requests.set(path,(requests.get(path)??0)+1);
  if(path==='/register')await registration;
  if(path==='/quota')await quota;
  if(path==='/throw'&&failSend)return new Response('Synthetic lost upstream response',{status:502});
  const auth=(init?.headers as Record<string,string>|undefined)?.authorization??'';
  const result=h.api.handle({path,method:init?.method??'GET',ip:'127.0.0.1',token:auth.startsWith('Bearer ')?auth.slice(7):undefined,
    body:init?.body?JSON.parse(String(init.body)):undefined});
  return new Response(JSON.stringify(result.body),{status:result.status,headers:{'content-type':'application/json'}});
}});
let tab:string|undefined;
async function rpc(path:string,body?:string):Promise<any>{
  const response=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body,signal:AbortSignal.timeout(15000)});
  const data=await response.json() as any;if(data.error)throw Error(JSON.stringify(data.error));return data;
}
const evaluate=async(code:string)=>(await rpc('/eval?target='+tab,code)).value;
async function until(code:string){
  for(let n=0;n<100;n++){
    if(await evaluate(code))return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const diagnostics=await evaluate(`({url:location.href,title:document.title,body:document.body?.innerText?.slice(0,2000),visibility:document.visibilityState,resources:performance.getEntriesByType('resource').slice(-12).map(r=>({name:r.name,duration:r.duration}))})`);
  throw Error('Mailbox DOM did not settle: '+code+'; diagnostics='+JSON.stringify(diagnostics));
}
const body='LOCAL_DRAFT_VISIBLE_WITHOUT_THE_SEA';
const clickSend="Array.from(document.querySelectorAll('#stage button')).find(button=>button.textContent.trim()==='寄出去').click();true";
try{
  await h.world.start(new FakeHost());
  assert.match(await callTool(h.world,'bottle_write',{text:body}),/草稿已放进信箱/);
  const status=await h.world.webUi().invoke!('mailbox','status',[]) as {url:string};
  const started=Date.now();
  tab=(await rpc('/new',status.url)).targetId;
  // Keep the user's foreground tab untouched; emulate a visible test document.
  await evaluate("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));true");
  await until(`document.getElementById('stage')?.textContent.includes(${JSON.stringify(body)})`);
  const initialRenderMs=Date.now()-started;
  assert.equal(requests.get('/register'),1);
  assert.equal(h.world.pageDeps().snapshot().quota,null);
  assert.equal(await evaluate("document.getElementById('tide').textContent.includes('还没连上海边')"),true);

  releaseRegistration();
  await until("document.getElementById('stage').textContent.includes('"+body+"')");
  const previousOrigin=await evaluate('performance.timeOrigin');
  await evaluate('location.reload();true');
  await until(`performance.timeOrigin!==${previousOrigin}&&document.readyState==='complete'`);
  await evaluate("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));true");
  await until(`document.getElementById('stage')?.textContent.includes(${JSON.stringify(body)})`);
  assert.equal(h.world.pageDeps().snapshot().quota,null,'quota is still suspended after reload');
  // Each page separately fetches announcements through /quota as before; that
  // request must not be mistaken for the coalesced local-view refresh.
  assert.ok(Reflect.get(h.world,'quotaRefresh'),'the normal quota query is still pending');

  releaseQuota();
  await until("document.getElementById('tide')?.textContent.includes('今天还能寄')");
  await evaluate(clickSend);
  await until("document.body.textContent.includes('寄送结果待确认')");
  assert.equal(await evaluate(`document.getElementById('stage').textContent.includes(${JSON.stringify(body)})`),true);
  assert.equal(requests.get('/throw'),1);
  failSend=false;
  await until("Array.from(document.querySelectorAll('#stage button')).some(button=>button.textContent.trim()==='寄出去'&&!button.disabled)");
  await evaluate(clickSend);
  await until("document.querySelector('[data-category=sent] b')?.textContent==='1'");
  assert.equal(h.world.pageDeps().snapshot().letterDraft,null);
  assert.equal(h.world.pageDeps().snapshot().sent[0]?.body,body);
  assert.equal(await evaluate(`document.getElementById('stage').textContent.includes(${JSON.stringify(body)})`),false);
  console.log(JSON.stringify({browser:true,synthetic:true,initialRenderMs,visibleDuringRegistration:true,
    visibleDuringQuotaAndReload:true,backgroundRecovery:true,failedSendRetainsDraft:true,explicitSuccessfulSendMovesToHistory:true}));
}finally{
  if(tab)await rpc('/close?target='+tab).catch(()=>undefined);
  releaseRegistration();releaseQuota();await new Promise(resolve=>setImmediate(resolve));await h.stop();
}
