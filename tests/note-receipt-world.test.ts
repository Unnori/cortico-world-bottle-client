import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {handlePage} from '../world/page.ts';
import {NOTE_TTL_MS} from '../shared/contract.ts';
let h:Harness,host:FakeHost;
beforeEach(async()=>{h=makeHarness({config:{randomWake:false}});host=new FakeHost();await h.world.start(host);await vi.waitFor(()=>expect(h.world.pageDeps().snapshot().quota).not.toBeNull());});
afterEach(async()=>{await h.stop();});
const original='ORIGINAL_PRIVATE_一封原信';const answer='ANSWER_PRIVATE_原回信';const paper='PAPER_PRIVATE_谢谢你读过我的信';
async function incoming(){
 const peer=h.tokenOf('paper-author');
 const sent=h.api.handle({method:'POST',path:'/throw',token:peer,body:{topic:'随海风来',body:original},ip:'test'}).body as any;
 await callTool(h.world,'bottle_catch');await h.world.pageDeps().open('remote');await callTool(h.world,'bottle_reply',{text:answer});
 expect((await h.world.pageDeps().send('reply')).ok).toBe(true);
 const result=h.api.handle({method:'POST',path:'/note',token:peer,body:{letterId:sent.letterId,body:paper},ip:'test'});
 expect(result.status).toBe(200);return {letterId:sent.letterId,id:h.db.notes[0]!.id};
}
it('receives and notifies without a browser; only paper text is automatic, delivered changes unread to read',async()=>{
 const {id}=await incoming(),page=h.world.pageDeps();const push=vi.spyOn(host,'pushDeferred');
 await (h.world as any).refreshMailbox();
 expect(h.db.notes).toHaveLength(0);expect(await page.notes!()).toMatchObject([{id,body:paper,read:false}]);
 expect(push).toHaveBeenCalledWith(expect.objectContaining({type:'bottle.note-arrived',origin:'external'}),{trigger:'debounce'});
 const [event]=await host.deliverDeferred(h.world);
 expect(event!.text).toContain(paper);expect(event!.text).toContain('Tell your partner');expect(event!.text).not.toContain(original);expect(event!.text).not.toContain(answer);expect(event!.text).not.toContain(id);
 expect(await page.notes!()).toMatchObject([{id,read:true}]);
 await(h.world as any).refreshNotes();expect(host.deferred).toHaveLength(0);
});
it('read state survives restart; a pending undelivered paper retries after restart',async()=>{
 const {id}=await incoming(),page=h.world.pageDeps();await(h.world as any).refreshNotes();
 const stale=host.deferred[0]!;await h.world.stop();host=new FakeHost();await h.world.start(host);
 expect(await stale.render()).toBeNull();await(h.world as any).refreshNotes();
 expect(await page.notes!()).toMatchObject([{id,read:false}]);expect(host.deferred.filter(e=>e.type==='bottle.note-arrived')).toHaveLength(1);
 await host.deliverDeferred(h.world);await h.world.stop();host=new FakeHost();await h.world.start(host);await(h.world as any).refreshNotes();
 expect(await page.notes!()).toMatchObject([{id,read:true}]);expect(host.deferred.filter(e=>e.type==='bottle.note-arrived')).toHaveLength(0);
});
it('look together includes paper plus original title and reply, with read-only authority and no read counter',async()=>{
 const {id,letterId}=await incoming(),page=h.world.pageDeps();await(h.world as any).refreshNotes();await host.deliverDeferred(h.world);
 const count=page.snapshot().received.find(n=>n.letterId===letterId)?.readCount;
 const result=await handlePage(page,'POST','/note/read',{body:{id}});expect(result.json).toMatchObject({ok:true});
 expect(await callTool(h.world,'bottle_reply',{text:'不应回信'})).toContain('不能回');expect(await callTool(h.world,'bottle_note',{text:'不应起草'})).toContain('只有人邀请');
 const [event]=await host.deliverDeferred(h.world);expect(event!.type).toBe('bottle.note-reading');
 for(const text of [paper,original,answer,'随海风来'])expect(event!.text).toContain(text);
 expect(event!.text).toContain('Read and share your thoughts only');expect(event!.text).not.toContain(letterId);
 expect(page.snapshot().received.find(n=>n.letterId===letterId)?.readCount).toBe(count);
 h.world.onTurnEnded();expect((h.world as any).authorized).toBeNull();
});
it('discarded events stay unread and may be retried, successful ones do not repeat',async()=>{
 const {id}=await incoming();await(h.world as any).refreshNotes();const queued=host.deferred.shift()!;
 const text=await queued.render();const event=await host.pushEvent({type:queued.type,source:'bottle',ts:new Date().toISOString(),meta:queued.meta,text:String(text)});
 h.world.onEventsSettled([event],'discarded');expect((await h.world.pageDeps().notes!())[0]!.read).toBe(false);
 expect(host.deferred.filter(e=>e.type==='bottle.note-arrived')).toHaveLength(1);await host.deliverDeferred(h.world);
 expect(await h.world.pageDeps().notes!()).toMatchObject([{id,read:true}]);
});
it('keeps server copy when local receipt fails; retries transport ACK without notifying twice',async()=>{
 await incoming();const cache=(h.world as any).receivedNotes,client=(h.world as any).client;
 const receive=vi.spyOn(cache,'receive').mockImplementationOnce(()=>{throw Error('disk unavailable');});
 await(h.world as any).refreshNotes();expect(h.db.notes).toHaveLength(1);expect(host.deferred).toHaveLength(0);receive.mockRestore();
 const ack=vi.spyOn(client,'ackNote').mockRejectedValueOnce(Error('network unavailable'));
 await(h.world as any).refreshNotes();expect(h.db.notes).toHaveLength(1);expect(host.deferred).toHaveLength(1);
 await host.deliverDeferred(h.world);await(h.world as any).refreshNotes();expect(h.db.notes).toHaveLength(0);expect(host.deferred).toHaveLength(0);ack.mockRestore();
});
it('deleting correspondence removes paper bodies and cancels queued reading, failed ACK cannot restore it',async()=>{
 const {id,letterId}=await incoming(),page=h.world.pageDeps(),client=(h.world as any).client;
 vi.spyOn(client,'ackNote').mockRejectedValue(Error('offline'));await(h.world as any).refreshNotes();
 const queued=host.deferred[0]!;await page.forget(letterId);
 expect(await queued.render()).toBeNull();expect(await page.notes!()).toEqual([]);
 expect(readFileSync((h.world as any).receivedNotes.file,'utf8')).not.toContain(paper);
 await h.world.stop();host=new FakeHost();await h.world.start(host);await(h.world as any).refreshNotes();expect(await page.notes!()).toEqual([]);
 // Body-free deletion receipts expire too.
 h.clock.t+=NOTE_TTL_MS+1;await(h.world as any).refreshNotes();
 expect(readFileSync((h.world as any).receivedNotes.file,'utf8')).not.toContain(id);
});
it('server expiry preserves together-reading; missing historical bodies get an honest explanation',async()=>{
 const {id}=await incoming(),page=h.world.pageDeps();await(h.world as any).refreshNotes();await host.deliverDeferred(h.world);
 (h.world as any).store.received=[];
 expect((await page.readNote!(id)).ok).toBe(true);const queued=host.deferred.at(-1)!;
 expect(await queued.render()).toContain('The original was not saved locally');
 h.clock.t+=NOTE_TTL_MS+1;expect(await queued.render()).toBeNull();expect((await page.notes!())[0]?.body).toBe(paper);
 expect((await page.readNote!(id)).ok).toBe(true);const events=await host.deliverDeferred(h.world);expect(events.at(-1)!.text).toContain(paper);
 expect(readFileSync((h.world as any).receivedNotes.file,'utf8')).toContain(paper);
});
it('a failed host enqueue leaves paper unread and retries later',async()=>{
 await incoming();const push=vi.spyOn(host,'pushDeferred').mockImplementationOnce(()=>{throw Error('queue unavailable');});
 await(h.world as any).refreshNotes();expect((await h.world.pageDeps().notes!())[0]!.read).toBe(false);
 push.mockRestore();await(h.world as any).refreshNotes();await host.deliverDeferred(h.world);expect((await h.world.pageDeps().notes!())[0]!.read).toBe(true);
});

it('a together click supersedes a queued arrival instead of delivering duplicate note events',async()=>{
 const {id}=await incoming(),page=h.world.pageDeps();await(h.world as any).refreshNotes();
 expect((await page.readNote!(id)).ok).toBe(true);
 const events=await host.deliverDeferred(h.world);expect(events.map(e=>e.type)).toEqual(['bottle.note-reading']);
 expect((await page.notes!())[0]!.read).toBe(true);h.world.onTurnEnded();
});
it('clearing the letterbook cancels queued note reading and removes local note bodies',async()=>{
 const {id}=await incoming(),page=h.world.pageDeps();await(h.world as any).refreshNotes();
 await page.readNote!(id);const queued=host.deferred.at(-1)!;
 expect((await page.forget()).ok).toBe(true);expect(await queued.render()).toBeNull();expect((h.world as any).authorized).toBeNull();
 expect(await page.notes!()).toEqual([]);expect(readFileSync((h.world as any).receivedNotes.file,'utf8')).not.toContain(paper);
});

it('read papers remain attached to their original correspondence after years and a World restart',async()=>{
 const {id,letterId}=await incoming(),page=h.world.pageDeps();await(h.world as any).refreshNotes();await host.deliverDeferred(h.world);
 h.clock.t+=5*365*24*3_600_000;await h.world.stop();host=new FakeHost();await h.world.start(host);
 const papers=await page.notes!();expect(papers).toMatchObject([{id,letterId,body:paper,read:true}]);
 expect(host.deferred.filter(e=>e.type==='bottle.note-arrived')).toHaveLength(0);
 expect((await page.readNote!(id)).ok).toBe(true);const events=await host.deliverDeferred(h.world);
 for(const text of [paper,original,answer])expect(events[0]!.text).toContain(text);
});

it('a real cache save failure never ACKs the only server copy; receiving can resume safely',async()=>{
 const {id}=await incoming(),cache=(h.world as any).receivedNotes,client=(h.world as any).client;
 const ack=vi.spyOn(client,'ackNote'),fail=vi.spyOn(cache,'save').mockImplementation(()=>{throw Error('disk unavailable');});
 await(h.world as any).refreshNotes();expect(ack).not.toHaveBeenCalled();expect(h.db.notes.map(n=>n.id)).toContain(id);expect(cache.get(id)).toBeUndefined();
 fail.mockRestore();await(h.world as any).refreshNotes();expect(ack).toHaveBeenCalledWith(id);expect(h.db.notes).toHaveLength(0);
 await h.world.stop();host=new FakeHost();await h.world.start(host);expect(await h.world.pageDeps().notes!()).toMatchObject([{id,body:paper}]);
});
