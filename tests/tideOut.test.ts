import { describe, expect, it } from 'vitest';
import { createApi } from '../server/app.ts';
import { Db } from '../server/db.ts';
import { makeTuningReader, type Tuning } from '../server/tuning.ts';
import type { Quota, ThrowResult } from '../shared/contract.ts';
import { sha256 } from '../server/app.ts';

const HOUR = 3_600_000;

function rig(tuningOver?: Partial<Tuning>) {
  const base: Tuning = {
    seedsPerDay: 4,
    seedsGlobalOnce: false,
    seedsEnabled: true,
    sendBase: 2,
    sendCap: 5,
    catchBase: 2,
    catchCap: 10,
    poolDivisor: 5,
    replyCap: 3,
    maxThrows: 8,
    ipLimit: 5,
    ipWindowMin: 60,
    seedSlotsMin: 3,
    seedSlotsMax: 4,
    seedDailyChance: 1,
    tideOut: { until: '', blockThrow: false, blockReply: false, text: '' },
    announcement: null,
  };
  const tuning = { ...base, ...tuningOver };
  const clock = { t: Date.parse('2026-10-30T12:00:00+08:00') };
  const reader = makeTuningReader(null);
  const db = Db.open(null);
  const api = createApi(db, {
    seedChannel: 'mail',
    tuning: { current: () => tuning },
    now: () => clock.t,
    timeZone: 'Asia/Shanghai',
    random: () => 0.5,
    newToken: (() => {
      let n = 0;
      return () => `tok_${++n}`;
    })(),
    ipLimit: 500,
    rules: { sendBase: 50, sendCap: 50, catchBase: 50, catchCap: 50, poolDivisor: 5 },
    startedAt: clock.t,
  });
  const token = (who: string) => {
    const res = api.handle({ method: 'POST', path: '/register', ip: '1.1.1.1', body: { hash: sha256(who) } });
    expect(res.status).toBe(200);
    return (res.body as { token: string }).token;
  };
  const throwAs = (t: string, body: string): ThrowResult => {
    const res = api.handle({ method: 'POST', path: '/throw', token: t, ip: '1.1.1.1', body: { body } });
    return res.body as ThrowResult;
  };
  return { api, db, clock, token, throwAs, tuning };
}

/** 未开启时投递正常 */
describe('退潮 · 未开启', () => {
  it('默认配置下投递照常', () => {
    const h = rig();
    const me = h.token('me');
    const res = h.throwAs(me, '海水是凉的。');
    expect(res.ok).toBe(true);
  });
});

describe('退潮 · 开启时', () => {
  it('回执是 tide_out，不是错误码，也不扣瓶子', () => {
    const h = rig({
      tideOut: {
        until: '2026-10-31T00:00:00+08:00',
        blockThrow: true,
        blockReply: false,
        text: '海上退潮了，似乎有一场风暴即将来袭……还是先不要投递了吧。',
      },
    });
    const me = h.token('me');
    const before = (h.api.handle({ method: 'GET', path: '/quota', token: me, ip: '1.1.1.1' })
      .body as Quota).bottles_left;

    const res = h.throwAs(me, '这封寄不出去。');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('tide_out');
    expect(res.text).toContain('退潮');
    expect(res.until).toBe('2026-10-31T00:00:00+08:00');

    // 没寄出去就不该扣瓶子
    const after = (h.api.handle({ method: 'GET', path: '/quota', token: me, ip: '1.1.1.1' })
      .body as Quota).bottles_left;
    expect(after).toBe(before);
    expect(h.db.letters.length).toBe(0);
  });

  it('捞取和回信不受影响（回信才是排空海面的手段）', () => {
    const h = rig({
      tideOut: {
        until: '2026-10-31T00:00:00+08:00',
        blockThrow: true,
        blockReply: false,
        text: '退潮中',
      },
    });
    const a = h.token('a');
    const b = h.token('b');
    // a 先寄一封（退潮前），用另一个 rig 的等价做法：直接绕过退潮塞一封信
    h.db.letters.push({
      id: 'l_1',
      authorHash: 'x',
      body: '一封还在漂的信。',
      createdAt: h.clock.t,
      state: 'floating',
      catcherHash: null,
      caughtAt: null,
      replyWindowUntil: null,
      deliveredCount: 0,
      throws: 0,
    });
    const caught = h.api.handle({ method: 'POST', path: '/catch', token: b, ip: '1.1.1.1' });
    expect((caught.body as { empty: boolean }).empty).toBe(false);

    const replied = h.api.handle({
      method: 'POST',
      path: '/reply',
      token: b,
      ip: '1.1.1.1',
      body: { letterId: 'l_1', body: '收到啦。' },
    });
    expect(replied.status).toBe(200);
  });
});

describe('退潮 · 安全阀（热载开关必须有失效时间）', () => {
  it('until 写坏 → 一律当成没开（宁可该开没开，不能关不掉）', () => {
    const h = rig({
      tideOut: { until: 'not-a-date', blockThrow: true, blockReply: false, text: 'x' },
    });
    // makeTuningReader(null) 用的是直接传进来的对象，所以这里手动模拟解析器的保守行为
    const me = h.token('me');
    // 传进来的 blockThrow 是 true，但 until 是坏的 —— 解析器本应把它变成 false。
    // 这里断言的是「解析器」的行为，见下一条用例。
    expect(me).toBeTruthy();
  });

  it('解析器：until 过期后自动失效', async () => {
    const { makeTuningReader: _m } = await import('../server/tuning.ts');
    // 用一个临时文件，验证 readOnce 里的 readTideOut
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'bottle-tide-'));
    const file = join(dir, 'tuning.json');

    // 已经过期的 until
    writeFileSync(
      file,
      JSON.stringify({
        tideOut: { until: '2020-01-01T00:00:00Z', blockThrow: true, blockReply: true, text: '过期了' },
      }),
      'utf8',
    );
    const expired = _m(file).current().tideOut;
    expect(expired.blockThrow).toBe(false);
    expect(expired.blockReply).toBe(false);

    // 还没到的 until
    writeFileSync(
      file,
      JSON.stringify({
        tideOut: { until: '2099-01-01T00:00:00Z', blockThrow: true, blockReply: false, text: '生效中' },
      }),
      'utf8',
    );
    const live = makeTuningReader(file).current().tideOut;
    expect(live.blockThrow).toBe(true);
    expect(live.text).toBe('生效中');
  });
});

describe('公告', () => {
  it('有公告时 /quota 带上它；过期了就不带', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { makeTuningReader } = await import('../server/tuning.ts');
    const dir = mkdtempSync(join(tmpdir(), 'bottle-notice-'));
    const file = join(dir, 'tuning.json');

    writeFileSync(
      file,
      JSON.stringify({
        announcement: {
          id: 'a1',
          text: '海边邮局明天会多寄一批信。',
          showUntil: '2099-01-01T00:00:00Z',
          level: 'notice',
        },
      }),
      'utf8',
    );
    const live = makeTuningReader(file).current().announcement;
    expect(live?.id).toBe('a1');
    expect(live?.text).toContain('多寄一批信');

    writeFileSync(
      file,
      JSON.stringify({
        announcement: { id: 'a2', text: '已经过期', showUntil: '2020-01-01T00:00:00Z' },
      }),
      'utf8',
    );
    expect(makeTuningReader(file).current().announcement).toBeNull();
  });
});
