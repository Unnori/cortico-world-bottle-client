/**
 * 四个工具。**没有 bottle_send**：发送只在本地信箱页上发生，模型没有这个能力。
 *
 * 回执的规矩：写/捞/回都只说「放在了哪」，不念正文。正文的显示通道是页面，不是气泡。
 */
import type { ToolDef } from 'cortico/core/types.ts';

export interface BottleToolDeps {
  write(text: string): Promise<string>;
  catchOne(): Promise<string>;
  reply(letterId: string, text: string): Promise<string>;
  mailbox(): Promise<string>;
}

export const BOTTLE_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'bottle_write',
    tags: ['act'],
    description:
      'Draft a bottle letter and put it in the human\'s mailbox page. Nothing is sent: only the human can send it, from that page. Write to a stranger you will never meet, at most 120 characters. The receipt does not repeat the text; do not read the whole letter aloud again.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'The letter itself, at most 120 characters.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'bottle_catch',
    tags: ['act'],
    description:
      'Fish one bottle out of the sea. The receipt says who wrote it and how many catches are left today; it never contains the text. The text is shown to the human on the mailbox page, and you read it only after the human asks to reply.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'bottle_reply',
    tags: ['act'],
    description:
      'Draft an answer to the one letter the human has just opened on the mailbox page. Only available in that turn; never call it otherwise. The answer is a draft: the human sends it from the page. At most 120 characters.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        letterId: { type: 'string', description: 'The letter id given together with the opened letter.' },
        text: { type: 'string', description: 'The answer, at most 120 characters.' },
      },
      required: ['letterId', 'text'],
    },
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
    bottle_write: (args) => deps.write(typeof args.text === 'string' ? args.text : ''),
    bottle_catch: () => deps.catchOne(),
    bottle_reply: (args) =>
      deps.reply(
        typeof args.letterId === 'string' ? args.letterId : '',
        typeof args.text === 'string' ? args.text : '',
      ),
    bottle_mailbox: () => deps.mailbox(),
  };

  return BOTTLE_TOOL_DECLS.map((decl) => ({
    ...decl,
    handler: handlers[decl.name] ?? (async () => `[not implemented] ${decl.name}`),
  }));
}
