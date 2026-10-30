/**
 * 本地信箱页：一张纸，两三个按钮。**它不是 WebUI**——没有海边、没有动画、没有页签。
 *
 * 它存在的唯一理由是「人类看文本，Bot 不看」。气泡里的字是模型写的，模型不读原文就没法把
 * 原文放进气泡；所以需要一个不经模型的显示通道。发送也只从这里出发，模型没有 send 工具。
 *
 * Windows 上主界面是原生卡片（`card-host.ps1`），这一页是兜底、调试，以及「翻旧信」的地方。
 * 只绑 127.0.0.1，不做鉴权（本机就是人类）；但 POST 要求一个自定义头，
 * 免得别的网页用表单偷偷替人类点「寄出去」。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Quota } from '../shared/contract.ts';
import type { SoftHint } from '../shared/hints.ts';

export type Surface = 'card' | 'page';

export interface PageDraftView {
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
  /** 海边邮局寄来的那一封：来源不是人类，也不会回信。 */
  seed?: boolean;
  signature?: string;
  topic?: string;
}

export interface PageSnapshot {
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
  message?: string;
  /** 原生卡片据此在显示完这句话之后自己关掉；网页忽略。 */
  close?: boolean;
}

export interface PageDeps {
  snapshot(): PageSnapshot;
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

/** 单文件页面。数据全部从 `/draft` 拿，这里只写骨架与交互。 */
export function pageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>漂流瓶 · 信箱</title>
<style>
  :root {
    --paper: #f6f1e6;
    --card: #fffdf7;
    --ink: #2f2a23;
    --muted: #8b8375;
    --line: #e2d8c7;
    --accent: #8a6540;
    --seal: #a8453c;
    --sea: #6f8d9c;
    --shadow: 0 1px 2px rgba(60, 45, 25, .05), 0 10px 30px rgba(60, 45, 25, .06);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background:
      radial-gradient(1200px 500px at 50% -10%, #fdfaf2 0%, rgba(253, 250, 242, 0) 70%),
      var(--paper);
    color: var(--ink);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    min-height: 100vh;
    padding: 40px 20px 64px;
  }
  .shell { max-width: 680px; margin: 0 auto; }
  .masthead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
  .masthead h1 { font-size: 22px; letter-spacing: .16em; font-weight: 600; margin: 0; }
  .masthead .sub { color: var(--muted); font-size: 13px; letter-spacing: .08em; }
  .tide { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
  .chip {
    font-size: 12px; color: var(--muted); border: 1px solid var(--line);
    background: rgba(255, 255, 255, .5); border-radius: 999px; padding: 4px 11px;
  }
  .chip b { color: var(--ink); font-weight: 600; }
  .chip.spent { color: var(--seal); border-color: currentColor; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: var(--shadow); padding: 30px 30px 24px; margin-bottom: 22px;
  }
  .eyebrow {
    font-size: 12px; letter-spacing: .14em; color: var(--accent); text-transform: uppercase;
    margin-bottom: 10px;
  }
  .eyebrow .who { color: var(--ink); letter-spacing: 0; text-transform: none; }
  .title { font-size: 17px; font-weight: 600; margin: 0 0 18px; }
  .letter {
    font-family: Georgia, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif;
    font-size: 19px; line-height: 2; white-space: pre-wrap; word-break: break-word;
    padding: 4px 2px 6px;
  }
  .letter.small { font-size: 15.5px; line-height: 1.85; color: #3a342c; }
  .meta { margin-top: 16px; color: var(--muted); font-size: 12.5px; display: flex; gap: 14px; flex-wrap: wrap; }
  .hints { margin-top: 14px; display: grid; gap: 6px; }
  .hint {
    font-size: 13px; color: #7a5b3a; background: #fbf3e2; border: 1px solid #efe0c6;
    border-radius: 9px; padding: 8px 12px; display: flex; align-items: center; gap: 8px;
  }
  .hint.local { color: #4b6070; background: #eef4f6; border-color: #dbe7ec; }
  .hint.spent { color: #8a4038; background: #fbeeec; border-color: #efd4ce; }
  .hint .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .7; flex: none; }
  .actions { display: flex; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
  .btn {
    appearance: none; border: 1px solid var(--ink); background: var(--ink); color: #fdfaf2;
    font: inherit; font-size: 14px; padding: 10px 20px; border-radius: 999px; cursor: pointer;
    transition: transform .08s ease, opacity .15s ease;
  }
  .btn:hover { opacity: .88; }
  .btn:active { transform: translateY(1px); }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn.ghost { background: transparent; color: var(--muted); border-color: var(--line); }
  .btn.ghost:hover { color: var(--ink); border-color: var(--muted); }
  .btn.seal { background: var(--seal); border-color: var(--seal); }
  .empty { color: var(--muted); text-align: center; padding: 26px 0 10px; }
  .empty .big { font-family: Georgia, "Songti SC", serif; font-size: 18px; color: #5b5449; margin-bottom: 8px; }
  .sect-head { display: flex; align-items: baseline; justify-content: space-between; margin: 30px 2px 12px; }
  .sect-head h2 { font-size: 13px; letter-spacing: .14em; color: var(--muted); font-weight: 600; margin: 0; }
  .sect-head .count { font-size: 12px; color: var(--muted); }
  .mail { background: rgba(255, 253, 247, .7); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 10px; }
  .mail .head { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; color: var(--muted); margin-bottom: 8px; }
  .mail .head .from { color: var(--ink); }
  .mail .head .tag { white-space: nowrap; }
  .mail .reply-quote {
    border-left: 2px solid var(--line);
    padding-left: 10px;
    margin: 10px 0 8px;
  }
  .mail .reply-quote-label {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .mail .mail-topic { font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 6px; letter-spacing: .02em; }
  .mail-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; font-size: 11.5px; color: var(--muted); }
  .mail-foot .when { opacity: .85; }
  .link.mini { margin: 0; font-size: 11.5px; }
  .reply { margin-top: 12px; padding: 12px 14px; background: #faf6ec; border-radius: 10px; }
  .reply .reply-head { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .reply .reply-head .new { color: var(--seal); letter-spacing: .1em; }
  .foot { margin-top: 34px; color: var(--muted); font-size: 12px; text-align: center; line-height: 1.9; }
  .foot .plain { margin-top: 6px; }
  .foot code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; color: #6f6659; word-break: break-all; }
  .link {
    appearance: none; border: 0; background: none; padding: 2px 4px; margin-top: 6px;
    color: var(--muted); font: inherit; font-size: 12px; text-decoration: underline;
    text-underline-offset: 3px; cursor: pointer;
  }
  .link:hover { color: var(--seal); }
  .toast {
    position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 12px);
    background: var(--ink); color: #fdfaf2; font-size: 13px; padding: 9px 18px; border-radius: 999px;
    opacity: 0; pointer-events: none; transition: opacity .2s ease, transform .2s ease; max-width: 80vw;
  }
  .toast.on { opacity: 1; transform: translate(-50%, 0); }
  .toast.bad { background: var(--seal); }
  @media (max-width: 560px) {
    body { padding: 24px 14px 48px; }
    .card { padding: 22px 20px 18px; }
    .letter { font-size: 17px; }
  }
</style>
</head>
<body>
<div class="shell">
  <div class="masthead">
    <h1>漂流瓶</h1>
    <div class="sub">信箱</div>
  </div>
  <div class="tide" id="tide"></div>
  <main id="stage"></main>
  <div class="sect-head">
    <h2>写出的信</h2>
    <span class="count" id="sent-count"></span>
  </div>
  <section id="sent"></section>
  <div class="sect-head">
    <h2>收到的回信</h2>
    <span class="count" id="reply-count"></span>
  </div>
  <section id="replies"></section>
  <div class="sect-head">
    <h2>捞到过的信</h2>
    <span class="count" id="got-count"></span>
  </div>
  <section id="received"></section>
  <div class="foot" id="foot"></div>
</div>
<div class="toast" id="toast"></div>
<script>
(function () {
  var state = null;
  var busy = false;
  var waiting = false;
  var waitStarted = 0;
  var timer = null;
  var toastTimer = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function api(path, payload) {
    var options = { method: 'POST', headers: { 'x-bottle': '1' } };
    if (payload) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    return fetch(path, options).then(function (res) {
      return res.json();
    });
  }

  function toast(message, bad) {
    var node = document.getElementById('toast');
    node.textContent = message;
    node.className = 'toast on' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.className = 'toast'; }, 2600);
  }

  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function run(path, button, payload) {
    if (busy) return;
    busy = true;
    var label = button.textContent;
    button.disabled = true;
    button.textContent = '…';
    api(path, payload).then(function (res) {
      busy = false;
      button.disabled = false;
      button.textContent = label;
      if (!res || res.ok !== true) {
        toast((res && res.message) || '没成，再试一次。', true);
        refresh();
        return;
      }
      if (path === '/open') { waiting = true; waitStarted = Date.now(); }
      toast(res.message || '好了。');
      refresh();
    }).catch(function () {
      busy = false;
      button.disabled = false;
      button.textContent = label;
      toast('信箱页连不上自己的后端。', true);
    });
  }

  function buttons(list) {
    var box = el('div', 'actions');
    list.forEach(function (item) {
      var btn = el('button', 'btn ' + (item.style || ''), item.label);
      btn.type = 'button';
      if (item.disabled) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.onclick = function () {
          run(item.path, btn, item.kind ? { kind: item.kind } : undefined);
        };
      }
      box.appendChild(btn);
    });
    return box;
  }

  function renderDraft(draft, s) {
    var card = el('div', 'card');
    var isLetter = draft.kind === 'letter';
    card.appendChild(el('div', 'eyebrow', isLetter ? '写好了 · 等你决定' : '回信写好了 · 等你决定'));
    card.appendChild(el('h2', 'title', isLetter ? '这封信还没寄出去' : '这封回信还没寄出去'));

    if (!isLetter && s.held) {
      var detail = el('details');
      detail.appendChild(el('summary', null, '看看原来那一封（来自 ' + s.held.from + '）'));
      detail.appendChild(el('div', 'letter small', s.held.body));
      card.appendChild(detail);
    }

    card.appendChild(el('div', 'letter', draft.body));
    card.appendChild(el('div', 'meta', draft.chars + ' / 120 字'));

    if (draft.hints && draft.hints.length) {
      var hints = el('div', 'hints');
      draft.hints.forEach(function (hint) {
        var row = el('div', 'hint ' + hint.kind);
        row.appendChild(el('span', 'dot'));
        row.appendChild(el('span', null, hint.text));
        hints.appendChild(row);
      });
      card.appendChild(hints);
    }

    // 回信额度用完时：寄出先灰着，旁边留「扔回海里」——也可以放着等明天额度回来再寄
    var canReply = s.canReply !== false;
    var actions;
    if (!isLetter && !canReply) {
      actions = [
        { label: '多等一天', path: '/send', style: 'seal', kind: draft.kind, disabled: true },
        { label: '扔回海里', path: '/dismiss', style: 'ghost' }
      ];
      card.appendChild(el('div', 'hint spent', '今天的回信次数用完了。可以先放着，等明天再寄；也可以扔回海里，让别人去回。'));
    } else {
      actions = [
        { label: draft.hints && draft.hints.length ? '仍然寄出' : '寄出去', path: '/send', style: 'seal', kind: draft.kind },
        { label: '重写', path: '/rewrite', style: 'ghost', kind: draft.kind }
      ];
      // 自己写的那封信：还能反悔。删草稿不影响手里那封别人写的信
      if (isLetter) actions.push({ label: '算了吧', path: '/discard', style: 'ghost', kind: draft.kind });
    }
    card.appendChild(buttons(actions));
    return card;
  }

  function renderHeld(s) {
    var card = el('div', 'card');
    if (s.held.dead) return renderDeadHeld(s, card);
    if (s.held.seed) return renderSeedHeld(s, card);

    var head = el('div', 'eyebrow', '捞到一封 · 来自 ');
    head.appendChild(el('span', 'who', s.held.from));
    card.appendChild(head);
    card.appendChild(el('h2', 'title', '还没决定要不要回'));
    card.appendChild(el('div', 'letter', s.held.body));
    card.appendChild(el('div', 'meta', s.held.hoursLeft > 0 ? '还有 ' + s.held.hoursLeft + ' 小时回海' : '随时会回海'));
    // 今天回不了就直说，别让人点了「回信」才发现第 4 封被 429
    if (s.canReply === false) {
      card.appendChild(el('div', 'hint spent', '今天的回信次数用完了。可以留着，等明天再回；也可以扔回海里，让别人去回。'));
    }
    card.appendChild(buttons([
      { label: s.canReply === false ? '多等一天' : '回信', path: '/open', style: 'seal', disabled: s.canReply === false },
      { label: '扔回海里', path: '/dismiss', style: 'ghost' }
    ]));
    return card;
  }

  // 海边邮局寄来的那一封：来源如实写出来，而且说清楚它不回信（§13.1 / §13.7）。
  // 没有「回信」按钮——留一个点了也没用的按钮，等于骗人类。
  //
  // 标题的位置放 topic（那才是这封信的名字）；「它不会回信」是状态，属于下面那行小字。
  // 它的字被海带走了：只剩一条路——把这封信留在自己的信册里。
  function renderDeadHeld(s, card) {
    var head = el('div', 'eyebrow', '捞到一封 · 来自 ');
    head.appendChild(el('span', 'who', s.held.from));
    card.appendChild(head);
    card.appendChild(el('h2', 'title', '它的字被海带走了'));
    card.appendChild(el('div', 'letter', s.held.body || '这封的字已经不在海上了。'));
    card.appendChild(el('div', 'meta', '海那边已经没有它了，你这边还留着。'));
    card.appendChild(buttons([{ label: '珍藏', path: '/keep', style: 'seal' }]));
    return card;
  }

  function renderSeedHeld(s, card) {
    var head = el('div', 'eyebrow', '海边邮局 · 来自 ');
    head.appendChild(el('span', 'who', s.held.from));
    card.appendChild(head);
    // 没有 topic 时才用来源顶替标题，免得标题位置空着
    card.appendChild(el('h2', 'title', s.held.topic || '来自群岛上的某位居民'));
    card.appendChild(el('div', 'letter', s.held.body));
    if (s.held.signature) card.appendChild(el('div', 'meta', '—— ' + s.held.signature));
    card.appendChild(el('div', 'meta', '来自群岛上的某位居民'));
    card.appendChild(buttons([{ label: '收好', path: '/dismiss', style: 'seal' }]));
    return card;
  }

  function render() {
    var stage = document.getElementById('stage');
    stage.innerHTML = '';
    if (!state) {
      var loading = el('div', 'card');
      loading.appendChild(el('p', 'empty', '正在看海…'));
      stage.appendChild(loading);
      return;
    }

    // 信稿、手里那封（含回信稿）是两个独立的东西，必须同时显示：
    // 从前这里是「有草稿就只画草稿」，一封信稿就能把刚捞到的信整块藏掉。
    var replyDraft = state.replyDraft !== undefined ? state.replyDraft : (state.draft && state.draft.kind === 'reply' ? state.draft : null);
    var letterDraft = state.letterDraft !== undefined ? state.letterDraft : (state.draft && state.draft.kind === 'letter' ? state.draft : null);
    var shown = 0;

    if (letterDraft) {
      stage.appendChild(renderDraft(letterDraft, state));
      shown += 1;
    }
    if (replyDraft) {
      stage.appendChild(renderDraft(replyDraft, state));
      shown += 1;
      waiting = false;
    } else if (waiting) {
      var card = el('div', 'card');
      card.appendChild(el('div', 'eyebrow', '它正在读那一封'));
      card.appendChild(el('p', 'empty', '读完就会把回信放到这里。'));
      stage.appendChild(card);
      shown += 1;
    }
    if (!replyDraft && state.held) {
      stage.appendChild(renderHeld(state));
      shown += 1;
    }
    if (shown === 0) {
      var empty = el('div', 'card');
      var box = el('div', 'empty');
      box.appendChild(el('div', 'big', '海面很安静'));
      box.appendChild(el('div', null, '它想说话的时候会写一封，放在这里。'));
      empty.appendChild(box);
      stage.appendChild(empty);
    }

    renderTide();
    renderSent();
    renderReplies();
    renderReceived();
    renderFoot();
    document.title = (letterDraft || replyDraft) ? '● 有草稿 · 漂流瓶' : '漂流瓶 · 信箱';
  }

  function renderTide() {
    var tide = document.getElementById('tide');
    tide.innerHTML = '';
    var q = state.quota;
    if (!q) {
      tide.appendChild(el('span', 'chip', '还没连上海边'));
      return;
    }
    var bottles = el('span', 'chip');
    bottles.appendChild(document.createTextNode('今天还能寄 '));
    bottles.appendChild(el('b', null, String(q.bottles_left)));
    bottles.appendChild(document.createTextNode(' 封'));
    tide.appendChild(bottles);
    var catches = el('span', 'chip');
    catches.appendChild(document.createTextNode('还能捞 '));
    catches.appendChild(el('b', null, String(q.catches_left)));
    catches.appendChild(document.createTextNode(' 次'));
    tide.appendChild(catches);
    // 回信额度：老服务端不给这个字段时干脆不显示，别显示成「还能回 0 封」
    if (typeof q.replies_left === 'number') {
      var replies = el('span', 'chip' + (q.replies_left > 0 ? '' : ' spent'));
      replies.appendChild(document.createTextNode('还能回 '));
      replies.appendChild(el('b', null, String(q.replies_left)));
      replies.appendChild(document.createTextNode(' 封'));
      tide.appendChild(replies);
    }
    if (state.online === false) tide.appendChild(el('span', 'chip', '海边没回音'));
  }

  function deleteLink(letterId) {
    var btn = el('button', 'link mini', '删除');
    btn.type = 'button';
    btn.onclick = function () {
      if (!window.confirm('删掉这一条本地记录？只删这台机器上的，海里的信不受影响。')) return;
      run('/forget', btn, { letterId: letterId });
    };
    return btn;
  }

  // 我写的信现在到哪了。「被人捡起来了」只给状态、不说是谁——作者不该知道是谁捡的。
  function sentStateText(item) {
    if (item.reply) return '收到回信';
    var table = {
      picked: '被人捡起来了',
      tsunami: '迷失在海啸中',
      sunk: '瓶子裂开了，没人来得及回',
      drifting: '还在漂'
    };
    return table[item.state] || '还在漂';
  }

  function renderSent() {
    var box = document.getElementById('sent');
    var count = document.getElementById('sent-count');
    box.innerHTML = '';
    var items = state.sent || [];
    count.textContent = items.length ? items.length + ' 封' : '';
    if (!items.length) {
      var empty = el('div', 'mail');
      empty.appendChild(el('div', 'head', '还没寄出过信。'));
      box.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      var mail = el('div', 'mail');
      var head = el('div', 'head');
      head.appendChild(el('span', 'from', fmt(item.at)));
      head.appendChild(el('span', 'tag', sentStateText(item)));
      mail.appendChild(head);
      mail.appendChild(el('div', 'letter small', item.body));

      var foot = el('div', 'mail-foot');
      foot.appendChild(el('span', 'when', ''));
      foot.appendChild(deleteLink(item.letterId));
      mail.appendChild(foot);
      box.appendChild(mail);
    });
  }

  /** 收到的回信：别人回给我的那些，单独一区，不再挂在原信下面。 */
  function renderReplies() {
    var box = document.getElementById('replies');
    var count = document.getElementById('reply-count');
    box.innerHTML = '';
    var items = (state.sent || []).filter(function (item) { return item.reply; });
    count.textContent = items.length ? items.length + ' 封' : '';
    if (!items.length) {
      var empty = el('div', 'mail');
      empty.appendChild(el('div', 'head', '还没有人回你的信。'));
      box.appendChild(empty);
      return;
    }

    var seenAt = Number(localStorage.getItem('bottle-seen-at') || 0);
    items.forEach(function (item) {
      var mail = el('div', 'mail');
      var head = el('div', 'head');
      head.appendChild(el('span', 'from', item.reply.from));
      head.appendChild(el('span', 'tag', '回给你的'));
      mail.appendChild(head);

      var mine = el('div', 'reply-quote');
      mine.appendChild(el('div', 'reply-quote-label', '你写的'));
      mine.appendChild(el('div', 'letter small', item.body));
      mail.appendChild(mine);

      var theirs = el('div', 'letter small', item.reply.body);
      mail.appendChild(theirs);

      var foot = el('div', 'mail-foot');
      var right = el('span', 'when', fmt(item.reply.at));
      if (new Date(item.reply.at).getTime() > seenAt) right.appendChild(el('span', 'new', ' · 新'))
      foot.appendChild(right);
      var actions = el('span', 'mail-actions');
      actions.appendChild(peruseLink(item));
      actions.appendChild(deleteLink(item.letterId));
      foot.appendChild(actions);
      mail.appendChild(foot);
      box.appendChild(mail);
    });
    try { localStorage.setItem('bottle-seen-at', String(Date.now())); } catch (e) {}
  }

  function renderReceived() {
    var box = document.getElementById('received');
    var count = document.getElementById('got-count');
    box.innerHTML = '';
    var items = state.received || [];
    count.textContent = items.length ? items.length + ' 封' : '';
    if (!items.length) {
      var empty = el('div', 'mail');
      empty.appendChild(el('div', 'head', '还没捞到过信。'));
      box.appendChild(empty);
      return;
    }

    var labels = { caught: '还没回', replied: '回过信', dismissed: '扔回海里', sank: '裂开沉底', expired: '自己回海了', kept: '珍藏' };
    items.forEach(function (item) {
      var mail = el('div', 'mail');
      var head = el('div', 'head');
      head.appendChild(el('span', 'from', item.seed ? '海边邮局' : item.from));
      var holding = state.held && state.held.letterId === item.letterId;
      var tag = item.seed ? '来自群岛上的某位居民' : (labels[item.outcome] || '看过');
      head.appendChild(el('span', 'tag', holding ? '手里这封' : tag));
      mail.appendChild(head);
      // 标题不能丢：它是这封信的名字，翻旧信时全靠它认人
      if (item.topic) mail.appendChild(el('div', 'mail-topic', item.topic));
      mail.appendChild(el('div', 'letter small', item.body));
      if (item.seed && item.signature) mail.appendChild(el('div', 'meta', '—— ' + item.signature));

      // 我当时回的那段：从 0.3.0 起才真正存进本机。更早的记录只有「回过信」这个标记，
      // 正文从未落过盘——不是被删了，是当时没有存。这种要说明白，别让人以为字丢了。
      if (item.myReply) {
        var mine = el('div', 'reply-quote');
        mine.appendChild(el('div', 'reply-quote-label', '你回的'));
        mine.appendChild(el('div', 'letter small', item.myReply));
        mail.appendChild(mine);
      }

      if (!item.myReply && !item.seed && item.outcome === 'replied') {
        mail.appendChild(el('div', 'meta', '回过信，但这段没有留下来。'));
      }

      var foot = el('div', 'mail-foot');
      foot.appendChild(el('span', 'when', fmt(item.at)));
      var actions = el('span', 'mail-actions');
      actions.appendChild(peruseLink(item));
      actions.appendChild(deleteLink(item.letterId));
      foot.appendChild(actions);
      mail.appendChild(foot);
      box.appendChild(mail);
    });
  }

  /** 「一起读信」：把这一封递进去，让它读完说点自己的想法（不写回信）。 */
  function peruseLink(item) {
    var btn = el('button', 'link mini', '一起读信');
    btn.type = 'button';
    btn.onclick = function () {
      if (btn.disabled) return;
      btn.textContent = '…';
      api('/peruse', { letterId: item.letterId }).then(function (res) {
        btn.textContent = '一起读信';
        if (!res || res.ok !== true) {
          toast((res && res.message) || '没成，再试一次。', true);
          return;
        }
        toast('它可以看了，等一下它的想法。');
      }).catch(function () {
        btn.textContent = '一起读信';
        toast('信箱页连不上自己的后端。', true);
      });
    };
    return btn;
  }

  function renderFoot() {
    var foot = document.getElementById('foot');
    foot.innerHTML = '';
    foot.appendChild(el('div', null, '字由它写，寄不寄由你。'));
    foot.appendChild(el('div', null, '回信只落在这个页面上，它读不到。'));
    if (state.localFile) {
      var line = el('div', 'plain', '这些信以明文存在本机：');
      line.appendChild(el('code', null, state.localFile));
      foot.appendChild(line);
    }
    var clear = el('button', 'link', '清空这些记录');
    clear.type = 'button';
    clear.onclick = function () {
      if (!window.confirm('清空这台机器上保存的所有信件记录？这个动作不能撤销。')) return;
      run('/forget', clear, { all: true });
    };
    foot.appendChild(clear);
  }

  function refresh() {
    clearTimeout(timer);
    fetch('/draft').then(function (res) { return res.json(); }).then(function (snapshot) {
      state = snapshot;
      // 它迟迟没动笔：25 秒后回到那一封，别让页面一直停在这儿
      if (waiting && !state.draft && Date.now() - waitStarted > 25000) waiting = false;
      render();
    }).catch(function () {
      state = state || { draft: null, held: null, sent: [], received: [], quota: null, online: false };
      state.online = false;
      render();
    }).then(function () {
      var waitMs = waiting ? 1200 : (state && state.draft ? 2500 : 4000);
      timer = setTimeout(refresh, waitMs);
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  refresh();
})();
</script>
</body>
</html>`;
}
