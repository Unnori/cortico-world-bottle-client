import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
const origin='https://fontsforletters.sqnori.com';
const catalog=JSON.parse(readFileSync(join(root,'world/fonts/catalog.json'),'utf8'));
if(catalog.schemaVersion!==1||catalog.baseUrl!==origin+'/'||!Array.isArray(catalog.fonts)||!catalog.fonts.length)throw Error('Missing remote font catalog');
const names=new Set(),ids=new Set();
for(const font of catalog.fonts){
  const id=typeof font.name==='string'?createHash('sha256').update(font.name).digest('hex'):'';
  if(!font.name||/[/\\]/.test(font.name)||names.has(font.name)||font.id!==id||ids.has(id)||font.license!=='OFL-1.1'||typeof font.enabled!=='boolean'||!/^[a-f0-9]{64}$/.test(font.sha256)||font.url!==origin+'/fonts/'+font.sha256+'.woff2'||!Number.isSafeInteger(font.bytes)||font.bytes<48||font.bytes>33554432||typeof font.notice!=='string'||!/^licenses\/[a-f0-9]{64}\.txt$/.test(font.notice)||font.licenseUrl!==origin+'/'+font.notice)throw Error('Invalid remote font record');
  names.add(font.name);ids.add(id);
}
if(!ids.has(catalog.defaultFontId)||!catalog.fonts.some(font=>font.enabled))throw Error('Invalid remote font default');
function inspect(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isSymbolicLink())throw Error('Symlink inside package: '+relative(root,path));
    if(entry.isDirectory()){
      if(['font-library','restricted','unverified','originals','redistributable','__pycache__'].includes(entry.name)&&readdirSync(path).length)throw Error('Archived folder inside package: '+relative(root,path));
      inspect(path);
    }else if(/\.(ttf|otf|woff2?|tgz|zip|pyc|log)$/i.test(entry.name))throw Error('Unnecessary binary/artifact inside package: '+relative(root,path));
  }
}
for(const folder of ['world','dist','shared'])if(existsSync(join(root,folder)))inspect(join(root,folder));
console.log('Font package check passed: '+ids.size+' remote metadata entries, zero bundled font binaries.');
