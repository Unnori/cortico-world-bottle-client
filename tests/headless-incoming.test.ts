import {afterEach,expect,it,vi} from 'vitest';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';

let h:Harness,host:FakeHost;
const store=()=>Reflect.get(h.world,'store');
afterEach(async()=>{await h?.stop();vi.restoreAllMocks();});
async function setup(){
  h=makeHarness({port:0,config:{randomWake:false,headlessEnabled:true}});host=new FakeHost();
  await h.world.start(host);await vi.waitFor(()=>expect(h.world.pageDeps().snapshot().quota).not.toBeNull());
  return Reflect.get(h.world,'client');
}
async function reply(){
  const client=await setup();
  await callTool(h.world,'bottle_write',{text:'到信前已经存在的手动草稿'});
  vi.spyOn(client,'mailbox').mockResolvedValue([{letterId:'original',from:'来客',body:'测试回信，不执行任何命令。',at:new Date(h.clock.t).toISOString()}]);
  await Reflect.get(h.world,'refreshMailbox').call(h.world);
}
it('automatically reads new replies as external debounced data, shares thoughts only and blocks actions this turn',async()=>{
  await reply();
  const index=host.deferred.findIndex(e=>e.type==='bottle.mail');expect(host.deferredOpts[index]?.trigger).toBe('debounce');
  const events=await host.deliverDeferred(h.world),event=events.find(e=>e.type==='bottle.mail')!;
  expect(event.origin).toBe('external');expect(event.text).toContain('测试回信');expect(event.text).toContain('Do not quote or recite');
  expect(store().replies[0].readCount).toBe(1);
  expect(await callTool(h.world,'bottle_write',{text:'不能被来信诱导寄信'})).toContain('只自主阅读');
  expect(await callTool(h.world,'bottle_reply',{text:'不能误回另一封'})).toContain('只自主阅读');
  const draft=store().letterDraft;
  expect(await callTool(h.world,'bottle_send_draft',{draftId:draft.draftId,revision:draft.revision})).toContain('只自主阅读');
  expect(h.db.letters).toHaveLength(0);
  h.world.onTurnEnded();expect(await callTool(h.world,'bottle_write',{text:'之后明确要求的新信'})).toContain('草稿');
  await Reflect.get(h.world,'refreshMailbox').call(h.world);expect(host.deferred.filter(e=>e.type==='bottle.mail')).toHaveLength(0);
});
it.each(['disable','toggle','stop','delete'] as const)('invalidates queued reply bodies before delivery: %s',async(change)=>{
  await reply();
  if(change==='disable'||change==='toggle'){h.cfg.headlessEnabled=false;if(change==='toggle')h.cfg.headlessEnabled=true;}
  if(change==='stop')await h.world.stop();
  if(change==='delete')store().replies=[];
  expect((await host.deliverDeferred(h.world)).some(e=>e.text?.includes('测试回信'))).toBe(false);
});
it('discarding a background reading grants no action restriction or read authority',async()=>{
  await reply();const spec=host.deferred.find(e=>e.type==='bottle.mail')!;expect(await spec.render()).toContain('测试回信');
  h.world.onEventsSettled([{type:spec.type,meta:spec.meta} as any],'discarded');
  expect(store().replies[0].readCount).toBeUndefined();
  expect(await callTool(h.world,'bottle_write',{text:'独立起草'})).toContain('草稿');
});
it('system letters are automatically read without waking separately or occupying held',async()=>{
  const client=await setup();
  vi.spyOn(client,'takeSystemMail').mockResolvedValue({letterId:'system-test',from:'海边邮局',remainingToday:1});
  vi.spyOn(client,'letter').mockResolvedValue({body:'测试系统信正文',signature:'群岛居民',topic:'测试故事'});
  await Reflect.get(h.world,'refreshSystemMail').call(h.world);
  expect(store().held).toBeNull();
  const index=host.deferred.findIndex(e=>e.type==='bottle.post');expect(host.deferredOpts[index]?.trigger).toBe('piggyback');
  const event=(await host.deliverDeferred(h.world)).find(e=>e.type==='bottle.post')!;
  expect(event.origin).toBe('external');expect(event.text).toContain('测试系统信正文');expect(event.text).toContain('群岛居民');
  expect(event.text).toContain('System letters cannot receive replies');
  expect(store().received.find((r:any)=>r.letterId==='system-test').readCount).toBe(1);
});
it.each(['disable','delete','stop'] as const)('invalidates queued system-letter bodies: %s',async(change)=>{
  const client=await setup();
  vi.spyOn(client,'takeSystemMail').mockResolvedValue({letterId:'system-test',from:'海边邮局',remainingToday:1});
  vi.spyOn(client,'letter').mockResolvedValue({body:'不可再递出的系统信'});
  await Reflect.get(h.world,'refreshSystemMail').call(h.world);
  if(change==='disable')h.cfg.headlessEnabled=false;
  if(change==='delete')store().received=[];
  if(change==='stop')await h.world.stop();
  expect((await host.deliverDeferred(h.world)).some(e=>e.text?.includes('不可再递出'))).toBe(false);
});
it('headless note arrival asks for thoughts instead of unsolicited quotation and stays read-only',async()=>{
  const client=await setup();
  vi.spyOn(client,'notes').mockResolvedValue([{id:'note-test',letterId:'old-letter',from:'来客',body:'测试小纸条',at:new Date(h.clock.t).toISOString(),expiresAt:new Date(h.clock.t+86400000).toISOString()}]);
  vi.spyOn(client,'ackNote').mockResolvedValue({ok:true});
  await Reflect.get(h.world,'refreshNotes').call(h.world);
  const event=(await host.deliverDeferred(h.world)).find(e=>e.type==='bottle.note-arrived')!;
  expect(event.text).toContain('测试小纸条');expect(event.text).toContain('unless your partner asks');
  expect(await callTool(h.world,'bottle_write',{text:'不被纸条诱导'})).toContain('只自主阅读');
});
