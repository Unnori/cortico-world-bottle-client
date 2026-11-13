/**
 * 本地信箱调试页。
 *
 *   pnpm dev:mailbox           # 打开 http://127.0.0.1:7801/
 *   pnpm dev:mailbox --port 7810
 *
 * 它跑的是**和生产完全一样的页面代码**（`pageHtml` + `pageHandler`），
 * 只是把 PageDeps 换成一份写在内存里的假数据：
 *
 *   - 不连海边、不读令牌、不碰 data 目录
 *   - 不写任何文件（除非 `--shots`，那是截图）
 *   - 有「场景」按钮，一键切到各种纸条/来信/回信状态
 *
 * 改 `world/page-style.ts`、`world/page-view.ts`、`world/page-extras.ts` 后
 * 浏览器会自动刷新，不用重启 World，也不用碰正在跑的 Coopanion。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { handlePage, type PageDeps, type PageSnapshot, type PageResult } from '../world/page.ts';
import type { ReceivedNote } from '../shared/contract.ts';
import type { SoftHint } from '../shared/hints.ts';
import { checkStationery } from '../shared/stationery.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── 假数据 ────────────────────────────────────────────────────────────────

const now = (): number => Date.now();
const iso = (at: number): string => new Date(at).toISOString();

let seq = 0;
const id = (prefix: string): string => `${prefix}_${(++seq).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const BOT = 'Coo';
const PEOPLE = ['海盐大福#4821', '夜航船#1187', '拾贝人#9024', '深蓝回信#3355'];

interface World {
  held: PageSnapshot['held'];
  letterDraft: PageSnapshot['letterDraft'];
  replyDraft: PageSnapshot['replyDraft'];
  noteDraft: PageSnapshot['noteDraft'];
  noteRewriting: boolean;
  sent: PageSnapshot['sent'];
  received: PageSnapshot['received'];
  notes: Array<ReceivedNote & { read: boolean }>;
  stars: NonNullable<PageSnapshot['stars']>;
  starMemoryEnabled: boolean;
  wake: PageSnapshot['wake'];
  announcement: NonNullable<PageSnapshot['announcement']> | null;
  tideOut: PageSnapshot['tideOut'];
  pendingAction: PageSnapshot['pendingAction'];
}

function blank(): World {
  return {
    held: null, letterDraft: null, replyDraft: null, noteDraft: null, noteRewriting: false,
    sent: [], received: [], notes: [], stars: [], starMemoryEnabled: false,
    wake: {
      version: 1, day: '2026-11-06', lastInviteAt: 0, active: null,
      lanes: {
        write: { nextAt: null, count: 0, paused: false, declined: false, failed: false },
        catch: { nextAt: null, count: 0, paused: false, declined: false, failed: false },
        remind: { nextAt: null, count: 0, paused: false, declined: false, failed: false },
      },
      history: [],
    } as PageSnapshot['wake'],
    announcement: null, tideOut: null, pendingAction: null,
  };
}

let world = blank();

// ── 场景 ──────────────────────────────────────────────────────────────────

const SCENES: Record<string, { label: string; apply(): void }> = {
  stationery: {
    label: '信纸排版：配色、多图与水印',
    apply() {
      world=blank();
      const art=checkStationery({v:2,paper:'plain',paperColor:'#fff8ed',decorations:[
        {doodle:'rain-cloud',color:'#638c9c',x:14,y:14,width:22,rotation:-12,opacity:.45},
        {doodle:'paper-plane',color:'#77987c',placement:'center',size:'large',rotation:10,opacity:.12},
        {doodle:'loose-daisy',color:'#bd7c90',x:84,y:86,width:20,rotation:20,opacity:.5,z:2},
        {doodle:'classic-sparkle',color:'#c99d62',x:91,y:10,width:10,layer:'front',opacity:.5},
      ]});
      if(!art.ok||!art.value)throw Error('Invalid stationery demo');
      const body='把云朵放在左上角，\n把花留在落款旁。\n今天的风有一点颜色。';
      world.letterDraft={kind:'letter',topic:'风的颜色',body,chars:[...body].length,at:now(),hints:[],stationery:art.value};
    },
  },
  empty: {
    label: '空信箱（只有一张写好的信）',
    apply() {
      world = blank();
      world.letterDraft = {
        kind: 'letter', topic: '给北边的风', at: now() - 4 * 60_000,
        body: '风从北边吹来的时候，我想起你说过的那个小镇。屋顶是铁锈红的，烟囱上停着一只灰鸽子，它每天下午三点都准时出现。\n\n我今天也准时出现了，只是不在那个屋顶上。',
        chars: 71, hints: [],
      };
      world.wake!.lanes!.write!.count = 1;
    },
  },

  caught: {
    label: '捞到一封（可以一起读）',
    apply() {
      world = heldLetter();
    },
  },

  read: {
    label: '已经共读过（可以写回信）',
    apply() {
      world = heldLetter();
      world.held!.readAt = now() - 12 * 60_000;
    },
  },

  notes: {
    label: '★ 小纸条：收到两张（一未读一已读）',
    apply() {
      world = heldLetter();
      world.received = [receivedWithNotes()];
      world.notes = [
        {
          id: 'n_welcome', letterId: 'l_caught', from: '海盐大福#4821',
          body: '你的信里有一小片海。我把它收在一只旧铁盒里了。',
          at: iso(now() - 3 * HOUR), expiresAt: iso(now() + 6 * DAY), read: false,
        },
        {
          id: 'n_older', letterId: 'l_caught', from: '海盐大福#4821',
          body: '今天风大，写信的纸差点被吹走。',
          at: iso(now() - 27 * HOUR), expiresAt: iso(now() + 6 * DAY), read: true,
        },
      ];
    },
  },

  'note-draft': {
    label: '★ 小纸条：桌宠起草了一张，等确认',
    apply() {
      world = replyFlow();
      world.noteDraft = {
        letterId: 'l_mine',
        body: '收到你的回信了。今天海面很平，像你把信折好的样子。',
        at: now() - 30_000,
      };
    },
  },

  'note-rewriting': {
    label: '★ 小纸条：桌宠正在重写',
    apply() {
      world = replyFlow();
      world.noteDraft = {
        letterId: 'l_mine',
        body: '收到你的回信了。今天海面很平，像你把信折好的样子。',
        at: now() - 30_000,
      };
      world.noteRewriting = true;
    },
  },

  reply: {
    label: '回信写好了，等决定（附两小时倒计时）',
    apply() {
      world = replyFlow();
      world.letterDraft = null;
      world.replyDraft = {
        kind: 'reply', letterId: 'l_mine', at: now() - 60_000, chars: 44, hints: [],
        autoSendPending: true, autoSendAt: now() + 108 * 60_000,
        body: '你在信里说海是慢慢变蓝的。我看了很久，确实是这样：先是白的，然后灰的，最后才是蓝的，像一个人终于决定不说话。',
      };
    },
  },

  hint: {
    label: '有提示的信稿（联系方式会被标出来）',
    apply() {
      world = blank();
      world.letterDraft = {
        kind: 'letter', topic: '想联系你', at: now() - 60_000,
        body: '如果你也想说话，可以打给我：13800138000。不过写信也挺好的，慢一点，像海。',
        chars: 36,
        hints: [{ kind: 'contact', text: '这封信里有联系方式' } as SoftHint],
      };
    },
  },

  book: {
    label: '信册有货（来客/邮局/回信/寄出/星笺全有）',
    apply() {
      world = blank();
      const t = now();
      world.received = [
        { letterId: 'l_a', from: PEOPLE[0]!, topic: '关于那只船', body: '昨天在码头看见一条旧船，船身写着别人的名字。\n\n我站了很久。\n\n—— 海盐大福#4821', at: iso(t - 2 * HOUR), outcome: 'caught', readCount: 2 },
        { letterId: 'l_b', from: PEOPLE[1]!, body: '没什么事，就是想说，今天的云很好。', at: iso(t - 2 * DAY), outcome: 'replied', readCount: 1, myReply: '云我也看到了。像一大片晾着的床单。' },
      ];
      world.sent = [
        {
          letterId: 'l_mine', topic: '窗外的雨', body: '窗外的雨下了一整晚。\n\n我把杯子放在窗台上，接了点雨水，尝了一口——有点苦。', at: iso(t - 3 * DAY), state: 'replied',
          reply: { from: PEOPLE[0]!, body: '雨水是苦的，因为天上有很多没说出口的话。', at: iso(t - 1 * DAY), readCount: 1 },
        },
        { letterId: 'l_sea', topic: '海浪', body: '今天去海边了，浪很大。', at: iso(t - 5 * DAY), state: 'picked' },
        { letterId: 'l_lost', body: '不知道这一封会到哪里去。', at: iso(t - 9 * DAY), state: 'tsunami' },
      ];
      world.received.unshift({
        letterId: 'l_seed', from: '海边邮局', topic: '群岛上的第一封信',
        body: '岛上的人说，海记得每一条被扔进去的瓶子。\n\n它们不一定被打开，但一定被记住。',
        signature: '海岛居民 · 编号 0021',
        at: iso(t - 4 * HOUR), outcome: 'kept', seed: true, readCount: 3,
      });
      world.stars = [
        { letterId: 'l_a', starredAt: t - HOUR, memorySelected: true, memoryActive: true, category: 'received', title: '关于那只船', from: PEOPLE[0]!, at: iso(t - 2 * HOUR) },
      ];
      world.notes = [{
        id: 'n_book', letterId: 'l_mine', from: PEOPLE[0]!,
        body: '雨水那一段，我读了三遍。', at: iso(t - 20 * HOUR), expiresAt: iso(t + 6 * DAY), read: false,
      }];
    },
  },

  announce: {
    label: '有公告 + 退潮提示',
    apply() {
      world = blank();
      world.announcement = {
        id: 'a_1',
        text: '海边邮局的新信箱\n\n从这周起，邮局会在每周三投递一封群岛来信。记得看看你的信箱。',
        level: 'notice',
        showUntil: iso(now() + 3 * DAY),
      };
      world.tideOut = { text: '潮水退了，今夜的潮位比往常低一些。', until: null };
    },
  },

  offline: {
    label: '离线（连不上海边）',
    apply() {
      world = blank();
      world.letterDraft = null;
    },
  },
};

function heldLetter(): World {
  const w = blank();
  w.held = {
    letterId: 'l_caught', from: PEOPLE[0]!, topic: '关于那只船',
    body: '昨天在码头看见一条旧船，船身写着别人的名字。\n\n我站了很久，想不起那是谁的名字，但记得船是深绿色的，像夏天傍晚的树影。\n\n也许我只是想找个人说说这件事。',
    hoursLeft: 19, caughtAt: now() - 5 * HOUR,
  };
  return w;
}

function receivedWithNotes(): PageSnapshot['received'][number] {
  return {
    letterId: 'l_caught', from: PEOPLE[0]!, topic: '关于那只船',
    body: '昨天在码头看见一条旧船，船身写着别人的名字。\n\n我站了很久。',
    at: iso(now() - 5 * HOUR), outcome: 'caught', readCount: 1,
  };
}

function replyFlow(): World {
  const w = blank();
  w.held = {
    letterId: 'l_mine', from: PEOPLE[0]!, topic: '窗外的雨',
    body: '窗外的雨下了一整晚。\n\n我把杯子放在窗台上，接了点雨水，尝了一口——有点苦。',
    hoursLeft: 41, caughtAt: now() - 8 * HOUR, readAt: now() - 7 * HOUR,
  };
  w.sent = [{
    letterId: 'l_mine', topic: '窗外的雨',
    body: '窗外的雨下了一整晚。\n\n我把杯子放在窗台上，接了点雨水，尝了一口——有点苦。',
    at: iso(now() - 3 * DAY), state: 'replied',
    reply: { from: PEOPLE[0]!, body: '雨水是苦的，因为天上有很多没说出口的话。', at: iso(now() - 8 * HOUR), readCount: 1 },
  }];
  w.received = [{
    letterId: 'l_mine', from: PEOPLE[0]!, topic: '窗外的雨',
    body: '雨水是苦的，因为天上有很多没说出口的话。',
    at: iso(now() - 8 * HOUR), outcome: 'replied', readCount: 1,
    myReply: '窗外的雨下了一整晚。',
  }];
  return w;
}

// ── PageDeps ──────────────────────────────────────────────────────────────

const ok = (message = ''): PageResult => ({ ok: true, message });
const fail = (message: string): PageResult => ({ ok: false, message });

const sleep = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));

function snapshot(): PageSnapshot {
  return {
    botName: BOT,
    desktopCards: false,
    draft: world.replyDraft ?? world.letterDraft ?? null,
    replyDraft: world.replyDraft,
    letterDraft: world.letterDraft,
    held: world.held,
    noteDraft: world.noteDraft,
    noteRewriting: world.noteRewriting,
    sent: world.sent,
    received: world.received,
    stars: world.stars,
    starMemoryEnabled: world.starMemoryEnabled,
    worldSession: 'dev',
    wake: world.wake,
    randomWake: true,
    cooldowns: {},
    quota: { bottles_left: 2, catches_left: 1, replies_left: 3, stationery: 1, stationery_layout: 2 },
    online: true,
    announcement: world.announcement,
    tideOut: world.tideOut,
    pendingAction: world.pendingAction,
    canReply: true,
    localFile: '(调试页：内存里的假信册)',
    fontResources: {},
    defaultFont: undefined,
  };
}

const deps: PageDeps = {
  snapshot,
  theme: async () => ({ available: false }),
  appearance: async (preference) => ({
    preference: preference ?? { theme: 'ocean', mode: 'system' },
    palettes: await paletteFor(preference?.customColor ?? '#4b62a0'),
  } as never),
  announcement: async () => world.announcement,
  refresh: async () => { /* 调试页不往海边跑 */ },

  notes: async () => world.notes,
  readNote: async (noteId) => {
    const note = world.notes.find(row => row.id === noteId);
    if (!note) return fail('找不到这张小纸条。');
    note.read = true;
    await sleep(220);
    return ok(`${BOT}读过了这张小纸条。`);
  },
  ackNote: async () => ok(),
  note: async (letterId) => {
    if (!world.noteDraft || world.noteDraft.letterId !== letterId) return fail('没有可寄出的小纸条，请先邀请起草。');
    await sleep(320);
    world.noteDraft = null;
    world.noteRewriting = false;
    return ok('小纸条已寄给回信的那位。');
  },
  requestNote: async (letterId) => {
    await sleep(400);
    world.noteDraft = {
      letterId,
      body: '收到你的回信了。今天海面很平，像你把信折好的样子。',
      at: now(),
    };
    return ok(`${BOT}写了一张小纸条，等你确认。`);
  },
  rewriteNote: async (letterId) => {
    world.noteRewriting = true;
    await sleep(900);
    world.noteRewriting = false;
    if (world.noteDraft?.letterId === letterId) {
      world.noteDraft = { ...world.noteDraft, body: '重写过了：海面很平，像你折信的手。', at: now() };
    }
    return ok('重写好了。');
  },
  discardNote: (letterId) => {
    if (world.noteDraft?.letterId === letterId) world.noteDraft = null;
    world.noteRewriting = false;
    return ok('已放弃这张小纸条。');
  },

  star: async (letterId, starred) => {
    await sleep(120);
    if (starred) {
      if (!world.stars.some(star => star.letterId === letterId)) {
        world.stars.push({ letterId, starredAt: now(), memorySelected: false, memoryActive: false, category: 'received', title: '已收藏的信', from: PEOPLE[0]!, at: iso(now()) });
      }
    } else world.stars = world.stars.filter(star => star.letterId !== letterId);
    return ok(starred ? '已收进星笺匣。' : '已取消星标。');
  },
  starMemory: async (letterId, enabled) => {
    const star = world.stars.find(row => row.letterId === letterId);
    if (star) { star.memorySelected = enabled; star.memoryActive = enabled; }
    return ok(enabled ? '已授权这段往来。' : '已撤回授权。');
  },
  starMemorySetting: async (enabled) => { world.starMemoryEnabled = enabled; return ok(); },

  request: async (action, actor) => {
    await sleep(380);
    world.wake!.active = { id: id('task'), action, phase: 'queued', attempts: 0, createdAt: now(), dueAt: now() } as never;
    return ok(`${BOT}收到这份邀请，去不去由它决定。`);
  },
  send: async (kind) => {
    await sleep(300);
    if (kind === 'reply' && world.replyDraft) { world.replyDraft = null; return { ok: true, message: '回信寄出去了。', close: true }; }
    if (world.letterDraft) { world.letterDraft = null; return { ok: true, message: '信寄出去了。', close: true }; }
    return fail('没有可以寄出的草稿。');
  },
  rewrite: async () => { await sleep(400); return ok('已请' + BOT + '重写。'); },
  discard: async () => { world.letterDraft = null; world.replyDraft = null; return ok('算了吧，这一稿不要了。'); },
  dismiss: async () => { world.held = null; return ok('信已扔回海里。'); },
  keep: async () => { world.held = null; return ok('已珍藏。'); },
  peruse: async () => { await sleep(300); if (world.held) world.held.readAt = now(); return ok(`${BOT}可以看了。`); },
  open: async () => ok('已请' + BOT + '开始写回信。'),
  read: async () => ok('一起读读这封信。'),
  forget: async () => ok('已清空。'),
  exportArchive: () => ({ schemaVersion: 1, exportedAt: iso(now()), entries: [] }),
  importArchive: () => ok('调试页不接受导入。'),
  wakeControl: async (action, command, hours, dayLimit) => {
    const lane = world.wake!.lanes![action]!;
    if (command === 'pause') lane.paused = true;
    if (command === 'resume') { lane.paused = false; lane.declined = false; lane.failed = false; }
    if (command === 'interval') { lane.intervalHours = hours; if (dayLimit) lane.dayLimit = dayLimit; }
    return ok('已保存。');
  },
  myFont: () => null,
  background: () => null,
};

async function paletteFor(customColor: string): Promise<Record<string, Record<string, string>>> {
  const { customPalettes } = await import('../world/appearance.ts');
  return customPalettes(customColor) as never;
}

/** 把一次 GET/POST 交给生产路由；纸条类 POST 不带正文，所以这里不去校验 x-bottle 头。 */
async function route(method: string, path: string, body?: unknown): Promise<{ status: number; json?: unknown; html?: string; binary?: { bytes: Uint8Array; mime: string } }> {
  return handlePage(deps, method, path, { surface: 'page', body });
}

// ── 调试控制条 ────────────────────────────────────────────────────────────

const CONTROL = `
<div id="devbar">
  <div class="devbar-row">
    <span class="devbar-label">场景</span>
    ${Object.entries(SCENES).map(([key, scene]) => `<button data-scene="${key}">${scene.label}</button>`).join('\n    ')}
  </div>
  <div class="devbar-row devbar-note">
    <span>调试页 · 数据全在内存 · 改源码后会自动刷新</span>
    <span id="devbar-status"></span>
  </div>
</div>`;

function injectBar(html: string): string {
  const style = `
  <style id="devbar-style">
    #devbar { position:fixed; z-index:999; left:0; right:0; bottom:0; padding:10px 16px 12px;
      background:#0b0f14f2; color:#dbe6f5; font:12px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;
      backdrop-filter:blur(12px); border-top:1px solid #24313f; box-shadow:0 -8px 30px #0009; }
    #devbar .devbar-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    #devbar .devbar-label { font-size:11px; letter-spacing:.14em; opacity:.55; margin-right:4px; }
    #devbar button { border:1px solid #2a384a; background:#141c26; color:#c7d6ea; border-radius:999px;
      padding:5px 11px; font-size:11.5px; cursor:pointer; transition:all .18s cubic-bezier(.2,.7,.2,1); }
    #devbar button:hover { background:#1d2836; border-color:#3d5d7a; color:#fff; transform:translateY(-1px); }
    #devbar button[aria-pressed="true"] { background:#38bdf8; border-color:#38bdf8; color:#04121b; font-weight:600; }
    #devbar .devbar-note { margin-top:6px; font-size:10.5px; opacity:.55; justify-content:space-between; }
    body#bottle-mailbox { padding-bottom:86px !important; }
  </style>`;
  const script = `
  <script id="devbar-script">
  (function(){
    var scenes = document.querySelectorAll('#devbar [data-scene]');
    var status = document.getElementById('devbar-status');
    function start() {
      var active = document.body.dataset.devScene || '';
      scenes.forEach(function(button){ button.setAttribute('aria-pressed', String(button.dataset.scene === active)); });
    }
    scenes.forEach(function(button){
      button.onclick = function(){
        button.disabled = true; status.textContent = '切换中…';
        fetch('/__dev/scene/' + encodeURIComponent(button.dataset.scene), {method:'POST'})
          .then(function(res){ if(!res.ok) throw new Error('scene'); return location.reload(); })
          .catch(function(){ status.textContent = '切换失败'; button.disabled = false; });
      };
    });
    start();
  })();
  </script>`;
  return html.replace('</body>', `${style}${script}</body>`);
}

// ── 服务 ──────────────────────────────────────────────────────────────────

const LIVE = `
<script id="devbar-live">
(function(){
  var last = null;
  function watch(){
    fetch('/__dev/version', {cache:'no-store'}).then(function(res){ return res.json(); }).then(function(data){
      if (last !== null && data.version !== last) location.reload();
      last = data.version;
    }).catch(function(){});
  }
  watch(); setInterval(watch, 1200);
})();
</script>`;

function withLive(html: string): string {
  return html.replace('</body>', `${LIVE}</body>`);
}

/** 生产页要求 POST 带 `x-bottle: 1`；调试页沿用这条，页面代码不用为了调试改。 */
async function readBody(req: IncomingMessage, limit = 32 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0, tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return resolve(undefined);
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { resolve(undefined); }
    });
    req.on('error', () => resolve(undefined));
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const inline = args.find(arg => arg.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] && !args[index + 1]!.startsWith('--') ? args[index + 1] : undefined;
  };
  const port = Number(valueOf('--port') ?? 7801) || 7801;
  const scene = valueOf('--scene');
  if (scene && SCENES[scene]) SCENES[scene]!.apply();

  // 源码指纹：谁变了就让浏览器重载
  const sources = [
    '../world/page.ts', '../world/page-view.ts', '../world/page-style.ts',
    '../world/page-extras.ts', '../world/page-stationery.ts', '../world/page-stars.ts',
    '../world/page-reader.ts', '../world/page-announcement.ts', '../world/page-customization.ts',
    '../world/page-sound.ts', '../world/appearance.ts', '../world/feedback.ts',
  ];
  function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
    return (hash >>> 0).toString(36);
  }
  async function fingerprint(): Promise<string> {
    const parts = await Promise.all(sources.map(async path => {
      try {
        const bytes = await readFile(new URL(path, import.meta.url));
        return `${path}:${bytes.byteLength}:${fnv1a(bytes.toString('utf8'))}`;
      } catch { return path; }
    }));
    return fnv1a(parts.join('|'));
  }
  let version = await fingerprint();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = (req.url ?? '/').split('?')[0] ?? '/';
      const method = (req.method ?? 'GET').toUpperCase();

      if (url === '/__dev/version') {
        version = await fingerprint();
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ version }));
        return;
      }
      if (url.startsWith('/__dev/scene/') && method === 'POST') {
        const key = decodeURIComponent(url.slice('/__dev/scene/'.length));
        const target = SCENES[key];
        if (!target) { res.writeHead(404).end(); return; }
        target.apply();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, scene: key }));
        return;
      }
      if (url === '/__dev/scenes') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(Object.fromEntries(Object.entries(SCENES).map(([key, item]) => [key, item.label]))));
        return;
      }

      const body = method === 'POST' ? await readBody(req) : undefined;
      if (method === 'POST' && body === undefined) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '请求体不是 JSON。' }));
        return;
      }
      const result = await route(method, url, body);

      if (result.html !== undefined) {
        res.writeHead(result.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(withLive(injectBar(result.html)));
        return;
      }
      if (result.binary) {
        res.writeHead(result.status, { 'content-type': result.binary.mime, 'cache-control': 'no-store' });
        res.end(Buffer.from(result.binary.bytes));
        return;
      }
      res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(result.json ?? { ok: false }));
    })().catch(error => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`调试页出错：${error instanceof Error ? error.message : String(error)}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  console.log('');
  console.log(`  漂流瓶调试页  →  http://127.0.0.1:${port}/`);
  console.log('');
  console.log('  场景（底部控制条也能点）：');
  for (const [key, scene] of Object.entries(SCENES)) console.log(`    ${key.padEnd(16)} ${scene.label}`);
  console.log('');
  console.log('  改 world/page-*.ts 后浏览器会自动刷新；Ctrl+C 结束。');
  console.log('  不连海边、不读令牌、不碰 data 目录。');
  console.log('');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.closeAllConnections?.();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    });
  }
}

void main();
