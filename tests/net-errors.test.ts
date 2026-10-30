/**
 * 网络失败的文案：每一条都与错误码一一对应，所以这句话本身就是诊断码。
 * 这里逐条钉住，改文案就等于是改诊断含义，必须是有意为之。
 */
import { describe, expect, it } from 'vitest';
import { describeNetworkError } from '../world/client.ts';

/** 造一个和 undici 一样形状的失败：外层 TypeError，内层 cause 带 code。 */
function fetchFailure(code: string): Error {
  const cause = Object.assign(new Error(`connect ${code}`), { code });
  return Object.assign(new TypeError('fetch failed'), { cause });
}

describe('网络失败的文案', () => {
  const table: Array<[string, string]> = [
    ['ENOTFOUND', '咦，海在哪里呢？（这个名字没能找到）'],
    ['EAI_AGAIN', '问路的人还没回来，海的名字一时没问到。'],
    ['ECONNREFUSED', '海边的某个地方似乎不给进……'],
    ['ECONNRESET', '刚靠岸就被推开了。'],
    ['EHOSTUNREACH', '那条路根本走不到海边。'],
    ['ENETUNREACH', '这里似乎没有通往海的路。'],
    ['ETIMEDOUT', '海迟迟没有回应你……'],
    ['UND_ERR_CONNECT_TIMEOUT', '海迟迟没有回应你……'],
    ['UND_ERR_HEADERS_TIMEOUT', '海边收下了，却一直没回话。'],
    ['UND_ERR_BODY_TIMEOUT', '海边的话说到一半就断了。'],
    ['CERT_HAS_EXPIRED', '海边的凭证过期了——不是你的问题。'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', '一个认不出的印章挡住了路。'],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', '一个认不出的印章挡住了路。'],
    ['SELF_SIGNED_CERT_IN_CHAIN', '一个认不出的印章挡住了路。'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', '一个认不出的印章挡住了路。'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', '名字对不上：那边写的不是这片海。'],
    ['EPROTO', '刚要说上话，两边就说岔了。'],
  ];

  for (const [code, text] of table) {
    it(`${code} → ${text}`, () => {
      expect(describeNetworkError(fetchFailure(code))).toBe(text);
    });
  }

  it('同一句文案不会被两个不同原因的组混淆（超时组除外，它们本就是一类）', () => {
    const texts = table.map(([, text]) => text);
    const unique = new Set(texts);
    // 多码同文只出现在「超时」（2 个码）与「证书认不出」（4 个码）这两组 → 共 4 处重复
    expect(texts.length - unique.size).toBe(4);
  });

  it('聚合错误里取第一条能认出的码', () => {
    const cause = Object.assign(new Error('all failed'), {
      errors: [Object.assign(new Error('v6'), { code: 'ENETUNREACH' }), Object.assign(new Error('v4'), { code: 'ENOTFOUND' })],
    });
    expect(describeNetworkError(Object.assign(new TypeError('fetch failed'), { cause }))).toBe(
      '这里似乎没有通往海的路。',
    );
  });

  it('超时（没有 code 只有名字）也说超时', () => {
    const error = new Error('timeout');
    error.name = 'TimeoutError';
    expect(describeNetworkError(error)).toBe('海迟迟没有回应你……');
  });

  it('认不出的原因不瞎猜', () => {
    expect(describeNetworkError(fetchFailure('ESOMETHING_NEW'))).toBe('没能到海边，也不知道卡在哪了。');
    expect(describeNetworkError(new Error('boom'))).toBe('没能到海边，也不知道卡在哪了。');
  });

  it('不是错误对象也不炸', () => {
    expect(describeNetworkError(undefined)).toBe('没能到海边，也不知道卡在哪了。');
    expect(describeNetworkError('nope')).toBe('没能到海边，也不知道卡在哪了。');
  });
});
