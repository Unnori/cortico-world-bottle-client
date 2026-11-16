/** Isolated Windows WPF validation: no focus, sound, real mailbox or model. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {waitingCard} from '../world/cards.ts';
import {cardAppearance,DEFAULT_APPEARANCE} from '../world/appearance.ts';

if(process.platform!=='win32')throw new Error('This isolated validation requires Windows WPF');
const dir=mkdtempSync(join(tmpdir(),'bottle-card-native-'));
const data=join(dir,'cards.json'),report=join(dir,'report.json');
const appearance=cardAppearance(DEFAULT_APPEARANCE);
function card(key:string,revision:number,body:string){
  return {...waitingCard('http://127.0.0.1:1','Fixture','reply',key),revision,body,appearance,autoCloseMs:0,sound:null};
}
function save(cards:unknown[]){writeFileSync(data+'.tmp',JSON.stringify({version:2,cards}));renameSync(data+'.tmp',data);}
save([card('old',1,'Older card')]);
const command=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const child=spawn(command,['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',
  fileURLToPath(new URL('../world/card-stack-host.ps1',import.meta.url)),
  '-Data',data,'-Base','http://127.0.0.1:1','-PreviewOnly','-Report',report,'-ExitAfterMs','8000'],
  {windowsHide:true,stdio:['ignore','pipe','pipe']});
let stderr='',stdout='';child.stderr.on('data',chunk=>stderr+=chunk);child.stdout.on('data',chunk=>stdout+=chunk);
const messages:any[]=[];
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{try{messages.push(JSON.parse(line));}catch{}});
const exited=new Promise<number|null>((done,reject)=>{child.once('exit',done);child.once('error',reject);});
async function until(check:()=>boolean){
  for(let i=0;i<200;i++){
    if(check())return;
    if(child.exitCode!==null)throw new Error('Native fixture exited: '+stderr+stdout);
    await new Promise(done=>setTimeout(done,25));
  }
  throw new Error('Native state did not settle: '+JSON.stringify(messages)+stderr);
}
const layout=()=>messages.filter(row=>row.type==='layout').at(-1)?.cards??[];
try{
  await until(()=>layout()[0]?.revision===1);
  save([card('old',1,'Older card'),card('new',2,'Newer card')]);
  await until(()=>layout().length===2);
  save([card('old',3,'Older card updated'),card('new',2,'Newer card')]);
  await until(()=>layout()[0]?.revision===3);
  assert.ok(layout()[0].top<layout()[1].top,'Older update must stay above the newer card');
  const expiring={...card('old',4,'Closing only this card'),autoCloseMs:400};
  save([expiring,card('new',2,'Newer card')]);
  await until(()=>messages.some(row=>row.type==='closed'&&row.key==='held:old'&&row.revision===4));
  // An unrelated snapshot before Node processes the close ack must not resurrect it.
  save([expiring,card('new',2,'Newer card'),card('third',5,'Newest card')]);
  await until(()=>layout().length===2&&layout()[1].key==='held:third');
  save([card('new',2,'Newer card'),card('third',5,'Newest card')]);
  const code=await Promise.race([exited,new Promise<never>((_,reject)=>{
    setTimeout(()=>{child.kill();reject(new Error('Native fixture exceeded 15 seconds'));},15000).unref();
  })]);
  assert.equal(code,0,stderr||stdout);
  const rows=JSON.parse(readFileSync(report,'utf8'));
  assert.deepEqual(rows.map((row:any)=>[row.key,row.revision]),[['held:new',2],['held:third',5]]);
  assert.ok(rows.every((row:any)=>row.height>0));
  assert.ok(rows[0].top<rows[1].top,'Older card must stay above the newest');
  assert.equal(messages.filter(row=>row.type==='closed').length,1);
  console.log(JSON.stringify({nativeHost:true,offScreen:true,updatedInPlace:true,closeIsolated:true,noResurrection:true,rows}));
}finally{
  lines.close();child.kill();
  assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'bottle-card-native-'));
  rmSync(dir,{recursive:true,force:true});
}
