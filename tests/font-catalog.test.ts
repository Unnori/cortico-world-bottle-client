import { createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach,expect,it,vi } from 'vitest';
import { RemoteFontCatalog,parseFontCatalog,FONT_ORIGIN,FONT_CATALOG_URL } from '../world/font-catalog.ts';
import { LetterFonts,FONT_DIR } from '../world/fonts.ts';
import type { PageSnapshot } from '../world/page.ts';
const dirs:string[]=[];const temp=()=>{const dir=mkdtempSync(join(tmpdir(),'bottle-catalog-'));dirs.push(dir);return dir;};
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const catalog=()=>JSON.parse(readFileSync(new URL('../world/fonts/catalog.json',import.meta.url),'utf8'));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const snapshot=():PageSnapshot=>({draft:null,held:{letterId:'one',from:'老朋友',body:'信',hoursLeft:1},sent:[],received:[{letterId:'two',from:'新朋友',body:'信',at:'',outcome:'kept'}],quota:null,online:true});
it('云端新增与停用只影响新绑定，已有发信人笔迹与字典名保留',async()=>{
 const dir=temp(),updated=catalog(),old=updated.fonts[0];
 writeFileSync(join(dir,'bottle-font-map.json'),JSON.stringify({version:1,assignments:{[hash('visitor:老朋友')]:old.name}}));
 updated.fonts.forEach((font:any)=>font.enabled=false);
 const name='new.ttf',digest='a'.repeat(64);updated.fonts.push({...old,id:hash(name),name,label:'新笔迹',enabled:true,sha256:digest,url:FONT_ORIGIN+'/fonts/'+digest+'.woff2'});
 const remote=new RemoteFontCatalog(dir,vi.fn(async()=>Response.json(updated)) as any),fonts=new LetterFonts(dir,FONT_DIR,remote);
 await fonts.refresh();const result=fonts.decorate(snapshot());
 expect(result.held?.fontId).toBe(old.id);expect(result.received[0].fontId).toBe(hash(name));
 expect(result.fontResources?.[old.id].url).toBe(old.url);expect(Object.keys(result.fontResources??{})).toHaveLength(10);
 expect(JSON.parse(readFileSync(join(dir,'bottle-font-map.json'),'utf8')).assignments[hash('visitor:老朋友')]).toBe(old.name);
 expect(new RemoteFontCatalog(dir).current().fonts).toHaveLength(10);
});
it('并发刷新合并，失败保留有效清单并限速重试，不向R2发送配对凭据',async()=>{
 const dir=temp();let now=1000;const fetcher=vi.fn(async()=>Response.json(catalog()));
 const remote=new RemoteFontCatalog(dir,fetcher as any,()=>now);
 await Promise.all([remote.refresh(),remote.refresh(),remote.refresh()]);expect(fetcher).toHaveBeenCalledTimes(1);
 expect(fetcher.mock.calls[0]).toEqual([FONT_CATALOG_URL,expect.objectContaining({credentials:'omit',redirect:'error'})]);
 now+=300000;fetcher.mockImplementation(async()=>{throw Error('offline');});await remote.refresh();await remote.refresh();expect(fetcher).toHaveBeenCalledTimes(2);expect(remote.current().fonts).toHaveLength(9);
 now+=60000;await remote.refresh();expect(fetcher).toHaveBeenCalledTimes(3);
});
it('拒绝外部字体地址、重复身份、错误默认与超大清单，保留旧有效缓存',async()=>{
 for(const mutate of [(c:any)=>c.fonts[0].url='https://example.org/font.woff2',(c:any)=>c.fonts.push(c.fonts[0]),(c:any)=>c.defaultFontId='0'.repeat(64)]){const c=catalog();mutate(c);expect(()=>parseFontCatalog(c)).toThrow();}
 const dir=temp(),remote=new RemoteFontCatalog(dir,vi.fn(async()=>new Response('x'.repeat(512*1024+1))) as any);
 await remote.refresh();expect(remote.current().fonts).toHaveLength(9);
 writeFileSync(join(dir,'bottle-font-catalog.json'),'{broken');expect(new RemoteFontCatalog(dir).current().fonts).toHaveLength(9);
});
