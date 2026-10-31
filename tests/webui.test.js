import { expect, it, vi } from 'vitest';
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
  const ctx = {
    root, language, signal: abort.signal,
    invoke: vi.fn().mockResolvedValue({url: 'http://127.0.0.1:7798/'}),
    interval: vi.fn(),
    ui: {
      h: node,
      button(label, options) {
        button = node('button', null, label);
        button.click = () => { if (!button.disabled) options.onClick(); };
        button.variant = options.variant;
        return button;
      },
    },
  };
  return { ctx, abort, open, button: () => button, note: () => root.children[0].children.at(-1) };
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
