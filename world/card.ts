/** One native host displays a stack; updating a workflow never reorders it. */
import { spawn, type ChildProcess } from 'node:child_process';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { cardAppearance, DEFAULT_APPEARANCE } from './appearance.ts';
import { readThemePreference } from './theme.ts';
import type { CardSound } from './sound.ts';
import type { CardSpec } from './cards.ts';
import {readHostTheme} from './host-theme.ts';

const HOST_SCRIPT = fileURLToPath(new URL('./card-stack-host.ps1', import.meta.url));
const EARLY_EXIT_MS = 1500;
const MAX_CARDS = 20;

function powershellPath(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export interface CardHostOptions {
  dir: string;
  log?: (line: string) => void;
  autoCloseSec?: () => number;
  spawnImpl?: typeof spawn;
  platform?: NodeJS.Platform;
}

type Notification = {
  spec: CardSpec;
  revision: number;
  order: number;
  autoCloseMs: number;
  sound: CardSound | null;
};

export class CardHost {
  private child: ChildProcess | null = null;
  private disabledReason: string | null = null;
  private cards = new Map<string, Notification>();
  // Retain only ordering metadata after closing, never letter text.
  private positions = new Map<string, number>();
  private sequence = 0;
  private revision = 0;

  constructor(private readonly opts: CardHostOptions) {}

  get available(): boolean {
    return (this.opts.platform ?? process.platform) === 'win32' && this.disabledReason === null;
  }

  private get data(): string { return join(this.opts.dir, 'bottle-card.json'); }

  private save(): boolean {
    const temporary = this.data + '.tmp';
    try {
      const appearance = cardAppearance(readThemePreference(this.opts.dir) ?? DEFAULT_APPEARANCE,readHostTheme(this.opts.dir));
      const cards = [...this.cards.values()].sort((a, b) => a.order - b.order).map(card => ({
        ...card.spec, revision: card.revision, autoCloseMs: card.autoCloseMs, sound: card.sound, appearance,
      }));
      writeFileSync(temporary, JSON.stringify({version: 2, cards}) + '\n', 'utf8');
      renameSync(temporary, this.data);
      return true;
    } catch (error) {
      this.opts.log?.('card data write failed: ' + (error instanceof Error ? error.name : 'unknown'));
      return false;
    }
  }

  show(spec: CardSpec, sound?: CardSound | null): boolean {
    if (!this.available) return false;
    const old = this.cards.get(spec.key);
    const order = this.positions.get(spec.key) ?? ++this.sequence;
    this.positions.set(spec.key, order);
    this.cards.set(spec.key, {
      spec, order, revision: ++this.revision,
      autoCloseMs: Math.max(0, Math.min(86400, this.opts.autoCloseSec?.() ?? 10)) * 1000,
      sound: sound ?? null,
    });
    if (!this.save()) {
      if (old) this.cards.set(spec.key, old); else this.cards.delete(spec.key);
      return false;
    }
    // Bound hidden history as well as native controls. Everything remains in the mailbox.
    if (this.cards.size > MAX_CARDS) {
      const oldest = [...this.cards.values()].sort((a,b) => a.order - b.order)[0]!;
      this.cards.delete(oldest.spec.key);
      this.save();
    }
    for (const key of this.positions.keys()) {
      if (this.positions.size <= 256) break;
      if (!this.cards.has(key)) this.positions.delete(key);
    }
    if (this.child) return true;

    let child: ChildProcess;
    try {
      child = (this.opts.spawnImpl ?? spawn)(powershellPath(), [
        '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', HOST_SCRIPT,
        '-Data', this.data, '-Base', spec.base,
      ], {windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']});
    } catch (error) {
      this.opts.log?.('card spawn failed: ' + (error instanceof Error ? error.message : 'unknown'));
      return false;
    }
    this.child = child;
    const startedAt = Date.now();
    // Old close acknowledgements cannot remove a replacement revision.
    const lines = child.stdout ? createInterface({input: child.stdout}) : null;
    lines?.on('line', line => {
      if (this.child !== child) return;
      try {
        const ack = JSON.parse(line);
        if (ack.type === 'closed' && this.cards.get(ack.key)?.revision === ack.revision) this.dismiss(ack.key);
      } catch { /* Ignore non-protocol host output. */ }
    });
    child.once('error', error => {
      lines?.close();
      if (this.child !== child) return;
      this.child = null;
      this.disabledReason = 'spawn error';
      this.opts.log?.('card host error: ' + error.message);
    });
    child.once('exit', code => {
      lines?.close();
      if (this.child !== child) return;
      this.child = null;
      this.cards.clear();
      this.save();
      if (Date.now() - startedAt < EARLY_EXIT_MS && code !== 0) {
        this.disabledReason = 'exit ' + code;
        this.opts.log?.('card host exited early (' + code + '); falling back to the page');
      }
    });
    return true;
  }

  dismiss(key: string): void {
    if (this.cards.delete(key)) this.save();
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.cards.clear();
    this.positions.clear();
    if (child) { try { child.kill(); } catch { /* Already stopped. */ } }
    // These files contain private text, not durable mail history.
    for (const path of [this.data, this.data + '.tmp']) {
      try { rmSync(path, {force: true}); } catch { /* Best effort during shutdown. */ }
    }
  }

  dispose(): void { this.close(); this.positions.clear(); }
}
