/**
 * 「捞到了但本机没记下来」的死锁回归测试。
 *
 * 真实事故的链条：
 *   1. `/catch` 已经在服务端把那封信标记成 caught（记在这个人名下）
 *   2. 响应在回程丢了 / 本机写盘失败 → 客户端不知道那封信的 letterId
 *   3. 再捞：服务端回 `holding`（你手上还有一封）→ 捞不到新的
 *   4. 想放信：`/dismiss` 需要 letterId，可本机偏偏没有 → 放不掉
 *
 * 于是玩家永久卡在「海边还记着一封未处理的信」，
 * 而唯一的出路是等回信窗口（72 小时）过去。
 *
 * 这里覆盖三条修好的路径：
 *   A. 服务端 `/catch` 在 holding 时把「是哪一封」一并返回（能恢复）
 *   B. 服务端 `/dismiss` 不传 letterId 也能解开占用（兜底出口）
 *   C. 兜底路径不计入「扔回海里」的次数（瓶子不会因为网络问题裂开）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BottleClient, BottleError } from '../world/client.ts';
import { LocalStore, lastStoreWriteError } from '../world/store.ts';
import { FakeHost } from './fake-host.ts';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { createApi, sha256, type Api } from '../server/app.ts';
import { Db } from '../server/db.ts';
import { DEFAULT_TUNING, type Tuning } from '../server/tuning.ts';
import type { CatchRes, DismissRes, Quota } from '../shared/contract.ts';

const HOUR = 3_600_000;

interface Rig {
  api: Api;
  db: Db;
  clock: { t: number };
  token(who: string): string;
  catchAs(token: string): CatchRes;
  dismiss(token: string, letterId?: string): { status: number; body: unknown };
  quota(token: string): Quota;
}

const rigs: Array<{ stop(): void }> = [];

function rig(over: Partial<Tuning> = {}): Rig {
  const tuning: Tuning = { ...DEFAULT_TUNING, ...over };
  const clock = { t: Date.parse('2026-11-05T10:00:00+08:00') };
  const db = Db.open(null);
  const api = createApi(db, {
    seedChannel: 'mail',
    tuning: { current: () => tuning },
    now: () => clock.t,
    timeZone: 'Asia/Hong_Kong',
    random: () => 0.5,
    newToken: (() => {
      let n = 0;
      return () => `tok_${++n}`;
    })(),
    ipLimit: 500,
    rules: { sendBase: 50, sendCap: 50, catchBase: 50, catchCap: 50, poolDivisor: 5, replyCap: 50 },
    startedAt: clock.t,
  });
  rigs.push({ stop: () => void 0 });

  const token = (who: string): string => {
    const res = api.handle({ method: 'POST', path: '/register', ip: '1.1.1.1', body: { hash: sha256(who) } });
    expect(res.status).toBe(200);
    return (res.body as { token: string }).token;
  };
  const catchAs = (t: string): CatchRes => {
    const res = api.handle({ method: 'POST', path: '/catch', token: t, ip: '1.1.1.1', body: {} });
    expect(res.status).toBe(200);
    return res.body as CatchRes;
  };
  const dismiss = (t: string, letterId?: string) => {
    const body = letterId === undefined ? {} : { letterId };
    const res = api.handle({ method: 'POST', path: '/dismiss', token: t, ip: '1.1.1.1', body });
    return { status: res.status, body: res.body };
  };
  const quota = (t: string): Quota =>
    api.handle({ method: 'GET', path: '/quota', token: t, ip: '1.1.1.1' }).body as Quota;

  return { api, db, clock, token, catchAs, dismiss, quota };
}

/** 直接往海里塞一封可捞的信（绕过寄信额度，让测试只关心捞取链路）。 */
function seedLetter(h: Rig, authorHash = 'someone-else'): string {
  const id = `l_${Math.random().toString(36).slice(2, 10)}`;
  h.db.letters.push({
    id,
    authorHash,
    body: '一封还在漂的信。',
    createdAt: h.clock.t,
    state: 'floating',
    catcherHash: null,
    caughtAt: null,
    replyWindowUntil: null,
    deliveredCount: 0,
    throws: 0,
  });
  return id;
}

afterEach(() => {
  while (rigs.length) rigs.pop()?.stop();
});

describe('A. /catch 在 holding 时给回「是哪一封」', () => {
  it('第二次捞会带上 held，客户端因此能恢复', () => {
    const h = rig();
    const me = h.token('me');
    const letterId = seedLetter(h);

    const first = h.catchAs(me);
    expect(first.empty).toBe(false);
    if (first.empty) return;
    expect(first.letterId).toBe(letterId);

    // 模拟「本机没存下」：直接再捞一次
    const second = h.catchAs(me);
    expect(second.empty).toBe(true);
    if (!second.empty) return;
    expect(second.reason).toBe('holding');
    expect(second.held?.letterId).toBe(letterId);
    // 元信息可以给，正文绝不能出现在这里
    expect(JSON.stringify(second.held)).not.toContain('一封还在漂的信');
  });

  it('held 里的时间戳可解析，客户端能算出窗口', () => {
    const h = rig();
    const me = h.token('me');
    seedLetter(h);
    h.catchAs(me);

    const res = h.catchAs(me);
    if (!res.empty) throw new Error('应该是 holding');
    expect(Number.isFinite(Date.parse(res.held!.windowUntil!))).toBe(true);
    expect(Number.isFinite(Date.parse(res.held!.caughtAt!))).toBe(true);
    // 窗口应该是 72 小时后
    const span = Date.parse(res.held!.windowUntil!) - Date.parse(res.held!.caughtAt!);
    expect(span).toBe(72 * HOUR);
  });
});

describe('B. /dismiss 不传 letterId 也能解开占用（死锁兜底）', () => {
  it('本机完全不知道是哪封时，仍能放掉', () => {
    const h = rig();
    const me = h.token('me');
    const letterId = seedLetter(h);

    h.catchAs(me); // 服务端占用
    const held = h.catchAs(me);
    if (!held.empty) throw new Error('应该是 holding');

    // 关键：客户端拿不到 letterId，只能发一个空 body
    const res = h.dismiss(me);
    expect(res.status).toBe(200);
    expect((res.body as DismissRes).ok).toBe(true);

    // 占用真的解开了：信回到海面，且能被重新捞到
    const row = h.db.letters.find((l) => l.id === letterId)!;
    expect(row.state).toBe('floating');
    expect(row.catcherHash).toBeNull();

    const again = h.catchAs(me);
    expect(again.empty).toBe(false);
  });

  it('没有占用时也不报错（幂等，重试安全）', () => {
    const h = rig();
    const me = h.token('me');
    const res = h.dismiss(me);
    expect(res.status).toBe(200);
    expect((res.body as DismissRes).ok).toBe(true);
  });

  it('解开之后可以继续正常捞取', () => {
    const h = rig();
    const me = h.token('me');
    seedLetter(h, 'a');
    seedLetter(h, 'b');

    h.catchAs(me);
    h.catchAs(me); // holding
    h.dismiss(me); // 兜底解开

    const next = h.catchAs(me);
    expect(next.empty).toBe(false);
  });
});

describe('C. 兜底路径不算「扔回海里」，瓶子不会裂', () => {
  it('不传 letterId 的 dismiss 不增加 throws', () => {
    const h = rig();
    const me = h.token('me');
    const letterId = seedLetter(h);
    h.catchAs(me);

    const before = h.db.letters.find((l) => l.id === letterId)!.throws;
    h.dismiss(me);
    const after = h.db.letters.find((l) => l.id === letterId)!.throws;

    expect(after).toBe(before);
    expect((h.dismiss(me).body as DismissRes).counted).toBe(false);
  });

  it('反复解占用不会把瓶子弄沉（对比：手动扔回才计数）', () => {
    const h = rig();
    const me = h.token('me');
    const letterId = seedLetter(h);

    // 模拟 8 次「网络抖动 + 兜底解开」
    for (let i = 0; i < 8; i++) {
      h.catchAs(me);
      h.dismiss(me);
    }
    const row = h.db.letters.find((l) => l.id === letterId)!;
    expect(row.throws).toBe(0);
    expect(row.state).toBe('floating');
  });

  it('显式传 letterId 的 dismiss 仍然照旧计数', () => {
    const h = rig();
    const me = h.token('me');
    const letterId = seedLetter(h);
    h.catchAs(me);

    h.dismiss(me, letterId);
    const row = h.db.letters.find((l) => l.id === letterId)!;
    expect(row.throws).toBe(1);
    expect(row.state).toBe('floating');
  });
});

describe('D. 完整死锁场景：模拟真实事故', () => {
  it('响应丢失 → 卡住 → 用兜底解开 → 恢复正常', () => {
    const h = rig();
    const me = h.token('me');
    seedLetter(h, 'author-a');
    seedLetter(h, 'author-b');

    // ① 第一次捞：服务端占用了，但假设客户端没收到响应
    const lost = h.catchAs(me);
    expect(lost.empty).toBe(false);

    // ② 客户端以为自己什么都没捞到，再捞 → 被 holding 挡住
    const blocked = h.catchAs(me);
    expect(blocked.empty).toBe(true);
    if (!blocked.empty) return;
    expect(blocked.reason).toBe('holding');

    // ③ 新服务端：这里能拿到 held，直接恢复
    expect(blocked.held).toBeDefined();

    // ④ 退一步：即使 held 也没拿到（旧服务端），兜底仍然能解开
    const released = h.dismiss(me);
    expect((released.body as DismissRes).ok).toBe(true);

    // ⑤ 玩家终于能继续玩了
    const ok = h.catchAs(me);
    expect(ok.empty).toBe(false);
  });
});


describe('E. World client recovery and persistence failures', () => {
  let h: Harness | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await h?.stop();
    h = undefined;
  });

  async function start() {
    h = makeHarness();
    await h.world.start(new FakeHost());
    await vi.waitFor(() => expect(h!.world.envPromptVars()['bottle.bottles']).not.toBe(''));
    const id = h.throwAs('peer', '只应出现在页面里的来信正文。');
    return { h, id };
  }

  async function loseFirstResponse(h: Harness, includeHeld: boolean) {
    const original = BottleClient.prototype.catchOne;
    vi.spyOn(BottleClient.prototype, 'catchOne')
      .mockImplementationOnce(async function (this: BottleClient) {
        await original.call(this);
        throw new BottleError('network', 0, '模拟打捞响应丢失');
      })
      .mockImplementationOnce(async function (this: BottleClient) {
        const result = await original.call(this);
        if (includeHeld || !result.empty) return result;
        return { empty: true, reason: result.reason, quota: result.quota };
      });
    await callTool(h.world, 'bottle_catch');
    expect(h.world.pageDeps().snapshot().held).toBeNull();
    expect(h.world.pageDeps().snapshot().received).toHaveLength(0);
  }

  it('releases an unknown held letter after a lost response and permits another catch', async () => {
    const { h, id } = await start();
    await loseFirstResponse(h, false);
    const release = vi.spyOn(BottleClient.prototype, 'releaseHeld');
    const result = await callTool(h.world, 'bottle_catch');
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith();
    expect(result).toContain('现在可以再捞一次');
    expect(result).not.toContain(id);
    expect(result).not.toContain('只应出现在页面');
    expect(h.db.letterById(id)).toMatchObject({ state: 'floating', catcherHash: null, throws: 0 });
    expect(h.world.pageDeps().snapshot().held).toBeNull();
    await callTool(h.world, 'bottle_catch');
    expect(h.world.pageDeps().snapshot().held?.letterId).toBe(id);
  });

  it('reports the unresolved hold when the old server rejects release without ID', async () => {
    const { h, id } = await start();
    await loseFirstResponse(h, false);
    const release = vi.spyOn(BottleClient.prototype, 'releaseHeld')
      .mockRejectedValue(new BottleError('not_found', 404, '没有这一封。'));
    const result = await callTool(h.world, 'bottle_catch');
    expect(release).toHaveBeenCalledOnce();
    expect(result).toContain('暂时解不开');
    expect(result).not.toContain('已经替你放回');
    expect(h.db.letterById(id)?.state).toBe('caught');
  });

  it('restores held metadata without releasing, charging twice, or exposing body and ID', async () => {
    const { h, id } = await start();
    await loseFirstResponse(h, true);
    const release = vi.spyOn(BottleClient.prototype, 'releaseHeld');
    const result = await callTool(h.world, 'bottle_catch');
    expect(result).toContain('已找回信箱');
    expect(result).not.toContain(id);
    expect(result).not.toContain('只应出现在页面');
    expect(release).not.toHaveBeenCalled();
    expect(h.db.letterById(id)).toMatchObject({ state: 'caught', deliveredCount: 1 });
    expect(h.world.pageDeps().snapshot().held?.letterId).toBe(id);
    expect(h.world.pageDeps().snapshot().quota?.catches_left).toBe(49);
  });

  it('clears the held letter and updates history only after persistence rollback succeeds', async () => {
    const { h, id } = await start();
    vi.spyOn(LocalStore.prototype, 'heldPersisted').mockReturnValue(false);
    const release = vi.spyOn(BottleClient.prototype, 'releaseHeld');
    const result = await callTool(h.world, 'bottle_catch');
    expect(release).toHaveBeenCalledOnce();
    expect(result).toContain('已经放回海里');
    expect(h.world.pageDeps().snapshot().held).toBeNull();
    expect(h.world.pageDeps().snapshot().received.find(item => item.letterId === id)?.outcome).toBe('dismissed');
    expect(h.db.letterById(id)).toMatchObject({ state: 'floating', throws: 0 });
  });

  it('keeps the held letter available for manual handling when persistence and release both fail', async () => {
    const { h, id } = await start();
    vi.spyOn(LocalStore.prototype, 'heldPersisted').mockReturnValue(false);
    vi.spyOn(BottleClient.prototype, 'releaseHeld')
      .mockRejectedValue(new BottleError('not_found', 404, '没有这一封。'));
    const result = await callTool(h.world, 'bottle_catch');
    expect(result).toContain('尚未放回海里');
    expect(result).not.toContain('已经放回海里');
    expect(result).not.toContain(id);
    expect(result).not.toContain('只应出现在页面');
    expect(h.world.pageDeps().snapshot().held?.letterId).toBe(id);
    expect(h.db.letterById(id)?.state).toBe('caught');
    expect((await h.world.pageDeps().dismiss()).ok).toBe(true);
    expect(h.world.pageDeps().snapshot().held).toBeNull();
  });

  it('checks persistence on recovery too and retains the letter when release fails', async () => {
    const { h, id } = await start();
    await loseFirstResponse(h, true);
    const persisted = vi.spyOn(LocalStore.prototype, 'heldPersisted').mockReturnValue(false);
    vi.spyOn(BottleClient.prototype, 'releaseHeld')
      .mockRejectedValue(new BottleError('network', 0, '模拟释放请求失败'));
    const result = await callTool(h.world, 'bottle_catch');
    expect(persisted).toHaveBeenCalledOnce();
    expect(result).toContain('尚未放回海里');
    expect(h.world.pageDeps().snapshot().held?.letterId).toBe(id);
    expect(h.db.letterById(id)?.state).toBe('caught');
  });

  it('detects a real filesystem write failure and preserves a readable error', async () => {
    const { h } = await start();
    const store = new LocalStore(join(h.dir, 'blocked-store'));
    mkdirSync(store.letterbookFile, { recursive: true });
    store.setHeld({ letterId: 'lost-letter', from: '陌生人', body: '测试正文', caughtAt: h.clock.t, windowUntil: h.clock.t + 72 * HOUR });
    expect(store.heldPersisted()).toBe(false);
    expect(lastStoreWriteError()).toEqual(expect.any(String));
    expect(store.held?.letterId).toBe('lost-letter');
  });
});
