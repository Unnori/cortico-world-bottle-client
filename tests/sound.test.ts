import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { soundLibrary, soundOptions, packSound, cardSound, DEFAULT_SOUND_PACK } from '../world/sound.ts';
import { BOTTLE } from '../world/definition.ts';
import { LocalStore, readingCount } from '../world/store.ts';
import { handlePage, type PageDeps } from '../world/page.ts';
let dir='';afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});dir='';});
it('ships distinct playable PCM sound packs and rejects arbitrary pack paths',()=>{
  const list=soundLibrary();expect(list.map(item=>item.id)).toEqual(expect.arrayContaining(Object.values(DEFAULT_SOUND_PACK)));
  const incoming=packSound(DEFAULT_SOUND_PACK.incoming)!,reply=packSound(DEFAULT_SOUND_PACK.reply)!;
  expect(Buffer.from(incoming.bytes).subarray(0,4).toString()).toBe('RIFF');expect(incoming.mime).toBe('audio/wav');
  expect(Buffer.compare(Buffer.from(incoming.bytes),Buffer.from(reply.bytes))).not.toBe(0);
  for(const id of ['../icon.png','incoming/../../config.ts','C:\\secret.wav','incoming/no.wav'])expect(packSound(id)).toBeNull();
});
it('only lists actual audio files inside the pack, allowing empty folders',()=>{
  dir=mkdtempSync(join(tmpdir(),'bottle-sound-'));expect(soundLibrary(dir)).toEqual([]);
  mkdirSync(join(dir,'incoming'));writeFileSync(join(dir,'incoming','custom.MP3'),'fixture');
  writeFileSync(join(dir,'incoming','notes.txt'),'not audio');mkdirSync(join(dir,'incoming','directory.wav'));
  expect(soundLibrary(dir)).toEqual([{id:'incoming/custom.MP3',label:'custom',kind:'incoming'}]);
});
it('supports local sources, per-kind silence, global disable and clamped levels',()=>{
  const incoming=cardSound({},'incoming')!;expect(incoming).toMatchObject({volume:0.7,fadeOutMs:250});
  expect(cardSound({soundEnabled:false},'reply')).toBeNull();expect(cardSound({soundIncomingSource:'off'},'incoming')).toBeNull();
  expect(cardSound({soundVolume:120,soundFadeOutMs:-3},'reply')).toMatchObject({volume:1,fadeOutMs:0});
  expect(cardSound({soundVolume:NaN,soundFadeOutMs:Infinity},'incoming')).toMatchObject({volume:0.7,fadeOutMs:250});
  expect(cardSound({soundIncomingSource:'local',soundIncomingFile:'relative.wav'},'incoming')).toBeNull();
  expect(cardSound({soundIncomingSource:'local',soundIncomingFile:incoming.path},'incoming')?.path).toBe(incoming.path);
  expect(cardSound({soundIncomingPack:'../../icon.png'},'incoming')).toBeNull();
});
it('serves only pack audio to browsers, never desktop local paths',async()=>{
  const deps={} as PageDeps;
  expect((await handlePage(deps,'GET','/sounds')).json).toEqual({files:soundLibrary()});
  const asset=await handlePage(deps,'GET','/sounds/'+encodeURIComponent(DEFAULT_SOUND_PACK.incoming));expect(asset.status).toBe(200);expect(asset.binary?.mime).toBe('audio/wav');
  expect((await handlePage(deps,'GET','/sounds/..%2Fconfig.ts')).status).toBe(404);
  expect((await handlePage(deps,'GET','/sounds/%broken')).status).toBe(400);
});
it('normalizes legacy or malformed counts and persists separate record counters',()=>{
  for(const value of [undefined,null,'1',-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(readingCount(value)).toBe(0);
  dir=mkdtempSync(join(tmpdir(),'bottle-read-'));const store=new LocalStore(dir);store.load();
  store.addReceived({letterId:'caught',from:'海边',body:'信',at:1,outcome:'caught',readCount:-3});
  store.addSent(Object.assign({letterId:'sent',body:'寄出',at:1},{readCount:7}));store.addReply({letterId:'sent',body:'回信',from:'灯塔',at:2});
  store.noteRead('received','caught');store.noteRead('reply','sent');store.noteRead('reply','sent');
  const next=new LocalStore(dir);next.load();expect(next.received[0]?.readCount).toBe(1);expect(next.replies[0]?.readCount).toBe(2);expect(next.sent[0]).not.toHaveProperty('readCount');
});
it.skipIf(process.platform!=='win32')('parses both native scripts and verifies fade math without launching a window or audio',()=>{
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`
    $ErrorActionPreference='Stop'
    foreach($file in @('world/card-host.ps1','world/card-sound.ps1')) {
      $tokens=$null; $errors=$null
      [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file),[ref]$tokens,[ref]$errors)
      if($errors.Count -gt 0){throw ($errors | Out-String)}
    }
    . './world/card-sound.ps1'
    @( (Get-BottleSoundVolume 0.8 0 1000 250), (Get-BottleSoundVolume 0.8 875 1000 250), (Get-BottleSoundVolume 0.8 1000 1000 250), (Get-BottleSoundVolume 2 900 1000 0) ) | ConvertTo-Json -Compress
  `],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout.trim())).toEqual([0.8,0.4,0,1]);
});

it('isolates each category and shares only root-level files, without recursive scanning',()=>{
  dir=mkdtempSync(join(tmpdir(),'bottle-sound-scope-'));mkdirSync(join(dir,'incoming'));mkdirSync(join(dir,'reply'));
  for(const file of ['shared.wav','incoming/only-in.wav','reply/only-reply.wav'])writeFileSync(join(dir,file),'audio fixture');
  mkdirSync(join(dir,'incoming','nested'));writeFileSync(join(dir,'incoming','nested','hidden.wav'),'nested');
  mkdirSync(join(dir,'other'));writeFileSync(join(dir,'other','hidden.wav'),'unclassified');
  const files=soundLibrary(dir);
  expect(files).toHaveLength(3);
  expect(soundOptions('incoming',files).map(file=>file.id)).toEqual(['incoming/only-in.wav','shared.wav']);
  expect(soundOptions('reply',files).map(file=>file.id)).toEqual(['reply/only-reply.wav','shared.wav']);
  expect(files.find(file=>file.id==='shared.wav')?.kind).toBe('shared');
});
it('uses the new defaults, supports old built-in choices, and never mixes desktop pack categories',()=>{
  expect(cardSound({},'incoming')?.path.replaceAll('\\','/')).toContain(DEFAULT_SOUND_PACK.incoming);
  expect(cardSound({},'reply')?.path.replaceAll('\\','/')).toContain(DEFAULT_SOUND_PACK.reply);
  expect(cardSound({soundIncomingPack:'incoming/default.wav'},'incoming')).toEqual(cardSound({},'incoming'));
  expect(cardSound({soundReplyPack:'reply/default.wav'},'reply')).toEqual(cardSound({},'reply'));
  expect(cardSound({soundIncomingPack:DEFAULT_SOUND_PACK.reply},'incoming')).toBeNull();
  expect(cardSound({soundReplyPack:DEFAULT_SOUND_PACK.incoming},'reply')).toBeNull();
});

it('framework dynamic menus follow the same directory rules as the mailbox',async()=>{
  for(const kind of ['incoming','reply'] as const){
    const choices=await BOTTLE.configOptions!('bottle-sound-'+kind, 'zh');
    expect(choices).toEqual(soundOptions(kind).map(file=>({value:file.id,label:(file.kind==='shared'?'通用 · ':'')+file.label})));
    expect(choices.some(choice=>choice.value===DEFAULT_SOUND_PACK[kind])).toBe(true);
    const other=kind==='incoming'?'reply/':'incoming/';
    expect(choices.some(choice=>choice.value.startsWith(other))).toBe(false);
  }
  expect(await BOTTLE.configOptions!('bottle-sound-unknown', 'zh')).toEqual([]);
});
