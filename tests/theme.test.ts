import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { BUILTIN_PALETTES, DEFAULT_SCHEME_ID } from 'cortico/web/shared/theme.ts';
import { cardAppearance, MAILBOX_PALETTES } from '../world/appearance.ts';
import { readMailboxTheme, readThemePreference, saveThemePreference } from '../world/theme.ts';
import { pageHtml } from '../world/page-view.ts';

const dirs: string[] = [];
async function deployment() { const dir = await mkdtemp(join(tmpdir(), 'bottle-theme-')); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('没有主题记录时使用部署默认；没有配置时使用框架默认', async () => {
  const dir = await deployment();
  expect((await readMailboxTheme(dir)).palettes?.light.paper).toBe(BUILTIN_PALETTES[DEFAULT_SCHEME_ID].light.paper);
  await writeFile(join(dir, 'config.json'), JSON.stringify({ web: { theme: 'navigator' } }));
  expect((await readMailboxTheme(dir)).scheme).toBe('navigator');
});
it('同步内置主题及明暗色板，不回写任何宿主设置', async () => {
  const dir = await deployment();
  const raw = JSON.stringify({ selectedId: 'crab-daisy', mode: 'dark', custom: [] });
  await writeFile(join(dir, 'theme.json'), raw);
  const result = await readMailboxTheme(dir);
  expect(result.available).toBe(true); expect(result.mode).toBe('dark');
  expect(result.palettes?.dark.accent).toBe(BUILTIN_PALETTES['crab-daisy'].dark.accent);
  expect(result.palettes?.light.paper).toBe(BUILTIN_PALETTES['crab-daisy'].light.paper);
  expect(await readFile(join(dir, 'theme.json'), 'utf8')).toBe(raw);
});
it('同步自定义颜色和后续修改，只返回颜色白名单，不暴露名称与其他配置', async () => {
  const dir = await deployment();
  const custom = { id: 'personal', name: 'private-name', note: 'private-note', palettes: {
    light: { ...BUILTIN_PALETTES.mint.light, accent: '#123ABC', secret: 'private-token' }, dark: BUILTIN_PALETTES.mint.dark } };
  const write = () => writeFile(join(dir, 'theme.json'), '\uFEFF' + JSON.stringify({ selectedId: 'personal', mode: 'system', custom: [custom] }));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ token: 'private-token', web: { theme: 'mint' } }));
  await write(); const result = await readMailboxTheme(dir);
  expect(result.scheme).toBe('custom'); expect(result.palettes?.light.accent).toBe('#123abc');
  expect(JSON.stringify(result)).not.toMatch(/private|personal|secret/);
  custom.palettes.light.accent = '#654321'; await write();
  expect((await readMailboxTheme(dir)).palettes?.light.accent).toBe('#654321');
});
it('删除自定义主题后按宿主规则回退，损坏文件则报告暂不可用', async () => {
  const dir = await deployment();
  await writeFile(join(dir, 'config.json'), JSON.stringify({ web: { theme: 'navigator' } }));
  await writeFile(join(dir, 'theme.json'), JSON.stringify({ selectedId: 'removed', custom: [] }));
  expect((await readMailboxTheme(dir)).scheme).toBe('navigator');
  await writeFile(join(dir, 'theme.json'), '{'); expect(await readMailboxTheme(dir)).toEqual({ available: false });
});
it('不把自定义主题字符串当 HTML 执行', () => {
  const html = pageHtml({ available: false, scheme: '</script><script>bad()</script>' });
  expect(html).not.toContain('<script>bad()');
  const embedded = html.match(/id="host-theme">([\s\S]*?)<\/script>/)![1];
  expect(JSON.parse(embedded).scheme).toBe('</script><script>bad()</script>');
});

it('信箱偏好保存到扩展数据，恢复精确选择，拒绝无效数据', async () => {
  const dir = await deployment();
  expect(readThemePreference(dir)).toBeUndefined();
  saveThemePreference(dir, { theme:'paper', mode:'dark' });
  expect(readThemePreference(dir)).toEqual({ theme:'paper', mode:'dark' });
  expect(() => saveThemePreference(dir, { theme:'invalid', mode:'dark' } as any)).toThrow();
  expect(readThemePreference(dir)).toEqual({ theme:'paper', mode:'dark' });
});
it('卡片使用与网页相同的浅深色板，Coopanion 使用真实主题颜色', () => {
  for (const theme of ['ocean','paper'] as const) {
    const appearance = cardAppearance({ theme, mode:'system' }, { available:false });
    expect(appearance.palettes).toEqual(MAILBOX_PALETTES[theme]);
    for (const palette of Object.values(appearance.palettes)) for (const value of Object.values(palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  }
  const appearance = cardAppearance({ theme:'coopanion', mode:'dark' }, { available:true, palettes:BUILTIN_PALETTES.mint });
  expect(appearance.palettes.dark.ink).toBe(BUILTIN_PALETTES.mint.dark.ink);
  expect(appearance.palettes.light.card).toBe(BUILTIN_PALETTES.mint.light.sheet);
  expect(cardAppearance({ theme:'coopanion', mode:'dark' }, { available:false }).palettes).toEqual(MAILBOX_PALETTES.ocean);
});
