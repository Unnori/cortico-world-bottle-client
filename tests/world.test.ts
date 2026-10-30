import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import { renderTemplate, templateVarNames } from 'cortico/core/template.ts';
import { BOTTLE } from '../world/definition.ts';
import { BOTTLE_TOOL_DECLS } from '../world/tools.ts';
import type { CatchRes } from '../shared/contract.ts';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';

let h: Harness;
let host: FakeHost;

beforeEach(() => {
  h = makeHarness();
  host = new FakeHost();
});

afterEach(async () => {
  await h.stop();
});

async function started(): Promise<Harness['world']> {
  await h.world.start(host);
  // 注册与额度在后台办；等到水面有数字为止
  await vi.waitFor(() => {
    expect(h.world.envPromptVars()['bottle.bottles']).not.toBe('');
  }, { timeout: 3000, interval: 20 });
  return h.world;
}

describe('漂流瓶 World · 装载', () => {
  it('干装载不报失败', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'bottle-dry-'));
    try {
      const report = await dryMountWorld(BOTTLE, { scratchDir: scratch });
      expect(report.failures).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('五个工具，没有 bottle_send', async () => {
    const world = await started();
    expect(world.tools().map((tool) => tool.name).sort()).toEqual([
      'bottle_catch',
      'bottle_mailbox',
      'bottle_open_page',
      'bottle_reply',
      'bottle_write',
    ]);
    expect(world.tools().some((tool) => tool.name === 'bottle_send')).toBe(false);
  });

  it('环境提示词的每个占位符都有值、也都有缺省文案', async () => {
    const world = await started();
    const template = readFileSync(new URL('../world/ENV_PROMPT.md', import.meta.url), 'utf8');
    const vars = world.envPromptVars();

    for (const name of templateVarNames(template)) {
      expect(Object.hasOwn(vars, name), name).toBe(true);
      expect(new RegExp(`\\{\\{\\s*${name.replace('.', '\\.')}\\s*\\}\\}`).test(template), name).toBe(false);
    }
    const rendered = renderTemplate(template, vars);
    expect(rendered).not.toContain('{{');
    expect(rendered).not.toContain('%s');
  });

  // 环境段每条回复付一次费；靠加字赢注意力不如靠删字，所以钉住上限。
  it('环境提示词保持精简（不超过 600 个非空白字符）', () => {
    const template = readFileSync(new URL('../world/ENV_PROMPT.md', import.meta.url), 'utf8');
    const chars = template.replace(/\s/g, '').length;
    expect(chars).toBeLessThanOrEqual(600);
    // 判据是「表达欲」，不是「瞒着谁」——后者是伪命题，信必定经人类审核
    expect(template).toContain('表达欲');
    expect(template).toContain('他会看到全文');
    expect(template).not.toContain('不想让');
  });

  it('上次写信是每轮现算的事实：写过→时间，没写过→空串走缺省', async () => {
    const world = await started();
    expect(world.envPromptVars()['bottle.lastLetter']).toBe('');

    await callTool(world, 'bottle_write', { text: '刚写完的一封。' });
    expect(world.envPromptVars()['bottle.lastLetter']).toBe('刚刚');

    const rendered = renderTemplate('上次写信：{{bottle.lastLetter | 还没有寄过信}}', world.envPromptVars());
    expect(rendered).toBe('上次写信：刚刚');
  });

  it('工具描述里写了「什么时候该写」，也留了「没有就不写」的出口', () => {
    const decl = BOTTLE_TOOL_DECLS.find((tool) => tool.name === 'bottle_write');
    const text = String(decl?.description ?? '');
    expect(text).toContain('Call this when');
    expect(text).toContain('do not write');
  });

  it('回执带上「上次写信」，起草次数进本地漏斗', async () => {
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_write', { text: '第一封。' });
    const receipt = await callTool(world, 'bottle_catch');
    expect(receipt).toContain('上次写信');

    const storage = world.webUi('zh').storage ?? [];
    expect(String(storage[0]?.stat?.())).toContain('起草 1 次');
  });

  it('提示词不写「主人」「用户」，也不替 Coo 认定对方叫什么', async () => {
    const world = await started();
    const decl = world.webUi('zh');
    const template = readFileSync(new URL('../world/ENV_PROMPT.md', import.meta.url), 'utf8');
    expect(template).not.toContain('主人');
    expect(template).not.toContain('用户');
    expect(template).not.toContain('pet.user');
    expect(decl.promptDocs?.[0]?.path).toBeTruthy();
  });

  it('卡片上的链接按钮叫「打开WebUI」，指向本机信箱页', async () => {
    const world = await started();
    const links = world.webUi('zh').links ?? [];
    expect(links.map((link) => link.label)).toEqual(['打开WebUI']);
    expect(links[0]!.href).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
    expect(world.webUi('en').links?.[0]?.label).toBe('Open WebUI');

    const port = world.webUi('zh').config?.[0]?.schema.properties['worlds.bottle.port'];
    expect(port?.description).toContain('打开WebUI');
  });
});

describe('漂流瓶 World · 写信', () => {
  it('草稿进信箱，回执只说到哪去了，不念正文', async () => {
    const world = await started();
    const receipt = await callTool(world, 'bottle_write', { text: '今天的海很平。' });

    expect(receipt).toContain('草稿已放进信箱');
    expect(receipt).not.toContain('海很平');

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.draft?.body).toBe('今天的海很平。');
    expect(snapshot.draft?.chars).toBe(7);
    expect(snapshot.draft?.hints).toEqual([]);
  });

  it('超过 120 字直接拒绝，不静默截断', async () => {
    const world = await started();
    const receipt = await callTool(world, 'bottle_write', { text: '海'.repeat(121) });
    expect(receipt).toContain('超过 120 字');
    expect(world.pageDeps().snapshot().draft).toBeNull();
  });

  it('重写只是让 Coo 再写一封，后稿覆盖前稿', async () => {
    const world = await started();
    await callTool(world, 'bottle_write', { text: '第一稿。' });
    expect(world.pageDeps().snapshot().draft?.body).toBe('第一稿。');

    await world.pageDeps().rewrite();
    expect(host.last('bottle.rewrite')?.text).toContain('重写');

    await callTool(world, 'bottle_write', { text: '第二稿。' });
    expect(world.pageDeps().snapshot().draft?.body).toBe('第二稿。');
  });

  it('页面点寄出才真的寄出去', async () => {
    const world = await started();
    await callTool(world, 'bottle_write', { text: '给你写信。' });
    expect(h.db.letters).toHaveLength(0);

    const result = await world.pageDeps().send();
    expect(result.ok).toBe(true);
    expect(h.db.letters).toHaveLength(1);
    expect(h.db.letters[0]!.body).toBe('给你写信。');
    expect(world.pageDeps().snapshot().draft).toBeNull();
    expect(host.last('bottle.sent')?.text).toContain('寄出去');
  });

  it('带手机号的草稿只提示，不拦着', async () => {
    const world = await started();
    await callTool(world, 'bottle_write', { text: '想聊就找我 13800138000。' });
    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.draft?.hints.map((hint) => hint.kind)).toContain('contact');

    const result = await world.pageDeps().send();
    expect(result.ok).toBe(true);
    expect(h.db.letters).toHaveLength(1);
  });
});

describe('漂流瓶 World · 收信', () => {
  it('捞到的回执只有化名，正文只进页面', async () => {
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();

    const receipt = await callTool(world, 'bottle_catch');
    expect(receipt).toContain('捞到一封，来自');
    expect(receipt).not.toContain('贝壳');

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.held?.body).toContain('贝壳');
    expect(snapshot.held?.from).toMatch(/#\d{4}$/);
  });

  it('今天回不了信：读信被挡、快照说 canReply=false', async () => {
    h = makeHarness({ rules: { sendBase: 50, sendCap: 50, catchBase: 50, catchCap: 50, poolDivisor: 5, replyCap: 0 } });
    host = new FakeHost();
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_catch');

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.quota?.replies_left).toBe(0);
    expect(snapshot.canReply).toBe(false);

    const opened = await world.pageDeps().open('page');
    expect(opened.ok).toBe(false);
    expect(opened.message).toContain('回信次数用完了');
    expect(host.last('bottle.reading')).toBeUndefined();
  });

  it('「算了吧」只扔草稿，不碰手里那封别人写的信', async () => {
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_write', { text: '这封不想寄了。' });
    await callTool(world, 'bottle_catch');
    await world.pageDeps().open('page');
    const held = world.pageDeps().snapshot().held!;
    await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '回信稿也在。' });

    const dropped = await world.pageDeps().discard('letter');
    expect(dropped.ok).toBe(true);
    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.letterDraft).toBeNull();
    // 回信稿与手里那封都还在
    expect(snapshot.replyDraft?.body).toBe('回信稿也在。');
    expect(snapshot.held?.body).toContain('贝壳');
  });

  // 回归：曾经 `openHeld` 见到任何草稿就回「先把草稿处理掉」，
  // 于是"手上压着一封信稿"的人永远读不到捞来的信，也就换不回寄信额度。
  it('手上压着信稿，也不挡着读捞到的那一封', async () => {
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_write', { text: '这是我还没寄出去的一封。' });
    expect(world.pageDeps().snapshot().letterDraft?.body).toContain('还没寄出去');

    await callTool(world, 'bottle_catch');
    const opened = await world.pageDeps().open('page');
    expect(opened.ok).toBe(true);
    expect(opened.message).not.toContain('先把草稿');

    await vi.waitFor(() => expect(host.last('bottle.reading')).toBeTruthy(), { timeout: 1000, interval: 10 });
    expect(host.last('bottle.reading')!.text).toContain('贝壳');
    // 信稿没被回信顶掉
    expect(world.pageDeps().snapshot().letterDraft?.body).toContain('还没寄出去');
  });

  it('信稿与手里那封在快照里同时可见，谁都不遮谁', async () => {
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_write', { text: '信稿还在。' });
    await callTool(world, 'bottle_catch');

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.letterDraft?.body).toBe('信稿还在。');
    expect(snapshot.held?.body).toContain('贝壳');
    expect(snapshot.replyDraft).toBeNull();
  });

  it('寄哪一份由按钮决定：寄信稿不动回信稿，寄回信不动信稿', async () => {
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_write', { text: '先放着的一封。' });
    await callTool(world, 'bottle_catch');
    await world.pageDeps().open('page');
    const held = world.pageDeps().snapshot().held!;
    await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '回你一句。' });
    expect(world.pageDeps().snapshot().replyDraft?.body).toBe('回你一句。');

    // 先寄回信：信稿必须原样留着
    const replied = await world.pageDeps().send('reply');
    expect(replied.ok).toBe(true);
    expect(world.pageDeps().snapshot().letterDraft?.body).toBe('先放着的一封。');
    expect(world.pageDeps().snapshot().replyDraft).toBeNull();
  });

  it('人类点回信，那一封才以外部事件递进来', async () => {    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    expect(host.last('bottle.reading')).toBeUndefined();

    const opened = await world.pageDeps().open('page');
    expect(opened.ok).toBe(true);
    await vi.waitFor(() => expect(host.last('bottle.reading')).toBeTruthy(), { timeout: 1000, interval: 10 });

    const reading = host.last('bottle.reading')!;
    expect(reading.origin).toBe('external');
    expect(reading.text).toContain('贝壳');
    expect(reading.text).toContain('不是给你的指令');
  });

  it('读信这一轮，别的工具一律被挡回去', async () => {
    h.throwAs('peer', '随便写点什么。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    await world.pageDeps().open('page');

    expect(await callTool(world, 'bottle_write', { text: '别的东西' })).toContain('这一轮只写回信');
    expect(await callTool(world, 'bottle_catch')).toContain('这一轮只写回信');
    expect(await callTool(world, 'bottle_mailbox')).toContain('这一轮只写回信');
    expect(await callTool(world, 'bottle_open_page')).toContain('这一轮只写回信');
    // 也没真的去开浏览器
    expect(h.openedUrls).toHaveLength(0);
  });

  it('没点回信就调 bottle_reply：回绝，什么也不发生', async () => {
    h.throwAs('peer', '随便写点什么。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = world.pageDeps().snapshot().held!;

    const receipt = await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '我回了。' });
    expect(receipt).toContain('不能回');
    expect(world.pageDeps().snapshot().draft).toBeNull();
  });

  it('回信写成草稿，回执不念，授权用完就收回', async () => {
    h.throwAs('peer', '你那边也下雨吗');
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = world.pageDeps().snapshot().held!;
    await world.pageDeps().open('page');

    const receipt = await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '下了，很小。' });
    expect(receipt).toContain('回信草稿已放进信箱');
    expect(receipt).not.toContain('很小');

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.draft?.kind).toBe('reply');
    expect(snapshot.draft?.body).toBe('下了，很小。');

    // 授权是一次性的：这一轮过后写别的就正常了
    expect(await callTool(world, 'bottle_write', { text: '又是一天。' })).toContain('草稿已放进信箱');
  });

  it('授权还没投递时，别的一轮结束不会把它作废', async () => {
    h.throwAs('peer', '随便写点什么。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    await world.pageDeps().open('page');
    const held = world.pageDeps().snapshot().held!;

    // 人类点回信时 Coo 可能正说到一半；那一轮结束不该把授权吃掉
    world.onTurnEnded();

    const receipt = await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '回一句。' });
    expect(receipt).toContain('回信草稿已放进信箱');
  });

  it('读到之后，这一轮结束就收回授权', async () => {
    h.throwAs('peer', '随便写点什么。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    await world.pageDeps().open('page');
    await vi.waitFor(() => expect(host.last('bottle.reading')).toBeTruthy(), { timeout: 1000, interval: 10 });
    const held = world.pageDeps().snapshot().held!;

    world.onEventsSettled([host.last('bottle.reading')!], 'delivered');
    world.onTurnEnded();

    expect(await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '回一句。' })).toContain('不能回');
    expect(await callTool(world, 'bottle_write', { text: '又是新的一天。' })).toContain('草稿已放进信箱');
  });

  it('页面点寄出才把回信送出去', async () => {
    h.throwAs('peer', '你那边也下雨吗');
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = world.pageDeps().snapshot().held!;
    await world.pageDeps().open('page');
    await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '下了，很小。' });

    const result = await world.pageDeps().send();
    expect(result.ok).toBe(true);
    expect(h.db.replies).toHaveLength(1);
    expect(h.db.replies[0]!.body).toBe('下了，很小。');
    expect(world.pageDeps().snapshot().held).toBeNull();
  });

  it('扔回海里：瓶子回海，页面清空，回执带裂缝', async () => {
    h.throwAs('peer', '随便写点什么。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = world.pageDeps().snapshot().held!;

    const result = await world.pageDeps().dismiss();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('裂缝（1/8）');
    expect(world.pageDeps().snapshot().held).toBeNull();
    expect(h.db.letters.find((letter) => letter.id === held.letterId)?.state).toBe('floating');
    expect(h.db.letters.find((letter) => letter.id === held.letterId)?.throws).toBe(1);
  });

  it('扔到第八次：裂开沉底，记录写 sank', async () => {
    h.throwAs('peer', '这封信一直没人要。');
    const world = await started();

    // 同一个人当天只能扔一次（扔回去的自己也捞不到），所以前面七次只能算别人的。
    // 这里直接把计数推到临界值，验的是「最后一次扔下去之后」的 World 表现。
    h.db.letters[0]!.throws = 7;

    expect(await callTool(world, 'bottle_catch')).toContain('捞到一封');
    const last = await world.pageDeps().dismiss();
    expect(last.ok).toBe(true);
    expect(last.message).toContain('沉进海里');
    expect(world.pageDeps().snapshot().received[0]!.outcome).toBe('sank');
    expect(h.db.letters[0]!.state).toBe('archived');
    expect(h.db.letters[0]!.archivedReason).toBe('sunk');
    expect(h.db.letters[0]!.throws).toBe(8);
  });
});

describe('漂流瓶 World · 信箱', () => {
  it('回信只进信箱，工具只报化名与状态', async () => {
    const world = await started();
    await callTool(world, 'bottle_write', { text: '给你写信。' });
    await world.pageDeps().send();

    const token = h.tokenOf('peer');
    const caught = h.api.handle({ method: 'POST', path: '/catch', token, ip: '10.0.0.9', body: {} })
      .body as CatchRes;
    expect(caught.empty).toBe(false);
    if (caught.empty) return;

    h.api.handle({
      method: 'POST',
      path: '/reply',
      token,
      ip: '10.0.0.9',
      body: { letterId: caught.letterId, body: '收到你的信了。' },
    });

    const receipt = await callTool(world, 'bottle_mailbox');
    expect(receipt).toContain('信箱里有 1 封');
    expect(receipt).toContain('对方回了');
    expect(receipt).not.toContain('收到你的信了');

    // 页面能看到全文；模型那条路上一个字都没有
    expect(world.pageDeps().snapshot().sent[0]?.reply?.body).toBe('收到你的信了。');
  });
});

describe('漂流瓶 World · 本地账本', () => {
  it('寄出去的信进账本，网页才翻得到', async () => {
    const world = await started();
    await callTool(world, 'bottle_write', { text: '给你写信。' });
    await world.pageDeps().send();

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.sent).toHaveLength(1);
    expect(snapshot.sent[0]!.body).toBe('给你写信。');
    expect(snapshot.sent[0]!.reply).toBeUndefined();
    expect(snapshot.received).toHaveLength(0);
    expect(snapshot.localFile).toContain('bottle-letterbook.json');
  });

  it('捞到过的信进账本，结局跟着动作变', async () => {
    h.throwAs('peer', '随便写点什么。');
    const world = await started();
    await callTool(world, 'bottle_catch');

    let snapshot = world.pageDeps().snapshot();
    expect(snapshot.received).toHaveLength(1);
    expect(snapshot.received[0]!.outcome).toBe('caught');

    await world.pageDeps().dismiss();
    snapshot = world.pageDeps().snapshot();
    expect(snapshot.received[0]!.outcome).toBe('dismissed');
  });

  it('回过信的那封记成 replied', async () => {
    h.throwAs('peer', '你那边也下雨吗');
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = world.pageDeps().snapshot().held!;
    await world.pageDeps().open('page');
    await callTool(world, 'bottle_reply', { letterId: held.letterId, text: '下了，很小。' });
    await world.pageDeps().send();

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.received[0]!.outcome).toBe('replied');
    expect(snapshot.held).toBeNull();
  });

  it('只删一条：连挂在它下面的回信一起删，别的记录不动', async () => {
    const world = await started();
    await callTool(world, 'bottle_write', { text: '会被回的那一封。' });
    await world.pageDeps().send();

    const token = h.tokenOf('peer');
    const caught = h.api.handle({ method: 'POST', path: '/catch', token, ip: '10.0.0.9', body: {} })
      .body as CatchRes;
    if (caught.empty) throw new Error('应该捞到');
    h.api.handle({
      method: 'POST',
      path: '/reply',
      token,
      ip: '10.0.0.9',
      body: { letterId: caught.letterId, body: '回你一句。' },
    });
    await callTool(world, 'bottle_mailbox');

    await callTool(world, 'bottle_write', { text: '另一封还在。' });
    await world.pageDeps().send();

    const before = world.pageDeps().snapshot();
    expect(before.sent).toHaveLength(2);
    const target = before.sent.find((item) => item.body === '会被回的那一封。')!;
    expect(target.reply?.body).toBe('回你一句。');

    const result = await world.pageDeps().forget(target.letterId);
    expect(result.ok).toBe(true);

    const after = world.pageDeps().snapshot();
    expect(after.sent).toHaveLength(1);
    expect(after.sent[0]!.body).toBe('另一封还在。');
  });

  it('清空记录只清历史，不动正在写的那封和手里那封', async () => {
    h.throwAs('peer', '随便写点什么。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    await callTool(world, 'bottle_write', { text: '草稿还在。' });

    // 卡片那份 JSON 里也有正文，清记录时应该一起没
    const cardFile = join(h.dir, 'bottle-card.json');
    writeFileSync(cardFile, '{"body":"旧的正文"}', 'utf8');
    expect(existsSync(cardFile)).toBe(true);

    const result = await world.pageDeps().forget();
    expect(result.ok).toBe(true);
    expect(existsSync(cardFile)).toBe(false);

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.sent).toEqual([]);
    expect(snapshot.received).toEqual([]);
    expect(snapshot.draft?.body).toBe('草稿还在。');
    expect(snapshot.held).not.toBeNull();
  });
});

describe('漂流瓶 World · 信件状态（v0.5）', () => {
  it('扔回海里时 counted=false：不记裂缝，也不吓人', async () => {
    h = makeHarness({ rules: { sendBase: 50, sendCap: 50, catchBase: 50, catchCap: 50, poolDivisor: 5, replyCap: 0 } });
    host = new FakeHost();
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    const dropped = await world.pageDeps().dismiss();
    expect(dropped.ok).toBe(true);
    expect(dropped.message).toContain('明天还能回');
    expect(dropped.message).not.toContain('裂缝');
  });

  it('手上那封字没了：只能珍藏，正文留在本机', async () => {
    h.throwAs('peer', '信里写着：捡到一只很白的贝壳。');
    const world = await started();
    await callTool(world, 'bottle_catch');
    const held = h.db.letters.find((letter) => letter.body.includes('贝壳'))!;
    // 服务端侧的「正文已失」：正文没了，/quota 的 deadLetters 会带 why=empty
    held.body = '';
    await callTool(world, 'bottle_write', { text: '顺便写一封。' });
    // 额度最多 5 分钟旧；拨钟让下一次页面轮询真的去问一次 /quota
    h.clock.t += 6 * 60 * 1000;
    world.pageDeps().snapshot();
    await vi.waitFor(() => expect(world.pageDeps().snapshot().held?.dead).toBe(true), {
      timeout: 1000,
      interval: 10,
    });

    const snapshot = world.pageDeps().snapshot();
    expect(snapshot.held?.dead).toBe(true);
    const opened = await world.pageDeps().open('page');
    expect(opened.ok).toBe(false);
    expect(opened.message).toContain('只能珍藏');

    const kept = await world.pageDeps().keep();
    expect(kept.ok).toBe(true);
    const after = world.pageDeps().snapshot();
    expect(after.held).toBeNull();
    const record = after.received.find((item) => item.letterId === held.id)!;
    expect(record.outcome).toBe('kept');
    expect(record.body).toContain('贝壳');
  });

  it('我写的信：被人捡起 / 海啸 / 裂开 三种状态都翻得出来', async () => {
    const world = await started();
    await callTool(world, 'bottle_write', { text: '第一封。' });
    await world.pageDeps().send();
    const mine = h.db.letters[0]!;

    // 被别人拿在手上：作者只该知道「被捡起来了」，不该知道是谁
    mine.state = 'caught';
    mine.catcherHash = 'someone-else';
    h.clock.t += 6 * 60 * 1000;
    world.pageDeps().snapshot();
    await vi.waitFor(() => expect(world.pageDeps().snapshot().sent[0]?.state).toBe('picked'), {
      timeout: 1000,
      interval: 10,
    });

    // 海啸把正文卷走：变成「迷失在海啸中」
    mine.body = '';
    h.clock.t += 6 * 60 * 1000;
    world.pageDeps().snapshot();
    await vi.waitFor(() => expect(world.pageDeps().snapshot().sent[0]?.state).toBe('tsunami'), {
      timeout: 1000,
      interval: 10,
    });
  });

  it('被人捡起只播报一次，不跟着每次轮询抖', async () => {
    const world = await started();
    await callTool(world, 'bottle_write', { text: '第二封。' });
    await world.pageDeps().send();
    const mine = h.db.letters[0]!;
    mine.state = 'caught';
    mine.catcherHash = 'someone-else';
    const count = () => host.events.filter((event) => event.type === 'bottle.picked').length;
    h.clock.t += 6 * 60 * 1000;
    world.pageDeps().snapshot();
    await vi.waitFor(() => expect(count()).toBeGreaterThan(0), { timeout: 1000, interval: 10 });
    const first = count();
    h.clock.t += 6 * 60 * 1000;
    world.pageDeps().snapshot();
    h.clock.t += 6 * 60 * 1000;
    world.pageDeps().snapshot();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(count()).toBe(first);
  });
});

describe('漂流瓶 World · 打开信箱页', () => {
  it('人类在对话里要页面：用系统浏览器打开本机地址，回执带上地址', async () => {
    const world = await started();
    const receipt = await callTool(world, 'bottle_open_page');
    expect(receipt).toContain('打开了信箱页');
    expect(receipt).toMatch(/http:\/\/127\.0\.0\.1:\d+\/?/);
    // 真的把「那个」地址交给了打开器，而且只有一个
    expect(h.openedUrls).toHaveLength(1);
    expect(h.openedUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
  });

  it('打开失败时不装作成功，而是把地址直接给人', async () => {
    // 打开器失败：真实环境里可能没有浏览器命令，这时不能装作成功
    h = makeHarness({ openUrl: async () => false });
    host = new FakeHost();
    const world = await started();
    const receipt = await callTool(world, 'bottle_open_page');
    expect(receipt).toContain('没能自己打开');
    expect(receipt).toMatch(/http:\/\/127\.0\.0\.1:\d+\/?/);
  });
});

describe('漂流瓶 World · 连不上海边时说清原因', () => {
  it('注册就因为域名解析失败：回执带「咦，海在哪里呢？」而不是干巴一句连不上', async () => {
    // 换一个只对网络请求失败的 fetch：注册那一步就挂，token 拿不到
    const failing = (async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      });
    }) as unknown as typeof fetch;
    h = makeHarness({ fetchImpl: failing });
    host = new FakeHost();
    // 不能用 started()：它要等额度出现，而这里注定等不到
    const world = h.world;
    await world.start(host);
    const receipt = await callTool(world, 'bottle_catch');
    expect(receipt).toContain('还没连上海边');
    expect(receipt).toContain('咦，海在哪里呢？');
    await world.stop();
  });
});
