import {putAsset,getAsset} from './local-db.ts';

import { createHash } from 'node:crypto';

import { FONT_TYPES } from './fonts.ts';
export const MY_FONT_MAX_BYTES = 32 * 1024 * 1024;
export const MY_FONT_ID = /^[a-f0-9]{64}\.(ttf|otf|woff2?)$/;
const EXTENSIONS: Record<string,string> = { 'font/ttf':'ttf', 'font/otf':'otf', 'font/woff':'woff', 'font/woff2':'woff2' };
export function saveMyFont(dataDir: string, input: unknown): { id:string; name:string } {
  if (!input || typeof input !== 'object') throw new Error('Invalid font');
  const { data, name } = input as { data?:unknown; name?:unknown };
  if (typeof data !== 'string' || data.length > Math.ceil(MY_FONT_MAX_BYTES/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid font');
  const bytes=Buffer.from(data,'base64'), mime=FONT_TYPES[bytes.subarray(0,4).toString('hex')];
  if (!mime || bytes.length < 12 || bytes.length > MY_FONT_MAX_BYTES) throw new Error('Invalid font');
  const id=createHash('sha256').update(bytes).digest('hex')+'.'+EXTENSIONS[mime];
  const label=typeof name==='string' ? name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,'').slice(0,120) : '';
  putAsset(dataDir,{kind:'font',id,name:label||'我的字体.'+EXTENSIONS[mime],mime,bytes,metadata:{}});
  return {id,name:label || '我的字体.'+EXTENSIONS[mime]};
}
export function readMyFont(dataDir:string,id:string): {bytes:Buffer;mime:string}|null {
  if (!MY_FONT_ID.test(id)) return null;
  const asset=getAsset(dataDir,'font',id);return asset?{bytes:asset.bytes,mime:asset.mime}:null;
}
