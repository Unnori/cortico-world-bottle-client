/**
 * 原生卡片宿主：把一份 `CardSpec` 写成 JSON，起一个 PowerShell 进程画出来。
 *
 * 卡片自己只做三件事：显示、把按钮按回本地信箱服务、关掉自己。它不读网络、不碰别的文件。
 * 起不来（不是 Windows、没有 PowerShell、策略拦住）就返回 false，调用方安静地退回网页。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardSpec } from './cards.ts';

const HOST_SCRIPT = fileURLToPath(new URL('./card-host.ps1', import.meta.url));
/** 启动后这么快就退出，基本可以断定是策略或路径问题，不是人类关掉的。 */
const EARLY_EXIT_MS = 1500;

function powershellPath(): string {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export interface CardHostOptions {
  /** 数据目录；JSON 写在这里。 */
  dir: string;
  log?: (line: string) => void;
  /** 每次显示时读取，以便配置热更新。 */
  autoCloseSec?: () => number;
  /** 测试注入。 */
  spawnImpl?: typeof spawn;
  platform?: NodeJS.Platform;
}

export class CardHost {
  private child: ChildProcess | null = null;
  private disabledReason: string | null = null;

  constructor(private readonly opts: CardHostOptions) {}

  private get platform(): NodeJS.Platform {
    return this.opts.platform ?? process.platform;
  }

  get available(): boolean {
    return this.platform === 'win32' && this.disabledReason === null;
  }

  /** 显示一张卡片；同一时刻只有一张，新的会顶掉旧的。 */
  show(spec: CardSpec): boolean {
    if (!this.available) return false;

    const data = join(this.opts.dir, 'bottle-card.json');
    try {
      writeFileSync(data, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
    } catch (error) {
      this.opts.log?.(`card data write failed: ${error instanceof Error ? error.name : 'unknown'}`);
      return false;
    }

    this.close();

    let child: ChildProcess;
    try {
      child = (this.opts.spawnImpl ?? spawn)(
        powershellPath(),
        [
          '-NoProfile',
          '-STA',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          HOST_SCRIPT,
          '-Data',
          data,
          '-Base',
          spec.base,
          '-AutoCloseMs',
          String(Math.max(0, Math.min(86400, this.opts.autoCloseSec?.() ?? 10)) * 1000),
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
    } catch (error) {
      this.opts.log?.(`card spawn failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return false;
    }

    const startedAt = Date.now();
    this.child = child;

    child.once('error', (error) => {
      if (this.child === child) this.child = null;
      this.disabledReason = 'spawn error';
      this.opts.log?.(`card host error: ${error.message}`);
    });

    child.once('exit', (code) => {
      if (this.child !== child) return; // 是我们自己关掉的
      this.child = null;
      if (Date.now() - startedAt < EARLY_EXIT_MS && code !== 0) {
        this.disabledReason = `exit ${code}`;
        this.opts.log?.(`card host exited early (${code}); falling back to the page`);
      }
    });

    return true;
  }

  close(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.kill();
    } catch {
      // 已经没了
    }
  }

  dispose(): void {
    this.close();
  }
}
