/**
 * 本机留的东西。全部是「环境状态」：草稿、手里那封信、信箱里的回信、这台机器的身份。
 * 没有一条属于人格记忆——丢了最多是这封没寄出去，不会改变它是谁。
 *
 * 文件名都以 `bottle-` 开头：`ctx.dataDir` 是 Core 和所有 World 共用的。
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type DraftKind = 'letter' | 'reply';

export interface LocalDraft {
  kind: DraftKind;
  /** kind 为 reply 时，这是被回的那一封。 */
  letterId?: string;
  body: string;
  at: number;
}

/** 捞起来、还没决定的那一封。正文只给页面看，永远不进工具回执。 */
export interface LocalHeld {
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
  /** 种子信的落款与主题，只在显示时用。 */
  signature?: string;
  topic?: string;
}
/** 别人回给我的一封。只读，没有选项。 */
export interface LocalReply {
  letterId: string;
  from: string;
  body: string;
  at: number;
}

/** 我寄出去的信。留一份在本地，网页上才看得到自己写过什么。 */
export interface SentLetter {
  letterId: string;
  body: string;
  at: number;
}

export type ReceivedOutcome = 'caught' | 'replied' | 'dismissed' | 'sank' | 'expired' | 'kept';

/** 我捞到过的信。outcome 记的是这件事最后怎么收场。 */
export interface ReceivedLetter {
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
}

export interface Identity {
  clientId: string;
  pseudonym: string;
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } catch {
    // 写不进去不影响主流程；下一次动作还会再写一次
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
    const id = readJson<Partial<Identity>>(this.identityFile);
    if (id && typeof id.clientId === 'string' && id.clientId) {
      this.identity = { clientId: id.clientId, pseudonym: typeof id.pseudonym === 'string' ? id.pseudonym : '' };
    }

    const state = readJson<{ tsunamiSeen?: unknown; draftsMade?: unknown }>(this.stateFile);
    this.tsunamiSeen = typeof state?.tsunamiSeen === 'number' ? state.tsunamiSeen : null;
    this.draftsMade = typeof state?.draftsMade === 'number' && state.draftsMade >= 0 ? Math.floor(state.draftsMade) : 0;

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
        ...(kind === 'reply' && typeof value.letterId === 'string' ? { letterId: value.letterId } : {}),
        body: value.body,
        at: Number(value.at ?? 0),
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
        caughtAt: Number(held.caughtAt ?? 0),
        windowUntil: Number(held.windowUntil ?? 0),
        ...(held.seed === true ? { seed: true } : {}),
        ...(held.dead === true ? { dead: true } : {}),
        ...(typeof held.signature === 'string' && held.signature ? { signature: held.signature } : {}),
        ...(typeof held.topic === 'string' && held.topic ? { topic: held.topic } : {}),
      };
    }
    const replies = Array.isArray(book?.replies) ? book.replies : [];
    this.replies = replies
      .filter((item): item is Partial<LocalReply> & { letterId: string; body: string } =>
        typeof item?.letterId === 'string' && typeof item.body === 'string')
      .map((item) => ({
        letterId: item.letterId,
        from: typeof item.from === 'string' ? item.from : '一位陌生人',
        body: item.body,
        at: Number(item.at ?? 0),
      }));

    const sent = Array.isArray(book?.sent) ? book.sent : [];
    this.sent = sent
      .filter((item): item is Partial<SentLetter> & { letterId: string; body: string } =>
        typeof item?.letterId === 'string' && typeof item.body === 'string')
      .map((item) => ({ letterId: item.letterId, body: item.body, at: Number(item.at ?? 0) }));

    const received = Array.isArray(book?.received) ? book.received : [];
    this.received = received
      .filter((item): item is Partial<ReceivedLetter> & { letterId: string; body: string } =>
        typeof item?.letterId === 'string' && typeof item.body === 'string')
      .map((item) => ({
        letterId: item.letterId,
        from: typeof item.from === 'string' ? item.from : '一位陌生人',
        body: item.body,
        at: Number(item.at ?? 0),
        outcome: normalizeOutcome(item.outcome),
        ...(item.seed === true ? { seed: true } : {}),
        ...(typeof item.myReply === 'string' && item.myReply ? { myReply: item.myReply } : {}),
        ...(typeof item.signature === 'string' && item.signature ? { signature: item.signature } : {}),
        ...(typeof item.topic === 'string' && item.topic ? { topic: item.topic } : {}),
      }));
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
  bumpDraftsMade(): void {
    this.draftsMade += 1;
    this.saveState();
  }

  private saveState(): void {
    writeJson(this.stateFile, { tsunamiSeen: this.tsunamiSeen, draftsMade: this.draftsMade });
  }

  /** 写回信草稿（`kind` 一律按 reply 归槽）；信稿走 `setLetterDraft`。 */
  setDraft(draft: LocalDraft | null): void {
    this.draft = draft && draft.kind === 'reply' ? draft : null;
    this.saveDrafts();
  }

  /** 写信稿；不动回信草稿。 */
  setLetterDraft(draft: LocalDraft | null): void {
    this.letterDraft = draft && draft.kind === 'letter' ? draft : null;
    this.saveDrafts();
  }

  private saveDrafts(): void {
    writeJson(this.draftFile, { draft: this.draft, letterDraft: this.letterDraft });
  }

  setHeld(held: LocalHeld | null): void {
    this.held = held;
    this.saveLetterbook();
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
      if (letter.seed === true) existing.seed = true;
      if (letter.signature) existing.signature = letter.signature;
      if (letter.topic) existing.topic = letter.topic;
    } else {
      this.received.unshift(letter);
    }
    this.saveLetterbook();
  }

  /** 记下我回过的那段正文（只用于「一起读信」的上文）。 */
  setReceivedMyReply(letterId: string, body: string): void {
    const hit = this.received.find((item) => item.letterId === letterId);
    if (!hit || hit.myReply === body) return;
    hit.myReply = body;
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

function normalizeOutcome(value: unknown): ReceivedOutcome {
  if (value === 'caught' || value === 'replied' || value === 'dismissed' || value === 'sank' || value === 'expired' || value === 'kept') {
    return value;
  }
  // 不认识的 outcome（老存档、以后新增的）按「扔回海里」处理：
  // 它至少是「不再等回信」的语义，比默认成「还没回」安全。
  return 'dismissed';
}
