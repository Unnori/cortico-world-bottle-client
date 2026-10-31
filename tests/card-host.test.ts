import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CardHost } from '../world/card.ts';
import { waitingCard } from '../world/cards.ts';

let dir = '';

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function fakeChild(): EventEmitter & { kill: () => void } {
  const child = new EventEmitter() as EventEmitter & { kill: () => void };
  child.kill = () => undefined;
  return child;
}

describe('卡片宿主', () => {
  it('把规格写成 JSON，并用 powershell 拉起卡片脚本', () => {
    dir = mkdtempSync(join(tmpdir(), 'bottle-card-'));
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const host = new CardHost({
      dir,
      platform: 'win32',
      spawnImpl: ((command: string, args: readonly string[]) => {
        calls.push({ command, args });
        return fakeChild();
      }) as unknown as typeof import('node:child_process').spawn,
    });

    expect(host.available).toBe(true);
    expect(host.show(waitingCard('http://127.0.0.1:7796/'))).toBe(true);

    const written = JSON.parse(readFileSync(join(dir, 'bottle-card.json'), 'utf8')) as {
      body: string;
      base: string;
    };
    expect(written.body).toContain('读完就会');
    expect(written.base).toBe('http://127.0.0.1:7796');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toContain('powershell.exe');
    expect(calls[0]!.args.join(' ')).toContain('card-host.ps1');
    expect(calls[0]!.args.join(' ')).toContain('-Base http://127.0.0.1:7796');
  });

  it('再弹一张会先关掉上一张', () => {
    dir = mkdtempSync(join(tmpdir(), 'bottle-card-'));
    const killed: string[] = [];
    let index = 0;
    const host = new CardHost({
      dir,
      platform: 'win32',
      spawnImpl: (() => {
        const child = fakeChild();
        const id = `child-${++index}`;
        child.kill = () => killed.push(id);
        return child;
      }) as unknown as typeof import('node:child_process').spawn,
    });

    host.show(waitingCard('http://127.0.0.1:1/'));
    host.show(waitingCard('http://127.0.0.1:1/'));
    expect(killed).toEqual(['child-1']);
  });

  it('不是 Windows 就不假装能弹', () => {
    dir = mkdtempSync(join(tmpdir(), 'bottle-card-'));
    const host = new CardHost({ dir, platform: 'darwin' });
    expect(host.available).toBe(false);
    expect(host.show(waitingCard('http://127.0.0.1:1/'))).toBe(false);
  });
});


it('卡片时长默认十秒，下张卡片读取热更新，零秒禁用自动关闭', () => {
  dir = mkdtempSync(join(tmpdir(), 'bottle-card-timer-'));
  const durations: string[] = [];
  let seconds = 10;
  const host = new CardHost({ dir, platform: 'win32', autoCloseSec: () => seconds,
    spawnImpl: ((_command: string, args: readonly string[]) => {
      durations.push(args[args.indexOf('-AutoCloseMs') + 1]!);
      return fakeChild();
    }) as unknown as typeof import('node:child_process').spawn,
  });
  host.show(waitingCard('http://127.0.0.1:7796/'));
  seconds = 30;
  host.show(waitingCard('http://127.0.0.1:7796/'));
  seconds = 0;
  host.show(waitingCard('http://127.0.0.1:7796/'));
  expect(durations).toEqual(['10000', '30000', '0']);
  const data = JSON.parse(readFileSync(join(dir, 'bottle-card.json'), 'utf8'));
  expect(data.body).toContain('读完就会');
});
