/**
 * 卡片规格：World 把「现在该给人类看什么」翻译成一份纯数据，交给 `card-host.ps1` 画。
 * 这里不碰窗口、不碰 HTTP，方便单独测。
 */
import type { SoftHint } from '../shared/hints.ts';
import type { LocalDraft, LocalHeld, LocalReply } from './store.ts';

export type CardActionId = 'send' | 'rewrite' | 'discard' | 'dismiss' | 'open' | 'keep' | 'close';

export interface CardAction {
  id: CardActionId;
  label: string;
  tone: 'primary' | 'ghost';
}

export interface CardSpec {
  version: 1;
  /** 本地信箱服务的地址，卡片按这个地址回传动作。 */
  base: string;
  eyebrow: string;
  /** 抬头下面那一行小字：来自谁 / 等你决定。 */
  from?: string;
  /**
   * 这封信的名字（种子信的 topic）。
   *
   * 单独一个字段，不要拼进 meta：meta 是底部那行灰色小字，标题混在里面就丢了层级，
   * 人类一眼看过去找不到「这封信叫什么」。
   */
  title?: string;
  body: string;
  /** 回信草稿时折叠显示的原信。 */
  quote?: { label: string; body: string };
  meta?: string;
  hints?: string[];
  actions: CardAction[];
}

const MAX_CHARS = 120;

function base(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** 写信：人类只决定寄不寄、要不要重写，或者干脆算了。 */
export function draftLetterCard(input: {
  base: string;
  draft: LocalDraft;
  chars: number;
  hints: SoftHint[];
}): CardSpec {
  return {
    version: 1,
    base: base(input.base),
    eyebrow: '漂流瓶 · 写好了',
    from: '等你决定',
    body: input.draft.body,
    meta: `${input.chars} / ${MAX_CHARS} 字`,
    hints: input.hints.map((hint) => hint.text),
    actions: [
      { id: 'send', label: input.hints.length ? '仍然寄出' : '寄出去', tone: 'primary' },
      { id: 'rewrite', label: '重写', tone: 'ghost' },
      { id: 'discard', label: '算了吧', tone: 'ghost' },
    ],
  };
}

/** 捞到一封：正文在这里，模型看不到。 */
export function heldLetterCard(input: { base: string; held: LocalHeld; hoursLeft: number }): CardSpec {
  // 海边邮局的种子信：寄不出去、不会裂、不会自己回海，所以只给一个「收好」（§13.7）
  if (input.held.seed) return seedLetterCard(input);
  // 字已经被海带走了：只剩「珍藏」，不留假按钮
  if (input.held.dead) return deadLetterCard(input);

  return {
    version: 1,
    base: base(input.base),
    eyebrow: '漂流瓶 · 捞到一封',
    from: `来自 ${input.held.from}`,
    body: input.held.body || '这一封的字没有取到。',
    meta: input.hoursLeft > 0 ? `还有 ${input.hoursLeft} 小时回海` : '随时会回海',
    actions: [
      { id: 'open', label: '回信', tone: 'primary' },
      { id: 'close', label: '先放着', tone: 'ghost' },
      { id: 'dismiss', label: '扔回海里', tone: 'ghost' },
    ],
  };
}

/**
 * 字已经被海带走的那一封。
 *
 * 不是错误提示，是遗憾：海那边已经没有它了，能做的只有把它留在自己的信册里。
 */
export function deadLetterCard(input: { base: string; held: LocalHeld; hoursLeft: number }): CardSpec {
  return {
    version: 1,
    base: base(input.base),
    eyebrow: `漂流瓶 · 来自 ${input.held.from}`,
    title: '它的字被海带走了',
    body: input.held.body || '这封的字已经不在海上了。',
    meta: '海那边已经没有它了，你这边还留着。',
    actions: [{ id: 'keep', label: '珍藏', tone: 'primary' }],
  };
}

/**
 * 海边邮局寄来的那一封（§13.1 / §13.7）。
 *
 * 它在人类眼里是「群岛上的某位居民」写的——来源如实写居民，而不是写机制；
 * 但它**寄不出去**，所以没有「回信」按钮，只有一个「收好」。留一个假按钮等于骗人类点。
 */
export function seedLetterCard(input: { base: string; held: LocalHeld; hoursLeft: number }): CardSpec {
  const lines = [input.held.body || '这一封的字没有取到。'];
  const signature = input.held.signature?.trim();
  if (signature) lines.push(`—— ${signature}`);

  const topic = input.held.topic?.trim();

  return {
    version: 1,
    base: base(input.base),
    eyebrow: `漂流瓶 · 来自 ${input.held.from}`,
    from: '来自群岛上的某位居民',
    // 标题就是 topic；没有 topic 的种子才退回来源文案，免得标题位置空着
    title: topic || '来自群岛上的某位居民',
    body: lines.join('\n\n'),
    meta: '来自群岛上的某位居民',
    actions: [{ id: 'dismiss', label: '收好', tone: 'primary' }],
  };
}

/** 回信草稿：把原信折叠在上面，别让人类凭记忆回。 */
export function replyDraftCard(input: {
  base: string;
  draft: LocalDraft;
  held: LocalHeld | null;
  chars: number;
  hints: SoftHint[];
}): CardSpec {
  return {
    version: 1,
    base: base(input.base),
    eyebrow: '漂流瓶 · 回信写好了',
    from: '等你决定',
    ...(input.held
      ? { quote: { label: `原来那一封（来自 ${input.held.from}）`, body: input.held.body } }
      : {}),
    body: input.draft.body,
    meta: `${input.chars} / ${MAX_CHARS} 字`,
    hints: input.hints.map((hint) => hint.text),
    actions: [
      { id: 'send', label: input.hints.length ? '仍然寄出' : '寄出去', tone: 'primary' },
      { id: 'rewrite', label: '重写', tone: 'ghost' },
    ],
  };
}

/** 别人回我的信：只读，没有别的选项。 */
export function replyArrivedCard(input: { base: string; reply: LocalReply; more: number }): CardSpec {
  return {
    version: 1,
    base: base(input.base),
    eyebrow: '漂流瓶 · 回信到了',
    from: `来自 ${input.reply.from}`,
    body: input.reply.body,
    ...(input.more > 0 ? { meta: `还有 ${input.more} 封在信箱里` } : {}),
    actions: [{ id: 'close', label: '知道了', tone: 'ghost' }],
  };
}

/** 人类点了回信、Coo 还没写完：占位，等回信草稿把它替换掉。 */
export function waitingCard(baseUrl: string): CardSpec {
  return {
    version: 1,
    base: base(baseUrl),
    eyebrow: '漂流瓶 · 它正在读',
    body: '读完就会把回信放到这里。',
    meta: '要是它没动笔，收起卡片再点一次「回信」',
    actions: [{ id: 'close', label: '收起', tone: 'ghost' }],
  };
}
