import { afterEach, expect, it } from 'vitest';
import { makeHarness, callTool, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';
import { draftLetterCard } from '../world/cards.ts';
import { handlePage } from '../world/page.ts';
let h: Harness;
afterEach(async()=>{await h?.stop();});
async function setup(){h=makeHarness({config:{headlessEnabled:true}});await h.world.start(new FakeHost());await callTool(h.world,'bottle_write',{text:'第一稿'});return Reflect.get(h.world,'store');}

it('old page and native card confirmations cannot send, rewrite or discard the replacement version',async()=>{
  const store=await setup(),old={...store.letterDraft};
  const card=draftLetterCard({base:'http://127.0.0.1',draft:old,chars:3,hints:[]});
  expect(card.draft).toMatchObject({draftId:old.draftId,revision:1,kind:'letter'});
  await callTool(h.world,'bottle_write',{text:'第二稿'});
  for(const route of ['/send','/rewrite','/discard']){
    const res=await handlePage(h.world.pageDeps(),'POST',route,{body:{...card.draft},surface:'card'});
    expect((res.json as any).ok).toBe(false);expect((res.json as any).message).toContain('版本号不匹配');
  }
  expect(store.letterDraft.body).toBe('第二稿');expect(h.db.letters).toHaveLength(0);
});

it('confirmation payload cannot substitute its own body or omit half of the reference',async()=>{
  const store=await setup();
  for(const body of [{draftId:store.letterDraft.draftId},{revision:1},{draftId:store.letterDraft.draftId,revision:1,body:'替换正文'}])
    expect((await handlePage(h.world.pageDeps(),'POST','/send',{body})).status).toBe(400);
  expect(h.db.letters).toHaveLength(0);
});

it('a pending model rewrite cannot overwrite a draft changed after the request',async()=>{
  const store=await setup(),old={...store.letterDraft};
  expect((await h.world.pageDeps().rewrite('letter','page',old)).ok).toBe(true);
  store.setLetterDraft({kind:'letter',body:'别的入口更新',at:h.clock.t});
  expect(await callTool(h.world,'bottle_write',{text:'迟到的模型稿'})).toContain('版本号不匹配');
  expect(store.letterDraft.body).toBe('别的入口更新');
});

it('confirms a human request after waiting for automatic work and rechecks lifecycle',async()=>{
  const store=await setup(),old={...store.letterDraft};let finish!:()=>void;
  Reflect.set(h.world,'autoReplyWork',new Promise<void>(done=>{finish=done;}));
  const pending=h.world.pageDeps().send('letter',old);
  Reflect.set(h.world,'generation',Reflect.get(h.world,'generation')+1);
  Reflect.set(h.world,'autoReplyWork',null);finish();
  expect((await pending).ok).toBe(false);expect(h.db.letters).toHaveLength(0);
});

it('an exact reference chooses its draft when both slots exist and kind is omitted',async()=>{
  const store=await setup(),letter={draftId:store.letterDraft.draftId,revision:store.letterDraft.revision};
  h.throwAs('peer','等回信的原文');await callTool(h.world,'bottle_catch');
  await (Reflect.get(h.world,'host') as FakeHost).deliverDeferred(h.world);
  await callTool(h.world,'bottle_reply',{text:'另一槽的回信',letterId:'held'});
  h.world.onTurnEnded();
  const replyId=store.draft.draftId;
  expect((await handlePage(h.world.pageDeps(),'POST','/send',{body:letter})).json).toMatchObject({ok:true});
  expect(store.draft.draftId).toBe(replyId);
  expect(h.db.replies).toHaveLength(0);
  expect(h.db.letters.some(r=>r.body==='第一稿')).toBe(true);
});

it('a new confirmation rejects unknown kinds before executing an action',async()=>{
  const store=await setup();
  const res=await handlePage(h.world.pageDeps(),'POST','/send',{body:{draftId:store.letterDraft.draftId,revision:1,kind:'note'}});
  expect(res.status).toBe(400);expect(h.db.letters).toHaveLength(0);
});
