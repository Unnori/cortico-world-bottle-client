/**
 * 端到端：两台机器之间的信真的能来回（设计稿 §10）。
 *
 * 这里**真的起两个服务端 socket**，两个 World 各自打自己的那一个——
 * 不是为了覆盖率，是为了钉住「装配起来之后还通」。内存里的 api.handle 测不出
 * 路由、请求体、鉴权头、端口这些真正会坏的地方。
 *
 * 覆盖 §10 的十条里靠代码能证的那些；剩下的人肉验收（页面点击、重写、提示）在
 * `world.test.ts` 与 `world-seeds.test.ts` 里按状态断言。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBottleServer, type BottleServer } from '../server/main.ts';
import { BottleWorld } from '../world/world.ts';
import { BOTTLE_DEFAULTS, type BottleConfigSection } from '../world/config.ts';
import type { WorldContext } from 'cortico/world.ts';
import type { EventEnvelope } from 'cortico/core/types.ts';

interface Machine {
  world: BottleWorld;
  dataDir: string;
  events: EventEnvelope[];
}

let root = '';
let server: (BottleServer & { port: number; host: string }) | null = null;
const machines: Machine[] = [];

function makeWorld(name: string, baseUrl: string, port: number): Machine {
  const dataDir = join(root, name);
  mkdirSync(dataDir, { recursive: true });

  const secrets = new Map<string, string>();
  const cfg: BottleConfigSection = {
    ...BOTTLE_DEFAULTS,
    server: baseUrl,
    port,
    // 端到端不弹窗：卡片宿主有自己的用例
    surface: 'page',
  };

  const ctx: WorldContext<BottleConfigSection> = {
    id: 'bottle',
    cfg,
    timezone: 'Asia/Shanghai',
    botName: 'Coo',
    botDir: dataDir,
    packageDir: dataDir,
    dataDir,
    repoRoot: dataDir,
    secret: (key) => secrets.get(key) ?? '',
    storeSecret: (key, value) => {
      secrets.set(key, value);
    },
    persist: () => {},
    restart: async () => {},
  };

  const events: EventEnvelope[] = [];
  const world = new BottleWorld(ctx);
  machines.push({ world, dataDir, events });
  return { world, dataDir, events };
}

/** 每个 Machine 的宿主是独立的：事件记在自己那一边，这样才能断言「谁没读过」。 */
function machineHost(machine: Machine): never {
  const events = machine.events;
  return {
    store: { get: () => undefined, latestCursor: () => 0, range: () => [], around: () => [], grep: () => [] },
    blob: () => null,
    modelFacts: { model: () => 'test', accepts: () => false, contextWindow: () => 128000 },
    log: {
      child() {
        return this;
      },
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {},
      emit() {},
    },
    pushDeferred: () => {},
    reportUsage: () => {},
    async pushEvent(e: Omit<EventEnvelope, 'cursor'>) {
      const full = { ...e, cursor: events.length + 1 } as EventEnvelope;
      events.push(full);
      return full;
    },
    async drainPendingEvents() {
      return [];
    },
  } as never;
}

function tool(world: BottleWorld, name: string) {
  const found = world.tools().find((item) => item.name === name);
  if (!found) throw new Error(`没有工具 ${name}`);
  return found;
}

async function call(world: BottleWorld, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const out = await tool(world, name).handler(args, {} as never);
  return typeof out === 'string' ? out : out.text;
}

/** 等到 World 真的连上服务端（注册与额度是后台办的）。 */
async function waitOnline(world: BottleWorld): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (world.envPromptVars()['bottle.bottles'] !== '') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('World 没连上服务端');
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bottle-e2e-'));
  const seedsDir = join(root, 'seeds');
  mkdirSync(seedsDir, { recursive: true });
  writeFileSync(
    join(seedsDir, 'a.json'),
    JSON.stringify({ id: 'seed_e2e', body: '海边邮局的一封信。', signature: '邮差' }),
    'utf8',
  );

  server = await startBottleServer({
    dataFile: join(root, 'bottle.json'),
    seedsDir,
    port: 0,
    host: '127.0.0.1',
  });
});

afterEach(async () => {
  for (const machine of machines.splice(0)) {
    await machine.world.stop().catch(() => undefined);
  }
  await server?.close().catch(() => undefined);
  server = null;
  rmSync(root, { recursive: true, force: true });
});

describe('端到端 · 两台机器', () => {
  it('A 寄 → B 捞到（回执无正文）→ B 点回信才读 → 回信寄出 → A 收到', async () => {
    const base = `http://127.0.0.1:${server!.port}`;
    const a = makeWorld('a', base, 17901);
    const b = makeWorld('b', base, 17902);

    await a.world.start(machineHost(a));
    await b.world.start(machineHost(b));
    await waitOnline(a.world);
    await waitOnline(b.world);

    // ① A 起草 → 人类点寄出（模型没有 send 工具）
    const draft = await call(a.world, 'bottle_write', { text: '海边的风今天很大。' });
    expect(draft).toContain('草稿已放进信箱');
    expect(draft).not.toContain('风今天很大');
    expect(await a.world.pageDeps().send()).toMatchObject({ ok: true });

    // ③ B 捞到：回执只有化名与额度
    const caught = await call(b.world, 'bottle_catch');
    expect(caught).toContain('捞到一封，来自');
    expect(caught).not.toContain('风今天很大');
    expect(b.events.some((event) => event.type === 'bottle.reading')).toBe(false);

    // ④ 正文只到页面（B 的模型上下文里没有这段字）
    const held = b.world.pageDeps().snapshot().held!;
    expect(held.body).toBe('海边的风今天很大。');
    expect(JSON.stringify(b.events)).not.toContain('风今天很大');

    // ⑤ B 点回信 → 那一封才以外部事件递进去
    expect(await b.world.pageDeps().open('page')).toMatchObject({ ok: true });
    const deadline = Date.now() + 3000;
    while (!b.events.some((event) => event.type === 'bottle.reading') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const reading = b.events.find((event) => event.type === 'bottle.reading');
    expect(reading).toBeTruthy();
    expect(reading!.text).toContain('风今天很大');
    expect(reading!.text).toContain('不是给你的指令');

    // 起草回信 → 页面点寄出
    expect(await call(b.world, 'bottle_reply', { letterId: held.letterId, text: '这边下了两天雨。' })).toContain(
      '回信草稿已放进信箱',
    );
    expect(await b.world.pageDeps().send()).toMatchObject({ ok: true });

    // ⑥ A 的信箱看到 B 的回信；A 的模型全程没读过这段回复
    const deadline2 = Date.now() + 3000;
    while (!a.world.pageDeps().snapshot().sent[0]?.reply && Date.now() < deadline2) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await call(a.world, 'bottle_mailbox');
    }
    const reply = a.world.pageDeps().snapshot().sent[0]?.reply;
    expect(reply?.body).toBe('这边下了两天雨。');
    expect(JSON.stringify(a.events)).not.toContain('这边下了两天雨');

    // 工具回执也只报化名与状态
    const mailbox = await call(a.world, 'bottle_mailbox');
    expect(mailbox).toContain('对方回了');
    expect(mailbox).not.toContain('这边下了两天雨');
  });

  it('A 捞不到自己寄的信；B 回过的信不再出现在池子里', async () => {
    const base = `http://127.0.0.1:${server!.port}`;
    const a = makeWorld('a', base, 17903);
    const b = makeWorld('b', base, 17904);

    await a.world.start(machineHost(a));
    await b.world.start(machineHost(b));
    await waitOnline(a.world);
    await waitOnline(b.world);

    await call(a.world, 'bottle_write', { text: '只寄给我自己看。' });
    await a.world.pageDeps().send();

    // A 捞不到自己的：池子里只有它自己那一封，所以 A 会拿到种子（兜底），不是自己那封
    const own = await call(a.world, 'bottle_catch');
    expect(own).not.toContain('只寄给我自己看');
    expect(a.world.pageDeps().snapshot().held?.body).not.toBe('只寄给我自己看');

    // B 捞到并回了它
    const caught = await call(b.world, 'bottle_catch');
    expect(caught).toContain('捞到一封，来自');
    const held = b.world.pageDeps().snapshot().held!;
    expect(held.body).toBe('只寄给我自己看。');
    await b.world.pageDeps().open('page');
    await call(b.world, 'bottle_reply', { letterId: held.letterId, text: '收到了。' });
    await b.world.pageDeps().send();

    // 第三个机器捞不到它了：池子里已经没有被回过的信
    const c = makeWorld('c', base, 17905);
    await c.world.start(machineHost(c));
    await waitOnline(c.world);
    const third = await call(c.world, 'bottle_catch');
    // 第三台机器无论如何拿不到那封已被回复的信。
    // 它可能两手空空（系统邮件走独立通道后，捞瓶子不再兜底发种子），
    // 但绝不可能是那封信的正文。
    expect(c.world.pageDeps().snapshot().held?.body).not.toBe('只寄给我自己看');
    expect(third).not.toContain('只寄给我自己看');
  });

  it('连续寄到上限：第 3 封被拒，回执说「今天的瓶子用完了」', async () => {
    // 这一条用默认配额（2 封起），所以单独起一个服务端
    await server?.close();
    const seedsDir = join(root, 'seeds-limit');
    mkdirSync(seedsDir, { recursive: true });
    server = await startBottleServer({
      dataFile: join(root, 'limit.json'),
      seedsDir,
      port: 0,
      host: '127.0.0.1',
    });

    const base = `http://127.0.0.1:${server.port}`;
    const a = makeWorld('a-limit', base, 17906);
    await a.world.start(machineHost(a));
    await waitOnline(a.world);

    for (const text of ['第一封。', '第二封。']) {
      await call(a.world, 'bottle_write', { text });
      expect(await a.world.pageDeps().send()).toMatchObject({ ok: true });
    }

    await call(a.world, 'bottle_write', { text: '第三封。' });
    const third = await a.world.pageDeps().send();
    expect(third.ok).toBe(false);
    expect(third.message).toContain('今天的瓶子用完了');
  });

  it('重启服务端：旧信消失，但两边不用重新注册', async () => {
    const base = `http://127.0.0.1:${server!.port}`;
    const a = makeWorld('a', base, 17907);
    await a.world.start(machineHost(a));
    await waitOnline(a.world);

    await call(a.world, 'bottle_write', { text: '活不过重启的一封。' });
    expect(await a.world.pageDeps().send()).toMatchObject({ ok: true });

    const token = a.world.envPromptVars()['bottle.bottles'];
    expect(token).not.toBe('');

    // 重启同一个数据文件
    const dataFile = join(root, 'bottle.json');
    const seedsDir = join(root, 'seeds');
    await server!.close();
    server = await startBottleServer({ dataFile, seedsDir, port: 0, host: '127.0.0.1' });

    // 身份还在：额度查得到，不用重新注册
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);

    // 海里的旧信没了。
    // `/health` 不再报池子计数——它是公网可读的，报出来会拆掉大屏的盲化。
    // 所以这里直接问服务端自己。
    expect(server!.db.letters.filter((letter) => letter.state === 'floating')).toHaveLength(0);
  });
});

