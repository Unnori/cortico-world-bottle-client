import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error Local build tool is JavaScript, not part of the runtime module graph.
import { buildFontUpload } from '../scripts/prepare-r2-fonts.mjs';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'bottle-r2-upload-')); dirs.push(dir);
  mkdirSync(join(dir, 'source/fonts'), { recursive: true }); mkdirSync(join(dir, 'source/licenses'));
  const bytes = Buffer.alloc(64); bytes.write('wOF2'); bytes.writeUInt32BE(bytes.length, 8); bytes.writeUInt16BE(1, 12);
  const notice = readFileSync(new URL('../world/fonts/licenses/Yozai-Regular-OFL.txt', import.meta.url));
  writeFileSync(join(dir, 'source/fonts/a.woff2'), bytes); writeFileSync(join(dir, 'source/licenses/a.txt'), notice);
  const config = { schemaVersion: 1, baseUrl: 'https://fontsforletters.sqnori.com/', defaultFont: 'old.ttf', fonts: [{ name: 'old.ttf', label: '字体甲', file: 'fonts/a.woff2', notice: 'licenses/a.txt', license: 'OFL-1.1', source: 'https://example.org/author', enabled: true, sha256: hash(bytes) }] };
  const path = join(dir, 'library.json'); const save = () => writeFileSync(path, JSON.stringify(config)); save();
  return { dir, path, config, save, bytes };
}
it('生成清单保持旧文件名派生的 ID，资源用内容摘要路径，重复生成结果相同', () => {
  const f = fixture(); const result = buildFontUpload(f.path);
  const catalogPath = join(f.dir, 'upload/catalog.json'), original = readFileSync(catalogPath);
  const catalog = JSON.parse(original.toString());
  expect(catalog.defaultFontId).toBe(hash('old.ttf'));
  expect(catalog.fonts[0]).toMatchObject({ id: hash('old.ttf'), name: 'old.ttf', url: 'https://fontsforletters.sqnori.com/fonts/' + hash(f.bytes) + '.woff2' });
  expect(readFileSync(join(f.dir, 'upload', catalog.fonts[0].file)).equals(f.bytes)).toBe(true);
  expect(buildFontUpload(f.path).revision).toBe(result.revision);
  expect(readFileSync(catalogPath).equals(original)).toBe(true);
});
it('新增/停用字体保持旧 ID 与对象，删除记录也不清理历史下载资源', () => {
  const f = fixture(); buildFontUpload(f.path);
  const old = JSON.parse(readFileSync(join(f.dir, 'upload/catalog.json'), 'utf8')).fonts[0];
  const bytes = Buffer.from(f.bytes); bytes[63] = 1; writeFileSync(join(f.dir, 'source/fonts/b.woff2'), bytes);
  f.config.fonts.push({ ...f.config.fonts[0], name: 'new.ttf', label: '字体乙', file: 'fonts/b.woff2', sha256: hash(bytes) });
  f.config.fonts[0].enabled = false; f.save();
  expect(buildFontUpload(f.path)).toMatchObject({ fontCount: 2, activeFontCount: 1 });
  const updated = JSON.parse(readFileSync(join(f.dir, 'upload/catalog.json'), 'utf8'));
  expect(updated.fonts[0]).toMatchObject({ id: old.id, file: old.file, enabled: false });
  f.config.fonts.shift(); f.config.defaultFont = 'new.ttf'; f.save(); buildFontUpload(f.path);
  expect(existsSync(join(f.dir, 'upload', old.file))).toBe(true);
});
it('未完整提供许可、路径越界、重复名称、摘要变化时不覆盖已发布清单', () => {
  const f = fixture(); buildFontUpload(f.path);
  const catalog = readFileSync(join(f.dir, 'upload/catalog.json'));
  writeFileSync(join(f.dir, 'source/licenses/a.txt'), '免费使用');
  expect(() => buildFontUpload(f.path)).toThrow('complete OFL');
  expect(readFileSync(join(f.dir, 'upload/catalog.json')).equals(catalog)).toBe(true);
  f.config.fonts[0].file = '../outside.woff2'; f.save(); expect(() => buildFontUpload(f.path)).toThrow('Invalid source path');
  f.config.fonts[0].file = 'fonts/a.woff2'; f.config.fonts[0].sha256 = '0'.repeat(64); f.save(); expect(() => buildFontUpload(f.path)).toThrow('changed since review');
  f.config.fonts[0].sha256 = hash(f.bytes);
  writeFileSync(join(f.dir, 'source/licenses/a.txt'), readFileSync(new URL('../world/fonts/licenses/Yozai-Regular-OFL.txt', import.meta.url)));
  f.config.fonts.push({ ...f.config.fonts[0] }); f.save(); expect(() => buildFontUpload(f.path)).toThrow('Duplicate or invalid stable font name');
  expect(readFileSync(join(f.dir, 'upload/catalog.json')).equals(catalog)).toBe(true);
});
it('拒绝非 WOFF2 文件及不安全域名，不产生上传清单', () => {
  const f = fixture(); f.config.baseUrl = 'http://fonts.example.org/'; f.save(); expect(() => buildFontUpload(f.path)).toThrow('HTTPS domain root');
  f.config.baseUrl = 'https://fontsforletters.sqnori.com/'; f.save(); writeFileSync(join(f.dir, 'source/fonts/a.woff2'), 'not a font');
  expect(() => buildFontUpload(f.path)).toThrow('Invalid WOFF2 header');
  expect(existsSync(join(f.dir, 'upload/catalog.json'))).toBe(false);
});
