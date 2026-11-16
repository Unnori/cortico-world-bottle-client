import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import type {DatabaseSync as SQLiteDatabase} from 'node:sqlite';
import {LOCAL_DB_NAME,readLocalDocument,writeLocalDocument,localStorageStatus,localRevision,localTransaction,readLocalBackup,putAsset,getAsset,digest,withDatabase} from '../world/local-db.ts';
import {LocalStore} from '../world/store.ts';
const dirs:string[]=[];
const DatabaseSync=createRequire(import.meta.url)('node:sqlite').DatabaseSync as typeof SQLiteDatabase;
const dir=()=>{const value=mkdtempSync(join(tmpdir(),'bottle-sql-'));dirs.push(value);return value;};
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
it('migrates old dual drafts, letterbook, papers and permissions losslessly once, with original-byte backup',()=>{
  const root=dir(),old={held:{letterId:'a',body:'held',windowUntil:9000},sent:[{letterId:'b',body:'sent',at:2}],received:[{letterId:'a',from:'sender',body:'original',myReply:'reply',at:1,outcome:'replied',receivedAt:1000,readCount:3,unsentReplies:[{draftId:'saved',body:'never erase',at:5}]}],replies:[{letterId:'b',from:'other',body:'answer',at:3}]};
  writeFileSync(join(root,'bottle-letterbook.json'),JSON.stringify(old));
  writeFileSync(join(root,'bottle-draft.json'),JSON.stringify({draft:{kind:'reply',letterId:'a',body:'confirmed',at:5,autoSendAt:8000,autoSendKey:'same',sendPolicy:'delayed'},letterDraft:{kind:'letter',body:'first',at:6}}));
  writeFileSync(join(root,'bottle-notes.json'),JSON.stringify({schemaVersion:1,notes:[{id:'p',letterId:'a',from:'sender',body:'paper',at:'2026-11-16T00:00:00.000Z',expiresAt:'2026-11-23T00:00:00.000Z',readAt:12}],forgotten:[]}));
  expect(readLocalDocument(join(root,'bottle-letterbook.json'))).toEqual(old);
  const status=localStorageStatus(root);expect(status.backups).toHaveLength(1);expect(existsSync(join(root,'bottle-letterbook.json'))).toBe(false);
  const backup=JSON.parse(gunzipSync(readLocalBackup(root,status.backups[0].id)).toString());
  expect(Buffer.from(backup.files.find((r:any)=>r.path==='bottle-letterbook.json').data,'base64').toString()).toBe(JSON.stringify(old));
  expect(readFileSync(join(root,LOCAL_DB_NAME)).subarray(0,16).toString()).toBe('SQLite format 3\0');
  const store=new LocalStore(root);store.load();expect(store.draft?.autoSendKey).toBe('same');expect(store.letterDraft?.body).toBe('first');expect(store.received[0].unsentReplies?.[0].body).toBe('never erase');
  expect(localStorageStatus(root).backups).toHaveLength(1);expect(readLocalDocument(join(root,'bottle-notes.json')).notes[0].readAt).toBe(12);
});
it('aborts corrupt legacy migration without deleting source or presenting an empty book',()=>{
  const root=dir(),path=join(root,'bottle-letterbook.json');writeFileSync(path,'{broken');
  expect(()=>new LocalStore(root).load()).toThrow('损坏');expect(readFileSync(path,'utf8')).toBe('{broken');
  writeFileSync(path,JSON.stringify({sent:[{letterId:'restored',body:'still here',at:1}]}));
  const store=new LocalStore(root);store.load();expect(store.sent[0].body).toBe('still here');
});
it('refuses duplicate source IDs and rolls back partial migrations',()=>{
  const root=dir(),path=join(root,'bottle-letterbook.json');writeFileSync(path,JSON.stringify({sent:[{letterId:'a',body:'one'},{letterId:'a',body:'two'}]}));
  expect(()=>readLocalDocument(path)).toThrow('重复');expect(existsSync(path)).toBe(true);
  writeFileSync(path,JSON.stringify({sent:[{letterId:'a',body:'one'}]}));expect(readLocalDocument(path).sent).toHaveLength(1);
});
it.each([
  ['bottle-letterbook.json',[]],
  ['bottle-letterbook.json',null],
  ['bottle-letterbook.json',{sent:{letterId:'a',body:'recoverable'}}],
  ['bottle-letterbook.json',{received:null}],
  ['bottle-letterbook.json',{replies:[null]}],
  ['bottle-letterbook.json',{sent:[{body:'missing identity'}]}],
  ['bottle-letterbook.json',{received:[{letterId:'a',body:123}]}],
  ['bottle-letterbook.json',{held:[]}],
  ['bottle-letterbook.json',{held:{letterId:'a'}}],
  ['bottle-letterbook.json',{received:[{letterId:'a',body:'original',unsentReplies:{body:'retained'}}]}],
  ['bottle-letterbook.json',{received:[{letterId:'a',body:'original',unsentReplies:[{draftId:'d',body:3,at:1}]}]}],
  ['bottle-draft.json',{draft:'recoverable'}],
  ['bottle-draft.json',{letterDraft:{kind:'reply',body:'wrong slot',at:1}}],
  ['bottle-draft.json',{draft:{kind:'letter',body:'first',at:1},letterDraft:{kind:'letter',body:'second',at:2}}],
  ['bottle-notes.json',{schemaVersion:1,notes:{id:'paper',body:'recoverable'}}],
  ['bottle-notes.json',{schemaVersion:1,notes:[{id:'paper',letterId:'a',body:'no delivery dates'}]}],
  ['bottle-notes.json',{schemaVersion:1,forgotten:[{id:'paper',letterId:'a',expiresAt:0}]}],
  ['bottle-stars.json',{stars:[{letterId:'a',starredAt:'yesterday'}]}],
  ['bottle-state.json',false],
] as const)('rejects structurally damaged %s before normalizing or removing any source', (name,value)=>{
  const root=dir(),path=join(root,name),source=JSON.stringify(value),identity=JSON.stringify({clientId:'old-client',pseudonym:'old name'});
  writeFileSync(path,source);writeFileSync(join(root,'bottle-id.json'),identity);
  expect(()=>new LocalStore(root).load()).toThrow(/损坏|重复/);
  expect(readFileSync(path,'utf8')).toBe(source);expect(readFileSync(join(root,'bottle-id.json'),'utf8')).toBe(identity);
  const db=new DatabaseSync(join(root,LOCAL_DB_NAME));
  try{
    expect(db.prepare('SELECT COUNT(*) AS n FROM local_documents').get()?.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM local_records').get()?.n).toBe(0);
    expect(db.prepare("SELECT value FROM local_meta WHERE key='migration'").get()).toBeUndefined();
  }finally{db.close();}
});
it.each([
  ['bottle-notes.json',{schemaVersion:1,notes:[],forgotten:[{id:'paper',letterId:'a',expiresAt:'2026-11-23T00:00:00.000Z'},{id:'paper',letterId:'a',expiresAt:'2026-11-23T00:00:00.000Z'}]}],
  ['bottle-stars.json',{schemaVersion:1,stars:[{letterId:'a',starredAt:1},{letterId:'a',starredAt:2}]}],
  ['bottle-letterbook.json',{received:[{letterId:'a',body:'original',unsentReplies:[{draftId:'same',body:'first',at:1},{draftId:'same',body:'second',at:2}]}]}],
] as const)('preserves duplicate records in %s for recovery', (name,value)=>{
  const root=dir(),path=join(root,name),source=JSON.stringify(value);writeFileSync(path,source);
  expect(()=>new LocalStore(root).load()).toThrow('重复');expect(readFileSync(path,'utf8')).toBe(source);
});
it.each([
  [{kind:'letter',body:'bare letter',at:1},'letterDraft','bare letter'],
  [{draft:{kind:'letter',body:'old letter slot',at:2}},'letterDraft','old letter slot'],
  [{draft:{letterId:'a',body:'old reply without kind'}},'draft','old reply without kind'],
  [{draft:null,letterDraft:{body:'letter slot without kind'}},'letterDraft','letter slot without kind'],
] as const)('preserves supported historical draft wrappers without requiring newer fields', (value,slot,body)=>{
  const root=dir();writeFileSync(join(root,'bottle-draft.json'),JSON.stringify(value));
  writeFileSync(join(root,'bottle-letterbook.json'),JSON.stringify({received:[{letterId:'a',body:'old original',outcome:'future-outcome'}]}));
  const store=new LocalStore(root);store.load();expect(store[slot]?.body).toBe(body);
  expect(store.received[0]).toMatchObject({letterId:'a',body:'old original',from:'一位陌生人',at:0,outcome:'dismissed'});
});
it('commits related changes atomically and leaves revision unchanged on a failed transaction',()=>{
  const root=dir(),book=join(root,'bottle-letterbook.json'),notes=join(root,'bottle-notes.json');
  writeLocalDocument(book,{sent:[{letterId:'one',body:'old'}]});const revision=localRevision(root);
  expect(()=>localTransaction(root,()=>{writeLocalDocument(book,{sent:[{letterId:'two',body:'new'}]});writeLocalDocument(notes,{notes:[{id:'p',letterId:'two'}]});throw Error('injected');})).toThrow('injected');
  expect(readLocalDocument(book).sent[0].letterId).toBe('one');expect(readLocalDocument(notes).notes).toEqual([]);expect(localRevision(root)).toBe(revision);
  writeLocalDocument(book,{sent:[{letterId:'one',body:'old'}]});expect(localRevision(root)).toBe(revision);
});
it('migrates custom binary assets into verified BLOBs and rejects unsupported future schema',()=>{
  const root=dir(),bytes=Buffer.from('000100000000000000000000','hex'),id=digest(bytes)+'.ttf';mkdirSync(join(root,'bottle-my-fonts'));writeFileSync(join(root,'bottle-my-fonts',id),bytes);
  expect(getAsset(root,'font',id)?.bytes).toEqual(bytes);expect(existsSync(join(root,'bottle-my-fonts',id))).toBe(false);
  putAsset(root,{kind:'sound',id:'custom',name:'own.wav',mime:'audio/wav',bytes:Buffer.from('own'),metadata:{}});expect(getAsset(root,'sound','custom')?.name).toBe('own.wav');
  withDatabase(root,db=>db.exec('PRAGMA user_version=999'));expect(()=>localRevision(root)).toThrow('更新版本');
});
