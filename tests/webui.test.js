import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mailboxUrl, mountMailbox } from '../webui/client.ts';

function context(language = 'zh') {
  const open = vi.fn();
  const node = (tag, cls, text) => ({
    tag, textContent: text ?? '', children: [], disabled: false,
    classes: new Set((cls ?? '').split(' ').filter(Boolean)),
    append(...children) { this.children.push(...children); },
    classList: { add: vi.fn() },
  });
  const root = node('div');
  root.ownerDocument = { defaultView: { open } };
  const abort = new AbortController();
  let button;
  const buttons = [];
  const ctx = {
    root, language, signal: abort.signal,
    invoke: vi.fn().mockResolvedValue({url: 'http://127.0.0.1:7798/'}),
    interval: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    ui: {
      h: node,
      button(label, options) {
        const current = node('button', null, label);
        current.click = () => { if (!current.disabled) options.onClick(); };
        current.variant = options.variant;
        buttons.push(current);
        button ??= current;
        return current;
      },
    },
  };
  return { ctx, abort, open, buttons, button: () => button, note: () => root.children[0].children.at(-1) };
}

it.each([
  'javascript:alert(1)', 'https://example.invalid/', 'http://localhost:7796/',
  'http://127.0.0.1.evil.invalid:7796/', 'http://127.0.0.1:7796/other',
  'http://127.0.0.1:7796/?url=https://example.invalid/', 'http://user@127.0.0.1:7796/', null,
])('rejects non-mailbox destination %s', value => {
  expect(mailboxUrl(value)).toBeNull();
});

it('opens the actual fallback port from a filled button without a model call', async () => {
  const h = context();
  await mountMailbox(h.ctx);
  expect(h.button().textContent).toBe('打开信箱');
  expect(h.button().variant).toBe('primary');
  expect(h.button().disabled).toBe(false);
  expect(h.ctx.invoke).toHaveBeenCalledWith('status');
  h.button().click();
  expect(h.open).toHaveBeenCalledWith('http://127.0.0.1:7798/', '_blank', 'noopener,noreferrer');
  h.abort.abort();
  h.button().click();
  expect(h.open).toHaveBeenCalledTimes(1);
});

it('shows an English label and disables the button until a mailbox is running', async () => {
  const h = context('en');
  h.ctx.invoke.mockResolvedValueOnce({url:null});
  await mountMailbox(h.ctx);
  expect(h.button().textContent).toBe('Open mailbox');
  expect(h.button().disabled).toBe(true);
  expect(h.note().textContent).toContain('not running');
  const refresh = h.ctx.interval.mock.calls[0][0];
  refresh();
  await vi.waitFor(() => expect(h.button().disabled).toBe(false));
  h.button().click();
  expect(h.open).toHaveBeenCalledTimes(1);
});

it('disables stale links after RPC failure and recovers on the next refresh', async () => {
  const h = context();
  await mountMailbox(h.ctx);
  h.ctx.invoke.mockRejectedValueOnce(new Error('offline'));
  const refresh = h.ctx.interval.mock.calls[0][0];
  refresh();
  await vi.waitFor(() => expect(h.button().disabled).toBe(true));
  expect(h.note().textContent).toContain('暂时没找到信箱');
  h.button().click();
  expect(h.open).not.toHaveBeenCalled();
  refresh();
  await vi.waitFor(() => expect(h.button().disabled).toBe(false));
});

it('does not update an unmounted panel after a pending request completes', async () => {
  const h = context();
  let resolve;
  h.ctx.invoke.mockReturnValue(new Promise(done => { resolve = done; }));
  const mounted = mountMailbox(h.ctx);
  h.abort.abort();
  resolve({url:'http://127.0.0.1:7796/'});
  await mounted;
  expect(h.button().disabled).toBe(true);
  expect(h.ctx.interval).not.toHaveBeenCalled();
});

it('persists pause/resume choices and displays exhausted-task failures without any internal ID', async () => {
  const h = context();
  const wake = {
    lanes: { write: { paused: false, declined: false, failed: false, count: 2 }, catch: { paused: true, count: 0 } },
    history: [{ id: 'private-task-id', action: 'write', result: 'failed' }],
  };
  h.ctx.invoke.mockImplementation(async (method, args) => {
    if (method === 'wake') {
      wake.lanes[args[0]].paused = args[1] === 'pause';
      return {ok:true};
    }
    return {url:'http://127.0.0.1:7798/', wake};
  });
  await mountMailbox(h.ctx);
  expect(h.buttons[1].textContent).toBe('暂停邀请');
  expect(h.buttons[3].textContent).toBe('恢复邀请');
  const outcome = h.ctx.root.children[1].children.at(-1);
  expect(outcome.textContent).toContain('重试后仍未完成');
  expect(outcome.textContent).not.toContain('private-task-id');
  h.buttons[1].click();
  await vi.waitFor(() => expect(h.buttons[1].textContent).toBe('恢复邀请'));
  expect(h.ctx.invoke).toHaveBeenCalledWith('wake', ['write', 'pause']);
  h.buttons[1].click();
  await vi.waitFor(() => expect(h.buttons[1].textContent).toBe('暂停邀请'));
  expect(h.ctx.invoke).toHaveBeenCalledWith('wake', ['write', 'resume']);
});


it('refreshes the host header through its public API on the mailbox tab, without touching host DOM', async () => {
  const h = context(); await mountMailbox(h.ctx);
  expect(h.ctx.refresh).toHaveBeenCalledTimes(1);
  expect(h.ctx.interval).toHaveBeenCalledWith(expect.any(Function), 5000);
  h.ctx.interval.mock.calls[0][0]();
  await vi.waitFor(() => expect(h.ctx.refresh).toHaveBeenCalledTimes(2));
});
it('a header refresh error does not hide an otherwise working mailbox entry', async () => {
  const h = context(); h.ctx.refresh.mockRejectedValue(new Error('manifest unavailable'));
  await mountMailbox(h.ctx);
  expect(h.button().disabled).toBe(false);
  expect(h.note().textContent).toContain('顶栏暂未同步');
});
it('the panel interval control invokes the same validated wake settings endpoint', async () => {
  const h = context();
  const wake = { lanes: { write: { count: 0, intervalHours: 2 }, catch: { count: 0 }, remind: { count: 0 } }, history: [] };
  h.ctx.invoke.mockImplementation(async (method, args) => {
    if (method === 'wake') { wake.lanes.write.intervalHours = args[2]; return { ok: true }; }
    return { url: 'http://127.0.0.1:7798/', wake };
  });
  await mountMailbox(h.ctx);
  const row = h.ctx.root.children[1].children[1];
  const input = row.children[1].children[0]; input.value = '8';
  h.buttons[2].click();
  await vi.waitFor(() => expect(h.ctx.invoke).toHaveBeenCalledWith('wake', ['write', 'interval', 8]));
});


it('shows no_idea as a voluntary choice, never as an exhausted failure', async () => {
  const h = context();
  h.ctx.invoke.mockResolvedValue({ url: 'http://127.0.0.1:7798/', wake: {
    lanes: { write: { count: 1 }, catch: { count: 0 }, remind: { count: 0 } },
    history: [{ action: 'write', result: 'deferred', reason: 'no_idea' }],
  } });
  await mountMailbox(h.ctx);
  const outcome = h.ctx.root.children[1].children.at(-1).textContent;
  expect(outcome).toContain('暂时没有灵感'); expect(outcome).toContain('不算失败');
  expect(outcome).not.toContain('未完成');
});


it('the manifest points to content-addressed JS/CSS, with the current invitation controls in the shipped bundle', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  for (const [key, extension] of [['webUiClient', 'js'], ['webUiStyle', 'css']]) {
    const path = manifest.cortico[key];
    const bytes = readFileSync(new URL(path, root));
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    expect(path).toBe(`dist/webui-${hash}.${extension}`);
    expect(bytes.equals(readFileSync(new URL(`dist/webui.${extension}`, root)))).toBe(true);
  }
  const bundled = await import(new URL(manifest.cortico.webUiClient, root).href);
  const h = context();
  h.ctx.invoke.mockResolvedValue({ url: 'http://127.0.0.1:7798/', wake: { lanes: {
    write: { paused: false, intervalHours: 4 }, catch: { paused: true, intervalHours: 6 },
    remind: { paused: false, intervalHours: 8 },
  }, history: [] } });
  await bundled.default.panels.mailbox.mount(h.ctx);
  const settings = h.ctx.root.children[1];
  expect(settings.children[0].textContent).toBe('海边的邀请');
  expect(settings.children.filter(n => n.classes.has('bottle-wake-row'))).toHaveLength(3);
  expect(h.buttons.filter(n => n.textContent === '调整')).toHaveLength(3);
  expect(h.buttons.filter(n => n.textContent === '暂停邀请')).toHaveLength(2);
  expect(h.buttons.filter(n => n.textContent === '恢复邀请')).toHaveLength(1);
});
