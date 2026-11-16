import {readLocalDocument as sqlRead,writeLocalDocument as sqlWrite,withDatabase as sqlDb,LOCAL_DB_NAME} from '../world/local-db.ts';
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {handlePage,type PageSnapshot} from '../world/page.ts';
import {LocalStore} from '../world/store.ts';

let h:Harness|undefined;
const releases:Array<()=>void>=[];
afterEach(async()=>{
  releases.splice(0).forEach(release=>release());
  // Let synthetic in-flight requests settle before removing their temporary files.
  await new Promise(resolve=>setImmediate(resolve));
  await h?.stop();h=undefined;
});

function rig(blocked?:string){
  const counts=new Map<string,number>(),failures=new Set<string>();
  const gates=new Map<string,Promise<void>>();
  function block(path:string){
    let release!:()=>void;
    gates.set(path,new Promise<void>(resolve=>{release=()=>{gates.delete(path);resolve();};}));
    releases.push(release);return release;
  }
  if(blocked)block(blocked);
  h=makeHarness({port:0,config:{randomWake:false},fetchImpl:async(input,init)=>{
    const path=new URL(String(input)).pathname;
    counts.set(path,(counts.get(path)??0)+1);
    await gates.get(path);
    if(failures.has(path))return new Response(path==='/throw'?'Synthetic upstream lost':JSON.stringify({error:'internal',message:'Synthetic unavailable'}),{status:503});
    const auth=(init?.headers as Record<string,string>|undefined)?.authorization??'';
    const result=h!.api.handle({method:init?.method??'GET',path,ip:'127.0.0.1',
      token:auth.startsWith('Bearer ')?auth.slice(7):undefined,body:init?.body?JSON.parse(String(init.body)):undefined});
    return new Response(JSON.stringify(result.body),{status:result.status,headers:{'content-type':'application/json'}});
  }});
  const world=h.world;
  const view=()=>world.pageDeps().snapshot();
  const status=()=>world.webUi().invoke!('mailbox','status',[]);
  const local=async<T=PageSnapshot>(path='/draft'):Promise<T>=>{
    const result=await status() as {url:string};
    const response=await fetch(new URL(path,result.url),{signal:AbortSignal.timeout(1000)});
    expect(response.status).toBe(200);return await response.json() as T;
  };
  return {world,view,status,local,counts,failures,block,start:()=>world.start(new FakeHost())};
}

it('serves a saved draft over HTTP and the panel URL while first registration is still pending',async()=>{
  const r=rig('/register');await r.start();
  await vi.waitFor(()=>expect(r.counts.get('/register')).toBe(1));
  expect(await callTool(r.world,'bottle_write',{text:'Offline words stay here.'})).toContain('草稿已放进信箱');
  const snapshot=await r.local();
  expect(snapshot.online).toBe(false);
  expect(snapshot.letterDraft).toMatchObject({body:'Offline words stay here.'});
  expect(sqlRead(join(h!.dir,'bottle-draft.json')).letterDraft.body).toBe('Offline words stay here.');
  expect(r.counts.get('/register')).toBe(1);
});

it('returns cached history during a stuck quota query, merges refreshes and recovers in the background',async()=>{
  const r=rig();await r.start();await vi.waitFor(()=>expect(r.view().online).toBe(true));
  expect(await callTool(r.world,'bottle_write',{text:'A sent fixture letter.'})).toContain('草稿已放进信箱');
  expect((await r.world.pageDeps().send('letter')).ok).toBe(true);
  const originalCalls=r.counts.get('/quota')!;
  const release=r.block('/quota');r.failures.add('/quota');h!.clock.t+=10*60000;
  const snapshots=await Promise.all(Array.from({length:4},()=>r.local()));
  expect(snapshots.every(s=>s.sent.length===1&&s.letterDraft===null)).toBe(true);
  expect(r.counts.get('/quota')).toBe(originalCalls+1);
  release();await vi.waitFor(()=>expect(r.view().online).toBe(false));
  await r.local();expect(r.counts.get('/quota')).toBe(originalCalls+1);
  r.failures.delete('/quota');h!.clock.t+=10*60000;
  await r.local();await vi.waitFor(()=>expect(r.view().online).toBe(true));
  expect(r.view().sent).toHaveLength(1);
});

it.each(['throw','reject'])('keeps /draft readable when its background refresh fails: %s',async mode=>{
  const r=rig();await r.start();
  await callTool(r.world,'bottle_write',{text:'Refresh failure must not hide this draft.'});
  const deps=r.world.pageDeps();
  deps.refresh=mode==='throw'?()=>{throw Error('Synthetic synchronous failure');}:async()=>{throw Error('Synthetic rejection');};
  const result=await handlePage(deps,'GET','/draft');
  expect(result.status).toBe(200);
  expect((result.json as any).letterDraft.body).toContain('must not hide');
  await new Promise(resolve=>setImmediate(resolve));
});

it('returns received paper from local storage without waiting for the notes API',async()=>{
  const r=rig();await r.start();await vi.waitFor(()=>expect(r.view().online).toBe(true));
  const cache=Reflect.get(r.world,'receivedNotes');
  cache.receive({id:'offline-note',letterId:'original-note',from:'Fixture',body:'Already received words.',
    at:new Date(h!.clock.t).toISOString(),expiresAt:new Date(h!.clock.t+86400000).toISOString()});
  r.block('/notes');
  const papers=await r.local<Array<{id:string;body:string}>>('/notes');
  expect(papers).toEqual(expect.arrayContaining([expect.objectContaining({id:'offline-note',body:'Already received words.'})]));
});

it('keeps an unconfirmed send as the same durable draft and does not retry it on local reads',async()=>{
  const r=rig();await r.start();await vi.waitFor(()=>expect(r.view().online).toBe(true));
  await callTool(r.world,'bottle_write',{text:'Keep this exact version until delivery is known.'});
  const before=r.view().letterDraft!;
  // A non-JSON upstream failure gives no authoritative delivery receipt.
  r.failures.add('/throw');
  const result=await r.world.pageDeps().send('letter');
  expect(result.ok).toBe(false);expect(result.close).not.toBe(true);
  const snapshot=await r.local();
  expect(snapshot.letterDraft).toMatchObject({draftId:before.draftId,revision:before.revision,body:before.body});
  expect(snapshot.sent).toHaveLength(0);
  const reloaded=new LocalStore(h!.dir);reloaded.load();
  expect(reloaded.letterDraft).toMatchObject({draftId:before.draftId,revision:before.revision,body:before.body});
  expect(r.counts.get('/throw')).toBe(1);
});
