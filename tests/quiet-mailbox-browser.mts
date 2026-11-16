import {createServer} from 'node:http';
/** Synthetic letterbook only; no real deployment or correspondence. */
import assert from 'node:assert/strict';
import {makeHarness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {LocalStore} from '../world/store.ts';

const h=makeHarness({port:0,config:{randomWake:false},fetchImpl:async input=>{
  const path=new URL(String(input)).pathname;
  if(path==='/register')return new Response(JSON.stringify({token:'fixture',pseudonym:'Fixture'}));
  if(path==='/sync')return new Response(JSON.stringify({syncVersion:1,quota:{bottles_left:2,catches_left:2,replies_left:2},mailbox:[],notes:[],systemMail:null,noteAcks:[]}));
  return new Response('{}',{status:404});
}});
let tab:string|undefined;
let mailboxUrl='';
const wrapper=createServer((req,res)=>{void(async()=>{
  if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<iframe id=mailbox src=/mailbox style="border:0;width:1040px;height:1600px"></iframe>');return;}
  const upstream=await fetch(new URL(req.url==='/mailbox'?'/':req.url!,mailboxUrl));res.statusCode=upstream.status;res.setHeader('content-type',upstream.headers.get('content-type')??'application/octet-stream');res.end(Buffer.from(await upstream.arrayBuffer()));
})().catch(()=>{res.statusCode=500;res.end();});});
async function rpc(path:string,body?:string):Promise<any>{const response=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body,signal:AbortSignal.timeout(15000)});const data=await response.json() as any;if(data.error)throw Error(JSON.stringify(data.error));return data;}
const run=async(code:string)=>(await rpc('/eval?target='+tab,"document.getElementById('mailbox').contentWindow.eval("+JSON.stringify(code)+')')).value;
async function until(code:string){for(let n=0;n<100;n++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Browser condition: '+code);}
try{
  await h.world.start(new FakeHost());const store=Reflect.get(h.world,'store') as LocalStore;
  store.addReceived({letterId:'new',from:'Guest',signature:'贝壳',topic:'潮汐',body:'一阵晚风',at:h.clock.t,outcome:'kept',receivedAt:h.clock.t});
  store.addReceived({letterId:'old',from:'Old Guest',body:'从前的一页',at:h.clock.t-86400000,outcome:'kept'});
  const page=Reflect.get(h.world,'page');mailboxUrl=page.url;await new Promise<void>(done=>wrapper.listen(0,'127.0.0.1',done));
  tab=(await rpc('/new','http://127.0.0.1:'+(wrapper.address() as {port:number}).port)).targetId;
  await run("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));true");
  await until("document.querySelectorAll('#mail-list .mail').length===2");
  assert.equal(await run("document.querySelectorAll('#mail-list .received-at').length"),1);
  assert.equal(await run("/\\d{2}:\\d{2}$/.test(document.querySelector('.received-at').textContent)"),true);
  for(const term of ['潮汐','晚风','贝壳']){
    await run(`document.getElementById('letter-search').value=${JSON.stringify(term)};document.getElementById('letter-search').dispatchEvent(new Event('input'));true`);
    assert.equal(await run("document.querySelectorAll('#mail-list .mail').length"),1);
  }
  await run("document.getElementById('letter-search').value='不存在';document.getElementById('letter-search').dispatchEvent(new Event('input'));true");
  assert.equal(await run("document.querySelectorAll('#mail-list .mail').length"),0);
  await run("document.getElementById('letter-search').value='晚风';document.getElementById('letter-search').dispatchEvent(new Event('input'));true");
  const timeStyle=await run("(()=>{const n=document.querySelector('.received-at');return {size:getComputedStyle(n).fontSize,cls:n.className,parent:n.parentElement.className,rules:Array.from(document.styleSheets).flatMap(sheet=>{try{return Array.from(sheet.cssRules)}catch{return []}}).filter(rule=>rule.selectorText&&n.matches(rule.selectorText)&&rule.style?.fontSize).map(rule=>[rule.selectorText,rule.style.fontSize,rule.style.getPropertyPriority('font-size')])}})()");
  assert.ok(timeStyle.rules.some((rule:any[])=>rule[1]==='11px'),JSON.stringify(timeStyle));
  assert.ok(parseFloat(timeStyle.size)<=15,'Respect the browser minimum font size while keeping the timestamp subordinate.');
  const layouts=[];
  for(const width of [1040,390,320]){
    await rpc('/eval?target='+tab,`document.getElementById('mailbox').style.width='${width}px';true`);
    const result=await run("(()=>{const input=document.getElementById('letter-search'),rect=input.getBoundingClientRect();return {width:document.body.clientWidth,inputWidth:rect.width,inside:rect.left>=0&&rect.right<=document.body.clientWidth+2,fontSize:parseFloat(getComputedStyle(document.querySelector('.received-at')||input).fontSize)}})()");
    assert.equal(result.inside,true,JSON.stringify(result));layouts.push(result);
  }
  assert.equal(store.received.length,2);
  console.log(JSON.stringify({browser:true,synthetic:true,localSearch:true,knownReceptionOnly:true,layouts}));
}finally{if(tab)await rpc('/close?target='+tab).catch(()=>undefined);wrapper.closeAllConnections();await new Promise<void>(done=>wrapper.close(()=>done()));await h.stop();}
