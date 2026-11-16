import {readLocalDocument as sqlRead,writeLocalDocument as sqlWrite,withDatabase as sqlDb,LOCAL_DB_NAME} from '../world/local-db.ts';
import {afterEach,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {makeHarness,type Harness} from './helpers.ts';
import {HOST_THEME_KEYS,readHostTheme,saveHostTheme} from '../world/host-theme.ts';
import {cardAppearance,MAILBOX_PALETTES} from '../world/appearance.ts';
import {saveThemePreference,readMailboxTheme} from '../world/theme.ts';
import {handlePage,pageHtml} from '../world/page.ts';
let h:Harness;afterEach(async()=>{await h?.stop();});
const sample={selectedId:'mint',appearance:'dark',palette:{paper:'#112233',accent:'#AABBCC'},at:1234};
it('stores a whitelisted panel observation and exposes a palette-free summary',async()=>{
  h=makeHarness({port:0});
  Object.defineProperty(Reflect.get(h.world,'ctx'),'botDir',{get(){throw Error('No host files');}});
  const summary:any=await h.world.webUi().invoke!('mailbox','hostTheme',[{...sample,palette:{...sample.palette,secret:'private'},note:'private'}]);
  expect(summary).toEqual({selectedId:'mint',appearance:'dark',at:1234,observedAt:h.clock.t,hostVersion:'unknown'});
  const stored=readHostTheme(h.dir)!;expect(stored.palette).toEqual({paper:'#112233',accent:'#aabbcc'});
  expect(JSON.stringify(sqlRead(join(h.dir,'bottle-host-theme.json')))).not.toContain('private');
  expect((await h.world.webUi().invoke!('mailbox','status',[]) as any).hostTheme).toEqual(summary);
  expect(await handlePage(h.world.pageDeps(),'GET','/host-theme')).toMatchObject({status:200,json:stored});
});
it.each([null,{}, {...sample,palette:{}},{...sample,palette:{paper:'rgb(0,0,0)'}},{...sample,palette:{paper:'#abc'}},{...sample,palette:{paper:'url(https://x)'}},{...sample,appearance:'system'},{...sample,at:'now'}])('rejects an invalid snapshot without overwriting the old one: %j',value=>{
  h=makeHarness();saveHostTheme(h.dir,sample,100);const file=join(h.dir,'bottle-host-theme.json'),before=JSON.stringify(sqlRead(file));
  expect(()=>saveHostTheme(h.dir,value)).toThrow();expect(JSON.stringify(sqlRead(file))).toBe(before);
});
it('refreshes from its own snapshot and keeps default colors for missing keys',async()=>{
  h=makeHarness();const snapshot=saveHostTheme(h.dir,sample,1235);saveThemePreference(h.dir,{theme:'host',mode:'light'});
  const appearance=cardAppearance({theme:'host',mode:'light'},snapshot);
  expect(appearance.resolvedAppearance).toBe('dark');expect(appearance.palettes.dark.paper).toBe('#112233');
  expect(appearance.palettes.dark.ink).toBe(MAILBOX_PALETTES.ocean.dark.ink);
  const html=pageHtml(await readMailboxTheme(h.dir));expect(JSON.parse(html.match(/id="host-theme">([\s\S]*?)<\/script>/)![1]).selectedId).toBe('mint');
  expect(html).not.toContain("fetch('/api/theme')");expect(cardAppearance({theme:'host',mode:'dark'},null).palettes).toEqual(MAILBOX_PALETTES.ocean);
});
it('ignores damaged snapshots and escapes metadata for HTML embedding',async()=>{
  h=makeHarness();expect(HOST_THEME_KEYS).toHaveLength(14);saveHostTheme(h.dir,{...sample,selectedId:'</script><script>bad()</script>'});
  expect(pageHtml(await readMailboxTheme(h.dir))).not.toContain('<script>bad()');
  sqlWrite(join(h.dir,'bottle-host-theme.json'),{invalid:true});expect(readHostTheme(h.dir)).toBeNull();
});
