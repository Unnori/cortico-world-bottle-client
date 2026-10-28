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
  ThrowRes,
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

  throwLetter(body: string): Promise<ThrowRes> {
    return this.call<ThrowRes>('POST', '/throw', { body });
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

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return '海边太久没回音。';
    return '连不上海边。';
  }
  return '连不上海边。';
}
