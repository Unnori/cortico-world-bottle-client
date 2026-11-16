import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {callTool, makeHarness, type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {handlePage} from '../world/page.ts';
import type {CardSpec} from '../world/cards.ts';

let h: Harness, host: FakeHost;
beforeEach(async()=>{
  h=makeHarness({port:0});host=new FakeHost();await h.world.start(host);
  await vi.waitFor(()=>expect(h.world.pageDeps().snapshot().quota).not.toBeNull());
});
afterEach(async()=>{vi.useRealTimers();await h.stop();});

async function setup() {
  const id=h.throwAs('peer','原信。');
  const page=h.world.pageDeps();
  expect((await page.request('catch','human','remote')).ok).toBe(true);
  const card={available:true,show:vi.fn((_spec:CardSpec)=>true),dismiss:vi.fn(),close:vi.fn(),dispose:vi.fn()};
  Reflect.set(h.world,'card',card);h.cfg.surface='card';
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  return {id,page,card};
}

it('shows a live waiting card, then replaces it using the same letter identity',async()=>{
  const {id,page,card}=await setup();
  expect((await page.open('card',id)).ok).toBe(true);
  await vi.advanceTimersByTimeAsync(350);
  expect(card.show.mock.calls.at(-1)?.[0]).toMatchObject({key:'held:'+id,letterId:id});
  h.world.onEventsSettled([host.last('bottle.reading')!],'delivered');
  await callTool(h.world,'bottle_reply',{text:'谢谢这封信。'});
  expect(card.show.mock.calls.at(-1)?.[0]).toMatchObject({key:'held:'+id,eyebrow:'漂流瓶 · 回信写好了'});
});

it.each([false,true])('does not revive waiting after a fast draft (sent=%s)',async send=>{
  const {id,page,card}=await setup();
  expect((await page.open('card',id)).ok).toBe(true);
  h.world.onEventsSettled([host.last('bottle.reading')!],'delivered');
  await callTool(h.world,'bottle_reply',{text:'很快写好的回信。'});
  h.world.onTurnEnded();
  if(send)expect((await page.send('reply')).ok).toBe(true);
  const count=card.show.mock.calls.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(card.show).toHaveBeenCalledTimes(count);
  expect(card.show.mock.calls.at(-1)?.[0]).toMatchObject({eyebrow:'漂流瓶 · 回信写好了'});
  if(send)expect(card.dismiss).toHaveBeenCalledWith('held:'+id);
});

it.each(['discarded','ended','stopped','changed','expired'])('discards delayed waiting when its context is %s',async condition=>{
  const {id,page,card}=await setup();
  await page.open('card',id);
  if(condition==='discarded')h.world.onEventsSettled([host.last('bottle.reading')!],'discarded');
  if(condition==='ended'){h.world.onEventsSettled([host.last('bottle.reading')!],'delivered');h.world.onTurnEnded();}
  if(condition==='stopped')await h.world.stop();
  if(condition==='changed')Reflect.get(h.world,'store').setHeld(null);
  if(condition==='expired')h.clock.t+=100*60*60*1000;
  await vi.advanceTimersByTimeAsync(500);
  expect(card.show).not.toHaveBeenCalled();
});

it.each(['/open','/read','/reply','/dismiss','/keep'])('binds %s to its native card letter and rejects a stale target',async route=>{
  const {id,page}=await setup();
  const result=await handlePage(page,'POST',route,{surface:'card',body:{letterId:'old-letter'}});
  expect(result).toMatchObject({status:200,json:{ok:false}});
  expect(page.snapshot().held?.letterId).toBe(id);
  expect(host.events.filter(event=>event.type==='bottle.reading')).toHaveLength(0);
  expect(await handlePage(page,'POST',route,{surface:'card'})).toMatchObject({status:400});
});

it.each(['/send','/rewrite','/discard'])('requires the displayed draft ID and revision for native %s',async route=>{
  const {page}=await setup();
  for(const body of [{},{kind:'reply'},{draftId:'old',kind:'reply'}]){
    expect(await handlePage(page,'POST',route,{surface:'card',body})).toMatchObject({status:400});
  }
});
