import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { saveThemePreference } from '../world/theme.ts';
import { MAILBOX_PALETTES } from '../world/appearance.ts';
import { CardHost } from '../world/card.ts';
import { waitingCard } from '../world/cards.ts';

let dir = '';
const hosts: CardHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  if (dir) rmSync(dir, {recursive: true, force: true});
  dir = '';
});

function rig(extra: Partial<ConstructorParameters<typeof CardHost>[0]> = {}) {
  dir = mkdtempSync(join(tmpdir(), 'bottle-card-'));
  const child = Object.assign(new EventEmitter(), {kill: vi.fn(), stdout: new PassThrough()});
  const spawn = vi.fn(() => child) as unknown as typeof import('node:child_process').spawn;
  const host = new CardHost({dir, platform:'win32', spawnImpl:spawn, ...extra});
  hosts.push(host);
  const snapshot = () => JSON.parse(readFileSync(join(dir,'bottle-card.json'),'utf8'));
  const cards = () => snapshot().cards as any[];
  const show = (id: string, body = id) => host.show({...waitingCard('http://127.0.0.1:7796/','桌宠','reply',id), body});
  return {host,child,spawn,snapshot,cards,show};
}

it('writes a complete snapshot and starts one hidden native stack host', () => {
  const h = rig();
  expect(h.host.available).toBe(true);
  expect(h.show('a')).toBe(true);
  expect(h.snapshot().version).toBe(2);
  expect(h.cards()[0]).toMatchObject({key:'held:a',base:'http://127.0.0.1:7796',body:'a'});
  expect(h.spawn).toHaveBeenCalledOnce();
  const [command,args,options] = vi.mocked(h.spawn).mock.calls[0] as any;
  expect(command).toContain('powershell.exe');
  expect(args.join(' ')).toContain('card-stack-host.ps1');
  expect(options).toMatchObject({windowsHide:true,stdio:['ignore','pipe','ignore']});
});

it('stacks new cards after old ones and updates an older card in place without restarting the host', () => {
  const h = rig();
  h.show('a','waiting'); h.show('b','newer');
  h.show('a','draft ready');
  expect(h.cards().map(card=>[card.key,card.body])).toEqual([['held:a','draft ready'],['held:b','newer']]);
  expect(h.spawn).toHaveBeenCalledOnce();
  expect(h.child.kill).not.toHaveBeenCalled();
});

it('closing one card keeps the others and an old close acknowledgement cannot remove its newer revision', async () => {
  const h = rig();
  h.show('a'); const old = h.cards()[0].revision;
  h.show('b'); h.show('a','updated');
  h.child.stdout.write(JSON.stringify({type:'closed',key:'held:a',revision:old})+'\n');
  await new Promise(resolve=>setImmediate(resolve));
  expect(h.cards().map(card=>card.key)).toEqual(['held:a','held:b']);
  const current = h.cards()[0].revision;
  h.child.stdout.write(JSON.stringify({type:'closed',key:'held:a',revision:current})+'\n');
  await new Promise(resolve=>setImmediate(resolve));
  expect(h.cards().map(card=>card.key)).toEqual(['held:b']);
  expect(readFileSync(join(dir,'bottle-card.json'),'utf8')).not.toContain('updated');
  h.show('a','another update');
  expect(h.cards().map(card=>card.key)).toEqual(['held:a','held:b']);
});

it('reads hot timeout settings per notification including disabled automatic closing', () => {
  let seconds = 10;
  const h = rig({autoCloseSec:()=>seconds});
  h.show('a'); seconds=30; h.show('b'); seconds=0; h.show('c');
  expect(h.cards().map(card=>card.autoCloseMs)).toEqual([10000,30000,0]);
});

it('supplies saved appearance and only the requested local sound per card', () => {
  const h = rig();
  saveThemePreference(dir,{theme:'paper',mode:'dark'});
  const spec=waitingCard('http://127.0.0.1:7796/','桌宠','reply','a');
  const sound={path:join(dir,'incoming.wav'),volume:0.4,fadeOutMs:250};
  h.host.show(spec,sound);
  expect(h.cards()[0].sound).toEqual(sound);
  expect(h.cards()[0].appearance.preference).toEqual({theme:'paper',mode:'dark'});
  expect(h.cards()[0].appearance.palettes.dark).toEqual(MAILBOX_PALETTES.paper.dark);
  h.host.show(spec);
  expect(h.cards()[0].sound).toBeNull();
});

it('bounds native history and cleans all temporary private text on shutdown', () => {
  const h = rig();
  for(let i=0;i<25;i++)h.show(String(i));
  expect(h.cards()).toHaveLength(20);
  expect(h.cards()[0].key).toBe('held:5');
  h.host.dispose();
  expect(h.child.kill).toHaveBeenCalledOnce();
  expect(existsSync(join(dir,'bottle-card.json'))).toBe(false);
  expect(existsSync(join(dir,'bottle-card.json.tmp'))).toBe(false);
});

it('falls back after an early host failure and ignores an already disposed child', () => {
  const h=rig();
  h.show('a');h.child.emit('exit',1);
  expect(h.host.available).toBe(false);
  expect(h.cards()).toEqual([]);
  expect(h.show('b')).toBe(false);
});

it('does not spawn native windows on non-Windows platforms', () => {
  const h = rig({platform:'darwin'});
  expect(h.host.available).toBe(false);
  expect(h.show('a')).toBe(false);
  expect(h.spawn).not.toHaveBeenCalled();
});
