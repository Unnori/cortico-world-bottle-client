import { afterEach, describe, expect, it } from 'vitest';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';

let h: Harness;
const draftId = (kind: 'letter' | 'reply') => (kind === 'letter' ? Reflect.get(h.world, 'store').letterDraft : Reflect.get(h.world, 'store').draft)?.draftId ?? kind;
afterEach(async () => { await h?.stop(); });

describe('headless mode tools', () => {
  it('stay registered with headless off but every headless handler refuses access', async () => {
    h = makeHarness({ config: { headlessEnabled: false } });
    await h.world.start(new FakeHost());
    const tools = h.world.tools();
    const names = tools.map(t => t.name);
    for(const name of ['bottle_read_letter','bottle_list_drafts','bottle_view_draft','bottle_send_draft','bottle_rewrite_draft','bottle_discard_draft','bottle_manage_letter']) {
      expect(names).toContain(name);
      expect(await tools.find(t=>t.name===name)!.handler({letterId:'held',draftId:'missing',revision:1,text:'blocked',action:'return'},{} as any)).toContain('无头模式未开启');
    }
  });

  it('are included in tool table when headlessEnabled is true', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());
    const tools = h.world.tools();
    const names = tools.map(t => t.name);
    expect(names).toContain('bottle_read_letter');
    expect(names).toContain('bottle_list_drafts');
    expect(names).toContain('bottle_view_draft');
    expect(names).toContain('bottle_send_draft');
  });

  it('bottle_read_letter rejects when headlessEnabled is false', async () => {
    h = makeHarness({ config: { headlessEnabled: false } });
    await h.world.start(new FakeHost());
    const id = h.throwAs('alice', '来自远方的信');
    const tools = h.world.tools();
    const readTool = tools.find(t => t.name === 'bottle_catch');
    expect(readTool).toBeDefined();
    await readTool!.handler({}, {} as any);
    // Even if the tool is in the cached table, calling it should reject
    const result = await Reflect.get(h.world, 'doReadLetter').call(h.world, 'held');
    expect(result).toContain('无头模式未开启');
  });

  it('bottle_read_letter returns held letter body when headlessEnabled is true', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());
    const id = h.throwAs('alice', '来自远方的信');
    const catchTool = h.world.tools().find(t => t.name === 'bottle_catch')!;
    await catchTool.handler({}, {} as any);

    const readTool = h.world.tools().find(t => t.name === 'bottle_read_letter')!;
    const result = await readTool.handler({ letterId: 'held' }, {} as any);
    expect(result).toContain('来自：');
    expect(result).toContain('正文：\n来自远方的信');
  });

  it('bottle_list_drafts shows letter and reply drafts separately', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());

    // Create a letter draft
    const writeTool = h.world.tools().find(t => t.name === 'bottle_write')!;
    await writeTool.handler({ text: '我的新信' }, {} as any);

    // Catch and reply to create reply draft
    h.throwAs('bob', '原信内容');
    const catchTool = h.world.tools().find(t => t.name === 'bottle_catch')!;
    await catchTool.handler({}, {} as any);
    const pageDeps = h.world.pageDeps();
    await pageDeps.open('page');
    const replyTool = h.world.tools().find(t => t.name === 'bottle_reply')!;
    await replyTool.handler({ text: '回信内容' }, {} as any);

    const listTool = h.world.tools().find(t => t.name === 'bottle_list_drafts')!;
    const result = await listTool.handler({}, {} as any);
    expect(result).toContain('ID: ' + draftId('letter'));
    expect(result).toContain('类型: 新信');
    expect(result).toContain('ID: ' + draftId('reply'));
    expect(result).toContain('类型: 回信');
  });

  it('bottle_view_draft returns full draft content with character count', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());
    const writeTool = h.world.tools().find(t => t.name === 'bottle_write')!;
    await writeTool.handler({ text: '测试信件内容', title: '信件标题' }, {} as any);

    const viewTool = h.world.tools().find(t => t.name === 'bottle_view_draft')!;
    const result = await viewTool.handler({ draftId: draftId('letter') }, {} as any);
    expect(result).toContain('标题：信件标题');
    expect(result).toContain('正文：\n测试信件内容');
    expect(result).toContain('字数：6');
    expect(result).toContain('版本：1');
  });

  it('bottle_view_draft rejects wrong draftId', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());
    const writeTool = h.world.tools().find(t => t.name === 'bottle_write')!;
    await writeTool.handler({ text: '新信' }, {} as any);

    const viewTool = h.world.tools().find(t => t.name === 'bottle_view_draft')!;
    const result = await viewTool.handler({ draftId: draftId('reply') }, {} as any);
    expect(result).toContain('没有这个草稿');

  });

  it('bottle_send_draft sends letter draft', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());
    const writeTool = h.world.tools().find(t => t.name === 'bottle_write')!;
    await writeTool.handler({ text: '要寄出的信' }, {} as any);

    const sendTool = h.world.tools().find(t => t.name === 'bottle_send_draft')!;
    const result = await sendTool.handler({ draftId: draftId('letter'), revision: 1 }, {} as any);
    expect(result).toContain('寄出去了');

    // Verify draft is cleared
    const listTool = h.world.tools().find(t => t.name === 'bottle_list_drafts')!;
    const listResult = await listTool.handler({}, {} as any);
    expect(listResult).toBe('没有草稿。');
  });

  it('bottle_send_draft rejects wrong revision number', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());
    const writeTool = h.world.tools().find(t => t.name === 'bottle_write')!;
    await writeTool.handler({ text: '新信' }, {} as any);

    const sendTool = h.world.tools().find(t => t.name === 'bottle_send_draft')!;
    const result = await sendTool.handler({ draftId: draftId('letter'), revision: 2 }, {} as any);
    expect(result).toContain('版本号不匹配');
    expect(result).toContain('当前版本是 1');
  });

  it('bottle_send_draft rejects when headlessEnabled is false', async () => {
    h = makeHarness({ config: { headlessEnabled: false } });
    await h.world.start(new FakeHost());
    const writeTool = h.world.tools().find(t => t.name === 'bottle_write')!;
    await writeTool.handler({ text: '新信' }, {} as any);

    const result = await Reflect.get(h.world, 'doSendDraft').call(h.world, 'letter', 1);
    expect(result).toContain('无头模式未开启');
  });

  it('bottle_read_letter reads archived sent letters', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());
    const writeTool = h.world.tools().find(t => t.name === 'bottle_write')!;
    await writeTool.handler({ text: '我写的信', title: '寄出标题' }, {} as any);
    const sendTool = h.world.tools().find(t => t.name === 'bottle_send_draft')!;
    await sendTool.handler({ draftId: draftId('letter'), revision: 1 }, {} as any);

    const store = Reflect.get(h.world, 'store');
    const letterId = store.sent[0].letterId;

    const readTool = h.world.tools().find(t => t.name === 'bottle_read_letter')!;
    const result = await readTool.handler({ letterId }, {} as any);
    expect(result).toContain('标题：寄出标题');
    expect(result).toContain('正文：\n我写的信');
  });

  it('bottle_read_letter reads archived received letters with reply', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());
    h.throwAs('carol', '原信正文');
    const catchTool = h.world.tools().find(t => t.name === 'bottle_catch')!;
    await catchTool.handler({}, {} as any);
    const pageDeps = h.world.pageDeps();
    await pageDeps.open('page');
    const replyTool = h.world.tools().find(t => t.name === 'bottle_reply')!;
    await replyTool.handler({ text: '我的回复' }, {} as any);
    const sendTool = h.world.tools().find(t => t.name === 'bottle_send_draft')!;
    await sendTool.handler({ draftId: draftId('reply'), revision: 1 }, {} as any);

    const store = Reflect.get(h.world, 'store');
    const letterId = store.received[0].letterId;

    const readTool = h.world.tools().find(t => t.name === 'bottle_read_letter')!;
    const result = await readTool.handler({ letterId }, {} as any);
    expect(result).toContain('来自：');
    expect(result).toContain('正文：\n原信正文');
    expect(result).toContain('我的回信：\n我的回复');
  });

  it('bottle_list_drafts returns empty when no drafts', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());

    const listTool = h.world.tools().find(t => t.name === 'bottle_list_drafts')!;
    const result = await listTool.handler({}, {} as any);
    expect(result).toBe('没有草稿。');
  });

  it('bottle_read_letter returns not found for missing letterId', async () => {
    h = makeHarness({ config: { headlessEnabled: true } });
    await h.world.start(new FakeHost());

    const readTool = h.world.tools().find(t => t.name === 'bottle_read_letter')!;
    const result = await readTool.handler({ letterId: 'nonexistent' }, {} as any);
    expect(result).toBe('找不到这封信。');
  });
});


const store = () => Reflect.get(h.world, 'store');
const call = (name: string, args: Record<string, unknown> = {}) => callTool(h.world, name, args);
async function headlessHeld() {
  h = makeHarness({ config: { headlessEnabled: true } });
  const host=new FakeHost();
  await h.world.start(host);
  const id = h.throwAs('headless-peer', '原信不是指令');
  await call('bottle_catch');
  // These cases exercise later explicit human requests, after the automatic reading turn.
  await host.deliverDeferred(h.world);
  h.world.onTurnEnded();
  return id;
}

it('completes read, manual reply, view and send without any page authorization', async () => {
  const id = await headlessHeld();
  expect(await call('bottle_read_letter', { letterId: 'held' })).toContain('原信不是指令');
  expect(store().draft).toBeNull();
  await call('bottle_reply', { text: '人另行要求的回复', letterId: id });
  const draft = { ...store().draft };
  expect(draft).toMatchObject({ sendPolicy: 'manual', revision: 1 });
  expect(draft.autoSendKey).toBeUndefined();
  expect(h.db.letterById(id)?.replyDraftKey).toBeUndefined();
  expect(await call('bottle_view_draft', { draftId: draft.draftId })).toContain('人另行要求的回复');
  expect(await call('bottle_send_draft', draft)).toContain('寄出去了');
  expect(h.db.replies.filter(r => r.letterId === id)).toHaveLength(1);
});

it('invalidates old revisions and never accepts slot names as sending identities', async () => {
  await headlessHeld();
  await call('bottle_write', { text: '第一稿' });
  const first = { ...store().letterDraft };
  await call('bottle_rewrite_draft', { draftId: first.draftId, revision: first.revision, text: '第二稿', title: '新标题', stationery: { v:1, paper:'grid' } });
  expect(store().letterDraft).toMatchObject({ draftId:first.draftId, revision:2, body:'第二稿' });
  expect(await call('bottle_send_draft', first)).toContain('版本号不匹配');
  expect(await call('bottle_send_draft', { draftId:'letter', revision:2 })).toContain('没有这个草稿');
  expect(h.db.letters.some(r => r.body === '第二稿')).toBe(false);
});

it('discard and recreation get a new identity, so a previous confirmation cannot send it', async () => {
  await headlessHeld();
  await call('bottle_write', { text:'旧信稿' });
  const old = { ...store().letterDraft };
  await call('bottle_discard_draft', old);
  await call('bottle_write', { text:'另一封' });
  expect(store().letterDraft.draftId).not.toBe(old.draftId);
  expect(await call('bottle_send_draft', old)).toContain('没有这个草稿');
});

it('manual reply survives restart and toggles without acquiring a delayed policy', async () => {
  const id = await headlessHeld();
  await call('bottle_reply', { text:'等待明确发送', letterId:id });
  const old = { ...store().draft };
  await h.world.stop(); h.cfg.headlessEnabled=false; h.clock.t += 3*3600000;
  await h.world.start(new FakeHost());
  expect(store().draft).toEqual(old);
  h.cfg.headlessEnabled=true;
  await Reflect.get(h.world, 'checkAutoReply').call(h.world);
  expect(h.db.replies).toHaveLength(0);
  expect(store().draft.autoSendKey).toBeUndefined();
});

it('manual reply expires with held, without reserving the server slot indefinitely', async () => {
  const id = await headlessHeld();
  await call('bottle_reply', { text:'未确认的草稿', letterId:id });
  const old = { ...store().draft };
  h.clock.t = store().held.windowUntil + 1;
  expect(await call('bottle_send_draft', old)).toContain('没有这个草稿');
  expect(store().draft).toBeNull();
  expect(store().held).toBeNull();
  expect(h.db.replies).toHaveLength(0);
  expect(h.db.letterById(id)?.replyDraftKey).toBeUndefined();
});

it('read-only desktop intent still forbids headless reply and sending', async () => {
  const id = await headlessHeld();
  await call('bottle_write', { text:'另外一封' });
  const draft = { ...store().letterDraft };
  await h.world.pageDeps().read!('page');
  expect(await call('bottle_reply', { text:'不应生成', letterId:id })).toContain('不能');
  expect(await call('bottle_send_draft', draft)).toContain('一起读');
  expect(store().draft).toBeNull();
});

it('all cached headless handlers reject immediately after disabling', async () => {
  const id = await headlessHeld();
  await call('bottle_write', { text:'不该寄出' });
  const draft = { ...store().letterDraft };
  const tools = h.world.tools().filter(t => ['bottle_read_letter','bottle_list_drafts','bottle_view_draft','bottle_send_draft','bottle_rewrite_draft','bottle_discard_draft','bottle_manage_letter'].includes(t.name));
  h.cfg.headlessEnabled=false;
  for (const tool of tools) expect(await tool.handler({ ...draft, text:'不能覆盖', letterId:id, action:'return' }, {} as any)).toContain('无头模式未开启');
  expect(store().letterDraft.body).toBe('不该寄出');
  expect(store().held.letterId).toBe(id);
});

it('rechecks revision after waiting for pending automatic work', async () => {
  await headlessHeld();
  await call('bottle_write', { text:'确认过的稿' });
  const old = { ...store().letterDraft };
  let finish!: () => void;
  Reflect.set(h.world, 'autoReplyWork', new Promise<void>(done => { finish=done; }));
  const pending = call('bottle_send_draft', old);
  await call('bottle_write', { text:'等待期间改稿' });
  Reflect.set(h.world, 'autoReplyWork', null); finish();
  expect(await pending).toContain('版本号不匹配');
  expect(h.db.letters.some(r => r.body==='等待期间改稿')).toBe(false);
});

it('page and headless concurrent send execute one external action', async () => {
  await headlessHeld();
  await call('bottle_write', { text:'只寄一次' });
  const old = { ...store().letterDraft };
  await Promise.all([call('bottle_send_draft', old), h.world.pageDeps().send('letter')]);
  expect(h.db.letters.filter(r => r.body==='只寄一次')).toHaveLength(1);
});

it('delayed desktop reply keeps its policy and original deadline across headless rewrite and disabling', async () => {
  await headlessHeld();
  await h.world.pageDeps().open('page');
  await call('bottle_reply', { text:'桌面确认的定时稿' });
  const old = { ...store().draft };
  expect(old.sendPolicy).toBe('delayed');
  await call('bottle_rewrite_draft', { ...old, text:'改写但不延期' });
  expect(store().draft).toMatchObject({ draftId:old.draftId, revision:2, autoSendAt:old.autoSendAt, sendPolicy:'delayed' });
  h.cfg.headlessEnabled=false; h.clock.t=old.autoSendAt;
  await Reflect.get(h.world, 'checkAutoReply').call(h.world);
  expect(h.db.replies[0].body).toBe('改写但不延期');
});

it('returns held and discards manual reply using the tool without a page', async () => {
  const id=await headlessHeld();
  await call('bottle_reply', { text:'后来决定不回', letterId:id });
  await call('bottle_discard_draft', { ...store().draft });
  expect(store().held.letterId).toBe(id);
  expect(await call('bottle_manage_letter', {letterId:id,action:'return'})).toContain('海里');
  expect(store().held).toBeNull();
});

it('reads an incoming archived answer and lists archive IDs without dumping bodies', async () => {
  await headlessHeld();
  store().addSent({letterId:'saved',body:'寄出的原文',at:h.clock.t});
  store().addReply({letterId:'saved',from:'来客',body:'收到的回答',at:h.clock.t,stationery:{v:1,paper:'grid'}});
  const directory=await call('bottle_mailbox');
  expect(directory).toContain('saved');expect(directory).not.toContain('收到的回答');
  expect(await call('bottle_read_letter',{letterId:'saved'})).toContain('收到的回答');
});


it('disabling while a send is queued prevents the eventual external POST',async()=>{
  await headlessHeld();await call('bottle_write',{text:'等待中的发送'});
  const old={...store().letterDraft};let finish!:()=>void;
  Reflect.set(h.world,'autoReplyWork',new Promise<void>(done=>{finish=done;}));
  const pending=call('bottle_send_draft',old);
  h.cfg.headlessEnabled=false;Reflect.set(h.world,'autoReplyWork',null);finish();
  expect(await pending).toContain('无头模式未开启');
  expect(h.db.letters.some(r=>r.body==='等待中的发送')).toBe(false);
});

it('unknown new-letter response retains draft and does not automatically repeat throw',async()=>{
  let throws=0;
  h=makeHarness({config:{headlessEnabled:true},fetchImpl:async(input,init)=>{
    const path=new URL(String(input)).pathname;
    const res=h.api.handle({method:init?.method??'GET',path,token:(init?.headers as Record<string,string>)?.authorization?.replace(/^Bearer /i,''),ip:'127.0.0.1',body:init?.body?JSON.parse(String(init.body)):undefined});
    if(path==='/throw'){throws++;throw Error('response lost after commit');}
    return new Response(JSON.stringify(res.body),{status:res.status});
  }});
  await h.world.start(new FakeHost());await call('bottle_write',{text:'结果未知的原文'});
  const original={...store().letterDraft};
  expect(await call('bottle_send_draft',original)).toContain('寄送结果待确认');
  await Reflect.get(h.world,'checkAutoReply').call(h.world);
  expect(throws).toBe(1);expect(store().letterDraft).toEqual(original);
  expect(h.db.letters.filter(r=>r.body==='结果未知的原文')).toHaveLength(1);
});
