import { Script, createContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { pageHtml } from '../world/page-view.ts';
import { starHtml, starScript, starStyles } from '../world/page-stars.ts';

/** Small DOM for the actual star handlers and existing archive renderers. */
class Node {
  children: Node[] = [];
  parentElement?: Node;
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  private text = '';
  value = '';
  checked = false;
  disabled = false;
  open = false;
  type = '';
  id = '';
  title = '';
  onclick?: (event?: any) => void;
  onchange?: () => void;
  _foldAnimation?: { cancel: () => void } | null;
  focus = vi.fn();
  scrollIntoView = vi.fn();
  classList = { add: (name: string) => { this.className += ' ' + name; } };
  constructor(readonly tagName: string) {}
  set textContent(text: string) { this.text = String(text); this.children = []; }
  get textContent(): string { return this.text + this.children.map(node => node.textContent).join(''); }
  set innerHTML(value: string) { if (value) throw new Error('Only an empty DOM reset is allowed'); this.textContent = ''; }
  appendChild(node: Node) { node.parentElement = this; this.children.push(node); return node; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; if (key === 'class') this.className = value; }
  getAttribute(key: string) { return this.attrs[key] ?? null; }
  removeAttribute(key: string) { delete this.attrs[key]; }
  matches(selector: string): boolean {
    if (selector === '[data-star-control]') return !!this.dataset.starControl;
    if (selector === 'details[data-fold-key]') return this.tagName === 'details' && !!this.dataset.foldKey;
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName === selector;
  }
  querySelectorAll(selector: string): Node[] { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector: string): Node | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
}

function rig(overrides: Record<string, any> = {}, reduce = false) {
  const root = new Node('body');
  const nodes = new Map<string, Node>();
  const get = (id: string) => {
    if (!nodes.has(id)) { const node = new Node('div'); node.id = id; root.appendChild(node); nodes.set(id, node); }
    return nodes.get(id)!;
  };
  const state = { botName: '小满', sent: [], received: [], held: null, stars: [], ...overrides };
  const ctx: any = createContext({ state, paperRows:new Map(), paperComposer:get('paper-compose'), attachPapers:vi.fn(), category: 'received', openedLetters: Object.create(null), busy: false,
    document: { getElementById: get, createElement: (tag: string) => new Node(tag), createElementNS: (_ns: string, tag: string) => new Node(tag),
      querySelectorAll: (selector: string) => selector === '#stage .letter-star' ? get('stage').querySelectorAll('.letter-star') : root.querySelectorAll(selector) },
    botName: () => state.botName, api: vi.fn(async () => ({ ok: true })), refresh: vi.fn(async () => {}), toast: vi.fn(),
    reducedMotion: () => reduce, savePref: vi.fn(), captureDetails: vi.fn(), animateArrival: (node: Node) => node,
    rememberDetails: (node: Node, key: string) => { node.dataset.foldKey = key; node.open = ctx.openedLetters[key] === true; return node; },
    icon: () => new Node('svg'), sentSourceText: () => '寄出的信', sentStateBadge: () => new Node('span'), readBadge: () => new Node('span'),
    letterSheet: () => new Node('div'), buttons: () => new Node('div'), paperInvite: () => new Node('button'), peruseLink: () => new Node('button'), deleteLink: () => new Node('button') });
  const script = pageHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
  new Script(script.slice(script.indexOf('  function dateKey('), script.indexOf('  function api('))).runInContext(ctx);
  new Script(script.slice(script.indexOf('  function fmt('), script.indexOf('  function run('))).runInContext(ctx);
  new Script(script.slice(script.indexOf('  function renderHeld('), script.indexOf('  function focusDeskArrival('))).runInContext(ctx);
  new Script(script.slice(script.indexOf('  function bookEntries('), script.indexOf('  function peruseLink('))).runInContext(ctx);
  new Script(starScript).runInContext(ctx);
  function renderStars() { ctx.category = 'stars'; ctx.renderBook(); return get('mail-list'); }
  return { ctx, state, root, get, renderStars };
}

const letter = { letterId: 'sent:id"[]', body: 'PRIVATE original', topic: '星夜', at: '2026-11-01T12:00:00Z',
  reply: { from: '海上来客', body: 'PRIVATE reply', at: '2026-11-02T12:00:00Z' } };
const row = { letterId: letter.letterId, starredAt: 10, title: '星夜', from: '海上来客', at: letter.at,
  category: 'sent', memorySelected: false, memoryActive: false };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

it('uses the exact supplied SVG path in the folder and buttons, gold when pressed, with reduced motion support', () => {
  const h = rig({ stars: [row] });
  const button = h.ctx.starButton(row.letterId) as Node;
  expect(button.getAttribute('aria-pressed')).toBe('true');
  const svg = button.querySelector('svg')!;
  expect(svg.getAttribute('viewBox')).toBe('0 0 1024 1024');
  expect(starHtml).toContain('d="' + svg.querySelector('path')!.getAttribute('d') + '"');
  expect(svg.querySelector('path')!.getAttribute('d')).toMatch(/^M908\.1 353\.1l-253\.9/);
  expect(starStyles).toContain('[aria-pressed="true"] .star-icon { color:var(--star-gold)');
  expect(starStyles).toContain('@media(prefers-reduced-motion:reduce)');
});

it('deduplicates sent and reply stars into one row and count, and navigates to the reply with the date filter cleared', () => {
  const h = rig({ sent: [letter], stars: [row, { ...row, category: 'reply', title: '来客的回信', starredAt: 11 }] });
  let list = h.renderStars();
  expect(h.get('stars-count').textContent).toBe('1');
  expect(list.querySelectorAll('.star-row')).toHaveLength(1);
  h.get('letter-date').value = '1999-01-01';
  list.querySelector('.star-open')!.onclick!();
  expect(h.ctx.category).toBe('reply');
  expect(h.get('letter-date').value).toBe('');
  expect(h.ctx.savePref).toHaveBeenCalledWith('bottle-category', 'reply');
  expect(h.get('letterbook').open).toBe(true);
  list = h.get('mail-list');
  const mail = list.querySelector('details')!;
  expect(mail.dataset.foldKey).toBe('reply:' + letter.letterId);
  expect(mail.open).toBe(true);
  expect(mail.children.map(node => node.tagName)).toEqual(['summary', 'div']);
  expect(mail.querySelector('summary')!.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(mail.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' });
});

it.each([['received', false], ['seed', true]])('jumps to the actual %s folder, opens its correspondence, and respects reduced motion', (category, seed) => {
  const received = { letterId: 'received', body: 'PRIVATE received', seed, at: row.at, from: '海上来客' };
  const h = rig({ received: [received], stars: [{ ...row, letterId: 'received', category }] }, true);
  const list = h.renderStars();
  list.querySelector('.star-open')!.onclick!();
  expect(h.ctx.category).toBe(category);
  const mail = h.get('mail-list').querySelector('details')!;
  expect(mail.open).toBe(true);
  expect(mail.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center', behavior: 'instant' }));
});

it('sent correspondence without a reply opens the sent folder', () => {
  const h = rig({ sent: [{ ...letter, reply: undefined }], stars: [row] });
  h.renderStars().querySelector('.star-open')!.onclick!();
  expect(h.ctx.category).toBe('sent');
  expect(h.get('mail-list').querySelector('details')!.open).toBe(true);
});

it('all persisted correspondence surfaces expose the same aria-pressed star without changing summary/body children', () => {
  const received = { ...letter, from: '来客', seed: false, reply: undefined, letterId: 'received' };
  const h = rig({ sent: [letter], received: [received, { ...received, seed: true, letterId: 'seed' }], stars: [row] });
  for (const entry of h.ctx.bookEntries()) {
    const mail = h.ctx.renderMail(entry) as Node;
    expect(mail.children.map(node => node.tagName)).toEqual(['summary', 'div']);
    expect(mail.querySelector('summary')!.children.map(node => node.className)).toEqual(['mail-symbol', 'mail-subject', 'mail-badges', 'mail-chevron']);
    const button = mail.querySelector('.letter-star')!;
    expect(button.dataset.letterId).toBe(entry.item.letterId);
    expect(button.getAttribute('aria-pressed')).toBe(String(entry.item.letterId === letter.letterId));
  }
});

it.each([{}, { seed: true }, { dead: true }])('held mail exposes an accessible star for %j', flags => {
  const h = rig({ stars: [row] });
  const card = h.ctx.renderHeld({ held: { ...letter, from: '来客', ...flags } }) as Node;
  const button = card.querySelector('.letter-star')!;
  expect(button.dataset.letterId).toBe(row.letterId);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.getAttribute('aria-label')).toBe('移出星笺匣');
});

it('stars alone never select memory; default global off disables the obvious per-letter checkbox and sends no enabling request', async () => {
  const h = rig({ stars: [{ ...row, memorySelected: true, memoryActive: true }] });
  const list = h.renderStars();
  const choice = list.querySelector('.star-memory-choice')!;
  const input = choice.querySelector('input')!;
  expect(input.disabled).toBe(true);
  expect(input.checked).toBe(false);
  expect(choice.textContent).toContain('让小满记住');
  expect(choice.textContent).toContain('全局已关闭 · 未授权');
  input.checked = true; input.onchange!();
  await flush();
  expect(h.ctx.api).not.toHaveBeenCalled();
  expect(list.querySelector('.star-memory-global')!.querySelector('input')!.checked).toBe(false);
  expect(list.textContent).toContain('不会把正文提供给小满');
  expect(list.textContent).toContain('关闭总开关也会清空逐封选择');
  expect(list.textContent).toContain('不会撤回已经进入对话上下文或摘要的内容');
});

it.each([[false, false, '未授权记忆'], [true, false, '尚未生效'], [true, true, '记忆已生效']])('shows the selected=%s active=%s status independently of being starred', (selected, active, text) => {
  const h = rig({ starMemoryEnabled: true, stars: [{ ...row, memorySelected: selected, memoryActive: active }] });
  const choice = h.renderStars().querySelector('.star-memory-choice')!;
  expect(choice.querySelector('input')!.disabled).toBe(false);
  expect(choice.querySelector('input')!.checked).toBe(selected);
  expect(choice.textContent).toContain(text);
});

it('sends only the supplied ID and boolean for star/memory/global changes and refreshes the snapshot', async () => {
  const h = rig({ starMemoryEnabled: true, stars: [row] });
  const list = h.renderStars();
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  list.querySelector('.letter-star')!.onclick!(event);
  await flush();
  expect(event.preventDefault).toHaveBeenCalled(); expect(event.stopPropagation).toHaveBeenCalled();
  expect(h.ctx.api).toHaveBeenLastCalledWith('/star', { letterId: row.letterId, starred: false });
  const input = list.querySelector('.star-memory-choice')!.querySelector('input')!;
  input.checked = true; input.onchange!();
  await flush();
  expect(h.ctx.api).toHaveBeenLastCalledWith('/star-memory', { letterId: row.letterId, enabled: true });
  expect(input.checked).toBe(false); // Until the authoritative snapshot arrives.
  const global = list.querySelector('.star-memory-global')!.querySelector('input')!;
  global.checked = false; global.onchange!();
  await flush();
  expect(h.ctx.api).toHaveBeenLastCalledWith('/star-memory-setting', { enabled: false });
  expect(h.ctx.refresh).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(h.ctx.api.mock.calls)).not.toContain('PRIVATE');
});

it('serializes changes through snapshot refresh and restores controls after failures without changing selections', async () => {
  const h = rig({ starMemoryEnabled: true, stars: [row] });
  const list = h.renderStars();
  let resolve!: (result: unknown) => void;
  h.ctx.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const input = list.querySelector('.star-memory-choice')!.querySelector('input')!;
  input.checked = true; input.onchange!();
  expect(list.querySelectorAll('input').every(node => node.disabled)).toBe(true);
  expect(input.checked).toBe(false);
  const ignored = h.ctx.changeStar('/star', { letterId: row.letterId, starred: false });
  expect(ignored).toBeUndefined(); expect(h.ctx.api).toHaveBeenCalledTimes(1);
  resolve({ ok: false, message: '保存失败' }); await flush();
  expect(h.ctx.toast).toHaveBeenCalledWith('保存失败', true);
  expect(input.disabled).toBe(false); expect(input.checked).toBe(false);
  h.ctx.api.mockRejectedValueOnce(new Error('offline'));
  input.checked = true; input.onchange!(); await flush();
  expect(input.disabled).toBe(false); expect(input.checked).toBe(false);
});

it('keeps external bot names, titles, and sources literal without parsing HTML', () => {
  const name = '<img src=x onerror=alert(1)>';
  const h = rig({ botName: name, stars: [{ ...row, title: name, from: name }] });
  const list = h.renderStars();
  expect(list.textContent).toContain('让' + name + '记住');
  expect(list.querySelector('.star-open')!.textContent).toContain(name);
  expect(list.querySelectorAll('img')).toHaveLength(0);
});

it('handles an empty or date-filtered star folder without hiding the global privacy control', () => {
  const h = rig();
  expect(h.renderStars().textContent).toContain('星笺匣还空着');
  h.state.stars = [row] as any;
  h.get('letter-date').value = '1999-01-01';
  const list = h.renderStars();
  expect(h.get('stars-count').textContent).toBe('1');
  expect(list.textContent).toContain('这一天，没有星标通信');
  expect(list.querySelector('.star-memory-global')).toBeTruthy();
});

it('new star asks for consent; choosing only collection never enables memory',async()=>{
  const h=rig();h.ctx.starButton('new').onclick({preventDefault(){},stopPropagation(){}});await flush();
  expect(h.ctx.api).toHaveBeenCalledWith('/star',{letterId:'new',starred:true});
  expect(h.get('star-consent-dialog').open).toBe(true);
  expect(h.get('star-consent-title').textContent).toContain('小满');
  h.get('star-consent-no').onclick!();expect(h.get('star-consent-dialog').open).toBe(false);
  expect(h.ctx.api).not.toHaveBeenCalledWith('/star-memory',expect.anything());
});
it('consenting explicitly enables the master switch and authorizes only that correspondence',async()=>{
  const h=rig();h.ctx.askStarMemory('one');await h.get('star-consent-yes').onclick!();
  expect(h.ctx.api.mock.calls.map((a:any[])=>a[0])).toEqual(['/star-memory-setting','/star-memory']);
  expect(h.ctx.api).toHaveBeenCalledWith('/star-memory',{letterId:'one',enabled:true});
  expect(h.get('star-consent-dialog').open).toBe(false);
});
it('unstar does not open another memory consent prompt',async()=>{
  const h=rig({stars:[row]});h.ctx.starButton(row.letterId).onclick({preventDefault(){},stopPropagation(){}});await flush();
  expect(h.get('star-consent-dialog').open).toBe(false);expect(h.ctx.api).toHaveBeenCalledWith('/star',{letterId:row.letterId,starred:false});
});

it('keeps the same expanded letter DOM when only quota or paper rewrite state changes',()=>{
  const h=rig({sent:[letter]});h.ctx.category='reply';h.ctx.renderBook();
  const list=h.get('mail-list'), mail=list.querySelector('.mail');mail!.open=true;
  h.ctx.state.quota={bottles_left:1,catches_left:2};h.ctx.state.noteRewriting=true;h.ctx.renderBook();
  expect(list.querySelector('.mail')).toBe(mail);expect(mail!.open).toBe(true);
  expect(h.ctx.attachPapers).toHaveBeenCalledTimes(2);
});
it('updates the book on letter changes and category/date selection instead of caching stale mail',()=>{
  const h=rig({sent:[{...letter}]});h.ctx.category='reply';h.ctx.renderBook();
  const list=h.get('mail-list'), mail=list.querySelector('.mail');
  h.ctx.state.sent[0]={...letter,reply:{...letter.reply,readCount:2}};h.ctx.renderBook();
  expect(list.querySelector('.mail')).not.toBe(mail);
  h.get('letter-date').value='1999-01-01';h.ctx.renderBook();expect(list.querySelector('.mail')).toBeNull();
  h.get('letter-date').value='';h.ctx.category='sent';h.ctx.renderBook();expect(list.querySelector('.sent')).toBeTruthy();
});
it('keeps paper invitations below the correspondence actions, not mixed with together-reading',()=>{
  const h=rig({sent:[letter]});h.ctx.category='reply';h.ctx.renderBook();
  const body=h.get('mail-list').querySelector('.mail-body')!;
  const foot=body.querySelector('.mail-foot')!,tray=body.querySelector('.paper-tray')!;
  expect(body.children.indexOf(tray)).toBeGreaterThan(body.children.indexOf(foot));
  expect(foot.querySelector('.paper-invite')).toBeNull();
  expect(tray.querySelector('.paper-invite')).toBeTruthy();expect(tray.querySelector('.paper-slot')).toBeTruthy();
});
