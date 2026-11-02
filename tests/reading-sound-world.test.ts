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
  expect(host.last('bottle.peruse')?.text).toContain('这是你们第1次读这封信。');
  expect(page.snapshot().received[0]?.readCount).toBe(1);
  await h.world.stop();await h.world.start(host);
  expect(h.world.pageDeps().snapshot().received[0]?.readCount).toBe(1);
  await h.world.pageDeps().peruse(id);
  expect(host.last('bottle.peruse')?.text).toContain('这是你们第2次读这封信。');
  expect(h.world.pageDeps().snapshot().received[0]?.readCount).toBe(2);
});
it('does not increment failed or concurrent handoffs',async()=>{
  const id=await caught(),page=h.world.pageDeps();
  const fail=vi.spyOn(host,'pushEvent').mockRejectedValueOnce(new Error('queue unavailable'));
  expect((await page.peruse(id)).ok).toBe(false);expect(page.snapshot().received[0]?.readCount ?? 0).toBe(0);fail.mockRestore();
  const both=await Promise.all([page.peruse(id),page.peruse(id)]);
  expect(both.filter(item=>item.ok)).toHaveLength(1);
  expect(page.snapshot().received[0]?.readCount).toBe(1);
});
it('reply authorization counts once, and the next together-reading uses the next number',async()=>{
  const id=await caught(),page=h.world.pageDeps();
  expect((await page.open('remote')).ok).toBe(true);
  expect((await page.open('remote')).ok).toBe(false);
  expect(page.snapshot().received[0]?.readCount).toBe(1);
  await page.peruse(id);expect(host.last('bottle.peruse')?.text).toContain('第2次');
});
it('counts only the returned reply, not the sent original',async()=>{
  const store=Reflect.get(h.world,'store') as LocalStore;
  store.addSent({letterId:'mine',body:'我写的',at:h.clock.t});
  store.addReply({letterId:'mine',from:'灯塔',body:'回来的信',at:h.clock.t});
  await h.world.pageDeps().peruse('mine');
  const sent=h.world.pageDeps().snapshot().sent[0]!;
  expect(sent).not.toHaveProperty('readCount');expect(sent.reply?.readCount).toBe(1);
  expect(host.last('bottle.peruse')?.text).toContain('第1次');
  await h.world.pageDeps().peruse('mine');expect(host.last('bottle.peruse')?.text).toContain('第2次');
  expect(h.world.pageDeps().snapshot().sent[0]).not.toHaveProperty('readCount');
  expect(store.sent[0]).not.toHaveProperty('readCount');
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
