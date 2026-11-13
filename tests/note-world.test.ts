import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {readFileSync} from 'node:fs';
import {NOTE_TTL_MS} from '../shared/contract.ts';
import {FakeHost} from './fake-host.ts';
import {handlePage,pageHtml} from '../world/page.ts';
let h:Harness,host:FakeHost;
beforeEach(async()=>{h=makeHarness({config:{randomWake:false}});host=new FakeHost();await h.world.start(host);await vi.waitFor(()=>expect(h.world.pageDeps().snapshot().quota).not.toBeNull());});
afterEach(async()=>{await h.stop();});
async function correspondence(){
 await callTool(h.world,'bottle_write',{title:'我寄出的信',text:'原信正文。'});await h.world.pageDeps().send('letter');
 const id=h.world.pageDeps().snapshot().sent[0]!.letterId,peer=h.tokenOf('peer');
 h.api.handle({method:'POST',path:'/catch',token:peer,body:{},ip:'test'});
 expect(h.api.handle({method:'POST',path:'/reply',token:peer,body:{letterId:id,body:'对方的回信。'},ip:'test'}).status).toBe(200);
 await (h.world as any).refreshMailbox();return id;
}
it('author receives a reply, Coo drafts, human confirms to send A -> B',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();
 expect((await page.note!(id)).ok).toBe(false);
 expect((await page.requestNote!(id,'remote')).ok).toBe(true);
 const event=host.last('bottle.note-request')!;expect(event.text).toContain('对方的回信。');expect(event.text).toContain('原信正文。');expect(event.text).not.toContain(id);
 expect(await callTool(h.world,'bottle_reply',{text:'不能改为回信'})).toContain('不能回');
 expect(await callTool(h.world,'bottle_note',{text:'谢谢你接住这阵海风。'})).toContain('草稿');
 expect(h.db.notes).toHaveLength(0);expect(page.snapshot().noteDraft?.body).toBe('谢谢你接住这阵海风。');
 const sent=await handlePage(page,'POST','/note',{body:{letterId:id}});expect(sent.json).toMatchObject({ok:true});
 const letter=h.db.letterById(id)!;expect(h.db.notes[0]).toMatchObject({fromHash:letter.authorHash,toHash:letter.catcherHash,body:'谢谢你接住这阵海风。'});
 expect(page.snapshot().noteDraft).toBeNull();
});
it('browser cannot supply or replace text, even with an existing Coo draft',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'Coo 的原话。'});
 for(const path of ['/note','/note/request','/note/rewrite','/note/discard'])expect((await handlePage(page,'POST',path,{body:{letterId:id,body:'人类改字'}})).status).toBe(400);
 expect(page.snapshot().noteDraft?.body).toBe('Coo 的原话。');expect(h.db.notes).toHaveLength(0);
 expect(pageHtml()).not.toContain('<textarea id="paper-body"');
});
it('requires the note invitation, validates 40 chars, never reuses read or reply authority',async()=>{
 expect(await callTool(h.world,'bottle_note',{text:'不能自发寄出'})).toContain('只有人邀请');
 const id=await correspondence();await h.world.pageDeps().requestNote!(id,'page');
 expect(await callTool(h.world,'bottle_note',{text:'海'.repeat(41)})).toContain('1—40');
 expect(h.world.pageDeps().snapshot().noteDraft).toBeNull();
 expect(await callTool(h.world,'bottle_note',{text:'🌊'.repeat(40)})).toContain('草稿');
 expect(await callTool(h.world,'bottle_note',{text:'第二张'})).toContain('只有人邀请');
});
it('draft has no disk copy and is removed on discard, expiry, record deletion and restart',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();
 async function draft(){await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'只暂存在内存。'});}
 await draft();page.discardNote!(id);expect(page.snapshot().noteDraft).toBeNull();
 await draft();h.clock.t+=3_600_000;expect(page.snapshot().noteDraft).toBeNull();
 await draft();await h.world.stop();await h.world.start(host);expect(page.snapshot().noteDraft).toBeNull();
 await draft();await page.forget(id);expect(page.snapshot().noteDraft).toBeNull();
});
it('World mailbox panel exposes the same offline merge backup operations',async()=>{
 await correspondence();const ui=h.world.webUi();const archive=await ui.invoke!('mailbox','archiveExport',[]) as any;
 expect(archive.schemaVersion).toBe(1);expect(archive.entries.some((e:any)=>e.kind==='reply')).toBe(true);
 expect(await ui.invoke!('mailbox','archiveImport',[archive])).toMatchObject({ok:true});
 expect(await ui.invoke!('mailbox','archiveImport',[{schemaVersion:99}])).toMatchObject({ok:false});
});
it('catch receipt includes actual signature and existing title without contact substitution',async()=>{
 const peer=h.tokenOf('title-peer');h.api.handle({method:'POST',path:'/throw',token:peer,body:{topic:'mail@example.com',body:'PRIVATE_BODY_ONLY'},ip:'test'});
 const result=await callTool(h.world,'bottle_catch');expect(result).toContain('署名是「'+h.world.pageDeps().snapshot().held?.from+'」');expect(result).toContain('标题：「mail@example.com」');expect(result).not.toContain('PRIVATE_BODY_ONLY');expect(result).not.toContain('模糊');
});
it('an untitled catch never quotes the first body line as a title',async()=>{
 h.throwAs('untitled-peer','PRIVATE_FIRST_LINE\nPRIVATE_NEXT_LINE');const result=await callTool(h.world,'bottle_catch');expect(result).not.toContain('标题');expect(result).not.toContain('PRIVATE_FIRST_LINE');expect(result).toContain('署名是');
});

it('only Coo replaces a draft after a rewrite invitation; invalid output keeps the original and original TTL',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();
 expect((await page.rewriteNote!(id,'page')).ok).toBe(false);
 await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'最初的小纸条。'});
 const first=page.snapshot().noteDraft!,quota=page.snapshot().quota!.catches_left;
 h.clock.t+=60_000;
 const result=await handlePage(page,'POST','/note/rewrite',{body:{letterId:id},surface:'remote'});
 expect(result.json).toMatchObject({ok:true});expect(host.last('bottle.note-request')!.text).toContain('rewrite your previous draft');
 expect(page.snapshot()).toMatchObject({noteRewriting:true,noteDraft:first});
 expect((await page.note!(id)).ok).toBe(false);
 expect(await callTool(h.world,'bottle_note',{text:'海'.repeat(41)})).toContain('1—40');
 expect(page.snapshot().noteDraft).toEqual(first);
 expect(await callTool(h.world,'bottle_note',{text:'换一句，也谢谢你。'})).toContain('草稿');
 expect(page.snapshot()).toMatchObject({noteRewriting:false,noteDraft:{body:'换一句，也谢谢你。',at:first.at}});
 expect(page.snapshot().quota!.catches_left).toBe(quota);expect(h.db.notes).toHaveLength(0);
 expect((await page.note!(id)).ok).toBe(true);expect(h.db.notes[0]!.body).toBe('换一句，也谢谢你。');
});
it('discard revokes an outstanding rewrite and cannot recreate the abandoned draft',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'旧稿'});
 await page.rewriteNote!(id,'page');expect(page.discardNote!(id).ok).toBe(true);
 expect(await callTool(h.world,'bottle_note',{text:'迟到的新稿'})).toContain('只有人邀请');expect(page.snapshot().noteDraft).toBeNull();
});
it('a rewrite finishing after the draft expires does not revive it',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'旧稿'});
 h.clock.t+=3_590_000;await page.rewriteNote!(id,'page');h.clock.t+=11_000;
 expect(await callTool(h.world,'bottle_note',{text:'新稿'})).toContain('失效');expect(page.snapshot().noteDraft).toBeNull();
});
it('sending serializes repeated clicks and blocks rewriting or discarding the captured body',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'正在投递的原稿'});
 const client=(h.world as any).client,original=client.note.bind(client);let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});vi.spyOn(client,'note').mockImplementation(async(...args:unknown[])=>{await gate;return original(...args);});
 const pending=page.note!(id);
 expect((await page.note!(id)).ok).toBe(false);expect((await page.rewriteNote!(id,'page')).ok).toBe(false);expect(page.discardNote!(id).ok).toBe(false);
 expect((await page.forget(id)).ok).toBe(false);
 release();expect((await pending).ok).toBe(true);expect(h.db.notes).toHaveLength(1);
});

it('sent papers persist under their correspondence after refresh, restart and server expiry without incoming notifications',async()=>{
 const id=await correspondence(),page=h.world.pageDeps(),body='寄给你的话，也留在我们的信册里。';
 await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:body});
 expect((await page.note!(id)).ok).toBe(true);
 const row=(await page.notes!())[0]!;expect(row).toMatchObject({letterId:id,body,from:'Coo',direction:'sent',delivery:'sent'});
 expect(readFileSync((h.world as any).receivedNotes.file,'utf8')).toContain(body);
 expect(page.snapshot().noteDraft).toBeNull();expect((await page.requestNote!(id,'page')).ok).toBe(false);
 const quota=page.snapshot().quota!.catches_left;expect((await page.note!(id)).ok).toBe(true);expect(page.snapshot().quota!.catches_left).toBe(quota);
 h.clock.t+=10*365*24*3_600_000;await h.world.stop();host=new FakeHost();await h.world.start(host);
 expect(await page.notes!()).toMatchObject([{letterId:id,body,direction:'sent',delivery:'sent'}]);
 expect(host.deferred.filter(e=>e.type==='bottle.note-arrived')).toHaveLength(0);
 expect((await page.readNote!(row.id)).ok).toBe(true);expect((await host.deliverDeferred(h.world))[0]!.text).toContain(body);h.world.onTurnEnded();
 await page.forget(id);expect(await page.notes!()).toEqual([]);expect(readFileSync((h.world as any).receivedNotes.file,'utf8')).not.toContain(body);
});
it('cannot contact the server if the confirmed outgoing body cannot be saved locally',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'要先记下来再寄。'});
 const cache=(h.world as any).receivedNotes,write=vi.spyOn(cache,'save').mockImplementationOnce(()=>{throw Error('disk full');});
 const send=vi.spyOn((h.world as any).client,'note');expect(await page.note!(id)).toMatchObject({ok:false,message:expect.stringContaining('没有尝试寄出')});
 expect(send).not.toHaveBeenCalled();expect(h.db.notes).toHaveLength(0);expect(page.snapshot().noteDraft?.body).toBe('要先记下来再寄。');expect(cache.all()).toEqual([]);write.mockRestore();
});
it('lost send response keeps the exact pending body across restart and confirms without a second quota charge',async()=>{
 const id=await correspondence(),page=h.world.pageDeps(),body='网络断了也别把这句话丢掉。';await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:body});
 const client=(h.world as any).client,send=client.note.bind(client),fail=vi.spyOn(client,'note').mockImplementationOnce(async(...args:unknown[])=>{await send(...args);throw Error('lost response');});
 expect((await page.note!(id)).ok).toBe(false);expect(h.db.notes).toHaveLength(1);const used=h.db.bots[0]!.catchesUsed;
 expect(await page.notes!()).toMatchObject([{body,direction:'sent',delivery:'pending'}]);expect(page.snapshot().noteDraft).toBeNull();
 expect((await page.rewriteNote!(id,'page')).ok).toBe(false);fail.mockRestore();
 h.clock.t+=3_600_001;await h.world.stop();host=new FakeHost();await h.world.start(host);expect((await page.note!(id)).ok).toBe(true);
 expect(h.db.bots[0]!.catchesUsed).toBe(used);expect(h.db.notes).toHaveLength(1);expect(await page.notes!()).toMatchObject([{body,direction:'sent',delivery:'sent'}]);
});
it('a failed final disk update retains a durable pending copy, and never repeats beyond the server receipt lifetime',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'服务器收到，本机也要留下。'});
 const cache=(h.world as any).receivedNotes,save=cache.save.bind(cache);let writes=0;
 const fail=vi.spyOn(cache,'save').mockImplementation(()=>{if(++writes===2)throw Error('final disk update failed');save();});
 expect((await page.note!(id)).ok).toBe(false);expect(h.db.notes).toHaveLength(1);expect(cache.outgoing(id)?.delivery).toBe('pending');fail.mockRestore();
 await h.world.stop();host=new FakeHost();await h.world.start(host);expect(cache.outgoing(id)?.delivery).toBe('pending');
 h.clock.t+=NOTE_TTL_MS;const send=vi.spyOn((h.world as any).client,'note');expect(await page.note!(id)).toMatchObject({ok:false,message:expect.stringContaining('安全重试')});expect(send).not.toHaveBeenCalled();expect(cache.outgoing(id)?.body).toBe('服务器收到，本机也要留下。');
});
it('a pre-fix server receipt cannot make a new draft masquerade as the lost original note',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();await(h.world as any).client.note(id,'旧版本已经寄出的纸条');
 await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'这不是旧纸条的原文。'});
 expect(await page.note!(id)).toMatchObject({ok:false,message:expect.stringContaining('无法从回执找回')});expect(await page.notes!()).toEqual([]);expect(h.db.notes[0]?.body).toBe('旧版本已经寄出的纸条');
});

it('two independent World clients retain their own copy after recipient ACK deletes the server note and both restart',async()=>{
 const relay:typeof fetch=async(input,init)=>{
   const url=new URL(String(input)),headers=new Headers(init?.headers);
   const result=h.api.handle({method:init?.method??'GET',path:url.pathname,token:headers.get('authorization')?.replace(/^Bearer /i,''),ip:'test-peer',body:init?.body?JSON.parse(String(init.body)):undefined});
   return new Response(JSON.stringify(result.body),{status:result.status,headers:{'content-type':'application/json'}});
 };
 const peer=makeHarness({fetchImpl:relay,port:17861,botName:'Mio',config:{randomWake:false}});let peerHost=new FakeHost();
 try{
   await peer.world.start(peerHost);await vi.waitFor(()=>expect(peer.world.pageDeps().snapshot().quota).not.toBeNull());
   await callTool(h.world,'bottle_write',{title:'两边都要留存',text:'从一台机器寄往另一台。'});await h.world.pageDeps().send('letter');const id=h.world.pageDeps().snapshot().sent[0]!.letterId;
   await callTool(peer.world,'bottle_catch');await peer.world.pageDeps().open('remote');await callTool(peer.world,'bottle_reply',{text:'我在另一边收到了。'});expect((await peer.world.pageDeps().send('reply')).ok).toBe(true);
   await(h.world as any).refreshMailbox();await h.world.pageDeps().requestNote!(id,'page');const body='这句话留在我们各自的信后面。';await callTool(h.world,'bottle_note',{text:body});expect((await h.world.pageDeps().note!(id)).ok).toBe(true);
   await(peer.world as any).refreshNotes();expect(h.db.notes).toHaveLength(0);await peerHost.deliverDeferred(peer.world);
   expect(await h.world.pageDeps().notes!()).toMatchObject([{body,letterId:id,direction:'sent',delivery:'sent'}]);expect(await peer.world.pageDeps().notes!()).toMatchObject([{body,letterId:id,read:true}]);
   h.clock.t+=NOTE_TTL_MS+1;peer.clock.t=h.clock.t;await h.world.stop();await peer.world.stop();host=new FakeHost();peerHost=new FakeHost();await h.world.start(host);await peer.world.start(peerHost);
   expect(await h.world.pageDeps().notes!()).toMatchObject([{body,letterId:id,direction:'sent'}]);expect(await peer.world.pageDeps().notes!()).toMatchObject([{body,letterId:id,read:true}]);
   expect(host.deferred.filter(e=>e.type==='bottle.note-arrived')).toHaveLength(0);expect(peerHost.deferred.filter(e=>e.type==='bottle.note-arrived')).toHaveLength(0);
   expect(readFileSync((h.world as any).receivedNotes.file,'utf8')).toContain(body);expect(readFileSync((peer.world as any).receivedNotes.file,'utf8')).toContain(body);
 }finally{await peer.stop();}
});

it('clearing the letterbook cannot race a send while waiting for reply cancellation',async()=>{
 const id=await correspondence(),page=h.world.pageDeps();await page.requestNote!(id,'page');await callTool(h.world,'bottle_note',{text:'清空与寄出撞上也要先保护记录。'});
 const clear=page.forget(),send=page.note!(id);expect((await clear).ok).toBe(false);expect((await send).ok).toBe(true);
 expect(await page.notes!()).toMatchObject([{letterId:id,delivery:'sent',body:'清空与寄出撞上也要先保护记录。'}]);expect(page.snapshot().sent.some(n=>n.letterId===id)).toBe(true);
});
