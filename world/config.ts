import { DEFAULT_SOUND_PACK, soundPackChoice, type SoundConfig } from './sound.ts';
import type { ConfigGroup, ConfigProperty } from 'cortico/core/types.ts';

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
export interface BottleConfigSection extends Partial<BottleWakeSettings>, SoundConfig {
  enabled: boolean;
  /** 随机邀请只提供机会，Bot 可明确暂不做。 */
  randomWake?: boolean;
  /** 海在哪。改地址要重启 World。 */
  server?: string;
  /** 本地信箱页的端口；占用则顺延，永远跳过 7797。 */
  port?: number;
  /** Separate authenticated listener; never changes the loopback listener. */
  lanEnabled?: boolean;
  lanPort?: number;
  /** Optional public origin for NAT / reverse proxy deployments. */
  lanPublicUrl?: string;
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

/** Update retired built-in choices in memory without rewriting deployment files. */
export function initialiseSoundSettings(config: BottleConfigSection): void {
  config.soundIncomingPack = soundPackChoice(config.soundIncomingPack, 'incoming');
  config.soundReplyPack = soundPackChoice(config.soundReplyPack, 'reply');
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
  lanEnabled: false,
  lanPort: 7798,
  lanPublicUrl: '',
  surface: 'auto',
  cardAutoCloseSec: 10,
  debug: false,
  tsunamiNotice: true,
  soundEnabled: true, soundVolume: 70, soundFadeOutMs: 250,
  soundIncomingSource: 'pack', soundIncomingPack: DEFAULT_SOUND_PACK.incoming, soundIncomingFile: '',
  soundReplySource: 'pack', soundReplyPack: DEFAULT_SOUND_PACK.reply, soundReplyFile: '',

};

/** Field declarations stay at the same config paths; grouping is presentation only. */
export const BOTTLE_CONFIG_FIELDS: Record<string, ConfigProperty> = {
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
  'worlds.bottle.lanEnabled': {
    type: 'boolean', title: '允许其他设备访问信箱',
    description: '默认关闭。开启后另开配对监听，不改变本机入口；在信箱页签扫码配对。HTTP 裸端口允许直连，但信件和配对凭据会明文传输。修改后重启 World。',
    'x-hot': false,
  },
  'worlds.bottle.lanPort': {
    type: 'integer', title: '其他设备访问端口', minimum: 1, maximum: 65535,
    description: '默认 7798，独立监听所有 IPv4 网卡。端口被占用会报错，不自动换端口；需自行放行防火墙。修改后重启 World。',
    'x-hot': false,
  },
  'worlds.bottle.lanPublicUrl': {
    type: 'string', title: '对外访问地址（可选）',
    description: '留空自动列出本机网卡地址。服务器或端口映射可填 http://主机:端口/，HTTPS 反向代理可填 https://域名/；仅支持根路径。此项不自动配置防火墙、映射或 HTTPS。修改后重启 World。',
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
  'worlds.bottle.soundEnabled': { type: 'boolean', title: '桌面通知音效', description: 'Windows 来信与回信卡片出现时播放一次，草稿和重新打开旧卡片不重复提醒。网页声音在各设备的信箱里单独设置。', 'x-hot': true },
  'worlds.bottle.soundVolume': { type: 'number', title: '桌面提示音音量', minimum: 0, maximum: 100, 'x-suffix': '%', 'x-hot': true },
  'worlds.bottle.soundFadeOutMs': { type: 'number', title: '提示音末尾淡出', description: '默认 250 毫秒，0 为关闭淡出。较短音效会自动缩短淡出。', minimum: 0, maximum: 5000, 'x-suffix': '毫秒', 'x-hot': true },
  ...Object.fromEntries((['Incoming', 'Reply'] as const).flatMap((kind) => {
    const label = kind === 'Incoming' ? '来信' : '回信';
    return [
      [`worlds.bottle.sound${kind}Source`, { type: 'string' as const, title: `${label}音效来源`, enum: ['pack', 'local', 'off'], description: 'pack：音效包；local：选择本机文件；off：这一类静音。', 'x-hot': true }],
      [`worlds.bottle.sound${kind}Pack`, { type: 'string' as const, title: `${label}包内音效`, 'x-options': `bottle-sound-${kind.toLowerCase()}`, 'x-hot': true }],
      [`worlds.bottle.sound${kind}File`, { type: 'string' as const, title: `${label}本机音效`, description: '来源选 local 时使用此文件。Windows 建议 WAV 或 MP3；不存在或不支持时安静跳过。', 'x-path': { kind: 'file' as const, extensions: ['wav','mp3','m4a','ogg','aac','flac'] }, 'x-hot': true }],
    ];
  })),
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
};

/**
 * Native ConfigGroup headings keep the standard configuration page readable.
 * Keep world:bottle for LAN settings: the mailbox panel saves these through ctx.setConfig.
 * Every field belongs to exactly one group; never register the flat field table as a second group.
 */
function configGroup(id: string, title: string, description: string, fields: readonly string[]): ConfigGroup {
  return {
    id, owner: 'world:bottle',
    schema: { type: 'object', title, description,
      properties: Object.fromEntries(fields.map(field => {
        const path = `worlds.bottle.${field}`;
        if (!BOTTLE_CONFIG_FIELDS[path]) throw new Error(`Missing bottle config field: ${path}`);
        return [path, BOTTLE_CONFIG_FIELDS[path]!];
      })),
    },
  };
}

export const BOTTLE_CONFIG_GROUPS: ConfigGroup[] = [
  configGroup('world:bottle:display', '显示与通知',
    '先选信件显示的位置，再调整桌面卡片和海啸提醒。',
    ['surface', 'cardAutoCloseSec', 'tsunamiNotice']),
  configGroup('world:bottle:invitations', '海边邀请与提醒',
    '总开关在前，写信、打捞和待办提醒各有自己的开关与间隔；与信箱里的设置同步。',
    ['randomWake', ...BOTTLE_WAKE_FIELDS.flatMap(([, enabled, interval]) => [enabled, interval])]),
  configGroup('world:bottle:sound', '桌面音效',
    '这里只影响 Windows 新来信和回信卡片。音量与淡出对两类声音共同生效，网页声音仍在各设备单独设置。',
    ['soundEnabled', 'soundVolume', 'soundFadeOutMs']),
  configGroup('world:bottle:sound-incoming', '来信提示音',
    '先选音效来源：pack 用包内音效，local 用本机文件，off 为静音；只需填写所选来源对应的一项。',
    ['soundIncomingSource', 'soundIncomingPack', 'soundIncomingFile']),
  configGroup('world:bottle:sound-reply', '回信提示音',
    '与来信声音分开选择。pack 用包内音效，local 用本机文件，off 为静音；只需填写所选来源对应的一项。',
    ['soundReplySource', 'soundReplyPack', 'soundReplyFile']),
  configGroup('world:bottle', '其他设备访问',
    '只在需要用手机等设备打开信箱时设置。默认关闭，开启后到「信箱」页签扫码配对；HTTP 明文传输有风险。',
    ['lanEnabled', 'lanPort', 'lanPublicUrl']),
  configGroup('world:bottle:connection', '连接与调试',
    '通常保持默认即可。更换海边服务端或本机端口后需重启漂流瓶 World，调试日志按需开启。',
    ['server', 'port', 'debug']),
];
