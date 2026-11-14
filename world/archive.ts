import { readingCount, type LocalStore, type SentLetter, type ReceivedLetter, type LocalReply } from './store.ts';
import type { LetterStars } from './stars.ts';
import type { LetterbookArchive } from '../shared/contract.ts';
import { checkStationery } from '../shared/stationery.ts';
import { NOTE_TTL_MS } from '../shared/contract.ts';
import { checkNote, checkBody } from '../shared/text.ts';
import type { NoteCache, LocalNote } from './note-cache.ts';
export const ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;
const kinds = ['sent','received','reply','star','note'];
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8.64e15;
const text = (v: unknown, max = 65536): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => text(v,256) && v.length > 0;
/** This download is the only extra copy: user owns/deletes it. No server/cloud upload. */
export function exportArchive(store: LocalStore, stars: LetterStars, notes?:NoteCache): LetterbookArchive {
  const entries: LetterbookArchive['entries'] = [];
  for (const kind of ['sent','received','reply'] as const) {
    const rows = kind === 'sent' ? store.sent : kind === 'received' ? store.received : store.replies;
    for (const row of rows) entries.push({ kind, value: { ...row } });
  }
  for (const star of stars.all()) entries.push({ kind:'star', value:{letterId:star.letterId,starredAt:star.starredAt} });
  for(const note of notes?.all()??[])entries.push({kind:'note',value:{...note}});
  return { schemaVersion:2, exportedAt:new Date().toISOString(), entries };
}
/** Validate the ENTIRE file before touching any local data; only allow known fields. */
export function parseArchive(raw: unknown): LetterbookArchive {
  if (!raw || typeof raw !== 'object') throw Error('这不是有效的信册文件。');
  const doc = raw as Partial<LetterbookArchive>;
  if (doc.schemaVersion !== 1 && doc.schemaVersion !== 2) throw Error('这份信册的格式版本暂不支持，原有信件没有改动。');
  if (!text(doc.exportedAt,64) || !Number.isFinite(Date.parse(doc.exportedAt)) || !Array.isArray(doc.entries) || doc.entries.length > 20000)
    throw Error('信册格式不完整或文件过大。');
  const entries: LetterbookArchive['entries'] = [];
  for (const entry of doc.entries) {
    if (!entry || !kinds.includes(entry.kind) || !entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) throw Error('信册中有损坏的条目。');
    const r = entry.value, value: Record<string,unknown> = {};
    if (!id(r.letterId)) throw Error('信件编号不完整。');
    value.letterId = r.letterId;
    if(entry.kind==='note'){
      const at=typeof r.at==='string'?Date.parse(r.at):NaN,expires=typeof r.expiresAt==='string'?Date.parse(r.expiresAt):NaN;
      if(doc.schemaVersion!==2 || !id(r.id)||!text(r.from,256)||!checkNote(r.body).ok||!Number.isFinite(at)||!Number.isFinite(expires)||expires<=at||expires>at+NOTE_TTL_MS ||
        r.direction!==undefined&&r.direction!=='sent'||r.delivery!==undefined&&!['pending','sent','unconfirmed'].includes(String(r.delivery)) ||
        r.direction==='sent'&&(r.id!=='sent:'+r.letterId||r.delivery===undefined)||r.direction===undefined&&(r.delivery!==undefined||String(r.id).startsWith('sent:')))
        throw Error('小纸条记录不完整或格式不正确。');
      Object.assign(value,{id:r.id,from:r.from,body:r.body,at:r.at,expiresAt:r.expiresAt});
      if(r.direction==='sent')Object.assign(value,{direction:'sent',delivery:r.delivery});
      if(r.readAt!==undefined){if(!time(r.readAt))throw Error('纸条已读时间不正确。');value.readAt=r.readAt;}
    } else if (entry.kind === 'star') {
      if (!time(r.starredAt)) throw Error('星标时间不完整。'); value.starredAt = r.starredAt;
    } else {
      if (!text(r.body) || !time(r.at)) throw Error('信件正文或时间不完整。');
      value.body = r.body; value.at = r.at;
      if (entry.kind !== 'sent') {
        if (!text(r.from,256)) throw Error('信件署名不完整。'); value.from = r.from;
        value.readCount = readingCount(r.readCount);
        if (r.lastReadAt !== undefined) { if (!time(r.lastReadAt)) throw Error('共读时间不正确。'); value.lastReadAt = r.lastReadAt; }
      }
      if (entry.kind === 'received') {
        if(r.unsentReplies!==undefined){
          if(doc.schemaVersion!==2||!Array.isArray(r.unsentReplies)||r.unsentReplies.length>20000)throw Error('未寄出回信格式不正确。');
          const seen=new Set<string>();
          value.unsentReplies=r.unsentReplies.map((raw:unknown)=>{
            if(!raw||typeof raw!=='object')throw Error('未寄出回信不完整。');
            const saved=raw as Record<string,unknown>;
            if(typeof saved.draftId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(saved.draftId)||!checkBody(saved.body).ok||!time(saved.at)||seen.has(saved.draftId))throw Error('未寄出回信不完整或重复。');
            seen.add(saved.draftId);const note:Record<string,unknown>={draftId:saved.draftId,body:saved.body,at:saved.at};
            if(saved.stationery!==undefined){const decor=checkStationery(saved.stationery);if(!decor.ok)throw Error('未寄出回信装饰格式不正确。');if(decor.value)note.stationery=decor.value;}
            return note;
          });
        }
        if (!['caught','replied','dismissed','sank','expired','kept'].includes(String(r.outcome))) throw Error('来信状态不正确。');
        value.outcome = r.outcome;
        for (const k of ['myReply','signature']) if (r[k] !== undefined) { if (!text(r[k])) throw Error('信件条目不完整。'); value[k] = r[k]; }
        if (r.seed === true) value.seed = true;
        if (r.lastCaughtAt !== undefined) { if (!time(r.lastCaughtAt)) throw Error('打捞时间不正确。'); value.lastCaughtAt = r.lastCaughtAt; }
        if (r.myReplyStationery !== undefined) {
          const decor = checkStationery(r.myReplyStationery);
          if (!decor.ok) throw Error('回信装饰格式不正确。');
          if (decor.value) value.myReplyStationery = decor.value;
        }
      }
      if (entry.kind !== 'reply' && r.topic !== undefined) { if (!text(r.topic,256)) throw Error('信题不正确。'); value.topic = r.topic; }
      if (entry.kind === 'sent' && r.pickedNoticed === true) value.pickedNoticed = true;
      if (r.stationery !== undefined) {
        const decor = checkStationery(r.stationery);
        if (!decor.ok) throw Error('信纸装饰格式不正确。');
        if (decor.value) value.stationery = decor.value;
      }
    }
    entries.push({kind:entry.kind,value});
  }
  return {schemaVersion:1,exportedAt:doc.exportedAt,entries};
}
export function importArchive(store: LocalStore, stars: LetterStars, raw: unknown, notes?:NoteCache): number {
  const doc = parseArchive(raw);
  if(doc.entries.some(e=>e.kind==='note')&&!notes)throw Error('此入口不支持恢复纸条，请更新客户端后重试。');
  const sent = [...store.sent], received = [...store.received], replies = [...store.replies];
  const rows = {sent,received,reply:replies}; let added=0;
  const newStars: Array<{id:string;at:number}> = [];
  const papers:LocalNote[]=[];
  for (const e of doc.entries) {
    const id = e.value.letterId as string;
    if(e.kind==='note'){papers.push(e.value as unknown as LocalNote);continue;}
    if (e.kind === 'star') { if (!stars.get(id) && !newStars.some(n=>n.id===id)) newStars.push({id,at:e.value.starredAt as number}); continue; }
    const target=rows[e.kind],existing=target.find(r=>r.letterId===id);
    if(existing){
      if(e.kind==='received'&&Array.isArray(e.value.unsentReplies)){
        const record=existing as ReceivedLetter;
        const saved=(e.value.unsentReplies as NonNullable<ReceivedLetter['unsentReplies']>).filter(r=>!record.unsentReplies?.some(old=>old.draftId===r.draftId));
        if(saved.length){const index=(target as ReceivedLetter[]).indexOf(record);(target as ReceivedLetter[])[index]={...record,unsentReplies:[...(record.unsentReplies??[]),...saved]};added+=saved.length;}
      }
      continue;
    }
    (target as any[]).push(e.value); added++;
  }
  store.commitImported(sent as SentLetter[],received as ReceivedLetter[],replies as LocalReply[]);
  for (const star of newStars) stars.set(star.id,true,star.at); // Only collection metadata. Never restore memory consent.
  if(notes)added+=notes.importRecords(papers);
  return added;
}
