/** Read-only development check of the host's internal manifest, not a public extension API. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const arg = process.argv.slice(2).filter(value => value !== '--')[0];
if (!arg) {
  console.error('用法：pnpm check:running-webui -- http://127.0.0.1:<框架端口>（不是独立信箱 7796 或桌宠 7797）');
  process.exit(1);
}
try {
  const base = new URL(arg);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash)
    throw new Error('请提供不含凭据、路径或查询参数的框架地址。');
  const get = async path => {
    const res = await fetch(new URL(path, base), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}：${path}。请核对框架地址；若需登录，请在已登录页面完成核查，不要把令牌写进命令。`);
    return res;
  };
  const live = await (await get('/api/webui/manifest')).json();
  const page = live.providers?.find(item => item.id === 'world:bottle');
  if (!page?.client) throw new Error('运行实例未登记漂流瓶前端。请检查扩展是否加载，并完整重启宿主后再检查。');
  for (const [kind, field] of [['js', 'webUiClient'], ['css', 'webUiStyle']]) {
    const file = manifest.cortico[field];
    const name = file.split('/').at(-1);
    const expected = `/assets/extensions/${manifest.name}/${manifest.version}/${name}`;
    if (page.client[kind] !== expected) throw new Error(`${kind.toUpperCase()} 注册仍旧：运行 ${page.client[kind]}；磁盘 ${expected}。只重启 World 不更新资产表，请完整重启宿主后刷新设置页。`);
    const bytes = Buffer.from(await (await get(expected)).arrayBuffer());
    if (hash(bytes) !== hash(readFileSync(new URL(file, root)))) throw new Error(`${kind.toUpperCase()} 运行文件与本地构建不同，请检查安装副本和静态资源代理。`);
    if (!name.includes(hash(bytes).slice(0, 12))) throw new Error(`${kind.toUpperCase()} 内容摘要与文件名不符，请重新构建，禁止覆盖旧摘要资源。`);
    console.log(`PASS ${kind.toUpperCase()}: ${expected}`);
  }
  console.log('运行资产与本地构建一致。若已打开的设置窗口仍缺新卡片，请刷新设置页面；切换页签不清除已加载模块。还须在实际宿主确认新卡片可见，本命令不代表 DOM 验收完成。');
} catch (error) {
  console.error(error instanceof Error ? error.message : '运行资产检查失败。'); process.exitCode = 1;
}
