import type { ConfigGroup } from 'cortico/core/types.ts';

/**
 * `config.json` 的 `worlds.bottle` 段。
 *
 * 这里**不放 token**：凭据走 `ctx.storeSecret('BOTTLE_TOKEN', …)`，落部署 `.env`。
 */
export interface BottleWakeSettings {
  writeInviteEnabled: boolean;
  writeInviteIntervalHours: number;
  catchInviteEnabled: boolean;
  catchInviteIntervalHours: number;
  reminderEnabled: boolean;
  reminderIntervalHours: number;
}

/** Older deployments may omit the invitation settings; constructor migration retains their preferences. */
export interface BottleConfigSection extends Partial<BottleWakeSettings> {
  enabled: boolean;
  /** 随机邀请只提供机会，Bot 可明确暂不做。 */
  randomWake?: boolean;
  /** 海在哪。改地址要重启 World。 */
  server?: string;
  /** 本地信箱页的端口；占用则顺延，永远跳过 7797。 */
  port?: number;
  /** 人类看到哪一面：原生卡片、网页，或按平台自动。 */
  surface?: 'auto' | 'card' | 'page';
  /** 开发者模式：额外写日志（只记 id 与数量，不记信件内容）。 */
  debug?: boolean;
  /** 卡片展示时长；0 为不自动收起。 */
  cardAutoCloseSec?: number;
  /** 海啸要不要推给 Coo。关掉也照样记基线，免得一打开就补播一堆旧海啸。 */
  tsunamiNotice?: boolean;
}

export const BOTTLE_WAKE_FIELDS = [
  ['write', 'writeInviteEnabled', 'writeInviteIntervalHours', '写信邀请'],
  ['catch', 'catchInviteEnabled', 'catchInviteIntervalHours', '打捞邀请'],
  ['remind', 'reminderEnabled', 'reminderIntervalHours', '待办提醒'],
] as const;

/** Distinguish implicit defaults from explicit deployment values when migrating old scheduler preferences. */
export function initialiseWakeSettings(config: BottleConfigSection, savedLanes: unknown, explicitConfig: unknown = {}): void {
  const explicit = explicitConfig && typeof explicitConfig === 'object' ? explicitConfig : {};
  const lanes = savedLanes && typeof savedLanes === 'object' ? savedLanes as Record<string, unknown> : {};
  for (const [action, enabled, interval] of BOTTLE_WAKE_FIELDS) {
    const saved = lanes[action];
    const lane = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
    // Deployment values override legacy preferences, even when equal to the new defaults.
    // A default introduced by a package upgrade must not accidentally resume an old pause.
    if (typeof config[enabled] !== 'boolean' || (!Object.hasOwn(explicit, enabled) &&
      config[enabled] === BOTTLE_DEFAULTS[enabled] && typeof lane.paused === 'boolean')) config[enabled] = lane.paused !== true;
    if (typeof config[interval] !== 'number' || !Number.isFinite(config[interval]) || config[interval]! < 2 || config[interval]! > 24 ||
      (!Object.hasOwn(explicit, interval) && config[interval] === BOTTLE_DEFAULTS[interval] && typeof lane.intervalHours === 'number')) {
      const hours = lane.intervalHours;
      config[interval] = typeof hours === 'number' && Number.isFinite(hours) ? Math.min(24, Math.max(2, hours)) : 2;
    }
  }
}

export const BOTTLE_DEFAULTS: BottleConfigSection = {
  enabled: false,
  randomWake: true,
  writeInviteEnabled: true,
  writeInviteIntervalHours: 2,
  catchInviteEnabled: true,
  catchInviteIntervalHours: 2,
  reminderEnabled: true,
  reminderIntervalHours: 2,
  server: 'https://bottle.sqnori.com',
  port: 7796,
  surface: 'auto',
  cardAutoCloseSec: 10,
  debug: false,
  tsunamiNotice: true,
};

export const BOTTLE_CONFIG_GROUP: ConfigGroup = {
  id: 'world:bottle',
  owner: 'world:bottle',
  schema: {
    type: 'object',
    title: '漂流瓶',
    description: '海在哪、信件如何显示，以及海边邀请的开关与间隔。改地址与端口要重启 World，其余标明的选项可直接生效。',
    properties: {
      'worlds.bottle.server': {
        type: 'string',
        title: '服务端地址',
        description: '信漂去的那片海。默认是 bottle.sqnori.com；本地自建服务端时才改这里。',
        'x-hot': false,
      },
      'worlds.bottle.port': {
        type: 'number',
        title: '信箱页端口',
        description:
          '只绑 127.0.0.1。被占用时从这个端口往后顺延，跳过 7797（Coo 的页面在用）。不知道怎么开？可以叫它帮你打开信箱哦。',
        'x-hot': false,
      },
      'worlds.bottle.cardAutoCloseSec': {
        type: 'integer',
        title: '卡片自动收起时间',
        description: '默认显示 10 秒后收起，0 为不自动收起。收起只关闭卡片，信件与草稿仍留在信箱。修改后从下一张卡片生效。',
        minimum: 0,
        maximum: 86400,
        'x-suffix': '秒',
        'x-hot': true,
      },
      'worlds.bottle.surface': {
        type: 'string',
        title: '信件显示在哪一面',
        description:
          'auto：Windows 上用原生卡片，其它平台用网页。card：只弹卡片（起不来就退回网页）。page：只在浏览器里打开信箱页。',
        enum: ['auto', 'card', 'page'],
        'x-hot': true,
      },
      'worlds.bottle.tsunamiNotice': {
        type: 'boolean',
        title: '海啸提示',
        description:
          '服务端重启时，还漂在海上的瓶子会被浪拍碎。开着会告诉 Coo 一声；关掉只是不打扰它，基线照样记，以后打开也不会补播旧海啸。',
        'x-hot': true,
      },
      'worlds.bottle.randomWake': {
        type: 'boolean', title: '随机海边邀请',
        description: '有余量且没有待办时，偶尔邀请它写信或打捞；有待办则温和提醒，可以不做。每类每天最多 3 次。下方可分别开启、暂停与调整间隔，与信箱网页共用设置；关闭总开关不会清除各类偏好。',
        'x-hot': true,
      },
      ...Object.fromEntries(BOTTLE_WAKE_FIELDS.flatMap(([action, enabled, interval, label]) => [
        [`worlds.bottle.${enabled}`, {
          type: 'boolean' as const, title: label,
          description: action === 'remind'
            ? '信箱里有尚未处理的来信或草稿时，偶尔温和提醒；不读正文，也不代替人寄信。关闭即暂停，与网页设置同步。'
            : '余量大于 1 且手上没有待办时，偶尔邀请它自主选择。关闭即暂停，与网页设置同步；人手动发出的邀请仍尊重暂停。',
          'x-hot': true,
        }],
        [`worlds.bottle.${interval}`, {
          type: 'number' as const, title: `${label}最短间隔`, minimum: 2, maximum: 24,
          description: '默认 2 小时，范围 2—24 小时。实际时刻在最短间隔的 1—2 倍内随机，最长 24 小时；每类每天最多 3 次。修改后重新安排，不立即补催。',
          'x-suffix': '小时', 'x-hot': true,
        }],
      ])),
      'worlds.bottle.debug': {
        type: 'boolean',
        title: '开发者模式',
        description: '写调试日志（只记 id 和数量，不记信件内容）。',
        'x-hot': true,
      },
    },
  },
};
