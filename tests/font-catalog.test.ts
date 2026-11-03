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

it('撤下字体只修复一次，优先使用浏览器已缓存的启用笔迹，各设备沿用同一字典',()=>{
 const dir=temp(),c=catalog(),cached=c.fonts[1],stable=c.fonts[0];
 const oldKey=hash('visitor:老朋友'),stableKey=hash('visitor:新朋友');
 writeFileSync(join(dir,'bottle-font-map.json'),JSON.stringify({version:1,assignments:{[oldKey]:'removed.ttf',[stableKey]:stable.name}}));
 const fonts=new LetterFonts(dir),s=snapshot();s.sent=[{letterId:'sent',body:'信',at:'',reply:{from:'老朋友',body:'回信',at:''}}];
 const repaired=fonts.decorate(s,[cached.sha256]);
 expect(repaired.held?.fontId).toBe(cached.id);expect(repaired.sent[0].reply?.fontId).toBe(cached.id);
 expect(repaired.received[0].fontId).toBe(stable.id);
 expect(JSON.parse(readFileSync(join(dir,'bottle-font-map.json'),'utf8')).assignments).toEqual({[oldKey]:cached.name,[stableKey]:stable.name});
 expect(new LetterFonts(dir).decorate(s,[c.fonts[2].sha256])).toEqual(repaired);
});
it('缓存提示忽略未知摘要与停用字体，失效绑定仍能从启用池修复',async()=>{
 const dir=temp(),c=catalog(),enabled=c.fonts[2];c.fonts.forEach((f:any)=>f.enabled=f.id===enabled.id);
 const disabled=c.fonts[0];
 writeFileSync(join(dir,'bottle-font-map.json'),JSON.stringify({version:1,assignments:{[hash('visitor:老朋友')]:'removed.ttf',[hash('visitor:新朋友')]:disabled.name}}));
 const remote=new RemoteFontCatalog(dir,vi.fn(async()=>Response.json(c)) as any),fonts=new LetterFonts(dir,FONT_DIR,remote);
 await fonts.refresh();const repaired=fonts.decorate(snapshot(),['0'.repeat(64),disabled.sha256]);
 expect(repaired.held?.fontId).toBe(enabled.id);expect(repaired.received[0].fontId).toBe(disabled.id);
});
it('种子信按署名修复失效笔迹，空字体池保留原绑定以待恢复',()=>{
 const dir=temp(),c=catalog(),cached=c.fonts[1],key=hash('seed:灯塔');
 writeFileSync(join(dir,'bottle-font-map.json'),JSON.stringify({version:1,assignments:{[key]:'removed.ttf'}}));
 const s=snapshot();s.held={...s.held!,seed:true,signature:'灯塔'};s.received=[{...s.received[0],seed:true,signature:'灯塔'}];
 const repaired=new LetterFonts(dir).decorate(s,[cached.sha256]);expect(repaired.held?.fontId).toBe(cached.id);expect(repaired.received[0].fontId).toBe(cached.id);
 const emptyDir=temp(),map=JSON.stringify({version:1,assignments:{[hash('visitor:老朋友')]:'removed.ttf'}});
 writeFileSync(join(emptyDir,'bottle-font-map.json'),map);
 expect(new LetterFonts(emptyDir,join(emptyDir,'no-fonts')).decorate(snapshot())).toEqual(snapshot());
 expect(readFileSync(join(emptyDir,'bottle-font-map.json'),'utf8')).toBe(map);
});
