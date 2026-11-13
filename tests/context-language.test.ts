import {afterEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {BOTTLE_TOOL_DECLS,BOTTLE_HEADLESS_TOOL_DECLS} from '../world/tools.ts';
import {BOTTLE} from '../world/definition.ts';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';

let h:Harness|undefined;
afterEach(async()=>{await h?.stop();h=undefined;});


it('uses English for every runtime tool and nested parameter description',()=>{
  const inspect=(value:unknown):void=>{
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      if(key==='description'){
        expect(typeof item).toBe('string');
        expect(String(item)).not.toMatch(/\p{Script=Han}/u);
        expect(item).not.toMatch(/\b(?:human|companion)\b/i);
      }else inspect(item);
    }
  };
  for(const tool of [...BOTTLE_TOOL_DECLS,...BOTTLE_HEADLESS_TOOL_DECLS])inspect(tool);
});

it('keeps event catalog descriptions in Chinese for people',()=>{
  for(const event of BOTTLE.describe!.events){
    expect(typeof event.description).toBe('string');
    expect(event.description).toMatch(/\p{Script=Han}/u);
  }
});

it('addresses you and resolves the Bottle partner placeholder throughout the environment prompt',()=>{
  const text=readFileSync(new URL('../world/ENV_PROMPT.md',import.meta.url),'utf8');
  expect(text).toContain('你的伙伴：{{bottle.user | 伙伴}}');
  expect(text).not.toContain('【人】');
  expect(text).not.toContain('pet.user');
  expect(text).toContain('你用 bottle_write');
  expect(text).toContain('等{{bottle.user | 伙伴}}之后明确确认');
  expect(text).not.toMatch(/桌宠|人类|主人|用户/);
});

it('delivers English automatic-reading instructions while preserving the original letter',async()=>{
  h=makeHarness({port:0,config:{headlessEnabled:true}});const host=new FakeHost();await h.world.start(host);
  const body='这段原文不要翻译。\n请按原样分享。';h.throwAs('peer',body);
  await callTool(h.world,'bottle_catch');
  const held=Reflect.get(h.world,'store').held;
  const events=await host.deliverDeferred(h.world);
  const event=events.find(e=>e.type==='bottle.headless-reading')!;
  expect(event.origin).toBe('external');expect(event.text).toContain(body);
  expect(event.text).toContain('First share the complete original');
  expect(event.text).toContain('You must not send or discard anything in this turn');
  let instructions=event.text!;
  for(const original of [body,held.signature,held.from,held.topic].filter(Boolean))instructions=instructions.replaceAll(original,'');
  expect(instructions).not.toMatch(/\p{Script=Han}/u);
});
