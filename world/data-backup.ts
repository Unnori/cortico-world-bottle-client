/** Human-only selective backup and staged restoration. No secrets or action credentials. */
import {randomUUID} from 'node:crypto';
import {encodeBackup,decodeBackup} from './backup-codec.ts';
import {join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync,unlinkSync,existsSync,lstatSync,openSync,readSync,closeSync,readdirSync} from 'node:fs';
import type {DatabaseSync} from 'node:sqlite';
import {parseArchive} from './archive.ts';
import type {LetterbookArchive} from '../shared/contract.ts';
import {isThemePreference} from './appearance.ts';
import {sanitizeSvg,checkStationery} from '../shared/stationery.ts';
import {FONT_TYPES} from './fonts.ts';
import {digest,localRevision,localTransaction,readDocumentFrom,writeDocumentTo,recordRows,replaceRows,listAssets,putAssetTo,readSetting,localStorageStatus,saveLocalBackup,localBackups,readLocalBackup,deleteLocalBackup,withDatabase,LEGACY_DOCUMENTS,validateLegacyDocument,type LocalAsset,type AssetKind} from './local-db.ts';

export const DATA_CATEGORIES=['letters','notes','system','drafts','stars','doodles','fonts','sounds','theme','preferences'] as const;
export type DataCategory=typeof DATA_CATEGORIES[number];
export const DATA_LABELS:Record<DataCategory,string>={letters:'信件与回信',notes:'小纸条',system:'系统来信',drafts:'未寄草稿',stars:'星标',doodles:'自定义涂鸦',fonts:'自定义字体与笔迹',sounds:'自定义音效',theme:'主题与背景',preferences:'阅读与设备偏好'};
export const BACKUP_MAX_BYTES=128*1024*1024, BACKUP_EXPANDED_MAX=256*1024*1024, TRANSFER_CHUNK_BYTES=64*1024;
const TEN_MINUTES=10*60_000;
type Counts={sent:number;received:number;reply:number;system:number;total:number};
interface AssetData {kind:AssetKind;id:string;name:string;mime:string;sha256:string;data:string;metadata:Record<string,unknown>}
export interface BackupDocument {format:'bottle-backup';version:1;createdAt:string;categories:DataCategory[];archive:LetterbookArchive;drafts?:unknown[];settings:Record<string,unknown>;assets:AssetData[]}
interface Transfer {path:string;size:number;offset:number;expires:number;download?:boolean;name?:string}
interface Preview {document:BackupDocument;revision:number;expires:number;done?:unknown}
export interface BackupHooks {busy?():boolean;protectedIds?():string[];beforeRestore?():void;afterRestore?():void;collect?():void}
function categories(value:unknown):DataCategory[]{
  if(!Array.isArray(value)||!value.length||value.some(v=>!DATA_CATEGORIES.includes(v)))throw Error('请至少选择一种要备份的数据。');
  return [...new Set(value)] as DataCategory[];
}
function counts(entries:LetterbookArchive['entries']):Counts {
  const result:Counts={sent:0,received:0,reply:0,system:0,total:0};
  for(const e of entries){if(e.kind==='sent'||e.kind==='reply'){result[e.kind]++;result.total++;}else if(e.kind==='received'){result[e.value.seed===true?'system':'received']++;result.total++;}}
  return result;
}
function allowedEntry(kind:string,value:Record<string,unknown>,selected:DataCategory[]):boolean {
  return kind==='note'?selected.includes('notes'):kind==='star'?selected.includes('stars'):kind==='received'&&value.seed===true?selected.includes('system'):selected.includes('letters');
}
function categoryForAsset(kind:AssetKind):DataCategory{return kind==='font'?'fonts':kind==='background'?'theme':kind==='sound'?'sounds':'doodles';}
function safeSettings(key:string,value:unknown,selected:DataCategory[]):unknown {
  if(key==='bottle-appearance.json'&&selected.includes('theme')){if(!isThemePreference(value))throw Error('主题设置格式不正确。');const {theme,mode,customColor,background,backgroundTransparency,myFont,myFontName}=value;return {theme,mode,...(customColor!==undefined?{customColor}:{}),...(background!==undefined?{background}:{}),...(backgroundTransparency!==undefined?{backgroundTransparency}:{}),...(myFont!==undefined?{myFont}:{}),...(myFontName!==undefined?{myFontName}:{})};}
  if(key==='bottle-host-theme.json'&&selected.includes('theme')){
    const v=value as any;if(!v||typeof v.selectedId!=='string'||v.selectedId.length>128||!['light','dark'].includes(v.appearance)||typeof v.at!=='number'||!Number.isFinite(v.at)||typeof v.observedAt!=='number'||!Number.isFinite(v.observedAt)||!v.palette||typeof v.palette!=='object')throw Error('宿主配色快照不正确。');
    const keys=['paper','sheet','sheet-2','sheet-3','ink','ink-soft','line','line-strong','accent','on-accent','ink-blue','ok','warn','danger'];
    const palette:Record<string,string>={};for(const k of keys)if(Object.hasOwn(v.palette,k)){if(typeof v.palette[k]!=='string'||!/^#[a-f0-9]{6}$/i.test(v.palette[k]))throw Error('快照颜色不正确。');palette[k]=v.palette[k];}
    return {selectedId:v.selectedId,appearance:v.appearance,at:v.at,observedAt:v.observedAt,hostVersion:typeof v.hostVersion==='string'?v.hostVersion.slice(0,64):'unknown',palette};
  }
  if(key==='bottle-font-map.json'&&selected.includes('fonts')){
    const v=value as any;if(v?.version!==1||!v.assignments||typeof v.assignments!=='object'||Array.isArray(v.assignments))throw Error('笔迹字典不正确。');
    const assignments:Record<string,string>={};for(const [id,name] of Object.entries(v.assignments)){if(!/^[a-f0-9]{64}$/.test(id)||typeof name!=='string'||!name||name.length>256||/[\\/]/.test(name))throw Error('笔迹字典不正确。');assignments[id]=name;}return {version:1,assignments};
  }
  if(/^device:[a-z0-9-]{1,64}$/.test(key)&&selected.includes('preferences'))return validateDevice(value);
  throw Error('备份中包含未选择或不支持的设置。');
}
export function validateDevice(value:unknown):Record<string,unknown>{
  const v=value as any;if(!v||typeof v!=='object'||Array.isArray(v))throw Error('设备偏好格式不正确。');
  const out:Record<string,unknown>={};
  if(v.readingSize!==undefined){if(typeof v.readingSize!=='number'||v.readingSize<14||v.readingSize>60)throw Error('阅读字号不正确。');out.readingSize=v.readingSize;}
  if(v.readerDock!==undefined){const p=v.readerDock;if(!p||!['left','right'].includes(p.edge)||typeof p.y!=='number'||!Number.isFinite(p.y)||p.y<0||p.y>1)throw Error('阅读工具位置不正确。');out.readerDock={edge:p.edge,y:p.y};}
  if(v.sound!==undefined){const p=v.sound;if(!p||typeof p!=='object')throw Error('声音偏好不正确。');const sound:Record<string,unknown>={enabled:p.enabled===true};for(const [k,max]of [['volume',100],['fade',5000]] as const){if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<0||p[k]>max)throw Error('声音数值不正确。');sound[k]=p[k];}for(const k of ['incoming','reply']){if(typeof p[k]!=='string'||p[k].length>200||!(/^(off|local)$/.test(p[k])||/^pack:[\p{L}\p{N}_ .\/-]+$/u.test(p[k])))throw Error('声音选择不正确。');sound[k]=p[k];}out.sound=sound;}
  if(v.audio!==undefined){if(!v.audio||typeof v.audio!=='object')throw Error('设备音效引用不正确。');const audio:Record<string,string>={};for(const k of ['incoming','reply'])if(v.audio[k]!==undefined){if(typeof v.audio[k]!=='string'||!/^[a-f0-9]{64}\.(wav|mp3|m4a|ogg|aac|flac)$/.test(v.audio[k]))throw Error('设备音效引用不正确。');audio[k]=v.audio[k];}out.audio=audio;}
  return out;
}
function assetFrom(a:unknown):LocalAsset {
  const v=a as any;if(!v||!['font','background','sound','doodle'].includes(v.kind)||typeof v.id!=='string'||v.id.length>100||/[\\/\x00-\x1f]/.test(v.id)||typeof v.name!=='string'||v.name.length>120||/[\x00-\x1f\x7f]/.test(v.name)||typeof v.data!=='string'||v.data.length>Math.ceil(32*1024*1024/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(v.data))throw Error('自定义素材格式不正确。');
  const bytes=Buffer.from(v.data,'base64');if(bytes.toString('base64')!==v.data||digest(bytes)!==v.sha256||!bytes.length)throw Error('自定义素材摘要校验失败。');
  let mime:string|undefined;const metadata:Record<string,unknown>={};
  if(v.kind==='font'){
    mime=FONT_TYPES[bytes.subarray(0,4).toString('hex')];if(!mime||bytes.length<12||v.id!==digest(bytes)+'.'+({ 'font/ttf':'ttf','font/otf':'otf','font/woff':'woff','font/woff2':'woff2'} as Record<string,string>)[mime])throw Error('字体数据不正确。');
  }else if(v.kind==='background'){
    if(bytes.length>8*1024*1024)throw Error('背景图片过大。');
    const ext=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&bytes.length>=24?'png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpg':bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
    if(!ext||v.id!==digest(bytes)+'.'+ext)throw Error('背景图片数据不正确。');mime=ext==='jpg'?'image/jpeg':'image/'+ext;
  }else if(v.kind==='sound'){
    const ext=/\.(wav|mp3|m4a|ogg|aac|flac)$/.exec(v.id)?.[1];
    if(!ext||v.id!==digest(bytes)+'.'+ext||bytes.length>10*1024*1024)throw Error('音效数据不正确。');
    mime=({wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',aac:'audio/aac',flac:'audio/flac'} as Record<string,string>)[ext];
    if(v.metadata?.device&&/^[a-z0-9-]{1,64}$/.test(v.metadata.device))metadata.device=v.metadata.device;
    if(['incoming','reply','shared'].includes(v.metadata?.slot))metadata.slot=v.metadata.slot;
  }else{
    if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(v.id)||bytes.length>32768)throw Error('涂鸦数据不正确。');const checked=sanitizeSvg(bytes.toString('utf8'));if(!checked.ok)throw Error('涂鸦包含不支持的内容。');mime='image/svg+xml';
    metadata.tags=Array.isArray(v.metadata?.tags)?v.metadata.tags.filter((t:unknown)=>typeof t==='string'&&t.length<=16).slice(0,6):[];
  }
  return {kind:v.kind,id:v.id,name:v.name,mime,bytes,metadata};
}
function encodeAsset(a:LocalAsset):AssetData{return {kind:a.kind,id:a.id,name:a.name,mime:a.mime,sha256:digest(a.bytes),metadata:a.metadata,data:a.bytes.toString('base64')};}
function portableArt(value:any,doodles:Map<string,string>):any{
  const stationery=(art:any):any=>{
    if(!art)return art;let changed=false;
    const drawing=(d:any)=>{const svg=d?.doodle?doodles.get(d.doodle):undefined;if(!svg)return d;changed=true;const {doodle,...rest}=d;return {...rest,customSvg:svg};};
    const next=art.v===2?{...art,decorations:art.decorations?.map(drawing)}:drawing(art);
    if(!changed)return art;const checked=checkStationery(next);if(!checked.ok)throw Error('自定义装饰无法完整备份，请先检查图案大小。');return checked.value;
  };
  return {...value,...(value.stationery?{stationery:stationery(value.stationery)}:{}),...(value.myReplyStationery?{myReplyStationery:stationery(value.myReplyStationery)}:{}),...(value.unsentReplies?{unsentReplies:value.unsentReplies.map((r:any)=>portableArt(r,doodles))}:{})};
}
function stripDraft(value:unknown):any {
  const v=value as any;if(!v||!['letter','reply'].includes(v.kind)||typeof v.body!=='string'||!v.body||v.body.length>65536||typeof v.at!=='number'||!Number.isFinite(v.at)||v.at<0)throw Error('草稿记录不完整。');
  const result:any={kind:v.kind,body:v.body,at:v.at,sendPolicy:'manual'};
  if(v.kind==='reply'){if(typeof v.letterId!=='string'||!v.letterId||v.letterId.length>256)throw Error('回信草稿目标不正确。');result.letterId=v.letterId;result.sendFailure='expired';}
  if(v.topic!==undefined){if(typeof v.topic!=='string'||v.topic.length>256)throw Error('草稿信题不正确。');result.topic=v.topic;}
  // Reuse archive validation for decoration without restoring action credentials.
  if(v.stationery!==undefined){const temp=parseArchive({schemaVersion:2,exportedAt:new Date().toISOString(),entries:[{kind:'sent',value:{letterId:'draft-check',body:v.body,at:v.at,stationery:v.stationery}}]});result.stationery=temp.entries[0].value.stationery;}
  return result;
}
/** Keep the original as history, without restoring remote ownership or reading intent. */
function heldHistory(held:any):Record<string,unknown>{
  const {letterId,body,receivedAt,signature,topic,stationery,seed}=held;
  return {letterId,body,from:typeof held.from==='string'?held.from:'一位陌生人',at:held.caughtAt??0,outcome:'caught',
    ...(receivedAt?{receivedAt}:{}),...(signature?{signature}:{}),...(topic?{topic}:{}),...(stationery?{stationery}:{}),...(seed?{seed}:{})};
}
export function captureBackup(dir:string,selected:DataCategory[]=Array.from(DATA_CATEGORIES)):BackupDocument{
  selected=categories(selected);
  const state=localTransaction(dir,db=>{
    const doodles=new Map<string,string>((db.prepare("SELECT id,bytes FROM local_assets WHERE kind='doodle'").all() as any[]).map(a=>[a.id,Buffer.from(a.bytes).toString('utf8')]));
    const entries:LetterbookArchive['entries']=[];
    for(const kind of ['sent','received','reply','star','note'] as const)for(const value of recordRows(db,kind))if(allowedEntry(kind,value,selected)){
      if(kind==='star')entries.push({kind,value:{letterId:value.letterId,starredAt:value.starredAt}});
      else if(kind==='note'){const {imported:_,...paper}=value;entries.push({kind,value:paper});}
      else entries.push({kind,value:portableArt(value,doodles)});
    }
    const held=readDocumentFrom(db,'bottle-letterbook.json').held;
    if(held&&!entries.some(e=>e.kind==='received'&&e.value.letterId===held.letterId)&&allowedEntry('received',held,selected)){
      entries.push({kind:'received',value:portableArt(heldHistory(held),doodles)});
    }
    const settings:Record<string,unknown>={};for(const key of ['bottle-appearance.json','bottle-host-theme.json','bottle-font-map.json']){const value=readDocumentFrom(db,key);if(value!==null&&((key.includes('font')&&selected.includes('fonts'))||(!key.includes('font')&&selected.includes('theme'))))settings[key]=safeSettings(key,value,selected);}
    if(selected.includes('preferences'))for(const row of db.prepare("SELECT key,json FROM local_documents WHERE key LIKE 'device:%'").all() as any[])settings[row.key]=validateDevice(JSON.parse(row.json));
    const slots=readDocumentFrom(db,'bottle-draft.json');
    return {entries,settings,drafts:selected.includes('drafts')?[slots.letterDraft,slots.draft].filter(Boolean).map(d=>stripDraft(portableArt(d,doodles))):undefined};
  });
  return {format:'bottle-backup',version:1,createdAt:new Date().toISOString(),categories:selected,archive:{schemaVersion:2,exportedAt:new Date().toISOString(),entries:state.entries},drafts:state.drafts,settings:state.settings,assets:listAssets(dir).filter(a=>selected.includes(categoryForAsset(a.kind))).map(encodeAsset)};
}
function legacySource(raw:any):BackupDocument{
  if(raw.version!==1||!Array.isArray(raw.files)||raw.files.length>20000)throw Error('迁移备份格式不正确。');
  const document:BackupDocument={format:'bottle-backup',version:1,createdAt:new Date().toISOString(),categories:Array.from(DATA_CATEGORIES),archive:{schemaVersion:2,exportedAt:new Date().toISOString(),entries:[]},settings:{},assets:[],drafts:[]};
  const paths=new Set<string>();
  for(const f of raw.files){if(!f||typeof f.path!=='string'||paths.has(f.path)||typeof f.data!=='string'||digest(Buffer.from(f.data,'base64'))!==f.sha256)throw Error('迁移备份校验失败。');paths.add(f.path);
    const bytes=Buffer.from(f.data,'base64');
    const source=LEGACY_DOCUMENTS.includes(f.path)?JSON.parse(bytes.toString()):undefined;
    if(source!==undefined)validateLegacyDocument(f.path,source);
    if(f.path==='bottle-letterbook.json'){
      const book=source;for(const [field,kind]of [['sent','sent'],['received','received'],['replies','reply']] as const)for(const value of book[field]??[])document.archive.entries.push({kind,value});
      if(book.held&&!document.archive.entries.some(e=>e.kind==='received'&&e.value.letterId===book.held.letterId))document.archive.entries.push({kind:'received',value:heldHistory(book.held)});
    }
    else if(f.path==='bottle-notes.json')for(const value of JSON.parse(bytes.toString()).notes??[])document.archive.entries.push({kind:'note',value});
    else if(f.path==='bottle-stars.json')for(const value of JSON.parse(bytes.toString()).stars??[])document.archive.entries.push({kind:'star',value:{letterId:value.letterId,starredAt:value.starredAt}});
    else if(f.path==='bottle-draft.json'){const d=source,wrapped=d&&('draft' in d||'letterDraft' in d);document.drafts=wrapped?[d.draft,d.letterDraft].filter(Boolean):d?[d]:[];}
    else if(['bottle-appearance.json','bottle-host-theme.json','bottle-font-map.json'].includes(f.path))document.settings[f.path]=JSON.parse(bytes.toString());
    else if(/^bottle-(my-fonts|backgrounds)\/[a-f0-9]{64}\.(ttf|otf|woff2?|png|jpg|webp)$/.test(f.path))document.assets.push({kind:f.path.startsWith('bottle-my-fonts')?'font':'background',id:f.path.split('/')[1],name:f.path.split('/')[1],mime:'',data:f.data,sha256:f.sha256,metadata:{}});
    else if(!['bottle-id.json','bottle-state.json','bottle-wake.json','bottle-font-catalog.json'].includes(f.path))throw Error('迁移备份包含未知路径。');
  }
  return document;
}
export function parseBackup(raw:unknown):BackupDocument {
  let v=raw as any;
  if(v?.format==='bottle-legacy-source')v=legacySource(v);
  if(v?.schemaVersion===1||v?.schemaVersion===2){const archive=parseArchive(v);return {format:'bottle-backup',version:1,createdAt:archive.exportedAt,categories:['letters','system','notes','stars'],archive,settings:{},assets:[]};}
  if(v?.format!=='bottle-backup'||v.version!==1||typeof v.createdAt!=='string'||!Number.isFinite(Date.parse(v.createdAt)))throw Error('这不是支持的漂流瓶备份文件。');
  const selected=categories(v.categories),archive=parseArchive(v.archive);
  if(archive.entries.some(e=>!allowedEntry(e.kind,e.value,selected)))throw Error('备份条目与所选类别不一致。');
  if(!v.settings||typeof v.settings!=='object'||Array.isArray(v.settings)||!Array.isArray(v.assets)||v.assets.length>2000)throw Error('备份素材清单不完整。');
  const settings:Record<string,unknown>={};for(const [key,value] of Object.entries(v.settings))settings[key]=safeSettings(key,value,selected);
  const seen=new Set<string>();let assetBytes=0;
  const assets:AssetData[]=v.assets.map((raw:unknown)=>{const asset=assetFrom(raw),key=asset.kind+':'+asset.id;if(!selected.includes(categoryForAsset(asset.kind))||seen.has(key))throw Error('备份素材重复或类别不一致。');seen.add(key);assetBytes+=asset.bytes.length;if(assetBytes>BACKUP_EXPANDED_MAX/2)throw Error('备份素材总量过大。');return encodeAsset(asset);});
  const doodles=new Map<string,string>(assets.filter(a=>a.kind==='doodle').map(a=>[a.id,Buffer.from(a.data,'base64').toString('utf8')]));
  for(const entry of archive.entries)if(['sent','received','reply'].includes(entry.kind))entry.value=portableArt(entry.value,doodles);
  if(v.drafts!==undefined&&(!selected.includes('drafts')||!Array.isArray(v.drafts)||v.drafts.length>2))throw Error('草稿清单不正确。');
  const drafts=v.drafts?.map((draft:unknown)=>stripDraft(portableArt(draft,doodles)));if(drafts&&new Set(drafts.map((d:any)=>d.kind)).size!==drafts.length)throw Error('草稿槽重复。');
  const ids=new Set<string>();for(const e of archive.entries){const key=e.kind+':'+(e.kind==='note'?e.value.id:e.value.letterId);if(ids.has(key))throw Error('备份中有重复记录。');ids.add(key);}
  return {format:'bottle-backup',version:1,createdAt:v.createdAt,categories:selected,archive,drafts,settings,assets};
}
async function unpack(bytes:Buffer):Promise<BackupDocument>{
  if(bytes.length>BACKUP_MAX_BYTES)throw Error('备份不能超过 128 MiB。');
  let raw:unknown;try{raw=await decodeBackup(bytes,BACKUP_EXPANDED_MAX);}catch{throw Error('这份备份无法读取，可能已损坏或超过大小限制；原有数据没有改动。');}
  return parseBackup(raw);
}

export class DataBackupManager {
  private epoch=0;
  private transfers=new Map<string,Transfer>();private previews=new Map<string,Preview>();
  constructor(private readonly dir:string,private readonly hooks:BackupHooks={},private readonly now=Date.now){
    // A crashed process cannot keep staged bodies forever. Only remove our exact stale filenames.
    const folder=join(dir,'bottle-transfers');try{for(const name of readdirSync(folder))if(/^[a-f0-9-]{36}\.(upload|download)$/.test(name)){const path=join(folder,name),stat=lstatSync(path);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.mtimeMs<this.now()-86400000)try{unlinkSync(path);}catch{}}}catch{}
  }
  private prune():void{for(const [id,t]of this.transfers)if(t.expires<this.now()){try{unlinkSync(t.path);}catch{}this.transfers.delete(id);}for(const [id,p]of this.previews)if(p.expires<this.now())this.previews.delete(id);}
  cleanup():void{this.prune();}
  dispose():void{this.epoch++;for(const t of this.transfers.values())try{unlinkSync(t.path);}catch{}this.transfers.clear();this.previews.clear();}
  status():unknown {this.prune();return {...localStorageStatus(this.dir),...withDatabase(this.dir,db=>{
    const count=(bucket:string,extra='')=>Number((db.prepare('SELECT COUNT(*) AS n FROM local_records WHERE bucket=? '+extra).get(bucket) as any).n);
    const sent=count('sent'),reply=count('reply'),received=count('received',"AND COALESCE(json_extract(json,'$.seed'),0)<>1"),system=count('received',"AND json_extract(json,'$.seed')=1");
    return {counts:{sent,reply,received,system,total:sent+reply+received+system},devices:(db.prepare("SELECT key FROM local_documents WHERE key LIKE 'device:%'").all() as any[]).map(r=>r.key.slice(7)),sounds:(db.prepare("SELECT id,name FROM local_assets WHERE kind='sound'").all() as any[]).map(r=>({id:r.id,name:r.name}))};
  }),categories:DATA_CATEGORIES.map(id=>({id,label:DATA_LABELS[id]}))};}
  private downloadable(bytes:Buffer,name:string):{id:string;size:number;name:string;chunkBytes:number}{
    this.prune();if(this.transfers.size>=4)throw Error('同时处理的备份过多，请先完成或取消上一份。');
    const id=randomUUID(),folder=join(this.dir,'bottle-transfers');mkdirSync(folder,{recursive:true});const path=join(folder,id+'.download');writeFileSync(path,bytes,{mode:0o600,flag:'wx'});this.transfers.set(id,{path,size:bytes.length,offset:0,expires:this.now()+TEN_MINUTES,download:true,name});return {id,size:bytes.length,name,chunkBytes:TRANSFER_CHUNK_BYTES};
  }
  async export(selected:unknown):Promise<unknown>{this.prune();const epoch=this.epoch;this.hooks.collect?.();const document=captureBackup(this.dir,categories(selected));const bytes=await encodeBackup(document,BACKUP_EXPANDED_MAX);if(epoch!==this.epoch)throw Error('扩展已停止，本次导出已取消。');if(bytes.length>BACKUP_MAX_BYTES)throw Error('备份超过 128 MiB，请分开选择类别导出。');return this.downloadable(bytes,'漂流瓶备份-明文请勿转发-'+new Date().toISOString().slice(0,10)+'.bottle-backup');}
  download(input:any):unknown {this.prune();const t=this.transfers.get(input?.id);if(!t?.download||!Number.isSafeInteger(input.offset)||input.offset<0||input.offset>t.size)throw Error('下载已过期，请重新导出。');t.expires=this.now()+TEN_MINUTES;const bytes=Buffer.alloc(Math.min(TRANSFER_CHUNK_BYTES,t.size-input.offset)),fd=openSync(t.path,'r');try{const count=readSync(fd,bytes,0,bytes.length,input.offset);return {data:bytes.subarray(0,count).toString('base64'),size:t.size};}finally{closeSync(fd);}}
  begin(input:any):unknown {this.prune();if(this.transfers.size>=4)throw Error('同时处理的备份过多，请先完成或取消上一份。');if(!Number.isSafeInteger(input?.size)||input.size<=0||input.size>BACKUP_MAX_BYTES)throw Error('请选择不超过 128 MiB 的备份。');const id=randomUUID(),folder=join(this.dir,'bottle-transfers');mkdirSync(folder,{recursive:true});const path=join(folder,id+'.upload');writeFileSync(path,'',{mode:0o600,flag:'wx'});this.transfers.set(id,{path,size:input.size,offset:0,expires:this.now()+TEN_MINUTES});return {id,chunkBytes:TRANSFER_CHUNK_BYTES};}
  chunk(input:any):unknown {this.prune();const t=this.transfers.get(input?.id);if(!t||t.download||input.offset!==t.offset||typeof input.data!=='string'||input.data.length>Math.ceil(TRANSFER_CHUNK_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data))throw Error('备份分块顺序或大小不正确，请重新选择文件。');const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.toString('base64')!==input.data||bytes.length>TRANSFER_CHUNK_BYTES||t.offset+bytes.length>t.size)throw Error('备份分块校验失败。');appendFileSync(t.path,bytes);t.offset+=bytes.length;t.expires=this.now()+TEN_MINUTES;return {offset:t.offset};}
  cancel(input:any):unknown {const t=this.transfers.get(input?.id);if(t){try{unlinkSync(t.path);}catch{}this.transfers.delete(input.id);}this.previews.delete(input?.id);return {ok:true};}
  async preview(input:any):Promise<unknown>{this.prune();const t=this.transfers.get(input?.id);if(!t||t.download||t.offset!==t.size)throw Error('备份还没有传完整。');
    if(this.previews.size>=2)throw Error('请先完成或取消之前的导入比较。');
    const epoch=this.epoch;let document:BackupDocument;try{document=await unpack(readFileSync(t.path));}finally{this.cancel(input);}if(epoch!==this.epoch)throw Error('扩展已停止，本次比较已取消。');
    const id=randomUUID(),revision=localRevision(this.dir);this.previews.set(id,{document,revision,expires:this.now()+TEN_MINUTES});
    return {id,revision,current:(this.status() as any).counts,incoming:counts(document.archive.entries),categories:document.categories.map(key=>({id:key,label:DATA_LABELS[key]})),message:'只比较信件数量，尚未改动本机数据。恢复的草稿不会自动寄出，纸条不会补播或补寄。'};
  }
  async confirm(input:any):Promise<unknown>{
    this.prune();const preview=this.previews.get(input?.id);if(!preview)throw Error('比较已过期，请重新选择备份。');if(preview.done)return preview.done;
    if(!['merge','replace'].includes(input.mode)||typeof input.backup!=='boolean')throw Error('请选择合并或替换，并确认是否先备份。');
    if(this.hooks.busy?.())throw Error('有信件正在处理，请稍后重新比较再导入。');
    if(localRevision(this.dir)!==preview.revision)throw Error('本机数据刚刚有变化，请重新比较，尚未覆盖。');
    const document=preview.document,selected=document.categories;
    const slots=readSetting(this.dir,'letterDraft')||readSetting(this.dir,'replyDraft');
    if(input.mode==='replace'&&selected.includes('drafts')&&slots)throw Error('本机仍有待处理草稿，请先处理原稿，或使用合并保留本机草稿。');
    const epoch=this.epoch;let backup:string|undefined;
    if(input.mode==='replace'&&input.backup){const bytes=await encodeBackup(captureBackup(this.dir,selected),BACKUP_EXPANDED_MAX);if(epoch!==this.epoch)throw Error('扩展已停止，没有替换数据。');backup=saveLocalBackup(this.dir,bytes,'replace');}
    if(this.hooks.busy?.()||localRevision(this.dir)!==preview.revision)throw Error('本机数据刚刚有变化，请重新比较。已生成的备份仍可下载。');
    this.hooks.beforeRestore?.();
    localTransaction(this.dir,db=>applyDocument(db,document,input.mode,this.hooks.protectedIds?.()??[]));
    preview.done={ok:true,message:input.mode==='replace'?'已替换所选类别；正在处理的信件和寄送记录已保留。':'已合并备份，本机已有记录优先。',backup};
    this.hooks.afterRestore?.();return preview.done;
  }
  backup(input:any):unknown{return this.downloadable(readLocalBackup(this.dir,input?.id),input.id);}
  removeBackup(input:any):unknown{deleteLocalBackup(this.dir,input?.id);return {ok:true};}
  collectDevice(input:any):unknown{
    if(typeof input?.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(input.id)||!Array.isArray(input.assets)||input.assets.length>2)throw Error('本设备素材格式不正确。');
    const preferences=validateDevice(input.preferences),audio:Record<string,string>={},assets:LocalAsset[]=input.assets.map((raw:any)=>{
      if(!raw||!['incoming','reply'].includes(raw.slot)||typeof raw.name!=='string'||typeof raw.data!=='string'||raw.data.length>Math.ceil(10*1024*1024/3)*4)throw Error('设备音效格式不正确。');
      const ext=/\.(wav|mp3|m4a|ogg|aac|flac)$/i.exec(raw.name)?.[1].toLowerCase()??({ 'audio/wav':'wav','audio/mpeg':'mp3','audio/mp4':'m4a','audio/ogg':'ogg','audio/aac':'aac','audio/flac':'flac'} as Record<string,string>)[raw.type];if(!ext)throw Error('请选择 WAV、MP3、M4A、OGG、AAC 或 FLAC 音效。');
      const bytes=Buffer.from(raw.data,'base64'),id=digest(bytes)+'.'+ext;audio[raw.slot]=id;return assetFrom({kind:'sound',id,name:raw.name.slice(0,120),data:raw.data,sha256:digest(bytes),metadata:{}});
    });
    preferences.audio=audio;
    if(assets.some(a=>a.kind!=='sound'))throw Error('此入口只接收本设备的自选音效。');
    localTransaction(this.dir,db=>{writeDocumentTo(db,'device:'+input.id,preferences);for(const a of assets){a.metadata={...a.metadata,device:input.id};putAssetTo(db,a);}});return {ok:true,message:'本设备的阅读偏好和自选音效已收进本机备份库。'};
  }
  device(input:any):unknown{if(typeof input?.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(input.id))throw Error('设备编号不正确。');const preferences=readSetting(this.dir,'device:'+input.id),audio=preferences?.audio??{};return {preferences,assets:listAssets(this.dir,'sound').filter(a=>Object.values(audio).includes(a.id)).map(a=>encodeAsset({...a,metadata:{...a.metadata,slots:Object.keys(audio).filter(k=>audio[k]===a.id)}}))};}
  async invoke(method:string,input:unknown):Promise<unknown>{
    if(method==='status')return this.status();if(method==='export')return this.export(input);if(method==='download')return this.download(input);if(method==='begin')return this.begin(input);if(method==='chunk')return this.chunk(input);if(method==='preview')return this.preview(input);if(method==='confirm')return this.confirm(input);if(method==='cancel')return this.cancel(input);if(method==='backup')return this.backup(input);if(method==='removeBackup')return this.removeBackup(input);if(method==='collectDevice')return this.collectDevice(input);if(method==='device')return this.device(input);throw Error('Unknown data action');
  }
}
function applyDocument(db:DatabaseSync,document:BackupDocument,mode:'merge'|'replace',extraProtected:string[]=[]):void{
  const selected=document.categories,held=readDocumentFrom(db,'bottle-letterbook.json').held,slots=readDocumentFrom(db,'bottle-draft.json');
  const protectedIds=new Set<string>(extraProtected);if(held?.letterId)protectedIds.add(held.letterId);if(slots.draft?.letterId)protectedIds.add(slots.draft.letterId);
  const oldNotes=recordRows(db,'note');for(const n of oldNotes)if(n.direction==='sent'&&n.delivery==='pending')protectedIds.add(n.letterId);
  const forgotten=new Set(recordRows(db,'forgotten').map(n=>n.id));
  for(const bucket of ['sent','received','reply','star','note']){
    const existing=recordRows(db,bucket),idKey=bucket==='note'?'id':'letterId',incoming=document.archive.entries.filter(e=>e.kind===bucket).map(e=>e.value);
    const retained=mode==='merge'?existing:existing.filter(value=>!allowedEntry(bucket,value,selected)||protectedIds.has(value.letterId)||(bucket==='note'&&value.delivery==='pending'));
    const rows=[...retained];for(const value of incoming){const existing=rows.find(row=>row[idKey]===value[idKey]);
      if(existing){if(bucket==='received'&&Array.isArray(value.unsentReplies)){const extra=value.unsentReplies.filter((draft:any)=>!existing.unsentReplies?.some((prior:any)=>prior.draftId===draft.draftId));if(extra.length)existing.unsentReplies=[...(existing.unsentReplies??[]),...extra];}continue;}
      if(bucket==='note'&&mode==='merge'&&forgotten.has(value.id))continue;
      const next:any={...value};if(bucket==='star')next.memorySelected=false;
      if(bucket==='note'){next.imported=true;if(next.direction==='sent'&&next.delivery!=='sent')next.delivery='unconfirmed';}
      rows.push(next);
    }
    replaceRows(db,bucket,rows,idKey);
  }
  if(mode==='replace'&&selected.includes('notes')){const ids=new Set(document.archive.entries.filter(e=>e.kind==='note').map(e=>e.value.id));replaceRows(db,'forgotten',recordRows(db,'forgotten').filter(n=>!ids.has(n.id)),'id');}
  if(selected.includes('drafts'))for(const d of document.drafts??[]){const value=stripDraft(d),key=value.kind==='letter'?'letterDraft':'replyDraft';if(readSettingRaw(db,key))continue;value.draftId=randomUUID();value.revision=1;
    if(value.kind==='reply'){
      // Restored replies never reclaim a remote window. Keep expressions under their original letter.
      const received=recordRows(db,'received'),record=received.find(r=>r.letterId===value.letterId);
      if(record){record.unsentReplies??=[];record.unsentReplies.push({draftId:value.draftId,body:value.body,at:value.at,...(value.stationery?{stationery:value.stationery}:{})});replaceRows(db,'received',received);}
      else{writeDocumentTo(db,'bottle-draft.json',{...readDocumentFrom(db,'bottle-draft.json'),draft:value});}
    }else writeDocumentTo(db,'bottle-draft.json',{...readDocumentFrom(db,'bottle-draft.json'),letterDraft:value});
  }
  if(mode==='replace'){
    if(selected.includes('preferences'))db.exec("DELETE FROM local_documents WHERE key LIKE 'device:%'");
    if(selected.includes('theme')){db.prepare('DELETE FROM local_documents WHERE key IN (?,?)').run('bottle-appearance.json','bottle-host-theme.json');}
    if(selected.includes('fonts'))db.prepare('DELETE FROM local_documents WHERE key=?').run('bottle-font-map.json');
  }
  for(const [key,value]of Object.entries(document.settings)){const current=readDocumentFrom(db,key);if(mode==='replace'||current===null)writeDocumentTo(db,key,value);}
  // Replacing a library must not break retained letters or a theme from an unselected category.
  const used:Record<AssetKind,Set<string>>={font:new Set(),background:new Set(),sound:new Set(),doodle:new Set()};
  const appearance=readDocumentFrom(db,'bottle-appearance.json');if(appearance?.myFont)used.font.add(appearance.myFont);if(appearance?.background)used.background.add(appearance.background);
  const scan=(value:any):void=>{if(!value||typeof value!=='object')return;if(typeof value.doodle==='string')used.doodle.add(value.doodle);for(const [key,child]of Object.entries(value))if(['stationery','myReplyStationery','decorations','unsentReplies'].includes(key)){if(Array.isArray(child))for(const row of child)scan(row);else scan(child);}};
  for(const bucket of ['sent','received','reply'])for(const row of recordRows(db,bucket))scan(row);scan(held);scan(slots.draft);scan(slots.letterDraft);
  for(const row of db.prepare("SELECT json FROM local_documents WHERE key LIKE 'device:%'").all() as any[])for(const id of Object.values(JSON.parse(row.json).audio??{}))if(typeof id==='string')used.sound.add(id);
  if(mode==='replace')for(const category of ['fonts','sounds','theme','doodles'] as const)if(selected.includes(category)){
    const kind:AssetKind=category==='fonts'?'font':category==='sounds'?'sound':category==='theme'?'background':'doodle';
    const rows=db.prepare('SELECT id FROM local_assets WHERE kind=?').all(kind) as any[];for(const row of rows)if(!used[kind].has(row.id))db.prepare('DELETE FROM local_assets WHERE kind=? AND id=?').run(kind,row.id);
  }
  for(const raw of document.assets){const a=assetFrom(raw),exists=db.prepare('SELECT 1 FROM local_assets WHERE kind=? AND id=?').get(a.kind,a.id);if(!exists||mode==='replace'&&!used[a.kind].has(a.id))putAssetTo(db,a);}
}
function readSettingRaw(db:DatabaseSync,key:string):unknown {const row=db.prepare('SELECT json FROM local_documents WHERE key=?').get(key) as any;return row?JSON.parse(row.json):null;}
