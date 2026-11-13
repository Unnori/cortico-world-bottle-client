import {afterEach,expect,it} from 'vitest';
import {request as httpRequest} from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {makeHarness,callTool,type Harness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {BOTTLE_DEFAULTS} from '../world/config.ts';

let h:Harness,host:FakeHost,url:string,agent:string,controller:string;
const store=()=>Reflect.get(h.world,'store');
const call=(name:string,args:Record<string,unknown>={})=>callTool(h.world,name,args);
const ref=(d:any)=>({draftId:d.draftId,revision:d.revision});
afterEach(async()=>{await h?.stop();});
async function setup(enabled=true){
  h=makeHarness({port:0,config:{bridgeEnabled:true,bridgeControllerEnabled:enabled}});
  host=new FakeHost();await h.world.start(host);url=Reflect.get(h.world,'page').url;
  const deps=h.world.pageDeps().bridge!;agent=deps.token();controller=deps.controllerToken();
}
async function request(route:string,body?:unknown,key=controller){
  return await new Promise<{status:number;body:any}>((resolve,reject)=>{
    const req=httpRequest(url+'api/v1/'+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'}},res=>{
      let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(text)}));
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
const action=(name:string,body:Record<string,unknown>)=>request('controller/'+name,{source:'TestController',...body});
async function stage(){await request('drafts',{source:'PaperBoat',body:'等人审阅的正文',topic:'仅单稿预览'},agent);return ref(store().letterDraft);}

it('keeps Controller default off and requires restart after first enabling',async()=>{
  expect(BOTTLE_DEFAULTS.bridgeControllerEnabled).toBe(false);await setup(false);
  expect((await request('controller/status',undefined,agent)).status).toBe(404);
  h.cfg.bridgeControllerEnabled=true;
  expect((await request('controller/status',undefined,agent)).status).toBe(404);
  await h.world.stop();await h.world.start(host);url=Reflect.get(h.world,'page').url;controller=h.world.pageDeps().bridge!.controllerToken();
  expect((await request('controller/status')).status).toBe(200);
});

it('separates the two credentials and never publishes either in discovery or status',async()=>{
  await setup();expect(controller.length).toBeGreaterThanOrEqual(32);expect(controller).not.toBe(agent);
  expect((await request('controller/status',undefined,agent)).status).toBe(401);
  expect((await request('status',undefined,controller)).status).toBe(401);
  for(const doc of [readFileSync(join(h.dir,'bottle-bridge.json'),'utf8'),JSON.stringify((await request('status',undefined,agent)).body),JSON.stringify((await request('controller/status')).body)]){
    expect(doc).not.toContain(controller);expect(doc).not.toContain(agent);
  }
});

it('previews exactly one draft and sends only its reviewed current version',async()=>{
  await setup();const old=await stage();
  expect(JSON.stringify((await request('controller/status')).body)).not.toContain('等人审阅的正文');
  expect((await request('controller/drafts/'+old.draftId)).body.draft).toMatchObject({...old,body:'等人审阅的正文'});
  expect((await action('send',{...old,body:'偷换正文'})).status).toBe(400);
  await request('drafts',{source:'PaperBoat',body:'新版本正文',replace:old},agent);
  expect((await action('send',old)).status).toBe(409);expect(h.db.letters).toHaveLength(0);
  expect((await action('send',ref(store().letterDraft))).status).toBe(200);
  expect(h.db.letters.filter(r=>r.body==='新版本正文')).toHaveLength(1);
});

it('requests a manual reply with headless off, then accepts a separate exact send confirmation',async()=>{
  await setup();h.throwAs('peer','原信正文');await request('catch',{source:'PaperBoat'},agent);
  const letterId=store().held.letterId;
  expect((await action('reply',{letterId:'wrong'})).status).toBe(409);
  expect((await action('reply',{letterId})).status).toBe(200);
  const event=host.last('bottle.reading')!;expect(event.origin).toBe('external');
  expect(event.text).toContain('TestController');expect(event.text).not.toContain('人类点了');
  await call('bottle_reply',{text:'只保存的回信'});
  expect(store().draft).toMatchObject({sendPolicy:'manual',letterId});expect(store().draft.autoSendKey).toBeUndefined();
  expect(h.db.letterById(letterId)?.replyDraftKey).toBeUndefined();expect(h.db.replies).toHaveLength(0);
  h.world.onTurnEnded();
  expect((await action('send',ref(store().draft))).status).toBe(200);
  expect(h.db.replies).toHaveLength(1);
});

it('together remains read-only for held and archived letters and uses truthful external events',async()=>{
  await setup();h.throwAs('peer','共读原信');await request('catch',{source:'PaperBoat'},agent);
  const letterId=store().held.letterId;
  expect((await action('together',{letterId})).status).toBe(200);
  expect(await call('bottle_reply',{text:'不能趁机回信'})).toContain('不能回');
  h.world.onEventsSettled([host.last('bottle.reading')!],'delivered');h.world.onTurnEnded();
  expect((await action('keep',{letterId})).status).toBe(200);
  expect((await action('together',{letterId})).status).toBe(200);
  const event=host.last('bottle.peruse')!;expect(event.origin).toBe('external');expect(event.text).toContain('TestController');
  expect(await call('bottle_reply',{text:'仍不能回'})).toContain('不能回');
});

it('rewrites through the model and rejects stale discard confirmations',async()=>{
  await setup();const old=await stage();
  expect((await action('rewrite',old)).status).toBe(200);
  expect(host.last('bottle.rewrite')?.origin).toBe('external');
  await call('bottle_write',{text:'桌宠的新稿'});
  expect(store().letterDraft.revision).toBe(2);
  expect((await action('discard',old)).status).toBe(409);
  expect((await action('discard',ref(store().letterDraft))).status).toBe(200);
  expect(store().letterDraft).toBeNull();
});

it('rechecks Controller switch and revision after waiting for automatic work',async()=>{
  await setup();const old=await stage();let finish!:()=>void;
  Reflect.set(h.world,'autoReplyWork',new Promise<void>(done=>{finish=done;}));
  const pending=action('send',old);
  // Start the request before revoking the role, without relying on a network timing delay.
  const queued=h.world.pageDeps().bridge!.controller('send',{source:'Controller',...old});
  h.cfg.bridgeControllerEnabled=false;Reflect.set(h.world,'autoReplyWork',null);finish();
  expect((await queued).status).toBeGreaterThanOrEqual(400);expect((await pending).status).toBeGreaterThanOrEqual(400);
  expect(h.db.letters).toHaveLength(0);
  expect((await request('status',undefined,agent)).status).toBe(200);
});

it('revokes pending model requests when Controller is disabled',async()=>{
  await setup();const old=await stage();await action('rewrite',old);h.cfg.bridgeControllerEnabled=false;
  expect(await call('bottle_write',{text:'不能执行的重写'})).toContain('授权已关闭');
  expect(store().letterDraft.revision).toBe(1);
  const deps=h.world.pageDeps().bridge!;expect((await deps.controller('status',{})).status).toBe(404);
});

it('shares the ordinary send lock with page confirmations',async()=>{
  await setup();const old=await stage();
  await Promise.all([h.world.pageDeps().bridge!.controller('send',{source:'Controller',...old}),h.world.pageDeps().send('letter',old)]);
  expect(h.db.letters).toHaveLength(1);
});
