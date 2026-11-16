/** Only explicit user additions differ from the shipped, fixed digest manifest. */
import {readFileSync,lstatSync,mkdirSync,writeFileSync,unlinkSync,readdirSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {soundLibrary,cardSound,type SoundConfig,type SoundKind,type CardSound} from './sound.ts';
import {loadDoodles,doodleAsset,type DoodleSummary} from './stationery.ts';
import {sanitizeSvg,recolorSvg} from '../shared/stationery.ts';
import {digest,putAsset,getAsset,listAssets,localTransaction,writeDocumentTo,withDatabase} from './local-db.ts';
const manifest=JSON.parse(readFileSync(new URL('./builtin-assets.json',import.meta.url),'utf8'));
const soundRoot=fileURLToPath(new URL('./sounds/',import.meta.url));
const audioMime:Record<string,string>={wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',aac:'audio/aac',flac:'audio/flac'};
export function collectUserAssets(dir:string,config:SoundConfig):void{
  localTransaction(dir,()=>{
    for(const sound of soundLibrary()){
      const path=resolve(soundRoot,sound.id);if(lstatSync(path).isSymbolicLink())continue;const bytes=readFileSync(path);if(manifest.sounds[sound.id]===digest(bytes))continue;
      const ext=sound.id.split('.').at(-1)!.toLowerCase(),id=digest(bytes)+'.'+ext;putAsset(dir,{kind:'sound',id,name:sound.id.split('/').at(-1)!,mime:audioMime[ext],bytes,metadata:{slot:sound.kind}});
    }
    for(const kind of ['incoming','reply'] as const){
      const prefix=kind==='incoming'?'Incoming':'Reply',path=config[`sound${prefix}File`];if(config[`sound${prefix}Source`]!=='local'||typeof path!=='string'||!isAbsolute(path))continue;
      try{const stat=lstatSync(path),ext=path.split('.').at(-1)!.toLowerCase();if(stat.isSymbolicLink()||!stat.isFile()||stat.size>10*1024*1024||!audioMime[ext])continue;const bytes=readFileSync(path);putAsset(dir,{kind:'sound',id:digest(bytes)+'.'+ext,name:path.split(/[\\/]/).at(-1)!.slice(0,120),mime:audioMime[ext],bytes,metadata:{slot:kind,device:'desktop'}});}catch{/* Missing configured files are not fabricated. */}
    }
    for(const d of loadDoodles()){
      const bytes=Buffer.from(d.svg);if(manifest.doodles[d.id]===digest(readFileSync(new URL('./stationery/'+d.file,import.meta.url))))continue;
      putAsset(dir,{kind:'doodle',id:d.id,name:d.name,mime:'image/svg+xml',bytes,metadata:{tags:d.tags}});
    }
  });
}
export function storedDoodles(dir:string):DoodleSummary[]{return listAssets(dir,'doodle').map(a=>({id:a.id,name:a.name,tags:Array.isArray(a.metadata.tags)?a.metadata.tags as string[]:[]}));}
export function storedDoodle(dir:string,id:string,color?:string):{bytes:Buffer;mime:string}|null{
  const a=getAsset(dir,'doodle',id);if(a){const svg=color?recolorSvg(a.bytes.toString(),color):sanitizeSvg(a.bytes.toString());return svg.ok?{bytes:Buffer.from(svg.svg),mime:'image/svg+xml'}:null;}return doodleAsset(id,undefined,color);
}
export function storedSound(dir:string,id:string):{bytes:Buffer;mime:string}|null{const a=getAsset(dir,'sound',id.replace(/^saved\//,''));return a?{bytes:a.bytes,mime:a.mime}:null;}
export function storedSoundList(dir:string):Array<{id:string;label:string;kind:'incoming'|'reply'|'shared'}>{return withDatabase(dir,db=>(db.prepare("SELECT id,name,metadata FROM local_assets WHERE kind='sound'").all() as any[]).map(a=>({id:'saved/'+a.id,label:a.name,kind:['incoming','reply'].includes(JSON.parse(a.metadata).slot)?JSON.parse(a.metadata).slot:'shared'})));}
export function nativeSavedSound(dir:string,config:SoundConfig,kind:SoundKind):CardSound|null{
  const prefix=kind==='incoming'?'Incoming':'Reply';if(config.soundEnabled===false)return null;
  const choice=config[`sound${prefix}Pack`],asset=typeof choice==='string'&&choice.startsWith('saved/')?getAsset(dir,'sound',choice.slice(6)):null;
  if(config[`sound${prefix}Source`]==='pack'&&asset){const folder=join(dir,'bottle-runtime-audio');mkdirSync(folder,{recursive:true});const path=join(folder,asset.id);if(!/^[a-f0-9]{64}\.(wav|mp3|m4a|ogg|aac|flac)$/.test(asset.id))return null;writeFileSync(path,asset.bytes,{mode:0o600});return {path,volume:(config.soundVolume??70)/100,fadeOutMs:config.soundFadeOutMs??250};}
  return cardSound(config,kind);
}
export function clearRuntimeSounds(dir:string):void{const folder=join(dir,'bottle-runtime-audio');try{for(const name of readdirSync(folder))if(/^[a-f0-9]{64}\.(wav|mp3|m4a|ogg|aac|flac)$/.test(name))try{unlinkSync(join(folder,name));}catch{}}catch{}}
