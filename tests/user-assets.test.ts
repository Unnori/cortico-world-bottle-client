import {afterEach,expect,it} from 'vitest';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {putAsset,listAssets,digest} from '../world/local-db.ts';
import {collectUserAssets,nativeSavedSound,clearRuntimeSounds} from '../world/user-assets.ts';
let h:Harness;afterEach(async()=>{await h?.stop();});
it('collects only user-selected native files and never copies built-in sounds or SVGs into SQL',()=>{
  h=makeHarness({port:0});const path=join(h.dir,'my.wav'),bytes=Buffer.from('RIFF0000WAVEown');writeFileSync(path,bytes);
  collectUserAssets(h.dir,{soundIncomingSource:'local',soundIncomingFile:path});
  expect(listAssets(h.dir,'sound')).toHaveLength(1);expect(listAssets(h.dir,'doodle')).toEqual([]);expect(readFileSync(path)).toEqual(bytes);
  const id=digest(bytes)+'.wav',sound=nativeSavedSound(h.dir,{soundIncomingSource:'pack',soundIncomingPack:'saved/'+id},'incoming')!;
  expect(readFileSync(sound.path)).toEqual(bytes);clearRuntimeSounds(h.dir);expect(existsSync(sound.path)).toBe(false);expect(listAssets(h.dir,'sound')[0].bytes).toEqual(bytes);
});
it('a restored custom doodle is queryable and gets a stable chosen color embedded for remote compatibility',async()=>{
  h=makeHarness({port:0,config:{randomWake:false}});await h.world.start(new FakeHost());
  const bytes=Buffer.from('<svg viewBox="0 0 10 10"><circle fill="#000000" cx="5" cy="5" r="2"/></svg>');
  putAsset(h.dir,{kind:'doodle',id:'my-custom-wave',name:'我的浪花',mime:'image/svg+xml',bytes,metadata:{tags:['wave']}});
  expect(await callTool(h.world,'bottle_query_doodles')).toContain('my-custom-wave');
  await callTool(h.world,'bottle_write',{text:'把这朵浪花寄出去。',stationery:{v:1,doodle:'my-custom-wave'}});
  const art=Reflect.get(h.world,'store').letterDraft.stationery;expect(art.v).toBe(2);expect(art.decorations[0].doodle).toBeUndefined();expect(art.decorations[0].customSvg).toContain(art.decorations[0].color);expect(art.decorations[0].color).toMatch(/^#[a-f0-9]{6}$/i);
});
