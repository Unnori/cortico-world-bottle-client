import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { DEFAULT_SOUND_PACK, type SoundFile } from '../world/sound.ts';
import { pageSoundScript } from '../world/page-sound.ts';
const library:SoundFile[]=[{id:DEFAULT_SOUND_PACK.incoming,label:'New_notifications_1',kind:'incoming'},{id:DEFAULT_SOUND_PACK.reply,label:'New_notifications_3',kind:'reply'},{id:'shared.wav',label:'shared',kind:'shared'}];
function browser(hostname='192.168.1.8', storageWorks=true, preferences:Record<string,unknown>={}, files=library) {
  const nodes=new Map<string,any>(),storage=new Map<string,string>(),played:string[]=[],ramps:number[][]=[];
  let selected='';const window:any={addEventListener:vi.fn()};
  window.AudioContext=class {
    state='running';currentTime=0;destination={};resume(){return Promise.resolve();}close(){return Promise.resolve();}
    decodeAudioData(){return Promise.resolve({duration:1});}
    createBufferSource(){const source:any={connect(){},disconnect(){},start(){played.push(selected);queueMicrotask(()=>source.onended());},stop(){}};return source;}
    createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:(...args:number[])=>ramps.push(args)}};}
  };
  const node=(id:string)=>{if(!nodes.has(id))nodes.set(id,{value:'',children:[] as any[],appendChild(child:any){this.children.push(child);}});return nodes.get(id);};
  storage.set('bottle-device-sound',JSON.stringify({enabled:true,volume:30,fade:250,...preferences}));
  const fetch=async(url:string)=>{if(url!=='/sounds')selected=decodeURIComponent(url.slice(8));return {ok:true,json:async()=>({files}),arrayBuffer:async()=>new ArrayBuffer(4)};};
  const localStorage={getItem:(key:string)=>{if(!storageWorks)throw Error();return storage.get(key)??null;},setItem:(key:string,value:string)=>{if(!storageWorks)throw Error();storage.set(key,value);}};
  runInNewContext(pageSoundScript,{window,location:{hostname},document:{getElementById:node,createElement:()=>({}),addEventListener:vi.fn()},localStorage,fetch,queueMicrotask});
  return {window,node,played,ramps,storage};
}
const empty={received:[],sent:[],held:null};
it('does not replay old letters, distinguishes incoming/replies, and deduplicates poll results',async()=>{
  const b=browser();b.node('sound-unlock').onclick();
  b.window.bottleSound.snapshot({...empty,received:[{letterId:'old'}]});await Promise.resolve();expect(b.played).toEqual([]);
  b.window.bottleSound.snapshot({...empty,received:[{letterId:'old'},{letterId:'new'}],held:{letterId:'new'}});
  await vi.waitFor(()=>expect(b.played).toEqual([DEFAULT_SOUND_PACK.incoming]));
  b.window.bottleSound.snapshot({...empty,received:[{letterId:'old'},{letterId:'new'}],sent:[{letterId:'mine',reply:{body:'reply'}}]});
  await vi.waitFor(()=>expect(b.played).toEqual([DEFAULT_SOUND_PACK.incoming,DEFAULT_SOUND_PACK.reply]));
  b.window.bottleSound.snapshot({...empty,received:[{letterId:'new'}],sent:[{letterId:'mine',reply:{}}]});
  await new Promise(done=>setTimeout(done,10));expect(b.played).toHaveLength(2);expect(b.ramps).toEqual([[0,1],[0,1]]);
});
it('does not double-play alongside desktop cards, but does play on another device',async()=>{
  for(const [hostname,total] of [['127.0.0.1',0],['192.168.1.8',1]] as const){
    const b=browser(hostname);b.node('sound-unlock').onclick();await Promise.resolve();
    b.window.bottleSound.snapshot({...empty,desktopCards:true});
    b.window.bottleSound.snapshot({...empty,desktopCards:true,held:{letterId:'new'}});
    if(total)await vi.waitFor(()=>expect(b.played).toHaveLength(1));else{await new Promise(done=>setTimeout(done,10));expect(b.played).toHaveLength(0);}
  }
});
it('keeps in-memory deduplication when device storage is blocked',async()=>{
  const b=browser('phone.test',false);b.node('sound-unlock').onclick();await Promise.resolve();
  b.window.bottleSound.snapshot(empty);
  const snapshot={...empty,held:{letterId:'new'}};
  b.window.bottleSound.snapshot(snapshot);
  await vi.waitFor(()=>expect(b.played).toHaveLength(1));
  b.window.bottleSound.snapshot(snapshot);await new Promise(done=>setTimeout(done,10));expect(b.played).toHaveLength(1);
});
it('honors per-kind silence and saves the selected setting for this browser',async()=>{
  const b=browser();b.node('sound-unlock').onclick();await Promise.resolve();
  const select=b.node('sound-incoming');select.value='off';select.onchange();
  expect(JSON.parse(b.storage.get('bottle-device-sound')!).incoming).toBe('off');
  b.window.bottleSound.snapshot(empty);b.window.bottleSound.snapshot({...empty,held:{letterId:'new'}});
  await new Promise(done=>setTimeout(done,10));expect(b.played).toHaveLength(0);
});

it('keeps incoming and reply menus separate and lists root-level shared audio in both',async()=>{
  const b=browser();
  await vi.waitFor(()=>expect(b.node('sound-incoming').children).toHaveLength(4));
  expect(b.node('sound-incoming').children.map((option:any)=>option.value)).toEqual(['pack:'+DEFAULT_SOUND_PACK.incoming,'pack:shared.wav','local','off']);
  expect(b.node('sound-reply').children.map((option:any)=>option.value)).toEqual(['pack:'+DEFAULT_SOUND_PACK.reply,'pack:shared.wav','local','off']);
  expect(b.node('sound-incoming').children[1].textContent).toBe('通用 · shared');
  expect(b.node('sound-incoming').value).toBe('pack:'+DEFAULT_SOUND_PACK.incoming);
  expect(b.node('sound-reply').value).toBe('pack:'+DEFAULT_SOUND_PACK.reply);
});
it.each([
  {incoming:'pack:incoming/default.wav',reply:'pack:reply/default.wav'},
  {incoming:'pack:'+DEFAULT_SOUND_PACK.reply,reply:'pack:'+DEFAULT_SOUND_PACK.incoming},
  {incoming:'pack:incoming/deleted.wav',reply:'pack:reply/deleted.wav'},
])('repairs legacy, cross-directory or missing saved selections: %j',async preferences=>{
  const b=browser('phone.test',true,preferences);
  await vi.waitFor(()=>expect(JSON.parse(b.storage.get('bottle-device-sound')!).reply).toBe('pack:'+DEFAULT_SOUND_PACK.reply));
  const saved=JSON.parse(b.storage.get('bottle-device-sound')!);
  expect(saved.incoming).toBe('pack:'+DEFAULT_SOUND_PACK.incoming);
  expect(saved.volume).toBe(30);expect(saved.enabled).toBe(true);
});
it.each(['local','off','pack:shared.wav','pack:'+DEFAULT_SOUND_PACK.incoming])('preserves explicitly selected valid incoming sound %s',async incoming=>{
  const b=browser('phone.test',true,{incoming,reply:'off'});
  await vi.waitFor(()=>expect(b.node('sound-incoming').children).toHaveLength(4));
  const saved=JSON.parse(b.storage.get('bottle-device-sound')!);
  expect(saved.incoming).toBe(incoming);expect(saved.reply).toBe('off');
});
