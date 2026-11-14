import {afterEach,expect,it,vi} from 'vitest';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {NoteCache} from '../world/note-cache.ts';
import {exportArchive,importArchive} from '../world/archive.ts';
import {LetterStars} from '../world/stars.ts';
import {NOTE_TTL_MS} from '../shared/contract.ts';

const rigs:Harness[]=[];
afterEach(async()=>{for(const h of rigs.splice(0))await h.stop();vi.restoreAllMocks();});
async function setup(){const h=makeHarness({port:0,config:{headlessEnabled:true,randomWake:false}});rigs.push(h);const host=new FakeHost();await h.world.start(host);return {h,host,store:Reflect.get(h.world,'store')};}

it('manual expiry preserves body and art across restart, new replies, export/import and explicit discard',async()=>{
  const {h,host,store}=await setup();const first=h.throwAs('peer','原信');await callTool(h.world,'bottle_catch');await host.deliverDeferred(h.world);h.world.onTurnEnded();
  const stationery={v:2,paper:'grid',decorations:[{doodle:'paper-plane',color:'#778899',x:20,y:30}]};
  await callTool(h.world,'bottle_reply',{text:'认真写过但没有来得及寄的话',stationery});const draft={...store.draft};
  h.clock.t=store.held.windowUntil;const exported=h.world.pageDeps().exportArchive!();
  expect(store.held).toBeNull();expect(store.draft).toMatchObject({body:draft.body,sendFailure:'expired'});
  expect(store.draft.autoSendKey).toBeUndefined();expect(store.draft.revision).toBe(draft.revision+1);
  expect((await h.world.pageDeps().send('reply')).ok).toBe(false);expect(h.db.replies).toHaveLength(0);
  await h.world.stop();const nextHost=new FakeHost();await h.world.start(nextHost);
  expect(store.received.find((r:any)=>r.letterId===first).unsentReplies[0]).toMatchObject({body:draft.body,stationery:draft.stationery});
  h.api.handle({method:'POST',path:'/catch',token:h.tokenOf('another-reader'),ip:'test',body:{}});
  const second=h.throwAs('peer-two','第二封原信');await callTool(h.world,'bottle_catch');await nextHost.deliverDeferred(h.world);h.world.onTurnEnded();
  expect(store.held.letterId).toBe(second);await callTool(h.world,'bottle_reply',{text:'第二封回信'});
  expect(store.draft.draftId).not.toBe(draft.draftId);expect(store.draft.sendFailure).toBeUndefined();
  expect(store.received.find((r:any)=>r.letterId===first).unsentReplies[0].body).toBe(draft.body);
  const target=await setup();expect(target.h.world.pageDeps().importArchive!(exported).ok).toBe(true);
  expect(target.store.received[0].unsentReplies[0].body).toBe(draft.body);
  const again=await setup();again.h.world.pageDeps().importArchive!(exported);again.store.setDraft({...draft,sendFailure:'expired'});
  expect((await again.h.world.pageDeps().discard('reply')).ok).toBe(true);expect(again.store.received[0].unsentReplies).toEqual([]);
});

it('a manual reply is also retained when the sea explicitly declares the original dead',async()=>{
  const {h,host,store}=await setup();const id=h.throwAs('peer','原信');await callTool(h.world,'bottle_catch');await host.deliverDeferred(h.world);h.world.onTurnEnded();
  await callTool(h.world,'bottle_reply',{text:'未寄出'});
  Reflect.get(h.world,'absorbLetterStates').call(h.world,{deadLetters:[{id,why:'tsunami'}]});
  expect(store.draft).toMatchObject({body:'未寄出',sendFailure:'expired'});expect(store.held).toBeNull();
});

it('v2 backup restores both note directions and read state without replay or pending-note resend',async()=>{
  const a=await setup(),cache=Reflect.get(a.h.world,'receivedNotes') as NoteCache;
  const at=new Date(a.h.clock.t).toISOString(),expiresAt=new Date(a.h.clock.t+NOTE_TTL_MS).toISOString();
  cache.receive({id:'received-paper',letterId:'original',from:'来客',body:'最后的一句话',at,expiresAt});
  cache.read('received-paper');cache.stageOutgoing('original','我也想留住这一刻','Coo');
  const doc=exportArchive(a.store,Reflect.get(a.h.world,'stars') as LetterStars,cache);
  expect(doc.schemaVersion).toBe(2);expect(doc.entries.filter(e=>e.kind==='note')).toHaveLength(2);
  const b=await setup(),restored=Reflect.get(b.h.world,'receivedNotes') as NoteCache;
  b.h.clock.t+=NOTE_TTL_MS*10;expect(b.h.world.pageDeps().importArchive!(doc).ok).toBe(true);
  expect(restored.get('received-paper')).toMatchObject({body:'最后的一句话',readAt:a.h.clock.t,imported:true});
  expect(restored.outgoing('original')).toMatchObject({body:'我也想留住这一刻',delivery:'unconfirmed'});
  const client=Reflect.get(b.h.world,'client'),notes=vi.spyOn(client,'notes').mockResolvedValue([]),send=vi.spyOn(client,'note');
  await Reflect.get(b.h.world,'refreshNotes').call(b.h.world);expect(b.host.deferred.filter(e=>e.type==='bottle.note-arrived')).toHaveLength(0);
  expect((await b.h.world.pageDeps().note!('original')).ok).toBe(false);expect(send).not.toHaveBeenCalled();
  expect(b.h.world.pageDeps().importArchive!(doc).ok).toBe(true);expect(restored.all()).toHaveLength(2);
  await b.h.world.stop();await b.h.world.start(new FakeHost());expect(restored.outgoing('original')?.delivery).toBe('unconfirmed');
  expect(notes).toHaveBeenCalled();restored.forget('original');expect(restored.all()).toEqual([]);
});

it('validates all imported paper records before any local mutation and still accepts v1 backups',async()=>{
  const {h,store}=await setup(),cache=Reflect.get(h.world,'receivedNotes') as NoteCache,stars=Reflect.get(h.world,'stars') as LetterStars;
  const before=JSON.stringify(store.sent);
  const entries=[{kind:'sent',value:{letterId:'valid',body:'前面的合法信',at:1000}},{kind:'note',value:{letterId:'bad',id:'bad',body:'损坏纸条'}}];
  expect(()=>importArchive(store,stars,{schemaVersion:2,exportedAt:new Date().toISOString(),entries},cache)).toThrow();
  expect(JSON.stringify(store.sent)).toBe(before);expect(cache.all()).toEqual([]);
  expect(importArchive(store,stars,{schemaVersion:1,exportedAt:new Date().toISOString(),entries:entries.slice(0,1)},cache)).toBe(1);
});

it('shared reading includes the actual signature, separate layouts and never-sent attribution',async()=>{
  const {h,host,store}=await setup();store.addReceived({letterId:'system-story',from:'海边邮局',signature:'独自看海的人',body:'故事',at:h.clock.t,seed:true,outcome:'kept',
    stationery:{v:2,paper:'line',decorations:[{doodle:'paper-plane',color:'#778899',x:12,y:24}]},unsentReplies:[{draftId:'old',body:'并未寄出的话',at:h.clock.t}]});
  expect((await h.world.pageDeps().peruse('system-story')).ok).toBe(true);const text=host.last('bottle.peruse')!.text;
  expect(text).toContain('独自看海的人');expect(text).toContain('paper-plane');expect(text).toContain('#778899');expect(text).toContain('not a rendered image');
  expect(text).toContain('NEVER SENT');expect(text).toContain('并未寄出的话');expect(text).not.toContain('某位居民');
});

it('note import preserves confirmed delivery, merges by ID and honors a prior local deletion',async()=>{
  const a=await setup(),cache=Reflect.get(a.h.world,'receivedNotes') as NoteCache;
  cache.stageOutgoing('outgoing','确认寄出的最后一句话','Coo');cache.confirmOutgoing('outgoing');
  const at=new Date(a.h.clock.t).toISOString(),expiresAt=new Date(a.h.clock.t+NOTE_TTL_MS).toISOString();
  cache.receive({id:'incoming',letterId:'incoming-letter',from:'来客',body:'对方的最后一句话',at,expiresAt});
  const doc=a.h.world.pageDeps().exportArchive!(),b=await setup(),restored=Reflect.get(b.h.world,'receivedNotes') as NoteCache;
  restored.receive({id:'incoming',letterId:'incoming-letter',from:'来客',body:'本机已经保存的版本',at,expiresAt});
  b.h.world.pageDeps().importArchive!(doc);expect(restored.get('incoming')!.body).toBe('本机已经保存的版本');
  expect(restored.outgoing('outgoing')).toMatchObject({delivery:'sent',body:'确认寄出的最后一句话'});
  restored.forget('incoming-letter');b.h.world.pageDeps().importArchive!(doc);expect(restored.get('incoming')).toBeUndefined();
});

it('imports retained expressions into an existing original without overwriting its local text',async()=>{
  const a=await setup();a.store.addReceived({letterId:'same',from:'来客',body:'备份原信',at:1,outcome:'expired',unsentReplies:[{draftId:'saved',body:'留住的话',at:2}]});
  const b=await setup();b.store.addReceived({letterId:'same',from:'来客',body:'本机原信',at:1,outcome:'kept'});
  const doc=a.h.world.pageDeps().exportArchive!();b.h.world.pageDeps().importArchive!(doc);b.h.world.pageDeps().importArchive!(doc);
  expect(b.store.received[0].body).toBe('本机原信');expect(b.store.received[0].unsentReplies).toHaveLength(1);
  expect(b.store.received[0].unsentReplies[0].body).toBe('留住的话');
});

it('an expired retained reply does not hide a new letter in the desktop review card',async()=>{
  const {h,store}=await setup();store.setDraft({kind:'reply',letterId:'old',body:'旧留稿',at:1,sendPolicy:'manual',sendFailure:'expired'});
  const show=vi.spyOn(h.world as any,'showCard').mockImplementation(()=>{});
  await callTool(h.world,'bottle_write',{text:'刚写好的新信'});
  expect(show).toHaveBeenCalled();expect(show.mock.calls.at(-1)?.[0]).toMatchObject({body:'刚写好的新信'});
});
