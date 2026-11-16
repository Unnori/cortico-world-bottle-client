/** Real Windows renderer; synthetic requests, off-screen windows, no desktop pet. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {draftLetterCard} from '../world/cards.ts';
import {cardAppearance,DEFAULT_APPEARANCE} from '../world/appearance.ts';

if(process.platform!=='win32')throw Error('This validation requires Windows WPF.');
const dir=mkdtempSync(join(tmpdir(),'bottle-card-action-'));
const requests:Array<{mode:string;body:any}>=[];
const server=createServer((req,res)=>{
  let body='';req.setEncoding('utf8');req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
    const [mode,path]=(req.url??'').slice(1).split('/');
    if(path!=='send'){res.writeHead(404);res.end();return;}
    requests.push({mode,body:JSON.parse(body)});
    setTimeout(()=>{
      if(mode==='transport'){res.writeHead(503);res.end('Synthetic upstream unavailable');return;}
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify(mode==='success'?{ok:true,close:true,message:'Fixture sent'}:
        {ok:false,message:mode==='unknown'?'Fixture delivery pending':'Fixture send failed'}));
    },1200);
  });
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const port=(server.address() as {port:number}).port;
const command=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const children:ReturnType<typeof spawn>[]=[];
try{
  const results=await Promise.all(['failure','unknown','transport','success','idle','fade'].map(async mode=>{
    const base=`http://127.0.0.1:${port}/${mode}`;
    const data=join(dir,mode+'.json'),report=join(dir,mode+'-report.json');
    const draft={kind:'letter' as const,body:'Synthetic native fixture.',at:Date.now(),draftId:'native-'+mode,revision:1,sendPolicy:'manual' as const};
    writeFileSync(data,JSON.stringify({...draftLetterCard({base,draft,chars:draft.body.length,hints:[]}),appearance:cardAppearance(DEFAULT_APPEARANCE)}));
    const args=['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./card-action-native.ps1',import.meta.url)),
      '-Renderer',fileURLToPath(new URL('../world/card-host.ps1',import.meta.url)),'-Data',data,'-Base',base,'-Report',report];
    if(mode==='idle')args.push('-Idle');
    if(mode==='fade')args.push('-ActionAtMs','1040');
    const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
    let stderr='',stdout='';child.stderr!.on('data',chunk=>stderr+=chunk);child.stdout!.on('data',chunk=>stdout+=chunk);
    let timeout:ReturnType<typeof setTimeout>;
    const code=await Promise.race([
      new Promise<number|null>((done,reject)=>{child.once('exit',done);child.once('error',reject);}),
      new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{child.kill();reject(Error(mode+' fixture timed out: '+stderr));},20000);}),
    ]).finally(()=>clearTimeout(timeout));
    assert.equal(code,0,mode+': '+stderr+stdout);
    const result=JSON.parse(readFileSync(report,'utf8'));
    if(mode==='success'||mode==='idle')assert.equal(result.visible,false,mode+' must close: '+JSON.stringify({result,requests}));
    else {
      assert.equal(result.visible,true,mode+' must remain visible past its original deadline');
      assert.equal(result.statusVisible,true);assert.equal(result.busy,false);assert.equal(result.buttonsEnabled,true);
      assert.equal(result.closeTimerEnabled,false);assert.equal(result.lateTimerEnabled,false);
      assert.equal(result.closedAtMs,null);
      assert.ok(mode==='transport'?result.status.includes('未收到寄送结果'):result.status.includes(mode==='unknown'?'pending':'failed'));
    }
    return {mode,...result};
  }));
  assert.equal(requests.length,5,'No background resend or action from an untouched card');
  for(const {mode,body} of requests)assert.deepEqual(body,{draftId:'native-'+mode,revision:1,kind:'letter'});
  console.log(JSON.stringify({nativeHost:true,offScreen:true,results}));
}finally{
  for(const child of children)if(child.exitCode===null)child.kill();
  server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
  assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'bottle-card-action-'));
  rmSync(dir,{recursive:true,force:true});
}
