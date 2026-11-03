/** Synthetic loopback fixtures only; no real deployment, letters, identity or external requests. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pageHtml } from '../world/page-view.ts';
import { handlePage, type PageDeps } from '../world/page.ts';
let session='test-world-1', announcementId='notice-1';
const notice=()=>({id:announcementId,text:'海边便笺：可点击的网页 https://example.test/letter',level:'notice' as const,showUntil:'2099-01-01T00:00:00Z'});
const snapshot=()=>({worldSession:session,botName:'Coo',online:true,quota:{bottles_left:3,catches_left:3,replies_left:3},draft:null,letterDraft:null,held:null,received:[],sent:[]});
const deps={snapshot,announcement:async()=>notice()} as unknown as PageDeps;
function fixture(){return createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');
  if(req.url==='/'){
    res.setHeader('content-type','text/html;charset=utf-8');
    const setup='<script>window.FontFace=undefined;Object.defineProperty(document,"hidden",{value:false,configurable:true});Element.prototype.animate=undefined;</script>';
    res.end(pageHtml().replace('<head>','<head>'+setup));return;
  }
  if(req.url==='/icon.png'){res.setHeader('content-type','image/png');res.end(readFileSync(new URL('../world/icon.png',import.meta.url)));return;}
  res.setHeader('content-type','application/json');
  if(req.url==='/draft'||req.url==='/announcement'){const result=await handlePage(deps,'GET',req.url);res.statusCode=result.status;res.end(JSON.stringify(result.json));return;}
  res.end(JSON.stringify(req.url==='/sounds'?{files:[]}:req.url==='/theme'?{available:false}:{}));
});}
const servers=[fixture(),fixture()];
for(const server of servers)await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const urls=servers.map(server=>'http://127.0.0.1:'+(server.address() as {port:number}).port+'/');
async function rpc(path:string,body?:string){const result=await(await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body})).json() as any;if(result.error)throw Error(JSON.stringify(result.error));return result;}
const tabs:string[]=[];
const evaluate=async(target:string,code:string)=>(await rpc('/eval?target='+target,code)).value;
async function until(target:string,code:string){for(let n=0;n<80;n++){try{if(await evaluate(target,code))return;}catch{}await new Promise(done=>setTimeout(done,100));}throw Error('Browser did not settle: '+code);}
const visible='!!document.querySelector("#announcements .announcement")';
try{
  for(const url of [urls[0],urls[0],urls[1]])tabs.push((await rpc('/new',url)).targetId);
  for(const tab of tabs)await until(tab,visible);
  const geometry=await evaluate(tabs[0],`(()=>{const close=document.querySelector('.announcement-close'),svg=close.querySelector('svg');const a=close.getBoundingClientRect(),b=svg.getBoundingClientRect();return {dx:Math.abs(a.x+a.width/2-b.x-b.width/2),dy:Math.abs(a.y+a.height/2-b.y-b.height/2),label:close.getAttribute('aria-label'),link:document.querySelector('.announcement-content a').href}})()`);
  assert.ok(geometry.dx<0.6&&geometry.dy<0.6);assert.match(geometry.label,/关闭公告/);assert.equal(geometry.link,'https://example.test/letter');
  await evaluate(tabs[0],"document.querySelector('.announcement-close').click();true");
  await until(tabs[0],'!document.querySelector("#announcements .announcement")');
  await until(tabs[1],'!document.querySelector("#announcements .announcement")');
  assert.equal(await evaluate(tabs[2],visible),true,'independent origin (other device) remains visible');
  await rpc('/navigate?target='+tabs[0],urls[0]);
  await until(tabs[0],"!!localStorage.getItem('bottle-announcement-dismissed-session') && document.getElementById('tide').textContent.includes('今天还能寄')");
  assert.equal(await evaluate(tabs[0],visible),false,'browser reload keeps dismissal');
  announcementId='a-new-announcement';
  await rpc('/navigate?target='+tabs[0],urls[0]);
  await until(tabs[0],"document.getElementById('tide').textContent.includes('今天还能寄')");
  assert.equal(await evaluate(tabs[0],visible),false,'new announcement does not bypass browser dismissal');
  session='test-world-2';
  // Keep this page open: the next real /draft refresh must observe the new lifetime and restore the banner.
  await until(tabs[0],visible);
  console.log('PASS browser announcement: centered SVG, live links, dismissal survives reload/new IDs, same-browser tabs sync, independent origin stays visible, changed World session restores without reload.');
}finally{
  for(const tab of tabs)await rpc('/close?target='+tab).catch(()=>{});
  for(const server of servers){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
}
