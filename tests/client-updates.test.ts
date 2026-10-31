import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTuningReader } from '../server/tuning.ts';
import { LocalStore } from '../world/store.ts';
import { handlePage } from '../world/page.ts';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';

let h: Harness | undefined;
afterEach(async () => { await h?.stop(); h = undefined; });

async function setup() {
  const tuning = structuredClone(makeTuningReader(null).current());
  h = makeHarness({ tuning: { current: () => tuning } });
  const host = new FakeHost();
  await h.world.start(host);
  await vi.waitFor(() => expect(h!.world.envPromptVars()['bottle.bottles']).not.toBe(''));
  return { ...h, host, tuning, page: h.world.pageDeps() };
}

async function poll(harness: Harness) {
  harness.clock.t += 5 * 60_000 + 1;
  harness.world.pageDeps().snapshot();
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('客户端退潮与公告', () => {
  it('退潮原文返回、信稿落盘保留，不扣额度；回潮后只寄一次', async () => {
    const rig = await setup();
    const body = '这封信留到潮水回来。';
    await callTool(rig.world, 'bottle_write', { title: '海边小记', text: body });
    const disk = new LocalStore(rig.dir);
    disk.load();
    const before = rig.page.snapshot().quota!.bottles_left;
    rig.tuning.tideOut = { until: '2099-01-01T00:00:00Z', blockThrow: true, blockReply: false, text: '潮水退了，请把信先收好。' };
    const result = await rig.page.send('letter');
    expect(result).toEqual({ ok: false, reason: 'tide_out', close: false, message: rig.tuning.tideOut.text });
    expect(rig.page.snapshot().letterDraft?.body).toBe(body);
    expect(rig.page.snapshot().sent).toEqual([]);
    expect(rig.page.snapshot().quota!.bottles_left).toBe(before);
    expect(rig.host.events.some((e) => e.type === 'bottle.sent')).toBe(false);
    disk.load();
    expect(disk.letterDraft?.body).toBe(body);
    expect(disk.sent).toEqual([]);
    rig.tuning.tideOut.blockThrow = false;
    const results = await Promise.all([rig.page.send('letter'), rig.page.send('letter')]);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(rig.page.snapshot().sent).toHaveLength(1);
    expect(rig.page.snapshot().letterDraft).toBeNull();
    expect(rig.page.snapshot().tideOut).toBeNull();
  });

  it('公告按 id 去重，跨重启与清历史保留；消失后清除页面公告', async () => {
    const rig = await setup();
    rig.tuning.announcement = { id: 'a', text: '海边邮局来消息了。', level: 'alarm', showUntil: '2099-01-01T00:00:00Z' };
    await poll(rig);
    await poll(rig);
    const notices = () => rig.host.events.filter((e) => e.type === 'bottle.announcement');
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatchObject({ origin: 'external', text: rig.tuning.announcement.text, meta: { id: 'a', level: 'alarm' } });
    await rig.page.forget();
    await rig.world.stop();
    await rig.world.start(rig.host);
    await poll(rig);
    expect(notices()).toHaveLength(1);
    rig.tuning.announcement.id = 'b';
    await poll(rig);
    expect(notices()).toHaveLength(2);
    rig.tuning.announcement.id = 'a';
    await poll(rig);
    expect(notices()).toHaveLength(2);
    rig.tuning.announcement = null;
    await poll(rig);
    expect(rig.page.snapshot().announcement).toBeNull();
    const disk = new LocalStore(rig.dir);
    disk.load();
    expect(disk.seenAnnouncementIds).toEqual(['a', 'b']);
  });

  it('公告投递失败时不标记已读，下次轮询会补投', async () => {
    const rig = await setup();
    const push = rig.host.pushEvent.bind(rig.host);
    const spy = vi.spyOn(rig.host, 'pushEvent').mockImplementationOnce(async () => { throw new Error('busy'); });
    rig.tuning.announcement = { id: 'retry', text: '一条消息。', level: 'notice', showUntil: '2099-01-01T00:00:00Z' };
    await poll(rig);
    const disk = new LocalStore(rig.dir);
    disk.load();
    expect(disk.seenAnnouncementIds).toEqual([]);
    spy.mockImplementation(push);
    await poll(rig);
    expect(rig.host.events.filter((e) => e.type === 'bottle.announcement')).toHaveLength(1);
  });
});

describe('网页请 Coo 写信与打捞', () => {
  it.each([['小满', '小满'], ['', '它']])('网页名称与操作回执使用部署名称 %s', async (name, expected) => {
    h = makeHarness({ botName: name });
    const host = new FakeHost();
    await h.world.start(host);
    const page = h.world.pageDeps();
    expect(page.snapshot().botName).toBe(expected);
    expect((await page.request('write')).message).toContain(expected);
    expect((await page.request('write')).message).toContain(expected);
    await callTool(h.world, 'bottle_write', { title: '海边小记', text: '给远方留一封信。' });
    expect((await page.rewrite('letter')).message).toBe(`让${expected}重写。`);
  });

  it('按钮推送立即唤起事件，不自动寄出；重复请求合并，工具执行后解除等待', async () => {
    const rig = await setup();
    expect((await handlePage(rig.page, 'POST', '/write')).status).toBe(200);
    await handlePage(rig.page, 'POST', '/write');
    const requests = () => rig.host.events.filter((e) => e.type === 'bottle.request');
    expect(requests()).toHaveLength(1);
    expect(requests()[0]).toMatchObject({ origin: 'internal', meta: { action: 'write' } });
    expect(rig.host.pushOpts[rig.host.events.indexOf(requests()[0])]).toEqual({ trigger: 'flush' });
    expect(rig.page.snapshot().pendingAction).toBe('write');
    expect(rig.page.snapshot().sent).toHaveLength(0);
    await callTool(rig.world, 'bottle_write', { title: '海边小记', text: '今晚的月亮很圆。' });
    expect(rig.page.snapshot().pendingAction).toBeNull();
    expect((await rig.page.request('write')).ok).toBe(false);
    rig.throwAs('peer', '陌生人的信不能自动给 Coo 读。');
    await handlePage(rig.page, 'POST', '/catch');
    expect(requests()).toHaveLength(2);
    expect(rig.page.snapshot().held).toBeNull();
    await callTool(rig.world, 'bottle_catch');
    expect(rig.page.snapshot().held).not.toBeNull();
    expect(rig.page.snapshot().pendingAction).toBeNull();
    expect(rig.host.events.some((e) => e.type === 'bottle.reading')).toBe(false);
    expect((await rig.page.request('catch')).ok).toBe(false);
  });

  it('被丢弃或超时的请求可重试，读信授权期间不能夹带新动作', async () => {
    const rig = await setup();
    await rig.page.request('write');
    rig.world.onEventsSettled(rig.host.events, 'discarded');
    expect(rig.page.snapshot().pendingAction).toBeNull();
    await rig.page.request('catch');
    rig.clock.t += 60_001;
    expect(rig.page.snapshot().pendingAction).toBeNull();
    rig.throwAs('peer', '请读这一封。');
    await callTool(rig.world, 'bottle_catch');
    await rig.page.open('page');
    expect((await rig.page.request('write')).ok).toBe(false);
  });
});
