/**
 * 五个工具。**没有 bottle_send**：发送只在本地信箱页上发生，模型没有这个能力。
 *
 * 回执的规矩：写/捞/回都只说「放在了哪」，不念正文。正文的显示通道是页面，不是气泡。
 */
import type { ToolDef } from 'cortico/core/types.ts';

export interface BottleToolDeps {
  /** 人类在对话里说「打开信箱页」时，替他把本机页面打开。 */
  openPage(): Promise<string>;
  write(text: string, title: string): Promise<string>;
  catchOne(): Promise<string>;
  reply(text: string): Promise<string>;
  mailbox(): Promise<string>;
}

export const BOTTLE_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'bottle_write',
    tags: ['act'],
    description:
      'Draft a bottle letter and put it in the human\'s mailbox page. Nothing is sent: only the human can send it, from that page. Write to a stranger you will never meet. Supply a short, specific title (1–20 characters, one line) and a separate body (at most 120 characters). Do not repeat the title in the body; the title follows the same privacy rules as the body. Call this when you actually have something to put out to sea: a moment worth keeping, gladness you want someone to know about, a worry or a confusion that keeps pressing, a small thing that would sound like rambling if said out loud. If there is nothing like that, do not write. An empty letter is worse than none. The receipt does not repeat the text; do not read the whole letter aloud again.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'A specific title for this letter, 1–20 characters on one line; no personal information or contact details.' },
        text: { type: 'string', description: 'The letter body only, at most 120 characters; do not include the title.' },
      },
      required: ['title', 'text'],
    },
  },
  {
    name: 'bottle_catch',
    tags: ['act'],
    description:
      'Fish one bottle out of the sea. You may initiate this when bored, curious about strangers, or when the human has been quiet for a while in the current conversation; do not wait for a request. Catch once, then move on if holding a letter, out of quota, or the sea is quiet. The receipt says who wrote it and how many catches are left today; it never contains the text. The text is shown to the human on the mailbox page, and you read it only after the human asks to reply or read together.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'bottle_reply',
    tags: ['act'],
    description:
      'Draft an answer to the one letter the human has just opened on the mailbox page. Only available in that turn; never call it otherwise. You do not choose which letter to answer — it is always the one the human just opened, so supply the body only. The answer is a draft: the human sends it from the page. At most 120 characters. Do not add a title, subject line, or repeat the original title in the answer.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'The answer, at most 120 characters.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'bottle_open_page',
    tags: ['act'],
    description:
      "Open the human's mailbox page (a local page on their own machine, 127.0.0.1 only) in their default browser. Use it whenever the human asks to see the mailbox, the letters, or the page, and whenever they cannot find where to read or send. The page is the only place letters can be read or sent; you cannot do either yourself. The URL is fixed and not a parameter, so this tool can never open anything else.",
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'bottle_mailbox',
    tags: ['read'],
    description:
      'What is in the mailbox right now: the letter you are holding that still needs an answer, and letters of yours that someone answered. Returns pseudonyms and states only, never letter text.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
];

export function bottleTools(deps: BottleToolDeps): ToolDef[] {
  const handlers: Record<string, ToolDef['handler']> = {
    bottle_write: (args) => deps.write(typeof args.text === 'string' ? args.text : '', typeof args.title === 'string' ? args.title : ''),
    bottle_catch: () => deps.catchOne(),
    bottle_reply: (args) => deps.reply(typeof args.text === 'string' ? args.text : ''),
    bottle_open_page: () => deps.openPage(),
    bottle_mailbox: () => deps.mailbox(),
  };

  return BOTTLE_TOOL_DECLS.map((decl) => ({
    ...decl,
    handler: handlers[decl.name] ?? (async () => `[not implemented] ${decl.name}`),
  }));
}
