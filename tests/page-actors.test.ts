import { customPalettes } from '../world/appearance.ts';
import { Script } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import type { MailboxTheme } from '../world/theme.ts';
import { pageHtml } from '../world/page-view.ts';

/** Execute the real page handlers with a tiny DOM; no browser/network dependency. */
function page(snapshot: Record<string, unknown> = {}, preferences = new Map<string, string>(), reduce = false, host: MailboxTheme = { available: false }) {
  const nodes = new Map<string, any>();
  const get = (id: string): any => {
    if (!nodes.has(id)) nodes.set(id, { id, textContent: '', value: '', disabled: false, attrs: {}, style: {}, dataset: {}, open: false, hidden: id === 'theme-menu' || id === 'reader-panel', listeners: {},
      contains(target: any) { return target === this || (id === 'theme-picker' && target.id?.startsWith('theme-')) || (id === 'reader-tools' && target.id?.startsWith('reader-')); },
      getAttribute(key: string) { return this.attrs[key] ?? null; },
      addEventListener(type: string, fn: (event?: unknown) => void) { this.listeners[type] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); }, focus: vi.fn(),
      getBoundingClientRect() {
        if (id === 'reader-tools' || id === 'reader-panel') {
          const panel = id === 'reader-panel';
          const origin = panel ? get('reader-tools').getBoundingClientRect() : { left: 0, top: 0 };
          const left = origin.left + (parseFloat(this.style.left) || (panel ? 54 : 8));
          const top = origin.top + (parseFloat(this.style.top) || (panel ? 0 : 400));
          const width = parseFloat(this.style.width) || (panel ? 232 : 44);
          const height = panel ? Math.min(300, parseFloat(this.style.maxHeight) || Infinity) : 96;
          return { left, right: left + width, top, bottom: top + height, width, height };
        }
        return { left: 100, right: 500, top: 100, bottom: 500, width: 400, height: 400 };
      },
      setAttribute(key: string, value: string) { this.attrs[key] = value; }, removeAttribute(key: string) { delete this.attrs[key]; } });
    return nodes.get(id);
  };
  get('host-theme').textContent = JSON.stringify(host);
  get('custom-palettes').textContent = JSON.stringify(customPalettes(host.preference?.customColor ?? '#4b62a0'));
  const darkMedia = { matches: false, listener: () => {}, addEventListener(_event: string, listener: () => void) { this.listener = listener; } };
  const appearanceFetch = vi.fn(async (_path: string, _options?: unknown) => ({ ok: true }));
  const fetch = vi.fn(() => new Promise(() => {}));
  const timeout = vi.fn();
  const clearTimeout = vi.fn();
  const state = { botName: '小满', letterDraft: null, pendingAction: null, received: [], sent: [], held: null,
    wake: { lanes: { write: { count: 0 }, catch: { count: 0 }, remind: { count: 0 } }, history: [] }, ...snapshot };
  const script = pageHtml().match(/<script>([\s\S]*?)<\/script>/)![1].replace(/  refresh\(\);\s*\}\)\(\);\s*$/, '  globalThis.actions = { toast: toast, desk: updateDeskArrivals, focusDesk: focusDeskArrival, sync: refreshHostTheme, show: function(s) { state = s; renderActionState(s.letterDraft); } };\n})();');
  const listeners: Record<string, (event: any) => void> = {};
  const windowListeners: Record<string, (event: any) => void> = {};
  const getComputedStyle = (node: any) => node.id === 'reader-safe-area'
    ? { paddingTop: '8px', paddingRight: '8px', paddingBottom: '8px', paddingLeft: '8px', borderTopWidth: '0px', borderBottomWidth: '0px' }
    : { paddingTop: '0', paddingRight: '0', paddingBottom: '0', paddingLeft: '0', borderTopWidth: '1', borderBottomWidth: '1' };
  const sandbox: any = { Image: class { onload: any; onerror: any; src = ''; }, document: { documentElement: { clientWidth: 1280, clientHeight: 800, dataset: {}, style: { setProperty: vi.fn() } }, getElementById: get, querySelectorAll: () => [],
      addEventListener(type: string, fn: (event: any) => void) { listeners[type] = fn; }, hidden: false },
    localStorage: { getItem: (key: string) => preferences.get(key), setItem: (key: string, value: string) => preferences.set(key, value) },
    fetch: (path: string, options?: unknown) => path === '/appearance' ? appearanceFetch(path as any, options as any) : (options === undefined ? (fetch as any)(path) : (fetch as any)(path, options)), setInterval: vi.fn(), clearTimeout, setTimeout: timeout,
    getComputedStyle,
    window: { innerWidth: 1280, innerHeight: 800, getComputedStyle, matchMedia: (query: string) => query.includes('color-scheme') ? darkMedia : ({ matches: reduce }), addEventListener(type: string, fn: (event: any) => void) { windowListeners[type] = fn; } }, Date };
  expect(script).toContain('globalThis.actions =');
  new Script(script).runInNewContext(sandbox);
  sandbox.actions.show(state);
  return { desk: sandbox.actions.desk, focusDesk: sandbox.actions.focusDesk, appearanceFetch, toast: sandbox.actions.toast, timeout, clearTimeout, sync: sandbox.actions.sync, darkMedia, get, fetch, state, preferences, listeners, windowListeners, document: sandbox.document, show: () => sandbox.actions.show(state) };
}

it('主体切换在行动上方，默认邀请由桌宠决定，切到人后更新按钮文案', () => {
  expect(pageHtml().indexOf('id="actor-bot"')).toBeLessThan(pageHtml().indexOf('id="write-button"'));
  const h = page();
  expect(h.get('actor-bot').attrs['aria-pressed']).toBe('true');
  expect(h.get('actor-bot').textContent).toBe('让小满来吧');
  expect(h.get('write-label').textContent).toBe('写一封信');
  h.get('actor-human').onclick();
  expect(h.get('write-label').textContent).toBe('请小满写一封信');
  expect(h.get('catch-label').textContent).toBe('去海边打捞');
  expect(h.get('actor-hint').textContent).toContain('信只给你看');
});
it.each(['write', 'catch'])('默认 %s 请求显式传 bot，切换后显式传 human', action => {
  for (const actor of ['bot', 'human']) {
    const h = page(); if (actor === 'human') h.get('actor-human').onclick();
    h.get(action + '-button').onclick();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [path, options] = h.fetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(path).toBe('/' + action);
    expect(JSON.parse(options.body)).toEqual({ actor });
  }
});
it('冷却仅禁用对应邀请按钮，人的行动不受该冷却限制', () => {
  const h = page({ cooldowns: { write: Date.now() + 60_000 } });
  expect(h.get('write-button').disabled).toBe(true);
  expect(h.get('catch-button').disabled).toBe(false);
  expect(h.get('write-label').textContent).toMatch(/秒/);
  h.get('actor-human').onclick();
  expect(h.get('write-button').disabled).toBe(false);
  expect(h.get('write-label').textContent).not.toContain('秒');
});
it('已展开的设置有三个独立暂停与间隔控件，修改中的输入不被轮询覆盖', () => {
  const h = page();
  expect(h.get('wake-remind-status').textContent).toContain('待办提醒');
  expect(h.get('wake-write-hours').value).toBe('2');
  h.document.activeElement = h.get('wake-write-hours');
  h.get('wake-write-hours').value = '8'; h.show();
  expect(h.get('wake-write-hours').value).toBe('8');
  h.get('wake-catch-toggle').onclick();
  const [, options] = h.fetch.mock.calls[0] as unknown as [string, { body: string }];
  expect(JSON.parse(options.body)).toEqual({ action: 'catch', command: 'pause' });
});


it('顶栏的反馈入口弹出小卡片，关闭和点遮罩会收起，并将焦点交还入口', () => {
  const h = page(); const dialog = h.get('feedback-dialog'); const entry = h.get('feedback-entry');
  entry.onclick(); expect(dialog.open).toBe(true);
  h.get('feedback-close').onclick(); expect(dialog.open).toBe(false); expect(entry.focus).toHaveBeenCalled();
  entry.onclick(); dialog.listeners.click({ target: dialog, clientX: 150, clientY: 150 }); expect(dialog.open).toBe(true);
  dialog.listeners.click({ target: dialog, clientX: 50, clientY: 50 }); expect(dialog.open).toBe(false);
  expect(h.fetch).not.toHaveBeenCalled();
  const html = pageHtml();
  expect(html).toContain('<span>反馈</span>');
  expect(html).toContain('https://github.com/Unnori/cortico-world-bottle-client/issues/new');
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  expect(html).toContain('@会动的毛球'); expect(html).toContain('1～5 群');
  expect(html).toContain('<s>甚至只是来找我闲聊，也可以。</s>');
});
it('no_idea 在网页显示为自主暂不做，不再显示未完成或失败', () => {
  const h = page({ wake: { lanes: { write: { count: 1 }, catch: { count: 0 }, remind: { count: 0 } },
    history: [{ action: 'write', result: 'deferred', reason: 'no_idea' }] } });
  expect(h.get('wake-outcome').textContent).toContain('暂时没有灵感');
  expect(h.get('wake-outcome').textContent).toContain('不算失败');
  expect(h.get('wake-outcome').textContent).not.toContain('未完成');
});


it('默认潮蓝，四个主题可切换并记住偏好，只读宿主配色', () => {
  const h = page();
  expect(h.document.documentElement.dataset.theme).toBe('ocean');
  for (const theme of ['paper', 'epistle', 'coopanion', 'ocean']) {
    h.get('theme-toggle').onclick();
    expect(h.get('theme-menu').hidden).toBe(false);
    h.get('theme-' + theme).onclick();
    expect(h.document.documentElement.dataset.theme).toBe(theme);
    expect(h.get('theme-' + theme).attrs['aria-pressed']).toBe('true');
    expect(h.preferences.get('bottle-theme')).toBe(theme);
    expect(h.get('theme-menu').hidden).toBe(false);
    h.get('theme-toggle').onclick();
  }
  expect(h.fetch).toHaveBeenCalledWith('/theme');
  const restored = page({}, new Map([['bottle-theme', 'coopanion']]));
  expect(restored.document.documentElement.dataset.theme).toBe('coopanion');
  expect(restored.get('browser-theme-color').attrs.content).toBe('#f0f4fb');
});
it('主题菜单支持 Escape、外部点击和跨标签页同步；无效偏好回到潮蓝', () => {
  const h = page({}, new Map([['bottle-theme', '__proto__']]));
  expect(h.document.documentElement.dataset.theme).toBe('ocean');
  h.get('theme-toggle').onclick();
  h.listeners.keydown({ key: 'Escape', preventDefault: vi.fn() });
  expect(h.get('theme-menu').hidden).toBe(true);
  expect(h.get('theme-toggle').focus).toHaveBeenCalled();
  h.get('theme-toggle').onclick();
  h.listeners.click({ target: h.get('unrelated') });
  expect(h.get('theme-toggle').attrs['aria-expanded']).toBe('false');
  h.windowListeners.storage({ key: 'bottle-theme', newValue: 'paper' });
  expect(h.document.documentElement.dataset.theme).toBe('paper');
});
it('减少动态效果时，反馈卡片和菜单立即开合，不等待动画', () => {
  const h = page({}, new Map(), true);
  const dialog = h.get('feedback-dialog'); dialog.animate = vi.fn();
  h.get('feedback-entry').onclick(); h.get('feedback-close').onclick();
  expect(dialog.open).toBe(false); expect(dialog.animate).not.toHaveBeenCalled();
  h.get('theme-menu').animate = vi.fn();
  h.get('theme-toggle').onclick(); h.get('theme-paper').onclick(); h.get('theme-toggle').onclick();
  expect(h.get('theme-menu').hidden).toBe(true); expect(h.get('theme-menu').animate).not.toHaveBeenCalled();
});
it('反馈的关闭过渡完成后才收起，Escape 也遵循同一条路径', () => {
  const h = page(); const dialog = h.get('feedback-dialog');
  h.get('feedback-entry').onclick();
  const animation = { onfinish: null as null | (() => void) };
  dialog.animate = vi.fn(() => animation);
  const event = { preventDefault: vi.fn() }; dialog.listeners.cancel(event);
  expect(event.preventDefault).toHaveBeenCalled(); expect(dialog.open).toBe(true);
  animation.onfinish!(); expect(dialog.open).toBe(false);
});
it('信件连续折叠会取消旧动画，并保留最后一次的展开选择', () => {
  const h = page();
  const animations: any[] = [];
  const detail: any = { tagName: 'DETAILS', dataset: { foldKey: 'letter-test' }, style: {}, open: false,
    getBoundingClientRect: () => ({ height: detail.open ? 240 : 50 }),
    animate: vi.fn(() => { const a = { cancel: vi.fn() }; animations.push(a); return a; }) };
  const summary = { parentElement: detail, getBoundingClientRect: () => ({ height: 48 }) };
  const event = { target: { closest: () => summary }, preventDefault: vi.fn() };
  h.listeners.click(event); expect(detail._foldTarget).toBe(true);
  h.listeners.click(event); expect(animations[0].cancel).toHaveBeenCalled(); expect(detail._foldTarget).toBe(false);
  animations[0].onfinish(); expect(detail.open).toBe(true);
  animations[1].onfinish(); expect(detail.open).toBe(false); expect(detail.style.overflow).toBe('');
});
it('主题预读发生在样式之前，主题文字入口、信封元素和减少动画规则都保留', () => {
  const html = pageHtml();
  expect(html.indexOf('data-theme-init')).toBeLessThan(html.indexOf('<style>'));
  expect(html).toContain('aria-label="切换信箱配色"');
  expect(html).toContain('envelope-art'); expect(html).toContain('prefers-reduced-motion:reduce');
  expect(html).toContain('data-theme="coopanion"'); expect(html).toContain('data-theme="paper"');
});

it('三套配色均支持系统明暗变化，手动选择后不受系统变化影响且可恢复自动', () => {
  const h = page();
  for (const theme of ['ocean', 'paper', 'epistle', 'coopanion']) {
    h.get('theme-' + theme).onclick(); h.get('mode-system').onclick();
    h.darkMedia.matches = true; h.darkMedia.listener();
    expect(h.document.documentElement.dataset.appearance).toBe('dark');
    h.get('mode-light').onclick(); h.darkMedia.listener();
    expect(h.document.documentElement.dataset.appearance).toBe('light');
    h.get('mode-dark').onclick(); h.darkMedia.matches = false; h.darkMedia.listener();
    expect(h.document.documentElement.dataset.appearance).toBe('dark');
    h.get('mode-system').onclick(); expect(h.document.documentElement.dataset.appearance).toBe('light');
  }
  h.get('mode-dark').onclick();
  expect(page({}, h.preferences).document.documentElement.dataset.appearance).toBe('dark');
  h.windowListeners.storage({ key: 'bottle-appearance', newValue: 'light' });
  expect(h.document.documentElement.dataset.appearance).toBe('light');
});
it('读取实际宿主配色，切换明暗使用对应色板，失败保留最后一次有效颜色', async () => {
  const host = { available: true, palettes: BUILTIN_PALETTES.mint };
  const h = page({}, new Map([['bottle-theme', 'coopanion']]), false, host);
  expect(h.document.documentElement.style.setProperty).toHaveBeenCalledWith('--host-paper', host.palettes.light.paper);
  h.get('mode-dark').onclick();
  expect(h.get('browser-theme-color').attrs.content).toBe(host.palettes.dark.paper);
  h.fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ available: true, palettes: BUILTIN_PALETTES.navigator }) }) as any);
  h.get('theme-coopanion').onclick();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.get('browser-theme-color').attrs.content).toBe(BUILTIN_PALETTES.navigator.dark.paper);
  h.fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ available: false }) }) as any);
  h.get('theme-coopanion').onclick();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.get('browser-theme-color').attrs.content).toBe(BUILTIN_PALETTES.navigator.dark.paper);
  expect(h.get('theme-sync-note').textContent).toContain('保留上次配色');
});

it('后台标签页延迟动画事件时，完成 Promise 仍会收起菜单；取消的动画不误收起', async () => {
  const h = page(); const menu = h.get('theme-menu');
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  menu.animate = vi.fn(() => ({ finished, cancel: vi.fn() }));
  h.get('theme-toggle').onclick(); h.listeners.keydown({ key: 'Escape', preventDefault: vi.fn() });
  expect(menu.hidden).toBe(false); finish(); await finished; await Promise.resolve();
  expect(menu.hidden).toBe(true);
  let cancel!: () => void;
  const cancelled = new Promise<void>((_resolve, reject) => { cancel = () => reject(new Error('cancelled')); });
  menu.animate = vi.fn(() => ({ finished: cancelled, cancel }));
  h.get('theme-toggle').onclick(); h.listeners.keydown({ key: 'Escape', preventDefault: vi.fn() });
  h.get('theme-toggle').onclick(); await Promise.resolve(); await Promise.resolve();
  expect(menu.hidden).toBe(false); expect(h.get('theme-toggle').attrs['aria-expanded']).toBe('true');
});

it('宿主同步仅用于 Coopanion，合并并发请求，并至少间隔五秒', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    const h = page(); h.sync(false); expect(h.fetch).not.toHaveBeenCalled();
    h.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ available: false }) }) as any);
    h.get('theme-coopanion').onclick(); h.sync(true);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    clock.mockReturnValue(14999); h.sync(false); expect(h.fetch).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(15000); h.sync(false); expect(h.fetch).toHaveBeenCalledTimes(2);
    await new Promise(resolve => setTimeout(resolve, 0));
    h.get('theme-paper').onclick(); clock.mockReturnValue(30000); h.sync(false);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); }
});

it('主题选择按先后保存到卡片接口，手动明暗也保存，桌宠文案使用名字', async () => {
  const h = page(); h.get('theme-paper').onclick(); h.get('mode-dark').onclick();
  await new Promise(resolve => setTimeout(resolve, 0));
  const requests = h.appearanceFetch.mock.calls.map(call => JSON.parse((call[1] as { body:string }).body));
  expect(requests).toEqual([{ theme:'paper', mode:'system', customColor:'#4b62a0', background:null, backgroundTransparency:82, myFont:null, myFontName:'' }, { theme:'paper', mode:'dark', customColor:'#4b62a0', background:null, backgroundTransparency:82, myFont:null, myFontName:'' }]);
  expect((h.appearanceFetch.mock.calls[0][1] as any).headers['x-bottle']).toBe('1');
  expect(h.get('actor-hint').textContent).toContain('都由小满决定');
  h.get('actor-human').onclick(); expect(h.get('actor-hint').textContent).toContain('交给小满');
});
it('重新打开信箱优先恢复本部署的主题记录，避免浏览器旧偏好覆盖卡片', () => {
  const h = page({}, new Map([['bottle-theme','ocean']]), false, { available:false, preference:{ theme:'paper', mode:'dark' } });
  expect(h.document.documentElement.dataset.theme).toBe('paper');
  expect(h.document.documentElement.dataset.appearance).toBe('dark');
});

it('错误提示淡出时仍保留错误配色，下一条普通提示正常切换配色', () => {
  const h = page();
  h.toast('出了点问题', true);
  expect(h.get('toast').className).toBe('toast on bad');
  const hide = h.timeout.mock.calls.at(-1)![0];
  expect(h.timeout.mock.calls.at(-1)![1]).toBe(2600);
  hide();
  expect(h.get('toast').className).toBe('toast bad');
  h.toast('邀请已送达');
  expect(h.get('toast').className).toBe('toast on');
  expect(h.get('toast').textContent).toBe('邀请已送达');
  expect(h.clearTimeout).toHaveBeenCalled();
  h.timeout.mock.calls.at(-1)![0]();
  expect(h.get('toast').className).toBe('toast');
});


it('无回应结果直接放在按钮下方的独立文本框，使用桌宠名而不声称工具报错', () => {
  const h = page({ wake: { lanes: {}, history: [{ action: 'write', result: 'failed', reason: 'turn_ended' }] } });
  expect(h.get('wake-outcome').textContent).toContain('小满没有回应邀请…');
  expect(h.get('wake-outcome').textContent).not.toContain('未完成');
  const html = pageHtml();
  const outcome = html.indexOf('id="wake-outcome"');
  expect(outcome).toBeGreaterThan(html.indexOf('id="catch-button"'));
  expect(outcome).toBeLessThan(html.indexOf('<details class="invitation-settings">'));
});

it('设置可提交每日上限与间隔，轮询显示配置值并保护正在编辑的次数', () => {
  const h = page({ wake: { lanes: { write: { count: 1, dayLimit: 5, intervalHours: 4 } }, history: [] } });
  expect(h.get('wake-write-status').textContent).toContain('今日 1/5');
  expect(h.get('wake-write-limit').value).toBe('5');
  h.document.activeElement = h.get('wake-write-limit');
  h.get('wake-write-limit').value = '6'; h.show();
  expect(h.get('wake-write-limit').value).toBe('6');
  h.get('wake-write-save').onclick();
  const [, options] = h.fetch.mock.calls[0] as unknown as [string, { body: string }];
  expect(JSON.parse(options.body)).toEqual({ action: 'write', command: 'interval', hours: 4, dayLimit: 6 });
});


it('新待办居中一次，普通轮询不打断阅读；新草稿和重新出现的信仍可定位', () => {
  const h = page(); const first = { scrollIntoView: vi.fn() }, replacement = { scrollIntoView: vi.fn() };
  h.desk([{ key: 'held:a', node: first }]);
  expect(first.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  h.desk([{ key: 'held:a', node: replacement }]);
  expect(replacement.scrollIntoView).not.toHaveBeenCalled();
  h.desk([{ key: 'draft:2', node: replacement }]);
  expect(replacement.scrollIntoView).toHaveBeenCalledTimes(1);
  h.desk([]); h.desk([{ key: 'held:a', node: first }]);
  expect(first.scrollIntoView).toHaveBeenCalledTimes(2);
});

it('反馈弹窗打开时延后定位，关闭后定位最新卡片且尊重减少动态效果', () => {
  const h = page({}, new Map(), true), first = { scrollIntoView: vi.fn() }, latest = { scrollIntoView: vi.fn() };
  h.get('feedback-dialog').open = true;
  h.desk([{ key: 'first', node: first }]); h.desk([{ key: 'latest', node: latest }]);
  expect(first.scrollIntoView).not.toHaveBeenCalled(); expect(latest.scrollIntoView).not.toHaveBeenCalled();
  h.get('feedback-dialog').close();
  expect(latest.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'center', inline: 'nearest' });
});

it('反馈入口位于顶栏，收集表预留按钮没有提前接入旧问卷', () => {
  const html = pageHtml();
  expect(html.indexOf('id="feedback-entry"')).toBeLessThan(html.indexOf('id="stage"'));
  expect(html).not.toContain('feedback-invite');expect(html).toContain('href="#i-feedback"');expect(html).toContain('https://docs.qq.com/form/page/DZm5DZ3d4V2JiUmt2');
  expect(html).toContain('class="feedback-version" aria-label="当前 World 版本号"');
  expect(html).toContain('src="/feedback-qr.png"');
  expect(html).not.toContain('反馈收集表 · 准备中');
  expect(html).not.toContain('wjx.cn');
});

it('自定义配色与背景从部署偏好恢复，切换基础主题不丢失背景', async () => {
  const background = 'a'.repeat(64) + '.png';
  const h = page({}, new Map(), false, {available:false, preference:{theme:'custom',mode:'dark',customColor:'#e08050',background}});
  expect(h.get('theme-name').textContent).toBe('我的颜色');
  expect(h.get('custom-color').value).toBe('#e08050');
  expect(h.document.documentElement.dataset.customBackground).toBe('true');
  expect(h.document.documentElement.style.setProperty).toHaveBeenCalledWith('--mailbox-background', 'url("/background/' + background + '")');
  h.get('theme-paper').onclick();
  expect(h.document.documentElement.style.setProperty).toHaveBeenCalledWith('--paper','');
  h.get('background-remove').onclick();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.parse((h.appearanceFetch.mock.calls.at(-1)![1] as any).body).background).toBe(null);
});

it('背景透明度仅在有图片时显示，拖动预览，松手保存', async()=>{
 const h=page();expect(h.get('background-options').hidden).toBe(true);
 const shown=page({},new Map(),false,{available:false,preference:{theme:'paper',mode:'light',background:'a'.repeat(64)+'.png',backgroundTransparency:35}});
 expect(shown.get('background-options').hidden).toBe(false);expect(shown.get('background-transparency').value).toBe('35');
 shown.get('background-transparency').value='62';shown.get('background-transparency').oninput();
 expect(shown.get('background-transparency-value').textContent).toBe('62%');expect(shown.appearanceFetch).not.toHaveBeenCalled();
 expect(shown.document.documentElement.style.setProperty).toHaveBeenCalledWith('--background-opacity','0.38');
 shown.get('background-transparency').onchange();await new Promise(resolve=>setTimeout(resolve,0));
 expect(JSON.parse((shown.appearanceFetch.mock.calls[0][1] as any).body).backgroundTransparency).toBe(62);
 shown.get('background-remove').onclick();expect(shown.get('background-options').hidden).toBe(true);
});


it('阅读字号拖动即保存，只更新正文字号变量', () => {
  const h = page();
  const set = h.document.documentElement.style.setProperty;
  expect(h.get('reader-size').value).toBe('26');
  set.mockClear();
  h.get('reader-size').value = '35';
  h.get('reader-size').oninput();
  expect(set.mock.calls).toEqual([['--letter-size', '35px']]);
  expect(h.get('reader-size-value').textContent).toBe('35 px');
  expect(h.preferences.get('bottle-reading-size')).toBe('35');
  expect(page({}, h.preferences).get('reader-size').value).toBe('35');
});
it.each([['garbage','26'],['0','26'],['','26'],['Infinity','26'],['999','40'],['12','18'],['27.6','28']])('保存的阅读字号 %s 安全恢复为 %s', (saved, expected) => {
  const h = page({}, new Map([['bottle-reading-size',saved]]));
  expect(h.get('reader-size').value).toBe(expected);
});
it('字号面板可展开与 Escape 收起，并恢复按钮焦点', () => {
  const h = page({}, new Map(), true);
  h.get('reader-toggle').onclick();
  expect(h.get('reader-panel').hidden).toBe(false);
  expect(h.get('reader-toggle').attrs['aria-expanded']).toBe('true');
  h.get('reader-tools').listeners.keydown({key:'Escape',preventDefault:vi.fn()});
  expect(h.get('reader-panel').hidden).toBe(true);
  expect(h.get('reader-toggle').focus).toHaveBeenCalled();
});

it('外观菜单直接显示默认写信笔迹，自定义选择优先且恢复默认不清空其他外观', () => {
 const h=page();
 expect(h.get('my-font-current').textContent).toContain('霞鹜悠哉（默认）');
 expect(h.get('my-font-name').textContent).toBe('霞鹜悠哉（默认）');
 expect(h.get('my-font-remove').disabled).toBe(true);
 const own=page({},new Map(),false,{available:false,preference:{theme:'paper',mode:'dark',myFont:'a'.repeat(64)+'.ttf',myFontName:'我的手写.ttf'}});
 expect(own.get('my-font-current').textContent).toContain('我的手写.ttf');
 expect(own.get('my-font-name').textContent).toBe('我的手写.ttf');
 own.get('my-font-remove').onclick();
 expect(own.get('my-font-current').textContent).toContain('霞鹜悠哉（默认）');
 expect(own.document.documentElement.dataset.theme).toBe('paper');
 expect(own.document.documentElement.dataset.appearance).toBe('dark');
});


it('网页提醒默认半小时、每日十二次，并校验提醒的独立范围', () => {
  const h = page();
  expect(h.get('wake-remind-hours').value).toBe('0.5');
  expect(h.get('wake-remind-limit').value).toBe('12');
  expect(h.get('wake-remind-status').textContent).toContain('0/12');
  for (const limit of [2, 21, 3.5]) {
    h.get('wake-remind-limit').value = String(limit);
    h.get('wake-remind-save').onclick();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.get('toast').textContent).toContain('3—20');
  }
  h.get('wake-remind-limit').value = '12';
  h.get('wake-remind-hours').value = '0.49';
  h.get('wake-remind-save').onclick();
  expect(h.fetch).not.toHaveBeenCalled();
  h.get('wake-remind-hours').value = '0.5';
  h.get('wake-remind-save').onclick();
  expect(h.fetch).toHaveBeenCalledWith('/wake', expect.objectContaining({ body: JSON.stringify({ action: 'remind', command: 'interval', hours: 0.5, dayLimit: 12 }) }));
});
