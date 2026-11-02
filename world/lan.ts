/** Optional authenticated listener. Loopback and the pure mailbox routes remain unchanged. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { pageHandler, readBody, type PageDeps, type PageServer } from './page.ts';

export const LAN_SECRET = 'BOTTLE_LAN_PAIRING_TOKEN';
const YEAR = 365 * 24 * 60 * 60;
export const newPairingToken = (): string => randomBytes(32).toString('base64url');

export function publicOrigin(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || value.length > 1024)
      throw new Error();
    return url.origin + '/';
  } catch { throw new Error('对外访问地址须为 http://主机:端口/ 或 https://域名/，不能含路径、账号或查询参数。'); }
}

export function lanUrls(port: number, advertised?: string, interfaces = networkInterfaces()): string[] {
  const urls = new Set<string>();
  const external = publicOrigin(advertised ?? '');
  if (external) urls.add(external);
  for (const addresses of Object.values(interfaces)) {
    for (const item of addresses ?? []) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')) urls.add(`http://${item.address}:${port}/`);
    }
  }
  return [...urls];
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Kept in secret storage; only signed session cookies leave the pairing endpoint. */
export class LanPairing {
  constructor(private token: string, private readonly now: () => number = Date.now) {}
  rotate(token: string): void { this.token = token; }
  accepts(token: unknown): boolean { return typeof token === 'string' && same(token, this.token); }
  private sign(expires: string): string { return createHmac('sha256', this.token).update('bottle-session:' + expires).digest('base64url'); }
  issue(): string {
    const expires = String(Math.floor(this.now() / 1000) + YEAR);
    return expires + '.' + this.sign(expires);
  }
  valid(value: string): boolean {
    const [expires, signature, extra] = value.split('.');
    return !extra && /^\d{10,12}$/.test(expires ?? '') && Number(expires) > this.now() / 1000 &&
      typeof signature === 'string' && same(signature, this.sign(expires!));
  }
  async cards(urls: string[]): Promise<Array<{ url: string; qr: string }>> {
    return Promise.all(urls.map(async base => {
      // Fragments are not sent in HTTP requests or Referer headers.
      const url = new URL('pair', base); url.hash = this.token;
      return { url: url.href, qr: await QRCode.toDataURL(url.href, { width: 280, margin: 4, errorCorrectionLevel: 'M' }) };
    }));
  }
}

const PAIR_HTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>把信箱带在身边</title>
<style>:root{color-scheme:light dark}body{font:16px/1.8 system-ui;margin:12vh auto;padding:24px;max-width:440px}input,button{font:inherit;padding:10px;box-sizing:border-box;width:100%;margin:8px 0}#warning{color:#b42332;color:light-dark(#b42332,#ff9ca4)}</style>
<h1>把信箱带在身边</h1><p id="message">请扫描 World 信箱页的二维码，或粘贴配对令牌。</p><p id="warning">HTTP 裸端口会明文传输信件和配对凭据。只在你信任的网络中使用；公网建议配置 HTTPS。</p>
<form id="pair"><input id="token" type="password" aria-label="配对令牌" autocomplete="off" maxlength="100" required><button>配对并打开信箱</button></form>
<script>
const token=document.getElementById('token'), message=document.getElementById('message'), form=document.getElementById('pair');
const scanned=location.hash.slice(1); history.replaceState(null,'',location.pathname); token.value=scanned;
if(location.protocol==='https:') document.getElementById('warning').hidden=true;
let pending=false;
async function pair(){if(pending)return;pending=true;form.querySelector('button').disabled=true;
try{const res=await fetch('/pair',{method:'POST',headers:{'content-type':'application/json','x-bottle':'1'},body:JSON.stringify({token:token.value})});if(!res.ok)throw Error();token.value='';location.replace('/');}
catch{message.textContent='配对未成功，请使用信箱页当前的二维码再试一次。';}
finally{pending=false;form.querySelector('button').disabled=false;}}
form.addEventListener('submit',event=>{event.preventDefault();void pair();});if(scanned)void pair();
</script></html>`;

export interface LanServer extends PageServer { urls: string[] }

export async function startLanServer(deps: PageDeps, opts: {
  port: number; advertised?: string; pairing: LanPairing; log?: (line: string) => void;
}): Promise<LanServer> {
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535 || opts.port === 7797) throw new Error('请选择可用的对外端口（不能是 7797）。');
  publicOrigin(opts.advertised ?? ''); // Validate before opening a socket.
  const shared = pageHandler(deps, opts.log, true);
  let urls: string[] = [], allowedHosts = new Set<string>(), cookieName = '';
  const reply = (res: ServerResponse, status: number, message: string): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, message }));
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    if (!req.headers.host || !allowedHosts.has(req.headers.host.toLowerCase())) { req.resume(); reply(res, 421, '请使用信箱页列出的访问地址。'); return; }
    const route = (req.url ?? '/').split('?')[0];
    const method = req.method ?? 'GET';
    const origin = req.headers.origin;
    const sameOrigin = origin === `http://${req.headers.host}` || urls.some(url => new URL(url).origin === origin && new URL(url).host === req.headers.host);
    if (method !== 'GET' && method !== 'HEAD' && (req.headers['x-bottle'] !== '1' || !sameOrigin)) {
      req.resume(); reply(res, 403, '请在已配对的信箱页操作。'); return;
    }
    if (method === 'GET' && route === '/pair') {
      req.resume(); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
      res.end(PAIR_HTML); return;
    }
    if (method === 'POST' && route === '/pair') {
      void readBody(req).then(body => {
        if (!body.ok) { reply(res, 400, '配对请求无效。'); return; }
        const token = (body.value as { token?: unknown } | null)?.token;
        if (!opts.pairing.accepts(token)) { reply(res, 401, '配对令牌无效，请重新扫码。'); return; }
        const secure = origin?.startsWith('https://') ? '; Secure' : '';
        res.setHeader('set-cookie', `${cookieName}=${opts.pairing.issue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${YEAR}${secure}`);
        reply(res, 200, '已配对。');
      }).catch(() => { if (!res.headersSent) reply(res, 500, '配对暂时不可用。'); });
      return;
    }
    const cookie = (req.headers.cookie ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
    if (!opts.pairing.valid(cookie)) {
      req.resume();
      if (method === 'GET' && route === '/') { res.writeHead(303, { location: '/pair' }); res.end(); }
      else reply(res, 401, '请先扫描 World 信箱页上的二维码配对。');
      return;
    }
    shared(req, res);
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(opts.port, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); }); });
  } catch (error) { server.close(); throw error; }
  const port = (server.address() as { port: number }).port;
  urls = lanUrls(port, opts.advertised);
  allowedHosts = new Set([...urls.map(url => new URL(url).host.toLowerCase()), `127.0.0.1:${port}`]);
  cookieName = `bottle_lan_${port}`;
  server.unref();
  return { port, url: urls[0] ?? '', urls, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
