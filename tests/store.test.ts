/**
 * 本机落盘的往返。存在的理由是一个真 bug：
 * `setDraft` 写的是 `{ draft }` 包装，而 `load()` 曾把根对象当草稿读，
 * 于是 `draft.kind` 恒为 undefined —— 草稿在每次重启后都被静默丢掉，
 * 而 132 个用例里没有一个碰过 `setDraft` / `load()`。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStore } from '../world/store.ts';

const dirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bottle-store-'));
  dirs.push(dir);
  return dir;
}

/** 模拟「Coo 重启」：同一个目录上新建一个 store 再 load。 */
function reload(dir: string): LocalStore {
  const store = new LocalStore(dir);
  store.load();
  return store;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('草稿往返', () => {
  it('写信的草稿在重启后还在', () => {
    const dir = freshDir();
    const first = reload(dir);
    first.setDraft({ kind: 'letter', body: '今天的海很平。', at: 1_000 });

    const again = reload(dir);
    expect(again.draft).toEqual({ kind: 'letter', body: '今天的海很平。', at: 1_000 });
  });

  it('回信草稿连 letterId 一起留住', () => {
    const dir = freshDir();
    reload(dir).setDraft({ kind: 'reply', letterId: 'l_abc123', body: '下了，很小。', at: 2 });

    expect(reload(dir).draft).toEqual({ kind: 'reply', letterId: 'l_abc123', body: '下了，很小。', at: 2 });
  });

  it('落盘的是带包装的形状，读的时候要拆开', () => {
    const dir = freshDir();
    reload(dir).setDraft({ kind: 'letter', body: '看看磁盘', at: 3 });

    const raw = JSON.parse(readFileSync(join(dir, 'bottle-draft.json'), 'utf8')) as { draft?: unknown };
    expect(raw).toHaveProperty('draft');
    expect(reload(dir).draft?.body).toBe('看看磁盘');
  });

  it('没有包装的裸草稿也认，格式换过一次不能吃掉手里的草稿', () => {
    const dir = freshDir();
    writeFileSync(
      join(dir, 'bottle-draft.json'),
      JSON.stringify({ kind: 'letter', body: '裸格式', at: 4 }),
      'utf8',
    );

    expect(reload(dir).draft?.body).toBe('裸格式');
  });

  it('清掉之后不能复活，空正文也不算草稿', () => {
    const dir = freshDir();
    const store = reload(dir);
    store.setDraft({ kind: 'letter', body: '要清掉的', at: 5 });
    store.clear();
    expect(reload(dir).draft).toBeNull();

    const other = freshDir();
    reload(other).setDraft({ kind: 'letter', body: '', at: 6 });
    expect(reload(other).draft).toBeNull();
  });

  it('坏掉的 JSON 不炸，只当没有草稿', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'bottle-draft.json'), '{ 这不是 json', 'utf8');
    expect(() => reload(dir)).not.toThrow();
    expect(reload(dir).draft).toBeNull();
  });
});

describe('身份与账本往返', () => {
  it('化名与信件账本都留得住', () => {
    const dir = freshDir();
    const first = reload(dir);
    first.setIdentity({ clientId: 'cid-1', pseudonym: '海盐大福#4821' });
    first.setHeld({
      letterId: 'l_1',
      from: '南汀铜铃#1379',
      body: '慢慢漂。',
      caughtAt: 10,
      windowUntil: 20,
    });
    first.addSent({ letterId: 'l_2', body: '寄出的', at: 11 });
    first.addReceived({ letterId: 'l_1', from: '南汀铜铃#1379', body: '慢慢漂。', at: 10, outcome: 'caught' });
    first.addReply({ letterId: 'l_2', from: '北岬潮签#2002', body: '收到了。', at: 12 });

    const again = reload(dir);
    expect(again.identity).toEqual({ clientId: 'cid-1', pseudonym: '海盐大福#4821' });
    expect(again.held?.letterId).toBe('l_1');
    expect(again.sent.map((item) => item.letterId)).toEqual(['l_2']);
    expect(again.received[0]?.outcome).toBe('caught');
    expect(again.replies[0]?.from).toBe('北岬潮签#2002');
  });

  it('同一封捞到第二次只更新结局，不重复记一条', () => {
    const dir = freshDir();
    const store = reload(dir);
    store.addReceived({ letterId: 'l_9', from: '海盐大福#4821', body: '第一版', at: 1, outcome: 'caught' });
    store.addReceived({ letterId: 'l_9', from: '海盐大福#4821', body: '第二版', at: 2, outcome: 'caught' });

    expect(store.received).toHaveLength(1);
    expect(store.received[0]?.body).toBe('第二版');
    expect(store.received[0]?.at).toBe(1);
  });
});
