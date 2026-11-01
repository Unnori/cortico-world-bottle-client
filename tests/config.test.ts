import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorldContext } from 'cortico/world.ts';
import { BottleWorld } from '../world/world.ts';
import { BOTTLE_CONFIG_GROUP, BOTTLE_DEFAULTS, BOTTLE_WAKE_FIELDS, initialiseWakeSettings, type BottleConfigSection } from '../world/config.ts';

describe('邀请配置声明与旧设置迁移', () => {
  it('三类邀请均提供热更新开关与 2—24 小时间隔', () => {
    for (const [, enabled, interval] of BOTTLE_WAKE_FIELDS) {
      expect(BOTTLE_CONFIG_GROUP.schema.properties[`worlds.bottle.${enabled}`]).toMatchObject({ type: 'boolean', 'x-hot': true });
      expect(BOTTLE_CONFIG_GROUP.schema.properties[`worlds.bottle.${interval}`]).toMatchObject({ type: 'number', minimum: 2, maximum: 24, 'x-hot': true });
    }
  });
  it('旧信箱设置里的暂停和间隔会成为新增配置项的初值', () => {
    const cfg = { ...BOTTLE_DEFAULTS };
    initialiseWakeSettings(cfg, { write: { paused: true, intervalHours: 8 }, catch: { paused: false, intervalHours: 6 }, remind: { paused: true, intervalHours: 4 } });
    expect(cfg).toMatchObject({ writeInviteEnabled: false, writeInviteIntervalHours: 8,
      catchInviteEnabled: true, catchInviteIntervalHours: 6, reminderEnabled: false, reminderIntervalHours: 4 });
  });
  it('显式配置优先；缺失或损坏的旧设置安全回到默认值', () => {
    const cfg: BottleConfigSection = { ...BOTTLE_DEFAULTS, writeInviteEnabled: true, writeInviteIntervalHours: 3 };
    initialiseWakeSettings(cfg, { write: { paused: true, intervalHours: 8 }, catch: null, remind: { intervalHours: 100 } }, { writeInviteEnabled: true, writeInviteIntervalHours: 3 });
    expect(cfg).toMatchObject({ writeInviteEnabled: true, writeInviteIntervalHours: 3,
      catchInviteEnabled: true, catchInviteIntervalHours: 2, reminderEnabled: true, reminderIntervalHours: 24 });
  });
});


it('defaults 中为每个声明提供合法值，升级迁移仍尊重显式的开启和两小时', () => {
  const cfg: BottleConfigSection = { ...BOTTLE_DEFAULTS };
  for (const [, enabled, interval] of BOTTLE_WAKE_FIELDS) {
    expect(BOTTLE_DEFAULTS[enabled]).toBe(true);
    expect(BOTTLE_DEFAULTS[interval]).toBe(2);
  }
  initialiseWakeSettings(cfg, { write: { paused: true, intervalHours: 12 } },
    { writeInviteEnabled: true, writeInviteIntervalHours: 2 });
  expect(cfg.writeInviteEnabled).toBe(true);
  expect(cfg.writeInviteIntervalHours).toBe(2);
});


it.each([false, true])('构造读取旧暂停且尊重部署显式开启=%s，不修改部署文件或启动任务', explicit => {
  const dir = mkdtempSync(join(tmpdir(), 'bottle-config-migration-'));
  const configPath = join(dir, 'config.json');
  const legacyPath = join(dir, 'bottle-wake.json');
  const deployment = { worlds: { bottle: explicit ? { writeInviteEnabled: true, writeInviteIntervalHours: 2 } : {} } };
  const configText = JSON.stringify(deployment);
  const legacyText = JSON.stringify({ lanes: { write: { paused: true, intervalHours: 8 } } });
  writeFileSync(configPath, configText); writeFileSync(legacyPath, legacyText);
  try {
    const cfg = { ...BOTTLE_DEFAULTS };
    const ctx: WorldContext<BottleConfigSection> = { id: 'bottle', cfg, timezone: 'Asia/Shanghai', botName: 'Coo',
      botDir: dir, packageDir: dir, dataDir: dir, repoRoot: dir,
      secret: () => '', storeSecret: () => {}, persist: () => { throw new Error('constructor must be read-only'); }, restart: async () => {} };
    const world = new BottleWorld(ctx);
    expect(cfg.writeInviteEnabled).toBe(explicit);
    expect(cfg.writeInviteIntervalHours).toBe(explicit ? 2 : 8);
    expect(world.webUi().panels).toEqual([{ id: 'mailbox', title: '信箱' }]);
    expect(readFileSync(configPath, 'utf8')).toBe(configText);
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacyText);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
