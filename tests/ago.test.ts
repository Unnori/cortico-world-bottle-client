import { describe, expect, it } from 'vitest';
import { agoText } from '../shared/ago.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('agoText · 多久以前说成人话', () => {
  it('不到一分钟就是「刚刚」', () => {
    expect(agoText(0)).toBe('刚刚');
    expect(agoText(MINUTE - 1)).toBe('刚刚');
  });

  it('不到一小时按分钟', () => {
    expect(agoText(MINUTE)).toBe('1 分钟前');
    expect(agoText(59 * MINUTE)).toBe('59 分钟前');
  });

  it('不到一天按小时', () => {
    expect(agoText(HOUR)).toBe('1 小时前');
    expect(agoText(23 * HOUR)).toBe('23 小时前');
  });

  it('一天以上按天', () => {
    expect(agoText(DAY)).toBe('1 天前');
    expect(agoText(3 * DAY + 5 * HOUR)).toBe('3 天前');
  });

  it('时钟回拨（负数）不显示「-3 分钟前」', () => {
    expect(agoText(-3 * MINUTE)).toBe('刚刚');
  });

  it('落地页那句话现在是「最近一次是刚刚」，不是「0 天前」', () => {
    // 这是这次修的具体症状：刚起过浪时 at - lastAt 很小
    const justNow = 20_000;
    expect(agoText(justNow)).toBe('刚刚');
    expect(agoText(justNow)).not.toContain('0 天前');
  });
});
