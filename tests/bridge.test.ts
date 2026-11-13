import { afterEach, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { makeHarness, callTool, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';
import { BOTTLE_DEFAULTS } from '../world/config.ts';

let h: Harness;
let host: FakeHost;
afterEach(async()=>{await h?.stop();});
async function setup(config: Record<string,unknown> = {}) {
  h=makeHarness({port:0,config:{bridgeEnabled:true,...config}});
  host=new FakeHost();await h.world.start(host);
  const url=Reflect.get(h.world,'page').url as string;
  const token=h.world.pageDeps().bridge!.token();
  return {url,token,request:async(path:string,body?:unknown,extra:RequestInit={})=>{
    const res=await fetch(url+'api/v1/'+path,{method:body===undefined?'GET':'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),...extra});
    return {status:res.status,body:await res.json() as any};
  }};
}
const local = () => Reflect.get(h.world,'store');
const svg={v:1,customSvg:'<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2"/></svg>'};

it('is disabled by default and does not create a discovery file or expose an API',async()=>{
  expect(BOTTLE_DEFAULTS.bridgeEnabled).toBe(false);
  const rig=await setup({bridgeEnabled:false});
  expect(existsSync(join(h.dir,'bottle-bridge.json'))).toBe(false);
  expect((await rig.request('status')).status).toBe(404);
});

it('requires a dedicated Bearer credential; fixed page headers are not credentials',async()=>{
  const rig=await setup();
  for(const headers of [{'x-bottle':'1'},{authorization:'Bearer wrong'},{authorization:'Basic nope'}] as Array<Record<string,string>>)
    expect((await rig.request('status',undefined,{headers})).status).toBe(401);
  expect((await rig.request('status')).status).toBe(200);
  expect(rig.token.length).toBeGreaterThanOrEqual(32);
});

it('rejects browser origins and foreign Host headers without granting CORS',async()=>{
  const rig=await setup();
  for(const extra of [{origin:'https://other.example'},{host:'rebinding.example'},{'sec-fetch-site':'cross-site'}] as Array<Record<string,string>>) {
    const response=await new Promise<{status:number;cors:unknown}>(resolve=>{
      const req=httpRequest(rig.url+'api/v1/status',{headers:{authorization:'Bearer '+rig.token,...extra}},res=>{
        res.resume();res.on('end',()=>resolve({status:res.statusCode!,cors:res.headers['access-control-allow-origin']}));
      });req.end();
    });
    expect(response.status,JSON.stringify(extra)).toBe(403);expect(response.cors).toBeUndefined();
  }
});

it('discovers the actual shifted loopback port, never writes the credential there, and removes discovery on stop',async()=>{
  const occupied=createServer();await new Promise<void>(done=>occupied.listen(0,'127.0.0.1',done));
  try {
    const port=(occupied.address() as {port:number}).port;
    h=makeHarness({port,config:{bridgeEnabled:true}});await h.world.start(new FakeHost());
    const file=join(h.dir,'bottle-bridge.json'),text=readFileSync(file,'utf8'),doc=JSON.parse(text);
    expect(new URL(doc.baseUrl).port).not.toBe(String(port));
    expect(new URL(doc.baseUrl).port).not.toBe('7797');
    expect(doc.baseUrl).toBe(Reflect.get(h.world,'page').url+'api/v1');
    expect(text).not.toContain(h.world.pageDeps().bridge!.token());
    await h.world.stop();expect(existsSync(file)).toBe(false);
  } finally { await new Promise<void>(done=>occupied.close(()=>done())); }
});

it('stages a validated attributed letter without sending, authorizing headless, or waking the model',async()=>{
  const rig=await setup();
  const before=host.events.length;
  const response=await rig.request('drafts',{source:'PaperBoat',body:'字'.repeat(120),topic:'题'.repeat(20),stationery:svg});
  expect(response.status).toBe(201);expect(response.body.requiresHumanReview).toBe(true);
  expect(local().letterDraft).toMatchObject({body:'字'.repeat(120),source:{kind:'bridge',name:'PaperBoat'},revision:1,sendPolicy:'manual'});
  expect(h.db.letters).toHaveLength(0);expect(h.cfg.headlessEnabled).toBe(false);
  expect(host.events.slice(before).some(e=>e.type==='bottle.request'||e.type==='bottle.rewrite'||e.text?.includes('字字字'))).toBe(false);
  expect(JSON.stringify(response.body)).not.toContain('<svg');
  const status=await rig.request('status');
  expect(status.body.drafts[0].draftId).toBe(local().letterDraft.draftId);
  for(const privateText of ['字字字','题题题','<svg','localFile','token','sent','received'])expect(JSON.stringify(status.body)).not.toContain(privateText);
});

it('conflicts on an existing draft and replaces only a specified current revision',async()=>{
  const rig=await setup();
  await rig.request('drafts',{source:'PaperBoat',body:'第一稿'});
  const old={draftId:local().letterDraft.draftId,revision:local().letterDraft.revision};
  expect((await rig.request('drafts',{source:'PaperBoat',body:'不能盲替换'})).status).toBe(409);
  expect((await rig.request('drafts',{source:'PaperBoat',body:'错版本',replace:{...old,revision:999}})).status).toBe(409);
  expect((await rig.request('drafts',{source:'PaperBoat',body:'第二稿',replace:old})).status).toBe(201);
  expect(local().letterDraft).toMatchObject({draftId:old.draftId,revision:2,body:'第二稿'});
  expect((await h.world.pageDeps().send('letter',old)).ok).toBe(false);
  expect(h.db.letters).toHaveLength(0);
});

it.each([
  {body:'x'.repeat(121)}, {body:'合法',topic:'a\nb'},
  {body:'合法',stationery:{v:1,customSvg:'<svg viewBox="0 0 1 1"><script/></svg>'}},
  {body:'合法',headlessEnabled:true}, {body:'合法',autoSendKey:'invented'},
  {body:'合法',kind:'reply'}, {body:'合法',source:'\n'},
])('rejects invalid draft input without creating state: %j',async(input)=>{
  const rig=await setup();
  expect((await rig.request('drafts',{source:'PaperBoat',...input})).status).toBe(400);
  expect(local().letterDraft).toBeNull();expect(h.cfg.headlessEnabled).toBe(false);
});

it('does not expose send/read/config or full snapshots through the agent API',async()=>{
  const rig=await setup();
  for(const name of ['send','read','draft','config','note','controller/send'])
    expect((await rig.request(name,{})).status).toBe(404);
  expect((await rig.request('status',{})).status).toBe(405);
});

it('catches using normal quotas, returns metadata only and records the actual external actor',async()=>{
  const rig=await setup();h.throwAs('peer','PRIVATE LETTER CONTENT');
  const response=await rig.request('catch',{source:'PaperBoat'});
  expect(response.status).toBe(200);expect(response.body.held.letterId).toBe(local().held.letterId);
  expect(local().held).toMatchObject({caughtBy:'bridge',catchSource:'PaperBoat',body:'PRIVATE LETTER CONTENT'});
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE LETTER CONTENT');
  expect(host.events.some(e=>e.text?.includes('PRIVATE LETTER CONTENT'))).toBe(false);
  expect((await rig.request('catch',{source:'PaperBoat'})).status).toBe(409);
});

it('persists attribution and credentials over restart, and immediately refuses cached handlers on disable',async()=>{
  const rig=await setup();await rig.request('drafts',{source:'PaperBoat',body:'留在本机'});
  const old={...local().letterDraft},deps=h.world.pageDeps().bridge!;
  await h.world.stop();await h.world.start(new FakeHost());
  expect(local().letterDraft).toEqual(old);expect(h.world.pageDeps().bridge!.token()).toBe(rig.token);
  h.cfg.bridgeEnabled=false;
  expect(deps.enabled()).toBe(false);
  expect((await deps.createDraft({source:'PaperBoat',body:'不应写入'})).status).toBe(404);
});

it('keeps the Bridge off the paired LAN listener',async()=>{
  const rig=await setup({lanEnabled:true,lanPort:0});
  const lan=Reflect.get(h.world,'lan'),pairing=Reflect.get(h.world,'pairing');
  const res=await fetch(`http://127.0.0.1:${lan.port}/api/v1/status`,{headers:{authorization:'Bearer '+rig.token,cookie:`bottle_lan_${lan.port}=${pairing.issue()}`}});
  expect(res.status).toBe(404);
});

it('allows a human to review and send the external draft via the ordinary page with exact version',async()=>{
  const rig=await setup();await rig.request('drafts',{source:'PaperBoat',body:'待审信稿'});
  const draft=local().letterDraft;
  expect((await h.world.pageDeps().send('letter',{draftId:draft.draftId,revision:draft.revision})).ok).toBe(true);
  expect(h.db.letters.filter(r=>r.body==='待审信稿')).toHaveLength(1);
});
