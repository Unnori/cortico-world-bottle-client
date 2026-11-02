import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';
import { handlePage } from '../world/page.ts';
import { LocalStore } from '../world/store.ts';
import type { WakeState } from '../world/wake.ts';
import { readGroupValues, setByPath } from 'cortico/core/config-schema.ts';
import { BOTTLE_CONFIG_GROUPS } from '../world/config.ts';
import { BottleClient, BottleError } from '../world/client.ts';
import { MAX_THROWS } from '../shared/contract.ts';

const HOUR = 3_600_000;
let h: Harness | undefined;
let host: FakeHost;
beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); host = new FakeHost(); });
afterEach(async () => { await h?.stop(); h = undefined; vi.restoreAllMocks(); vi.useRealTimers(); });
async function start(send = 3, catches = 3, replies = 3, config = {}) {
  h = makeHarness({ random: () => 0, config,
    rules: { sendBase: send, sendCap: send, catchBase: catches, catchCap: catches, poolDivisor: 5, replyCap: replies } });
  await h.world.start(host);
  await vi.waitFor(() => expect(h!.world.envPromptVars()['bottle.bottles']).not.toBe(''));
  return h;
}
async function tick(hours = 0) {
  h!.clock.t += hours * HOUR;
  await vi.advanceTimersByTimeAsync(60_000);
}
async function status(): Promise<{ wake: WakeState }> {
  return await h!.world.webUi().invoke!('mailbox', 'status', []) as { wake: WakeState };
}

describe('World 随机邀请接线', () => {
  it.each([
    [1, 3, 3, 'catch'], [0, 3, 3, 'catch'], [3, 1, 3, 'write'], [3, 3, 1, 'write'],
    [1, 1, 3, null], [1, 3, 1, null], [1, 3, 0, null],
  ] as const)('写 %s / 捞 %s / 回 %s 时只安排 %s', async (send, catches, replies, expected) => {
    await start(send, catches, replies); await tick(); await tick(2);
    expect(host.deferred).toHaveLength(expected ? 1 : 0);
    if (expected) expect(host.deferred[0].meta?.action).toBe(expected);
    expect(host.events.some(e => e.type === 'bottle.wake')).toBe(false);
  });
  it('写信邀请尊重自主意愿，成功写草稿才完成，不会自动寄出', async () => {
    const rig = await start(3, 1, 3); await tick(); await tick(2);
    const id = host.deferred[0].meta?.taskId;
    const events = await host.deliverDeferred(rig.world);
    expect(events[0].origin).toBe('internal');
    expect(events[0].text).toContain('今天写了 0 封');
    expect(events[0].text).toContain('小感受也值得写');
    expect(events[0].text).not.toContain(String(id));
    rig.world.onTurnEnded();
    expect((await status()).wake.active?.phase).toBe('retry');
    await tick(0.5); await host.deliverDeferred(rig.world);
    expect((await status()).wake.active?.id).toBe(id);
    await callTool(rig.world, 'bottle_write', { title: '风的声音', text: '刚才听见风碰了碰窗沿。' });
    rig.world.onTurnEnded();
    expect((await status()).wake.history.at(-1)?.result).toBe('completed');
    expect(rig.world.pageDeps().snapshot().letterDraft).not.toBeNull();
    expect(rig.world.pageDeps().snapshot().sent).toHaveLength(0);
  });
  it('打捞邀请给出额度与上次收信间隔，不自动捞取或读信', async () => {
    const rig = await start(1, 3, 3); await tick(); await tick(2);
    const events = await host.deliverDeferred(rig.world);
    expect(events[0].text).toContain('今日可捞 3 次，可回信 3 次');
    expect(events[0].text).toContain('还没收过信');
    expect(rig.world.pageDeps().snapshot().held).toBeNull();
    rig.throwAs('peer', '留在页面里的陌生来信。');
    await callTool(rig.world, 'bottle_catch');
    expect((await status()).wake.history.at(-1)?.result).toBe('completed');
    expect(host.events.some(e => e.type === 'bottle.reading')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('留在页面里的陌生来信');
  });
  it('一轮可以明确选择不做，记录原因，不作为失败重试', async () => {
    const rig = await start(); await tick(); await tick(2); await host.deliverDeferred(rig.world);
    const reply = await callTool(rig.world, 'bottle_wake_choice', { action: 'write', reason: 'no_idea' });
    expect(reply).toContain('不必勉强');
    rig.world.onTurnEnded();
    expect((await status()).wake.history.at(-1)).toMatchObject({ result: 'deferred', reason: 'no_idea' });
    expect(rig.world.pageDeps().snapshot().letterDraft).toBeNull();
  });
  it.each(['draft', 'held', 'authorized', 'request', 'busy', 'running', 'disabled'] as const)('%s 时不安排随机邀请', async condition => {
    const rig = await start(3, 3, 3, condition === 'disabled' ? { randomWake: false } : {});
    if (condition === 'draft') await callTool(rig.world, 'bottle_write', { title: '留在岸边', text: '还在等人看的一封信。' });
    if (condition === 'held' || condition === 'authorized') {
      rig.throwAs('peer', '未处理来信。'); await callTool(rig.world, 'bottle_catch');
      if (condition === 'authorized') {
        await rig.world.pageDeps().open('page');
        expect(await callTool(rig.world, 'bottle_wake_choice', { action: 'write', reason: 'user_paused' })).toContain('这一轮只写回信');
        expect((await status()).wake.lanes.write.paused).toBe(false);
      }
    }
    if (condition === 'request') await rig.world.pageDeps().request('write');
    if (condition === 'running') rig.world.onRunPhase({ state: 'idle', running: ['bottle_write'], enteredAt: '' });
    if (condition === 'busy') rig.world.onRunPhase({ state: 'model', running: [], enteredAt: '' });
    await tick();
    if (condition === 'request') await rig.world.pageDeps().request('write');
    // The due check sees a fresh human request, not an expired one.
    rig.clock.t += 2 * HOUR;
    if (condition === 'request') await rig.world.pageDeps().request('write');
    await tick();
    expect(host.deferred).toHaveLength(condition === 'draft' || condition === 'held' ? 1 : 0);
    if (condition === 'draft' || condition === 'held') expect(host.deferred[0].meta?.action).toBe('remind');
  });
  it('排队后新草稿出现会取消邀请，宿主暂停期间不入模型、不积压', async () => {
    const rig = await start(); await tick(); await tick(2);
    await tick(1); await tick(1);
    expect(host.deferred).toHaveLength(1);
    expect(host.events.some(e => e.type === 'bottle.wake')).toBe(false);
    await callTool(rig.world, 'bottle_write', { title: '后来有了想法', text: '这封来自原本的对话。' });
    expect(await host.deliverDeferred(rig.world)).toHaveLength(0);
  });
  it('暂停跨重启保存，旧队列回调失效，恢复后也不立刻补催', async () => {
    const rig = await start(); await tick(); await tick(2);
    const stale = host.deferred[0];
    await callTool(rig.world, 'bottle_wake_choice', { action: 'write', reason: 'user_paused' });
    await rig.world.stop(); await rig.world.start(host);
    expect(await stale.render()).toBeNull();
    expect((await status()).wake.lanes.write.paused).toBe(true);
    await rig.world.webUi().invoke!('mailbox', 'wake', ['write', 'resume']);
    expect((await status()).wake.lanes.write.paused).toBe(false);
    expect((await status()).wake.lanes.write.nextAt).toBe(rig.clock.t + 2 * HOUR);
  });
});


describe('信箱行动主体、提醒与可调间隔', () => {
  it('默认按钮立即排一份自主邀请，不强制写、不泄漏任务编号', async () => {
    const rig = await start();
    const page = rig.world.pageDeps();
    const response = await handlePage(page, 'POST', '/write');
    expect(response.json).toMatchObject({ ok: true });
    expect(host.deferred).toHaveLength(1);
    expect(host.events.filter(e => e.type === 'bottle.request')).toHaveLength(0);
    expect(page.snapshot().letterDraft).toBeNull();
    const [event] = await host.deliverDeferred(rig.world);
    expect(event.text).toContain('小感受也值得写');
    expect(event.text).not.toContain(String(event.meta!.taskId));
    expect((await status()).wake.active).toMatchObject({ action: 'write', manual: true });
  });
  it('两个按钮各有服务端一分钟冷却，手动邀请不挤占自动次数', async () => {
    const rig = await start(); const page = rig.world.pageDeps();
    await page.request('write', 'bot'); await host.deliverDeferred(rig.world);
    await callTool(rig.world, 'bottle_wake_choice', { action: 'write', reason: 'not_now' });
    expect((await page.request('write', 'bot')).ok).toBe(false);
    expect((await page.request('catch', 'bot')).ok).toBe(true);
    await host.deliverDeferred(rig.world);
    await callTool(rig.world, 'bottle_wake_choice', { action: 'catch', reason: 'not_now' });
    expect((await page.request('catch', 'bot')).ok).toBe(false);
    expect((await status()).wake.lanes.write.count).toBe(0);
    rig.clock.t += 60_001;
    expect((await page.request('write', 'bot')).ok).toBe(true);
  });
  it('手动邀请允许最后一次机会，自动邀请仍严格大于 1，暂停不会被按钮绕过', async () => {
    const rig = await start(1, 1, 1);
    await tick(); await tick(2); expect(host.deferred).toHaveLength(0);
    expect((await rig.world.pageDeps().request('write', 'bot')).ok).toBe(true);
    await host.deliverDeferred(rig.world);
    await callTool(rig.world, 'bottle_wake_choice', { action: 'write', reason: 'user_paused' });
    rig.clock.t += 60_001;
    expect((await rig.world.pageDeps().request('write', 'bot')).ok).toBe(false);
  });
  it('选择人直接打捞，不向桌宠发事件；点回信后才递交署名、标题、正文，重启仍记得是谁捞的', async () => {
    const rig = await start(); const page = rig.world.pageDeps();
    rig.throwAs('peer', '只在回信后才能看的原文。');
    const row = rig.db.letters[0]!; row.topic = '来自潮间带';
    const before = host.events.length;
    const result = await handlePage(page, 'POST', '/catch', { body: { actor: 'human' } });
    expect(result.json).toMatchObject({ ok: true });
    expect(page.snapshot().held?.body).toBe('只在回信后才能看的原文。');
    expect(host.events.length).toBe(before);
    const disk = new LocalStore(rig.dir); disk.load();
    expect(disk.held?.caughtBy).toBe('human');
    await rig.world.stop(); await rig.world.start(host);
    await page.open('page');
    const reading = host.last('bottle.reading')!;
    expect(reading.origin).toBe('external');
    expect(reading.text).toContain('人去海边捞了一封信，署名是');
    expect(reading.text).toContain('人想请你回复这封信');
    expect(reading.text).toContain('标题：来自潮间带');
    expect(reading.text).toContain('只在回信后才能看的原文');
    expect(reading.text).not.toContain(row.id);
  });
  it('人的直接写信与打捞不受邀请按钮冷却限制', async () => {
    const rig = await start(); const page = rig.world.pageDeps();
    await page.request('catch', 'bot'); await host.deliverDeferred(rig.world);
    await callTool(rig.world, 'bottle_wake_choice', { action: 'catch', reason: 'not_now' });
    rig.throwAs('peer', '人在海边捞起来的一封。');
    expect((await page.request('catch', 'human')).ok).toBe(true);
    expect((await page.request('write', 'human')).ok).toBe(true);
    expect(host.last('bottle.request')?.text).toContain('小感受也值得写');
  });
  it('有信和草稿只安排不含正文的待办提醒，提醒送达即完成，不因没有工具调用重试', async () => {
    const rig = await start();
    rig.throwAs('peer', '不能泄露给模型的正文。'); await rig.world.pageDeps().request('catch', 'human');
    await callTool(rig.world, 'bottle_write', { title: '留在岸边', text: '这是一份没寄的草稿。' });
    await tick(); await tick(2);
    expect(host.deferred).toHaveLength(1); expect(host.deferred[0].meta?.action).toBe('remind');
    const [event] = await host.deliverDeferred(rig.world);
    expect(event.text).toContain('1 封来信、1 份草稿');
    expect(event.text).toContain('先放着就别催');
    expect(event.text).not.toContain('不能泄露给模型的正文');
    expect(event.text).not.toContain('这是一份没寄的草稿');
    rig.world.onTurnEnded();
    expect((await status()).wake.active).toBeNull();
    expect((await status()).wake.history.at(-1)).toMatchObject({ action: 'remind', result: 'completed' });
  });
  it('待办处理后取消已排队的提醒；暂停提醒不影响别的类别', async () => {
    const rig = await start(); const page = rig.world.pageDeps();
    await callTool(rig.world, 'bottle_write', { title: '一份草稿', text: '还没寄。' });
    await tick(); await tick(2); await page.discard('letter');
    expect(await host.deliverDeferred(rig.world)).toHaveLength(0);
    expect((await status()).wake.history.at(-1)).toMatchObject({ action: 'remind', result: 'cancelled' });
    await handlePage(page, 'POST', '/wake', { body: { action: 'remind', command: 'pause' } });
    expect((await status()).wake.lanes.remind.paused).toBe(true);
    expect((await status()).wake.lanes.write.paused).toBe(false);
  });
  it('独立网页和扩展页签共用暂停/间隔，持久化并校验输入', async () => {
    const rig = await start(); const page = rig.world.pageDeps();
    expect((await handlePage(page, 'POST', '/wake', { body: { action: 'write', command: 'interval', hours: 6 } })).json).toMatchObject({ ok: true });
    await rig.world.webUi().invoke!('mailbox', 'wake', ['catch', 'pause']);
    expect((await status()).wake.lanes.write.intervalHours).toBe(6);
    expect(page.snapshot().wake?.lanes.catch.paused).toBe(true);
    expect((await handlePage(page, 'POST', '/wake', { body: { action: 'write', command: 'interval', hours: 1 } })).status).toBe(400);
    expect((await rig.world.webUi().invoke!('mailbox', 'wake', ['write', 'interval', NaN]))).toMatchObject({ ok: false });
    await rig.world.stop(); await rig.world.start(host);
    expect((await status()).wake.lanes.write.intervalHours).toBe(6);
    expect(page.snapshot().wake?.lanes.catch.paused).toBe(true);
  });
  it('浏览信箱时五秒内同步远端额度，原生配置页顶栏明确标注快照', async () => {
    const rig = await start(3, 3, 3); const page = rig.world.pageDeps();
    expect(page.snapshot().quota?.bottles_left).toBe(3);
    rig.db.bots[0]!.bottlesUsed = 2;
    rig.clock.t += 5001;
    const response = await handlePage(page, 'GET', '/draft');
    expect(response.json).toMatchObject({ quota: { bottles_left: 1 } });
    expect(rig.world.webUi().badges?.[0]).toMatchObject({ label: '可寄（快照）', value: 1 });
  });
});


it('待办提醒也能明确延后或按人的选择暂停，不需要产生空信来结束任务', async () => {
  const rig = await start();
  await callTool(rig.world, 'bottle_write', { title: '留给明天', text: '还没有寄。' });
  await tick(); await tick(2); await host.deliverDeferred(rig.world);
  expect(await callTool(rig.world, 'bottle_wake_choice', { action: 'remind', reason: 'not_now' })).toContain('不必勉强');
  rig.world.onTurnEnded();
  expect((await status()).wake.history.at(-1)).toMatchObject({ action: 'remind', result: 'deferred' });
  await callTool(rig.world, 'bottle_wake_choice', { action: 'remind', reason: 'user_paused' });
  await tick(3);
  expect(host.deferred).toHaveLength(0);
  expect((await status()).wake.lanes.remind.paused).toBe(true);
});


it.each([undefined, 'remind', 'catch'] as const)('写信邀请的 no_idea 不受错误或缺省 action=%s 影响，不会误报失败', async action => {
  const rig = await start(); await tick(); await tick(2);
  const [event] = await host.deliverDeferred(rig.world);
  expect(event.meta?.action).toBe('write');
  expect(await callTool(rig.world, 'bottle_wake_choice', { ...(action ? { action } : {}), reason: 'no_idea' })).toContain('不算失败');
  rig.world.onTurnEnded();
  const wake = (await status()).wake;
  expect(wake.active).toBeNull();
  expect(wake.history.at(-1)).toMatchObject({ action: 'write', result: 'deferred', reason: 'no_idea' });
  expect(wake.lanes.write.failed).toBe(false);
  expect(rig.world.pageDeps().snapshot().letterDraft).toBeNull();
  await tick(0.5);
  expect(host.deferred).toHaveLength(0);
});


describe('原配置页与信箱设置共用同一份偏好', () => {
  it('原配置页的三个开关与间隔无需重启即可同步到任务和网页', async () => {
    const rig = await start();
    Object.assign(rig.cfg, { writeInviteEnabled: false, writeInviteIntervalHours: 7,
      catchInviteEnabled: false, catchInviteIntervalHours: 5, reminderEnabled: false, reminderIntervalHours: 9 });
    const snapshot = rig.world.pageDeps().snapshot().wake!;
    expect(snapshot.lanes.write).toMatchObject({ paused: true, intervalHours: 7 });
    expect(snapshot.lanes.catch).toMatchObject({ paused: true, intervalHours: 5 });
    expect(snapshot.lanes.remind).toMatchObject({ paused: true, intervalHours: 9 });
    await tick(10);
    expect(host.deferred).toHaveLength(0);
    rig.cfg.writeInviteEnabled = true;
    expect((await status()).wake.lanes.write.paused).toBe(false);
    expect((await status()).wake.lanes.write.nextAt).toBe(rig.clock.t + 7 * HOUR);
  });

  it('网页和面板的修改会写回原配置页，也跨 World 重启保留', async () => {
    const rig = await start();
    await rig.world.pageDeps().wakeControl!('catch', 'interval', 6);
    await rig.world.pageDeps().wakeControl!('catch', 'pause');
    await rig.world.webUi().invoke!('mailbox', 'wake', ['remind', 'interval', 8]);
    await rig.world.webUi().invoke!('mailbox', 'wake', ['remind', 'pause']);
    expect(rig.cfg).toMatchObject({ catchInviteEnabled: false, catchInviteIntervalHours: 6,
      reminderEnabled: false, reminderIntervalHours: 8 });
    expect(rig.persistedConfig).toContainEqual({ catchInviteEnabled: false });
    expect(rig.persistedConfig).toContainEqual({ reminderIntervalHours: 8 });
    await rig.world.stop(); await rig.world.start(host);
    const lanes = (await status()).wake.lanes;
    expect(lanes.catch).toMatchObject({ paused: true, intervalHours: 6 });
    expect(lanes.remind).toMatchObject({ paused: true, intervalHours: 8 });
    await rig.world.webUi().invoke!('mailbox', 'wake', ['catch', 'resume']);
    expect(rig.cfg.catchInviteEnabled).toBe(true);
  });

  it('人通过桌宠暂停也会同步原配置页，不被下一轮配置读取反向恢复', async () => {
    const rig = await start();
    expect(await callTool(rig.world, 'bottle_wake_choice', { action: 'write', reason: 'user_paused' })).toContain('已暂停');
    expect(rig.cfg.writeInviteEnabled).toBe(false);
    expect((await status()).wake.lanes.write.paused).toBe(true);
    expect(rig.persistedConfig).toContainEqual({ writeInviteEnabled: false });
    await tick(4);
    expect((await status()).wake.lanes.write.paused).toBe(true);
  });

  it('状态轮询不会重排下一次时间或偷偷清除今天的拒绝', async () => {
    await start(); await tick();
    const before = (await status()).wake.lanes.write.nextAt;
    await tick(0.25);
    for (let i = 0; i < 4; i++) await status();
    expect((await status()).wake.lanes.write.nextAt).toBe(before);
    await callTool(h!.world, 'bottle_wake_choice', { action: 'write', reason: 'user_declined' });
    expect((await status()).wake.lanes.write.declined).toBe(true);
    expect(h!.cfg.writeInviteEnabled).toBe(true);
  });
});


it('框架原生配置的路径写入与读取直接连接同一份设置，不依赖自定义信箱面板', async () => {
  const rig = await start();
  const config = { worlds: { bottle: rig.cfg } };
  setByPath(config, 'worlds.bottle.writeInviteEnabled', false);
  setByPath(config, 'worlds.bottle.writeInviteIntervalHours', 10);
  const lane = rig.world.pageDeps().snapshot().wake!.lanes.write;
  expect(lane).toMatchObject({ paused: true, intervalHours: 10 });
  await rig.world.pageDeps().wakeControl!('write', 'resume');
  const values = readGroupValues(config as never, BOTTLE_CONFIG_GROUPS.find(group => group.id === 'world:bottle:invitations')!);
  expect(values['worlds.bottle.writeInviteEnabled']).toBe(true);
  expect(values['worlds.bottle.writeInviteIntervalHours']).toBe(10);
});

describe('手动邀请的额度和失败原因', () => {
  it('回信次数为零仍可邀请写信，短暂刷新失败不覆盖有效额度', async () => {
    const rig = await start(2, 5, 0);
    rig.clock.t += 5001;
    vi.spyOn(BottleClient.prototype, 'quota').mockRejectedValue(new BottleError('internal', 503, '暂时不可用'));
    const response = await handlePage(rig.world.pageDeps(), 'POST', '/write', { body: { actor: 'bot' } });
    expect(response.json).toMatchObject({ ok: true });
    expect(rig.world.pageDeps().snapshot()).toMatchObject({ online: false, quota: { bottles_left: 2, replies_left: 0 } });
    const [event] = await host.deliverDeferred(rig.world);
    expect(event).toMatchObject({ type: 'bottle.wake', meta: { action: 'write' } });
    expect(await callTool(rig.world, 'bottle_write', { text: '今天想把晚风装进信里。' })).toContain('信');
    expect(rig.world.pageDeps().snapshot().letterDraft?.body).toBe('今天想把晚风装进信里。');
    expect(rig.world.pageDeps().snapshot().wake?.active).toBeNull();
  });
  it.each(['expired', 'next_day'] as const)('离线时不使用 %s 的额度快照，也不进入冷却', async condition => {
    const rig = await start();
    rig.clock.t += condition === 'expired' ? 300_001 : 24 * HOUR;
    vi.spyOn(BottleClient.prototype, 'quota').mockRejectedValue(new BottleError('internal', 503, '暂时不可用'));
    expect(await rig.world.pageDeps().request('write', 'bot')).toMatchObject({ ok: false, message: expect.stringContaining('无法确认') });
    expect(host.deferred).toHaveLength(0);
    expect(rig.world.pageDeps().snapshot().cooldowns?.write).toBeUndefined();
  });
  it('自动邀请在暂时离线时仍停止，手动宽限不扩散到后台', async () => {
    const rig = await start();
    vi.spyOn(BottleClient.prototype, 'quota').mockRejectedValue(new BottleError('internal', 503, '暂时不可用'));
    await tick(0.01);
    expect(rig.world.pageDeps().snapshot().online).toBe(false);
    expect(rig.world.pageDeps().snapshot().wake?.lanes.write.nextAt).toBeNull();
    expect(host.deferred).toHaveLength(0);
  });
  it('没有写信额度时说明原因，不误报忙碌', async () => {
    const rig = await start(0, 5, 5);
    expect(await rig.world.pageDeps().request('write', 'bot')).toMatchObject({ ok: false, message: expect.stringContaining('瓶子用完') });
    expect(host.deferred).toHaveLength(0);
  });
  it('暂停时说明恢复入口，不误报没有额度', async () => {
    const rig = await start(2, 5, 0, { writeInviteEnabled: false });
    expect(await rig.world.pageDeps().request('write', 'bot')).toMatchObject({ ok: false, message: expect.stringContaining('已暂停') });
    expect(host.deferred).toHaveLength(0);
  });
});

it('手动邀请在新的一天恢复，不被昨天的拒绝文案拦住', async () => {
  const rig = await start();
  await rig.world.pageDeps().request('write', 'bot');
  await host.deliverDeferred(rig.world);
  await callTool(rig.world, 'bottle_wake_choice', { reason: 'user_declined' });
  rig.clock.t += 24 * HOUR;
  expect(await rig.world.pageDeps().request('write', 'bot')).toMatchObject({ ok: true });
});

describe('按打捞者区分归还通知', () => {
  it.each(['human', 'bot', 'legacy'] as const)('%s 捞起的瓶子重启后归还，保留各自的通知行为', async actor => {
    const rig = await start();
    const letterId = rig.throwAs('peer', '这是一封用于测试归还的信。');
    if (actor === 'human') expect((await rig.world.pageDeps().request('catch', 'human')).ok).toBe(true);
    else await callTool(rig.world, 'bottle_catch');
    if (actor === 'legacy') {
      const disk = new LocalStore(rig.dir); disk.load();
      const held = disk.held!; delete held.caughtBy; disk.setHeld(held);
    }
    await rig.world.stop(); await rig.world.start(host);
    const before = host.events.length;
    const result = await handlePage(rig.world.pageDeps(), 'POST', '/dismiss');
    expect(result.json).toMatchObject({ ok: true });
    expect(rig.world.pageDeps().snapshot()).toMatchObject({ held: null, received: [expect.objectContaining({ letterId, outcome: 'dismissed' })] });
    expect(rig.db.letters.find(letter => letter.id === letterId)).toMatchObject({ state: 'floating', throws: 1 });
    const notifications = host.events.slice(before);
    if (actor === 'human') expect(notifications).toEqual([]);
    else expect(notifications).toEqual([expect.objectContaining({ type: 'bottle.dismissed', meta: { throws: 1, sank: false, counted: true } })]);
  });
  it.each(['human', 'bot'] as const)('%s 捞起的瓶子归还时沉底，也按原打捞者决定是否通知', async actor => {
    const rig = await start();
    const letterId = rig.throwAs('peer', '这只测试瓶子已经接近沉底。');
    rig.db.letters[0]!.throws = MAX_THROWS - 1;
    if (actor === 'human') expect((await rig.world.pageDeps().request('catch', 'human')).ok).toBe(true);
    else await callTool(rig.world, 'bottle_catch');
    const before = host.events.length;
    expect((await rig.world.pageDeps().dismiss()).ok).toBe(true);
    expect(rig.world.pageDeps().snapshot().received[0]!.outcome).toBe('sank');
    expect(rig.db.letters.find(letter => letter.id === letterId)).toMatchObject({ state: 'archived', archivedReason: 'sunk', throws: MAX_THROWS });
    expect(host.events.slice(before).filter(event => event.type === 'bottle.dismissed')).toHaveLength(actor === 'human' ? 0 : 1);
  });
});
