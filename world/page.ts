import { serveBridge, type BridgeDeps } from './bridge.ts';
import { isDraftRef, type DraftRef } from './drafts.ts';
import { ARCHIVE_MAX_BYTES } from './archive.ts';
import type { DefaultFont, FontResource } from './font-catalog.ts';
import { MY_FONT_MAX_BYTES } from './my-font.ts';
import { fontAsset } from './fonts.ts';
import { doodleAsset } from './stationery.ts';
import { customPalettes } from './appearance.ts';
import { BACKGROUND_MAX_BYTES } from './background.ts';
import { feedbackQr } from './feedback.ts';
/**
 * 本地信箱 WebUI：信件显示、人工确认与历史信册。
 *
 * 它存在的唯一理由是「人类看文本，Bot 不看」。气泡里的字是模型写的，模型不读原文就没法把
 * 原文放进气泡；所以需要一个不经模型的显示通道。默认发送由人从页面确认；显式开启高危无头模式后模型可操作指定草稿版本。
 *
 * Windows 上主界面是原生卡片（`card-host.ps1`），这一页是兜底、调试，以及「翻旧信」的地方。
 * 本机监听只绑 127.0.0.1，不做鉴权；可选对外监听由 lan.ts 包裹鉴权。POST 要求一个自定义头，
 * 免得别的网页用表单偷偷替人类点「寄出去」。
 */
import { soundLibrary, packSound } from './sound.ts';
import { pageHtml } from './page-view.ts';
import { isThemePreference, type CardAppearance, type ThemePreference } from './appearance.ts';
import type { MailboxTheme } from './theme.ts';
export { pageHtml } from './page-view.ts';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AnnouncementSummary, Quota } from '../shared/contract.ts';
import type { WakeAction, WakeState } from './wake.ts';
import { WAKE_POLICIES } from './wake-policy.ts';
import type { SoftHint } from '../shared/hints.ts';

export type Surface = 'card' | 'page' | 'remote';

export interface PageDraftView {
  source?: {kind:'bridge';name:string};
  draftId?: string; revision?: number; sendPolicy?: 'manual' | 'delayed';
  autoSendAt?:number;
  autoSendPending?:boolean;
  sendFailure?:'expired';
  at?: number;
  topic?: string;
  kind: 'letter' | 'reply';
  body: string;
  letterId?: string;
  chars: number;
  hints: SoftHint[];
  stationery?: import('../shared/contract.ts').Stationery;
}

export interface PageHeldView {
  readAt?: number;
  fontId?: string;
  caughtAt?: number;
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
  stationery?: import('../shared/contract.ts').Stationery;
  stationeryRejected?: true;
}

export interface PageReplyView {
  fontId?: string;
  readCount?: number;
  from: string;
  body: string;
  at: string;
  stationery?: import('../shared/contract.ts').Stationery;
  stationeryRejected?: true;
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
  stationery?: import('../shared/contract.ts').Stationery;
}

export type PageOutcome = 'caught' | 'replied' | 'dismissed' | 'sank' | 'expired' | 'kept';

export interface PageReceivedView {
  unsentReplies?: import('./store.ts').ReceivedLetter['unsentReplies'];
  fontId?: string;
  readCount?: number;
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
  stationery?: import('../shared/contract.ts').Stationery;
  stationeryRejected?: true;
  myReplyStationery?: import('../shared/contract.ts').Stationery;
  myReplyStationeryRejected?: true;
}

export interface PageSnapshot {
  noteRewriting?: boolean;
  noteDraft?: { letterId:string; body:string; at:number } | null;
  stars?: PageStarView[];
  starMemoryEnabled?: boolean;
  /** Opaque identifier regenerated on each World start; browser-local announcement dismissal uses it. */
  worldSession?: string;
  fontResources?:Record<string,FontResource>;
  defaultFont?:DefaultFont;
  botName?: string;
  desktopCards?: boolean;
  wake?: WakeState | null;
  randomWake?: boolean;
  cooldowns?: Partial<Record<'write' | 'catch', number>>;
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

export interface PageStarView {
  letterId: string;
  starredAt: number;
  memorySelected: boolean;
  memoryActive: boolean;
  category: 'received' | 'seed' | 'sent' | 'reply';
  title: string;
  from: string;
  at: string;
}

export interface PageResult {
  completedReplyId?: string;
  ok: boolean;
  reason?: 'tide_out';
  message?: string;
  /** 原生卡片据此在显示完这句话之后自己关掉；网页忽略。 */
  close?: boolean;
}

export interface PageDeps {
  bridge?: BridgeDeps;
  notes?(): Promise<Array<import('./note-cache.ts').LocalNote & {read:boolean}>>;
  readNote?(id:string):Promise<PageResult>;
  ackNote?(id:string): Promise<PageResult>;
  note?(id:string): Promise<PageResult>;
  requestNote?(id:string,surface:Surface): Promise<PageResult>;
  rewriteNote?(id:string,surface:Surface): Promise<PageResult>;
  discardNote?(id:string): PageResult;
  repost?(id:string): Promise<PageResult>;
  exportArchive?(): import('../shared/contract.ts').LetterbookArchive;
  importArchive?(raw:unknown): PageResult;

  star?(letterId: string, enabled: boolean): Promise<PageResult>;
  starMemory?(letterId: string, enabled: boolean): Promise<PageResult>;
  starMemorySetting?(enabled: boolean): Promise<PageResult>;
  myFont?(id: string): { bytes: Buffer; mime: string } | null;
  uploadMyFont?(input: unknown): { id:string; name:string };
  background?(id: string): { bytes: Buffer; mime: string } | null;
  uploadBackground?(input: unknown): string;
  theme?(): Promise<MailboxTheme>;
  appearance?(preference?: ThemePreference): Promise<CardAppearance>;
  snapshot(cachedFontDigests?: readonly string[]): PageSnapshot;
  announcement?(): Promise<AnnouncementSummary | null>;
  refresh?(): Promise<void>;
  wakeControl?(action: WakeAction, command: 'pause' | 'resume' | 'interval', hours?: number, dayLimit?: number): Promise<PageResult>;
  request(action: 'write' | 'catch', actor?: 'bot' | 'human', surface?: Surface): Promise<PageResult>;
  /** 信稿人工寄出；已确认的回信稿另有两小时自动寄出。 */
  send(kind?: 'letter' | 'reply', ref?: DraftRef): Promise<PageResult>;
  rewrite(kind?: 'letter' | 'reply', surface?: Surface, ref?: DraftRef): Promise<PageResult>;
  dismiss(): Promise<PageResult>;
  /** 字已经没了的信：只能珍藏，不再有回信/再等/扔回。 */
  keep(): Promise<PageResult>;
  /** 「一起读信」：把信册里某一封（别人写的）递进上下文，读完说点自己的想法。 */
  peruse(letterId: string): Promise<PageResult>;
  /** 把还没寄出去的草稿扔掉（「算了吧」）；不动手里那封信。 */
  discard(kind?: 'letter' | 'reply', ref?: DraftRef): Promise<PageResult>;
  open(surface: Surface): Promise<PageResult>;
  read?(surface: Surface): Promise<PageResult>;
  /** 不带 letterId 清空历史；带了就只删那一条。 */
  forget(letterId?: string): Promise<PageResult>;
}

export interface PageResponse {
  status: number;
  json?: unknown;
  html?: string;
  binary?: { bytes: Uint8Array; mime: string };
}

export interface PageRequestOptions {
  surface?: Surface;
  /** Browser cache hints contain only public font digests, never letter identities. */
  cachedFontDigests?: readonly string[];
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
  if (method === 'GET' && route.startsWith('/my-font/')) {
    const file = deps.myFont?.(route.slice(9));
    return file ? {status:200,binary:file} : {status:404,json:{ok:false}};
  }
  if (method === 'POST' && route === '/my-font') {
    if (!deps.uploadMyFont) return {status:503,json:{ok:false}};
    try { return {status:200,json:{ok:true,...deps.uploadMyFont(opts.body)}}; }
    catch { return {status:400,json:{ok:false,message:'请选择不超过 32 MB 的 TTF、OTF、WOFF 或 WOFF2 字体。'}}; }
  }
  if (method === 'GET' && route.startsWith('/fonts/')) {
    const file = fontAsset(route.slice(7));
    return file ? { status:200, binary:file } : { status:404, json:{ok:false} };
  }
  if (method === 'GET' && route.startsWith('/doodle/')) {
    const match = /^\/doodle\/([a-z0-9][a-z0-9-]{0,47})(?:\/([a-f0-9]{6}))?$/i.exec(route);
    const file = match ? doodleAsset(match[1], undefined, match[2] ? '#' + match[2] : undefined) : null;
    return file ? { status:200, binary:file } : { status:404, json:{ok:false} };
  }
  if (method === 'GET' && /^\/palette\/[a-f0-9]{6}$/i.test(route))
    return { status:200, json:customPalettes('#' + route.slice(9)) };
  if (method === 'GET' && route.startsWith('/background/')) {
    const file = deps.background?.(route.slice(12));
    return file ? { status:200, binary:file } : { status:404, json:{ok:false} };
  }
  if (method === 'POST' && route === '/background') {
    if (!deps.uploadBackground) return { status:503, json:{ok:false} };
    try { return { status:200, json:{ok:true, id:deps.uploadBackground(opts.body)} }; }
    catch { return { status:400, json:{ok:false, message:'请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。'} }; }
  }
  if (method === 'GET' && route === '/feedback-qr.png')
    return { status: 200, binary: { bytes: await feedbackQr(), mime: 'image/png' } };
  if (method === 'GET' && route === '/sounds') return { status: 200, json: { files: soundLibrary() } };
  if (method === 'GET' && route.startsWith('/sounds/')) {
    let id = ''; try { id = decodeURIComponent(route.slice(8)); } catch { return {status:400,json:{ok:false}}; }
    const file = packSound(id); return file ? {status:200,binary:file} : {status:404,json:{ok:false}};
  }
  if (method === 'GET' && (route === '/icon.png' || route === '/favicon.ico'))
    return { status: 200, binary: { bytes: await readFile(new URL('./icon.png', import.meta.url)), mime: 'image/png' } };

  if (method === 'GET' && (route === '/' || route === '/theme')) {
    let theme: MailboxTheme;
    try { theme = await deps.theme?.() ?? { available: false }; } catch { theme = { available: false }; }
    return route === '/' ? { status: 200, html: pageHtml(theme) } : { status: 200, json: theme };
  }
  if (route === '/appearance' && (method === 'GET' || method === 'POST')) {
    if (!deps.appearance) return { status: 503, json: { ok: false } };
    if (method === 'POST' && !isThemePreference(opts.body)) return { status: 400, json: { ok: false } };
    try { return { status: 200, json: await deps.appearance(method === 'POST' ? opts.body as ThemePreference : undefined) }; }
    catch { return { status: 503, json: { ok: false } }; }
  }
  if (method === 'GET' && route === '/announcement') {
    try { return { status: 200, json: { announcement: await deps.announcement?.() ?? null } }; }
    catch { return { status: 503, json: { announcement: null } }; }
  }
  if (method === 'GET' && route === '/notes') {
    try { return {status:200,json:await deps.notes?.() ?? []}; } catch { return {status:503,json:{ok:false,message:'暂时取不到纸条。'}}; }
  }
  if (method === 'GET' && route === '/archive/export') return deps.exportArchive ? {status:200,json:deps.exportArchive()} : {status:503,json:{ok:false}};
  if (method === 'POST' && route === '/archive/import') return {status:200,json:deps.importArchive?.(opts.body) ?? {ok:false,message:'导入暂不可用。'}};
  if (method === 'POST' && ['/note','/note/request','/note/rewrite','/note/read','/note/discard','/note/ack','/repost'].includes(route)) {
    const b=opts.body as Record<string,unknown>|null;
    const id=route==='/note/ack'||route==='/note/read'?b?.id:b?.letterId;
    if(typeof id!=='string'||!id||id.length>256||route.startsWith('/note')&&b&&'body' in b) return {status:400,json:{ok:false,message:'纸条正文只能由桌宠起草，页面不能填写或修改。'}};
    try { const result=route==='/note'?await deps.note?.(id):route==='/note/request'?await deps.requestNote?.(id,opts.surface??'page'):route==='/note/rewrite'?await deps.rewriteNote?.(id,opts.surface??'page'):route==='/note/read'?await deps.readNote?.(id):route==='/note/discard'?deps.discardNote?.(id):route==='/note/ack'?await deps.ackNote?.(id):await deps.repost?.(id);
      return {status:200,json:result ?? {ok:false,message:'暂不可用。'}};
    } catch {return {status:503,json:{ok:false,message:'没有完成，请稍后重试。'}};}
  }
  if (method === 'GET' && route === '/draft') { await deps.refresh?.(); return { status: 200, json: deps.snapshot(opts.cachedFontDigests) }; }

  if (method === 'POST' && ['/star', '/star-memory', '/star-memory-setting'].includes(route)) {
    const body = opts.body as Record<string, unknown> | null | undefined;
    const value = route === '/star' ? body?.starred : body?.enabled;
    const id = letterIdOf(body);
    if (typeof value !== 'boolean' || (route !== '/star-memory-setting' && (!id || id.length > 256)))
      return { status: 400, json: { ok: false, message: '请明确选择信件与开关状态。' } };
    const action = route === '/star' ? deps.star && (() => deps.star!(id!, value))
      : route === '/star-memory' ? deps.starMemory && (() => deps.starMemory!(id!, value))
      : deps.starMemorySetting && (() => deps.starMemorySetting!(value));
    if (!action) return { status: 503, json: { ok: false, message: '星笺匣暂不可用。' } };
    return { status: 200, json: await action() };
  }

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
    const body = opts.body as Record<string, unknown> | null | undefined;
    if (route === '/wake') {
      if (!deps.wakeControl || typeof body?.action !== 'string' || !['write', 'catch', 'remind'].includes(body.action) ||
        typeof body.command !== 'string' || !['pause', 'resume', 'interval'].includes(body.command))
        return { status: 400, json: { ok: false, message: '请检查邀请设置。' } };
      const policy = WAKE_POLICIES[body.action as WakeAction];
      if (body.command === 'interval' && (typeof body.hours !== 'number' || !Number.isFinite(body.hours) || body.hours < policy.minHours || body.hours > policy.maxHours ||
        (body.dayLimit !== undefined && (typeof body.dayLimit !== 'number' || !Number.isInteger(body.dayLimit) || body.dayLimit < policy.minLimit || body.dayLimit > policy.maxLimit))))
        return { status: 400, json: { ok: false, message: '请检查邀请设置。' } };
      return { status: 200, json: await deps.wakeControl(body!.action as WakeAction, body!.command as 'pause' | 'resume' | 'interval', body!.hours as number | undefined, body!.dayLimit as number | undefined) };
    }
    if ((route === '/write' || route === '/catch') && body?.actor !== undefined && body.actor !== 'bot' && body.actor !== 'human')
      return { status: 400, json: { ok: false, message: '请选择谁来行动。' } };
    const actor = body?.actor === 'human' ? 'human' : 'bot';
    const surface = opts.surface ?? 'page';
    const kind = draftKindOf(opts.body);
    const hasRef = body && ('draftId' in body || 'revision' in body);
    if (['/send','/rewrite','/discard'].includes(route) && hasRef && (!isDraftRef(body) ||
      body.kind !== undefined && body.kind !== 'letter' && body.kind !== 'reply' ||
      Object.keys(body).some(k => !['draftId','revision','kind'].includes(k))))
      return {status:400,json:{ok:false,message:'请明确指定当前草稿 ID 与版本，确认动作不能携带新正文。'}};
    const ref = hasRef && isDraftRef(body) ? {draftId:body.draftId,revision:body.revision} : undefined;
    const actions: Record<string, () => Promise<PageResult>> = {
      '/write': () => deps.request('write', actor, surface),
      '/catch': () => deps.request('catch', actor, surface),
      '/send': () => ref ? deps.send(kind,ref) : deps.send(kind),
      '/rewrite': () => ref ? deps.rewrite(kind,surface,ref) : deps.rewrite(kind,surface),
      '/discard': () => ref ? deps.discard(kind,ref) : deps.discard(kind),
      '/dismiss': () => deps.dismiss(),
      '/keep': () => deps.keep(),
      '/peruse': () => deps.peruse(letterIdOf(opts.body) ?? ''),
      '/open': () => deps.open(surface),
      '/read': () => deps.read?.(surface) ?? Promise.resolve({ ok: false, message: '共读暂不可用。' }),
      '/reply': () => deps.open(surface),
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
export function readBody(req: IncomingMessage, limit = 4096): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // 超限时整块丢弃会把 JSON 截断成「看起来合法」的半截，所以直接标记读不出来
      if (size > limit) {
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

/** Shared HTTP adapter; authentication belongs to the optional LAN listener. */
export function pageHandler(deps: PageDeps, log?: (line: string) => void, remote = false): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const method = (req.method ?? 'GET').toUpperCase();
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (path === '/api' || path.startsWith('/api/')) { serveBridge(deps.bridge,req,res,remote); return; }

    // 跨站表单发不出自定义头；这一条挡住「替人类点寄出」
    if (method === 'POST' && req.headers['x-bottle'] !== '1') {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '这个请求不是从信箱页发出来的。' }));
      return;
    }
    if (method !== 'POST') req.resume();

    const surface: Surface = remote ? 'remote' : req.headers['x-bottle-surface'] === 'card' ? 'card' : 'page';

    void readBody(req, path === '/background' ? Math.ceil(BACKGROUND_MAX_BYTES / 3) * 4 + 128 : path === '/my-font' ? Math.ceil(MY_FONT_MAX_BYTES / 3) * 4 + 2048 : path === '/archive/import' ? ARCHIVE_MAX_BYTES : 4096)
      .then((read) => {
        if (!read.ok) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, message: '请求体读不出来，这个动作没有执行。' }));
          return null;
        }
        const cacheHeader = req.headers['x-bottle-cached-fonts'];
        const cachedFontDigests = typeof cacheHeader === 'string' && cacheHeader.length <= 2079
          ? [...new Set(cacheHeader.split(',').filter(value => /^[a-f0-9]{64}$/.test(value)))].slice(0, 32)
          : [];
        return handlePage(deps, method, path, { surface, body: read.value, cachedFontDigests });
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
        if (result.binary) {
          res.writeHead(result.status, {
            'content-type': result.binary.mime,
            'content-length': result.binary.bytes.byteLength,
            'cache-control': (path.startsWith('/background/') || path.startsWith('/my-font/')) ? 'private, max-age=3600' : 'public, max-age=3600',
            'x-content-type-options': 'nosniff',
          });
          res.end(result.binary.bytes);
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
        log?.(`page failed: ${error instanceof Error ? error.name : 'unknown'}`);
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, message: '信箱页出了点问题。' }));
      });
  };

}

export async function startPageServer(
  deps: PageDeps,
  opts: { port: number; log?: (line: string) => void },
): Promise<PageServer> {
  const handler = pageHandler(deps, opts.log);

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
      const actualPort=(server.address() as {port:number}).port;
      return {
        url: `http://${LOOPBACK}:${actualPort}/`,
        port:actualPort,
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
