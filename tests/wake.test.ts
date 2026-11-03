import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WakeScheduler, localDay, type WakeAction } from '../world/wake.ts';

const HOUR = 3_600_000;
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function setup(random = () => 0) {
  const dir = mkdtempSync(join(tmpdir(), 'bottle-wake-')); dirs.push(dir);
  const file = join(dir, 'bottle-wake.json');
  const clock = { t: Date.parse('2026-11-01T00:00:00+08:00') };
  const make = () => new WakeScheduler(file, () => clock.t, random, 'Asia/Hong_Kong');
  const wake = make();
  const eligible = { write: true, catch: false };
  const due = (action: WakeAction = 'write') => {
    eligible.write = action === 'write'; eligible.catch = action === 'catch';
    wake.check(eligible, true);
    clock.t += 2 * HOUR;
    return wake.check(eligible, true)!;
  };
  const deliver = (id: string) => { expect(wake.render(id, true)).toBe(true); wake.settled(id, 'delivered'); };
  return { wake, clock, make, eligible, due, deliver, file };
}

describe('持久化的随机海边邀请', () => {
  it('首次与下一次都随机延后，不在启动时唤醒，抽样范围为 2—4 小时', () => {
    for (const [random, delay] of [[0, 2], [0.5, 3], [1, 4]] as const) {
      const h = setup(() => random);
      expect(h.wake.check(h.eligible, true)).toBeNull();
      expect(h.wake.snapshot().lanes.write.nextAt).toBe(h.clock.t + delay * HOUR);
    }
  });
  it('额度不足停止计时，恢复条件后重新随机安排，不立即补催', () => {
    const h = setup(); h.wake.check(h.eligible, true);
    h.clock.t += 3 * HOUR;
    expect(h.wake.check({ write: false, catch: false }, true)).toBeNull();
    expect(h.wake.snapshot().lanes.write.nextAt).toBeNull();
    expect(h.wake.check(h.eligible, true)).toBeNull();
    expect(h.wake.snapshot().lanes.write.nextAt).toBe(h.clock.t + 2 * HOUR);
  });
  it('同一时间只排一份任务，宿主暂停不消耗邀请次数或不断积压', () => {
    const h = setup(); const task = h.due();
    expect(task.id).toBeTruthy();
    for (let i = 0; i < 10; i++) {
      h.clock.t += 10 * 60_000;
      expect(h.wake.check({ write: true, catch: true }, true)).toBeNull();
    }
    expect(h.wake.snapshot().active?.id).toBe(task.id);
    expect(h.wake.snapshot().lanes.write.count).toBe(0);
  });
  it('忙碌不安排；真正投递前再次核对条件，失效则不播报', () => {
    const h = setup(); h.wake.check(h.eligible, true); h.clock.t += 2 * HOUR;
    expect(h.wake.check(h.eligible, false)).toBeNull();
    const task = h.wake.check(h.eligible, true)!;
    expect(h.wake.render(task.id, false)).toBe(false);
    expect(h.wake.snapshot().history.at(-1)).toMatchObject({ result: 'cancelled', reason: 'conditions_changed' });
    expect(h.wake.snapshot().lanes.write.count).toBe(0);
  });
  it('只有已投递任务随一轮结束记作未完成；最多补试一次，沿用唯一 ID', () => {
    const h = setup(); const task = h.due();
    h.wake.turnEnded(); expect(h.wake.snapshot().active?.phase).toBe('queued');
    h.deliver(task.id); h.wake.turnEnded();
    expect(h.wake.snapshot().active).toMatchObject({ id: task.id, phase: 'retry', attempts: 1 });
    h.clock.t += 29 * 60_000; expect(h.wake.check(h.eligible, true)).toBeNull();
    h.clock.t += 60_000;
    expect(h.wake.check(h.eligible, true)?.id).toBe(task.id);
    h.deliver(task.id); h.wake.turnEnded();
    expect(h.wake.snapshot().active).toBeNull();
    expect(h.wake.snapshot().history.at(-1)).toMatchObject({ id: task.id, result: 'failed', attempts: 2 });
    h.clock.t += 6 * HOUR;
    expect(h.wake.check(h.eligible, true)).toBeNull();
  });
  it('超时也有失败记录，不会永远停在等待结果', () => {
    const h = setup(); const task = h.due(); h.deliver(task.id);
    h.clock.t += 10 * 60_000; h.wake.check(h.eligible, true);
    expect(h.wake.snapshot().history.at(-1)).toMatchObject({ result: 'uncompleted', reason: 'turn_timeout' });
  });
  it.each(['no_idea', 'not_now'] as const)('明确选择 %s 后正常延后，不算失败', reason => {
    const h = setup(); const task = h.due(); h.deliver(task.id);
    expect(h.wake.decide('write', reason)).toBe(true);
    h.wake.turnEnded();
    expect(h.wake.snapshot().active).toBeNull();
    expect(h.wake.snapshot().history.at(-1)).toMatchObject({ result: 'deferred', reason });
    expect(h.wake.snapshot().lanes.write.nextAt).toBe(h.clock.t + 2 * HOUR);
  });
  it('成功结束当前任务，下一份新任务使用另一个 ID', () => {
    const h = setup(); const task = h.due(); h.deliver(task.id); h.wake.success('write');
    h.wake.turnEnded();
    expect(h.wake.snapshot().history.at(-1)?.result).toBe('completed');
    h.clock.t += 2 * HOUR;
    expect(h.wake.check(h.eligible, true)?.id).not.toBe(task.id);
  });
  it('人的拒绝当天不再催，暂停跨日跨重启保留，只能明确恢复', () => {
    const h = setup(); const task = h.due(); h.deliver(task.id);
    h.wake.decide('write', 'user_declined'); h.clock.t += 3 * HOUR;
    expect(h.wake.check(h.eligible, true)).toBeNull();
    expect(h.make().snapshot().lanes.write.declined).toBe(true);
    h.wake.decide('catch', 'user_paused');
    h.clock.t += 24 * HOUR;
    const restarted = h.make();
    expect(restarted.snapshot().lanes.catch.paused).toBe(true);
    expect(restarted.snapshot().lanes.write.declined).toBe(false);
    restarted.pause('catch', false);
    expect(restarted.snapshot().lanes.catch.paused).toBe(false);
    expect(restarted.snapshot().lanes.catch.nextAt).toBe(h.clock.t + 2 * HOUR);
  });
  it('重启将未完成任务记录为中断，并延后，不立刻补发', () => {
    const h = setup(); const task = h.due(); h.deliver(task.id);
    const restarted = h.make();
    expect(restarted.snapshot().active).toBeNull();
    expect(restarted.snapshot().history.at(-1)).toMatchObject({ id: task.id, result: 'interrupted' });
    expect(restarted.check(h.eligible, true)).toBeNull();
    expect(restarted.snapshot().lanes.write.nextAt).toBe(h.clock.t + 2 * HOUR);
  });
  it('每日上限包含重试；普通成功也最多每类 3 次', () => {
    const h = setup();
    for (let i = 0; i < 3; i++) { const task = h.due(); h.deliver(task.id); h.wake.success('write'); }
    h.clock.t += 2 * HOUR;
    expect(h.wake.check(h.eligible, true)).toBeNull();
    expect(h.wake.snapshot().lanes.write.count).toBe(3);
  });
  it('清队列视为拒绝，不擅自再排；旧任务不能结算新任务', () => {
    const h = setup(); const task = h.due();
    h.wake.render(task.id, true); h.wake.settled(task.id, 'discarded');
    expect(h.wake.snapshot().lanes.write.declined).toBe(true);
    h.wake.settled(task.id, 'delivered');
    expect(h.wake.snapshot().active).toBeNull();
  });
  it('宿主连续暂停多日也只保留一份队列项，恢复时不投递过期邀请', () => {
    const h = setup(); const task = h.due();
    h.clock.t += 3 * 24 * HOUR;
    expect(h.wake.check(h.eligible, true)).toBeNull();
    expect(h.wake.snapshot().active?.id).toBe(task.id);
    expect(h.wake.render(task.id, true)).toBe(false);
    expect(h.wake.check(h.eligible, true)).toBeNull();
  });
  it('无法入队时暴露失败，当天不反复创建新任务', () => {
    const h = setup(); const task = h.due(); h.wake.queueFailed(task.id);
    expect(h.wake.snapshot().history.at(-1)).toMatchObject({ result: 'failed', reason: 'queue_failed' });
    h.clock.t += 3 * HOUR;
    expect(h.wake.check(h.eligible, true)).toBeNull();
  });
  it('按部署时区跨日，不按 UTC 计算', () => {
    expect(localDay(Date.parse('2026-11-01T17:00:00Z'), 'Asia/Hong_Kong')).toBe('2026-11-02');
  });
});


describe('新增提醒与手动邀请持久状态', () => {
  it('调整的间隔跨重启、跨天保留，提醒有独立暂停', () => {
    const h = setup(); h.wake.configure('remind', 0.75); h.wake.pause('catch', true);
    const eligible = { write: false, catch: false, remind: true };
    h.wake.check(eligible, true);
    expect(h.wake.snapshot().lanes.remind.nextAt).toBe(h.clock.t + 0.75 * HOUR);
    h.clock.t += 24 * HOUR;
    const restored = h.make(); restored.check(eligible, true);
    expect(restored.snapshot().lanes.remind.intervalHours).toBe(0.75);
    expect(restored.snapshot().lanes.catch.paused).toBe(true);
    expect(restored.snapshot().lanes.remind.nextAt).toBe(h.clock.t + 0.75 * HOUR);
  });
  it('手动邀请冷却不会被重启绕过，不自动重试手动邀请', () => {
    const h = setup(); const task = h.wake.invite('write', true)!;
    h.deliver(task.id); h.wake.turnEnded();
    expect(h.wake.snapshot().active).toBeNull();
    expect(h.wake.snapshot().history.at(-1)?.result).toBe('failed');
    expect(h.make().invite('write', true)).toBeNull();
    h.clock.t += 60_001;
    expect(h.make().invite('write', true)?.manual).toBe(true);
  });
  it('待办提醒送达即完成，不要求 Bot 为了记账调用工具', () => {
    const h = setup(); const eligible = { write: false, catch: false, remind: true };
    h.wake.check(eligible, true); h.clock.t += 2 * HOUR;
    const task = h.wake.check(eligible, true)!; h.deliver(task.id); h.wake.turnEnded();
    expect(h.wake.snapshot().active).toBeNull();
    expect(h.wake.snapshot().lanes.remind.count).toBe(1);
    expect(h.wake.snapshot().history.at(-1)?.reason).toBe('reminder_delivered');
  });
});


it('旧模型写错 action 也能结算唯一当前邀请；晚到的投递回调不会改回失败', () => {
  const h = setup(); const task = h.due(); expect(h.wake.render(task.id, true)).toBe(true);
  expect(h.wake.decide('remind', 'no_idea')).toBe(true);
  h.wake.settled(task.id, 'delivered'); h.wake.turnEnded();
  expect(h.wake.snapshot().history.at(-1)).toMatchObject({ action: 'write', result: 'deferred', reason: 'no_idea' });
  expect(h.wake.snapshot().lanes.write.failed).toBe(false);
});
it('没有当前投递任务时不接受无端的暂不做，也不擅自扩大人的暂停范围', () => {
  const h = setup();
  expect(h.wake.decide(undefined, 'no_idea')).toBe(false);
  const task = h.due();
  expect(h.wake.decide(undefined, 'no_idea')).toBe(false);
  h.deliver(task.id);
  h.wake.decide('remind', 'user_paused');
  expect(h.wake.snapshot().lanes.remind.paused).toBe(true);
  expect(h.wake.snapshot().active?.action).toBe('write');
  expect(h.wake.snapshot().lanes.write.paused).toBe(false);
  h.wake.decide(undefined, 'user_paused');
  expect(h.wake.snapshot().lanes.write.paused).toBe(true);
});


it.each(['write', 'catch', 'remind'] as const)('每日上限可热调且跨日、重启保留：%s', action => {
  const h = setup();
  const eligible = { write: action === 'write', catch: action === 'catch', remind: action === 'remind' };
  const hours = action === 'remind' ? 0.5 : 2;
  const initial = action === 'remind' ? 3 : 1;
  h.wake.configure(action, hours, initial);
  for (let i = 0; i < initial; i++) {
    h.wake.check(eligible, true); h.clock.t += 2 * HOUR;
    const task = h.wake.check(eligible, true)!;
    h.deliver(task.id); h.wake.success(action);
  }
  h.clock.t += 2 * HOUR;
  expect(h.wake.check(eligible, true)).toBeNull();
  expect(h.wake.snapshot().lanes[action].count).toBe(initial);
  h.wake.configure(action, hours, initial + 1);
  expect(h.wake.snapshot().lanes[action].count).toBe(initial);
  h.wake.check(eligible, true); h.clock.t += 2 * HOUR;
  expect(h.wake.check(eligible, true)?.action).toBe(action);
  const restored = h.make();
  expect(restored.snapshot().lanes[action].dayLimit).toBe(initial + 1);
  h.clock.t += 24 * HOUR;
  restored.check(eligible, true);
  expect(restored.snapshot().lanes[action]).toMatchObject({ count: 0, dayLimit: initial + 1 });
});

it('上限为一时不再自动补试，手动邀请仍可单独发出', () => {
  const h = setup(); h.wake.configure('write', 2, 1);
  const task = h.due(); h.deliver(task.id); h.wake.turnEnded();
  expect(h.wake.snapshot().active).toBeNull();
  expect(h.wake.snapshot().lanes.write.count).toBe(1);
  expect(h.wake.invite('write', true)?.manual).toBe(true);
});

it.each([0, -1, 25, 1.5, NaN, Infinity])('拒绝无效每日上限 %s，保留旧配置', limit => {
  const h = setup();
  expect(() => h.wake.configure('write', 2, limit)).toThrow('每日上限');
  expect(h.wake.snapshot().lanes.write.dayLimit).toBeUndefined();
});


describe('仅来信待办使用半小时提醒节奏', () => {
  const eligible = { write: false, catch: false, remind: true };
  it.each([0, 0.5, 1])('随机值 %s 对应 30—60 分钟，不提前触发且不受一小时拦截', random => {
    const h = setup(() => random);
    h.wake.check(eligible, true);
    const delay = (0.5 + random * 0.5) * HOUR;
    expect(h.wake.snapshot().lanes.remind.nextAt).toBe(h.clock.t + delay);
    h.clock.t += delay - 1;
    expect(h.wake.check(eligible, true)).toBeNull();
    h.clock.t++;
    const first = h.wake.check(eligible, true)!;
    h.deliver(first.id); h.wake.turnEnded();
    h.clock.t += delay;
    expect(h.wake.check(eligible, true)?.action).toBe('remind');
  });
  it('默认每日十二次，重启保留今日次数，热调不清零，跨日恢复', () => {
    const h = setup();
    h.wake.check(eligible, true);
    for (let n = 0; n < 12; n++) {
      h.clock.t += 0.5 * HOUR;
      const task = h.wake.check(eligible, true)!;
      expect(task?.action).toBe('remind');
      h.deliver(task.id); h.wake.turnEnded();
    }
    h.clock.t += HOUR;
    expect(h.wake.check(eligible, true)).toBeNull();
    const restored = h.make();
    expect(restored.snapshot().lanes.remind.count).toBe(12);
    restored.configure('remind', 0.5, 13);
    expect(restored.snapshot().lanes.remind.count).toBe(12);
    restored.check(eligible, true); h.clock.t += 0.5 * HOUR;
    const task = restored.check(eligible, true)!;
    expect(restored.render(task.id, true)).toBe(true);
    restored.settled(task.id, 'delivered'); restored.turnEnded();
    h.clock.t += 24 * HOUR; restored.check(eligible, true);
    expect(restored.snapshot().lanes.remind).toMatchObject({ count: 0, dayLimit: 13 });
  });
  it.each([3, 20])('允许每日上限 %s 并跨重启保留', limit => {
    const h = setup(); h.wake.configure('remind', 0.5, limit);
    expect(h.make().snapshot().lanes.remind.dayLimit).toBe(limit);
  });
  it.each([2, 21, 3.5, NaN, Infinity])('拒绝非法每日上限 %s，不改动原设置', limit => {
    const h = setup(); h.wake.configure('remind', 0.5, 12);
    expect(() => h.wake.configure('remind', 0.75, limit)).toThrow('每日上限');
    expect(h.wake.snapshot().lanes.remind).toMatchObject({ intervalHours: 0.5, dayLimit: 12 });
  });
  it.each([0.49, 1.01, NaN, Infinity])('拒绝超出半小时至一小时的最短间隔 %s', hours => {
    const h = setup(); expect(() => h.wake.configure('remind', hours, 12)).toThrow('间隔');
  });
  it('调大最短间隔仍不会随机等过一小时', () => {
    const h = setup(() => 1); h.wake.configure('remind', 0.75, 12);
    h.wake.check(eligible, true);
    expect(h.wake.snapshot().lanes.remind.nextAt).toBe(h.clock.t + HOUR);
  });
  it('没有待处理来信即清除计时；已排队但来信已处理时不投递也不扣次数', () => {
    const h = setup(); h.wake.check(eligible, true);
    h.wake.check({ write: false, catch: false, remind: false }, true);
    expect(h.wake.snapshot().lanes.remind.nextAt).toBeNull();
    h.wake.check(eligible, true); h.clock.t += 0.5 * HOUR;
    const task = h.wake.check(eligible, true)!;
    expect(h.wake.render(task.id, false)).toBe(false);
    expect(h.wake.snapshot().lanes.remind.count).toBe(0);
    expect(h.wake.snapshot().history.at(-1)).toMatchObject({ result: 'cancelled', reason: 'conditions_changed' });
  });
  it('旧长间隔迁移为半小时，保留计数与暂停且不重启补催', () => {
    const h = setup();
    const saved = h.wake.snapshot();
    Object.assign(saved.lanes.remind, { intervalHours: 2, dayLimit: 12, count: 7, paused: true, nextAt: h.clock.t + 4 * HOUR });
    writeFileSync(h.file, JSON.stringify(saved));
    const restored = h.make();
    expect(restored.snapshot().lanes.remind).toMatchObject({ intervalHours: 0.5, dayLimit: 12, count: 7, paused: true, nextAt: h.clock.t + 0.5 * HOUR });
    expect(restored.check(eligible, true)).toBeNull();
    expect(h.make().snapshot().lanes.remind.count).toBe(7);
  });
});
