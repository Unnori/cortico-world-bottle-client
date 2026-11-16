import {readLocalDocument as sqlRead,writeLocalDocument as sqlWrite,localBackups,readLocalBackup} from '../world/local-db.ts';
import {gunzipSync} from 'node:zlib';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {cardAppearance,MAILBOX_PALETTES} from '../world/appearance.ts';
import {readMailboxTheme,readThemePreference,saveThemePreference} from '../world/theme.ts';
import {pageHtml} from '../world/page-view.ts';

const dirs:string[]=[];
async function dataDir(){const dir=await mkdtemp(join(tmpdir(),'bottle-theme-'));dirs.push(dir);return dir;}
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});

it('uses only extension-owned appearance, regardless of host file contents or layout',async()=>{
  const dir=await dataDir();
  const hostConfig=JSON.stringify({web:{theme:'private-host-theme'},worlds:{'desktop-pet':{user:'private-name'}}});
  const hostTheme=JSON.stringify({selectedId:'private-custom-theme',mode:'dark',custom:[{note:'private-note'}]});
  await writeFile(join(dir,'config.json'),hostConfig);
  await writeFile(join(dir,'theme.json'),hostTheme);
  expect(await readMailboxTheme(dir)).toEqual({available:true,preference:undefined,hostTheme:null});
  saveThemePreference(dir,{theme:'paper',mode:'light'});
  expect(await readMailboxTheme(dir)).toEqual({available:true,preference:{theme:'paper',mode:'light'},hostTheme:null});
  expect(await readFile(join(dir,'config.json'),'utf8')).toBe(hostConfig);
  expect(await readFile(join(dir,'theme.json'),'utf8')).toBe(hostTheme);
  await writeFile(join(dir,'config.json'),'{invalid');
  await writeFile(join(dir,'theme.json'),'{invalid');
  expect(await readMailboxTheme(dir)).toEqual({available:true,preference:{theme:'paper',mode:'light'},hostTheme:null});
});

it('migrates the retired host theme choice while preserving the background, font, mode and custom color',async()=>{
  const dir=await dataDir();
  const old={theme:'coopanion',mode:'dark',customColor:'#abcdef',background:'a'.repeat(64)+'.png',backgroundTransparency:42,
    myFont:'b'.repeat(64)+'.woff2',myFontName:'自己的字体'};
  const file=join(dir,'bottle-appearance.json');
  const raw=JSON.stringify(old);await writeFile(file,raw);
  expect(readThemePreference(dir)).toEqual({...old,theme:'ocean'});
  expect(JSON.parse(gunzipSync(readLocalBackup(dir,localBackups(dir)[0].id)).toString()).files.some((f:any)=>Buffer.from(f.data,'base64').toString()===raw)).toBe(true); // Original bytes remain in the migration backup.
  saveThemePreference(dir,{theme:'coopanion',mode:'dark'});
  expect(readThemePreference(dir)).toEqual({...old,theme:'ocean'});
  expect(sqlRead(file).theme).toBe('ocean');
});

it('exposes only validated own preference fields and falls back safely for damaged data',async()=>{
  const dir=await dataDir();
  await writeFile(join(dir,'bottle-appearance.json'),JSON.stringify({theme:'paper',mode:'dark',privateToken:'never-return'}));
  expect(JSON.stringify(await readMailboxTheme(dir))).not.toContain('never-return');
  sqlWrite(join(dir,'bottle-appearance.json'),{invalid:true});
  expect(readThemePreference(dir)).toBeUndefined();
  expect(await readMailboxTheme(dir)).toEqual({available:true,preference:undefined,hostTheme:null});
});

it('escapes embedded appearance metadata as JSON, never executable HTML',()=>{
  const name='</script><script>bad()</script>';
  const html=pageHtml({available:true,preference:{theme:'ocean',mode:'light',myFontName:name}});
  expect(html).not.toContain('<script>bad()');
  const embedded=html.match(/id="mailbox-appearance">([\s\S]*?)<\/script>/)![1];
  expect(JSON.parse(embedded).preference.myFontName).toBe(name);
});

it('persists own preferences and rejects unsupported values without overwriting a valid choice',async()=>{
  const dir=await dataDir();
  saveThemePreference(dir,{theme:'paper',mode:'dark'});
  expect(readThemePreference(dir)).toEqual({theme:'paper',mode:'dark'});
  expect(()=>saveThemePreference(dir,{theme:'invalid',mode:'dark'} as any)).toThrow();
  expect(readThemePreference(dir)).toEqual({theme:'paper',mode:'dark'});
});

it('uses the same Bottle-owned palettes for native cards and the mailbox',()=>{
  for(const theme of ['ocean','paper','epistle'] as const){
    const appearance=cardAppearance({theme,mode:'system'});
    expect(appearance.palettes).toEqual(MAILBOX_PALETTES[theme]);
    for(const palette of Object.values(appearance.palettes))
      for(const value of Object.values(palette))expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  }
  const legacy=cardAppearance({theme:'coopanion',mode:'dark'});
  expect(legacy.preference).toEqual({theme:'ocean',mode:'dark'});
  expect(legacy.palettes).toEqual(MAILBOX_PALETTES.ocean);
});
