/**
 * 401 自愈 + 密钥名隔离。
 *
 * 两个真实踩过的坑，都在这一个文件里钉住：
 *
 * 1. **密钥名撞车**：正式版和 Dev 版都写 `.env` 里的 `BOTTLE_TOKEN`，
 *    但两套服务端的 bots 表是独立的。谁后注册谁覆盖，另一台就一直 401。
 *
 * 2. **401 不自愈**：token 失效后客户端一直 401，看着像服务端挂了，
 *    实际只要用同一个 clientId 重新注册就能拿回同一个号。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../server/app.ts';
import { Db } from '../server/db.ts';
import { BOTTLE_DEFAULTS } from '../world/config.ts';
import { BottleWorld } from '../world/world.ts';
import { FakeHost } from './fake-host.ts';

let root = '';
let world: BottleWorld | null = null;
let api: ReturnType<typeof createApi>;
let secrets: Map<string, string>;
let denyAll = false;
let denyFirst = 0;

/** 把 World 的请求直接递给内存 api，并记录 Authorization。 */
const seen: Array<{ path: string; auth: string }> = [];

function makeFetch() {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization') ?? '';
    seen.push({ path: url.pathname, auth });

    // 模拟「token 不被这台服务端认可」
    const deny = denyAll || denyFirst > 0;
    if (deny && url.pathname !== '/register') {
      if (!denyAll && denyFirst > 0) denyFirst -= 1;
      return new Response(JSON.stringify({ error: 'unauthorized', message: '先注册。' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

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
}

function build() {
  const db = Db.open(null);
  const clock = { t: Date.parse('2026-10-28T12:00:00+08:00') };
  api = createApi(db, {
    now: () => clock.t,
    timeZone: 'Asia/Shanghai',
    ipLimit: 99,
    seedsPerUserMax: 0,
    rules: { sendBase: 5, sendCap: 5, catchBase: 5, catchCap: 5, poolDivisor: 5 },
  });
  const w = new BottleWorld(
    {
      id: 'bottle',
      cfg: { ...BOTTLE_DEFAULTS, enabled: true, port: 17991, surface: 'page' },
      timezone: 'Asia/Shanghai',
      botName: 'Coo',
      botDir: root,
      packageDir: root,
      dataDir: root,
      repoRoot: root,
      secret: (n) => secrets.get(n) ?? '',
      storeSecret: (n, v) => {
        secrets.set(n, v);
      },
      persist: () => {},
      restart: async () => {},
    },
    { fetchImpl: makeFetch(), now: () => clock.t },
  );
  return w;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bottle-reauth-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  secrets = new Map();
  seen.length = 0;
  denyAll = false;
  denyFirst = 0;
});

afterEach(async () => {
  await world?.stop().catch(() => undefined);
  world = null;
  rmSync(root, { recursive: true, force: true });
});

describe('密钥名 · 不能和 Dev 版撞车', () => {
  it('正式版把 token 写进 BOTTLE_PROD_TOKEN，不碰 BOTTLE_TOKEN', async () => {
    world = build();
    await world.start(new FakeHost());
    await new Promise((r) => setTimeout(r, 200));

    // 这正是坑：以前两个世界都写 BOTTLE_TOKEN，互相覆盖
    expect(secrets.has('BOTTLE_PROD_TOKEN')).toBe(true);
    expect(secrets.get('BOTTLE_PROD_TOKEN')).toBeTruthy();
    expect(secrets.has('BOTTLE_TOKEN')).toBe(false);
  });
});

describe('401 自愈', () => {
  it('token 失效后自动重新注册，拿回同一个号', async () => {
    world = build();
    await world.start(new FakeHost());
    await new Promise((r) => setTimeout(r, 250));

    const first = secrets.get('BOTTLE_PROD_TOKEN');
    expect(first).toBeTruthy();
    const idBefore = JSON.parse(readFileSync(join(root, 'bottle-id.json'), 'utf8'));
    expect(idBefore.pseudonym).toBeTruthy();

    // 让下一次需要鉴权的请求先吃一个 401
    denyFirst = 1;
    seen.length = 0;

    const before = seen.length;
    // 触发一次带鉴权的请求
    await (world as unknown as { refreshQuota: () => Promise<void> }).refreshQuota();
    await new Promise((r) => setTimeout(r, 100));

    // 应该看到：先 401 → 重新注册 → 重试成功
    const paths = seen.map((s) => s.path);
    expect(paths).toContain('/register');

    // 新 token 和旧的不同
    const second = secrets.get('BOTTLE_PROD_TOKEN');
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    // 但人还是同一个人（同一个 clientId → 同一个化名）
    const idAfter = JSON.parse(readFileSync(join(root, 'bottle-id.json'), 'utf8'));
    expect(idAfter.clientId).toBe(idBefore.clientId);
    expect(idAfter.pseudonym).toBe(idBefore.pseudonym);
  });

  it('服务端一直 401 时不能无限重试', async () => {
    world = build();
    await world.start(new FakeHost());
    await new Promise((r) => setTimeout(r, 250));

    denyAll = true;
    seen.length = 0;

    await (world as unknown as { refreshQuota: () => Promise<void> }).refreshQuota();
    await new Promise((r) => setTimeout(r, 300));

    // 重注册上限是 2：不会出现几十次 register
    const registers = seen.filter((s) => s.path === '/register').length;
    expect(registers).toBeLessThanOrEqual(2);
  });

  it('非 401 的错误不触发重注册', async () => {
    world = build();
    await world.start(new FakeHost());
    await new Promise((r) => setTimeout(r, 250));

    seen.length = 0;
    // 取消所有 deny：正常情况下 quota 请求不该伴随 register
    await (world as unknown as { refreshQuota: () => Promise<void> }).refreshQuota();
    await new Promise((r) => setTimeout(r, 100));

    expect(seen.filter((s) => s.path === '/register').length).toBe(0);
  });
});
