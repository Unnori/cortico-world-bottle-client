/**
 * 给调试页拍照：开一个无头 Chrome，跑一遍场景，把截图存到 scratch/dev-shots/。
 *
 *   pnpm dev:mailbox            # 在另一个终端开着
 *   node scripts/dev-shots.mjs  # 拍全部场景
 *   node scripts/dev-shots.mjs notes 7801 1400   # 只拍 notes，指定端口和宽度
 *
 * 只连 127.0.0.1 的调试页，不碰真实信箱、不碰 Coopanion。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.argv[3] ?? 7801);
const WIDTH = Number(process.argv[4] ?? 1400);
// 可选参数：主题（ocean/paper/epistle/coopanion）与左侧留白，用来在指定主题下看图
//   node scripts/dev-shots.mjs notes 7801 1400 epistle 430
const THEME = process.argv[5] ?? null;
const MIND = Number(process.argv[6] ?? 430);
// 调试页把主题偏好存成页面里的 prefs；没有 __dev/prefs 时退回点击主题按钮。
const only = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : null;
const OUT = resolve(import.meta.dirname, '..', 'scratch', 'dev-shots');

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const browser = CANDIDATES.find(path => existsSync(path));
if (!browser) { console.error('找不到 Chrome 或 Edge。'); process.exit(1); }

const profile = join(tmpdir(), `bottle-shot-${process.pid}`);
mkdirSync(OUT, { recursive: true });

const child = spawn(browser, [
  '--headless=new', '--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=0`, '--remote-allow-origins=*', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((done, fail) => {
  let buffered = '';
  const timer = setTimeout(() => fail(new Error('Chrome 没有在 15 秒内给出调试地址')), 15_000);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    buffered += chunk;
    const match = /ws:\/\/[^\s]+/.exec(buffered);
    if (match) { clearTimeout(timer); done(match[0]); }
  });
  child.once('exit', code => { clearTimeout(timer); fail(new Error(`Chrome 退出 ${code}`)); });
});

let nextId = 1;
const pending = new Map();
const socket = new WebSocket(wsUrl);
await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const waiter = message.id && pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.fail(new Error(message.error.message));
  else waiter.done(message.result);
};
const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
  const id = nextId++;
  pending.set(id, { done, fail });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: WIDTH < 700 }, sessionId);

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

const scenes = only ?? Object.keys(await (await fetch(`http://127.0.0.1:${PORT}/__dev/scenes`)).json());

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sessionId);
await sleep(1200);

const errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
});

for (const scene of scenes) {
  await fetch(`http://127.0.0.1:${PORT}/__dev/scene/${encodeURIComponent(scene)}`, { method: 'POST' });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sessionId);
  await sleep(700);
  if (THEME) {
    // 调试页每次都从海洋主题开始；走一遍真实的外观菜单，顺带验证这一项还在。
    const picked = await evaluate(`(()=>{document.getElementById('theme-toggle').onclick();const b=document.getElementById('theme-${THEME}');if(!b)return 'missing';b.onclick();return document.documentElement.dataset.theme})()`);
    if (picked !== THEME) throw new Error(`主题没有切换成 ${THEME}：${picked}`);
    await sleep(400);
  }
  // 页面刚渲染时 attachPapers 会重建邮件列表，等它稳定下来再展开，否则纸条会被摘下来
  await sleep(900);
  await evaluate(`document.querySelectorAll('#mail-list details').forEach(d=>{d.open=true;});true`);
  await sleep(700);
  const height = await evaluate('Math.min(document.documentElement.scrollHeight, 6000)');
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 } }, sessionId);
  const file = join(OUT, `${scene}-${WIDTH}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  const box = await evaluate(`(()=>{const s=document.querySelector('.paper-slot .paper-slip');if(!s)return null;const r=s.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y+scrollY),w:Math.round(r.width),h:Math.round(r.height)})})()`);
  // 另外拍几张「看图用」的视口截图：页首、纸条所在的区域（连便利贴的胶带一起框进来）
  const shots = box ? [['top', 0], ['notes', Math.max(0, JSON.parse(box).y - 260)], ['slip', Math.max(0, JSON.parse(box).y - 40)]] : [['top', 0]];
  for (const [name, y] of shots) {
    const clip = name === 'slip'
      ? { x: Math.max(0, JSON.parse(box).x - MIND), y, width: Math.max(320, WIDTH - Math.max(0, JSON.parse(box).x - MIND) - 40), height: Math.min((box ? JSON.parse(box).h : 400) + 220, height - y), scale: 1 }
      : { x: 0, y, width: WIDTH, height: Math.min(1000, height - y), scale: 1 };
    const view = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip }, sessionId);
    writeFileSync(join(OUT, `${scene}-${WIDTH}-${name}.png`), Buffer.from(view.data, 'base64'));
  }
  console.log(`${scene.padEnd(16)} → ${file}${box ? '  纸条位置 ' + box : ''}`);
}

console.log(errors.length ? `页面报错 ${errors.length} 处：\n${errors.join('\n')}` : '页面没有 JS 报错。');

await send('Browser.close').catch(() => {});
child.kill();
await sleep(200);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 浏览器还没完全退出，留个临时目录 */ }
process.exit(0);
