/** Narrow agent API. This is loopback authentication, not an operating-system sandbox. */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody } from './page.ts';
import { isDraftRef, type DraftRef } from './drafts.ts';

export const BRIDGE_SECRET = 'BOTTLE_BRIDGE_TOKEN';
export const BRIDGE_CONTROLLER_SECRET = 'BOTTLE_BRIDGE_CONTROLLER_TOKEN';
export const BRIDGE_BODY_MAX = 40 * 1024;
export interface BridgeDraftInput {
  body: string; topic?: string; stationery?: unknown; source: string; replace?: DraftRef;
}
export interface BridgeResult { status: number; json: Record<string, unknown> }
export interface BridgeDeps {
  enabled(): boolean;
  token(): string;
  status(): Record<string, unknown>;
  createDraft(input: BridgeDraftInput): Promise<BridgeResult>;
  catchOne(source: string): Promise<BridgeResult>;
  controllerEnabled(): boolean;
  controllerToken(): string;
  controller(action: string, input: Record<string,unknown>): Promise<BridgeResult>;
}
const failure = (status: number, error: string, message: string): BridgeResult => ({status,json:{ok:false,error,message}});
function sourceName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Called only after transport authentication, with an allowlist of operations and fields. */
export async function routeBridge(deps: BridgeDeps, method: string, route: string, body: unknown, scope: 'agent' | 'controller' = 'agent'): Promise<BridgeResult> {
  if (!deps.enabled()) return failure(404,'disabled','Bridge 未开启。');
  if (route === '/api/v1/controller' || route.startsWith('/api/v1/controller/')) {
    if (!deps.controllerEnabled()) return failure(404,'disabled','Controller 未开启。');
    if (scope !== 'controller') return failure(401,'unauthorized','此操作需要独立的 Controller 凭证。');
    if (route === '/api/v1/controller/status') return method === 'GET'
      ? deps.controller('status',{}) : failure(405,'method','请使用 GET。');
    const preview = /^\/api\/v1\/controller\/drafts\/([A-Za-z0-9_-]{1,128})$/.exec(route);
    if (preview) return method === 'GET' ? deps.controller('preview',{draftId:preview[1]}) : failure(405,'method','请使用 GET。');
    const action=route.slice('/api/v1/controller/'.length);
    if (!['send','reply','together','rewrite','discard','return','keep'].includes(action)) return failure(404,'not_found','没有这个 Controller 接口。');
    if (method !== 'POST') return failure(405,'method','请使用 POST。');
    if (!record(body) || !sourceName(body.source)) return failure(400,'invalid_source','请提供真实控制端来源 source。');
    if (['send','rewrite','discard'].includes(action)) {
      if (!isDraftRef(body) || Object.keys(body).some(k=>!['source','draftId','revision','kind'].includes(k)) ||
        body.kind !== undefined && body.kind !== 'letter' && body.kind !== 'reply')
        return failure(400,'invalid_confirmation','必须指定确切草稿和当前版本；确认时不能提交新正文。');
    } else if (typeof body.letterId !== 'string' || !body.letterId || body.letterId.length>256 ||
      /[\u0000-\u001f\u007f]/.test(body.letterId) || Object.keys(body).some(k=>!['source','letterId'].includes(k)))
      return failure(400,'invalid_target','必须指定唯一信件 letterId。');
    return deps.controller(action,{...body,source:body.source.trim()});
  }
  if (scope !== 'agent') return failure(401,'unauthorized','此入口使用普通 Bridge 凭证。');
  if (route === '/api/v1/status') return method === 'GET'
    ? {status:200,json:{ok:true,...deps.status()}} : failure(405,'method','请使用 GET。');
  if (route !== '/api/v1/drafts' && route !== '/api/v1/catch') return failure(404,'not_found','没有这个 Bridge 接口。');
  if (method !== 'POST') return failure(405,'method','请使用 POST。');
  if (!record(body) || !sourceName(body.source)) return failure(400,'invalid_source','请提供真实的外部程序来源 source（1—64 字）。');
  if (route === '/api/v1/catch') {
    if (Object.keys(body).some(k => k !== 'source')) return failure(400,'invalid_request','打捞仅接受 source，不接受正文或配置。');
    return deps.catchOne(body.source.trim());
  }
  if (Object.keys(body).some(k => !['body','topic','stationery','source','replace'].includes(k)) ||
    typeof body.body !== 'string' || body.topic !== undefined && typeof body.topic !== 'string' ||
    body.replace !== undefined && (!isDraftRef(body.replace) || Object.keys(body.replace as object).some(k => !['draftId','revision'].includes(k))))
    return failure(400,'invalid_request','草稿只接受 body、topic、stationery、source 和明确的 replace 版本。');
  return deps.createDraft(body as unknown as BridgeDraftInput);
}

export function serveBridge(deps: BridgeDeps | undefined, req: IncomingMessage, res: ServerResponse, remote: boolean): void {
  const reply = (result: BridgeResult): void => {
    const text = JSON.stringify(result.json);
    res.writeHead(result.status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(text),
      'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    res.end(text);
  };
  if (remote || !deps?.enabled()) { req.resume(); reply(failure(404,'disabled','这里没有 Bridge 接口。')); return; }
  const port = req.socket.localPort;
  if (![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host ?? '') || req.headers.origin ||
    req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'none') {
    req.resume(); reply(failure(403,'origin','Bridge 只供本机外部程序访问，不接受网页跨源请求。')); return;
  }
  const route = (req.url ?? '').split('?')[0]!;
  const scope = route === '/api/v1/controller' || route.startsWith('/api/v1/controller/') ? 'controller' : 'agent';
  if (scope === 'controller' && !deps.controllerEnabled()) {req.resume();reply(failure(404,'disabled','Controller 未开启。'));return;}
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = scope === 'controller' ? deps.controllerToken() : deps.token();
  const left = Buffer.from(token), right = Buffer.from(expected);
  if (!expected || left.length !== right.length || !timingSafeEqual(left,right)) {
    req.resume(); reply(failure(401,'unauthorized','请使用专用 Bridge Bearer 凭证。')); return;
  }
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'POST') req.resume();
  void readBody(req,BRIDGE_BODY_MAX).then(read => read.ok
    ? routeBridge(deps,method,route,read.value,scope)
    : failure(400,'invalid_json','JSON 无效或请求超过 40 KiB，未执行动作。'))
    .then(reply).catch(() => reply(failure(503,'unavailable','Bridge 暂不可用，未确认的动作请先核对状态。')));
}
