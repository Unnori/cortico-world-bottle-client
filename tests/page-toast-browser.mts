/** Isolated local-browser regression; uses the shared web-access proxy. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import { pageHtml } from '../world/page-view.ts';
import type { MailboxTheme } from '../world/theme.ts';

const theme: MailboxTheme = { available: true, palettes: Object.values(BUILTIN_PALETTES)[0] };
const snapshot = { botName: '小满', online: true, quota: { bottles_left: 2, catches_left: 5, replies_left: 0 },
  draft: null, replyDraft: null, letterDraft: null, held: null, pendingAction: null, received: [], sent: [] };
let rejectInvitation = true;
const server = createServer((req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml(theme)); return; }
  res.setHeader('content-type', 'application/json');
  const body = req.url === '/draft' ? snapshot : req.url === '/theme' ? theme : req.url === '/write'
    ? { ok: !rejectInvitation, message: rejectInvitation ? '测试邀请暂未送达。' : '测试邀请已送达。' } : {};
  res.end(JSON.stringify(body));
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const port = (server.address() as { port: number }).port;
const proxy = 'http://localhost:3456';
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
async function rpc(path: string, body?: string) {
  const res = await fetch(proxy + path, { method: body === undefined ? 'GET' : 'POST', body });
  const data = await res.json() as any;
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}
let tab: string | undefined;
async function evaluate(code: string): Promise<any> { return (await rpc('/eval?target=' + tab, code)).value; }
async function until(code: string) {
  for (let i = 0; i < 60; i++) { if (await evaluate(code)) return; await sleep(150); }
  throw new Error('Browser state did not settle: ' + code);
}
try {
  assert.equal((await rpc('/health')).connected, true);
  tab = (await rpc('/new', 'http://127.0.0.1:' + port + '/')).targetId;
  // Keep the user's tabs untouched. Only this fixture simulates visibility so
  // its deliberately visibility-gated refresh runs in the proxy's background tab.
  await evaluate("Object.defineProperty(document,'hidden',{value:false,configurable:true}); document.dispatchEvent(new Event('visibilitychange')); true");
  await until("document.getElementById('hero-note').textContent.includes('小满')");
  for (const palette of ['ocean', 'paper', 'epistle', 'coopanion']) {
    for (const mode of ['light', 'dark']) {
      await evaluate(`document.getElementById('theme-${palette}').click(); document.getElementById('mode-${mode}').click(); true`);
      await sleep(400);
      await evaluate("document.getElementById('write-button').click(); true");
      await until("document.getElementById('toast').className==='toast on bad'");
      await sleep(400);
      const colors = await evaluate("(()=>{var s=getComputedStyle(document.getElementById('toast'));return [s.backgroundColor,s.color];})()");
      await until("!document.getElementById('toast').classList.contains('on')");
      const fading = await evaluate("(()=>{var n=document.getElementById('toast'),s=getComputedStyle(n);return {bad:n.classList.contains('bad'),colors:[s.backgroundColor,s.color]};})()");
      assert.equal(fading.bad, true, `${palette}/${mode}: fade retains error class`);
      assert.deepEqual(fading.colors, colors, `${palette}/${mode}: fade retains error colors`);
      console.log(`PASS: ${palette}/${mode} error toast fade`);
    }
  }
  rejectInvitation = false;
  await evaluate("document.getElementById('write-button').click(); true");
  await until("document.getElementById('toast').className==='toast on'");
  assert.equal(await evaluate("document.getElementById('toast').textContent"), '测试邀请已送达。');
  console.log('PASS: success following error restores normal toast tone.');
} finally {
  if (tab) await rpc('/close?target=' + tab).catch(() => undefined);
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
}
