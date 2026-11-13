import {afterEach,expect,it,vi} from 'vitest';
import {WakeBus} from 'cortico/core/bus.ts';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {BottleClient} from '../world/client.ts';
import {BOTTLE} from '../world/definition.ts';

let h:Harness|undefined;
afterEach(async()=>{await h?.stop();h=undefined;vi.restoreAllMocks();vi.useRealTimers();});

async function setup(randomWake=false){
  h=makeHarness({port:0,random:()=>0,config:{randomWake}});
  const host=new FakeHost();await h.world.start(host);
  await vi.waitFor(()=>expect(h!.world.pageDeps().snapshot().quota).not.toBeNull());
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});
  const bus=new WakeBus({quietGapMs:2500,minBatchAgeMs:0,maxBatchAgeMs:15000,maxBatchSize:100});
  const push=host.pushEvent.bind(host),defer=host.pushDeferred.bind(host);
  host.pushEvent=async(event,opts)=>{const full=await push(event,opts);bus.push({event:full},opts);return full;};
  host.pushDeferred=(event,opts)=>{
    defer(event,opts);
    bus.push({deferred:{...event,source:'bottle',origin:event.origin??'external'}},opts);
  };
  return {world:h.world,host,bus};
}

it('sending a letter queues a receipt without waking, then a direct writing request delivers both immediately',async()=>{
  const {world,bus}=await setup();
  await callTool(world,'bottle_write',{text:'只存在测试信箱的正文'});
  const draft=world.pageDeps().snapshot().letterDraft!;
  expect((await world.pageDeps().send('letter',{draftId:draft.draftId!,revision:draft.revision!})).ok).toBe(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(bus.pending()).toBe(1);expect(bus.pendingImmediate()).toBe(0);expect(bus.takeIfReady()).toBeNull();
  expect((await world.pageDeps().request('write','human')).ok).toBe(true);
  expect(bus.takeIfReady()!.map(item=>item.event?.type)).toEqual(['bottle.sent','bottle.request']);
});

it('all passive status events stay queued even after a minute and ride the next explicit invitation',async()=>{
  const {world,bus}=await setup();
  const types=['bottle.sent','bottle.dismissed','bottle.picked','bottle.post','bottle.tsunami'] as const;
  for(const type of types)await Reflect.get(world,'pushInternal').call(world,type,'状态测试',{});
  await vi.advanceTimersByTimeAsync(60000);
  expect(bus.pending()).toBe(types.length);expect(bus.takeIfReady()).toBeNull();
  expect((await world.pageDeps().request('write','bot')).ok).toBe(true);
  const batch=bus.takeIfReady()!;
  expect(batch.slice(0,-1).map(item=>item.event?.type)).toEqual([...types]);
  expect(batch.at(-1)?.deferred?.type).toBe('bottle.wake');
});

it('new replies are debounced into one delivery instead of flushing every arrival',async()=>{
  const {world,bus}=await setup();
  vi.spyOn(BottleClient.prototype,'mailbox')
    .mockResolvedValueOnce([{letterId:'reply1',from:'来客',body:'原文一',at:new Date().toISOString()}])
    .mockResolvedValueOnce([{letterId:'reply2',from:'来客',body:'原文二',at:new Date().toISOString()}]);
  await Reflect.get(world,'refreshMailbox').call(world);
  expect(bus.takeIfReady()).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  await Reflect.get(world,'refreshMailbox').call(world);
  await vi.advanceTimersByTimeAsync(2499);expect(bus.takeIfReady()).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  const batch=bus.takeIfReady()!;expect(batch.map(item=>item.event?.type)).toEqual(['bottle.mail','bottle.mail']);
  expect(JSON.stringify(batch)).not.toMatch(/原文一|原文二/);
});

it('scheduled invitations still wake immediately when their existing eligibility and delay are satisfied',async()=>{
  const {world,bus}=await setup(true);
  await Reflect.get(world,'checkWake').call(world);
  expect(bus.takeIfReady()).toBeNull();
  h!.clock.t+=2*3600000;
  await Reflect.get(world,'checkWake').call(world);
  const task=bus.takeIfReady()!.find(item=>item.deferred?.type==='bottle.wake')!;
  expect(task.deferred?.meta?.action).toBe('write');
  expect(await task.deferred!.render()).toContain('You have written');
});

it('the human event catalog declares the actual three delivery classes',()=>{
  const events=BOTTLE.describe!.events;
  expect(events.filter(e=>e.trigger==='flush').map(e=>e.type)).toContain('bottle.wake');
  expect(events.filter(e=>e.trigger==='debounce').map(e=>e.type)).toEqual(['bottle.mail','bottle.note-arrived']);
  expect(events.find(e=>e.type==='bottle.star-memory')?.trigger).toBe('piggyback');
  expect(events.every(e=>typeof e.description==='string')).toBe(true);
});
