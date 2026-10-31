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
    first.setLetterDraft({ kind: 'letter', body: '今天的海很平。', at: 1_000 });

    const again = reload(dir);
    expect(again.letterDraft).toEqual({ kind: 'letter', body: '今天的海很平。', at: 1_000 });
    // 信稿不占回信草稿那个槽
    expect(again.draft).toBeNull();
  });

  it('回信草稿连 letterId 一起留住', () => {
    const dir = freshDir();
    reload(dir).setDraft({ kind: 'reply', letterId: 'l_abc123', body: '下了，很小。', at: 2 });

    expect(reload(dir).draft).toEqual({ kind: 'reply', letterId: 'l_abc123', body: '下了，很小。', at: 2 });
  });

  it('信稿与回信稿是两个槽，互不覆盖', () => {
    const dir = freshDir();
    const store = reload(dir);
    store.setLetterDraft({ kind: 'letter', body: '信稿', at: 10 });
    store.setDraft({ kind: 'reply', letterId: 'l_1', body: '回信稿', at: 11 });

    const again = reload(dir);
    expect(again.letterDraft?.body).toBe('信稿');
    expect(again.draft?.body).toBe('回信稿');
  });

  it('落盘的是带包装的形状，读的时候要拆开', () => {
    const dir = freshDir();
    reload(dir).setLetterDraft({ kind: 'letter', body: '看看磁盘', at: 3 });

    const raw = JSON.parse(readFileSync(join(dir, 'bottle-draft.json'), 'utf8')) as { letterDraft?: unknown };
    expect(raw).toHaveProperty('letterDraft');
    expect(reload(dir).letterDraft?.body).toBe('看看磁盘');
  });

  it('没有包装的裸草稿也认，格式换过一次不能吃掉手里的草稿', () => {
    const dir = freshDir();
    writeFileSync(
      join(dir, 'bottle-draft.json'),
      JSON.stringify({ kind: 'letter', body: '裸格式', at: 4 }),
      'utf8',
    );

    expect(reload(dir).letterDraft?.body).toBe('裸格式');
  });

  it('旧格式里 kind=reply 的草稿仍归回信槽', () => {
    const dir = freshDir();
    writeFileSync(
      join(dir, 'bottle-draft.json'),
      JSON.stringify({ draft: { kind: 'reply', letterId: 'l_x', body: '旧回信稿', at: 5 } }),
      'utf8',
    );

    expect(reload(dir).draft?.body).toBe('旧回信稿');
    expect(reload(dir).letterDraft).toBeNull();
  });

  // 0.1.2 及以前落盘的就是这个形状：信稿也在 `draft` 里，只是 kind 不同。
  // 升级到双槽时若按"槽位"硬读，会把人正在写的信整封丢掉。
  it('旧格式里 kind=letter 的草稿迁移到信稿槽，不丢字', () => {
    const dir = freshDir();
    writeFileSync(
      join(dir, 'bottle-draft.json'),
      JSON.stringify({ draft: { kind: 'letter', body: '升级前写了一半的信', at: 6 } }),
      'utf8',
    );

    const store = reload(dir);
    expect(store.letterDraft?.body).toBe('升级前写了一半的信');
    expect(store.draft).toBeNull();
  });
  it('清掉之后不能复活，空正文也不算草稿', () => {
    const dir = freshDir();
    const store = reload(dir);
    store.setLetterDraft({ kind: 'letter', body: '要清掉的', at: 5 });
    store.clear();
    expect(reload(dir).letterDraft).toBeNull();

    const other = freshDir();
    reload(other).setLetterDraft({ kind: 'letter', body: '', at: 6 });
    expect(reload(other).letterDraft).toBeNull();
  });

  it('坏掉的 JSON 不炸，只当没有草稿', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'bottle-draft.json'), '{ 这不是 json', 'utf8');
    expect(() => reload(dir)).not.toThrow();
    expect(reload(dir).draft).toBeNull();
    expect(reload(dir).letterDraft).toBeNull();
  });
});

describe('身份与账本往返', () => {
  it('kept 与 dead 都留得住；不认识的 outcome 按「扔回海里」兜底', () => {
    const dir = freshDir();
    const first = reload(dir);
    first.setHeld({
      letterId: 'l_dead',
      from: '南汀铜铃#1379',
      body: '',
      caughtAt: 10,
      windowUntil: 20,
      dead: true,
    });
    first.addReceived({ letterId: 'l_dead', from: '南汀铜铃#1379', body: '', at: 10, outcome: 'kept' });

    const again = reload(dir);
    expect(again.held?.dead).toBe(true);
    expect(again.received[0]?.outcome).toBe('kept');

    // 老存档里出现没见过的 outcome：不能当成「还没回」，按扔回海里处理
    const other = freshDir();
    writeFileSync(
      join(other, 'bottle-letterbook.json'),
      JSON.stringify({
        received: [{ letterId: 'l_x', from: '某人', body: '旧记录', at: 1, outcome: 'weird_new_state' }],
      }),
      'utf8',
    );
    expect(reload(other).received[0]?.outcome).toBe('dismissed');
  });

  it('我回的那段要落盘：setReceivedMyReply → 重载还在', () => {
    const dir = freshDir();
    const store = reload(dir);
    store.addReceived({ letterId: 'l_1', from: '某人', body: '原文', at: 1, outcome: 'replied' });
    store.setReceivedMyReply('l_1', '我回的那段。');
    expect(reload(dir).received[0]?.myReply).toBe('我回的那段。');
  });

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


describe('信件标题往返', () => {
  it('草稿和寄出记录重启后保留独立标题', () => {
    const dir = freshDir();
    const first = reload(dir);
    first.setLetterDraft({ kind: 'letter', topic: '风里的信', body: '今天的海很平。', at: 1 });
    first.addSent({ letterId: 'l_title', topic: '昨日的云', body: '云很低。', at: 2 });
    const again = reload(dir);
    expect(again.letterDraft).toMatchObject({ topic: '风里的信', body: '今天的海很平。' });
    expect(again.sent[0]).toMatchObject({ topic: '昨日的云', body: '云很低。' });
  });
});
