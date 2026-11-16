import {afterEach,expect,it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {renderWorldEnvPrompt} from 'cortico/core/prefix.ts';
import {makeHarness,type Harness} from './helpers.ts';
import {BOTTLE_CONFIG_FIELDS,BOTTLE_DEFAULTS} from '../world/config.ts';

let h:Harness|undefined;
afterEach(async()=>{await h?.stop();h=undefined;});
it.each(['小海','名字\n新行',42,undefined])('always uses partner and ignores any retired name value: %j',async value=>{
  h=makeHarness();
  Reflect.set(h.cfg,'partnerName',value);
  writeFileSync(join(h.dir,'config.json'),JSON.stringify({worlds:{'desktop-pet':{user:'外部称呼'},bottle:{partnerName:'旧称呼'}}}));
  expect(h.world.envPromptVars()).not.toHaveProperty('bottle.user');
  const rendered=(await renderWorldEnvPrompt(h.world)).text;
  expect(rendered).toContain('伙伴会看到全文');
  expect(rendered).not.toMatch(/外部称呼|旧称呼|小海|\{\{/);
});
it('omits custom-name settings and salutation placeholders entirely',async()=>{
  h=makeHarness();
  expect(BOTTLE_DEFAULTS).not.toHaveProperty('partnerName');
  expect(BOTTLE_CONFIG_FIELDS).not.toHaveProperty('worlds.bottle.partnerName');
  expect(h.world.envPromptVars()).not.toHaveProperty('bottle.user');
  expect(h.world.webUi().promptDocs![0]!.vars!.some(variable=>variable.name==='bottle.user')).toBe(false);
  Object.defineProperty(Reflect.get(h.world,'ctx'),'botDir',{get(){throw Error('Private layout must not be read');}});
  expect(h.world.envPromptVars()).not.toHaveProperty('bottle.user');
  expect(await h.world.pageDeps().theme!()).toMatchObject({available:true});
});
