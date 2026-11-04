import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { readerHtml, readerScript, readerStyles } from '../world/page-reader.ts';
import { pageStyles } from '../world/page-style.ts';

// Execute the shipped inline script with only reader nodes; no server, letters or app state.
class Node {
  style: Record<string, any> = { setProperty: (key: string, value: string) => { this.style[key] = value; } };
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners: Array<{ type: string; handler: (event: any) => void; capture: boolean }> = [];
  parent: Node | undefined;
  hidden = false;
  value = '';
  textContent = '';
  naturalWidth = 44;
  naturalHeight = 86;
  focus = vi.fn();
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  onclick?: (event: any) => void;
  oninput?: () => void;
  constructor(readonly id: string) {}
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  getAttribute(key: string) { return this.attributes[key]; }
  addEventListener(type: string, handler: (event: any) => void, options: boolean | { capture?: boolean; passive?: boolean } = false) {
    this.listeners.push({ type, handler, capture: typeof options === 'boolean' ? options : options.capture === true });
  }
  contains(other: Node): boolean { return other === this || !!other?.parent && this.contains(other.parent); }
  get offsetWidth() { return parseFloat(this.style.width) || this.naturalWidth; }
  get offsetHeight() { return Math.min(this.naturalHeight, parseFloat(this.style.maxHeight) || Infinity); }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    const origin = this.id === 'reader-panel' ? this.parent!.getBoundingClientRect() : { left: 0, top: 0 };
    return { left: origin.left + (parseFloat(this.style.left) || 0), top: origin.top + (parseFloat(this.style.top) || 0), width: this.offsetWidth, height: this.offsetHeight };
  }
}

function browser(options: { width?: number; height?: number; saved?: string; storage?: Map<string, string>; reduced?: boolean; blocked?: boolean; visual?: boolean } = {}) {
  const storage = options.storage ?? new Map<string, string>();
  if (options.saved !== undefined) storage.set('bottle-reader-dock', options.saved);
  const ids = [...readerHtml.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  const nodes = new Map(ids.map(id => [id, new Node(id)]));
  const node = (id: string) => nodes.get(id)!;
  const tools = node('reader-tools'), toggle = node('reader-toggle'), panel = node('reader-panel'), move = toggle;
  const document = new Node('document'), root = new Node('root');
  tools.parent = document;
  for (const n of nodes.values()) if (n !== tools) n.parent = tools;
  for (const id of ['reader-size', 'reader-size-value']) node(id).parent = panel;
  const toggleText = new Node('toggle-text'); toggleText.parent = toggle;
  panel.hidden = true; panel.naturalWidth = 232; panel.naturalHeight = 254;
  toggle.setAttribute('aria-expanded', 'false');
  const safe = { paddingTop: '8px', paddingRight: '8px', paddingBottom: '8px', paddingLeft: '8px' };
  const window = Object.assign(new Node('window'), {
    innerWidth: options.width ?? 1000, innerHeight: options.height ?? 800,
    getComputedStyle: () => safe,
    visualViewport: options.visual ? Object.assign(new Node('viewport'), { offsetLeft: 0, offsetTop: 0, width: options.width ?? 1000, height: options.height ?? 800 }) : undefined,
  });
  const savePref = vi.fn((key: string, value: string) => { if (!options.blocked) storage.set(key, value); });
  const reveal = vi.fn(), dismissAnimated = vi.fn((_node, done) => done());
  runInNewContext(readerScript, {
    document: Object.assign(document, { getElementById: node, documentElement: root }), window,
    readPref: (key: string, fallback: string) => options.blocked ? fallback : storage.get(key) ?? fallback,
    savePref, reducedMotion: () => !!options.reduced, reveal, dismissAnimated,
  });
  function fire(target: Node, type: string, values: Record<string, any> = {}) {
    const event = { type, target, pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0, detail: 1,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...values };
    const path: Node[] = [];
    for (let n: Node | undefined = target; n; n = n.parent) path.push(n);
    for (const capture of [true, false]) for (const current of capture ? [...path].reverse() : path) {
      for (const listener of current.listeners) {
        if (listener.type === type && listener.capture === capture) listener.handler(event);
        if (event.stopImmediatePropagation.mock.calls.length) return event;
      }
      if (!capture && type === 'click') current.onclick?.(event);
    }
    return event;
  }
  function drag(x: number, y: number, source = toggle, pointerType = 'mouse') {
    const start = tools.getBoundingClientRect();
    fire(source, 'pointerdown', { clientX: start.left + 20, clientY: start.top + 20, pointerType });
    fire(source, 'pointermove', { clientX: x + 20, clientY: y + 20, pointerType });
    fire(source, 'pointerup', { clientX: x + 20, clientY: y + 20, pointerType });
  }
  const saved = () => JSON.parse(storage.get('bottle-reader-dock')!);
  const panelRect = () => ({ left: parseFloat(tools.style.left) + parseFloat(panel.style.left), top: parseFloat(tools.style.top) + parseFloat(panel.style.top), width: panel.offsetWidth, height: panel.offsetHeight });
  return { node, tools, toggle, panel, move, toggleText, root, window, document, safe, fire, drag, saved, storage, savePref, panelRect, reveal };
}

describe('reader docking', () => {
  it('collapses to an arrow on page scroll and reopens without changing size or docking preferences', () => {
    const b = browser();
    b.fire(b.toggle, 'click');
    b.node('reader-size').value = '35'; b.node('reader-size').oninput!();
    b.fire(b.window, 'scroll');
    expect(b.tools.dataset.compact).toBe('true');
    expect(b.panel.hidden).toBe(true);
    expect(b.toggle.getAttribute('aria-expanded')).toBe('false');
    b.fire(b.toggle, 'click', { detail: 0 });
    expect(b.tools.dataset.compact).toBeUndefined();
    expect(b.panel.hidden).toBe(false);
    expect(b.node('reader-size').value).toBe('35');
    expect(b.storage.has('bottle-reader-dock')).toBe(false);
    b.fire(b.toggle, 'pointerdown');
    b.fire(b.window, 'scroll');
    expect(b.panel.hidden).toBe(false);
    expect(b.tools.dataset.compact).toBeUndefined();
  });
  it.each(['mouse', 'touch'])('moves freely with %s and snaps to the nearest edge on release', pointerType => {
    const b = browser();
    const start = b.tools.getBoundingClientRect();
    b.fire(b.toggleText, 'pointerdown', { clientX: start.left, clientY: start.top, pointerType });
    b.fire(b.toggle, 'pointermove', { clientX: 600, clientY: 200, pointerType });
    expect(b.tools.getBoundingClientRect()).toMatchObject({ left: 600, top: 200 });
    expect(b.tools.dataset.dragging).toBe('true');
    b.fire(b.toggle, 'pointerup', { clientX: 600, clientY: 200, pointerType });
    expect(b.tools.getBoundingClientRect()).toMatchObject({ left: 948, top: 200 });
    expect(b.saved()).toMatchObject({ edge: 'right' });
    expect(b.toggle.setPointerCapture).toHaveBeenCalledWith(1);
    expect(b.toggle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(b.tools.dataset.dragging).toBeUndefined();
    b.drag(250, 400, b.move, pointerType);
    expect(b.tools.getBoundingClientRect()).toMatchObject({ left: 8, top: 400 });
    expect(b.saved().edge).toBe('left');
  });

  it('keeps tap and tiny pointer jitter as click-to-open, then suppresses only a drag click', () => {
    const b = browser();
    b.fire(b.toggle, 'pointerdown', { clientX: 10, clientY: 10 });
    b.fire(b.toggle, 'pointermove', { clientX: 13, clientY: 12 });
    b.fire(b.toggle, 'pointerup', { clientX: 13, clientY: 12 });
    expect(b.fire(b.toggle, 'click').preventDefault).not.toHaveBeenCalled();
    expect(b.panel.hidden).toBe(false);
    b.fire(b.toggle, 'click');
    b.drag(700, 150);
    expect(b.fire(b.toggle, 'click').preventDefault).toHaveBeenCalled();
    expect(b.panel.hidden).toBe(true);
    // A subsequent intentional pointer press must not be swallowed by a timeout.
    b.fire(b.toggle, 'pointerdown', { clientX: 950, clientY: 150 });
    b.fire(b.toggle, 'pointerup', { clientX: 950, clientY: 150 });
    b.fire(b.toggle, 'click');
    expect(b.panel.hidden).toBe(false);
  });

  it('never drags from the slider and preserves size preferences', () => {
    const b = browser(), before = b.tools.getBoundingClientRect();
    for (const id of ['reader-size', 'reader-panel']) {
      b.fire(b.node(id), 'pointerdown');
      b.fire(b.node(id), 'pointermove', { clientX: 700, clientY: 100 });
      b.fire(b.node(id), 'pointerup', { clientX: 700, clientY: 100 });
    }
    expect(b.tools.getBoundingClientRect()).toEqual(before);
    expect(b.toggle.setPointerCapture).not.toHaveBeenCalled();
    b.node('reader-size').value = '40'; b.node('reader-size').oninput!();
    expect(b.root.style['--letter-size']).toBe('40px');
    expect(b.storage.get('bottle-reading-size')).toBe('40');
    expect(b.storage.has('bottle-reader-dock')).toBe(false);
  });

  it('does not suppress a new slider gesture when a drag generated no compatibility click', () => {
    const b = browser();
    b.fire(b.toggle, 'click'); b.drag(700, 200);
    b.fire(b.node('reader-size'), 'pointerdown');
    expect(b.fire(b.node('reader-size'), 'click').preventDefault).not.toHaveBeenCalled();
    expect(b.panel.hidden).toBe(false);
  });

  it('finishes docking after a tap interrupts a running snap', () => {
    const b = browser(); b.drag(700, 200);
    vi.spyOn(b.tools, 'getBoundingClientRect').mockReturnValueOnce({ left: 820, top: 200, width: 44, height: 86 });
    b.fire(b.move, 'pointerdown', { clientX: 830, clientY: 210 });
    expect(b.tools.getBoundingClientRect().left).toBe(820);
    b.fire(b.move, 'pointerup', { clientX: 830, clientY: 210 });
    expect(b.tools.getBoundingClientRect().left).toBe(948);
    expect(b.saved().edge).toBe('right');
  });

  it('restores this browser position and preserves its relative height through resize/orientation', () => {
    const b = browser(); b.drag(700, 360);
    const reloaded = browser({ storage: b.storage });
    expect(reloaded.tools.getBoundingClientRect()).toEqual(b.tools.getBoundingClientRect());
    reloaded.window.innerWidth = 390; reloaded.window.innerHeight = 420;
    reloaded.fire(reloaded.window, 'orientationchange');
    expect(reloaded.tools.getBoundingClientRect()).toMatchObject({ left: 338 });
    expect(reloaded.tools.getBoundingClientRect().top).toBeGreaterThan(8);
    expect(reloaded.tools.getBoundingClientRect().top + reloaded.tools.offsetHeight).toBeLessThanOrEqual(412);
    reloaded.window.innerWidth = 1000; reloaded.window.innerHeight = 800;
    reloaded.fire(reloaded.window, 'resize');
    expect(reloaded.tools.getBoundingClientRect().top).toBeCloseTo(360);
    expect(browser().tools.dataset.edge).toBe('left');
  });

  it.each(['bad json', 'null', '[]', 'true', '12', '{"edge":"right"}', '{"edge":"bottom","y":0.2}', '{"edge":"right","y":"0.2"}', '{"edge":"right","y":-1}', '{"edge":"right","y":2}', '{"edge":"right","y":1e999}'])('ignores malformed saved position: %s', saved => {
    const b = browser({ saved });
    expect(b.tools.getBoundingClientRect()).toMatchObject({ left: 8, top: 706 });
  });

  it('remains usable when browser preference storage is blocked', () => {
    const b = browser({ blocked: true });
    b.drag(800, 130); b.fire(b.toggle, 'click', { detail: 0 });
    expect(b.tools.getBoundingClientRect()).toMatchObject({ left: 948, top: 130 });
    expect(b.panel.hidden).toBe(false);
    expect(b.storage.size).toBe(0);
  });

  it.each(['left', 'right'])('opens inward from %s and constrains the panel in a short, narrow viewport', edge => {
    const b = browser({ width: 320, height: 210, saved: JSON.stringify({ edge, y: 1 }) });
    const before = b.tools.getBoundingClientRect();
    b.fire(b.toggle, 'click');
    const rect = b.panelRect();
    expect(rect.left).toBeGreaterThanOrEqual(8);
    expect(rect.left + rect.width).toBeLessThanOrEqual(312);
    expect(rect.top).toBeGreaterThanOrEqual(8);
    expect(rect.top + rect.height).toBeLessThanOrEqual(202);
    expect(b.tools.getBoundingClientRect()).toEqual(before);
    if (edge === 'left') expect(rect.left).toBeGreaterThan(before.left + before.width);
    else expect(rect.left + rect.width).toBeLessThan(before.left);
    b.fire(b.tools, 'keydown', { key: 'Escape' });
    expect(b.panel.hidden).toBe(true);
    expect(b.toggle.focus).toHaveBeenCalledOnce();
  });

  it('clamps dragging and open panels to safe-area and the changing visual viewport', () => {
    const b = browser({ width: 390, height: 800, visual: true });
    Object.assign(b.safe, { paddingTop: '30px', paddingRight: '24px', paddingBottom: '34px', paddingLeft: '20px' });
    b.drag(10000, -10000);
    expect(b.tools.getBoundingClientRect()).toMatchObject({ left: 322, top: 30 });
    b.fire(b.toggle, 'click', { detail: 0 });
    Object.assign(b.window.visualViewport!, { offsetLeft: 15, offsetTop: 90, width: 300, height: 300 });
    b.fire(b.window.visualViewport!, 'resize');
    expect(b.tools.getBoundingClientRect()).toMatchObject({ left: 247, top: 120 });
    const rect = b.panelRect();
    expect(rect.left).toBeGreaterThanOrEqual(35);
    expect(rect.left + rect.width).toBeLessThanOrEqual(291);
    expect(rect.top).toBeGreaterThanOrEqual(120);
    expect(rect.top + rect.height).toBeLessThanOrEqual(356);
    b.window.visualViewport!.offsetTop = 100;
    b.fire(b.window.visualViewport!, 'scroll');
    expect(b.tools.getBoundingClientRect().top).toBe(130);
    b.drag(-1000, 10000, b.move);
    expect(b.tools.getBoundingClientRect()).toMatchObject({ left: 35, top: 280 });
  });

  it('keeps keyboard docking on the toggle without hijacking slider keys', () => {
    const b = browser();
    expect(readerHtml).not.toContain('reader-move');
    expect(readerHtml).not.toContain('reader-hint');
    expect(readerHtml).not.toContain('reader-reset');
    expect(b.fire(b.move, 'keydown', { key: 'ArrowRight' }).preventDefault).toHaveBeenCalled();
    expect(b.tools.dataset.edge).toBe('right');
    b.fire(b.move, 'keydown', { key: 'ArrowUp' });
    expect(b.tools.getBoundingClientRect().top).toBe(690);
    b.fire(b.move, 'keydown', { key: 'ArrowUp', shiftKey: true });
    expect(b.tools.getBoundingClientRect().top).toBe(642);
    b.fire(b.move, 'keydown', { key: 'Home' });
    b.fire(b.move, 'keydown', { key: 'ArrowUp' });
    expect(b.tools.getBoundingClientRect().top).toBe(8);
    b.fire(b.move, 'keydown', { key: 'End' });
    b.fire(b.move, 'keydown', { key: 'ArrowDown' });
    expect(b.tools.getBoundingClientRect().top).toBe(706);
    b.fire(b.move, 'keydown', { key: 'ArrowLeft' });
    expect(b.saved().edge).toBe('left');
    expect(b.fire(b.node('reader-size'), 'keydown', { key: 'ArrowUp' }).preventDefault).not.toHaveBeenCalled();
    expect(b.fire(b.move, 'keydown', { key: 'ArrowRight', ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(b.move.focus).not.toHaveBeenCalled(); // Repositioning keeps the current focus.
  });

  it.each(['pointercancel', 'lostpointercapture', 'resize', 'blur'])('ends interrupted drags on %s and ignores unrelated pointers', interruption => {
    const b = browser();
    b.fire(b.move, 'pointerdown', { isPrimary: false });
    b.fire(b.move, 'pointerdown', { button: 2 });
    expect(b.move.setPointerCapture).not.toHaveBeenCalled();
    b.fire(b.move, 'pointerdown', { clientX: 8, clientY: 706 });
    b.fire(b.move, 'pointermove', { pointerId: 2, clientX: 700, clientY: 100 });
    expect(b.tools.getBoundingClientRect().left).toBe(8);
    b.fire(b.move, 'pointermove', { clientX: 700, clientY: 100 });
    b.fire(interruption === 'resize' || interruption === 'blur' ? b.window : b.move, interruption);
    expect(b.tools.dataset.dragging).toBeUndefined();
    expect(b.tools.getBoundingClientRect().left).toBe(948);
    expect(b.tools.getBoundingClientRect().top).toBeCloseTo(100);
    b.fire(b.move, 'pointermove', { clientX: 200, clientY: 300 });
    expect(b.tools.getBoundingClientRect().left).toBe(948);
  });

  it('snaps smoothly after release and skips snap animation for reduced motion', () => {
    const b = browser(); b.drag(700, 200);
    expect(b.tools.animate).toHaveBeenCalledWith([
      { transform: 'translate(-248px,0px)' }, { transform: 'translate(0,0)' },
    ], expect.objectContaining({ duration: 220 }));
    const reduced = browser({ reduced: true }); reduced.drag(700, 200);
    expect(reduced.tools.animate).not.toHaveBeenCalled();
    expect(pageStyles).toContain(readerStyles);
    expect(readerStyles).toContain('prefers-reduced-motion:reduce');
    expect(readerStyles).toContain('touch-action:none');
    expect(readerStyles).toContain('focus-visible');
  });

  it('keeps an expanded panel inside the viewport during a snap on a short screen', () => {
    const b = browser({ width: 390, height: 210, saved: '{"edge":"right","y":1}' });
    b.fire(b.toggle, 'click');
    b.drag(224, 100);
    // At drag end the panel is clamped to x=8; it ends at x=96 when docked right.
    // Parent starts 114px left of its destination; the panel compensates by 26px.
    expect(b.panel.animate).toHaveBeenCalledWith([
      { transform: 'translate(26px,0px)' }, { transform: 'translate(0,0)' },
    ], expect.objectContaining({ duration: 220 }));
    const rect = b.panelRect();
    expect(rect.left).toBe(96);
    expect(rect.top).toBe(8);
    expect(rect.top + rect.height).toBe(202);
  });
});
