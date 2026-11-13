/**
 * 本机留的东西。全部是「环境状态」：草稿、手里那封信、信箱里的回信、这台机器的身份。
 * 没有一条属于人格记忆——丢了最多是这封没寄出去，不会改变它是谁。
 *
 * 文件名都以 `bottle-` 开头：`ctx.dataDir` 是 Core 和所有 World 共用的。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Stationery } from '../shared/contract.ts';
import { storedStationery } from '../shared/stationery.ts';

export type DraftKind = 'letter' | 'reply';

export interface LocalDraft {
  /** External attribution only; never evidence of human approval. Deleted with draft. */
  source?: { kind: 'bridge'; name: string };
  /** Persisted with the draft; deleted on send/discard/delete/clear. */
  draftId?: string;
  revision?: number;
  sendPolicy?: 'manual' | 'delayed';
  /** Reply only. Both are removed with the draft on send/discard/delete/clear. */
  autoSendKey?: string;
  autoSendAt?: number;
  /** Confirmed delivery became impossible; body stays local until discard/delete/clear. */
  sendFailure?: 'expired';
  topic?: string;
  kind: DraftKind;
  /** kind 为 reply 时，这是被回的那一封。 */
  letterId?: string;
  body: string;
  at: number;
  /** 可选的信纸与装饰。 */
  stationery?: Stationery;
}

/** 捞起来、还没决定的那一封。正文只给页面看，永远不进工具回执。 */
/** readAt 随 held 在寄出/收好/归还/删除时清除，不传给下一位收信人。 */
export interface LocalHeld {
  readAt?: number;
  caughtBy?: 'bot' | 'human' | 'bridge';
  catchSource?: string;
  letterId: string;
  from: string;
  body: string;
  caughtAt: number;
  /** 服务端给的 72 小时窗口终点；种子信为 0，不会自己回海。 */
  windowUntil: number;
  /** 海边邮局的种子信：寄不出去，只能收好。 */
  seed?: boolean;
  /**
   * 这一封的字已经没了（服务端 410 `gone`，或出现在 `/quota` 的 `deadLetters` 里）。
   *
   * 这时它不再有「回信 / 再等一天 / 扔回海里」三条路，只剩「珍藏」：
   * 本地信册保留正文，海那边已经没有了。
   */
  dead?: boolean;
  /** 种子信的落款，以及所有信件可选的标题。 */
  signature?: string;
  topic?: string;
  /** 收到的信纸与装饰。随 held 清除；信册里的 ReceivedLetter 另存一份。 */
  stationery?: Stationery;
  /** 来信带了装饰但没通过校验：正文照常保存，页面如实说明图案没有显示。 */
  stationeryRejected?: true;
}
/** 别人回给我的一封。只读，没有选项。 */
export interface LocalReply {
  readCount?: number;
  lastReadAt?: number;
  letterId: string;
  from: string;
  body: string;
  at: number;
  /** 对方回信的装饰。 */
  stationery?: Stationery;
  stationeryRejected?: true;
}

/** 我寄出去的信。留一份在本地，网页上才看得到自己写过什么。 */
export interface SentLetter {
  topic?: string;
  letterId: string;
  body: string;
  at: number;
  /** 首次拾信播报的持久标记，随信册保存。 */
  pickedNoticed?: boolean;
  /** 我寄信时的装饰。 */
  stationery?: Stationery;
}

export type ReceivedOutcome = 'caught' | 'replied' | 'dismissed' | 'sank' | 'expired' | 'kept';

/** 我捞到过的信。outcome 记的是这件事最后怎么收场。 */
export interface ReceivedLetter {
  /** Latest catch; at remains the date first collected in the letterbook. */
  lastCaughtAt?: number;
  readCount?: number;
  lastReadAt?: number;
  letterId: string;
  from: string;
  body: string;
  at: number;
  outcome: ReceivedOutcome;
  /** 我回过这封时写下的正文；「一起读信」要用它当上文。 */
  myReply?: string;
  /** 种子信在历史里也要认得出：它不是某个人类写的。 */
  seed?: boolean;
  signature?: string;
  topic?: string;
  /** 收到的信纸与装饰。 */
  stationery?: Stationery;
  stationeryRejected?: true;
  /** 我回信时的装饰（与收到的装饰分开保存，互不覆盖）。 */
  myReplyStationery?: Stationery;
  myReplyStationeryRejected?: true;
}

export interface Identity {
  clientId: string;
  pseudonym: string;
}

export function readingCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * 上一次写盘失败的原因（`null` = 上次成功或还没写过）。
 *
 * 为什么要把失败暴露出来：以前这里 `catch {}` 全吞掉，注释写着"下一次动作还会再写一次"。
 * 但「手里那封信的 letterId」只写一次——写失败就再也没有下一次了：
 * 服务端占着信、本机不知道是哪封，玩家永久卡在「海边还记着一封未处理的信」。
 * 所以现在至少留一个可读的状态，让上层能发现"这台机器的本机记录没写进去"。
 */
let lastWriteError: string | null = null;

export function lastStoreWriteError(): string | null {
  return lastWriteError;
}

function writeJson(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = path + '.tmp';
    try { writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, path); }
    finally { try { unlinkSync(temporary); } catch {} }
    lastWriteError = null;
  } catch (error) {
    // 仍然不打断主流程（一次 UI 动作不该因为磁盘满而整条失败），
    // 但把原因记下来，别再让它无声无息。
    lastWriteError = error instanceof Error ? error.message : String(error);
  }
}

export class LocalStore {
  identity: Identity | null = null;
  /**
   * 回信草稿：绑在手里那一封上，`kind` 恒为 `reply`。
   *
   * 与 `letterDraft` 分开存，是因为两者会同时存在：手里压着一封信稿的人类，
   * 照样该能去读别人捞给他的那一封，回信稿不能把信稿顶掉。
   */
  draft: LocalDraft | null = null;
  /** 信稿：还没寄出去的一封新信，`kind` 恒为 `letter`。 */
  letterDraft: LocalDraft | null = null;
  held: LocalHeld | null = null;
  replies: LocalReply[] = [];
  sent: SentLetter[] = [];
  received: ReceivedLetter[] = [];
  /**
   * 已经看过几次海啸。`null` = 还没建立基线：第一次连上时只记录不打扰，
   * 否则新装的世界会为历史上每一次海啸都弹一条，那些跟这个人类没关系。
   */
  tsunamiSeen: number | null = null;
  lastWrittenAt = 0;
  lastCaughtAt = 0;
  writeDay = '';
  writesToday = 0;
  /**
   * 这个 Coo 一共起草过几封信（含被重写覆盖的）。
   *
   * 它与 `sent.length` 一起构成一瓶本地漏斗：起草多、寄出少 = 卡在人类审核；
   * 起草也少 = 它根本没有表达的时机。只记次数，不记内容。
   */
  draftsMade = 0;

  private readonly identityFile: string;
  private readonly draftFile: string;
  /** 只存本地小状态（目前是海啸基线）。不属于信册，`clear()` 不动它。 */
  private readonly stateFile: string;
  /** 页面会把这个路径念给人类听：信是明文存在这里的。 */
  readonly letterbookFile: string;
  /** 卡片宿主写的那一份，也是明文；清记录时一并删掉。 */
  private readonly cardFile: string;

  constructor(dir: string) {
    this.identityFile = join(dir, 'bottle-id.json');
    this.draftFile = join(dir, 'bottle-draft.json');
    this.stateFile = join(dir, 'bottle-state.json');
    this.letterbookFile = join(dir, 'bottle-letterbook.json');
    this.cardFile = join(dir, 'bottle-card.json');
  }

  load(): void {
    // Restarting the same World instance must not keep records removed on disk.
    this.held = null;
    this.draft = null;
    this.letterDraft = null;
    const id = readJson<Partial<Identity>>(this.identityFile);
    if (id && typeof id.clientId === 'string' && id.clientId) {
      this.identity = { clientId: id.clientId, pseudonym: typeof id.pseudonym === 'string' ? id.pseudonym : '' };
    }

    const state = readJson<Record<string, unknown>>(this.stateFile);
    this.tsunamiSeen = typeof state?.tsunamiSeen === 'number' ? state.tsunamiSeen : null;
    const count = (key: string) => typeof state?.[key] === 'number' && Number.isFinite(state[key]) && state[key] >= 0 ? Math.floor(state[key]) : 0;
    this.draftsMade = count('draftsMade');
    this.lastWrittenAt = count('lastWrittenAt');
    this.lastCaughtAt = count('lastCaughtAt');
    this.writeDay = typeof state?.writeDay === 'string' ? state.writeDay : '';
    this.writesToday = count('writesToday');

    // 落盘格式是 `{ draft, letterDraft }` 两个槽：`draft` 是回信草稿，`letterDraft` 是信稿。
    // 分开存是因为两者会同时存在——手里有信稿的人照样能去读别人那一封，回信稿不能把信稿顶掉。
    // 旧格式只有 `{ draft }`（或裸草稿），按 `kind` 归槽，免得升级后吃掉别人手里的字。
    const raw = readJson<{
      draft?: Partial<LocalDraft> | null;
      letterDraft?: Partial<LocalDraft> | null;
    } | Partial<LocalDraft>>(this.draftFile);
    const wrapped = !!raw && typeof raw === 'object' && ('draft' in raw || 'letterDraft' in raw);
    const legacy = wrapped ? null : (raw as Partial<LocalDraft> | null);

    const readDraft = (value: Partial<LocalDraft> | null | undefined, kind: DraftKind): LocalDraft | null => {
      if (!value || typeof value.body !== 'string' || !value.body) return null;
      if (value.kind !== undefined && value.kind !== kind) return null;
      return {
        kind,
        ...(value.source?.kind === 'bridge' && typeof value.source.name === 'string' && value.source.name.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value.source.name) ? {source:{kind:'bridge' as const,name:value.source.name}} : {}),
        draftId: typeof value.draftId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.draftId) ? value.draftId : randomUUID(),
        revision: Number.isSafeInteger(value.revision) && value.revision! > 0 ? value.revision : 1,
        sendPolicy: kind === 'reply' && value.sendFailure !== 'expired' && value.autoSendKey && value.sendPolicy !== 'manual' ? 'delayed' : 'manual',
        ...(kind === 'reply' && value.sendFailure === 'expired' ? {sendFailure:'expired' as const} : {}),
        ...(kind === 'reply' && typeof value.letterId === 'string' ? { letterId: value.letterId } : {}),
        body: value.body,
        ...(kind === 'letter' && typeof value.topic === 'string' && value.topic ? { topic: value.topic } : {}),
        at: Number(value.at ?? 0),
        ...stationeryField(value.stationery),
        ...(kind==='reply'&&value.sendFailure!=='expired'&&value.sendPolicy!=='manual'&&typeof value.autoSendKey==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value.autoSendKey)?{autoSendKey:value.autoSendKey,
          ...(typeof value.autoSendAt==='number'&&Number.isFinite(value.autoSendAt)&&value.autoSendAt>0?{autoSendAt:value.autoSendAt}:{})}:{}),
      };
    };

    if (wrapped) {
      const oldDraft = (raw as { draft?: Partial<LocalDraft> | null }).draft;
      // 旧格式把信稿也写在 `draft` 里（只是 kind 不同），所以回信槽读不到时要再看一眼 kind。
      this.draft = readDraft(oldDraft, 'reply');
      this.letterDraft =
        readDraft((raw as { letterDraft?: Partial<LocalDraft> | null }).letterDraft, 'letter')
        ?? readDraft(oldDraft, 'letter');
    } else if (legacy?.kind === 'letter') {
      this.letterDraft = readDraft(legacy, 'letter');
    } else {
      this.draft = readDraft(legacy, 'reply');
    }

    if (this.draft || this.letterDraft) this.saveDrafts();

    const book = readJson<{
      held?: Partial<LocalHeld>;
      replies?: Array<Partial<LocalReply>>;
      sent?: Array<Partial<SentLetter>>;
      received?: Array<Partial<ReceivedLetter>>;
    }>(this.letterbookFile);
    const held = book?.held;
    if (held && typeof held.letterId === 'string' && typeof held.body === 'string') {
      this.held = {
        letterId: held.letterId,
        from: typeof held.from === 'string' ? held.from : '一位陌生人',
        body: held.body,
        caughtBy: held.caughtBy === 'bridge' ? 'bridge' : held.caughtBy === 'human' ? 'human' : 'bot',
        ...(typeof held.catchSource === 'string' && held.catchSource.length <= 64 ? {catchSource:held.catchSource} : {}),
        caughtAt: Number(held.caughtAt ?? 0),
        windowUntil: Number(held.windowUntil ?? 0),
        ...(typeof held.readAt === 'number' && Number.isFinite(held.readAt) && held.readAt > 0 ? { readAt: held.readAt } : {}),
        ...(held.seed === true ? { seed: true } : {}),
        ...(held.dead === true ? { dead: true } : {}),
        ...(typeof held.signature === 'string' && held.signature ? { signature: held.signature } : {}),
        ...(typeof held.topic === 'string' && held.topic ? { topic: held.topic } : {}),
        ...stationeryField(held.stationery),
        ...rejectedField(held.stationeryRejected),
      };
    }
    const replies = Array.isArray(book?.replies) ? book.replies : [];
    this.replies = replies
      .filter((item): item is Partial<LocalReply> & { letterId: string; body: string } =>
        typeof item?.letterId === 'string' && typeof item.body === 'string')
      .map((item) => ({
        ...stationeryField(item.stationery),
        ...rejectedField(item.stationeryRejected),
        letterId: item.letterId,
        from: typeof item.from === 'string' ? item.from : '一位陌生人',
        body: item.body,
        at: Number(item.at ?? 0),
        readCount: readingCount(item.readCount),
        ...(typeof item.lastReadAt === 'number' && Number.isFinite(item.lastReadAt) && item.lastReadAt > 0 ? { lastReadAt: item.lastReadAt } : {}),
      }));

    const sent = Array.isArray(book?.sent) ? book.sent : [];
    this.sent = sent
      .filter((item): item is Partial<SentLetter> & { letterId: string; body: string } =>
        typeof item?.letterId === 'string' && typeof item.body === 'string')
      .map((item) => ({ ...stationeryField(item.stationery), letterId: item.letterId, body: item.body,...(typeof item.topic === 'string' && item.topic ? { topic: item.topic } : {}), at: Number(item.at ?? 0), ...(item.pickedNoticed === true ? { pickedNoticed: true } : {}) }));

    const received = Array.isArray(book?.received) ? book.received : [];
    this.received = received
      .filter((item): item is Partial<ReceivedLetter> & { letterId: string; body: string } =>
        typeof item?.letterId === 'string' && typeof item.body === 'string')
      .map((item) => ({
        letterId: item.letterId,
        from: typeof item.from === 'string' ? item.from : '一位陌生人',
        body: item.body,
        at: Number(item.at ?? 0),
        readCount: readingCount(item.readCount),
        ...(typeof item.lastReadAt === 'number' && Number.isFinite(item.lastReadAt) && item.lastReadAt > 0 ? { lastReadAt: item.lastReadAt } : {}),
        outcome: normalizeOutcome(item.outcome),
        ...(typeof item.lastCaughtAt === 'number' && Number.isFinite(item.lastCaughtAt) && item.lastCaughtAt > 0 ? { lastCaughtAt: item.lastCaughtAt } : {}),
        ...(item.seed === true ? { seed: true } : {}),
        ...(typeof item.myReply === 'string' && item.myReply ? { myReply: item.myReply } : {}),
        ...(typeof item.signature === 'string' && item.signature ? { signature: item.signature } : {}),
        ...(typeof item.topic === 'string' && item.topic ? { topic: item.topic } : {}),
        ...stationeryField(item.stationery),
        ...rejectedField(item.stationeryRejected),
        ...myReplyStationeryField(item.myReplyStationery),
      }));
  }

  /** Imported records follow normal letter deletion/clear; no separate retained import history. */
  commitImported(sent: SentLetter[], received: ReceivedLetter[], replies: LocalReply[]): void {
    const old = { sent:this.sent, received:this.received, replies:this.replies };
    this.sent=sent; this.received=received; this.replies=replies;
    this.saveLetterbook();
    if (lastStoreWriteError()) { Object.assign(this,old); throw Error('信册未能保存，原有信件没有改动。'); }
  }

  setIdentity(identity: Identity): void {
    this.identity = identity;
    writeJson(this.identityFile, identity);
  }

  /** 记下「已经看过几次海啸」。`null` 基线由 `load()` 决定，这里只写非空值。 */
  setTsunamiSeen(count: number): void {
    this.tsunamiSeen = count;
    this.saveState();
  }

  /** 又起草了一封信（被重写覆盖的也算一次）。只记次数，不记内容。 */
  bumpDraftsMade(at: number, day: string): void {
    this.draftsMade += 1;
    this.lastWrittenAt = at;
    this.writesToday = this.writeDay === day ? this.writesToday + 1 : 1;
    this.writeDay = day;
    this.saveState();
  }

  private saveState(): void {
    writeJson(this.stateFile, {
      tsunamiSeen: this.tsunamiSeen, draftsMade: this.draftsMade,
      lastWrittenAt: this.lastWrittenAt, lastCaughtAt: this.lastCaughtAt,
      writeDay: this.writeDay, writesToday: this.writesToday,
    });
  }

  noteCaught(at: number): void {
    this.lastCaughtAt = at;
    this.saveState();
  }

  markPickedNoticed(letterId: string): void {
    const letter = this.sent.find(item => item.letterId === letterId);
    if (!letter || letter.pickedNoticed) return;
    letter.pickedNoticed = true;
    this.saveLetterbook();
  }

  /** 写回信草稿（`kind` 一律按 reply 归槽）；信稿走 `setLetterDraft`。 */
  setDraft(draft: LocalDraft | null): void {
    this.draft = draft && draft.kind === 'reply' ? this.versionDraft(draft, this.draft) : null;
    this.saveDrafts();
  }

  /** 写信稿；不动回信草稿。 */
  setLetterDraft(draft: LocalDraft | null): void {
    this.letterDraft = draft && draft.kind === 'letter' ? this.versionDraft(draft, this.letterDraft) : null;
    this.saveDrafts();
  }

  private versionDraft(draft: LocalDraft, previous: LocalDraft | null): LocalDraft {
    const same = previous?.kind === draft.kind && previous.letterId === draft.letterId;
    const changed = same && (previous.body !== draft.body || previous.topic !== draft.topic ||
      JSON.stringify(previous.stationery) !== JSON.stringify(draft.stationery) || JSON.stringify(previous.source) !== JSON.stringify(draft.source) || previous.sendFailure !== draft.sendFailure);
    draft.draftId = same ? previous.draftId ?? randomUUID() : draft.draftId ?? randomUUID();
    draft.revision = same ? (previous.revision ?? 1) + (changed ? 1 : 0) : draft.revision ?? 1;
    draft.sendPolicy ??= draft.autoSendKey ? 'delayed' : 'manual';
    if (draft.sendPolicy === 'manual') { delete draft.autoSendKey; delete draft.autoSendAt; }
    return draft;
  }

  private saveDrafts(): void {
    writeJson(this.draftFile, { draft: this.draft, letterDraft: this.letterDraft });
  }

  setHeld(held: LocalHeld | null): void {
    this.held = held;
    this.saveLetterbook();
  }

  /**
   * 写盘后立刻回读确认「手里那封信」真的落盘了。
   *
   * 用于打捞与原信恢复：记录未落盘时，重启会丢失本机的手中信件。
   * 返回 `false` 时调用方应当尝试解除占用，并且只在服务端确认后清空 held；
   * 释放失败则保留内存中的信，便于人继续处理。
   */
  heldPersisted(): boolean {
    if (!this.held) return true;
    const want = this.held.letterId;
    this.saveLetterbook();
    const disk = readJson<{ held?: { letterId?: unknown } }>(this.letterbookFile);
    const got = disk?.held?.letterId;
    return typeof got === 'string' && got === want;
  }

  addReply(reply: LocalReply): void {
    if (this.replies.some((item) => item.letterId === reply.letterId)) return;
    this.replies.unshift(reply);
    this.saveLetterbook();
  }

  addSent(letter: SentLetter): void {
    if (this.sent.some((item) => item.letterId === letter.letterId)) return;
    this.sent.unshift(letter);
    this.saveLetterbook();
  }

  addReceived(letter: ReceivedLetter): void {
    const existing = this.received.find((item) => item.letterId === letter.letterId);
    if (existing) {
      // 同一封被捞到第二次（上一次放回去了）：更新正文与结局，时间留第一次
      existing.body = letter.body;
      existing.from = letter.from;
      existing.outcome = letter.outcome;
      if (letter.lastCaughtAt) existing.lastCaughtAt = letter.lastCaughtAt;
      if (letter.seed === true) existing.seed = true;
      if (letter.signature) existing.signature = letter.signature;
      if (letter.topic) existing.topic = letter.topic;
      // 再次捞到时以这一次服务端给的为准：没带装饰就清掉旧的，免得显示另一次的图。
      if (letter.stationery) existing.stationery = letter.stationery; else delete existing.stationery;
      if (letter.stationeryRejected) existing.stationeryRejected = true; else delete existing.stationeryRejected;
    } else {
      this.received.unshift(letter);
    }
    this.saveLetterbook();
  }

  /** Count shared-reading hand-offs or valid reply drafts, never failed reply attempts/page expansion. */
  noteRead(kind: 'received' | 'reply', letterId: string, at = Date.now()): void {
    const rows = kind === 'received' ? this.received : this.replies;
    const record = rows.find(item => item.letterId === letterId);
    if (!record) return;
    record.lastReadAt = at;
    record.readCount = Math.min(Number.MAX_SAFE_INTEGER, readingCount(record.readCount) + 1);
    this.saveLetterbook();
  }

  /** 记下我回过的那段正文（只用于「一起读信」的上文）。 */
  setReceivedMyReply(letterId: string, body: string, stationery?: Stationery): void {
    const hit = this.received.find((item) => item.letterId === letterId);
    if (!hit) return;
    hit.myReply = body;
    if (stationery) hit.myReplyStationery = stationery; else delete hit.myReplyStationery;
    this.saveLetterbook();
  }

  setReceivedOutcome(letterId: string, outcome: ReceivedOutcome): void {
    const hit = this.received.find((item) => item.letterId === letterId);
    if (!hit || hit.outcome === outcome) return;
    hit.outcome = outcome;
    this.saveLetterbook();
  }

  private saveLetterbook(): void {
    writeJson(this.letterbookFile, {
      held: this.held,
      replies: this.replies,
      sent: this.sent,
      received: this.received,
    });
  }

  /** WebUI 的存储页要一句实时的规模说明；起草/寄出是两个数，一眼看出漏斗卡在哪。 */
  describeStorage(): string {
    const drafts = (this.draft ? 1 : 0) + (this.letterDraft ? 1 : 0);
    // 审核通过率：分母只有客户端有（服务端看不见「起草过几次」）
    const rate = this.draftsMade > 0 ? ` · 审核通过率 ${Math.round((this.sent.length / this.draftsMade) * 100)}%` : '';
    return `起草 ${this.draftsMade} 次 · 寄出 ${this.sent.length} 封${rate} · ${drafts} 份草稿待定 · ${this.held ? 1 : 0} 封在读 · 捞到 ${this.received.length} 封 · 回信 ${this.replies.length} 封`;
  }

  /** 只清历史，不动正在写的那封与手里那封。 */
  forgetHistory(): string {
    this.sent = [];
    this.received = [];
    this.replies = [];
    this.saveLetterbook();
    this.dropCardFile();
    return '本机保存的信件记录清空了。';
  }

  /** 删掉一条记录；寄出的信连同挂在它下面的回信一起删。 */
  forgetRecord(letterId: string): string {
    const before = this.sent.length + this.received.length + this.replies.length;
    this.sent = this.sent.filter((item) => item.letterId !== letterId);
    this.received = this.received.filter((item) => item.letterId !== letterId);
    this.replies = this.replies.filter((item) => item.letterId !== letterId);
    const after = this.sent.length + this.received.length + this.replies.length;
    if (after !== before) this.saveLetterbook();
    return after === before ? '这一条已经不在了。' : '这一条记录删掉了。';
  }

  clear(): string {
    this.draft = null;
    this.letterDraft = null;
    this.held = null;
    this.replies = [];
    this.sent = [];
    this.received = [];
    writeJson(this.draftFile, { draft: null, letterDraft: null });
    this.saveLetterbook();
    this.dropCardFile();
    return '本机草稿、手里那封信和信箱都清空了；身份和服务端上的记录还在。';
  }

  /** 卡片那份 JSON 里也有正文，清记录时不能留着。 */
  private dropCardFile(): void {
    try {
      if (existsSync(this.cardFile)) unlinkSync(this.cardFile);
    } catch {
      // 删不掉下次覆盖也一样
    }
  }
}

/** 读盘时重新校验装饰；不合格的静默丢弃，正文不受影响。 */
function stationeryField(value: unknown): { stationery?: Stationery } {
  const stationery = storedStationery(value);
  return stationery === undefined ? {} : { stationery };
}
function myReplyStationeryField(value: unknown): { myReplyStationery?: Stationery } {
  const stationery = storedStationery(value);
  return stationery === undefined ? {} : { myReplyStationery: stationery };
}
function rejectedField(value: unknown): { stationeryRejected?: true } {
  if (value === true) return { stationeryRejected: true };
  return {};
}

function normalizeOutcome(value: unknown): ReceivedOutcome {
  if (value === 'caught' || value === 'replied' || value === 'dismissed' || value === 'sank' || value === 'expired' || value === 'kept') {
    return value;
  }
  // 不认识的 outcome（老存档、以后新增的）按「扔回海里」处理：
  // 它至少是「不再等回信」的语义，比默认成「还没回」安全。
  return 'dismissed';
}
