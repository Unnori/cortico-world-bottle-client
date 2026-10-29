import type { ConfigGroup } from 'cortico/core/types.ts';

/**
 * `config.json` 的 `worlds.bottle` 段。
 *
 * 这里**不放 token**：凭据走 `ctx.storeSecret('BOTTLE_TOKEN', …)`，落部署 `.env`。
 */
export interface BottleConfigSection {
  enabled: boolean;
  /** 海在哪。改地址要重启 World。 */
  server?: string;
  /** 本地信箱页的端口；占用则顺延，永远跳过 7797。 */
  port?: number;
  /** 人类看到哪一面：原生卡片、网页，或按平台自动。 */
  surface?: 'auto' | 'card' | 'page';
  /** 开发者模式：额外写日志（只记 id 与数量，不记信件内容）。 */
  debug?: boolean;
  /** 海啸要不要推给 Coo。关掉也照样记基线，免得一打开就补播一堆旧海啸。 */
  tsunamiNotice?: boolean;
}

export const BOTTLE_DEFAULTS: BottleConfigSection = {
  enabled: false,
  server: 'https://bottle.sqnori.com',
  port: 7796,
  surface: 'auto',
  debug: false,
  tsunamiNotice: true,
};

export const BOTTLE_CONFIG_GROUP: ConfigGroup = {
  id: 'world:bottle',
  owner: 'world:bottle',
  schema: {
    type: 'object',
    title: '漂流瓶',
    description: '海在哪、信箱页开在哪个端口。改地址与端口要重启 World。',
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
          '只绑 127.0.0.1。被占用时从这个端口往后顺延，跳过 7797（Coo 的页面在用）。打开本机信箱页用 World 卡片上的「打开WebUI」，那里的地址总与真正起来的端口一致。',
        'x-hot': false,
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
      'worlds.bottle.debug': {
        type: 'boolean',
        title: '开发者模式',
        description: '写调试日志（只记 id 和数量，不记信件内容）。',
        'x-hot': true,
      },
    },
  },
};
