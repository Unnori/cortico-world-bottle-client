import { describe, expect, it, vi } from 'vitest';
import {
  handlePage,
  pageHtml,
  startPageServer,
  type PageDeps,
  type PageSnapshot,
  type Surface,
} from '../world/page.ts';

const snapshot: PageSnapshot = {
  draft: { kind: 'letter', body: '今天的海很平。', chars: 7, hints: [] },
  held: null,
  sent: [],
  received: [],
  quota: { bottles_left: 2, catches_left: 3 },
  online: true,
  localFile: 'C:\\data\\bottle-letterbook.json',
};

function deps(overrides: Partial<PageDeps> = {}): PageDeps {
  return {
    snapshot: () => snapshot,
    send: vi.fn(async () => ({ ok: true, message: '寄出去了。', close: true })),
    rewrite: vi.fn(async () => ({ ok: true, message: '让它重写。' })),
    dismiss: vi.fn(async () => ({ ok: true, message: '放回海里了。' })),
    open: vi.fn(async (_surface: Surface) => ({ ok: true, message: '它开始读了。' })),
    forget: vi.fn(async (_letterId?: string) => ({ ok: true, message: '本机保存的信件记录清空了。' })),
    ...overrides,
  };
}

describe('本地信箱页', () => {
  it('GET / 是一张纸，没有海边也没有页签', async () => {
    const res = await handlePage(deps(), 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.html).toContain('漂流瓶');
    expect(res.html).toContain("fetch('/draft')");
    expect(res.html).not.toContain('canvas');
    expect(res.html).not.toContain('装扮');
  });

  it('GET /draft 回当前快照', async () => {
    const res = await handlePage(deps(), 'GET', '/draft');
    expect(res.status).toBe(200);
    expect(res.json).toEqual(snapshot);
  });

  it('四个动作各走各的', async () => {
    const d = deps();
    expect(await handlePage(d, 'POST', '/send')).toEqual({
      status: 200,
      json: { ok: true, message: '寄出去了。', close: true },
    });
    expect(d.send).toHaveBeenCalledOnce();

    expect(await handlePage(d, 'POST', '/rewrite')).toEqual({ status: 200, json: { ok: true, message: '让它重写。' } });
    expect(d.rewrite).toHaveBeenCalledOnce();

    expect(await handlePage(d, 'POST', '/dismiss')).toEqual({ status: 200, json: { ok: true, message: '放回海里了。' } });
    expect(d.dismiss).toHaveBeenCalledOnce();

    expect(await handlePage(d, 'POST', '/open')).toEqual({ status: 200, json: { ok: true, message: '它开始读了。' } });
    expect(d.open).toHaveBeenCalledOnce();
  });

  it('回信这个动作会告诉 World 是谁点的（卡片还是网页）', async () => {
    const d = deps();
    await handlePage(d, 'POST', '/open', { surface: 'card' });
    expect(d.open).toHaveBeenCalledWith('card');

    await handlePage(d, 'POST', '/open');
    expect(d.open).toHaveBeenLastCalledWith('page');
  });

  it('清空记录必须显式传 all；带 letterId 就只删那一条', async () => {
    const d = deps();

    // 裸 /forget 不再等于「清空全部」：那会把一个坏掉的请求体变成清空命令
    const bare = await handlePage(d, 'POST', '/forget');
    expect(bare.status).toBe(400);
    expect(d.forget).not.toHaveBeenCalled();

    const all = await handlePage(d, 'POST', '/forget', { body: { all: true } });
    expect(all.status).toBe(200);
    expect(d.forget).toHaveBeenCalledWith(undefined);
    expect(d.send).not.toHaveBeenCalled();

    await handlePage(d, 'POST', '/forget', { body: { letterId: 'l_7' } });
    expect(d.forget).toHaveBeenLastCalledWith('l_7');
  });

  it('页面上的「清空」按钮显式传 all，不是裸请求', () => {
    expect(pageHtml()).toContain("run('/forget', clear, { all: true })");
  });

  it('别的路径一律 404', async () => {
    const res = await handlePage(deps(), 'POST', '/send-all');
    expect(res.status).toBe(404);
  });

  it('页面里没有可执行的外链，也不读别的东西', () => {
    const html = pageHtml();
    expect(html).not.toContain('<script src');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).toContain('仍然寄出');
    expect(html).toContain('写出的信');
    expect(html).toContain('捞到过的信');
    expect(html).toContain('扔回海里');
    expect(html).toContain('删除');
    expect(html).toContain('清空这些记录');
  });

  it('标题渲染在正确位置：种子的 topic 进 title，状态进 meta', () => {
    // 钉住两个真 bug：
    //   1. 手里那封：title 位置上放的是状态「它不会回信」，topic 被塞进底部 meta
    //   2. 捞到过的信：topic 从来没被渲染，标题直接丢
    const html = pageHtml();

    // 手里那封：h2 用 topic
    expect(html).toContain("el('h2', 'title', s.held.topic || '它不会回信')");
    // 状态是单独一行小字，不再和 topic 拼在一起
    expect(html).toContain("el('div', 'meta', '海边邮局寄来的，不会回信')");
    // 历史区：topic 必须有位置
    expect(html).toContain('mail-topic');
    expect(html).toContain('item.topic');

    // 样式也得在，否则元素是空的
    const style = html.slice(0, html.indexOf('</style>'));
    expect(style).toContain('.mail .mail-topic');
  });

  it('真 HTTP：卡片带 surface 头，World 知道是谁点的；没带头的 POST 被挡', async () => {
    const seen: Surface[] = [];
    const server = await startPageServer(
      {
        ...deps(),
        open: async (surface: Surface) => {
          seen.push(surface);
          return { ok: true, message: '它开始读了。' };
        },
      },
      { port: 17980 },
    );
    try {
      const page = await fetch(`${server.url}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('漂流瓶');

      const fromCard = await fetch(`${server.url}open`, {
        method: 'POST',
        headers: { 'x-bottle': '1', 'x-bottle-surface': 'card' },
      });
      expect(fromCard.status).toBe(200);
      expect(seen).toEqual(['card']);

      const fromPage = await fetch(`${server.url}open`, {
        method: 'POST',
        headers: { 'x-bottle': '1' },
      });
      expect(fromPage.status).toBe(200);
      expect(seen).toEqual(['card', 'page']);

      const crossSite = await fetch(`${server.url}send`, { method: 'POST' });
      expect(crossSite.status).toBe(403);
    } finally {
      await server.close();
    }
  });
});
