import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';
import { DEFAULT_TUNING } from '../server/tuning.ts';
import { createApi, sha256 } from '../server/app.ts';
import { Db } from '../server/db.ts';
import { REPLY_AUTO_SEND_MS, REPLY_DRAFT_RETRY_GRACE_MS } from '../shared/contract.ts';
import type { LocalStore } from '../world/store.ts';

let h: Harness | undefined;
let host: FakeHost;
let blocked = '';
let legacy = false;
let loseReply = false;
let loseReservation = false;
const calls: string[] = [];
const hour = 3_600_000;
async function setup() {
  blocked = ''; legacy = false; loseReply = false; loseReservation = false; calls.length = 0;
  h = makeHarness({ tuning: { current: () => ({ ...DEFAULT_TUNING, replyWindowHours: 24 }) }, fetchImpl: async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === blocked || (legacy && path === '/read')) return new Response('{}', {status: 503});
    const headers = init?.headers as Record<string, string>;
    const res = h!.api.handle({ method: init?.method ?? 'GET', path,
      token: headers?.authorization?.replace(/^Bearer /i, ''), ip: '127.0.0.1',
      body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (legacy && res.body && typeof res.body === 'object') {
      delete (res.body as any).reply_draft_hold;
      if ('quota' in res.body) delete (res.body as any).quota.reply_draft_hold;
    }
    if (loseReservation && path === '/reply/draft') { loseReservation = false; throw Error('reservation response lost'); }
    if (loseReply && path === '/reply') { loseReply = false; throw Error('response lost'); }
    return new Response(JSON.stringify(res.body), { status: res.status });
  }});
  host = new FakeHost(); await h.world.start(host);
  await vi.waitFor(() => expect(h!.world.pageDeps().snapshot().quota).not.toBeNull());
  const id = h.throwAs('sender', '原信正文不会落在服务端磁盘。');
  expect((await h.world.pageDeps().request('catch', 'human', 'remote')).ok).toBe(true);
  return id;
}
afterEach(async () => { if (h) await h.stop(); h = undefined; });
const tick = () => (h!.world as any).checkAutoReply() as Promise<void>;
async function draft() {
  expect((await h!.world.pageDeps().open('remote')).ok).toBe(true);
  await callTool(h!.world, 'bottle_reply', { text: '这是一封两小时后自动寄出的回信。' });
  expect(h!.world.pageDeps().snapshot().replyDraft).not.toBeNull();
  await (h!.world as any).refreshQuota();
}

it('together-reading needs no server read route and keeps the original 24-hour return', async () => {
  const id = await setup(); legacy = true;
  const deadline = h!.db.letterById(id)!.replyWindowUntil;
  expect((await h!.world.pageDeps().read!('remote')).ok).toBe(true);
  h!.world.onEventsSettled([host.last('bottle.reading')!], 'delivered');
  h!.world.onTurnEnded();
  expect(calls).not.toContain('/read');
  expect(h!.db.letterById(id)!.replyWindowUntil).toBe(deadline);
  expect(h!.world.pageDeps().snapshot().held?.readAt).toBeTruthy();
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
  h!.clock.t = deadline! + 1;
  await (h!.world as any).refreshQuota();
  expect(h!.db.letterById(id)!.state).toBe('floating');
  expect(h!.world.pageDeps().snapshot().held).toBeNull();
});
it('an invalid reply does not start protection or the two-hour countdown', async () => {
  const id = await setup();
  await h!.world.pageDeps().open('remote');
  await callTool(h!.world, 'bottle_reply', { text: '' });
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
  expect(h!.db.letterById(id)!.replyDraftKey).toBeUndefined();
  expect(calls).not.toContain('/reply/draft');
});
it('a reply at hour 23 survives the hour-24 return sweep and sends at hour 25', async () => {
  const id = await setup(); const caughtAt = h!.clock.t;
  h!.clock.t += 23 * hour;
  await draft();
  const pending = h!.world.pageDeps().snapshot().replyDraft!;
  expect(pending.autoSendAt).toBe(caughtAt + 25 * hour);
  expect(h!.db.letterById(id)!.replyWindowUntil).toBe(caughtAt + 24 * hour);
  h!.clock.t = caughtAt + 24 * hour + 1;
  await (h!.world as any).refreshQuota(); // sweep must run BEFORE the automatic-send timer
  expect(h!.db.letterById(id)!.state).toBe('caught');
  expect(h!.world.pageDeps().snapshot().held?.letterId).toBe(id);
  await tick(); expect(h!.db.replies).toHaveLength(0);
  h!.clock.t = pending.autoSendAt!;
  await tick();
  expect(h!.db.letterById(id)!.state).toBe('replied');
  expect(h!.db.letterById(id)!.replyDraftKey).toBeUndefined();
  expect(h!.db.replies).toHaveLength(1);
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
  expect(h!.world.pageDeps().snapshot().received[0]?.outcome).toBe('replied');
});
it('restarting World retains the original countdown instead of starting two more hours', async () => {
  const id = await setup(); await draft();
  const at = h!.world.pageDeps().snapshot().replyDraft!.autoSendAt!;
  await h!.world.stop(); h!.clock.t += hour;
  await h!.world.start(host);
  await vi.waitFor(() => expect(h!.world.pageDeps().snapshot().quota).not.toBeNull());
  await tick();
  expect(h!.world.pageDeps().snapshot().replyDraft!.autoSendAt).toBe(at);
  h!.clock.t = at; await tick();
  expect(h!.db.letterById(id)!.state).toBe('replied');
});
it('automatic send retries after a network failure without returning or losing the draft', async () => {
  const id = await setup(); await draft();
  h!.clock.t = h!.world.pageDeps().snapshot().replyDraft!.autoSendAt!;
  blocked = '/reply'; await tick();
  expect(h!.db.letterById(id)!.state).toBe('caught');
  expect(h!.world.pageDeps().snapshot().replyDraft).not.toBeNull();
  blocked = ''; h!.clock.t += 60_001; await tick();
  expect(h!.db.replies).toHaveLength(1);
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
});

it('expired server protection stops automatic retries, frees local holding and retains the unsent reply across restart',async()=>{
  const id=await setup();h!.clock.t+=23*hour;await draft();
  const original=h!.world.pageDeps().snapshot().replyDraft!;
  h!.clock.t=original.autoSendAt!+REPLY_DRAFT_RETRY_GRACE_MS;
  await (h!.world as any).refreshQuota();expect(h!.db.letterById(id)!.state).toBe('floating');
  h!.db.bots.find(bot=>bot.tokenHash===sha256((h!.world as any).token()))!.repliesMade=999;
  await tick();const retained=h!.world.pageDeps().snapshot().replyDraft!;
  expect(retained.body).toBe(original.body);expect(retained.sendPolicy).toBe('manual');expect(retained.sendFailure).toBe('expired');
  expect(retained.autoSendAt).toBeUndefined();expect(retained.autoSendPending).toBeUndefined();
  expect(retained.revision).toBe(original.revision!+1);
  expect(h!.world.pageDeps().snapshot().held).toBeNull();expect(h!.db.replies).toHaveLength(0);
  expect(h!.world.pageDeps().snapshot().received.find(r=>r.letterId===id)?.outcome).toBe('expired');
  const count=calls.filter(p=>p==='/reply').length;h!.clock.t+=2*hour;await tick();
  expect(calls.filter(p=>p==='/reply')).toHaveLength(count);
  await h!.world.stop();await h!.world.start(host);await tick();
  expect(h!.world.pageDeps().snapshot().replyDraft).toMatchObject({body:original.body,sendFailure:'expired',sendPolicy:'manual'});
  expect((await h!.world.pageDeps().rewrite('reply','remote')).ok).toBe(false);
  expect(h!.world.pageDeps().snapshot().replyDraft?.body).toBe(original.body);
  expect((await h!.world.pageDeps().send('reply')).ok).toBe(false);
  expect((await h!.world.pageDeps().discard('reply')).ok).toBe(true);expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
});

it('a definite dead-letter receipt retains a confirmed unsent reply instead of deleting it',async()=>{
  const id=await setup();await draft();const body=h!.world.pageDeps().snapshot().replyDraft!.body;
  const row=h!.db.letterById(id)!;row.state='archived';row.archivedReason='tsunami';delete row.replyDraftKey;delete row.replyDraftDueAt;
  await (h!.world as any).refreshQuota();await tick();
  expect(h!.world.pageDeps().snapshot().replyDraft).toMatchObject({body,sendFailure:'expired',sendPolicy:'manual'});
  expect(h!.world.pageDeps().snapshot().held).toBeNull();expect(h!.db.replies).toHaveLength(0);
});
it('a lost send response retries idempotently without another reply or quota charge', async () => {
  const id = await setup(); await draft();
  h!.clock.t = h!.world.pageDeps().snapshot().replyDraft!.autoSendAt!;
  loseReply = true; await tick();
  expect(h!.db.replies).toHaveLength(1);
  const bot = h!.db.bots.find(b => b.clientHash === h!.db.letterById(id)!.catcherHash)!;
  const spent = bot.repliesMade;
  h!.clock.t += 60_001; await tick();
  expect(h!.db.replies).toHaveLength(1);
  expect(bot.repliesMade).toBe(spent);
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
});
it('server confirmation failure retries without inventing a confirmed send deadline', async () => {
  await setup(); blocked = '/reply/draft'; await draft();
  expect(h!.world.pageDeps().snapshot().replyDraft!.autoSendPending).toBe(true);
  expect(h!.world.pageDeps().snapshot().replyDraft!.autoSendAt).toBeUndefined();
  blocked = ''; h!.clock.t += 60_001; await tick();
  expect(h!.world.pageDeps().snapshot().replyDraft!.autoSendAt).toBe(h!.clock.t + REPLY_AUTO_SEND_MS);
});
it('a lost reservation response recovers the same deadline and protects against earlier return', async () => {
  const id = await setup(); h!.clock.t += 23 * hour;
  loseReservation = true; await draft();
  const due = h!.db.letterById(id)!.replyDraftDueAt!;
  expect(h!.world.pageDeps().snapshot().replyDraft!.autoSendAt).toBeUndefined();
  h!.clock.t += 3 * hour;
  await (h!.world as any).refreshQuota();
  expect(h!.db.letterById(id)!.state).toBe('caught');
  await tick();
  expect(h!.db.letterById(id)!.state).toBe('replied');
  expect(h!.clock.t).toBeGreaterThan(due);
});
it('a reservation never received before return expiry cannot leave a permanent local holding lock', async () => {
  const id = await setup(); h!.clock.t += 23 * hour;
  blocked = '/reply/draft'; await draft();
  h!.clock.t += 2 * hour;
  await (h!.world as any).refreshQuota();
  expect(h!.db.letterById(id)!.state).toBe('floating');
  blocked = ''; await tick();
  expect(h!.world.pageDeps().snapshot().held).toBeNull();
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
});
it('legacy server gets manual sending and no unsupported reservation requests', async () => {
  const id = await setup(); legacy = true;
  h!.clock.t += 6000; await (h!.world as any).refreshQuota();
  await draft();
  const d = h!.world.pageDeps().snapshot().replyDraft!;
  expect(d.autoSendAt).toBeUndefined(); expect(d.autoSendPending).toBeUndefined();
  expect(calls).not.toContain('/reply/draft');
  expect((await h!.world.pageDeps().send('reply')).ok).toBe(true);
  expect(h!.db.letterById(id)!.state).toBe('replied');
});
it('discarding a draft removes server protection and restores the original expiry', async () => {
  const id = await setup(); await draft();
  expect((await h!.world.pageDeps().discard('reply')).ok).toBe(true);
  expect(h!.db.letterById(id)!.replyDraftKey).toBeUndefined();
  h!.clock.t += 25 * hour; await (h!.world as any).refreshQuota();
  expect(h!.db.letterById(id)!.state).toBe('floating');
});
it('failed cancellation preserves the draft and server protection', async () => {
  const id = await setup(); await draft(); blocked = '/reply/draft';
  expect((await h!.world.pageDeps().discard('reply')).ok).toBe(false);
  expect(h!.world.pageDeps().snapshot().replyDraft).not.toBeNull();
  expect(h!.db.letterById(id)!.replyDraftKey).toBeTruthy();
});
it('explicit return cancels protection and clears the local draft', async () => {
  const id = await setup(); await draft();
  expect((await h!.world.pageDeps().dismiss()).ok).toBe(true);
  expect(h!.db.letterById(id)!.replyDraftKey).toBeUndefined();
  expect(h!.db.letterById(id)!.state).toBe('floating');
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
});
it('manual sending and the automatic deadline cannot produce two replies', async () => {
  await setup(); await draft();
  h!.clock.t = h!.world.pageDeps().snapshot().replyDraft!.autoSendAt!;
  await Promise.all([tick(), h!.world.pageDeps().send('reply')]);
  expect(h!.db.replies).toHaveLength(1);
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
});
it('deleting the pending letter cancels its automatic send before deleting local history', async () => {
  const id = await setup(); await draft();
  expect((await h!.world.pageDeps().forget(id)).ok).toBe(true);
  expect(h!.db.letterById(id)!.replyDraftKey).toBeUndefined();
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
  expect((Reflect.get(h!.world, 'store') as LocalStore).received).toHaveLength(0);
});
it('reserved replies still send if the ordinary daily reply allowance is later exhausted', async () => {
  const id = await setup(); await draft();
  h!.db.bots.find(b => b.clientHash === h!.db.letterById(id)!.catcherHash)!.repliesMade = 999;
  h!.clock.t = h!.world.pageDeps().snapshot().replyDraft!.autoSendAt!;
  await tick(); expect(h!.db.replies).toHaveLength(1);
});

it('a rewrite still being generated cannot postpone the confirmed draft deadline', async () => {
  const id = await setup(); await draft();
  const due = h!.world.pageDeps().snapshot().replyDraft!.autoSendAt!;
  h!.clock.t = due - 60_000;
  expect((await h!.world.pageDeps().rewrite('reply', 'remote')).ok).toBe(true);
  h!.clock.t = due; await tick();
  expect(h!.db.letterById(id)!.state).toBe('replied');
  await callTool(h!.world, 'bottle_reply', {text: '迟到的新稿不再替换已寄出的信。'});
  expect(h!.world.pageDeps().snapshot().replyDraft).toBeNull();
  expect(h!.db.replies).toHaveLength(1);
});
it('a valid rewrite changes the body without extending or replacing the original reservation', async () => {
  const id = await setup(); await draft();
  const due = h!.world.pageDeps().snapshot().replyDraft!.autoSendAt!;
  const key = h!.db.letterById(id)!.replyDraftKey;
  h!.clock.t += hour;
  expect((await h!.world.pageDeps().rewrite('reply', 'remote')).ok).toBe(true);
  await callTool(h!.world, 'bottle_reply', {text:'这是更新后的回信。'});
  expect(h!.world.pageDeps().snapshot().replyDraft!.autoSendAt).toBe(due);
  expect(h!.db.letterById(id)!.replyDraftKey).toBe(key);
  h!.clock.t = due; await tick();
  expect(h!.db.replies[0]?.body).toBe('这是更新后的回信。');
});
it('repeated reservation requests do not extend the two-hour deadline', async () => {
  const id = await setup(); await draft();
  const key = h!.db.letterById(id)!.replyDraftKey!;
  const due = h!.db.letterById(id)!.replyDraftDueAt!;
  h!.clock.t += hour;
  const res = h!.api.handle({method:'POST', path:'/reply/draft', token:(h!.world as any).token(), ip:'127.0.0.1', body:{letterId:id,draftKey:key}});
  expect(res.status).toBe(200);
  expect(h!.db.letterById(id)!.replyDraftDueAt).toBe(due);
});
it('other participants cannot cancel a pending draft or replace its deadline', async () => {
  const id = await setup(); await draft();
  const key = h!.db.letterById(id)!.replyDraftKey!, due = h!.db.letterById(id)!.replyDraftDueAt;
  const token = h!.tokenOf('outsider');
  const res = h!.api.handle({method:'POST', path:'/reply/draft', token, ip:'127.0.0.1', body:{letterId:id,draftKey:key,cancel:true}});
  expect(res.status).toBe(404);
  expect(h!.db.letterById(id)!.replyDraftDueAt).toBe(due);
});
it('failed server persistence rolls back pending metadata and confirms only after retry', async () => {
  const id = await setup(); const fail = vi.spyOn(h!.db,'save').mockReturnValue(false);
  try { await draft(); } finally { fail.mockRestore(); }
  expect(h!.db.letterById(id)!.replyDraftKey).toBeUndefined();
  expect(h!.world.pageDeps().snapshot().replyDraft!.autoSendAt).toBeUndefined();
  h!.clock.t += 60_001; await tick();
  expect(h!.db.letterById(id)!.replyDraftKey).toBeTruthy();
});
it('failed reply persistence leaves the protected draft retryable without charging quota', async () => {
  const id = await setup(); await draft();
  const bot = h!.db.bots.find(b=>b.clientHash===h!.db.letterById(id)!.catcherHash)!;
  const spent = bot.repliesMade;
  h!.clock.t = h!.world.pageDeps().snapshot().replyDraft!.autoSendAt!;
  const fail = vi.spyOn(h!.db,'save').mockReturnValue(false);
  try { await tick(); } finally { fail.mockRestore(); }
  expect(h!.db.letterById(id)!.state).toBe('caught');
  expect(h!.db.letterById(id)!.replyDraftKey).toBeTruthy();
  expect(bot.repliesMade).toBe(spent);
  expect(h!.db.replies).toHaveLength(0);
  h!.clock.t += 60_001; await tick();
  expect(h!.db.replies).toHaveLength(1);
});
it('the compatibility read endpoint also preserves the original return deadline', async () => {
  const id = await setup(), deadline = h!.db.letterById(id)!.replyWindowUntil;
  const res = h!.api.handle({method:'POST', path:'/read', token:(h!.world as any).token(), ip:'127.0.0.1', body:{letterId:id}});
  expect(res.status).toBe(200);
  expect(h!.db.letterById(id)!.replyWindowUntil).toBe(deadline);
});

it('server restart preserves only pending metadata, never the original or reply body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bottle-auto-reply-'));
  try {
    const file = join(dir, 'db.json'); let db = Db.open(file);
    const now = Date.parse('2026-11-06T10:00:00+08:00');
    const options = { now: () => now, newToken: () => 'token', ipLimit: 100 };
    let api = createApi(db, options);
    function call(path: string, body?: unknown) { return api.handle({method: 'POST', path, token: 'token', ip: '127.0.0.1', body}); }
    expect(call('/register', {hash: sha256('holder')}).status).toBe(200);
    const holder = db.bots[0]!;
    db.letters.push({id: 'letter_pending', authorHash: sha256('author'), body: '原信隐私', topic: '标题隐私', createdAt: now - 23 * hour,
      state: 'caught', catcherHash: holder.clientHash, caughtAt: now - 23 * hour, replyWindowUntil: now + hour, deliveredCount: 1, throws: 0});
    expect(call('/reply/draft', {letterId: 'letter_pending', draftKey: 'unique_draft'}).status).toBe(200);
    const disk = readFileSync(file, 'utf8');
    expect(disk).not.toContain('原信隐私'); expect(disk).not.toContain('标题隐私');
    db = Db.open(file); api = createApi(db, {...options, now: () => now + 3 * hour});
    expect(db.letterById('letter_pending')!.state).toBe('caught');
    const quota=api.handle({method:'GET',path:'/quota',token:'token',ip:'127.0.0.1'});
    expect((quota.body as any).deadLetters).toEqual([]);
    expect(call('/reply', {letterId: 'letter_pending', draftKey: 'unique_draft', body: '回信隐私'}).status).toBe(200);
    expect(readFileSync(file, 'utf8')).not.toContain('回信隐私');
    expect(db.letterById('letter_pending')!.replyDraftKey).toBeUndefined();
    db = Db.open(file); api = createApi(db, {...options, now: () => now + 3 * hour});
    expect(call('/reply', {letterId: 'letter_pending', draftKey: 'unique_draft', body: '回信隐私'}).status).toBe(200);
    expect(db.replies).toHaveLength(1);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
