/** Native framework config renderer + synthetic settings only; never touches a running deployment. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import ts from 'typescript';
import { BOTTLE_CONFIG_GROUPS, BOTTLE_CONFIG_FIELDS, BOTTLE_DEFAULTS } from '../world/config.ts';
import { coerceGroupValues, readGroupValues, setByPath } from 'cortico/core/config-schema.ts';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';

const framework=resolve('node_modules/cortico/src');
const state={worlds:{bottle:{...BOTTLE_DEFAULTS}}};
const saves:Array<{group:string;values:Record<string,unknown>}>=[];
const palette=Object.values(BUILTIN_PALETTES)[0];
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
<style>*,*::before,*::after{box-sizing:border-box}body{display:block;overflow:auto;margin:0;padding:16px;background:var(--paper);color:var(--ink)}#root{container:webui-content / inline-size;max-width:1080px;margin:auto}</style>
<div id="root"></div><script type="module">
import {createConfigView} from '/framework/web/client/features/config/view.ts';
import {Lifecycle} from '/framework/web/client/core/lifecycle.ts';
import {h} from '/framework/web/client/ui/dom.ts';
import {input,select,checkbox} from '/framework/web/client/ui/fields.ts';
import {actions,button,msgline,placeholder,sheet} from '/framework/web/client/ui/sheet.ts';
window.errors=[];addEventListener('error',e=>errors.push(e.message));
const life=new Lifecycle(e=>errors.push(String(e))),sig=life.signal;
const ui={h:(...args)=>h(document,...args),input:opts=>input(document,sig,opts),select:opts=>select(document,sig,opts),
checkbox:(label,opts)=>checkbox(document,sig,label,opts),actions:()=>actions(document),msgline:()=>msgline(document),
placeholder:text=>placeholder(document,text),button:(label,opts)=>button(document,sig,label,opts),toast:()=>{}};
const view=createConfigView({ui,lifecycle:life,signal:sig,showOwner:false});
const card=sheet(document,{title:'配置'});card.body.append(view.el);document.getElementById('root').append(card.el);
await view.load();window.ready=true;addEventListener('pagehide',()=>life.dispose());
</script></html>`;
const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');const url=new URL(req.url!,'http://fixture');
  try{
    if(url.pathname==='/fixture'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<iframe id="panel" src="/" style="border:0;width:1040px;height:1800px"></iframe>');return;}
    if(url.pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
    if(url.pathname==='/styles.css'){res.setHeader('content-type','text/css');res.end(readFileSync(resolve(framework,'web/public/styles.css'),'utf8').replace('@import "tailwindcss";',''));return;}
    if(url.pathname.startsWith('/framework/')){
      const file=resolve(framework,decodeURIComponent(url.pathname.slice(11))),rel=relative(framework,file);
      if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||!file.endsWith('.ts')){res.writeHead(404);res.end();return;}
      res.setHeader('content-type','text/javascript');res.end(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);return;
    }
    res.setHeader('content-type','application/json');
    if(url.pathname==='/api/config'&&req.method==='GET'){res.end(JSON.stringify({groups:BOTTLE_CONFIG_GROUPS.map(group=>({group,values:readGroupValues(state as never,group)}))}));return;}
    if(url.pathname==='/api/config'&&req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);
      const group=BOTTLE_CONFIG_GROUPS.find(group=>group.id===payload.group);if(!group)throw Error('Unknown config group');
      const coerced=coerceGroupValues(group,payload.values);if('error'in coerced)throw Error(coerced.error);
      saves.push(payload);for(const [path,value]of Object.entries(coerced.values))setByPath(state,path,value);
      res.end(JSON.stringify({result:'已保存'}));return;
    }
    if(url.pathname.startsWith('/api/config/options/')){const kind=url.pathname.endsWith('incoming')?'incoming':'reply';res.end(JSON.stringify({options:[{value:kind+'/'+(kind==='incoming'?'New_notifications_1.wav':'New_notifications_3.wav'),label:'默认音效'}]}));return;}
    res.writeHead(404);res.end('{}');
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const port=(server.address()as{port:number}).port,proxy='http://localhost:3456';
async function rpc(path:string,body?:string){const res=await fetch(proxy+path,{method:body===undefined?'GET':'POST',body});const value=await res.json()as any;if(value.error)throw Error(JSON.stringify(value.error));return value;}
let tab:string|undefined;
const evaluate=async(code:string)=>(await rpc('/eval?target='+tab,code)).value;
const panel=(code:string)=>evaluate("document.getElementById('panel').contentWindow.eval("+JSON.stringify(code)+")");
async function until(code:string){for(let n=0;n<80;n++){if(await panel(code))return;await new Promise(done=>setTimeout(done,150));}throw Error('Timed out: '+code);}
try{
  tab=(await rpc('/new','http://127.0.0.1:'+port+'/fixture')).targetId;
  await until('window.ready===true');
  for(const width of[1040,390]){
    await evaluate(`document.getElementById('panel').style.width='${width}px';true`);
    for(const mode of['light','dark']as const){
      await panel(`Object.entries(${JSON.stringify(palette[mode])}).forEach(([key,value])=>document.documentElement.style.setProperty('--'+key,value));true`);
      const result=await panel(`(()=>({titles:Array.from(document.querySelectorAll('.tsection')).map(n=>n.textContent),rows:document.querySelectorAll('.trow').length,overflow:document.documentElement.scrollWidth>innerWidth,pathPickers:document.querySelectorAll('.pathpick').length,errors:window.errors}))()`);
      assert.deepEqual(result.titles,BOTTLE_CONFIG_GROUPS.map(group=>group.schema.title));
      assert.equal(result.rows,Object.keys(BOTTLE_CONFIG_FIELDS).length);assert.equal(result.pathPickers,2);assert.deepEqual(result.errors,[]);
      // Native host fields must remain usable on narrow windows; grouping adds no custom layout.
      assert.equal(result.overflow,false,`${width}px ${mode}: no horizontal overflow`);
      console.log(`PASS native config renderer: ${width}px ${mode}, ${result.rows} settings in ${result.titles.length} sections`);
    }
  }
  await panel(`var first=document.querySelector('.trow select');first.value='page';first.dispatchEvent(new Event('change'));true`);
  await until("document.querySelector('.msgline').textContent.startsWith('✓')");
  assert.equal(saves[0]?.group,'world:bottle:display');assert.equal(state.worlds.bottle.surface,'page');
  assert.equal(Object.keys(saves[0]!.values).length,3);
  // Native checkboxes live in label wrappers; target by the LAN field title, not a sibling section.
  await panel(`var row=Array.from(document.querySelectorAll('.trow')).find(n=>n.querySelector('.tlabel').textContent.startsWith('允许其他设备访问信箱'));var box=row.querySelector('input');box.checked=true;box.dispatchEvent(new Event('change'));true`);
  for(let n=0;n<40&&saves.length<2;n++)await new Promise(done=>setTimeout(done,100));
  assert.equal(saves[1]?.group,'world:bottle');assert.equal(state.worlds.bottle.lanEnabled,true);assert.equal(Object.keys(saves[1]!.values).length,3);
  await panel(`var row=Array.from(document.querySelectorAll('.trow')).find(n=>n.querySelector('.tlabel').textContent.startsWith('写信邀请每日上限'));var input=row.querySelector('input');input.value='5';input.dispatchEvent(new Event('change'));true`);
  for(let n=0;n<40&&saves.length<3;n++)await new Promise(done=>setTimeout(done,100));
  assert.equal(saves[2]?.group,'world:bottle:invitations');assert.equal(state.worlds.bottle.writeInviteDayLimit,5);
  const reminder = await panel(`(()=>{const rows=Array.from(document.querySelectorAll('.trow'));const find=title=>rows.find(row=>row.querySelector('.tlabel').textContent.startsWith(title)).querySelector('input');const hours=find('待办提醒最短间隔'),limit=find('待办提醒每日上限');return {hours:[hours.min,hours.max,hours.value,hours.step],limit:[limit.min,limit.max,limit.value],valid:hours.checkValidity()&&limit.checkValidity()}})()`);
  assert.deepEqual(reminder.hours,['0.5','1','0.5','0.01']);assert.deepEqual(reminder.limit,['3','20','12']);assert.equal(reminder.valid,true);
  await panel(`var row=Array.from(document.querySelectorAll('.trow')).find(n=>n.querySelector('.tlabel').textContent.startsWith('待办提醒每日上限'));var input=row.querySelector('input');input.value='20';input.dispatchEvent(new Event('change'));true`);
  for(let n=0;n<40&&saves.length<4;n++)await new Promise(done=>setTimeout(done,100));
  assert.equal(saves[3]?.group,'world:bottle:invitations');assert.equal(state.worlds.bottle.reminderDayLimit,20);
  console.log('PASS native autosave: reminder bounds/defaults, per-group persistence and original LAN group ID; all data synthetic');
  const out=resolve('../../scratch/bottle-config-groups');mkdirSync(out,{recursive:true});
  await panel('scrollTo(0,0);true');
  if(process.env.BOTTLE_BROWSER_SCREENSHOTS !== '0') await rpc('/screenshot?target='+tab+'&file='+encodeURIComponent(resolve(out,'mobile.png')));
}finally{if(tab)await rpc('/close?target='+tab).catch(()=>{});server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
