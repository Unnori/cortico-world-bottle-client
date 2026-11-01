import { Script } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { BUILTIN_PALETTES } from 'cortico/web/shared/theme.ts';
import type { MailboxTheme } from '../world/theme.ts';
import { pageHtml } from '../world/page-view.ts';

/** Execute the real page handlers with a tiny DOM; no browser/network dependency. */
function page(snapshot: Record<string, unknown> = {}, preferences = new Map<string, string>(), reduce = false, host: MailboxTheme = { available: false }) {
  const nodes = new Map<string, any>();
  const get = (id: string): any => {
    if (!nodes.has(id)) nodes.set(id, { id, textContent: '', value: '', disabled: false, attrs: {}, open: false, hidden: id === 'theme-menu', listeners: {},
      contains(target: any) { return target === this || (id === 'theme-picker' && target.id?.startsWith('theme-')); },
      getAttribute(key: string) { return this.attrs[key] ?? null; },
      addEventListener(type: string, fn: (event?: unknown) => void) { this.listeners[type] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); }, focus: vi.fn(),
      getBoundingClientRect() { return { left: 100, right: 500, top: 100, bottom: 500 }; },
      setAttribute(key: string, value: string) { this.attrs[key] = value; }, removeAttribute(key: string) { delete this.attrs[key]; } });
    return nodes.get(id);
  };
  get('host-theme').textContent = JSON.stringify(host);
  const darkMedia = { matches: false, listener: () => {}, addEventListener(_event: string, listener: () => void) { this.listener = listener; } };
  const appearanceFetch = vi.fn(async (_path: string, _options?: unknown) => ({ ok: true }));
  const fetch = vi.fn(() => new Promise(() => {}));
  const timeout = vi.fn();
  const clearTimeout = vi.fn();
  const state = { botName: '小满', letterDraft: null, pendingAction: null, received: [], sent: [], held: null,
    wake: { lanes: { write: { count: 0 }, catch: { count: 0 }, remind: { count: 0 } }, history: [] }, ...snapshot };
  const script = pageHtml().match(/<script>([\s\S]*?)<\/script>/)![1].replace(/  refresh\(\);\s*\}\)\(\);\s*$/, '  globalThis.actions = { toast: toast, sync: refreshHostTheme, show: function(s) { state = s; renderActionState(s.letterDraft); } };\n})();');
  const listeners: Record<string, (event: any) => void> = {};
  const windowListeners: Record<string, (event: any) => void> = {};
  const sandbox: any = { document: { documentElement: { dataset: {}, style: { setProperty: vi.fn() } }, getElementById: get, querySelectorAll: () => [],
      addEventListener(type: string, fn: (event: any) => void) { listeners[type] = fn; }, hidden: false },
    localStorage: { getItem: (key: string) => preferences.get(key), setItem: (key: string, value: string) => preferences.set(key, value) },
    fetch: (path: string, options?: unknown) => path === '/appearance' ? appearanceFetch(path as any, options as any) : (options === undefined ? (fetch as any)(path) : (fetch as any)(path, options)), setInterval: vi.fn(), clearTimeout, setTimeout: timeout,
    getComputedStyle: () => ({ paddingTop: '0', paddingBottom: '0', borderTopWidth: '1', borderBottomWidth: '1' }),
    window: { matchMedia: (query: string) => query.includes('color-scheme') ? darkMedia : ({ matches: reduce }), addEventListener(type: string, fn: (event: any) => void) { windowListeners[type] = fn; } }, Date };
  expect(script).toContain('globalThis.actions =');
  new Script(script).runInNewContext(sandbox);
  sandbox.actions.show(state);
  return { appearanceFetch, toast: sandbox.actions.toast, timeout, clearTimeout, sync: sandbox.actions.sync, darkMedia, get, fetch, state, preferences, listeners, windowListeners, document: sandbox.document, show: () => sandbox.actions.show(state) };
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


it('页脚的反馈入口弹出小卡片，关闭和点遮罩会收起，并将焦点交还入口', () => {
  const h = page(); const dialog = h.get('feedback-dialog'); const entry = h.get('feedback-entry');
  entry.onclick(); expect(dialog.open).toBe(true);
  h.get('feedback-close').onclick(); expect(dialog.open).toBe(false); expect(entry.focus).toHaveBeenCalled();
  entry.onclick(); dialog.listeners.click({ target: dialog, clientX: 150, clientY: 150 }); expect(dialog.open).toBe(true);
  dialog.listeners.click({ target: dialog, clientX: 50, clientY: 50 }); expect(dialog.open).toBe(false);
  expect(h.fetch).not.toHaveBeenCalled();
  const html = pageHtml();
  expect(html).toContain('想对毛球说…');
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


it('默认潮蓝，三个主题可切换并记住偏好，只读宿主配色', () => {
  const h = page();
  expect(h.document.documentElement.dataset.theme).toBe('ocean');
  for (const theme of ['paper', 'coopanion', 'ocean']) {
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
  for (const theme of ['ocean', 'paper', 'coopanion']) {
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
  expect(requests).toEqual([{ theme:'paper', mode:'system' }, { theme:'paper', mode:'dark' }]);
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
