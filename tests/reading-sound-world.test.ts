import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';
import type { LocalStore } from '../world/store.ts';

let h: Harness, host: FakeHost;
beforeEach(async()=>{
  h=makeHarness();host=new FakeHost();await h.world.start(host);
  await vi.waitFor(()=>expect(h.world.pageDeps().snapshot().quota).not.toBeNull());
});
afterEach(async()=>{await h.stop();});
async function caught() {
  const id=h.throwAs('peer','一封给海风的信。');
  await h.world.pageDeps().request('catch','human','remote');
  expect(h.world.pageDeps().snapshot().received[0]?.letterId).toBe(id);return id;
}
function cards() {
  // No native UI process: observe notification dispatch at its final boundary.
  return {draft:vi.spyOn(h.world as any,'showDraftCard'),held:vi.spyOn(h.world as any,'showHeldCard')};
}
it('counts successful reading handoffs and persists across a World restart',async()=>{
  const id=await caught(),page=h.world.pageDeps();
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  expect((await page.peruse(id)).ok).toBe(true);
  const first = host.last('bottle.peruse')!;
  expect(first.text).toContain('这是第1次共读。');
  expect(page.snapshot().received[0]?.readCount).toBe(0);
  h.world.onEventsSettled([first], 'delivered');
  h.world.onEventsSettled([first], 'delivered');
  expect(page.snapshot().received[0]?.readCount).toBe(1);
  await h.world.stop();await h.world.start(host);
  expect(h.world.pageDeps().snapshot().received[0]?.readCount).toBe(1);
  await h.world.pageDeps().peruse(id);
  expect(host.last('bottle.peruse')?.text).toContain('这是第2次共读。');
  h.world.onEventsSettled([first], 'discarded');
  h.world.onEventsSettled([host.last('bottle.peruse')!], 'delivered');
  expect(h.world.pageDeps().snapshot().received[0]?.readCount).toBe(2);
});
it('does not increment failed or concurrent handoffs',async()=>{
  const id=await caught(),page=h.world.pageDeps();
  const fail=vi.spyOn(host,'pushEvent').mockRejectedValueOnce(new Error('queue unavailable'));
  expect((await page.peruse(id)).ok).toBe(false);expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);fail.mockRestore();
  const both=await Promise.all([page.peruse(id),page.peruse(id)]);
  expect(both.filter(item=>item.ok)).toHaveLength(1);
  const discarded = host.last('bottle.peruse')!;
  h.world.onEventsSettled([discarded], 'discarded');
  expect(page.snapshot().received[0]?.readCount).toBe(0);
  expect((await page.peruse(id)).ok).toBe(true);
  const retried = host.last('bottle.peruse')!;
  expect(retried.text).toContain('这是第1次共读。');
  h.world.onEventsSettled([discarded], 'delivered');
  expect(page.snapshot().received[0]?.readCount).toBe(0);
  h.world.onEventsSettled([retried], 'delivered');
  expect(page.snapshot().received[0]?.readCount).toBe(1);
});
it('writing a reply does not count as together-reading',async()=>{
  const id=await caught(),page=h.world.pageDeps();
  expect((await page.open('remote')).ok).toBe(true);
  expect((await page.open('remote')).ok).toBe(false);
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  await callTool(h.world,'bottle_reply',{text:'谢谢你的来信。'});
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  h.world.onTurnEnded();
  await page.peruse(id);expect(host.last('bottle.peruse')?.text).toContain('第1次共读');
  h.world.onEventsSettled([host.last('bottle.peruse')!], 'delivered');
  expect(page.snapshot().received[0]?.readCount).toBe(1);
});
it('a failed reply turn followed by a successful retry and send still counts no together-reading',async()=>{
  const id=await caught(),page=h.world.pageDeps();
  expect((await page.open('remote')).ok).toBe(true);
  h.world.onEventsSettled([host.last('bottle.reading')!],'delivered');
  // Formatting failure: the model turn ends without a valid tool call.
  h.world.onTurnEnded();
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  expect((Reflect.get(h.world,'store') as LocalStore).received[0]?.lastReadAt).toBeUndefined();
  h.clock.t+=60_000;
  expect((await page.open('remote')).ok).toBe(true);
  await callTool(h.world,'bottle_reply',{text:'第二次成功写好回信。'});
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  expect((await page.send('reply')).ok).toBe(true);
  expect(page.snapshot().received[0]).toMatchObject({letterId:id,outcome:'replied',readCount:0});
  await h.world.stop();await h.world.start(host);
  expect(h.world.pageDeps().snapshot().received[0]?.readCount ?? 0).toBe(0);
  await h.world.pageDeps().peruse(id);
  expect(host.last('bottle.peruse')?.text).toContain('第1次共读');
});
it('invalid reply text and reattempts in the same authorization do not inflate reading counts',async()=>{
  await caught();const page=h.world.pageDeps();
  await page.open('remote');
  await callTool(h.world,'bottle_reply',{text:''});
  await callTool(h.world,'bottle_reply',{text:'字'.repeat(121)});
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  expect(page.snapshot().replyDraft).toBeNull();
  await callTool(h.world,'bottle_reply',{text:'这一句写好了。'});
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  await (h.world as any).doReply('不能重复提交。');
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
});
it('discarded or expired reply authorizations and restart retries do not count as together-reading',async()=>{
  await caught();const page=h.world.pageDeps();
  await page.open('remote');
  h.world.onEventsSettled([host.last('bottle.reading')!],'discarded');
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  await page.open('remote');h.clock.t+=11*60_000;
  await (h.world as any).doReply('授权已过期。');
  expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);
  await h.world.stop();await h.world.start(host);
  await h.world.pageDeps().open('remote');
  await callTool(h.world,'bottle_reply',{text:'重试后写好。'});
  expect(h.world.pageDeps().snapshot().received[0]?.readCount ?? 0).toBe(0);
});
it('reading together and then writing a reply counts only the explicit read click',async()=>{
  const id=await caught(),page=h.world.pageDeps();
  expect((await page.read!('remote')).ok).toBe(true);
  const readEvent=host.last('bottle.reading')!;
  h.world.onEventsSettled([readEvent],'delivered');
  expect(page.snapshot().received[0]?.readCount).toBe(1);
  expect((Reflect.get(h.world,'store') as LocalStore).held?.readAt).toBe(h.clock.t);
  h.world.onTurnEnded();
  expect((await page.open('remote')).ok).toBe(true);
  await callTool(h.world,'bottle_reply',{text:'读后，我想认真回你。'});
  expect(page.snapshot().received[0]?.readCount).toBe(1);
  h.world.onTurnEnded();
  expect((await page.send('reply')).ok).toBe(true);
  expect(page.snapshot().received[0]?.readCount).toBe(1);
  await page.peruse(id);
  expect(host.last('bottle.peruse')?.text).toContain('这是第2次共读。');
  h.world.onEventsSettled([host.last('bottle.peruse')!], 'delivered');
  expect(page.snapshot().received[0]?.readCount).toBe(2);
});
it('counts only the returned reply, not the sent original',async()=>{
  const store=Reflect.get(h.world,'store') as LocalStore;
  store.addSent({letterId:'mine',body:'我写的',at:h.clock.t});
  store.addReply({letterId:'mine',from:'灯塔',body:'回来的信',at:h.clock.t});
  expect(await callTool(h.world,'bottle_mailbox')).toContain('对方回了（尚未共读）');
  await h.world.pageDeps().peruse('mine');
  const sent=h.world.pageDeps().snapshot().sent[0]!;
  expect(sent).not.toHaveProperty('readCount');expect(sent.reply?.readCount).toBe(0);
  expect(host.last('bottle.peruse')?.text).toContain('第1次共读');
  h.world.onEventsSettled([host.last('bottle.peruse')!],'delivered');h.world.onTurnEnded();
  expect(await callTool(h.world,'bottle_mailbox')).toContain('对方回了（已共读1次）');
  await h.world.pageDeps().peruse('mine');expect(host.last('bottle.peruse')?.text).toContain('第2次共读');
  h.world.onEventsSettled([host.last('bottle.peruse')!],'delivered');h.world.onTurnEnded();
  expect(await callTool(h.world,'bottle_mailbox')).toContain('对方回了（已共读2次）');
  expect(await callTool(h.world,'bottle_mailbox')).toContain('对方回了（已共读2次）');
  await h.world.stop();await h.world.start(host);
  expect(await callTool(h.world,'bottle_mailbox')).toContain('对方回了（已共读2次）');
  expect(h.world.pageDeps().snapshot().sent[0]).not.toHaveProperty('readCount');
  expect(store.sent[0]).not.toHaveProperty('readCount');
});

it('keeps a new reply visible and readable after the original was deleted locally', async () => {
  const page = h.world.pageDeps();
  await callTool(h.world, 'bottle_write', { title: '写给远方', text: '原信正文。' });
  expect((await page.send('letter')).ok).toBe(true);
  const { letterId } = page.snapshot().sent[0]!;
  const token = h.tokenOf('replying-peer');
  const call = (path: string, body: unknown = {}) => h.api.handle({
    method: 'POST', path, token, ip: '10.0.0.9', body,
  });
  expect(call('/catch').body).toMatchObject({ letterId });
  expect((await page.forget(letterId)).ok).toBe(true);
  expect(call('/reply', { letterId, body: '海那边的回音。' }).status).toBe(200);
  await callTool(h.world, 'bottle_mailbox');

  expect(page.snapshot().sent).toEqual([]);
  expect(page.snapshot().standaloneReplies).toMatchObject([{ letterId, body: '海那边的回音。', readCount: 0 }]);
  expect((await page.peruse(letterId)).ok).toBe(true);
  const event = host.last('bottle.peruse')!;
  expect(event.text).toContain('本机未保存原信');
  expect(event.text).toContain('海那边的回音。');
  expect(event.text).not.toContain('原信正文。');
  h.world.onEventsSettled([event], 'delivered');
  expect(page.snapshot().standaloneReplies?.[0]?.readCount).toBe(1);
  expect((await page.star!(letterId, true)).ok).toBe(true);
  expect(page.snapshot().stars).toMatchObject([{ letterId, category: 'reply', memoryActive: false }]);

  expect((await page.forget(letterId)).ok).toBe(true);
  await callTool(h.world, 'bottle_mailbox');
  expect(page.snapshot().standaloneReplies).toEqual([]);
  await h.world.stop();
  await h.world.start(host);
  await callTool(h.world, 'bottle_mailbox');
  expect(h.world.pageDeps().snapshot().standaloneReplies).toEqual([]);
});

it.each([false,true])('reply directory shows saved reading counts without exposing bodies or changing counts (headless=%s)',async headless=>{
  h.cfg.headlessEnabled=headless;
  const store=Reflect.get(h.world,'store') as LocalStore;
  for(const [index,count] of [undefined,0,1,2,114514].entries()){
    const id='reply-'+index;
    store.addSent({letterId:id,body:'PRIVATE original '+index,at:h.clock.t});
    store.addReply({letterId:id,from:'来客'+index,body:'PRIVATE answer '+index,at:h.clock.t,...(count===undefined?{}:{readCount:count})});
  }
  store.addSent({letterId:'awaiting-answer',body:'PRIVATE no answer',at:h.clock.t});
  store.addReply({letterId:'without-original',from:'旧信来客',body:'PRIVATE orphan answer',at:h.clock.t,readCount:3});
  const before=JSON.stringify(store.replies);
  const directory=await callTool(h.world,'bottle_mailbox');
  for(const [index,count] of [undefined,0,1,2,114514].entries()){
    const prefix=headless?`ID: reply-${index}，已寄信，有回信`:`· 来客${index} — 你寄出的信，对方回了`;
    expect(directory).toContain(prefix+(count?`（已共读${count}次）`:'（尚未共读）'));
  }
  expect(directory).toContain(headless?'ID: without-original，已收回信，来自 旧信来客（已共读3次）':'· 旧信来客 — 你寄出的信，对方回了（已共读3次）');
  if(headless)expect(directory.split('\n').find(line=>line.startsWith('ID: awaiting-answer，'))).toBe('ID: awaiting-answer，已寄信');
  else expect(directory).not.toContain('reply-');
  expect(directory).not.toContain('PRIVATE');
  expect(JSON.stringify(store.replies)).toBe(before);
});
it('together-reading preserves the original return deadline, including after recovery',async()=>{
  const id=await caught(),page=h.world.pageDeps(),until=h.db.letterById(id)!.replyWindowUntil;
  expect((await page.read!('remote')).ok).toBe(true);
  h.world.onEventsSettled([host.last('bottle.reading')!],'delivered');h.world.onTurnEnded();
  expect(h.db.letterById(id)?.replyWindowUntil).toBe(until);
  const store=Reflect.get(h.world,'store') as LocalStore;
  expect(store.held?.windowUntil).toBe(until);
  store.setHeld(null);
  await page.request('catch','human','remote');
  expect(store.held?.windowUntil).toBe(until);
  h.clock.t=until!+1;
  (h.world as any).pruneExpired();
  expect(store.held).toBeNull();
});
it('remote human catch and asynchronous writing leave native cards silent',async()=>{
  const card=cards();await caught();expect(card.held).not.toHaveBeenCalled();
  await h.world.pageDeps().dismiss();
  expect((await h.world.pageDeps().request('write','human','remote')).ok).toBe(true);
  h.clock.t+=90_000; // a slower response must still remember its device
  await callTool(h.world,'bottle_write',{text:'把这封留在手机信箱。'});
  expect(h.world.pageDeps().snapshot().letterDraft?.body).toContain('手机');
  expect(card.draft).not.toHaveBeenCalled();
  await h.world.pageDeps().discard('letter');
  await callTool(h.world,'bottle_write',{text:'这次在桌面写。'});
  expect(card.draft).toHaveBeenCalledTimes(1);
});
it.each(['write','catch'] as const)('remote bot %s invitation stays silent through deferred delivery',async action=>{
  const card=cards();if(action==='catch')h.throwAs('peer','给海岸的来信。');
  expect((await h.world.pageDeps().request(action,'bot','remote')).ok).toBe(true);
  await host.deliverDeferred(h.world);
  await callTool(h.world,action==='write'?'bottle_write':'bottle_catch',action==='write'?{text:'让海风收下。'}:{});
  expect(card.draft).not.toHaveBeenCalled();expect(card.held).not.toHaveBeenCalled();
});
it('remote reply drafts and rewrites stay in the browser; local catches still notify',async()=>{
  const card=cards();await caught();await h.world.pageDeps().open('remote');
  await callTool(h.world,'bottle_reply',{text:'谢谢你的来信。'});expect(card.draft).not.toHaveBeenCalled();
  expect((await h.world.pageDeps().rewrite('reply','remote')).ok).toBe(true);
  await callTool(h.world,'bottle_reply',{text:'愿你今晚安睡。'});expect(card.draft).not.toHaveBeenCalled();
  await h.world.pageDeps().dismiss();
  h.throwAs('another','另一封正常桌面通知。');await callTool(h.world,'bottle_catch');
  expect(card.held).toHaveBeenCalledTimes(1);
});
it('remote letter rewrites remember their device without muting later local rewrites',async()=>{
  const card=cards();await callTool(h.world,'bottle_write',{text:'第一稿。'});card.draft.mockClear();
  await h.world.pageDeps().rewrite('letter','remote');await callTool(h.world,'bottle_write',{text:'手机上的第二稿。'});
  expect(card.draft).not.toHaveBeenCalled();
  await h.world.pageDeps().rewrite('letter','page');await callTool(h.world,'bottle_write',{text:'桌面的第三稿。'});
  expect(card.draft).toHaveBeenCalledTimes(1);
});

it('clears failed remote rewrite requests instead of muting the next local draft',async()=>{
  const card=cards();await callTool(h.world,'bottle_write',{text:'第一稿。'});card.draft.mockClear();
  vi.spyOn(host,'pushEvent').mockRejectedValueOnce(new Error('queue unavailable'));
  expect((await h.world.pageDeps().rewrite('letter','remote')).ok).toBe(false);
  await callTool(h.world,'bottle_write',{text:'另一次在本机写的稿。'});
  expect(card.draft).toHaveBeenCalledTimes(1);
});

it('writing a reply reports writing, while together-reading still reports reading',async()=>{
  await caught(); const page=h.world.pageDeps();
  expect((await page.read!('remote')).message).toBe('Coo开始读了。');
  h.world.onEventsSettled([host.last('bottle.reading')!],'delivered');h.world.onTurnEnded();
  expect((await page.open('remote')).message).toBe('Coo开始写回信了。');
});
