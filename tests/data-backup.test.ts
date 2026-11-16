import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DataBackupManager,captureBackup,parseBackup,DATA_CATEGORIES,TRANSFER_CHUNK_BYTES,type BackupDocument} from '../world/data-backup.ts';
import {writeLocalDocument,readLocalDocument,localRevision,localBackups,readLocalBackup,withDatabase,putAsset,getAsset,digest,LOCAL_DB_NAME,localStorageStatus} from '../world/local-db.ts';
import {collectUserAssets} from '../world/user-assets.ts';
import {LocalStore} from '../world/store.ts';
import {NoteCache} from '../world/note-cache.ts';
const roots:string[]=[],managers:DataBackupManager[]=[];
const root=()=>{const d=mkdtempSync(join(tmpdir(),'bottle-data-'));roots.push(d);return d;};
const manager=(d:string,hooks:any={},now=Date.now)=>{const value=new DataBackupManager(d,hooks,now);managers.push(value);return value;};
const book=(d:string,value:any)=>writeLocalDocument(join(d,'bottle-letterbook.json'),value);
const readBook=(d:string)=>readLocalDocument(join(d,'bottle-letterbook.json'));
afterEach(()=>{for(const m of managers.splice(0))m.dispose();for(const d of roots.splice(0))rmSync(d,{recursive:true,force:true});});
async function stage(m:DataBackupManager,document:unknown):Promise<any>{const bytes=Buffer.isBuffer(document)?document:gzipSync(JSON.stringify(document));const started=m.begin({size:bytes.length}) as any;for(let offset=0;offset<bytes.length;offset+=TRANSFER_CHUNK_BYTES)m.chunk({id:started.id,offset,data:bytes.subarray(offset,offset+TRANSFER_CHUNK_BYTES).toString('base64')});return m.preview({id:started.id});}
function fixture(d:string):void{
  const at=Date.parse('2026-11-16T12:00:00+08:00');
  book(d,{sent:[{letterId:'sent',body:'outgoing',at}],received:[{letterId:'incoming',from:'partner',body:'incoming',at,outcome:'replied',receivedAt:at,readCount:2,myReply:'my answer',stationery:{v:1,customSvg:'<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2"/></svg>'},unsentReplies:[{draftId:'retained',body:'unsent feelings',at}]},{letterId:'system',from:'post',body:'system letter',at,outcome:'kept',seed:true}],replies:[{letterId:'sent',from:'stranger',body:'reply body',at}]});
  writeLocalDocument(join(d,'bottle-notes.json'),{schemaVersion:1,notes:[{id:'sent:sent',letterId:'sent',body:'paper',from:'self',at:new Date(at).toISOString(),expiresAt:new Date(at+86400000).toISOString(),direction:'sent',delivery:'pending'}],forgotten:[{id:'private-deletion',letterId:'incoming',expiresAt:new Date(at+86400000).toISOString()}]});
  writeLocalDocument(join(d,'bottle-stars.json'),{schemaVersion:1,stars:[{letterId:'sent',starredAt:at,memorySelected:true}]});
  writeLocalDocument(join(d,'bottle-draft.json'),{draft:{kind:'reply',letterId:'incoming',body:'confirmed original',at,autoSendKey:'PRIVATE-AUTO-SEND-KEY',autoSendAt:at+1,sendPolicy:'delayed'},letterDraft:{kind:'letter',body:'draft body',at}});
  writeLocalDocument(join(d,'bottle-id.json'),{clientId:'PRIVATE-IDENTITY',pseudonym:'same'});
  writeLocalDocument(join(d,'bottle-appearance.json'),{theme:'paper',mode:'dark'});
}
it('exports selected categories only and strips identities, consent and automatic-send credentials',()=>{
  const d=root();fixture(d);const document=captureBackup(d);expect(document.categories).toEqual(Array.from(DATA_CATEGORIES));
  const json=JSON.stringify(document);expect(json).toContain('unsent feelings');expect(json).toContain('paper');expect(json).not.toContain('PRIVATE');expect(json).not.toContain('memorySelected');expect(json).not.toContain('private-deletion');expect(json).not.toContain('autoSendAt');
  expect(parseBackup(document).archive.entries).toHaveLength(6);
  const only=captureBackup(d,['system']);expect(only.archive.entries).toHaveLength(1);expect(only.archive.entries[0].value.body).toBe('system letter');expect(only.settings).toEqual({});expect(only.drafts).toBeUndefined();
});
it('preview changes nothing; cancellation keeps current, old v2 JSON merges without replay or grants',async()=>{
  const source=root(),dest=root();fixture(source);book(dest,{sent:[{letterId:'sent',body:'LOCAL WINS',at:1}]});
  const m=manager(dest),revision=localRevision(dest),backup=captureBackup(source,['letters','system','notes','stars']);
  let p=await stage(m,backup);expect(p.current.total).toBe(1);expect(p.incoming.total).toBe(4);expect(localRevision(dest)).toBe(revision);m.cancel({id:p.id});expect(readBook(dest).sent[0].body).toBe('LOCAL WINS');
  const legacy={...backup.archive,schemaVersion:2};p=await stage(m,Buffer.from(JSON.stringify(legacy)));const result:any=await m.confirm({id:p.id,mode:'merge',backup:true});expect(result.ok).toBe(true);
  expect(readBook(dest).sent[0].body).toBe('LOCAL WINS');const notes=new NoteCache(dest,Date.now);notes.load();expect(notes.all()[0]).toMatchObject({imported:true,delivery:'unconfirmed'});expect(readLocalDocument(join(dest,'bottle-stars.json')).stars[0].memorySelected).toBe(false);
  const after=localRevision(dest);expect(await m.confirm({id:p.id,mode:'merge',backup:true})).toEqual(result);expect(localRevision(dest)).toBe(after);
});
it('replacement is limited to selected categories and saves the prior expressions first',async()=>{
  const d=root();fixture(d);const src=root();book(src,{received:[{letterId:'new-system',from:'post',body:'new seed',at:1,outcome:'kept',seed:true}]});
  const m=manager(d),p=await stage(m,captureBackup(src,['system']));const result:any=await m.confirm({id:p.id,mode:'replace',backup:true});
  expect(readBook(d).sent[0].body).toBe('outgoing');expect(readBook(d).received.map((r:any)=>r.letterId)).toEqual(['incoming','new-system']);
  const previous=JSON.parse(gunzipSync(readLocalBackup(d,result.backup)).toString());expect(previous.categories).toEqual(['system']);expect(previous.archive.entries[0].value.body).toBe('system letter');
});
it('protects held correspondence and confirmed drafts, including pending papers, during history replacement',async()=>{
  const d=root();fixture(d);const store=new LocalStore(d);store.load();store.setHeld({letterId:'incoming',from:'partner',body:'incoming',caughtAt:1,windowUntil:999999});
  const src=root(),m=manager(d),p=await stage(m,captureBackup(src,['letters','notes']));await m.confirm({id:p.id,mode:'replace',backup:false});
  expect(readBook(d).received[0].body).toBe('incoming');expect(readBook(d).sent[0].letterId).toBe('sent');expect(readLocalDocument(join(d,'bottle-draft.json')).draft.autoSendKey).toBe('PRIVATE-AUTO-SEND-KEY');
  const p2=await stage(m,captureBackup(src,['drafts']));await expect(m.confirm({id:p2.id,mode:'replace',backup:true})).rejects.toThrow('待处理草稿');
});
it('rejects stale, busy, expired and malformed imports before touching data',async()=>{
  const d=root();book(d,{sent:[{letterId:'a',body:'old',at:1}]});const src=root();book(src,{sent:[{letterId:'b',body:'new',at:2}]});let t=1000,busy=false;
  const m=manager(d,{busy:()=>busy},()=>t),backup=captureBackup(src,['letters']);let p=await stage(m,backup);book(d,{sent:[{letterId:'a',body:'changed',at:1}]});await expect(m.confirm({id:p.id,mode:'replace',backup:false})).rejects.toThrow('变化');
  p=await stage(m,backup);busy=true;await expect(m.confirm({id:p.id,mode:'replace',backup:false})).rejects.toThrow('正在处理');busy=false;t+=600001;await expect(m.confirm({id:p.id,mode:'replace',backup:false})).rejects.toThrow('过期');
  const broken=structuredClone(backup);broken.archive.entries.push({kind:'sent',value:{letterId:'bad'}});await expect(stage(m,broken)).rejects.toThrow();expect(readBook(d).sent[0].body).toBe('changed');
});
it('backup failure and SQLite transaction failure both preserve prior data',async()=>{
  const d=root(),src=root();book(d,{sent:[{letterId:'old',body:'old',at:1}]});book(src,{sent:[{letterId:'new',body:'new',at:2}]});const m=manager(d),p=await stage(m,captureBackup(src,['letters']));
  writeFileSync(join(d,'bottle-backups'),'not a directory');await expect(m.confirm({id:p.id,mode:'replace',backup:true})).rejects.toThrow();expect(readBook(d).sent[0].letterId).toBe('old');
  withDatabase(d,db=>db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON local_records WHEN NEW.id='new' BEGIN SELECT RAISE(ABORT,'injected database failure'); END"));
  await expect(m.confirm({id:p.id,mode:'replace',backup:false})).rejects.toThrow('injected');expect(readBook(d).sent[0].letterId).toBe('old');
});
it('restored drafts get fresh manual identity; replies remain unsendable expressions',async()=>{
  const src=root(),d=root();fixture(src);const m=manager(d),p=await stage(m,captureBackup(src,['letters','drafts']));await m.confirm({id:p.id,mode:'merge',backup:false});
  const store=new LocalStore(d);store.load();expect(store.letterDraft).toMatchObject({body:'draft body',sendPolicy:'manual',revision:1});expect(store.draft).toBeNull();expect(store.received[0].unsentReplies?.some(r=>r.body==='confirmed original')).toBe(true);expect(JSON.stringify(readLocalDocument(join(d,'bottle-draft.json')))).not.toContain('autoSend');
});
it('custom fonts, themes and sounds roundtrip with verified bytes; built-in sounds are excluded',async()=>{
  const src=root(),d=root(),font=Buffer.from('000100000000000000000000','hex'),sound=Buffer.from('RIFF0000WAVEcustom');
  collectUserAssets(src,{});expect(captureBackup(src,['sounds']).assets).toEqual([]);
  putAsset(src,{kind:'font',id:digest(font)+'.ttf',name:'我的字体.ttf',mime:'font/ttf',bytes:font,metadata:{}});putAsset(src,{kind:'sound',id:digest(sound)+'.wav',name:'我的声音.wav',mime:'audio/wav',bytes:sound,metadata:{}});writeLocalDocument(join(src,'bottle-appearance.json'),{theme:'custom',mode:'light',customColor:'#123456'});
  const backup=captureBackup(src,['fonts','sounds','theme']),m=manager(d),p=await stage(m,backup);await m.confirm({id:p.id,mode:'replace',backup:false});expect(getAsset(d,'font',digest(font)+'.ttf')?.bytes).toEqual(font);expect(getAsset(d,'sound',digest(sound)+'.wav')?.bytes).toEqual(sound);expect(readLocalDocument(join(d,'bottle-appearance.json')).customColor).toBe('#123456');
  const corrupt=structuredClone(backup);corrupt.assets[0].data=Buffer.from('different').toString('base64');expect(()=>parseBackup(corrupt)).toThrow('校验');
});
it('one audio file can serve both slots and independent devices without overwriting associations',()=>{
  const d=root(),m=manager(d),bytes=Buffer.from('RIFF0000WAVEcustom'),sound={enabled:false,volume:70,fade:250,incoming:'local',reply:'local'};
  m.collectDevice({id:'one',preferences:{sound,readingSize:26},assets:[{slot:'incoming',name:'a.wav',data:bytes.toString('base64')},{slot:'reply',name:'a.wav',data:bytes.toString('base64')}]});
  m.collectDevice({id:'two',preferences:{sound},assets:[{slot:'incoming',name:'a.wav',data:bytes.toString('base64')}]});
  expect((m.device({id:'one'}) as any).assets[0].metadata.slots).toEqual(['incoming','reply']);expect((m.device({id:'two'}) as any).assets[0].metadata.slots).toEqual(['incoming']);
});
it('bounds chunks, enforces ordering and expires previews without restoring permissions',async()=>{
  const d=root(),m=manager(d),upload=m.begin({size:3}) as any;expect(()=>m.chunk({id:upload.id,offset:1,data:'YQ=='})).toThrow('顺序');m.chunk({id:upload.id,offset:0,data:'YWJj'});await expect(m.preview({id:upload.id})).rejects.toThrow();
  expect(()=>m.begin({size:129*1024*1024})).toThrow('128');expect(()=>parseBackup({format:'bottle-backup',version:99})).toThrow('支持');
});
it('stopping during asynchronous export cannot recreate staged files after disposal',async()=>{
  const d=root(),m=manager(d),pending=m.export(['letters']);m.dispose();await expect(pending).rejects.toThrow('已停止');
});
it('also backs up a durable held original whose history write had not completed',()=>{
  const d=root();book(d,{held:{letterId:'held-only',from:'Guest',body:'唯一的原文',caughtAt:1,windowUntil:99}});
  const backup=parseBackup(captureBackup(d,['letters']));expect(backup.archive.entries[0].value).toMatchObject({letterId:'held-only',body:'唯一的原文',outcome:'caught'});expect(JSON.stringify(backup)).not.toContain('windowUntil');
});
it.each([false,true])('restores held-only migration originals as history, never remote ownership (seed=%s)',async(seed)=>{
  const src=root(),dest=root(),held={letterId:'held-only',from:'Guest',body:'唯一持久化的原文',caughtAt:100,receivedAt:101,windowUntil:999999,readAt:102,caughtBy:'bot',catchSource:'private-controller',dead:true,seed,signature:'署名',topic:'信题',stationery:{v:1,paper:'line'}};
  writeFileSync(join(src,'bottle-letterbook.json'),JSON.stringify({held,sent:[],received:[],replies:[]}));
  writeFileSync(join(src,'bottle-draft.json'),'null');
  const migration=localStorageStatus(src),bytes=readLocalBackup(src,migration.backups[0].id),m=manager(dest),p=await stage(m,bytes);
  expect(p.incoming.total).toBe(1);expect(p.incoming[seed?'system':'received']).toBe(1);
  await m.confirm({id:p.id,mode:'merge',backup:false});
  const store=new LocalStore(dest);store.load();
  expect(store.held).toBeNull();expect(store.draft).toBeNull();expect(store.letterDraft).toBeNull();
  expect(store.received).toHaveLength(1);expect(store.received[0]).toMatchObject({letterId:held.letterId,body:held.body,from:held.from,signature:held.signature,topic:held.topic,stationery:held.stationery,at:held.caughtAt,receivedAt:held.receivedAt,outcome:'caught'});
  const restored=JSON.stringify(readBook(dest));for(const key of ['windowUntil','readAt','caughtBy','catchSource','dead'])expect(restored).not.toContain('"'+key+'"');
});
it('does not duplicate or overwrite existing migration history with the held copy',async()=>{
  const src=root(),dest=root(),received={letterId:'same',from:'Guest',body:'历史原文',at:50,outcome:'replied',myReply:'已经保存的回复'};
  writeFileSync(join(src,'bottle-letterbook.json'),JSON.stringify({held:{letterId:'same',from:'Guest',body:'持信副本',caughtAt:100,windowUntil:999999},received:[received]}));
  const migration=localStorageStatus(src),m=manager(dest),p=await stage(m,readLocalBackup(src,migration.backups[0].id));
  expect(p.incoming.total).toBe(1);await m.confirm({id:p.id,mode:'merge',backup:false});
  expect(readBook(dest).received).toHaveLength(1);expect(readBook(dest).received[0]).toMatchObject(received);expect(readBook(dest).held).toBeNull();
});
it('replacement also preserves correspondence needed by an active in-memory paper draft',async()=>{
  const d=root(),src=root();book(d,{sent:[{letterId:'writing-paper',body:'原信',at:1}]});
  const m=manager(d,{protectedIds:()=>['writing-paper']}),p=await stage(m,captureBackup(src,['letters']));await m.confirm({id:p.id,mode:'replace',backup:false});expect(readBook(d).sent[0].body).toBe('原信');
});
it('replacing a library preserves material still referenced by retained letters and unselected themes',async()=>{
  const d=root(),src=root(),font=Buffer.from('000100000000000000000000','hex'),fontId=digest(font)+'.ttf';
  putAsset(d,{kind:'font',id:fontId,name:'字体.ttf',mime:'font/ttf',bytes:font,metadata:{}});writeLocalDocument(join(d,'bottle-appearance.json'),{theme:'paper',mode:'dark',myFont:fontId});
  const svg=Buffer.from('<svg viewBox="0 0 10 10"><circle r="2"/></svg>');putAsset(d,{kind:'doodle',id:'kept-art',name:'老图案',mime:'image/svg+xml',bytes:svg,metadata:{}});
  book(d,{received:[{letterId:'kept',from:'Guest',body:'保留的信',at:1,outcome:'kept',stationery:{v:1,doodle:'kept-art'}}]});
  const m=manager(d),p=await stage(m,captureBackup(src,['fonts','doodles']));await m.confirm({id:p.id,mode:'replace',backup:false});expect(getAsset(d,'font',fontId)?.bytes).toEqual(font);expect(getAsset(d,'doodle','kept-art')?.bytes).toEqual(svg);expect(readBook(d).received[0].body).toBe('保留的信');
});
it('letter-only backup embeds custom art, so later library replacement cannot repaint imported correspondence',()=>{
  const d=root(),svg=Buffer.from('<svg viewBox="0 0 10 10"><circle r="2" fill="#123456"/></svg>');putAsset(d,{kind:'doodle',id:'saved-art',name:'图案',mime:'image/svg+xml',bytes:svg,metadata:{}});
  book(d,{received:[{letterId:'a',from:'Guest',body:'带图案的信',at:1,outcome:'kept',stationery:{v:1,doodle:'saved-art'}}]});
  const saved=parseBackup(captureBackup(d,['letters']));expect(saved.assets).toEqual([]);expect((saved.archive.entries[0].value.stationery as any).customSvg).toContain('#123456');expect((saved.archive.entries[0].value.stationery as any).doodle).toBeUndefined();
});
