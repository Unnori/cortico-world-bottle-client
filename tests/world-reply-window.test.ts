import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Quota } from '../shared/contract.ts';
import { REPLY_WINDOW_HOURS } from '../shared/contract.ts';
import { DEFAULT_TUNING } from '../server/tuning.ts';
import { BottleClient } from '../world/client.ts';
import { LocalStore } from '../world/store.ts';
import { FakeHost } from './fake-host.ts';
import { callTool, makeHarness, type Harness } from './helpers.ts';

const HOUR = 3_600_000;
const plainQuota: Quota = { bottles_left: 50, catches_left: 49, replies_left: 3 };

describe('World reply window from server quota', () => {
  let h: Harness | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await h?.stop();
    h = undefined;
  });

  async function start(hours = 72) {
    const tuning = { ...DEFAULT_TUNING, replyWindowHours: hours };
    h = makeHarness({ tuning: { current: () => tuning } });
    await h.world.start(new FakeHost());
    await vi.waitFor(() => expect(h!.world.pageDeps().snapshot().quota).not.toBeNull());
    const id = h.throwAs('peer', 'Keep this letter body out of tool results.');
    return { h, tuning, id };
  }

  function catchWithoutDeadline(id: string, quota: Quota) {
    vi.spyOn(BottleClient.prototype, 'catchOne').mockResolvedValueOnce({
      empty: false, letterId: id, from: 'Anonymous', windowUntil: '', quota,
    });
  }

  async function loseLocalHeld(h: Harness) {
    await h.world.stop();
    const store = new LocalStore(h.dir);
    store.load();
    store.setHeld(null);
    const quota = vi.spyOn(BottleClient.prototype, 'quota');
    const calls = quota.mock.calls.length;
    await h.world.start(new FakeHost());
    // Quota survives a restart; wait for bootstrap to actually refresh it.
    await vi.waitFor(() => expect(quota.mock.calls.length).toBeGreaterThan(calls));
    await h.world.pageDeps().refresh?.();
  }

  it('shows a new 24-hour letter and counts down from its server deadline', async () => {
    const { h, id } = await start(24);
    const result = await callTool(h.world, 'bottle_catch');
    expect(result).not.toContain(id);
    expect(result).not.toContain('Keep this letter body');
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(24);
    h.clock.t += 3 * HOUR;
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(21);
  });

  it('uses the catch receipt quota immediately when windowUntil is missing', async () => {
    const { h, id } = await start();
    catchWithoutDeadline(id, { ...plainQuota, reply_window_hours: 24 });
    await callTool(h.world, 'bottle_catch');
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(24);
    const disk = new LocalStore(h.dir); disk.load();
    expect(disk.held?.windowUntil).toBe(h.clock.t + 24 * HOUR);
  });

  it('keeps an explicit deadline even when the current quota advertises a different window', async () => {
    const { h, id } = await start(24);
    vi.spyOn(BottleClient.prototype, 'catchOne').mockResolvedValueOnce({
      empty: false, letterId: id, from: 'Anonymous',
      windowUntil: new Date(h.clock.t + 6 * HOUR).toISOString(),
      quota: { ...plainQuota, reply_window_hours: 24 },
    });
    await callTool(h.world, 'bottle_catch');
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(6);
  });

  it('applies a refreshed quota to later fallback deadlines without rewriting a held letter', async () => {
    const { h, tuning } = await start();
    await callTool(h.world, 'bottle_catch');
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(72);
    tuning.replyWindowHours = 24;
    h.clock.t += 6000;
    await h.world.pageDeps().refresh?.();
    expect(h.world.pageDeps().snapshot().quota?.reply_window_hours).toBe(24);
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(72);
    expect((await h.world.pageDeps().dismiss()).ok).toBe(true);
    const next = h.throwAs('next-peer', 'Another letter.');
    catchWithoutDeadline(next, plainQuota);
    await callTool(h.world, 'bottle_catch');
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(24);
  });

  it.each([undefined, 0, -1, NaN, Infinity, -Infinity, '24', null])(
    'uses the 72-hour fallback for an old or invalid quota value %s', async hours => {
      vi.spyOn(BottleClient.prototype, 'quota').mockResolvedValue(plainQuota);
      const { h, id } = await start();
      catchWithoutDeadline(id, { ...plainQuota, reply_window_hours: hours } as Quota);
      await callTool(h.world, 'bottle_catch');
      expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(REPLY_WINDOW_HOURS);
    },
  );

  it.each([undefined, 0, -1, NaN, Infinity, '24'])(
    'retains the last known valid window when a partial receipt has %s', async hours => {
      const { h, id } = await start(24);
      catchWithoutDeadline(id, { ...plainQuota, reply_window_hours: hours } as Quota);
      await callTool(h.world, 'bottle_catch');
      expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(24);
    },
  );

  it('restores legacy history using the original catch time and current server hours', async () => {
    const { h, id } = await start(24);
    const caughtAt = h.clock.t;
    await callTool(h.world, 'bottle_catch');
    h.clock.t += 3 * HOUR;
    await loseLocalHeld(h);
    vi.spyOn(BottleClient.prototype, 'catchOne').mockResolvedValueOnce({
      empty: true, reason: 'holding', quota: { ...plainQuota, reply_window_hours: 24 },
    });
    const release = vi.spyOn(BottleClient.prototype, 'releaseHeld');
    expect(await callTool(h.world, 'bottle_catch')).toContain('已找回信箱');
    expect(release).not.toHaveBeenCalled();
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(21);
    const disk = new LocalStore(h.dir); disk.load();
    expect(disk.held?.windowUntil).toBe(caughtAt + 24 * HOUR);
    expect(disk.held?.letterId).toBe(id);
  });

  it('does not restore history past the current window and uses the deadlock release instead', async () => {
    const { h } = await start(24);
    await callTool(h.world, 'bottle_catch');
    h.clock.t += 25 * HOUR;
    await loseLocalHeld(h);
    vi.spyOn(BottleClient.prototype, 'catchOne').mockResolvedValueOnce({
      empty: true, reason: 'holding', quota: { ...plainQuota, reply_window_hours: 24 },
    });
    const letter = vi.spyOn(BottleClient.prototype, 'letter');
    const release = vi.spyOn(BottleClient.prototype, 'releaseHeld');
    expect(await callTool(h.world, 'bottle_catch')).toContain('现在可以再捞一次');
    expect(letter).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(h.world.pageDeps().snapshot().held).toBeNull();
  });

  it('still restores legacy history after 25 hours when the old server supplies no window', async () => {
    vi.spyOn(BottleClient.prototype, 'quota').mockResolvedValue(plainQuota);
    const { h } = await start();
    await callTool(h.world, 'bottle_catch');
    h.clock.t += 25 * HOUR;
    await loseLocalHeld(h);
    vi.spyOn(BottleClient.prototype, 'catchOne').mockResolvedValueOnce({
      empty: true, reason: 'holding', quota: plainQuota,
    });
    expect(await callTool(h.world, 'bottle_catch')).toContain('已找回信箱');
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(47);
  });

  it('recovers the original server deadline after tuning changes, without shortening an existing hold', async () => {
    const { h, tuning } = await start();
    await callTool(h.world, 'bottle_catch');
    tuning.replyWindowHours = 24;
    h.clock.t += 3 * HOUR;
    await loseLocalHeld(h);
    const release = vi.spyOn(BottleClient.prototype, 'releaseHeld');
    expect(await callTool(h.world, 'bottle_catch')).toContain('已找回信箱');
    expect(release).not.toHaveBeenCalled();
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(69);
  });

  it('resets remembered hours when the same World restarts against an old server', async () => {
    const { h, id } = await start(24);
    await h.world.stop();
    const quota = vi.spyOn(BottleClient.prototype, 'quota').mockResolvedValue(plainQuota);
    await h.world.start(new FakeHost());
    await vi.waitFor(() => expect(quota).toHaveBeenCalled());
    catchWithoutDeadline(id, plainQuota);
    await callTool(h.world, 'bottle_catch');
    expect(h.world.pageDeps().snapshot().held?.hoursLeft).toBe(72);
  });
});
