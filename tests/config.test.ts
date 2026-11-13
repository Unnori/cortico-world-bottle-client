import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorldContext } from 'cortico/world.ts';
import { coerceGroupValues, readGroupValues } from 'cortico/core/config-schema.ts';
import { BottleWorld } from '../world/world.ts';
import { BOTTLE_CONFIG_FIELDS, BOTTLE_CONFIG_GROUPS, BOTTLE_DEFAULTS, BOTTLE_WAKE_FIELDS, initialiseWakeSettings, initialiseSoundSettings, type BottleConfigSection } from '../world/config.ts';

describe('邀请配置声明与旧设置迁移', () => {
  it('写信打捞保留长间隔，待办提醒提供半小时起的热更新间隔', () => {
    for (const [action, enabled, interval] of BOTTLE_WAKE_FIELDS) {
      expect(BOTTLE_CONFIG_FIELDS[`worlds.bottle.${enabled}`]).toMatchObject({ type: 'boolean', 'x-hot': true });
      expect(BOTTLE_CONFIG_FIELDS[`worlds.bottle.${interval}`]).toMatchObject({ type: 'number', minimum: action === 'remind' ? 0.5 : 2, maximum: action === 'remind' ? 1 : 24, 'x-hot': true });
    }
  });
  it('旧信箱设置里的暂停和间隔会成为新增配置项的初值', () => {
    const cfg = { ...BOTTLE_DEFAULTS };
    initialiseWakeSettings(cfg, { write: { paused: true, intervalHours: 8 }, catch: { paused: false, intervalHours: 6 }, remind: { paused: true, intervalHours: 4 } });
    expect(cfg).toMatchObject({ writeInviteEnabled: false, writeInviteIntervalHours: 8,
      catchInviteEnabled: true, catchInviteIntervalHours: 6, reminderEnabled: false, reminderIntervalHours: 0.5 });
  });
  it('显式配置优先；缺失或损坏的旧设置安全回到默认值', () => {
    const cfg: BottleConfigSection = { ...BOTTLE_DEFAULTS, writeInviteEnabled: true, writeInviteIntervalHours: 3 };
    initialiseWakeSettings(cfg, { write: { paused: true, intervalHours: 8 }, catch: null, remind: { intervalHours: 100 } }, { writeInviteEnabled: true, writeInviteIntervalHours: 3 });
    expect(cfg).toMatchObject({ writeInviteEnabled: true, writeInviteIntervalHours: 3,
      catchInviteEnabled: true, catchInviteIntervalHours: 2, reminderEnabled: true, reminderIntervalHours: 0.5 });
  });
});


it('defaults 中为每个声明提供合法值，升级迁移仍尊重显式的开启和两小时', () => {
  const cfg: BottleConfigSection = { ...BOTTLE_DEFAULTS };
  for (const [action, enabled, interval] of BOTTLE_WAKE_FIELDS) {
    expect(BOTTLE_DEFAULTS[enabled]).toBe(true);
    expect(BOTTLE_DEFAULTS[interval]).toBe(action === 'remind' ? 0.5 : 2);
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
    expect(world.webUi().config).toEqual(BOTTLE_CONFIG_GROUPS);
    expect(readFileSync(configPath, 'utf8')).toBe(configText);
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacyText);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


describe('配置页原生分组', () => {
  it('显示、邀请与音效靠前，可选访问与记忆随后，高危入口放在最底部', () => {
    expect(BOTTLE_CONFIG_GROUPS.map(group => group.schema.title)).toEqual([
      '显示与通知', '海边邀请与提醒', '桌面音效', '来信提示音', '回信提示音', '其他设备访问', '连接与调试', '星笺匣与记忆', '无头模式（高危实验功能）', '本地 Bridge 与 Controller（高级功能）',
    ]);
    expect(Object.keys(BOTTLE_CONFIG_GROUPS.find(group => group.id === 'world:bottle:display')!.schema.properties)).toEqual([
      'worlds.bottle.surface', 'worlds.bottle.cardAutoCloseSec', 'worlds.bottle.tsunamiNotice',
    ]);
    expect(Object.keys(BOTTLE_CONFIG_GROUPS.find(group => group.id === 'world:bottle:connection')!.schema.properties)).toEqual([
      'worlds.bottle.server', 'worlds.bottle.port', 'worlds.bottle.debug',
    ]);
  });
  it('所有配置恰好出现一次，声明与默认值不变', () => {
    const ids = BOTTLE_CONFIG_GROUPS.map(group => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    const paths = BOTTLE_CONFIG_GROUPS.flatMap(group => Object.keys(group.schema.properties));
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort()).toEqual(Object.keys(BOTTLE_CONFIG_FIELDS).sort());
    for (const group of BOTTLE_CONFIG_GROUPS) {
      expect(group.owner).toBe('world:bottle');
      const values = readGroupValues({worlds:{bottle:BOTTLE_DEFAULTS}} as never, group);
      expect(coerceGroupValues(group, values)).toEqual({values});
      for (const [path, declaration] of Object.entries(group.schema.properties)) {
        expect(declaration).toBe(BOTTLE_CONFIG_FIELDS[path]);
        expect(Object.hasOwn(BOTTLE_DEFAULTS,path.replace('worlds.bottle.',''))).toBe(true);
      }
    }
  });
  it('信箱页签保存访问配置仍使用原有组 ID，各组不会写入别组字段', () => {
    const lan = BOTTLE_CONFIG_GROUPS.find(group => group.id==='world:bottle')!;
    const values = {'worlds.bottle.lanEnabled':true,'worlds.bottle.lanPort':7799,'worlds.bottle.lanPublicUrl':'https://mail.example.test/'};
    expect(coerceGroupValues(lan,{...values,'worlds.bottle.soundVolume':30})).toEqual({values});
    for (const group of BOTTLE_CONFIG_GROUPS.filter(group=>group!==lan))
      expect(coerceGroupValues(group,values)).toEqual({values:{}});
  });
});

it('migrates retired audio defaults without changing explicit custom, shared or local sources',()=>{
  const config={...BOTTLE_DEFAULTS,soundIncomingPack:'incoming/default.wav',soundReplyPack:'reply/default.wav'};
  initialiseSoundSettings(config);
  expect(config.soundIncomingPack).toBe('incoming/incoming_default.wav');
  expect(config.soundReplyPack).toBe('reply/reply_default.wav');
  config.soundIncomingPack='shared.wav';config.soundReplyPack='reply/custom.wav';config.soundIncomingSource='local';config.soundIncomingFile='C:/Music/custom.wav';
  const before={...config};initialiseSoundSettings(config);expect(config).toEqual(before);
});


it('每日上限紧邻各自间隔，提醒默认十二次且范围三至二十', () => {
  const group = BOTTLE_CONFIG_GROUPS.find(item => item.id === 'world:bottle:invitations')!;
  const keys = Object.keys(group.schema.properties);
  for (const [action, , interval, , limit] of BOTTLE_WAKE_FIELDS) {
    expect(BOTTLE_DEFAULTS[limit]).toBe(action === 'remind' ? 12 : 3);
    expect(group.schema.properties[`worlds.bottle.${limit}`]).toMatchObject({ type: 'integer', minimum: action === 'remind' ? 3 : 1, maximum: action === 'remind' ? 20 : 24, 'x-hot': true });
    expect(keys.indexOf(`worlds.bottle.${limit}`)).toBe(keys.indexOf(`worlds.bottle.${interval}`) + 1);
  }
});


it('升级保留提醒暂停及合法次数，旧长间隔回到半小时，缺省次数十二次', () => {
  const cfg = { ...BOTTLE_DEFAULTS, reminderIntervalHours: 4, reminderDayLimit: 20 };
  initialiseWakeSettings(cfg, { remind: { paused: true, intervalHours: 4 } });
  expect(cfg).toMatchObject({ reminderEnabled: false, reminderIntervalHours: 0.5, reminderDayLimit: 20 });
  const fresh = { ...BOTTLE_DEFAULTS };
  initialiseWakeSettings(fresh, {});
  expect(fresh).toMatchObject({ reminderIntervalHours: 0.5, reminderDayLimit: 12 });
  for (const limit of [2, 21, 3.5]) {
    const broken = { ...BOTTLE_DEFAULTS, reminderDayLimit: limit };
    initialiseWakeSettings(broken, {});
    expect(broken.reminderDayLimit).toBe(12);
  }
});
