import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { BOTTLE_DEFAULTS, type BottleConfigSection } from './config.ts';
import { BOTTLE_TOOL_DECLS } from './tools.ts';
import { BottleWorld } from './world.ts';

export const BOTTLE: WorldDefinition<BottleConfigSection> = {
  id: 'bottle',
  label: '漂流瓶',
  defaults: () => ({ ...BOTTLE_DEFAULTS }),
  create: (ctx) => new BottleWorld(ctx),
  describe: {
    tools: describeTools(BOTTLE_TOOL_DECLS, {
      bottle_write: {
        zh: '起草一封不超过 120 字的信，放进人类的信箱页；没有发送能力，寄不寄由人类决定。',
        en: 'Drafts a letter of at most 120 characters into the human\'s mailbox page. Never sends it.',
      },
      bottle_catch: {
        zh: '捞一只瓶子。回执只说来自谁和剩余次数，不含正文；正文只在人类的信箱页上。',
        en: 'Fishes one bottle. The receipt names the writer and the quota, never the text.',
      },
      bottle_reply: {
        zh: '给人类刚点开的那一封起草回信。只有人类点了回信的那一轮可用，写完仍是草稿。',
        en: 'Drafts an answer to the letter the human just opened. Only available in that turn.',
      },
      bottle_mailbox: {
        zh: '看一眼信箱：手里待回的信、别人回给我的信。只有化名和状态，没有正文。',
        en: 'Lists held letters and answered letters by pseudonym and state, without any text.',
      },
    }),
    events: [
      {
        type: 'bottle.reading',
        description: {
          zh: '人类点了回信，这一封的正文被授权给模型；按外部事件推送。',
          en: 'The human asked to reply; this letter\'s text is authorised and delivered as an external event.',
        },
      },
      {
        type: 'bottle.sent',
        description: {
          zh: '人类在信箱页上把信或回信寄出去了。不含正文。',
          en: 'The human sent a letter or an answer from the mailbox page. No text.',
        },
      },
      {
        type: 'bottle.mail',
        description: {
          zh: '有新的回信漂回来了，只有数量。',
          en: 'New answers drifted back; count only.',
        },
      },
      {
        type: 'bottle.dismissed',
        description: {
          zh: '人类把手里那一封扔回海里了（第几次、有没有沉底在事件里）。',
          en: 'The human threw the held letter back into the sea; the event carries the throw count and whether it sank.',
        },
      },
      {
        type: 'bottle.rewrite',
        description: {
          zh: '人类点了重写，让 Coo 重新起草。',
          en: 'The human asked for a new draft.',
        },
      },
      {
        type: 'bottle.tsunami',
        description: {
          zh: '服务端重启过一次，还漂在海面上的瓶子被浪拍碎了。带次数和丢了几封；重启原因只留在运维侧，不念给玩家。',
          en: 'The sea had a tsunami: bottles still afloat were smashed. Carries the count and how many were lost; the restart reason stays operator-side.',
        },
      },
      {
        type: 'bottle.picked',
        description: {
          zh: '我写的信被人捡起来了。只播报第一次（这个状态会来回抖），而且不带任何化名。',
          en: 'Someone picked up a letter I wrote. Announced once only (the state flaps), and it carries no pseudonym.',
        },
      },
      {
        type: 'bottle.peruse',
        description: {
          zh: '人类在信册里点「一起读信」，那一封（别人写的）连同我当时的回信一起递进上下文；只聊，不写回信、不占额度。',
          en: 'The human opened an old letter from the book to read together; it enters context with the answer I wrote back then. No answer is drafted and no quota is spent.',
        },
      },
      {
        type: 'bottle.post',
        description: {
          zh: '海边邮局寄来一封系统邮件（世界观内容），不占捞取额度；正文只在人类的信箱页上，它不会回信。',
          en: 'The seaside post office delivered a system letter (world flavour). It costs no catch quota, the text stays on the human\'s page, and it never replies.',
        },
      },
    ],
  },
};
