/**
 * World 这一侧的种子瓶（§13）。
 *
 * 服务端能给出种子是一回事；World 得把它当成「海边邮局寄来的、不会回信」的东西，
 * 而不是当成某个人类——否则页面会把来源写错，人类还会看到一个点了没用的「回信」。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedStore } from '../server/seeds.ts';
import { heldLetterCard } from '../world/cards.ts';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';

let h: Harness;
let host: FakeHost;
let root: string;
let seeds: SeedStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bottle-world-seeds-'));
  const dir = join(root, 'seeds');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'a.json'),
    JSON.stringify(
      {
        id: 'seed_a',
        body: '海边邮局的第一封信。',
        signature: '邮差',
        topic: '开场',
      },
      null,
      2,
    ),
    'utf8',
  );

  seeds = new SeedStore({ dir });
  seeds.start();

  h = makeHarness({ seeds });
  host = new FakeHost();
});

afterEach(async () => {
  await h.stop();
  seeds.stop();
  rmSync(root, { recursive: true, force: true });
});

async function started(): Promise<Harness['world']> {
  await h.world.start(host);
  await vi.waitFor(
    () => {
      expect(h.world.envPromptVars()['bottle.bottles']).not.toBe('');
    },
    { timeout: 3000, interval: 20 },
  );
  return h.world;
}

describe('World · 种子瓶', () => {
  it('回执说「来自海边邮局」，不化成「一位陌生人」', async () => {
    const world = await started();
    const receipt = await callTool(world, 'bottle_catch');

    expect(receipt).toContain('来自 海边邮局');
    expect(receipt).not.toContain('一位陌生人');
    // §13.7：得说清它不回信，别让模型以为在等它写
    expect(receipt).toContain('不会回信');
    // 正文照旧不进回执
    expect(receipt).not.toContain('第一封信');
  });

  it('手里那封带着 seed 标记，正文和落款都留给页面', async () => {
    const world = await started();
    await callTool(world, 'bottle_catch');

    const held = world.pageDeps().snapshot().held;
    expect(held?.from).toBe('海边邮局');
    expect(held?.body).toContain('第一封信');
    expect(held?.seed).toBe(true);
    expect(held?.signature).toBe('邮差');
    expect(held?.topic).toBe('开场');
  });

  it('卡片把来源写对，而且没有「回信」按钮', async () => {
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = world.pageDeps().snapshot().held!;

    const card = heldLetterCard({
      base: 'http://127.0.0.1:7796/',
      held: {
        letterId: held.letterId,
        from: held.from,
        body: held.body,
        caughtAt: 0,
        windowUntil: 0,
        seed: true,
        ...(held.signature ? { signature: held.signature } : {}),
        ...(held.topic ? { topic: held.topic } : {}),
      },
      hoursLeft: 72,
    });

    expect(card.eyebrow).toContain('海边邮局');
    expect(card.from).toBe('来自 海边邮局');
    expect(card.body).toContain('邮差');
    expect(card.meta).toContain('不会回信');
    // 只有「收好」：留一个点了石沉大海的「回信」等于骗人类
    expect(card.actions.map((action) => action.id)).toEqual(['dismiss']);
    expect(card.actions[0]!.label).toBe('收好');
  });

  it('点「回信」被拒，也不会把正文递进上下文', async () => {
    const world = await started();
    await callTool(world, 'bottle_catch');

    const opened = await world.pageDeps().open('page');
    expect(opened.ok).toBe(false);
    expect(opened.message).toContain('不会回信');

    // 没授权就没有外部事件：正文一个字都没进模型
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.last('bottle.reading')).toBeUndefined();
  });

  it('就算拿到 letterId，也写不出回信草稿', async () => {
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = world.pageDeps().snapshot().held!;

    const receipt = await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '我还是想回。' });
    expect(receipt).toContain('不能回');
    expect(world.pageDeps().snapshot().draft).toBeNull();
  });

  it('「收好」只是放下：不调服务端的裂缝逻辑，回执也不提裂缝', async () => {
    const world = await started();
    await callTool(world, 'bottle_catch');

    const result = await world.pageDeps().dismiss();
    expect(result.ok).toBe(true);
    expect(result.message).toBe('收好了。');
    expect(result.message).not.toContain('裂缝');

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.held).toBeNull();
    expect(snapshot.received[0]!.seed).toBe(true);
    expect(snapshot.received[0]!.outcome).toBe('dismissed');
  });

  it('信箱回执里也说明它不会回信', async () => {
    const world = await started();
    await callTool(world, 'bottle_catch');

    const receipt = await callTool(world, 'bottle_mailbox');
    expect(receipt).toContain('海边邮局');
    expect(receipt).toContain('不会回信');
    expect(receipt).not.toContain('第一封信');
  });

  it('种子信不会在 72 小时后自己回海（它本来就不在池子里）', async () => {
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = world.pageDeps().snapshot().held!;

    // 往后拨五天：真信早就回海了，种子还应该在手里
    h.clock.t += 5 * 24 * 3_600_000;
    const later = world.pageDeps().snapshot().held;
    expect(later?.letterId).toBe(held.letterId);
    expect(later?.seed).toBe(true);
  });

  it('再捞一次会说手里那封不会回信，而不是催模型去回它', async () => {
    const world = await started();
    await callTool(world, 'bottle_catch');

    const receipt = await callTool(world, 'bottle_catch');
    expect(receipt).toContain('海边邮局');
    expect(receipt).toContain('不会回信');
    expect(receipt).not.toContain('回它');
  });
});
