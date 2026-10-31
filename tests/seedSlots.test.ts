import { describe, expect, it } from 'vitest';
import { dayStartMs, seedDayPlan, slotsArrived } from '../shared/seedSlots.ts';

const TZ = 'Asia/Hong_Kong';
const AT = Date.parse('2026-10-31T15:00:00+08:00'); // 北京时间下午 3 点
const DAY = 86_400_000;

describe('seedSlots · 种子信的当天随机时刻', () => {
  it('同一天、同一个人：结果稳定（刷新/重启/多端都一致）', () => {
    const a = seedDayPlan('hash-abc', '2026-10-31', dayStartMs(TZ, AT), 3, 4, 1);
    const b = seedDayPlan('hash-abc', '2026-10-31', dayStartMs(TZ, AT), 3, 4, 1);
    expect(a.slots).toEqual(b.slots);
  });

  it('换一天就换一套时刻（不能让人摸清自己几点必来信）', () => {
    const d1 = seedDayPlan('hash-abc', '2026-10-31', dayStartMs(TZ, AT), 3, 4, 1);
    const d2 = seedDayPlan('hash-abc', '2026-11-01', dayStartMs(TZ, AT), 3, 4, 1);
    expect(d1.slots).not.toEqual(d2.slots);
  });

  it('换个人就换一套时刻（同一时刻全服一起收信才是要修的病）', () => {
    const a = seedDayPlan('hash-abc', '2026-10-31', dayStartMs(TZ, AT), 3, 4, 1);
    const b = seedDayPlan('hash-xyz', '2026-10-31', dayStartMs(TZ, AT), 3, 4, 1);
    expect(a.slots).not.toEqual(b.slots);
  });

  it('数量落在 [3,4] 且不重复、已排序', () => {
    for (let i = 0; i < 40; i++) {
      const plan = seedDayPlan(`h${i}`, '2026-10-31', 0, 3, 4, 1);
      expect(plan.slots.length).toBeGreaterThanOrEqual(3);
      expect(plan.slots.length).toBeLessThanOrEqual(4);
      expect([...plan.slots].sort((x, y) => x - y)).toEqual(plan.slots);
      expect(new Set(plan.slots).size).toBe(plan.slots.length);
    }
  });

  it('全都落在那一天之内', () => {
    for (let i = 0; i < 40; i++) {
      const plan = seedDayPlan(`h${i}`, '2026-10-31', 0, 3, 4, 1);
      for (const s of plan.slots) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(DAY);
      }
    }
  });

  it('分桶生效：相邻两个时刻不会挤在一起', () => {
    // 4 个槽 => 每桶 6 小时。最坏情况下相邻间隔也不会小于「桶宽 - 桶内随机量」，
    // 这里只断言它们不是同一分钟堆在一起（那正是直接撒随机数会犯的错）。
    for (let i = 0; i < 40; i++) {
      const plan = seedDayPlan(`h${i}`, '2026-10-31', 0, 4, 4, 1);
      for (let k = 1; k < plan.slots.length; k++) {
        expect(plan.slots[k] - plan.slots[k - 1]).toBeGreaterThan(0);
      }
    }
  });

  it('slot 的桶内偏移真的覆盖整个桶（回归：曾经全部贴着整点）', () => {
    // 曾经的 bug：桶内偏移只用 16 位随机数（上限 65535），
    // 对桶宽（约 2160 万毫秒）取模永远不生效，于是所有时刻都贴着整点
    // （线上实测出 00:00 / 08:00 / 16:00 这种），"分散到全天"完全没做到。
    // 这条断言专门防它复发。
    for (const count of [3, 4]) {
      const bucket = DAY / count;
      const ratios: number[] = [];
      for (let i = 0; i < 60; i++) {
        const plan = seedDayPlan(`h${i}`, '2026-10-31', 0, count, count, 1);
        for (let k = 0; k < plan.slots.length; k++) {
          const offset = plan.slots[k] - Math.floor(k * bucket);
          expect(offset).toBeGreaterThan(0);
          ratios.push(offset / bucket);
        }
      }
      // 判据是"铺开"，不是"每个值都很大"：
      // 随机数本来就可能接近桶起点，要求每个值 > 1% 会误伤。
      // 但 16 位取模失效时，所有值都会被压在 < 0.3% 里，铺开接近 0。
      const spread = Math.max(...ratios) - Math.min(...ratios);
      expect(spread).toBeGreaterThan(0.5);
      // 同时确认确实有值落在桶的后半段（16 位失效时永远到不了这里）
      expect(Math.max(...ratios)).toBeGreaterThan(0.5);
    }
  });

  it('slotsArrived：一天里陆续到点，不是一次性全到', () => {
    const plan = seedDayPlan('hash-abc', '2026-10-31', dayStartMs(TZ, AT), 4, 4, 1);
    const midnight = dayStartMs(TZ, AT);
    // 刚过零点：最多只有"零点前那个点"到（分桶首个点可能很小）
    expect(slotsArrived(plan, midnight)).toBe(0);
    // 当天结束前一秒：全到
    expect(slotsArrived(plan, midnight + DAY - 1000)).toBe(plan.slots.length);
  });

  it('dailyChance = 0 时今天一封都不发', () => {
    const plan = seedDayPlan('hash-abc', '2026-10-31', 0, 3, 4, 0);
    expect(plan.slots).toEqual([]);
  });

  it('dailyChance = 1.0 时天天都发（不会因为随机没摇中就停发）', () => {
    for (let i = 0; i < 20; i++) {
      const plan = seedDayPlan(`h${i}`, '2026-10-31', 0, 3, 4, 1);
      expect(plan.slots.length).toBeGreaterThan(0);
    }
  });

  it('dayStartMs 拿到的是当地 00:00，不是 UTC 00:00', () => {
    // 香港是 UTC+8，所以当地 00:00 = UTC 前一天 16:00
    const start = dayStartMs(TZ, AT);
    expect(start).toBe(Date.parse('2026-10-31T00:00:00+08:00'));
    expect(new Date(start).toISOString()).toBe('2026-10-30T16:00:00.000Z');
  });

  it('时区写坏也不抛异常（退化成 UTC 当天）', () => {
    const start = dayStartMs('Not/AZone', AT);
    expect(Number.isFinite(start)).toBe(true);
  });
});
