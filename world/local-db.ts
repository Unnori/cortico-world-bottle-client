/** Bottle-owned persistence. Short transactions, one connection per operation, no native addons. */
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync, readdirSync, chmodSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { NOTE_TTL_MS } from '../shared/contract.ts';
import { checkNote } from '../shared/text.ts';
import { checkStationery } from '../shared/stationery.ts';

export const LOCAL_DB_NAME = 'bottle-local.sqlite';
export const LEGACY_DOCUMENTS = ['bottle-id.json','bottle-state.json','bottle-draft.json','bottle-letterbook.json','bottle-notes.json','bottle-stars.json','bottle-wake.json','bottle-appearance.json','bottle-host-theme.json','bottle-font-map.json','bottle-font-catalog.json'] as const;
export const LEGACY_ASSETS = { 'bottle-my-fonts':'font', 'bottle-backgrounds':'background' } as const;
export type AssetKind = 'font'|'background'|'sound'|'doodle';
export interface LocalAsset { kind:AssetKind; id:string; name:string; mime:string; bytes:Buffer; metadata:Record<string,unknown> }
export const digest = (bytes:string|Uint8Array):string => createHash('sha256').update(bytes).digest('hex');
type Row = Record<string,unknown>;
const active = new Map<string,DatabaseSync>();
const require = createRequire(import.meta.url);
function sqlite(file:string):DatabaseSync {
  let Constructor:typeof DatabaseSync;
  try { Constructor=require('node:sqlite').DatabaseSync; }
  catch { throw Error('新版漂流瓶需要 Node 22.13 或更高版本的 SQLite 支持。旧数据尚未改动，请先升级桌宠运行环境。'); }
  const db=new Constructor(file);
  try {
    db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
    const version=Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
    if(version>1)throw Error('这份本机数据库由更新版本创建，请使用对应的新版本，原数据未改动。');
    db.exec(`CREATE TABLE IF NOT EXISTS local_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_documents(key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_records(bucket TEXT NOT NULL,id TEXT NOT NULL,ordinal INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(bucket,id));
      CREATE INDEX IF NOT EXISTS local_record_order ON local_records(bucket,ordinal);
      CREATE TABLE IF NOT EXISTS local_assets(kind TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(kind,id));
      INSERT OR IGNORE INTO local_meta VALUES('revision','0'); PRAGMA user_version=1;`);
    return db;
  } catch(e) {db.close();throw e;}
}
function meta(db:DatabaseSync,key:string):string|undefined{return (db.prepare('SELECT value FROM local_meta WHERE key=?').get(key) as Row|undefined)?.value as string|undefined;}
function setMeta(db:DatabaseSync,key:string,value:string):void{db.prepare('INSERT INTO local_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
function doc(db:DatabaseSync,key:string):any {const row=db.prepare('SELECT json FROM local_documents WHERE key=?').get(key) as Row|undefined;return row?JSON.parse(String(row.json)):null;}
function setDoc(db:DatabaseSync,key:string,value:unknown):void {
  db.prepare('INSERT INTO local_documents VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json WHERE json<>excluded.json').run(key,JSON.stringify(value));
}
export function recordRows(db:DatabaseSync,bucket:string):any[]{return (db.prepare('SELECT json FROM local_records WHERE bucket=? ORDER BY ordinal').all(bucket) as Row[]).map(r=>JSON.parse(String(r.json)));}
export function replaceRows(db:DatabaseSync,bucket:string,values:any[],idKey='letterId'):void {
  const previous=new Set((db.prepare('SELECT id FROM local_records WHERE bucket=?').all(bucket) as Row[]).map(r=>String(r.id)));
  const insert=db.prepare('INSERT INTO local_records VALUES(?,?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET ordinal=excluded.ordinal,json=excluded.json WHERE ordinal<>excluded.ordinal OR json<>excluded.json');
  const seen=new Set<string>();
  values.forEach((value,index)=>{const id=String(value?.[idKey]??index);if(seen.has(id))throw Error('本机记录存在重复编号，旧文件已保留，请先检查数据。');seen.add(id);previous.delete(id);insert.run(bucket,id,index,JSON.stringify(value));});
  const remove=db.prepare('DELETE FROM local_records WHERE bucket=? AND id=?');for(const id of previous)remove.run(bucket,id);
}
export function readDocumentFrom(db:DatabaseSync,key:string):any {
  if(key==='bottle-letterbook.json')return {held:doc(db,'held'),sent:recordRows(db,'sent'),received:recordRows(db,'received'),replies:recordRows(db,'reply')};
  if(key==='bottle-draft.json')return {draft:doc(db,'replyDraft'),letterDraft:doc(db,'letterDraft')};
  if(key==='bottle-notes.json')return {schemaVersion:1,notes:recordRows(db,'note'),forgotten:recordRows(db,'forgotten')};
  if(key==='bottle-stars.json')return {schemaVersion:1,stars:recordRows(db,'star')};
  return doc(db,key);
}
export function writeDocumentTo(db:DatabaseSync,key:string,value:any):void {
  if(!LEGACY_DOCUMENTS.includes(key as any)&&!/^device:[a-z0-9-]{1,64}$/.test(key))throw Error('Unknown local document');
  if(key==='bottle-letterbook.json'){
    setDoc(db,'held',value?.held??null);
    for(const [field,bucket] of [['sent','sent'],['received','received'],['replies','reply']])replaceRows(db,bucket,Array.isArray(value?.[field])?value[field]:[]);
  }else if(key==='bottle-draft.json'){
    const wrapped=value&&('draft' in value||'letterDraft' in value),legacy=wrapped?value.draft:value;
    setDoc(db,'replyDraft',legacy&&legacy.kind!=='letter'?legacy:null);
    setDoc(db,'letterDraft',wrapped?value.letterDraft??(legacy?.kind==='letter'?legacy:null):legacy?.kind==='letter'?legacy:null);
  }else if(key==='bottle-notes.json'){
    replaceRows(db,'note',Array.isArray(value?.notes)?value.notes:[],'id');replaceRows(db,'forgotten',Array.isArray(value?.forgotten)?value.forgotten:[],'id');
  }else if(key==='bottle-stars.json')replaceRows(db,'star',Array.isArray(value?.stars)?value.stars:[]);
  else setDoc(db,key,value);
}
/** Validate before any legacy file can be normalized, committed, or removed. */
export function validateLegacyDocument(key:string,value:unknown):void {
  const fail=(field:string,duplicate=false):never=>{throw Error(`旧数据文件${duplicate?'存在重复记录':'结构已损坏'}，未迁移也未覆盖：${key}（${field}）`);};
  const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const id=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=256;
  const text=(v:unknown)=>typeof v==='string';
  const time=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  const optional=(v:Record<string,any>,field:string,valid:(v:any)=>boolean,path:string)=>{
    if(Object.hasOwn(v,field)&&!valid(v[field]))fail(path+'.'+field);
  };
  const record=(v:unknown,path:string):Record<string,any>=>{if(!object(v))fail(path);return v as Record<string,any>;};
  const rows=(v:Record<string,any>,field:string,idKey:string,validate:(row:Record<string,any>,path:string)=>void,path='')=>{
    if(!Object.hasOwn(v,field))return;
    if(!Array.isArray(v[field]))fail(path+field);
    const seen=new Set<string>();
    v[field].forEach((raw:unknown,index:number)=>{
      const rowPath=`${path}${field}[${index}]`,row=record(raw,rowPath);
      if(!id(row[idKey]))fail(rowPath+'.'+idKey);
      if(seen.has(row[idKey]))fail(rowPath+'.'+idKey,true);seen.add(row[idKey]);validate(row,rowPath);
    });
  };
  const content=(v:Record<string,any>,path:string)=>{
    if(!id(v.letterId)||!text(v.body))fail(path);
    for(const field of ['from','topic','signature','myReply','outcome'])optional(v,field,text,path);
    for(const field of ['at','receivedAt','lastCaughtAt','lastReadAt','caughtAt','windowUntil','readAt'])optional(v,field,time,path);
    optional(v,'readCount',n=>Number.isSafeInteger(n)&&n>=0,path);
    for(const field of ['seed','dead','pickedNoticed','stationeryRejected','myReplyStationeryRejected'])optional(v,field,n=>typeof n==='boolean',path);
    for(const field of ['stationery','myReplyStationery'])optional(v,field,n=>checkStationery(n).ok,path);
    rows(v,'unsentReplies','draftId',(reply,replyPath)=>{
      if(!text(reply.body)||!time(reply.at))fail(replyPath);
      optional(reply,'stationery',n=>checkStationery(n).ok,replyPath);
    },path+'.');
  };
  const draft=(v:unknown,path:string,letterSlot=false)=>{
    if(v===null)return;
    const d=record(v,path);
    if(!text(d.body)||!d.body)fail(path+'.body');
    optional(d,'kind',kind=>kind==='letter'||!letterSlot&&kind==='reply',path);
    optional(d,'letterId',id,path);optional(d,'at',time,path);
    optional(d,'topic',text,path);optional(d,'draftId',n=>typeof n==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(n),path);
    optional(d,'revision',n=>Number.isSafeInteger(n)&&n>0,path);
    optional(d,'sendPolicy',n=>n==='manual'||n==='delayed',path);
    optional(d,'sendFailure',n=>n==='expired',path);
    optional(d,'autoSendKey',n=>typeof n==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(n),path);
    optional(d,'autoSendAt',time,path);optional(d,'stationery',n=>checkStationery(n).ok,path);
    optional(d,'deliveryReceipt',n=>object(n)&&id(n.letterId)&&time(n.at),path);
    optional(d,'deliveryPending',n=>n===true,path);
  };
  // Older versions wrote either a bare draft or a one-slot wrapper; null is an empty draft.
  if(key==='bottle-draft.json'&&value===null)return;
  const v=record(value,'根对象');
  if(key==='bottle-letterbook.json'){
    if(Object.hasOwn(v,'held')&&v.held!==null)content(record(v.held,'held'),'held');
    for(const field of ['sent','received','replies'])rows(v,field,'letterId',content);
  }else if(key==='bottle-draft.json'){
    if(Object.hasOwn(v,'draft')||Object.hasOwn(v,'letterDraft')){
      if(Object.hasOwn(v,'draft'))draft(v.draft,'draft');
      if(Object.hasOwn(v,'letterDraft'))draft(v.letterDraft,'letterDraft',true);
      if(v.draft?.kind==='letter'&&v.letterDraft)fail('letterDraft',true);
    }else draft(v,'draft');
  }else if(key==='bottle-notes.json'){
    if(v.schemaVersion!==1)fail('schemaVersion');
    rows(v,'notes','id',(n,path)=>{
      const at=typeof n.at==='string'?Date.parse(n.at):NaN,expires=typeof n.expiresAt==='string'?Date.parse(n.expiresAt):NaN;
      if(!id(n.letterId)||!text(n.from)||!checkNote(n.body).ok||!Number.isFinite(at)||!Number.isFinite(expires)||expires<=at||expires>at+NOTE_TTL_MS)fail(path);
      optional(n,'direction',n=>n==='sent',path);optional(n,'delivery',n=>['pending','sent','unconfirmed'].includes(n),path);
      optional(n,'readAt',time,path);optional(n,'receivedAt',time,path);optional(n,'imported',n=>typeof n==='boolean',path);
    });
    rows(v,'forgotten','id',(n,path)=>{if(!id(n.letterId)||typeof n.expiresAt!=='string'||!Number.isFinite(Date.parse(n.expiresAt)))fail(path);});
  }else if(key==='bottle-stars.json'){
    optional(v,'schemaVersion',n=>n===1,'stars');
    rows(v,'stars','letterId',(n,path)=>{if(!time(n.starredAt))fail(path);optional(n,'memorySelected',n=>typeof n==='boolean',path);});
  }
}
function migration(db:DatabaseSync,dir:string):void {
  if(meta(db,'migration'))return;
  const files:Array<{path:string;relative:string;bytes:Buffer}>=[],documents:Array<[string,unknown]>=[];
  for(const name of LEGACY_DOCUMENTS){
    const path=join(dir,name);if(!existsSync(path))continue;
    const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw Error('旧数据文件无法安全读取：'+name);
    const bytes=readFileSync(path);files.push({path,relative:name,bytes});
    let value:unknown;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('旧数据文件已损坏，未迁移也未覆盖：'+name);}
    validateLegacyDocument(name,value);documents.push([name,value]);
  }
  const assets:LocalAsset[]=[];
  for(const [folder,kind] of Object.entries(LEGACY_ASSETS)){
    const directory=join(dir,folder);if(!existsSync(directory))continue;
    if(lstatSync(directory).isSymbolicLink())throw Error('自定义素材目录不能是符号链接：'+folder);
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      if(!entry.isFile()||!/^[a-f0-9]{64}\.(?:ttf|otf|woff2?|png|jpg|webp)$/.test(entry.name))continue;
      const path=join(directory,entry.name),size=lstatSync(path).size;if(size>32*1024*1024)throw Error('旧素材文件过大：'+entry.name);
      const bytes=readFileSync(path),ext=entry.name.split('.').at(-1)!;
      if(digest(bytes)!==entry.name.slice(0,64))throw Error('旧素材校验失败，未覆盖原文件：'+entry.name);
      const mime:Record<string,string>={ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2',png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
      files.push({path,relative:folder+'/'+entry.name,bytes});assets.push({kind:kind as AssetKind,id:entry.name,name:entry.name,mime:mime[ext],bytes,metadata:{}});
    }
  }
  let backup:string|null=null;
  if(files.length){
    const payload=JSON.stringify({format:'bottle-legacy-source',version:1,createdAt:new Date().toISOString(),files:files.map(f=>({path:f.relative,sha256:digest(f.bytes),data:f.bytes.toString('base64')}))});
    backup=saveLocalBackup(dir,gzipSync(payload),'migration');
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const [key,value] of documents)writeDocumentTo(db,key,value);
    for(const asset of assets)putAssetTo(db,asset);
    for(const [key,value] of documents){
      const read=readDocumentFrom(db,key);
      // Structured stores normalize old wrappers; all other source values must round-trip exactly.
      if(!['bottle-letterbook.json','bottle-draft.json','bottle-notes.json','bottle-stars.json'].includes(key)&&JSON.stringify(read)!==JSON.stringify(value))throw Error('Migration verification failed');
      const source=value as any;
      const pairs=key==='bottle-letterbook.json'?[['sent','sent'],['received','received'],['replies','replies']]:key==='bottle-notes.json'?[['notes','notes'],['forgotten','forgotten']]:key==='bottle-stars.json'?[['stars','stars']]:[];
      for(const [a,b] of pairs)if(JSON.stringify(Array.isArray(source?.[a])?source[a]:[])!==JSON.stringify(read[b]))throw Error('Migration record verification failed: '+key);
      if(key==='bottle-letterbook.json'&&JSON.stringify(source?.held??null)!==JSON.stringify(read.held))throw Error('Migration held verification failed');
    }
    setMeta(db,'migration',JSON.stringify({at:Date.now(),files:files.length,backup}));setMeta(db,'revision','1');db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  // Only verified, backed-up source bytes are removed. Never recursively delete a directory.
  for(const file of files)try{if(digest(readFileSync(file.path))===digest(file.bytes))unlinkSync(file.path);}catch{/* SQL is already authoritative; status exposes retained source files. */}
}
export function withDatabase<T>(dir:string,run:(db:DatabaseSync)=>T):T {
  const key=resolve(dir),existing=active.get(key);if(existing)return run(existing);
  mkdirSync(key,{recursive:true});const path=join(key,LOCAL_DB_NAME),db=sqlite(path);
  try{try{chmodSync(path,0o600);}catch{}migration(db,key);return run(db);}finally{db.close();}
}
export function localTransaction<T>(dir:string,run:(db:DatabaseSync)=>T):T {
  const key=resolve(dir);if(active.has(key))return run(active.get(key)!);
  return withDatabase(key,db=>{
    db.exec('BEGIN IMMEDIATE');active.set(key,db);const before=Number((db.prepare('SELECT total_changes() AS n').get() as Row).n);
    try{const result=run(db);const after=Number((db.prepare('SELECT total_changes() AS n').get() as Row).n);if(after>before)setMeta(db,'revision',String(Number(meta(db,'revision')??0)+1));db.exec('COMMIT');return result;}
    catch(e){db.exec('ROLLBACK');throw e;}finally{active.delete(key);}
  });
}
export function localRevision(dir:string):number{return withDatabase(dir,db=>Number(meta(db,'revision')??0));}
export function readLocalDocument(path:string):any{return withDatabase(dirname(path),db=>readDocumentFrom(db,basename(path)));}
export function writeLocalDocument(path:string,value:unknown):void{localTransaction(dirname(path),db=>writeDocumentTo(db,basename(path),value));}
export function readSetting(dir:string,key:string):any{return withDatabase(dir,db=>doc(db,key));}
export function writeSetting(dir:string,key:string,value:unknown):void{localTransaction(dir,db=>writeDocumentTo(db,key,value));}
export function putAssetTo(db:DatabaseSync,a:LocalAsset):void {
  db.prepare('INSERT INTO local_assets VALUES(?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET name=excluded.name,mime=excluded.mime,sha256=excluded.sha256,metadata=excluded.metadata,bytes=excluded.bytes WHERE sha256<>excluded.sha256 OR metadata<>excluded.metadata OR name<>excluded.name OR mime<>excluded.mime').run(a.kind,a.id,a.name,a.mime,digest(a.bytes),JSON.stringify(a.metadata),a.bytes);
}
export function putAsset(dir:string,a:LocalAsset):void{localTransaction(dir,db=>putAssetTo(db,a));}
export function listAssets(dir:string,kind?:AssetKind):LocalAsset[]{return withDatabase(dir,db=>{
  const rows=(kind?db.prepare('SELECT * FROM local_assets WHERE kind=?').all(kind):db.prepare('SELECT * FROM local_assets').all()) as Row[];
  return rows.map(r=>({kind:r.kind as AssetKind,id:String(r.id),name:String(r.name),mime:String(r.mime),bytes:Buffer.from(r.bytes as Uint8Array),metadata:JSON.parse(String(r.metadata))}));
});}
export function getAsset(dir:string,kind:AssetKind,id:string):LocalAsset|null{return withDatabase(dir,db=>{
  const row=db.prepare('SELECT * FROM local_assets WHERE kind=? AND id=?').get(kind,id) as Row|undefined;
  return row?{kind:row.kind as AssetKind,id:String(row.id),name:String(row.name),mime:String(row.mime),bytes:Buffer.from(row.bytes as Uint8Array),metadata:JSON.parse(String(row.metadata))}:null;
});}
export function saveLocalBackup(dir:string,bytes:Uint8Array,kind:'migration'|'replace'):string {
  const folder=join(dir,'bottle-backups');mkdirSync(folder,{recursive:true});
  const id=kind+'-'+Date.now()+'-'+randomUUID()+'.bottle-backup',file=join(folder,id),temp=file+'.tmp';
  try{writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});renameSync(temp,file);if(digest(readFileSync(file))!==digest(bytes))throw Error('备份校验失败');return id;}
  finally{try{unlinkSync(temp);}catch{}}
}
export const backupId=(id:unknown):id is string=>typeof id==='string'&&/^(migration|replace)-\d+-[a-f0-9-]{36}\.bottle-backup$/.test(id);
export function localBackups(dir:string):Array<{id:string;bytes:number;at:number}>{
  try{return readdirSync(join(dir,'bottle-backups')).filter(backupId).flatMap(id=>{const s=lstatSync(join(dir,'bottle-backups',id));return s.isFile()&&!s.isSymbolicLink()?[{id,bytes:s.size,at:s.mtimeMs}]:[];}).sort((a,b)=>b.at-a.at);}catch{return [];}
}
export function readLocalBackup(dir:string,id:unknown):Buffer{if(!backupId(id)||!localBackups(dir).some(b=>b.id===id))throw Error('找不到这份备份');return readFileSync(join(dir,'bottle-backups',id));}
export function deleteLocalBackup(dir:string,id:unknown):void{readLocalBackup(dir,id);unlinkSync(join(dir,'bottle-backups',id as string));}
export function localStorageStatus(dir:string):{engine:string;revision:number;migration:unknown;retainedSources:string[];backups:ReturnType<typeof localBackups>}{
  return withDatabase(dir,db=>({engine:'SQLite',revision:Number(meta(db,'revision')),migration:JSON.parse(meta(db,'migration')??'null'),retainedSources:LEGACY_DOCUMENTS.filter(name=>existsSync(join(dir,name))),backups:localBackups(dir)}));
}
