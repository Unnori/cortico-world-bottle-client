/**
 * 用系统默认浏览器打开一个地址。
 *
 * **只允许回环地址**：这个函数绝不能变成「任意 URL 启动器」——否则一段被捞上来的
 * 信、或者别的 World 的事件里写了句「打开这个链接」，就可能把用户导到别处去。
 */
import { spawn } from 'node:child_process';

export function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  } catch {
    return false;
  }
}

function launch(url: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    // rundll32 走 system handler，不用拼 cmd 的引号，也没有窗口一闪
    return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * 打开成功返回 `true`；平台没有对应命令、或进程拉不起来，返回 `false`
 * （调用方据此把地址直接念给人类，让人自己点）。
 */
export function openUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isLoopbackUrl(url)) {
      resolve(false);
      return;
    }
    const { command, args } = launch(url);
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      let settled = false;
      const done = (value: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once('error', () => done(false));
      child.once('spawn', () => {
        child.unref();
        done(true);
      });
      // 保险：两秒内既没 error 也没 spawn，就当它起来了
      setTimeout(() => done(true), 2000);
    } catch {
      resolve(false);
    }
  });
}
