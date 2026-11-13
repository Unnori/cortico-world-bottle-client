import {afterEach,expect,it} from 'vitest';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {renderWorldEnvPrompt} from 'cortico/core/prefix.ts';
import {makeHarness,type Harness} from './helpers.ts';

let h:Harness|undefined;
afterEach(async()=>{await h?.stop();h=undefined;});

it('resolves bottle.user explicitly in the Bottle template and rereads changes without altering saved config',async()=>{
  h=makeHarness();const file=join(h.dir,'config.json');
  const save=(user:unknown)=>writeFileSync(file,JSON.stringify({worlds:{'desktop-pet':{user}}}));
  save('小海');const before=readFileSync(file,'utf8');
  expect(h.world.envPromptVars()['bottle.user']).toBe('小海');
  expect(h.world.envPromptVars()).not.toHaveProperty('pet.user');
  const rendered=(await renderWorldEnvPrompt(h.world)).text;
  expect(rendered).toContain('你的伙伴：小海');
  expect(rendered).toContain('等小海之后明确确认');
  expect(rendered).toContain('你不泄露小海的身份');
  expect(rendered).not.toMatch(/\{\{|【人】|pet\.user/);
  expect(readFileSync(file,'utf8')).toBe(before);
  expect(h.world.webUi().promptDocs![0].vars!.some(v=>v.name==='bottle.user')).toBe(true);
  expect(JSON.stringify(h.world.pageDeps().snapshot())).not.toContain('小海');
  save('新称呼');expect(h.world.envPromptVars()['bottle.user']).toBe('新称呼');
  unlinkSync(file);expect(h.world.envPromptVars()['bottle.user']).toBe('');
  const fallback=(await renderWorldEnvPrompt(h.world)).text;
  expect(fallback).toContain('你的伙伴：伙伴');expect(fallback).not.toContain('{{');
});

it.each([{}, {worlds:{'desktop-pet':{user:42}}}, {user:'不能猜这个名字'}, null])('uses a generic partner for missing or invalid preferences: %j',async(config)=>{
  h=makeHarness();writeFileSync(join(h.dir,'config.json'),JSON.stringify(config));
  expect(h.world.envPromptVars()['bottle.user']).toBe('');
  expect((await renderWorldEnvPrompt(h.world)).text).toContain('你的伙伴：伙伴');
});

it('invalid JSON revokes the last name, and control characters cannot create extra prompt lines',async()=>{
  h=makeHarness();const file=join(h.dir,'config.json');
  writeFileSync(file,JSON.stringify({worlds:{'desktop-pet':{user:' 名字\n新行\u0000 '}}}));
  expect(h.world.envPromptVars()['bottle.user']).toBe('名字 新行');
  writeFileSync(file,'{invalid');expect(h.world.envPromptVars()['bottle.user']).toBe('');
});
