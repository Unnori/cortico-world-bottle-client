import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
export const FONT_ORIGIN = 'https://fontsforletters.sqnori.com';
export const FONT_CATALOG_URL = FONT_ORIGIN + '/catalog.json';
const MAX_CATALOG_BYTES = 512 * 1024;
export interface CloudFont { id:string; name:string; label:string; enabled:boolean; url:string; sha256:string; bytes:number }
export interface CloudCatalog { fonts:CloudFont[]; defaultFontId:string }
export interface FontResource { url:string; sha256:string; bytes:number }
export interface DefaultFont extends FontResource { id:string; name:string }
export function parseFontCatalog(value: unknown): CloudCatalog {
  const catalog = value as {schemaVersion?:unknown;fonts?:unknown;defaultFontId?:unknown};
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.fonts) || !catalog.fonts.length || catalog.fonts.length > 1024) throw Error('Invalid font catalog');
  const names = new Set<string>(), ids = new Set<string>();
  const fonts:CloudFont[] = catalog.fonts.map(font => {
    if (!font || typeof font.name !== 'string' || !font.name || font.name.length>200 || /[\/\\]/.test(font.name) || typeof font.label !== 'string' || !font.label || font.label.length>200 || typeof font.enabled !== 'boolean' || !/^[a-f0-9]{64}$/.test(font.sha256) || !Number.isSafeInteger(font.bytes) || font.bytes<48 || font.bytes>32*1024*1024 || font.license !== 'OFL-1.1') throw Error('Invalid font entry');
    const id = createHash('sha256').update(font.name).digest('hex');
    if (font.id !== id || names.has(font.name) || ids.has(id) || font.url !== FONT_ORIGIN + '/fonts/' + font.sha256 + '.woff2') throw Error('Invalid font identity or URL');
    names.add(font.name); ids.add(id);
    return {id,name:font.name,label:font.label,enabled:font.enabled,url:font.url,sha256:font.sha256,bytes:font.bytes};
  });
  if (typeof catalog.defaultFontId !== 'string' || !ids.has(catalog.defaultFontId) || !fonts.some(font=>font.enabled)) throw Error('Invalid font default');
  return {fonts,defaultFontId:catalog.defaultFontId};
}
export const INITIAL_FONT_CATALOG = parseFontCatalog(JSON.parse(readFileSync(new URL('./fonts/catalog.json',import.meta.url),'utf8')));
export function writingFont(catalog: CloudCatalog): DefaultFont {
  const font=catalog.fonts.find(font=>font.id===catalog.defaultFontId)!;
  return {id:font.sha256+'.woff2',name:font.label,url:font.url,sha256:font.sha256,bytes:font.bytes};
}
/** Metadata only on the host. Font bytes go directly to each browser. */
export class RemoteFontCatalog {
  private catalog = INITIAL_FONT_CATALOG;
  private nextRefresh = 0;
  private pending?: Promise<void>;
  private readonly file:string;
  constructor(dataDir:string, private readonly fetcher:typeof fetch = fetch, private readonly now = Date.now) {
    this.file=join(dataDir,'bottle-font-catalog.json');
    try { this.catalog=parseFontCatalog(JSON.parse(readFileSync(this.file,'utf8'))); } catch { /* Shipped metadata is the offline fallback. */ }
  }
  current():CloudCatalog { return this.catalog; }
  refresh():Promise<void> {
    if (this.pending) return this.pending;
    if (this.now()<this.nextRefresh) return Promise.resolve();
    this.nextRefresh=this.now()+300000;
    this.pending=this.fetchCatalog().catch(()=>{this.nextRefresh=this.now()+60000;}).finally(()=>{this.pending=undefined;});
    return this.pending;
  }
  private async fetchCatalog():Promise<void> {
    const response=await this.fetcher(FONT_CATALOG_URL,{signal:AbortSignal.timeout(5000),credentials:'omit',redirect:'error',headers:{accept:'application/json'}});
    if (!response.ok || !response.body) throw Error('Font catalog unavailable');
    const reader=response.body.getReader(), chunks:Uint8Array[]=[];let size=0;
    try { while(true) {const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>MAX_CATALOG_BYTES)throw Error('Font catalog too large');chunks.push(chunk.value);} }
    finally { await reader.cancel().catch(()=>{}); }
    const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')),catalog=parseFontCatalog(parsed);
    this.catalog=catalog;
    const temp=this.file+'.'+randomUUID()+'.tmp';
    try {writeFileSync(temp,JSON.stringify(parsed)+'\n','utf8');renameSync(temp,this.file);} catch { /* Keep the last valid in-memory catalog if storage is unavailable. */ }
    finally {try{unlinkSync(temp);}catch{}}
  }
}
