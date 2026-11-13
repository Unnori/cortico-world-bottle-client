import { afterEach, expect, it, vi } from 'vitest';
import { createServer, request } from 'node:http';
import { LanPairing, lanUrls, newPairingToken, publicOrigin, startLanServer } from '../world/lan.ts';
import type { PageDeps, PageServer } from '../world/page.ts';
import { makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';

const servers: PageServer[] = [];
let h: Harness | undefined;
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); await h?.stop(); h = undefined; });
const token = 'test-only-pairing-token';
function deps(): PageDeps {
  return { snapshot: () => ({draft:null,held:null,sent:[],received:[],quota:null,online:true}),
    request:vi.fn(async()=>({ok:true})), send:vi.fn(async()=>({ok:true})), rewrite:vi.fn(async()=>({ok:true})),
    dismiss:vi.fn(async()=>({ok:true})), keep:vi.fn(async()=>({ok:true})), peruse:vi.fn(async()=>({ok:true})),
    discard:vi.fn(async()=>({ok:true})), open:vi.fn(async()=>({ok:true})), forget:vi.fn(async()=>({ok:true})) };
}
function raw(url: string, headers: Record<string,string>, body?: string): Promise<{status: number; cookie?: string}> {
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:body===undefined?'GET':'POST',headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!,cookie:res.headers['set-cookie']?.[0]}));});
    req.on('error',reject);req.end(body);
  });
}
async function start() {
  const d=deps(), pairing=new LanPairing(token);
  const server=await startLanServer(d,{port:0,pairing}); servers.push(server);
  const base=`http://127.0.0.1:${server.port}`;
  const post=(path:string, body:unknown, headers:Record<string,string>={})=>fetch(base+path,{
    method:'POST',headers:{origin:base,'x-bottle':'1','content-type':'application/json',...headers},body:JSON.stringify(body),
  });
  const pair=async()=>{const res=await post('/pair',{token});expect(res.status).toBe(200);return res.headers.get('set-cookie')!;};
  return {d,pairing,server,base,post,pair};
}

it('generates strong random tokens and validates only the configured origin form',()=>{
  expect(newPairingToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(newPairingToken()).not.toBe(newPairingToken());
  expect(publicOrigin('https://mail.example.test')).toBe('https://mail.example.test/');
  for(const url of ['file:///tmp','javascript:alert(1)','http://user:pw@example.test','http://example.test/prefix','http://example.test/?token=1']) expect(()=>publicOrigin(url)).toThrow();
  expect(lanUrls(7798,'http://server.test:1234/',{eth0:[{address:'192.168.2.3',family:'IPv4',internal:false} as any],loop:[{address:'127.0.0.1',family:'IPv4',internal:true} as any]}))
    .toEqual(['http://server.test:1234/','http://192.168.2.3:7798/']);
});

it('protects all mailbox routes before pairing; a bare root leads to the pairing page',async()=>{
  const {base,post,d}=await start();
  const root=await fetch(base+'/',{redirect:'manual'}); expect(root.status).toBe(303);expect(root.headers.get('location')).toBe('/pair');
  for(const path of ['/draft','/notes','/archive/export','/theme','/appearance','/announcement','/icon.png','/sounds','/sounds/incoming%2FNew_notifications_1.wav','/unknown']) expect((await fetch(base+path)).status).toBe(401);
  for(const path of ['/write','/catch','/send','/dismiss','/peruse','/forget','/wake','/open','/read','/reply','/note','/note/request','/note/discard','/note/ack','/repost','/archive/import']) expect((await post(path,{})).status).toBe(401);
  expect(d.request).not.toHaveBeenCalled();expect(d.send).not.toHaveBeenCalled();
  const html=await (await fetch(base+'/pair')).text(); expect(html).not.toContain(token);expect(html).toContain('history.replaceState');
  expect((await post('/pair',{token:'wrong'})).status).toBe(401);
  expect((await post('/pair',{token}, {origin:'http://evil.test'})).status).toBe(403);
  expect((await post('/pair',{token}, {'x-bottle':'0'})).status).toBe(403);
  expect((await raw(base+'/draft',{host:'evil.test'})).status).toBe(421);
});

it('allows plaintext pairing, reuses the same routes with an HttpOnly cookie, and revokes on rotation',async()=>{
  const {base,post,d,pair,pairing}=await start(); const setCookie=await pair();
  expect(setCookie).toContain('HttpOnly');expect(setCookie).toContain('SameSite=Lax');expect(setCookie).not.toContain('; Secure');expect(setCookie).not.toContain(token);
  const cookie=setCookie.split(';')[0]!;
  const snap=await fetch(base+'/draft',{headers:{cookie}});expect(snap.status).toBe(200);expect(await snap.json()).toEqual(d.snapshot());
  expect((await post('/send',{kind:'reply'},{cookie})).status).toBe(200);expect(d.send).toHaveBeenCalledWith('reply');
  expect((await post('/send',{}, {cookie,origin:'http://evil.test'})).status).toBe(403);
  expect((await post('/send',{}, {cookie,'x-bottle':'0'})).status).toBe(403);
  const bad=await fetch(base+'/send',{method:'POST',headers:{cookie,origin:base,'x-bottle':'1'},body:'{broken'}); expect(bad.status).toBe(400);
  expect(d.send).toHaveBeenCalledTimes(1);
  pairing.rotate(newPairingToken());expect((await fetch(base+'/draft',{headers:{cookie}})).status).toBe(401);
  expect((await post('/pair',{token})).status).toBe(401);
});

it('session signatures survive restart with the same secret and expire after a year',()=>{
  let now=1800000000000;const a=new LanPairing(token,()=>now);const cookie=a.issue();
  expect(new LanPairing(token,()=>now).valid(cookie)).toBe(true);
  expect(a.valid(cookie+'broken')).toBe(false);expect(a.valid(cookie+'.extra')).toBe(false);
  now+=366*24*60*60*1000;expect(a.valid(cookie)).toBe(false);
});

it('serves tinted built-ins through the same paired asset routes and rejects invalid colors',async()=>{
  const {base,pair,pairing}=await start();const path='/doodle/rain-cloud/112233';
  expect((await fetch(base+path)).status).toBe(401);
  const cookie=(await pair()).split(';')[0];
  const res=await fetch(base+path,{headers:{cookie}});
  expect(res.status).toBe(200);expect(res.headers.get('content-type')).toContain('image/svg+xml');expect(await res.text()).toContain('#112233');
  for(const bad of ['/doodle/rain-cloud/red','/doodle/rain-cloud/112233/extra','/doodle/no-such-doodle/112233'])expect((await fetch(base+bad,{headers:{cookie}})).status).toBe(404);
  pairing.rotate(newPairingToken());expect((await fetch(base+path,{headers:{cookie}})).status).toBe(401);
});

it('serves a secure cookie through a configured HTTPS proxy without trusting forwarded headers',async()=>{
  const server=await startLanServer(deps(),{port:0,pairing:new LanPairing(token),advertised:'https://mail.example.test/'}); servers.push(server);
  const res=await raw(`http://127.0.0.1:${server.port}/pair`,{host:'mail.example.test',origin:'https://mail.example.test','x-bottle':'1'},JSON.stringify({token}));
  expect(res.status).toBe(200);expect(res.cookie).toContain('; Secure');
});

it('defaults to loopback only, and does not offer pairing when disabled',async()=>{
  h=makeHarness();await h.world.start(new FakeHost());
  const ui=h.world.webUi();const status=await ui.invoke!('mailbox','status',[]) as any;
  expect(status.lan).toMatchObject({enabled:false,running:false});expect(ui.links ?? []).toEqual([]);expect(status.links).toHaveLength(1);
  expect((await fetch(status.url+'draft')).status).toBe(200);
  await expect(ui.invoke!('mailbox','pairing',[])).rejects.toThrow();
});

it('shares live state while isolating listener auth, persists pairing across World restart, and stops both sockets',async()=>{
  h=makeHarness({config:{lanEnabled:true,lanPort:0}});await h.world.start(new FakeHost());
  let ui=h.world.webUi();let status=await ui.invoke!('mailbox','status',[]) as any;
  expect(status.lan.running).toBe(true);expect(ui.links ?? []).toEqual([]);expect(status.links.length).toBeGreaterThan(1);
  const cards=await ui.invoke!('mailbox','pairing',[]) as any;expect(cards.cards.length).toBeGreaterThan(0);
  const pairUrl=new URL(cards.cards[0].url);expect(cards.cards[0].qr).toMatch(/^data:image\/png;base64,/);
  expect(JSON.stringify(status)).not.toContain(pairUrl.hash.slice(1));expect(JSON.stringify(h.world.envPromptVars())).not.toContain(pairUrl.hash.slice(1));
  const base=`http://127.0.0.1:${pairUrl.port}`;
  const res=await fetch(base+'/pair',{method:'POST',headers:{origin:base,'x-bottle':'1'},body:JSON.stringify({token:pairUrl.hash.slice(1)})});
  const cookie=res.headers.get('set-cookie')!.split(';')[0]!;
  const local=await (await fetch(status.url+'draft')).json();
  expect(await (await fetch(base+'/draft',{headers:{cookie}})).json()).toEqual(local);
  expect((await fetch(base+'/draft')).status).toBe(401);
  h.cfg.lanPort=Number(pairUrl.port);await h.world.stop();
  await expect(fetch(base+'/draft')).rejects.toThrow();await expect(fetch(status.url+'draft')).rejects.toThrow();
  await h.world.start(new FakeHost());ui=h.world.webUi();
  expect((await fetch(base+'/draft',{headers:{cookie}})).status).toBe(200);
  await ui.invoke!('mailbox','resetPairing',[]);
  expect((await fetch(base+'/draft',{headers:{cookie}})).status).toBe(401);
  expect((await fetch(status.url+'draft')).status).toBe(200);
});

it.each(['busy','invalid'] as const)('a %s external listener does not break loopback',async kind=>{
  const busy=createServer();await new Promise<void>(done=>busy.listen(0,'0.0.0.0',done));
  try {
    const port=(busy.address() as {port:number}).port;
    h=makeHarness({config:{lanEnabled:true,lanPort:kind==='busy'?port:7797}});await h.world.start(new FakeHost());
    const status=await h.world.webUi().invoke!('mailbox','status',[]) as any;
    expect(status.lan.running).toBe(false);expect(status.lan.error).toContain('本机信箱仍可使用');
    expect((await fetch(status.url+'draft')).status).toBe(200);
  } finally {await new Promise<void>(done=>busy.close(()=>done()));}
});


it('marks every paired external action remote, ignoring forged native-card headers',async()=>{
  const {post,pair,d}=await start();const cookie=(await pair()).split(';')[0]!;
  for(const [path,body] of [['/write',{actor:'human'}],['/catch',{actor:'bot'}],['/open',{}],['/rewrite',{kind:'reply'}]] as const)
    expect((await post(path,body,{cookie,'x-bottle-surface':'card'})).status).toBe(200);
  expect(d.request).toHaveBeenCalledWith('write','human','remote');
  expect(d.request).toHaveBeenCalledWith('catch','bot','remote');
  expect(d.open).toHaveBeenCalledWith('remote');
  expect(d.rewrite).toHaveBeenCalledWith('reply','remote');
});
