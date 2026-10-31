/**
 * 本地信箱 WebUI：信件显示、人工确认与历史信册。
 *
 * 它存在的唯一理由是「人类看文本，Bot 不看」。气泡里的字是模型写的，模型不读原文就没法把
 * 原文放进气泡；所以需要一个不经模型的显示通道。发送也只从这里出发，模型没有 send 工具。
 *
 * Windows 上主界面是原生卡片（`card-host.ps1`），这一页是兜底、调试，以及「翻旧信」的地方。
 * 只绑 127.0.0.1，不做鉴权（本机就是人类）；但 POST 要求一个自定义头，
 * 免得别的网页用表单偷偷替人类点「寄出去」。
 */
import { pageHtml } from './page-view.ts';
export { pageHtml } from './page-view.ts';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AnnouncementSummary, Quota } from '../shared/contract.ts';
import type { SoftHint } from '../shared/hints.ts';

export type Surface = 'card' | 'page';

export interface PageDraftView {
  topic?: string;
  kind: 'letter' | 'reply';
  body: string;
  letterId?: string;
  chars: number;
  hints: SoftHint[];
}

export interface PageHeldView {
  letterId: string;
  from: string;
  body: string;
  hoursLeft: number;
  /** 海边邮局的种子信：寄不出去，只能收好（§13.7）。 */
  seed?: boolean;
  /** 这一封的字已经没了，只剩「珍藏」。 */
  dead?: boolean;
  signature?: string;
  topic?: string;
}

export interface PageReplyView {
  from: string;
  body: string;
  at: string;
}

/** 我写出去的这封信现在在哪：还在漂 / 被人捡起 / 海啸丢了 / 裂了 / 已经收到回信。 */
export type PageSentState = 'drifting' | 'picked' | 'tsunami' | 'sunk' | 'replied';

export interface PageSentView {
  topic?: string;
  letterId: string;
  body: string;
  at: string;
  state?: PageSentState;
  reply?: PageReplyView;
}

export type PageOutcome = 'caught' | 'replied' | 'dismissed' | 'sank' | 'expired' | 'kept';

export interface PageReceivedView {
  letterId: string;
  from: string;
  body: string;
  at: string;
  outcome: PageOutcome;
  myReply?: string;
  /** 海边邮局寄来的那一封：来源不是人类，也不会回信。 */
  seed?: boolean;
  signature?: string;
  topic?: string;
}

export interface PageSnapshot {
  botName?: string;
  /** 回信稿优先、其次信稿；卡片与旧逻辑只看这一个。 */
  draft: PageDraftView | null;
  /** 绑在手里那一封上的回信草稿。 */
  replyDraft?: PageDraftView | null;
  /** 还没寄出去的信稿。它与手里那封、与回信稿各自独立。 */
  letterDraft?: PageDraftView | null;
  held: PageHeldView | null;
  /** 我寄出去的信，新的在前；有人回了就把回信挂在下面。 */
  sent: PageSentView[];
  /** 我捞到过的信。 */
  received: PageReceivedView[];
  quota: Quota | null;
  online: boolean;
  announcement?: AnnouncementSummary | null;
  tideOut?: { text: string; until: string | null } | null;
  pendingAction?: 'write' | 'catch' | null;
  /**
   * 今天还能不能回信。
   *
   * 老服务端不给 `replies_left` 时按「能」处理（`true`）——宁可让服务端 429 兜底，
   * 也不要因为字段缺席把人挡在门外。
   */
  canReply?: boolean;
  /** 明文账本的位置，页脚要如实写出来。 */
  localFile?: string;
}

export interface PageResult {
  ok: boolean;
  reason?: 'tide_out';
  message?: string;
  /** 原生卡片据此在显示完这句话之后自己关掉；网页忽略。 */
  close?: boolean;
}

export interface PageDeps {
  snapshot(): PageSnapshot;
  request(action: 'write' | 'catch'): Promise<PageResult>;
  /** 寄哪一份由页面上的按钮决定：信稿或回信稿。 */
  send(kind?: 'letter' | 'reply'): Promise<PageResult>;
  rewrite(kind?: 'letter' | 'reply'): Promise<PageResult>;
  dismiss(): Promise<PageResult>;
  /** 字已经没了的信：只能珍藏，不再有回信/再等/扔回。 */
  keep(): Promise<PageResult>;
  /** 「一起读信」：把信册里某一封（别人写的）递进上下文，读完说点自己的想法。 */
  peruse(letterId: string): Promise<PageResult>;
  /** 把还没寄出去的草稿扔掉（「算了吧」）；不动手里那封信。 */
  discard(kind?: 'letter' | 'reply'): Promise<PageResult>;
  open(surface: Surface): Promise<PageResult>;
  /** 不带 letterId 清空历史；带了就只删那一条。 */
  forget(letterId?: string): Promise<PageResult>;
}

export interface PageResponse {
  status: number;
  json?: unknown;
  html?: string;
}

export interface PageRequestOptions {
  surface?: Surface;
  /** POST 的 JSON 体；只有 /forget 用得上。 */
  body?: unknown;
}

function letterIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as { letterId?: unknown }).letterId;
  return typeof value === 'string' && value ? value : undefined;
}

/** 页面上按的是哪一份草稿：`letter` 信稿，`reply` 回信稿，没说就交给 World 自己挑。 */
function draftKindOf(body: unknown): 'letter' | 'reply' | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as { kind?: unknown }).kind;
  return value === 'letter' || value === 'reply' ? value : undefined;
}

/** 路由是纯函数，测试不用开 socket。 */
export async function handlePage(
  deps: PageDeps,
  method: string,
  path: string,
  opts: PageRequestOptions = {},
): Promise<PageResponse> {
  const route = path.replace(/\/+$/, '') || '/';

  if (method === 'GET' && route === '/') return { status: 200, html: pageHtml() };
  if (method === 'GET' && route === '/draft') return { status: 200, json: deps.snapshot() };

  if (method === 'POST' && route === '/forget') {
    const letterId = letterIdOf(opts.body);
    if (letterId) return { status: 200, json: await deps.forget(letterId) };
    // 整本清空必须是**显式**请求（`{ all: true }`）。
    // 「没带 letterId」不再等于「清空全部」——那会把一个坏掉的请求体变成清空命令。
    if ((opts.body as { all?: unknown } | null | undefined)?.all === true) {
      return { status: 200, json: await deps.forget(undefined) };
    }
    return { status: 400, json: { ok: false, message: '要删哪一条？整本清空请显式传 all。' } };
  }

  if (method === 'POST') {
    const surface = opts.surface ?? 'page';
    const kind = draftKindOf(opts.body);
    const actions: Record<string, () => Promise<PageResult>> = {
      '/write': () => deps.request('write'),
      '/catch': () => deps.request('catch'),
      '/send': () => deps.send(kind),
      '/rewrite': () => deps.rewrite(kind),
      '/discard': () => deps.discard(kind),
      '/dismiss': () => deps.dismiss(),
      '/keep': () => deps.keep(),
      '/peruse': () => deps.peruse(letterIdOf(opts.body) ?? ''),
      '/open': () => deps.open(surface),
    };
    const action = actions[route];
    if (action) return { status: 200, json: await action() };
  }

  return { status: 404, json: { ok: false, message: '这里没有这个页面。' } };
}

export interface PageServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const LOOPBACK = '127.0.0.1';
/** Coo 的页面在 7797；顺延时永远跳过它。 */
const RESERVED_PORT = 7797;

/** 读请求体的结果。**读不出来必须报错，不能悄悄退化成空对象。** */
type BodyRead = { ok: true; value: unknown } | { ok: false };

/**
 * 本机接口的请求体很小，只认 JSON。
 *
 * 以前读不出来就 `resolve({})`，那意味着：一个坏掉的请求体在 `/forget` 上等于
 * 「没带 letterId」＝「清空整本信册」。请求体坏掉时宁可整个动作不做，
 * 也不要去执行一个比人类预期更狠的动作。
 */
function readBody(req: IncomingMessage): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // 超限时整块丢弃会把 JSON 截断成「看起来合法」的半截，所以直接标记读不出来
      if (size > 4096) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        resolve({ ok: false });
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({ ok: true, value: {} });
        return;
      }
      try {
        resolve({ ok: true, value: JSON.parse(text) });
      } catch {
        resolve({ ok: false });
      }
    });
    req.on('error', () => resolve({ ok: false }));
  });
}

export async function startPageServer(
  deps: PageDeps,
  opts: { port: number; log?: (line: string) => void },
): Promise<PageServer> {
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const method = (req.method ?? 'GET').toUpperCase();
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    // 跨站表单发不出自定义头；这一条挡住「替人类点寄出」
    if (method === 'POST' && req.headers['x-bottle'] !== '1') {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '这个请求不是从信箱页发出来的。' }));
      return;
    }
    if (method !== 'POST') req.resume();

    const surface: Surface = req.headers['x-bottle-surface'] === 'card' ? 'card' : 'page';

    void readBody(req)
      .then((read) => {
        if (!read.ok) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, message: '请求体读不出来，这个动作没有执行。' }));
          return null;
        }
        return handlePage(deps, method, path, { surface, body: read.value });
      })
      .then((result) => {
        if (result === null) return; // 上面已经回过 400
        if (result.html !== undefined) {
          res.writeHead(result.status, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
          });
          res.end(result.html);
          return;
        }
        const text = JSON.stringify(result.json ?? {});
        res.writeHead(result.status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(text),
          'cache-control': 'no-store',
        });
        res.end(text);
      })
      .catch((error: unknown) => {
        opts.log?.(`page failed: ${error instanceof Error ? error.name : 'unknown'}`);
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, message: '信箱页出了点问题。' }));
      });
  };

  let lastError: unknown = null;
  for (let step = 0; step < 12; step++) {
    const port = opts.port + step;
    if (port === RESERVED_PORT) continue;

    const server: Server = createServer(handler);
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        server.once('error', onError);
        server.listen(port, LOOPBACK, () => {
          server.off('error', onError);
          resolve();
        });
      });
      server.unref();
      return {
        url: `http://${LOOPBACK}:${port}/`,
        port,
        close: () =>
          new Promise<void>((resolve) => {
            // 页面每几秒轮询一次；不掐掉 keep-alive 连接，close 会等很久
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      };
    } catch (error) {
      lastError = error;
      try {
        server.close();
      } catch {
        // 没起来过的 server 关闭会抛；忽略
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') break;
    }
  }
  throw new Error(`信箱页起不来：${lastError instanceof Error ? lastError.message : 'unknown'}`);
}
