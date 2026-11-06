import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {NoteCache} from '../world/note-cache.ts';import {NOTE_TTL_MS} from '../shared/contract.ts';
let dirs:string[]=[];afterEach(()=>{for(const dir of dirs)rmSync(dir,{recursive:true,force:true});dirs=[];});
function rig(){const dir=mkdtempSync(join(tmpdir(),'bottle-notes-'));dirs.push(dir);const clock={t:Date.parse('2026-11-06T08:00:00Z')};const cache=new NoteCache(dir,()=>clock.t);return {cache,clock,dir,note:{id:'note-one',letterId:'original-one',from:'来客',body:'一张等待被读到的纸条',at:new Date(clock.t).toISOString(),expiresAt:new Date(clock.t+NOTE_TTL_MS).toISOString()}};}
it('local notes and read status survive server expiry and restart indefinitely',()=>{
 const {cache,clock,dir,note}=rig();cache.receive(note);cache.read(note.id);
 const reloaded=new NoteCache(dir,()=>clock.t);reloaded.load();expect(reloaded.all()[0]).toMatchObject({...note,readAt:clock.t});
 clock.t+=10*365*24*3_600_000;const archived=new NoteCache(dir,()=>clock.t);archived.load();expect(archived.all()).toEqual(reloaded.all());expect(readFileSync(cache.file,'utf8')).toContain(note.body);archived.forget(note.letterId);expect(archived.all()).toEqual([]);expect(readFileSync(cache.file,'utf8')).not.toContain(note.body);
});
it('deleting all papers erases bodies immediately, suppressed redelivery survives restart but expires',()=>{
 const {cache,clock,dir,note}=rig();cache.receive(note);cache.forget();
 expect(readFileSync(cache.file,'utf8')).not.toContain(note.body);const next=new NoteCache(dir,()=>clock.t);next.load();next.receive(note);expect(next.all()).toEqual([]);
 clock.t+=NOTE_TTL_MS+1;next.prune();expect(readFileSync(cache.file,'utf8')).not.toContain(note.id);
});
it('deleting one correspondence preserves unrelated papers; duplicate transport cannot overwrite a read body',()=>{
 const {cache,note}=rig();cache.receive(note);cache.read(note.id);cache.receive({...note,body:'被重传修改的内容'});
 cache.receive({...note,id:'second-note',letterId:'second-letter'});expect(cache.get(note.id)!.body).toBe(note.body);
 cache.forget(note.letterId);expect(cache.all().map(n=>n.id)).toEqual(['second-note']);
});
it('rejects oversized, expired, malformed and overlong-lived records, including persisted ones',()=>{
 const {cache,clock,dir,note}=rig();
 for(const value of [{...note,body:'字'.repeat(41)},{...note,expiresAt:'bad'},{...note,expiresAt:new Date(clock.t-1).toISOString()},{...note,expiresAt:new Date(clock.t+NOTE_TTL_MS+1).toISOString()},{...note,id:''}])expect(cache.receive(value)).toBeNull();
 writeFileSync(cache.file,JSON.stringify({schemaVersion:1,notes:[{...note,body:'字'.repeat(41)}]}));const next=new NoteCache(dir,()=>clock.t);next.load();expect(next.all()).toEqual([]);
});

it('migrates older cache files even when their server expiry has already passed; late model delivery marks read',()=>{
 const {cache,clock,dir,note}=rig();writeFileSync(cache.file,JSON.stringify({schemaVersion:1,notes:[note],forgotten:[]}));
 clock.t+=NOTE_TTL_MS+1;const migrated=new NoteCache(dir,()=>clock.t);migrated.load();
 expect(migrated.get(note.id)?.body).toBe(note.body);migrated.read(note.id);expect(migrated.get(note.id)?.readAt).toBe(clock.t);
 // Old remote packets still cannot introduce already-expired, previously unknown papers.
 expect(migrated.receive({...note,id:'late-unseen'})).toBeNull();
});
