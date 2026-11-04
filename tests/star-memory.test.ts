import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { callTool, makeHarness, type Harness } from './helpers.ts';
import { FakeHost } from './fake-host.ts';
import { LocalStore } from '../world/store.ts';
import { LetterStars } from '../world/stars.ts';
import { BottleWorld } from '../world/world.ts';
import { BOTTLE_CONFIG_FIELDS, BOTTLE_DEFAULTS } from '../world/config.ts';
import { handlePage } from '../world/page.ts';

let h: Harness, host: FakeHost, store: LocalStore;
const secretBody = '这一封测试正文，只在明确授权后才可读。\n第二行不能遗漏。';
beforeEach(async () => {
  h = makeHarness({ botName: '小潮' }); host = new FakeHost();
  await h.world.start(host);
  await vi.waitFor(() => expect(h.world.pageDeps().snapshot().quota).not.toBeNull());
  store = Reflect.get(h.world, 'store');
  store.addReceived({ letterId: 'incoming', from: '海灯', topic: '潮汐', body: secretBody, at: h.clock.t, outcome: 'kept' });
});
afterEach(async () => { vi.restoreAllMocks(); await h.stop(); });
const page = () => h.world.pageDeps();
async function enable(id = 'incoming') {
  expect((await page().star!(id, true)).ok).toBe(true);
  expect((await page().starMemorySetting!(true)).ok).toBe(true);
  expect((await page().starMemory!(id, true)).ok).toBe(true);
}
async function memory(index?: unknown) { return callTool(h.world, 'bottle_star_memory', index === undefined ? {} : { index }); }

describe('star collection and explicit consent', () => {
  it('starts off; starring alone never exposes body via events, tools, env or descriptions', async () => {
    expect(BOTTLE_DEFAULTS.starMemoryEnabled).toBe(false);
    expect((await page().star!('incoming', true)).ok).toBe(true);
    expect(page().snapshot().stars).toMatchObject([{ letterId: 'incoming', memorySelected: false, memoryActive: false }]);
    expect((await page().starMemory!('incoming', true)).ok).toBe(false);
    expect(host.deferred).toHaveLength(0);
    expect(JSON.stringify(host.events)).not.toContain(secretBody);
    expect(await memory(1)).not.toContain(secretBody);
    expect(JSON.stringify(h.world.envPromptVars())).not.toContain(secretBody);
    expect(JSON.stringify(h.world.tools())).not.toContain(secretBody);
  });

  it('global enable alone does not authorize any starred letter', async () => {
    await page().star!('incoming', true);
    await page().starMemorySetting!(true);
    expect(host.deferred).toHaveLength(0);
    expect(await memory(1)).not.toContain(secretBody);
    expect(page().snapshot().stars?.[0]?.memoryActive).toBe(false);
  });

  it('explicit opt-in queues no raw body, then delivers the entire correspondence as external', async () => {
    await enable();
    expect(host.deferred).toHaveLength(1);
    expect(JSON.stringify(host.deferred)).not.toContain(secretBody);
    const events = await host.deliverDeferred(h.world);
    expect(events).toHaveLength(1);
    expect(events[0]?.origin).toBe('external');
    expect(events[0]?.type).toBe('bottle.star-memory');
    expect(JSON.parse(events[0]!.text.split('\n').slice(1).join('\n')).original.body).toBe(secretBody);
    expect(events[0]?.text).not.toContain('incoming');
    expect(await memory()).toContain('海灯');
    expect(await memory()).not.toContain(secretBody);
    expect(JSON.parse((await memory(1)).split('\n').slice(1).join('\n')).original.body).toBe(secretBody);
    expect(JSON.stringify(h.world.envPromptVars())).not.toContain(secretBody);
  });

  it('turning per-letter consent off cancels queued disclosure and subsequent tool reads', async () => {
    await enable();
    await page().starMemory!('incoming', false);
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
    expect(await memory(1)).not.toContain(secretBody);
    expect(page().snapshot().stars?.[0]).toMatchObject({ memorySelected: false, memoryActive: false });
    expect(store.received[0]?.body).toBe(secretBody);
  });

  it('turning the global setting off clears all consents; re-enable cannot resurrect them', async () => {
    await enable();
    await page().starMemorySetting!(false);
    await page().starMemorySetting!(true);
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
    expect(await memory(1)).not.toContain(secretBody);
    expect(page().snapshot().stars?.[0]?.memorySelected).toBe(false);
  });

  it('native hot config disabling also blocks deferred delivery and clears consent', async () => {
    await enable(); h.cfg.starMemoryEnabled = false;
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
    expect(await memory(1)).not.toContain(secretBody);
    h.cfg.starMemoryEnabled = true;
    expect(page().snapshot().stars?.[0]?.memorySelected).toBe(false);
  });

  it('native config off-on without polling synchronously invalidates all prior authorizations', async () => {
    await enable();
    h.cfg.starMemoryEnabled = false;
    h.cfg.starMemoryEnabled = true;
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
    expect(await memory(1)).not.toContain(secretBody);
    expect(page().snapshot().stars?.[0]?.memorySelected).toBe(false);
    expect(Object.keys(h.cfg)).toContain('starMemoryEnabled');
    expect(JSON.parse(JSON.stringify(h.cfg)).starMemoryEnabled).toBe(true);
  });

  it('still persists global off when consent-file revocation fails', async () => {
    await enable();
    const stars = Reflect.get(h.world, 'stars') as LetterStars;
    vi.spyOn(stars, 'revokeAll').mockImplementation(() => { throw Error('disk failure'); });
    const result = await page().starMemorySetting!(false);
    expect(result.ok).toBe(false);
    expect(h.persistedConfig.at(-1)).toEqual({ starMemoryEnabled: false });
    expect(h.cfg.starMemoryEnabled).toBe(false);
    expect(await memory(1)).not.toContain(secretBody);
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
  });

  it('a failed per-letter revocation can be retried even when its effective flag is already off', async () => {
    await enable();
    const stars = Reflect.get(h.world, 'stars') as LetterStars;
    unlinkSync(stars.file); mkdirSync(stars.file);
    expect((await page().starMemory!('incoming', false)).ok).toBe(false);
    expect(await memory(1)).not.toContain(secretBody);
    expect(stars.needsSave()).toBe(true);
    rmdirSync(stars.file);
    expect((await page().starMemory!('incoming', false)).ok).toBe(true);
    const reloaded = new LetterStars(h.dir); reloaded.load();
    expect(reloaded.get('incoming')?.memorySelected).toBe(false);
    expect(stars.needsSave()).toBe(false);
  });

  it('failed global cleanup is retried and re-enabling is denied until the revocation is saved', async () => {
    await enable();
    const stars = Reflect.get(h.world, 'stars') as LetterStars;
    unlinkSync(stars.file); mkdirSync(stars.file);
    expect((await page().starMemorySetting!(false)).ok).toBe(false);
    expect((await page().starMemorySetting!(true)).ok).toBe(false);
    expect(h.cfg.starMemoryEnabled).toBe(false);
    rmdirSync(stars.file);
    expect((await page().starMemorySetting!(false)).ok).toBe(true);
    const reloaded = new LetterStars(h.dir); reloaded.load();
    expect(reloaded.get('incoming')?.memorySelected).toBe(false);
    expect((await page().starMemorySetting!(true)).ok).toBe(true);
    expect(await memory(1)).not.toContain(secretBody);
  });

  it('native re-enable throws before framework persistence when a dirty denial cannot be saved', async () => {
    await enable();
    const stars = Reflect.get(h.world, 'stars') as LetterStars;
    unlinkSync(stars.file); mkdirSync(stars.file);
    h.cfg.starMemoryEnabled = false;
    const persistRequestedTrue = vi.fn();
    expect(() => { h.cfg.starMemoryEnabled = true; persistRequestedTrue(); }).toThrow();
    expect(persistRequestedTrue).not.toHaveBeenCalled();
    expect(h.cfg.starMemoryEnabled).toBe(false);
    expect(await memory(1)).not.toContain(secretBody);
  });

  it.each([true, false])('World restart never reloads stale consent after failed revoke, storage recovered=%s', async recovered => {
    await enable();
    const stars = Reflect.get(h.world, 'stars') as LetterStars;
    unlinkSync(stars.file); mkdirSync(stars.file);
    expect((await page().starMemory!('incoming', false)).ok).toBe(false);
    if (recovered) rmdirSync(stars.file);
    await h.world.stop(); await h.world.start(host);
    expect(await memory(1)).not.toContain(secretBody);
    expect(page().snapshot().stars?.[0]?.memorySelected).toBe(false);
  });

  it('observer takeover before start carries revocations and invalidates the previous owner queue', async () => {
    await enable();
    const context = Reflect.get(h.world, 'ctx');
    const replacement = new BottleWorld(context);
    h.cfg.starMemoryEnabled = false;
    h.cfg.starMemoryEnabled = true;
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
    expect(await memory(1)).not.toContain(secretBody);
    await h.world.stop();
    try {
      await replacement.start(host);
      expect(await callTool(replacement, 'bottle_star_memory', { index: 1 })).not.toContain(secretBody);
      expect(replacement.pageDeps().snapshot().stars?.[0]?.memorySelected).toBe(false);
    } finally { await replacement.stop(); }
  });

  it('re-enabling a letter makes a new authorization, not a second delivery of the old queue item', async () => {
    await enable();
    await page().starMemory!('incoming', false);
    await page().starMemory!('incoming', true);
    expect(host.deferred).toHaveLength(2);
    expect(await host.deliverDeferred(h.world)).toHaveLength(1);
  });

  it('repeating an enabled checkbox is idempotent and never creates another push', async () => {
    await enable(); await page().starMemory!('incoming', true);
    expect(host.deferred).toHaveLength(1);
  });

  it('unstar removes memory authorization; re-star cannot silently bring it back', async () => {
    await enable();
    await page().star!('incoming', false);
    await page().star!('incoming', true);
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
    expect(await memory(1)).not.toContain(secretBody);
    expect(page().snapshot().stars).toHaveLength(1);
    expect(page().snapshot().stars?.[0]?.memorySelected).toBe(false);
  });

  it('restart preserves collection and authorized library but invalidates old pending disclosures', async () => {
    await enable();
    await h.world.stop(); await h.world.start(host);
    expect(page().snapshot().stars).toHaveLength(1);
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
    expect(JSON.parse((await memory(1)).split('\n').slice(1).join('\n')).original.body).toBe(secretBody);
    expect(readFileSync(join(h.dir, 'bottle-stars.json'), 'utf8')).not.toContain(secretBody);
  });

  it('sent letter and its later reply are a single star, preferring reply navigation', async () => {
    store.addSent({ letterId: 'outgoing', body: '原信完整正文', topic: '寄给海', at: h.clock.t });
    await page().star!('outgoing', true);
    expect(page().snapshot().stars?.[0]?.category).toBe('sent');
    store.addReply({ letterId: 'outgoing', from: '灯塔', body: '回信完整正文', at: h.clock.t + 10 });
    await page().star!('outgoing', true);
    expect(page().snapshot().stars).toHaveLength(1);
    expect(page().snapshot().stars?.[0]).toMatchObject({ letterId: 'outgoing', category: 'reply', from: '灯塔' });
    await page().starMemorySetting!(true); await page().starMemory!('outgoing', true);
    const body = await memory(1);
    expect(body).toContain('原信完整正文'); expect(body).toContain('回信完整正文');
    await page().star!('outgoing', false);
    expect(page().snapshot().stars).toHaveLength(0);
    expect(await memory(1)).not.toContain('回信完整正文');
  });

  it('seed and held letters use the same stars without changing their processing state', async () => {
    store.addReceived({ letterId: 'seed', from: '群岛居民', signature: '白鹭', body: '邮局原文', seed: true, at: h.clock.t, outcome: 'caught' });
    store.setHeld({ letterId: 'seed', from: '群岛居民', signature: '白鹭', body: '邮局原文', seed: true, caughtAt: h.clock.t, windowUntil: 0 });
    await page().star!('seed', true);
    expect(page().snapshot().stars?.[0]).toMatchObject({ category: 'seed', from: '白鹭' });
    expect(store.held?.letterId).toBe('seed');
    expect(store.received.find(item => item.letterId === 'seed')?.outcome).toBe('caught');
  });

  it('deleting a record revokes memory and cancels pending delivery', async () => {
    await enable();
    expect((await page().forget('incoming')).ok).toBe(true);
    expect(page().snapshot().stars).toHaveLength(0);
    expect(await host.deliverDeferred(h.world)).toHaveLength(0);
    expect(await memory(1)).not.toContain(secretBody);
  });

  it('a prior read is not falsely erased, but subsequent reads are blocked', async () => {
    await enable(); await host.deliverDeferred(h.world);
    expect(host.events[0]?.type).toBe('bottle.star-memory');
    await page().starMemory!('incoming', false);
    expect(await memory(1)).not.toContain(secretBody);
    expect(host.events.some(item => item.type === 'bottle.star-memory')).toBe(true);
  });

  it('manual read-together is still a separate explicit permission when star memory is off', async () => {
    await page().star!('incoming', true);
    expect((await page().peruse('incoming')).ok).toBe(true);
    expect(host.last('bottle.peruse')?.text).toContain('第二行不能遗漏');
    expect(await memory(1)).not.toContain(secretBody);
  });

  it.each([0, -1, '1', 1.5, 999, null])('rejects forged memory selector %s', async index => {
    await enable(); expect(await memory(index)).not.toContain(secretBody);
  });

  it('rejects unknown IDs and browser-supplied fake bodies', async () => {
    const response = await handlePage(page(), 'POST', '/star', { body: { letterId: 'unknown', starred: true, body: 'injected body' } });
    expect(response.json).toMatchObject({ ok: false });
    expect(page().snapshot().stars).toHaveLength(0);
  });

  it.each(['/star', '/star-memory', '/star-memory-setting'])('requires strict booleans at %s', async route => {
    expect((await handlePage(page(), 'POST', route, { body: { letterId: 'incoming', starred: 'false', enabled: 'true' } })).status).toBe(400);
  });

  it('reports queue failure, revokes the attempted authorization and does not leak body', async () => {
    await page().star!('incoming', true); await page().starMemorySetting!(true);
    vi.spyOn(host, 'pushDeferred').mockImplementationOnce(() => { throw Error('queue failure'); });
    expect((await page().starMemory!('incoming', true)).ok).toBe(false);
    expect(await memory(1)).not.toContain(secretBody);
  });

  it('cannot authorize a letter if consent persistence fails', async () => {
    const stars = new LetterStars(join(h.dir, 'broken-consent'));
    stars.set('test', true, h.clock.t);
    unlinkSync(stars.file); mkdirSync(stars.file);
    expect(() => stars.select('test', true)).toThrow();
    expect(stars.get('test')?.memorySelected).toBe(false);
  });

  it('native config never interpolates a pet name; webpage action messages use the real name', async () => {
    expect(JSON.stringify(BOTTLE_CONFIG_FIELDS['worlds.bottle.starMemoryEnabled'])).not.toContain('小潮');
    const result = await page().star!('incoming', true);
    expect(result.message).toContain('小潮');
    expect(result.message).not.toContain('Coo');
  });
});
