import { BOTTLE_EVENTS } from './events.ts';
import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { BOTTLE_DEFAULTS, type BottleConfigSection } from './config.ts';
import { BOTTLE_TOOL_DECLS, BOTTLE_HEADLESS_TOOL_DECLS } from './tools.ts';
import { soundOptions } from './sound.ts';
import { BottleWorld } from './world.ts';

export const BOTTLE: WorldDefinition<BottleConfigSection> = {
  id: 'bottle',
  label: '漂流瓶',
  configOptions: (kind, language) => kind === 'bottle-sound-incoming' || kind === 'bottle-sound-reply'
    ? soundOptions(kind === 'bottle-sound-incoming' ? 'incoming' : 'reply')
      .map(item => ({value:item.id,label:(item.kind === 'shared' ? (language === 'zh' || language === 'zh-Hant' ? '通用 · ' : 'Shared · ') : '') + item.label})) : [],
  defaults: () => ({ ...BOTTLE_DEFAULTS }),
  create: (ctx) => new BottleWorld(ctx, { botName: ctx.botName || '它' }),
  describe: {
    tools: describeTools([...BOTTLE_TOOL_DECLS, ...BOTTLE_HEADLESS_TOOL_DECLS], {
      bottle_write: {
        zh: '起草正文不超过 120 字的信，内容与形式自由，信题可选；仍保护隐私，寄不寄由人决定。',
        en: 'Drafts a letter of at most 120 characters into the human\'s mailbox page. Never sends it.',
      },
      bottle_catch: {
        zh: '捞一只瓶子，回执仅含署名、已有标题和额度。无头开启时，桌宠所捞原文另走自动共读事件，先分享原文与感想，可起草但本轮禁寄。',
        en: 'Fishes a bottle; receipt contains metadata only. Headless bot catches queue a separate reading event: share text and thoughts, optionally draft, never send in that turn.',
      },
      bottle_reply: {
        zh: '给当前授权那封起草回信。无头自动共读先分享原文和感想，可起草手动稿，本轮禁寄；单独读信不授权回信。人明确要求时也可指定原信。Controller 新稿同样手动确认；桌面定时稿保留原约定。',
        en: 'Drafts a body-only answer to the letter the human just opened; the mailbox keeps track of the target. Desktop requires that turn; headless mode accepts an explicit target and creates a manual draft.',
      },
      bottle_wake_choice: {
        zh: '明确暂不写信、打捞或提醒并记录原因；人的拒绝当天不再催，暂停持续到手动恢复。',
        en: 'Records a choice not to write, catch, or remind; honors human refusal and persistent pauses.',
      },
      bottle_mailbox: {
        zh: '看一眼信箱：手里待回的信、别人回给我的信。只有化名和状态，没有正文。',
        en: 'Lists held letters and answered letters by pseudonym and state, without any text.',
      },
    }),
    events: Object.entries(BOTTLE_EVENTS).map(([type,spec])=>({type,...spec})),
  },
};
