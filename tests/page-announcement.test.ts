import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { announcementDismissScript, announcementLinksScript } from '../world/page-announcement.ts';

function render(text: string) {
  const children: Array<{ tag: string; textContent: string; href?: string; target?: string; rel?: string }> = [];
  const container = { appendChild: (node: typeof children[number]) => children.push(node) };
  const context = { container, text, URL, document: {
    createTextNode: (textContent: string) => ({ tag: '#text', textContent }),
    createElement: (tag: string) => ({ tag, textContent: '' }),
  } };
  runInNewContext(announcementLinksScript + '\nappendAnnouncementText(container, text);', context);
  return { text: children.map(node => node.textContent).join(''), links: children.filter(node => node.tag === 'a') };
}

it('links HTTP/HTTPS announcements, preserving newlines and opening an isolated new tab', () => {
  const text = '留张便笺：https://docs.qq.com/form/page/DZm5DZ3d4V2JiUmt2\n另一个入口 http://example.test/path?a=1&b=2#letter';
  const result = render(text);
  expect(result.text).toBe(text);
  expect(result.links.map(link => link.href)).toEqual(['https://docs.qq.com/form/page/DZm5DZ3d4V2JiUmt2', 'http://example.test/path?a=1&b=2#letter']);
  for (const link of result.links) expect(link).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
});
it('keeps Chinese punctuation and unmatched English brackets outside the URL', () => {
  const text = '打开（https://example.test/a）。也可以 (https://example.test/b).';
  const result = render(text);
  expect(result.text).toBe(text);
  expect(result.links.map(link => link.href)).toEqual(['https://example.test/a', 'https://example.test/b']);
});
it('preserves balanced URL brackets, queries, fragments and non-ASCII text', () => {
  const text = 'HTTPS://example.test/wiki/海风_(来信)?a=1#回信';
  const result = render(text);
  expect(result.text).toBe(text);
  expect(result.links[0]?.href).toBe(new URL(text).href);
});
it.each(['javascript:alert(1)', 'data:text/html,<svg onload=alert(1)>', 'file:///private', 'https://user:secret@example.test/path', 'https://', '普通文字，没有链接'])('does not turn unsafe/invalid content into links: %s', text => {
  expect(render(text)).toEqual({ text, links: [] });
});
it('renders supplied HTML as text and never turns it into executable markup', () => {
  const text = '<img src=x onerror=alert(1)> https://example.test/" onclick="alert(1)';
  const result = render(text);
  expect(result.text).toBe(text);
  expect(result.links).toEqual([{ tag: 'a', textContent: 'https://example.test/', href: 'https://example.test/', target: '_blank', rel: 'noopener noreferrer' }]);
});


function browserDismissal(storage = new Map<string, string>(), unavailable = false) {
  let storageChanged: ((event: { key: string | null; newValue: string | null }) => void) | undefined;
  const repaint = vi.fn();
  const context: any = {
    localStorage: {
      getItem: (key: string) => { if (unavailable) throw new Error('storage unavailable'); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (unavailable) throw new Error('storage unavailable'); storage.set(key, value); },
    },
    window: { addEventListener: (_name: string, listener: typeof storageChanged) => { storageChanged = listener; } },
    state: {}, renderNotices: repaint,
  };
  runInNewContext(announcementDismissScript, context);
  return { context, storage, repaint, changed: (value: string | null) => storageChanged!({ key: 'bottle-announcement-dismissed-session', newValue: value }) };
}

it('dismissal survives refresh/reopening for this browser and hides all announcements until World restarts', () => {
  const browser = browserDismissal();
  browser.context.syncAnnouncementSession('world-start-one');
  expect(browser.context.pageAnnouncementsDismissed()).toBe(false);
  browser.context.dismissPageAnnouncements();
  expect(browser.context.pageAnnouncementsDismissed()).toBe(true);
  const reloaded = browserDismissal(browser.storage);
  reloaded.context.syncAnnouncementSession('world-start-one');
  expect(reloaded.context.pageAnnouncementsDismissed()).toBe(true);
  // Dismissal is keyed to the World lifetime, not a particular announcement ID.
  reloaded.context.syncAnnouncementSession('world-start-one');
  expect(reloaded.context.pageAnnouncementsDismissed()).toBe(true);
  reloaded.context.syncAnnouncementSession('world-start-two');
  expect(reloaded.context.pageAnnouncementsDismissed()).toBe(false);
});
it('another browser/device keeps its independent announcement visibility', () => {
  const first = browserDismissal(), second = browserDismissal();
  for (const browser of [first, second]) browser.context.syncAnnouncementSession('same-world-start');
  first.context.dismissPageAnnouncements();
  expect(first.context.pageAnnouncementsDismissed()).toBe(true);
  expect(second.context.pageAnnouncementsDismissed()).toBe(false);
});
it('other tabs in the same browser immediately follow the local storage event', () => {
  const browser = browserDismissal();browser.context.syncAnnouncementSession('world-start');
  browser.changed('world-start');
  expect(browser.context.pageAnnouncementsDismissed()).toBe(true);
  expect(browser.repaint).toHaveBeenCalledOnce();
  browser.changed(null);
  expect(browser.context.pageAnnouncementsDismissed()).toBe(false);
});
it('unavailable browser storage still allows dismissal for the current tab', () => {
  const browser = browserDismissal(undefined, true);browser.context.syncAnnouncementSession('world-start');
  expect(() => browser.context.dismissPageAnnouncements()).not.toThrow();
  expect(browser.context.pageAnnouncementsDismissed()).toBe(true);
  browser.context.syncAnnouncementSession('world-restarted');
  expect(browser.context.pageAnnouncementsDismissed()).toBe(false);
});
