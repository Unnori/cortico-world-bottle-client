/**
 * 服务端 HTTP 客户端。World 唯一对外发请求的地方。
 *
 * 只对 GET 和网络错误重试：POST 重试会多用一只瓶子、或者把一封信寄两遍。
 */
import type {
  CatchRes,
  DismissRes,
  ErrorCode,
  LetterRes,
  MailboxRes,
  MailTakeRes,
  OkRes,
  Quota,
  RegisterRes,
  ThrowResult,
} from '../shared/contract.ts';

export class BottleError extends Error {
  constructor(
    readonly code: ErrorCode | 'network',
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BottleClientOptions {
  base: string;
  /** 每次现取：token 可能在运行中被写入 .env。 */
  token: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 重试间隔；测试里传 [] 关掉等待。 */
  retryDelaysMs?: number[];
}

const RETRY_DELAYS = [800, 2400];

export class BottleClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelays: number[];

  constructor(private readonly opts: BottleClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS;
  }

  private url(path: string): string {
    return `${this.opts.base.replace(/\/+$/, '')}${path}`;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const attempts = method === 'GET' ? this.retryDelays.length + 1 : 1;
    let last: BottleError | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(this.retryDelays[attempt - 1] ?? 800);
      try {
        return await this.once<T>(method, path, body);
      } catch (error) {
        const wrapped = toBottleError(error);
        last = wrapped;
        if (wrapped.code !== 'network') throw wrapped;
      }
    }
    throw last ?? new BottleError('network', 0, '连不上海边。');
  }

  private async once<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const token = this.opts.token();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new BottleError('network', 0, describeNetworkError(error));
    }

    const text = await response.text();
    let parsed: unknown = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new BottleError('network', response.status, '海边回来的东西看不懂。');
      }
    }

    if (!response.ok) {
      const payload = parsed as { error?: ErrorCode; message?: string };
      throw new BottleError(payload.error ?? 'internal', response.status, payload.message ?? `海边出了点问题（${response.status}）。`);
    }
    return parsed as T;
  }

  register(hash: string): Promise<RegisterRes> {
    return this.call<RegisterRes>('POST', '/register', { hash });
  }

  throwLetter(body: string, topic?: string): Promise<ThrowResult> {
    return this.call<ThrowResult>('POST', '/throw', { body, ...(topic ? { topic } : {}) });
  }

  catchOne(): Promise<CatchRes> {
    return this.call<CatchRes>('POST', '/catch', {});
  }

  letter(letterId: string): Promise<LetterRes> {
    return this.call<LetterRes>('GET', `/letter/${encodeURIComponent(letterId)}`);
  }

  reply(letterId: string, body: string): Promise<OkRes> {
    return this.call<OkRes>('POST', '/reply', { letterId, body });
  }

  dismiss(letterId: string): Promise<DismissRes> {
    return this.call<DismissRes>('POST', '/dismiss', { letterId });
  }

  mailbox(): Promise<MailboxRes> {
    return this.call<MailboxRes>('GET', '/mailbox');
  }

  /** 系统邮件（海边邮局）走独立通道：不占捞取额度。 */
  takeSystemMail(): Promise<MailTakeRes> {
    return this.call<MailTakeRes>('POST', '/mail/take', {});
  }

  quota(): Promise<Quota> {
    return this.call<Quota>('GET', '/quota');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBottleError(error: unknown): BottleError {
  if (error instanceof BottleError) return error;
  return new BottleError('network', 0, describeNetworkError(error));
}

/**
 * 网络失败时说什么。
 *
 * 每一条都与错误码一一对应，所以**这句文案本身就是诊断码**：
 * 用户把这句话念出来，就能反推出卡在哪一步，不必让他翻日志。
 */
const NET_ERROR_TEXT: Readonly<Record<string, string>> = {
  // 域名解析
  ENOTFOUND: '咦，海在哪里呢？（这个名字没能找到）',
  EAI_AGAIN: '问路的人还没回来，海的名字一时没问到。',
  // 连不上 / 被截断
  ECONNREFUSED: '海边的某个地方似乎不给进……',
  ECONNRESET: '刚靠岸就被推开了。',
  EHOSTUNREACH: '那条路根本走不到海边。',
  ENETUNREACH: '这里似乎没有通往海的路。',
  // 等待超时
  ETIMEDOUT: '海迟迟没有回应你……',
  UND_ERR_CONNECT_TIMEOUT: '海迟迟没有回应你……',
  UND_ERR_HEADERS_TIMEOUT: '海边收下了，却一直没回话。',
  UND_ERR_BODY_TIMEOUT: '海边的话说到一半就断了。',
  // 证书
  CERT_HAS_EXPIRED: '海边的凭证过期了——不是你的问题。',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '一个认不出的印章挡住了路。',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: '一个认不出的印章挡住了路。',
  SELF_SIGNED_CERT_IN_CHAIN: '一个认不出的印章挡住了路。',
  DEPTH_ZERO_SELF_SIGNED_CERT: '一个认不出的印章挡住了路。',
  ERR_TLS_CERT_ALTNAME_INVALID: '名字对不上：那边写的不是这片海。',
  EPROTO: '刚要说上话，两边就说岔了。',
};

/** 从 fetch 的错误里挖出最内层的错误码（undici 会把它塞在 cause 里，可能是聚合错误）。 */
function networkCode(error: unknown): string {
  const dig = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const value = node as { code?: unknown; errors?: unknown };
    if (typeof value.code === 'string' && value.code) return value.code;
    if (Array.isArray(value.errors)) {
      for (const sub of value.errors) {
        const found = dig(sub);
        if (found) return found;
      }
    }
    return '';
  };
  return dig((error as { cause?: unknown } | null)?.cause) || dig(error);
}

export function describeNetworkError(error: unknown): string {
  const code = networkCode(error);
  const mapped = NET_ERROR_TEXT[code];
  if (mapped) return mapped;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return '海迟迟没有回应你……';
  }
  return '没能到海边，也不知道卡在哪了。';
}
