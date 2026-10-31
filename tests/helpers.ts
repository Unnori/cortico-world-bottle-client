/**
 * 测试用的接线：World 通过真的 `BottleClient` 打到一个内存里的服务端。
 * 这样一条链路（注册 → 寄 → 捞 → 授权 → 回）是端到端跑的，不用开 socket。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorldContext } from 'cortico/world.ts';
import { createApi, sha256, type Api } from '../server/app.ts';
import { Db } from '../server/db.ts';
import type { QuotaRules } from '../server/quota.ts';
import type { SeedStore } from '../server/seeds.ts';
import type { TuningReader } from '../server/tuning.ts';
import { BOTTLE_DEFAULTS, type BottleConfigSection } from '../world/config.ts';
import { BottleWorld } from '../world/world.ts';

export interface Harness {
  api: Api;
  /** 被要求用浏览器打开的地址（测试里不会真的打开）。 */
  openedUrls: string[];
  db: Db;
  world: BottleWorld;
  dir: string;
  /** 手动拨的钟。 */
  clock: { t: number };
  tokenOf(seed: string): string;
  throwAs(seed: string, body: string): string;
  stop(): Promise<void>;
}

export function makeHarness(
  opts: {
    port?: number;
    server?: string;
    seeds?: SeedStore;
    rules?: QuotaRules;
    tuning?: TuningReader;
    botName?: string;
    /** 覆盖「打开本机页面」；默认只记录不真开。 */
    openUrl?: (url: string) => Promise<boolean>;
    /** 覆盖 HTTP：用来造「注册就失败」这类网络错误。 */
    fetchImpl?: typeof fetch;
  } = {},
): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'bottle-world-'));
  const db = Db.open(null);
  const clock = { t: Date.parse('2026-10-27T10:00:00+08:00') };
  let tokens = 0;
  const openedUrls: string[] = [];

  const api = createApi(db, {
    now: () => clock.t,
    timeZone: 'Asia/Shanghai',
    random: () => 0.42,
    newToken: () => `tok_${++tokens}`,
    ipLimit: 50,
    // World 的用例只走流程，别让每日额度在半路卡住；额度公式在 server.test 里单独测
    rules: opts.rules ?? { sendBase: 50, sendCap: 50, catchBase: 50, catchCap: 50, poolDivisor: 5 },
    ...(opts.tuning ? { tuning: opts.tuning } : {}),
    ...(opts.seeds ? { seeds: opts.seeds } : {}),
  });

  const secrets = new Map<string, string>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers.authorization ?? '';
    const result = api.handle({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      token: auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : undefined,
      ip: '127.0.0.1',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  };

  const cfg: BottleConfigSection = {
    ...BOTTLE_DEFAULTS,
    port: opts.port ?? 17860,
    server: opts.server ?? 'http://127.0.0.1:8787',
    // 测试里不开窗口：卡片宿主另有专门的用例，这里只验证状态与回执
    surface: 'page',
  };

  const ctx: WorldContext<BottleConfigSection> = {
    id: 'bottle',
    cfg,
    timezone: 'Asia/Shanghai',
    botName: opts.botName ?? 'Coo',
    botDir: dir,
    packageDir: dir,
    dataDir: dir,
    repoRoot: dir,
    secret: (name) => secrets.get(name) ?? '',
    storeSecret: (name, value) => {
      secrets.set(name, value);
    },
    persist: () => {},
    restart: async () => {},
  };

  const world = new BottleWorld(ctx, {
    fetchImpl: opts.fetchImpl ?? fetchImpl,
    now: () => clock.t,
    localEnv: { hostname: 'DESKTOP-TEST-PC', username: 'alice', home: 'C:\\Users\\alice' },
    // 测试里绝不真的拉起浏览器；记下被要求打开的地址
    openUrl: (url) => {
      openedUrls.push(url);
      return (opts.openUrl ?? (async () => true))(url);
    },
  });

  /** 另一个人的 token：直接问服务端要，不走 World。 */
  const tokenOf = (seed: string): string => {
    const res = api.handle({
      method: 'POST',
      path: '/register',
      ip: '10.0.0.9',
      body: { hash: sha256(seed) },
    });
    return (res.body as { token: string }).token;
  };

  const throwAs = (seed: string, body: string): string => {
    const token = tokenOf(seed);
    const res = api.handle({ method: 'POST', path: '/throw', token, ip: '10.0.0.9', body: { body } });
    return (res.body as { letterId: string }).letterId;
  };

  return {
    api,
    db,
    world,
    dir,
    openedUrls,
    clock,
    tokenOf,
    throwAs,
    async stop() {
      await world.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 从 World 的工具表里取一个按名字调用。 */
export function toolNamed(world: BottleWorld, name: string) {
  const tool = world.tools().find((item) => item.name === name);
  if (!tool) throw new Error(`没有工具 ${name}`);
  return tool;
}

export async function callTool(world: BottleWorld, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = toolNamed(world, name);
  const out = await tool.handler(args, {} as never);
  return typeof out === 'string' ? out : out.text;
}
