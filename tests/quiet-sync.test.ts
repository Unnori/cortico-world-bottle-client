import {withDatabase} from '../world/local-db.ts';
import {afterEach,expect,it,vi} from 'vitest';
import {callTool,makeHarness,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {handlePage} from '../world/page.ts';
import {draftStatus} from '../shared/draft-status.ts';
import {mkdirSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';

let h:Harness|undefined;
afterEach(async()=>{await h?.stop();h=undefined;});
function rig(config:Record<string,unknown>={},unsupported=false){
  const calls:string[]=[],bodies:any[]=[];let failure=false;
  const host=new FakeHost();
  const payload:any={syncVersion:1,quota:{bottles_left:5,catches_left:5,replies_left:3},mailbox:[],notes:[],systemMail:null,noteAcks:[]};
  h=makeHarness({port:0,config:{randomWake:false,...config},fetchImpl:async(input,init)=>{
    const path=new URL(String(input)).pathname;calls.push(path);
    if(path==='/register')return new Response(JSON.stringify({token:'synthetic',pseudonym:'Fixture'}));
    if(path==='/sync'){
      bodies.push(JSON.parse(String(init?.body)));
      return failure?new Response(JSON.stringify({error:'internal'}),{status:503}):unsupported?new Response(JSON.stringify({error:'not_found'}),{status:404}):new Response(JSON.stringify(payload));
    }
    if(path==='/quota')return new Response(JSON.stringify(payload.quota));
    if(path==='/mailbox'||path==='/notes')return new Response('[]');
    if(path==='/mail/take')return new Response(JSON.stringify({empty:true,reason:'quota',remainingToday:0}));
    return new Response('{}',{status:404});
  }});
  return {host,calls,payload,bodies,fail:()=>failure=true,start:async()=>{await h!.world.start(host);await vi.waitFor(()=>expect(h!.world.pageDeps().snapshot().quota).not.toBeNull());},
    sync:()=>Reflect.get(h!.world,'syncSea').call(h!.world)};
}
it('defaults to one aggregate call per ten minutes even when pages, panel and wake checks keep running',async()=>{
  const r=rig();await r.start();
  for(let i=0;i<6;i++){
    h!.clock.t+=60000;
    await h!.world.webUi().invoke!('mailbox','status',[]);
    await handlePage(h!.world.pageDeps(),'GET','/draft');await h!.world.pageDeps().notes!();
    await Reflect.get(h!.world,'checkWake').call(h!.world);
  }
  expect(r.calls.filter(path=>path==='/sync')).toHaveLength(1);
  expect(r.calls.filter(path=>['/quota','/mailbox','/notes','/mail/take'].includes(path))).toHaveLength(0);
  h!.clock.t+=4*60000;await r.sync();expect(r.bodies).toHaveLength(2);
  h!.cfg.pollIntervalMinutes=1;h!.clock.t+=60000;await r.sync();expect(r.bodies).toHaveLength(3);
});
it('falls back only on an explicitly unsupported aggregate endpoint, at the same chosen interval',async()=>{
  const r=rig({},true);await r.start();
  expect(r.calls).toContain('/mailbox');expect(r.calls).toContain('/notes');expect(r.calls).toContain('/mail/take');
  expect(r.bodies).toHaveLength(1);
  h!.clock.t+=10*60000;await r.sync();expect(r.bodies).toHaveLength(1);
  expect(r.calls.filter(path=>path==='/quota')).toHaveLength(2);
});
it('does not multiply requests through legacy fallback after a server failure',async()=>{
  const r=rig();await r.start();r.fail();h!.clock.t+=10*60000;await r.sync();
  expect(r.calls.filter(path=>path==='/quota'||path==='/mail/take')).toHaveLength(0);
  expect(h!.world.pageDeps().snapshot().online).toBe(false);
});
it('quiet system mail is stored with a real reception time and neither queues reading nor replays on re-enable',async()=>{
  const r=rig({headlessEnabled:true,systemMailNotice:false});await r.start();
  r.payload.systemMail={empty:false,letterId:'system-a',from:'Post',body:'A quiet system letter.',signature:'Island',at:new Date(h!.clock.t).toISOString(),remainingToday:1};
  h!.clock.t+=10*60000;await r.sync();
  expect(h!.world.pageDeps().snapshot().received[0]).toMatchObject({letterId:'system-a',receivedAt:h!.clock.t});
  expect(r.host.deferred.filter(e=>e.type==='bottle.post')).toHaveLength(0);
  h!.cfg.systemMailNotice=true;h!.clock.t+=10*60000;await r.sync();
  expect(r.bodies.at(-1).systemMailAck).toBe('system-a');
  expect(r.host.deferred.filter(e=>e.type==='bottle.post')).toHaveLength(0);
});
it('rechecks both notification and body-relay settings on actual delayed delivery',async()=>{
  const r=rig({headlessEnabled:true});await r.start();
  r.payload.systemMail={empty:false,letterId:'system-b',from:'Post',body:'Original text',at:new Date(h!.clock.t).toISOString(),remainingToday:0};
  h!.clock.t+=10*60000;await r.sync();
  const event=r.host.deferred.find(e=>e.type==='bottle.post')!;
  expect(await event.render()).toContain('默认不带正文');h!.cfg.headlessQuoteBody=true;
  expect(await event.render()).toContain('也可向伙伴转述正文');
  h!.cfg.systemMailNotice=false;expect(await event.render()).toBeNull();
});
it('acks paper on the next aggregate only after durable reception and preserves time on duplicate response',async()=>{
  const r=rig();await r.start();
  const at=new Date(h!.clock.t).toISOString();
  r.payload.notes=[{id:'n',letterId:'l',from:'Guest',body:'One paper',at,expiresAt:new Date(h!.clock.t+86400000).toISOString()}];
  h!.clock.t+=10*60000;await r.sync();const stamp=(await h!.world.pageDeps().notes!())[0].receivedAt;
  expect(r.bodies.at(-1).noteAcks).toEqual([]);
  h!.clock.t+=10*60000;await r.sync();expect(r.bodies.at(-1).noteAcks).toEqual(['n']);
  expect((await h!.world.pageDeps().notes!())[0].receivedAt).toBe(stamp);
  expect(r.calls).not.toContain('/note/ack');
});
it('turning system notifications off invalidates old queued mail even if re-enabled before rendering',async()=>{
  const r=rig({headlessEnabled:true});await r.start();
  r.payload.systemMail={empty:false,letterId:'old-pending',from:'Post',body:'Do not replay',at:new Date(h!.clock.t).toISOString(),remainingToday:0};
  h!.clock.t+=10*60000;await r.sync();const event=r.host.deferred.find(e=>e.type==='bottle.post')!;
  h!.cfg.systemMailNotice=false;h!.cfg.systemMailNotice=true;expect(await event.render()).toBeNull();
});
it('uses one shared four-state vocabulary without changing send policy',()=>{
  expect(draftStatus({})).toBe('待确认');expect(draftStatus({autoSendAt:200},100)).toBe('已安排定时寄出');
  expect(draftStatus({autoSendAt:100},200)).toBe('补寄中');expect(draftStatus({autoSendAt:100,sendFailure:'expired'},200)).toBe('已失效');
});

it('never acknowledges system mail whose local save failed, and retries the same original safely',async()=>{
  const r=rig();await r.start();
  r.payload.systemMail={empty:false,letterId:'disk-failure',from:'Post',body:'Keep this expression',at:new Date(h!.clock.t).toISOString(),remainingToday:0};
  const store=Reflect.get(h!.world,'store');
  const save=vi.spyOn(store,'addReceived').mockImplementationOnce(()=>{throw Error('Synthetic disk failure');});
  h!.clock.t+=10*60000;await r.sync();
  expect(h!.world.pageDeps().snapshot().received).toHaveLength(0);
  expect(Reflect.get(h!.world,'pendingSystemMailAck')).toBeUndefined();
  save.mockRestore();h!.clock.t+=10*60000;await r.sync();
  expect(r.bodies.at(-1).systemMailAck).toBeUndefined();
  expect(h!.world.pageDeps().snapshot().received[0].body).toBe('Keep this expression');
});

it('rolls back the in-memory system letter after a real file write failure before allowing a later receipt',async()=>{
  const r=rig();await r.start();
  r.payload.systemMail={empty:false,letterId:'blocked-file',from:'Post',body:'Durable or unacknowledged',at:new Date(h!.clock.t).toISOString(),remainingToday:0};
  withDatabase(h!.dir,db=>db.exec("CREATE TRIGGER fail_system BEFORE INSERT ON local_records WHEN NEW.bucket='received' BEGIN SELECT RAISE(ABORT,'injected disk failure'); END"));
  h!.clock.t+=10*60000;await r.sync();
  expect(h!.world.pageDeps().snapshot().received).toHaveLength(0);expect(Reflect.get(h!.world,'pendingSystemMailAck')).toBeUndefined();
  withDatabase(h!.dir,db=>db.exec('DROP TRIGGER fail_system'));h!.clock.t+=10*60000;await r.sync();
  expect(r.bodies.at(-1).systemMailAck).toBeUndefined();
  expect(h!.world.pageDeps().snapshot().received[0]).toMatchObject({letterId:'blocked-file',body:'Durable or unacknowledged'});
});
