import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { BOTTLE_DEFAULTS, type BottleConfigSection } from './config.ts';
import { BOTTLE_TOOL_DECLS } from './tools.ts';
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
    tools: describeTools(BOTTLE_TOOL_DECLS, {
      bottle_write: {
        zh: '起草正文不超过 120 字的信，内容与形式自由，信题可选；仍保护隐私，寄不寄由人决定。',
        en: 'Drafts a letter of at most 120 characters into the human\'s mailbox page. Never sends it.',
      },
      bottle_catch: {
        zh: '捞一只瓶子。回执包含署名、已有标题和额度；无标题不补正文，全文仍在信箱页。',
        en: 'Fishes a bottle; returns the signature, existing title and quota, never a body excerpt.',
      },
      bottle_reply: {
        zh: '给人类刚点开的那一封起草回信，只需正文，信箱自动对应原信。仅人在信箱点写回信的轮次可用；有效草稿确认后两小时自动寄出，也可提前寄出或放弃（需新版海边支持）。',
        en: 'Drafts a body-only answer to the letter the human just opened; the mailbox keeps track of the target. Only available in that turn.',
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
    events: [
      { type:'bottle.note-arrived', description:{zh:'收到小纸条，自动递上纸条正文，请桌宠转告人；不自动附上原信和原回信，不授权起草。',en:'A short note arrived. Its text is delivered automatically; tell the human and share a thought. Original correspondence is not attached and no drafting is authorized.'} },
      { type:'bottle.note-reading', description:{zh:'人点击小纸条下的一起看，单次递上小纸条、原信与原回信，只读和聊感想，不起草回信或纸条。',en:'The human chose to look at a short note together with the original letter and reply. Read and share thoughts only; do not draft a reply or note.'} },
      {type:'bottle.note-request',description:{zh:'人收到自己信件的回信后，邀请桌宠起草 40 字小纸条；人只能确认寄出或放弃。',en:'The author received a reply and invited a companion-written note draft; the human confirms sending.'}},
      {type:'bottle.star-memory',description:{zh:'人明确允许将一段星标往来纳入可撤回的长期信件记忆；投递前重验开关。',en:'Explicit revocable permission to remember starred correspondence, rechecked at delivery.'}},
      {
        type: 'bottle.request',
        description: {
          zh: '人在信箱页请求 Coo 起草一封信，不自动寄出。',
          en: 'The human requested a draft from the mailbox page. Never sends a letter.',
        },
      },
      {
        type: 'bottle.wake',
        description: {
          zh: '自动写信、打捞需额度大于 1 且没有待办；有待办则温和提醒。人也可立即发出邀请。Bot 自主决定，拒绝与暂停优先，任务持久记录且有限重试。',
          en: 'An invitation to write or catch, or a gentle reminder about pending mail. May be automatic or human-initiated. The bot may decline; pauses and task progress persist.',
        },
      },
      {
        type: 'bottle.reading',
        description: {
          zh: '人点击一起读或写回信，这一封正文按对应意图单次授权，作为外部事件投递。',
          en: 'The human clicked read together or write reply; only that letter is authorized for the chosen intent.',
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
          zh: '有新的回信漂回来了，带数量与原信投海距今多久，不含正文。',
          en: 'New answers drifted back; count and relative sending times only, without letter text.',
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
          zh: '我写的信被人捡起来了，带原信投海距今多久。只播报第一次（这个状态会来回抖），而且不带任何化名。',
          en: 'Someone picked up a letter I wrote; includes how long ago it was sent. Announced once only (the state flaps), and it carries no pseudonym.',
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
