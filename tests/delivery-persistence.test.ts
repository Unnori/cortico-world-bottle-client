import {afterEach,expect,it} from 'vitest';
import {join} from 'node:path';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {LocalStore} from '../world/store.ts';
import {readLocalDocument,withDatabase} from '../world/local-db.ts';

let h:Harness;
afterEach(async()=>{await h?.stop();});
async function setup(kind:'letter'|'reply'='letter') {
  h=makeHarness({port:0,config:{headlessEnabled:true,randomWake:false}});
  const host=new FakeHost();await h.world.start(host);await (h.world as any).syncSea();
  if(kind==='letter')await callTool(h.world,'bottle_write',{text:'寄出以后也要留住的信。',title:'本机副本'});
  else {
    h.throwAs('peer','可以回信的原文。');await callTool(h.world,'bottle_catch');
    await host.deliverDeferred(h.world);
    await callTool(h.world,'bottle_reply',{text:'回信正文也不能因为磁盘失败而消失。',stationery:{v:1,doodle:'hand-drawn-heart'}});
    h.world.onTurnEnded();
  }
  const store=(h.world as any).store as LocalStore;
  return {store,draft:(kind==='letter'?store.letterDraft:store.draft)!};
}
function failHistory(bucket:'sent'|'received') {
  withDatabase(h.dir,db=>db.exec(`CREATE TRIGGER fail_delivery BEFORE INSERT ON local_records WHEN NEW.bucket='${bucket}' BEGIN SELECT RAISE(ABORT,'history unavailable'); END`));
}
function recoverStorage(){withDatabase(h.dir,db=>db.exec('DROP TRIGGER fail_delivery'));}
function reload(){const store=new LocalStore(h.dir);store.load();return store;}
function slots(){return readLocalDocument(join(h.dir,'bottle-draft.json'));}

it('keeps the durable draft until the server confirms delivery',async()=>{
  const {store,draft}=await setup();
  let finish!:(value:unknown)=>void;
  const client=(h.world as any).client;
  client.throwLetter=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.world.pageDeps().send('letter',draft as any);
  expect(slots().letterDraft.body).toBe(draft.body);
  expect(await callTool(h.world,'bottle_write',{text:'不能覆盖正在寄出的原稿。'})).toContain('正在寄出');
  finish({ok:false,reason:'tide_out',text:'暂时不能寄信。',until:null,quota:(h.world as any).quota});
  expect(await pending).toMatchObject({ok:false,close:false});
  expect(store.letterDraft).toBe(draft);expect(reload().letterDraft?.body).toBe(draft.body);
  expect(reload().sent).toEqual([]);
});

it('retains the confirmed receipt and draft on history failure, and retries only local archival',async()=>{
  const {store,draft}=await setup();failHistory('sent');
  const result=await h.world.pageDeps().send('letter',draft as any);
  expect(result).toMatchObject({ok:false,close:false});expect(result.message).toContain('海边已确认寄出');
  expect(h.db.letters).toHaveLength(1);expect(store.letterDraft).toBe(draft);expect(store.sent).toEqual([]);
  expect(slots().letterDraft).toMatchObject({body:draft.body,deliveryReceipt:{letterId:h.db.letters[0].id}});
  expect(reload().letterDraft?.deliveryReceipt).toBeDefined();
  expect((await h.world.pageDeps().rewrite('letter','page',draft as any)).ok).toBe(false);
  expect((await h.world.pageDeps().discard('letter',draft as any)).ok).toBe(false);
  recoverStorage();
  expect(await h.world.pageDeps().send('letter',draft as any)).toMatchObject({ok:true,close:true});
  expect(h.db.letters).toHaveLength(1);expect(store.letterDraft).toBeNull();
  expect(reload().sent).toMatchObject([{body:draft.body,topic:'本机副本'}]);
});

it('recovers an acknowledged send after restart without another network delivery',async()=>{
  const {draft}=await setup();failHistory('sent');
  await h.world.pageDeps().send('letter',draft as any);
  expect(reload().letterDraft?.body).toBe(draft.body);
  recoverStorage();
  const restarted=reload();
  expect(restarted.letterDraft).toBeNull();expect(restarted.sent).toMatchObject([{body:draft.body}]);
  expect(h.db.letters).toHaveLength(1);
});

it('rolls history back if clearing the draft fails after the history insert',async()=>{
  const {store,draft}=await setup();
  withDatabase(h.dir,db=>db.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON local_documents WHEN NEW.key='letterDraft' AND NEW.json='null' BEGIN SELECT RAISE(ABORT,'draft cleanup unavailable'); END"));
  expect(await h.world.pageDeps().send('letter',draft as any)).toMatchObject({ok:false,close:false});
  expect(h.db.letters).toHaveLength(1);expect(store.sent).toEqual([]);
  expect(readLocalDocument(join(h.dir,'bottle-letterbook.json')).sent).toEqual([]);
  expect(slots().letterDraft).toMatchObject({body:draft.body,deliveryReceipt:{letterId:h.db.letters[0].id}});
  recoverStorage();expect(reload().sent).toMatchObject([{body:draft.body}]);expect(slots().letterDraft).toBeNull();
});

it('retains a confirmed reply and held original on failure, then archives both atomically',async()=>{
  const {store,draft}=await setup('reply');failHistory('received');
  expect(await h.world.pageDeps().send('reply',draft as any)).toMatchObject({ok:false,close:false});
  expect(h.db.replies).toHaveLength(1);expect(store.draft).toBe(draft);expect(store.held?.letterId).toBe(draft.letterId);
  const failed=reload();expect(failed.draft?.body).toBe(draft.body);expect(failed.held?.letterId).toBe(draft.letterId);
  expect(failed.received[0].myReply).toBeUndefined();
  expect((await h.world.pageDeps().keep()).ok).toBe(false);
  expect((await h.world.pageDeps().dismiss()).ok).toBe(false);
  expect(store.draft).toBe(draft);
  h.clock.t+=80*3_600_000;
  h.world.pageDeps().snapshot();expect(store.draft?.sendFailure).toBeUndefined();
  recoverStorage();
  expect(await h.world.pageDeps().send('reply',draft as any)).toMatchObject({ok:true,close:true});
  const restored=reload();expect(restored.draft).toBeNull();expect(restored.held).toBeNull();
  expect(restored.received[0]).toMatchObject({outcome:'replied',myReply:draft.body,myReplyStationery:draft.stationery});
  expect(h.db.replies).toHaveLength(1);
});

it('does not treat a successful HTTP response without a reply confirmation as delivery',async()=>{
  const {draft}=await setup('reply');
  (h.world as any).client.reply=async()=>({ok:false,message:'未接受回信'});
  expect(await h.world.pageDeps().send('reply',draft as any)).toMatchObject({ok:false});
  expect(reload().draft?.body).toBe(draft.body);expect(reload().received[0].myReply).toBeUndefined();
});

it('does not submit a new letter when the pre-send state cannot be persisted',async()=>{
  const {draft}=await setup();
  withDatabase(h.dir,db=>db.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON local_documents WHEN NEW.key='letterDraft' BEGIN SELECT RAISE(ABORT,'storage unavailable'); END"));
  const result=await h.world.pageDeps().send('letter',draft as any);
  expect(result).toMatchObject({ok:false,close:false});expect(result.message).toContain('这次没有寄出');
  expect(h.db.letters).toHaveLength(0);expect(slots().letterDraft.body).toBe(draft.body);
  recoverStorage();expect((await h.world.pageDeps().send('letter',draft as any)).ok).toBe(true);
  expect(h.db.letters).toHaveLength(1);
});

it('blocks duplicate sends after restart if even the success receipt could not be written',async()=>{
  const {store,draft}=await setup();
  const client=(h.world as any).client,send=client.throwLetter.bind(client);
  client.throwLetter=async(...args:any[])=>{
    const result=await send(...args);
    withDatabase(h.dir,db=>db.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON local_documents WHEN NEW.key='letterDraft' BEGIN SELECT RAISE(ABORT,'storage became unavailable'); END"));
    return result;
  };
  expect(await h.world.pageDeps().send('letter',draft as any)).toMatchObject({ok:false,close:false});
  expect(slots().letterDraft).toMatchObject({deliveryPending:true,body:draft.body});
  expect(slots().letterDraft.deliveryReceipt).toBeUndefined();
  recoverStorage();await h.world.stop();await h.world.start(new FakeHost());
  const result=await h.world.pageDeps().send('letter',store.letterDraft as any);
  expect(result.ok).toBe(false);expect(result.message).toContain('不能重复投递');
  expect(h.db.letters).toHaveLength(1);
});

it('matches the persisted draft version when a receipt arrives after World restart',async()=>{
  const {store,draft}=await setup();
  const client=(h.world as any).client,send=client.throwLetter.bind(client);
  let resume!:()=>void,arrived!:()=>void;
  const delivered=new Promise<void>(done=>{arrived=done;});
  client.throwLetter=async(...args:any[])=>{const result=await send(...args);arrived();await new Promise<void>(done=>{resume=done;});return result;};
  const pending=h.world.pageDeps().send('letter',draft as any);await delivered;
  await h.world.stop();await h.world.start(new FakeHost());
  expect(store.letterDraft).not.toBe(draft);expect(store.letterDraft?.draftId).toBe(draft.draftId);
  resume();expect((await pending).ok).toBe(true);
  expect(store.letterDraft).toBeNull();expect(reload().letterDraft).toBeNull();
  expect(reload().sent).toHaveLength(1);expect(h.db.letters).toHaveLength(1);
});
