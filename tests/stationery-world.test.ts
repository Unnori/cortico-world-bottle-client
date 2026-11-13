import { afterEach, expect, it } from 'vitest';
import { makeHarness, callTool, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';
import { checkStationery } from '../shared/stationery.ts';

const rigs: Harness[] = [];
afterEach(async () => { for (const h of rigs.splice(0)) await h.stop(); });
const svg = { v: 1 as const, customSvg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2"/></svg>' };

it('two Worlds preserve independent SVGs through send/read/reply, restart, export and import', async () => {
  const a = makeHarness({ config: { headlessEnabled: true } }); rigs.push(a);
  const b = makeHarness({ config: { headlessEnabled: true }, fetchImpl: async (input, init) => {
    const res = a.api.handle({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname,
      token: (init?.headers as Record<string,string>)?.authorization?.replace(/^Bearer /i,''), ip:'127.0.0.1',
      body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(res.body), { status:res.status });
  } }); rigs.push(b);
  await a.world.start(new FakeHost()); await b.world.start(new FakeHost());
  await callTool(a.world,'bottle_write',{text:'字'.repeat(120),title:'题'.repeat(20),stationery:svg});
  const aStore = Reflect.get(a.world,'store'), bStore = Reflect.get(b.world,'store');
  await callTool(a.world,'bottle_send_draft',{...aStore.letterDraft});
  const id = aStore.sent[0].letterId;
  await callTool(b.world,'bottle_catch');
  await (Reflect.get(b.world,'host') as FakeHost).deliverDeferred(b.world);
  expect(bStore.held.stationery.customSvg).toContain('<circle');
  const answer = { v:1, customSvg:'<svg viewBox="0 0 2 2"><rect width="1" height="1"/></svg>' };
  await callTool(b.world,'bottle_reply',{text:'回'.repeat(120),letterId:id,stationery:answer});
  b.world.onTurnEnded();
  await callTool(b.world,'bottle_send_draft',{...bStore.draft});
  await callTool(a.world,'bottle_mailbox');
  expect(aStore.replies[0].stationery.customSvg).toContain('<rect');
  expect(bStore.received[0].stationery.customSvg).toContain('<circle');
  expect(bStore.received[0].myReplyStationery.customSvg).toContain('<rect');
  await b.world.stop(); await b.world.start(new FakeHost());
  expect(bStore.received[0].myReplyStationery.customSvg).toContain('<rect');
  const archive = b.world.pageDeps().exportArchive!();
  const c = makeHarness(); rigs.push(c);
  expect(c.world.pageDeps().importArchive!(archive).ok).toBe(true);
  expect(Reflect.get(c.world,'store').received[0].stationery).toEqual(bStore.received[0].stationery);
  expect(Reflect.get(c.world,'store').received[0].myReplyStationery).toEqual(bStore.received[0].myReplyStationery);
});

it('a legacy sea receives no unsupported decoration field and the sender reports degradation',async()=>{
  const outgoing: Array<Record<string,unknown>> = [];
  const h = makeHarness({config:{headlessEnabled:true},fetchImpl:async(input,init)=>{
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === '/throw') outgoing.push(body);
    const res = h.api.handle({method:init?.method??'GET',path,body,ip:'127.0.0.1',token:(init?.headers as Record<string,string>)?.authorization?.replace(/^Bearer /i,'')});
    const value = res.body as any;
    if (value && typeof value === 'object') { delete value.stationery; if(value.quota)delete value.quota.stationery; }
    return new Response(JSON.stringify(value),{status:res.status});
  }}); rigs.push(h);
  await h.world.start(new FakeHost());
  await callTool(h.world,'bottle_write',{text:'保留正文',stationery:svg});
  const local = Reflect.get(h.world,'store');
  expect(local.letterDraft.stationery.customSvg).toContain('<circle');
  expect(await callTool(h.world,'bottle_send_draft',{...local.letterDraft})).toContain('降级');
  expect(outgoing[0]).toEqual({body:'保留正文'});
  expect(local.sent[0].stationery.customSvg).toContain('<circle');
});

it('two Worlds preserve layered art through exact revision confirmation, reply, restart, archive and repost',async()=>{
  const a=makeHarness({config:{headlessEnabled:true}});rigs.push(a);
  const b=makeHarness({config:{headlessEnabled:true},fetchImpl:async(input,init)=>{
    const r=a.api.handle({method:init?.method??'GET',path:new URL(String(input)).pathname,
      token:(init?.headers as Record<string,string>)?.authorization?.replace(/^Bearer /i,''),ip:'127.0.0.1',
      body:init?.body?JSON.parse(String(init.body)):undefined});return new Response(JSON.stringify(r.body),{status:r.status});
  }});rigs.push(b);
  await a.world.start(new FakeHost());await b.world.start(new FakeHost());
  const sa=Reflect.get(a.world,'store'),sb=Reflect.get(b.world,'store');
  const layout={v:2,paper:'line',paperColor:'#f8efd8',decorations:[
    {doodle:'rain-cloud',x:14,y:18,width:23,rotation:-30,layer:'behind'},
    {customSvg:svg.customSvg,color:'#be6677',placement:'center',size:'large',opacity:.15,flipY:true},
    {doodle:'paper-plane',color:'#5588aa',x:83,y:86,width:17,layer:'front',z:7},
  ]};
  await callTool(a.world,'bottle_write',{text:'信纸上的三种风。',stationery:layout});
  const old={...sa.letterDraft};
  expect(old.stationery.decorations[0].color).toMatch(/^#[a-f0-9]{6}$/);
  expect(await callTool(a.world,'bottle_rewrite_draft',{draftId:old.draftId,revision:old.revision,text:old.body,
    stationery:{...layout,decorations:layout.decorations.map((d,i)=>i===0?{...d,rotation:25}:d)}})).toContain('版本');
  expect(sa.letterDraft.revision).toBe(old.revision+1);
  expect((await callTool(a.world,'bottle_send_draft',old))).not.toContain('寄出去了');
  const final=sa.letterDraft.stationery;
  await callTool(a.world,'bottle_send_draft',{...sa.letterDraft});const id=sa.sent[0].letterId;
  expect(a.db.letterById(id)?.stationery).toEqual(final);
  await callTool(b.world,'bottle_catch');await (Reflect.get(b.world,'host') as FakeHost).deliverDeferred(b.world);
  expect(sb.held.stationery).toEqual(final);
  const answer={v:2,paper:'grid',decorations:[{doodle:'loose-daisy',color:'#997799',x:20,y:80,width:20},{customSvg:svg.customSvg,x:80,y:15,rotation:15}]};
  await callTool(b.world,'bottle_reply',{text:'风里有花。',letterId:id,stationery:answer});
  b.world.onTurnEnded();await callTool(b.world,'bottle_send_draft',{...sb.draft});await callTool(a.world,'bottle_mailbox');
  expect(sb.received[0].stationery).toEqual(final);
  const expected=checkStationery(answer);expect(expected.ok).toBe(true);
  if(expected.ok)expect(sa.replies[0].stationery).toEqual(expected.value);
  await b.world.stop();await b.world.start(new FakeHost());
  expect(sb.received[0].stationery).toEqual(final);
  const archive=b.world.pageDeps().exportArchive!();const c=makeHarness();rigs.push(c);
  expect(c.world.pageDeps().importArchive!(archive).ok).toBe(true);
  const sc=Reflect.get(c.world,'store');
  expect(sc.received[0].stationery).toEqual(final);expect(sc.received[0].myReplyStationery).toEqual(sb.received[0].myReplyStationery);
  a.db.letterById(id)!.state='archived';a.db.letterById(id)!.archivedReason='tsunami';
  expect((await a.world.pageDeps().repost!(id)).ok).toBe(true);
  expect(a.db.letters.at(-1)?.stationery).toEqual(final);
});

it('checks every built-in ID and keeps an existing draft when a later layer is invalid',async()=>{
  const h=makeHarness({config:{headlessEnabled:true}});rigs.push(h);await h.world.start(new FakeHost());
  await callTool(h.world,'bottle_write',{text:'原稿',stationery:{v:2,doodle:'rain-cloud',color:'#112233'}});
  const store=Reflect.get(h.world,'store'),draft={...store.letterDraft};
  const result=await callTool(h.world,'bottle_write',{text:'替换',stationery:{v:2,decorations:[{doodle:'rain-cloud'},{doodle:'no-such-doodle'}]}});
  expect(result).toContain('不存在');expect(store.letterDraft).toEqual(draft);
});
