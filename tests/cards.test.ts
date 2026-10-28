import { describe, expect, it } from 'vitest';
import {
  draftLetterCard,
  heldLetterCard,
  replyArrivedCard,
  replyDraftCard,
  waitingCard,
} from '../world/cards.ts';

const base = 'http://127.0.0.1:7796/';

describe('原生卡片规格', () => {
  it('写信：正文、字数、寄出去 / 重写', () => {
    const card = draftLetterCard({
      base,
      draft: { kind: 'letter', body: '今天的海很平。', at: 1 },
      chars: 7,
      hints: [],
    });
    expect(card.base).toBe('http://127.0.0.1:7796');
    expect(card.eyebrow).toContain('写好了');
    expect(card.body).toBe('今天的海很平。');
    expect(card.meta).toBe('7 / 120 字');
    expect(card.actions.map((a) => [a.id, a.label, a.tone])).toEqual([
      ['send', '寄出去', 'primary'],
      ['rewrite', '重写', 'ghost'],
    ]);
  });

  it('命中提示时，主按钮改成「仍然寄出」，提示也带进去', () => {
    const card = draftLetterCard({
      base,
      draft: { kind: 'letter', body: '打我电话 13800138000', at: 1 },
      chars: 19,
      hints: [{ kind: 'contact', text: '这封信里有联系方式' }],
    });
    expect(card.hints).toEqual(['这封信里有联系方式']);
    expect(card.actions[0]).toMatchObject({ id: 'send', label: '仍然寄出' });
  });

  it('捞到一封：回信 / 先放着 / 扔回海里', () => {
    const card = heldLetterCard({
      base,
      held: { letterId: 'l_1', from: '海盐大福#4821', body: '窗外的云很低。', caughtAt: 0, windowUntil: 0 },
      hoursLeft: 71,
    });
    expect(card.from).toBe('来自 海盐大福#4821');
    expect(card.meta).toBe('还有 71 小时回海');
    expect(card.actions.map((a) => [a.id, a.label])).toEqual([
      ['open', '回信'],
      ['close', '先放着'],
      ['dismiss', '扔回海里'],
    ]);
  });

  it('回信草稿把原信折叠进来，别让人类凭记忆回', () => {
    const card = replyDraftCard({
      base,
      draft: { kind: 'reply', letterId: 'l_1', body: '下了，很小。', at: 2 },
      held: { letterId: 'l_1', from: '海盐大福#4821', body: '你那边也下雨吗', caughtAt: 0, windowUntil: 0 },
      chars: 6,
      hints: [],
    });
    expect(card.eyebrow).toContain('回信写好了');
    expect(card.quote?.label).toContain('海盐大福#4821');
    expect(card.quote?.body).toBe('你那边也下雨吗');
    expect(card.actions[0]).toMatchObject({ id: 'send', label: '寄出去' });
  });

  it('回信到了：只读，只有一个「知道了」', () => {
    const card = replyArrivedCard({
      base,
      reply: { letterId: 'l_1', from: '青柠汽水#2048', body: '我这边在下雨。', at: 3 },
      more: 2,
    });
    expect(card.body).toBe('我这边在下雨。');
    expect(card.meta).toBe('还有 2 封在信箱里');
    expect(card.actions).toEqual([{ id: 'close', label: '知道了', tone: 'ghost' }]);
  });

  it('等待卡片只给「收起」', () => {
    const card = waitingCard(base);
    expect(card.eyebrow).toContain('它正在读');
    expect(card.actions.map((a) => a.id)).toEqual(['close']);
  });

  it('种子信的 topic 走 title，不混进底部 meta', () => {
    // 钉住一个真 bug：topic 曾经被拼进 meta（底部灰色小字），标题位置上放的却是
    // 状态文案「它不会回信」。结果人类一眼看过去找不到「这封信叫什么」。
    const card = heldLetterCard({
      base,
      held: {
        letterId: 'seed_x',
        from: '海边邮局',
        body: '正文。',
        caughtAt: 0,
        windowUntil: 0,
        seed: true,
        topic: '不会问',
        signature: '一个同事',
      },
      hoursLeft: 72,
    });

    expect(card.title).toBe('不会问');
    expect(card.meta).toBe('海边邮局寄来的，不会回信');
    // 状态不该出现在 title 里，topic 也不该出现在 meta 里
    expect(card.title).not.toContain('不会回信');
    expect(card.meta).not.toContain('不会问');
  });

  it('种子信没有 topic 时，title 退回状态文案（标题位置不留空）', () => {
    const card = heldLetterCard({
      base,
      held: { letterId: 'seed_y', from: '海边邮局', body: '正文。', caughtAt: 0, windowUntil: 0, seed: true },
      hoursLeft: 72,
    });
    expect(card.title).toBe('它不会回信');
  });
});
