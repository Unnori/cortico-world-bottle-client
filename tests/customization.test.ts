import { createHash } from 'node:crypto';
import { DEFAULT_MY_FONT } from '../world/default-font.ts';
import { saveMyFont, readMyFont, MY_FONT_MAX_BYTES } from '../world/my-font.ts';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LetterFonts, fontLibrary, fontAsset } from '../world/fonts.ts';
import { saveBackground, readBackground, BACKGROUND_MAX_BYTES } from '../world/background.ts';
import { customPalettes, isThemePreference, cardAppearance } from '../world/appearance.ts';
import { readThemePreference, saveThemePreference } from '../world/theme.ts';
import { handlePage, startPageServer, type PageSnapshot, type PageDeps, type PageServer } from '../world/page.ts';
import { LanPairing, startLanServer } from '../world/lan.ts';
const dirs: string[] = [], servers: PageServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); for (const dir of dirs.splice(0)) rmSync(dir,{recursive:true,force:true}); });
const temp = () => { const dir=mkdtempSync(join(tmpdir(),'bottle-custom-'));dirs.push(dir);return dir; };
const image = readFileSync(new URL('../world/icon.png',import.meta.url));
const sampleFont=Buffer.concat([Buffer.from('wOF2'),Buffer.alloc(60)]);
function snapshot(): PageSnapshot { return {draft:null,held:{letterId:'held',from:'灯塔',body:'来信',hoursLeft:1},sent:[{letterId:'sent',body:'信',at:'',reply:{from:'灯塔',body:'回信',at:''}}],received:[{letterId:'one',from:'灯塔',body:'来信',at:'',outcome:'kept'},{letterId:'two',from:'海风',body:'来信',at:'',outcome:'kept'}],quota:null,online:true}; }
function deps(dir: string): PageDeps {
 const ok=async()=>({ok:true});const fonts=new LetterFonts(dir);
 return {snapshot:()=>fonts.decorate(snapshot()),request:ok,send:ok,rewrite:ok,dismiss:ok,keep:ok,peruse:ok,discard:ok,open:ok,forget:ok,
   myFont:id=>readMyFont(dir,id), uploadMyFont:input=>saveMyFont(dir,input),
   background:id=>readBackground(dir,id), uploadBackground:input=>saveBackground(dir,input),
   appearance:async pref=>{if(pref)saveThemePreference(dir,pref);return cardAppearance(readThemePreference(dir)??{theme:'ocean',mode:'system'},{available:false});}};
}
function fakeFonts(dir: string, names: string[]) { const folder=join(dir,'fonts');mkdirSync(folder,{recursive:true});for(const name of names)writeFileSync(join(folder,name),Buffer.from('0001000000000000','hex'));return folder; }
it('同一来信人在手中、归档与回信使用同一字体，重启及导入不会改变旧字典',()=>{
 const dir=temp(), folder=fakeFonts(dir,['a.ttf','b.ttf']);const fonts=new LetterFonts(dir,folder), first=fonts.decorate(snapshot());
 expect(first.held!.fontId).toBe(first.received[0].fontId);expect(first.sent[0].reply!.fontId).toBe(first.held!.fontId);
 expect(first.received[1].fontId).not.toBe(first.held!.fontId);
 const before=JSON.parse(readFileSync(join(dir,'bottle-font-map.json'),'utf8'));
 fakeFonts(dir,['c.ttf']); const expanded=snapshot();expanded.received.push({letterId:'new',from:'贝壳',body:'新信',at:'',outcome:'kept'});
 const result=new LetterFonts(dir,folder).decorate(expanded);
 expect(result.received.slice(0,2)).toEqual(first.received);
 expect(result.received[2].fontId).toBe(fontLibrary(folder).find(f=>f.name==='c.ttf')!.id);
 expect(JSON.parse(readFileSync(join(dir,'bottle-font-map.json'),'utf8')).assignments).toMatchObject(before.assignments);
 const original=fontLibrary(folder).find(f=>f.id===first.held!.fontId)!;unlinkSync(original.path);
 const repaired=new LetterFonts(dir,folder).decorate(snapshot());
 expect(repaired.held!.fontId).toBeTruthy();expect(repaired.held!.fontId).not.toBe(original.id);
 expect(repaired.received[0].fontId).toBe(repaired.held!.fontId);expect(repaired.sent[0].reply!.fontId).toBe(repaired.held!.fontId);
 expect(new LetterFonts(dir,folder).decorate(snapshot())).toEqual(repaired);
 const untouched=createHash('sha256').update('visitor:海风').digest('hex');
 expect(JSON.parse(readFileSync(join(dir,'bottle-font-map.json'),'utf8')).assignments[untouched]).toBe(before.assignments[untouched]);
});
it('损坏字典保留原文件并回退；空字体池不制造无效映射',()=>{
 const dir=temp(),folder=fakeFonts(dir,[]);expect(new LetterFonts(dir,folder).decorate(snapshot())).toEqual(snapshot());
 fakeFonts(dir,['a.ttf']);writeFileSync(join(dir,'bottle-font-map.json'),'{broken');
 expect(new LetterFonts(dir,folder).decorate(snapshot())).toEqual(snapshot());expect(readFileSync(join(dir,'bottle-font-map.json'),'utf8')).toBe('{broken');
});
it('默认字库仅含远程元数据，不从本机提供字体文件',()=>{
 const fonts=fontLibrary();expect(fonts.length).toBeGreaterThanOrEqual(9);
 for(const file of fonts){expect(file.url).toMatch(/^https:\/\/fontsforletters\.sqnori\.com\/fonts\/[a-f0-9]{64}\.woff2$/);expect(file.path).toBe('');expect(fontAsset(file.id)).toBeNull();}
 for(const id of ['../package.json','%2e%2e%2fpackage.json','icon.png','a'.repeat(64)])expect(fontAsset(id)).toBeNull();
});
it('图片以内容摘要保存，允许新设备读取，拒绝 SVG、超限与目录穿越',()=>{
 const dir=temp();const id=saveBackground(dir,{data:image.toString('base64')});expect(id).toMatch(/^[a-f0-9]{64}\.png$/);
 expect(readBackground(dir,id)!.bytes.equals(image)).toBe(true);
 for(const bad of ['../config.json','%2e%2e%2fconfig.json','a'.repeat(64)+'.svg'])expect(readBackground(dir,bad)).toBeNull();
 for(const data of [Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),'?',Buffer.alloc(BACKGROUND_MAX_BYTES+1).toString('base64')])expect(()=>saveBackground(dir,{data})).toThrow();
});
function contrast(a:string,b:string):number{const lum=(x:string)=>[1,3,5].map(i=>parseInt(x.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);return(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);}
it.each(['#ffffff','#000000','#ffff00','#00ff00','#ff0000','#0000ff','#ff00ff','#666666','#757575','#777777'])('自定义 %s 保持浅深色文字对比且卡片使用同一色板',color=>{
 const palettes=customPalettes(color);expect(cardAppearance({theme:'custom',mode:'dark',customColor:color},{available:false}).palettes).toEqual(palettes);
 for(const p of Object.values(palettes)){expect(contrast(p.ink,p.card)).toBeGreaterThanOrEqual(4.5);expect(contrast(p.muted,p.card)).toBeGreaterThanOrEqual(4.5);expect(p.accent).toBe(color);expect(p.seal).toBe(color);expect(p.sea).toBe(color);expect(contrast(p['accent-text']!,p.card)).toBeGreaterThanOrEqual(4.5);expect(contrast(p['on-accent'],p.accent)).toBeGreaterThanOrEqual(4.5);}
});
it('自定义偏好保存并能恢复；未知字段不落盘，危险颜色与背景被拒绝',()=>{
 const dir=temp(),pref={theme:'custom' as const,mode:'system' as const,customColor:'#ad6850',background:'a'.repeat(64)+'.png'};
 saveThemePreference(dir,{...pref,secret:'ignored'} as any);expect(readThemePreference(dir)).toEqual(pref);
 expect(readFileSync(join(dir,'bottle-appearance.json'),'utf8')).not.toContain('secret');
 saveThemePreference(dir,{theme:'paper',mode:'light'});expect(readThemePreference(dir)).toEqual({...pref,theme:'paper',mode:'light'});
 for(const value of [{...pref,customColor:'url(https://bad)'},{...pref,background:'../config.json'}])expect(isThemePreference(value)).toBe(false);
});
it('真实 HTTP 单独允许背景上传大请求；其他动作仍限制 4 KiB',async()=>{
 const dir=temp(),d=deps(dir),server=await startPageServer(d,{port:19480});servers.push(server);
 const post=(path:string,body:unknown,headers:Record<string,string>={'x-bottle':'1'})=>fetch(server.url+path,{method:'POST',headers,body:JSON.stringify(body)});
 expect((await post('background',{data:image.toString('base64')},{})).status).toBe(403);
 const uploaded=await post('background',{data:image.toString('base64')});expect(uploaded.status).toBe(200);const {id}=await uploaded.json() as {id:string};
 const retrieved=await fetch(server.url+'background/'+id);expect(Buffer.from(await retrieved.arrayBuffer()).equals(image)).toBe(true);
 expect((await post('send',{data:'x'.repeat(5000)})).status).toBe(400);
 expect((await handlePage(d,'GET','/palette/ee9955')).status).toBe(200);
});
it('局域网字体、背景与上传沿用配对鉴权，已配对设备可加载实际字体',async()=>{
 const d=deps(temp()),server=await startLanServer(d,{port:0,pairing:new LanPairing('fixture-token')});servers.push(server);
 const base='http://127.0.0.1:'+server.port;
 const font=fontLibrary().find(f=>f.name==='Yozai-Regular.ttf')!;
 for(const path of ['/fonts/'+font.id,'/background/'+'a'.repeat(64)+'.png','/palette/aa8877'])expect((await fetch(base+path)).status).toBe(401);
 const headers={'x-bottle':'1',origin:base,'content-type':'application/json'};
 expect((await fetch(base+'/background',{method:'POST',headers,body:'{}'})).status).toBe(401);
 const paired=await fetch(base+'/pair',{method:'POST',headers,body:JSON.stringify({token:'fixture-token'})});expect(paired.status).toBe(200);
 const cookie=paired.headers.get('set-cookie')!.split(';')[0];
 const response=await fetch(base+'/fonts/'+font.id,{headers:{cookie}});expect(response.status).toBe(404);expect(font.url).toContain('https://fontsforletters.sqnori.com/fonts/');
 const uploaded=await fetch(base+'/background',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({data:image.toString('base64')})});expect(uploaded.status).toBe(200);
 const {id}=await uploaded.json() as {id:string};const downloaded=await fetch(base+'/background/'+id,{headers:{cookie}});expect(Buffer.from(await downloaded.arrayBuffer()).equals(image)).toBe(true);
});

it('种子信按署名区分，重洗只在停止后主动移走字典才发生',()=>{
 const dir=temp(),folder=fakeFonts(dir,['a.ttf','b.ttf']);const value=snapshot();value.held=null;value.sent=[];
 value.received=value.received.map((item,i)=>({...item,from:'海边邮局',seed:true,signature:i?'守灯人':'船夫'}));
 const first=new LetterFonts(dir,folder).decorate(value);expect(first.received[0].fontId).not.toBe(first.received[1].fontId);
 const file=join(dir,'bottle-font-map.json');expect(Object.keys(JSON.parse(readFileSync(file,'utf8')).assignments)).toHaveLength(2);
 unlinkSync(file); const next=new LetterFonts(dir,folder).decorate(value);expect(next.received.every(item=>item.fontId)).toBe(true);
 expect(Object.keys(JSON.parse(readFileSync(file,'utf8')).assignments)).toHaveLength(2);
});

it('我的字体与随机字体池分离，限制格式大小与路径，保存在本机部署数据',()=>{
 const dir=temp(),before=fontLibrary().map(f=>f.id),file=fontLibrary().find(f=>f.name==='Yozai-Regular.ttf')!;
 const bytes=sampleFont,saved=saveMyFont(dir,{data:bytes.toString('base64'),name:'C:\\private\\my.ttf'});
 expect(saved.name).toBe('my.ttf');expect(readMyFont(dir,saved.id)!.bytes.equals(bytes)).toBe(true);
 expect(fontLibrary().map(f=>f.id)).toEqual(before);expect(readMyFont(dir,'../config.json')).toBeNull();
 for(const data of [image.toString('base64'),Buffer.alloc(MY_FONT_MAX_BYTES+1).toString('base64')])expect(()=>saveMyFont(dir,{data})).toThrow();
});
it('透明度与个人字体持久保存，旧页面更改主题不会覆盖新设置',()=>{
 const dir=temp(),pref={theme:'custom' as const,mode:'dark' as const,backgroundTransparency:37,myFont:'a'.repeat(64)+'.woff2',myFontName:'我的字体.woff2'};
 saveThemePreference(dir,pref);expect(readThemePreference(dir)).toEqual(pref);
 saveThemePreference(dir,{theme:'ocean',mode:'light'});expect(readThemePreference(dir)).toEqual({...pref,theme:'ocean',mode:'light'});
 for(const bad of [-1,101,NaN,'20',Infinity])expect(isThemePreference({...pref,backgroundTransparency:bad})).toBe(false);
 for(const bad of ['../private.ttf','https://example.test/font.ttf','a'.repeat(64)+'.png'])expect(isThemePreference({...pref,myFont:bad})).toBe(false);
 saveThemePreference(dir,{...pref,myFont:null,myFontName:''});expect(readThemePreference(dir)!.myFont).toBeNull();
});
it('个人字体上传和下载经过 LAN 配对，普通发送动作仍拒绝大请求',async()=>{
 const d=deps(temp()),server=await startLanServer(d,{port:0,pairing:new LanPairing('my-font-test')});servers.push(server);
 const base='http://127.0.0.1:'+server.port,headers={'x-bottle':'1',origin:base,'content-type':'application/json'};
 expect((await fetch(base+'/my-font',{method:'POST',headers,body:'{}'})).status).toBe(401);
 expect((await fetch(base+'/my-font/'+'a'.repeat(64)+'.ttf')).status).toBe(401);
 const pair=await fetch(base+'/pair',{method:'POST',headers,body:JSON.stringify({token:'my-font-test'})});const cookie=pair.headers.get('set-cookie')!.split(';')[0];
 const file=fontLibrary().find(f=>f.name==='Yozai-Regular.ttf')!,bytes=sampleFont,body=JSON.stringify({data:bytes.toString('base64'),name:file.name});
 const response=await fetch(base+'/my-font',{method:'POST',headers:{...headers,cookie},body});expect(response.status).toBe(200);
 const {id}=await response.json() as {id:string};const asset=await fetch(base+'/my-font/'+id,{headers:{cookie}});
 expect(asset.headers.get('cache-control')).toContain('private');expect(Buffer.from(await asset.arrayBuffer()).equals(bytes)).toBe(true);
 expect((await fetch(base+'/send',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({big:'x'.repeat(5000)})})).status).toBe(400);
});

it('默认写信笔迹来自公开R2，个人导入仍优先且不捆绑默认二进制', async () => {
 const dir=temp();expect(DEFAULT_MY_FONT.url).toBe('https://fontsforletters.sqnori.com/fonts/'+DEFAULT_MY_FONT.sha256+'.woff2');
 expect(DEFAULT_MY_FONT.id).toBe(DEFAULT_MY_FONT.sha256+'.woff2');expect(readMyFont(dir,DEFAULT_MY_FONT.id)).toBeNull();
 expect(fontLibrary().some(font=>font.name.includes('鸿雷小纸条'))).toBe(false);
 const d=deps(dir);delete d.myFont;
 expect((await handlePage(d,'GET','/my-font/'+DEFAULT_MY_FONT.id)).status).toBe(404);
 expect(d.snapshot().defaultFont).toEqual(DEFAULT_MY_FONT);
 const personal=saveMyFont(dir,{data:sampleFont.toString('base64'),name:'我的字体.woff2'});
 expect(readMyFont(dir,personal.id)!.bytes.equals(sampleFont)).toBe(true);expect(readThemePreference(dir)).toBeUndefined();
});
it('公开默认字体不通过本机二进制路由，自定义字体路由仍需LAN配对', async () => {
 const d=deps(temp());delete d.myFont;
 const server=await startLanServer(d,{port:0,pairing:new LanPairing('default-font-test')});servers.push(server);
 const base='http://127.0.0.1:'+server.port,path='/my-font/'+DEFAULT_MY_FONT.id;
 expect((await fetch(base+path)).status).toBe(401);
 const pair=await fetch(base+'/pair',{method:'POST',headers:{'x-bottle':'1',origin:base,'content-type':'application/json'},body:JSON.stringify({token:'default-font-test'})});
 const cookie=pair.headers.get('set-cookie')!.split(';')[0];expect((await fetch(base+path,{headers:{cookie}})).status).toBe(404);
 const snapshot=await (await fetch(base+'/draft',{headers:{cookie}})).json() as PageSnapshot;
 expect(snapshot.defaultFont?.url).toBe(DEFAULT_MY_FONT.url);expect(Object.keys(snapshot.fontResources??{}).length).toBeGreaterThanOrEqual(9);
});

it('转换后的字体沿用旧名称、资源 ID 和字典值，隔离目录不参与抽取', () => {
 const dir=temp(), folder=join(dir,'fonts');mkdirSync(folder);
 for(const group of ['redistributable','restricted','unverified','originals'])mkdirSync(join(folder,group));
 const name='old.ttf',file='old.woff2',bytes=Buffer.from('774f46320000000000000000','hex');
 writeFileSync(join(folder,'redistributable',file),bytes);
 writeFileSync(join(folder,'restricted','no.ttf'),Buffer.from('0001000000000000','hex'));
 writeFileSync(join(folder,'unverified','unknown.ttf'),Buffer.from('0001000000000000','hex'));
 writeFileSync(join(folder,'originals','old.ttf'),Buffer.from('0001000000000000','hex'));
 writeFileSync(join(folder,'catalog.json'),JSON.stringify({fonts:[{name,file}]}));
 const key=createHash('sha256').update('visitor:灯塔').digest('hex');
 writeFileSync(join(dir,'bottle-font-map.json'),JSON.stringify({version:1,assignments:{[key]:name}}));
 const fonts=fontLibrary(folder),id=createHash('sha256').update(name).digest('hex');
 expect(fonts).toHaveLength(1);expect(fonts[0]).toMatchObject({name,id,mime:'font/woff2'});
 expect(fontAsset(id,folder)!.bytes.equals(bytes)).toBe(true);
 expect(new LetterFonts(dir,folder).decorate(snapshot()).held!.fontId).toBe(id);
 expect(JSON.parse(readFileSync(join(dir,'bottle-font-map.json'),'utf8')).assignments[key]).toBe(name);
 // User-imported original wins without allocating a second logical font.
 writeFileSync(join(folder,name),Buffer.from('0001000000000000','hex'));
 expect(fontLibrary(folder)).toHaveLength(1);expect(fontLibrary(folder)[0].path).toBe(join(folder,name));
});
it('移出授权未确认字体时只替换失效绑定，并保存可用笔迹', () => {
 const dir=temp(),folder=fakeFonts(dir,['safe.ttf']);
 const key=createHash('sha256').update('visitor:灯塔').digest('hex');
 writeFileSync(join(dir,'bottle-font-map.json'),JSON.stringify({version:1,assignments:{[key]:'unverified.ttf'}}));
 expect(new LetterFonts(dir,folder).decorate(snapshot()).held!.fontId).toBe(fontLibrary(folder)[0].id);
 expect(JSON.parse(readFileSync(join(dir,'bottle-font-map.json'),'utf8')).assignments[key]).toBe('safe.ttf');
});

it('真实 HTTP 只接受有限的公开缓存摘要，LAN 未配对不能读取或改绑',async()=>{
 const dir=temp(),d=deps(dir),calls:(readonly string[]|undefined)[]=[];
 const original=d.snapshot;d.snapshot=ids=>{calls.push(ids);return original(ids);};
 const server=await startPageServer(d,{port:19503});servers.push(server);
 const digest='a'.repeat(64),another='b'.repeat(64);
 expect((await fetch(server.url+'draft',{headers:{'x-bottle-cached-fonts':digest+',bad,'+digest+','+another}})).status).toBe(200);
 expect(calls.at(-1)).toEqual([digest,another]);
 expect((await fetch(server.url+'draft',{headers:{'x-bottle-cached-fonts':Array(34).fill(digest).join(',')}})).status).toBe(200);
 expect(calls.at(-1)).toEqual([]);
 const lan=await startLanServer(d,{port:0,pairing:new LanPairing('font-repair-test')});servers.push(lan);
 const base='http://127.0.0.1:'+lan.port,before=calls.length;
 expect((await fetch(base+'/draft',{headers:{'x-bottle-cached-fonts':digest}})).status).toBe(401);expect(calls).toHaveLength(before);
 const paired=await fetch(base+'/pair',{method:'POST',headers:{'x-bottle':'1',origin:base,'content-type':'application/json'},body:JSON.stringify({token:'font-repair-test'})});
 const cookie=paired.headers.get('set-cookie')!.split(';')[0];
 expect((await fetch(base+'/draft',{headers:{cookie,'x-bottle-cached-fonts':digest}})).status).toBe(200);expect(calls.at(-1)).toEqual([digest]);
});
