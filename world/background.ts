import {putAsset,getAsset} from './local-db.ts';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Shipped scenery uses the same protected content-addressed route as uploads. */
export const DEFAULT_BACKGROUND = {
  id: 'b2242dcf80c08968cb99605f025d5c247da5e294fa8372a8a0a6767d7d1e5045.webp',
  transparency: 60,
} as const;

export const BACKGROUND_MAX_BYTES = 8 * 1024 * 1024;
export const BACKGROUND_ID = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
function imageType(bytes: Buffer): { ext: string; mime: string } | null {
  if (bytes.length >= 24 && bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' && bytes.toString('ascii',12,16)==='IHDR') return { ext:'png', mime:'image/png' };
  if (bytes.length >= 4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return { ext:'jpg', mime:'image/jpeg' };
  if (bytes.length >= 16 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return { ext:'webp', mime:'image/webp' };
  return null;
}
export function saveBackground(dataDir: string, input: unknown): string {
  if (!input || typeof input !== 'object' || typeof (input as any).data !== 'string') throw new Error('Invalid image');
  const data = (input as {data:string}).data;
  if (data.length > Math.ceil(BACKGROUND_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid image');
  const bytes = Buffer.from(data, 'base64'), type = imageType(bytes);
  if (!type || bytes.length > BACKGROUND_MAX_BYTES) throw new Error('Invalid image');
  const id = createHash('sha256').update(bytes).digest('hex') + '.' + type.ext;
  putAsset(dataDir,{kind:'background',id,name:id,mime:type.mime,bytes,metadata:{}});
  return id;
}
export function readBackground(dataDir: string, id: string): { bytes: Buffer; mime: string } | null {
  if (!BACKGROUND_ID.test(id)) return null;
  if (id === DEFAULT_BACKGROUND.id) return { bytes: readFileSync(new URL('./backgrounds/default.webp', import.meta.url)), mime: 'image/webp' };
  const asset=getAsset(dataDir,'background',id);return asset?{bytes:asset.bytes,mime:asset.mime}:null;
}
