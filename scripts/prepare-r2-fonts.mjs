/** Build local upload files only. Never connects to R2 or reads credentials. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = resolve(root, '../../bottle-font-library/cloudflare-r2');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function assert(condition, message) { if (!condition) throw Error(message); }
function readJson(file) { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function json(file, value) { writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8'); }
function regular(file) { assert(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Source must be a regular file: ' + file); return readFileSync(file); }
function sourceFile(base, value, folder, extension) {
  assert(typeof value === 'string' && new RegExp('^' + folder + '/[^/\\\\]+\\.' + extension + '$', 'i').test(value) && !value.includes('..'), 'Invalid source path: ' + value);
  const directory = join(base, folder);
  assert(!lstatSync(directory).isSymbolicLink(), 'Source directory must not be a symlink');
  return regular(join(base, value));
}
function licenseText(bytes) {
  const text = bytes.toString('utf8');
  assert(text.length > 4000 && text.includes('SIL OPEN FONT LICENSE Version 1.1') && text.includes('TERMINATION') && text.includes('DISCLAIMER'), 'A complete OFL notice is required');
  return text;
}
function atomicJson(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try { json(temp, value); renameSync(temp, file); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
function immutable(file, bytes) {
  if (existsSync(file)) assert(regular(file).equals(bytes), 'Existing immutable object differs: ' + file);
  else writeFileSync(file, bytes, { flag: 'wx' });
}
export function buildFontUpload(configPath = join(workspace, 'library.json'), outputPath = join(dirname(configPath), 'upload')) {
  const config = readJson(configPath), base = new URL(config.baseUrl);
  assert(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'baseUrl must be an HTTPS domain root');
  assert(config.schemaVersion === 1 && Array.isArray(config.fonts) && config.fonts.length > 0, 'Invalid font library');
  const names = new Set(), paths = new Set(), objects = new Map();
  const prepared = config.fonts.map(font => {
    assert(typeof font.name === 'string' && /^[^/\\]+\.(ttf|otf|woff2?)$/i.test(font.name) && !names.has(font.name), 'Duplicate or invalid stable font name');
    assert(typeof font.label === 'string' && font.label.trim(), 'Missing font label');
    assert(typeof font.enabled === 'boolean' && font.license === 'OFL-1.1', 'Only reviewed OFL fonts are accepted');
    const sourceUrl = new URL(font.source); assert(sourceUrl.protocol === 'https:', 'An HTTPS author/license source is required');
    const bytes = sourceFile(join(dirname(configPath), 'source'), font.file, 'fonts', 'woff2');
    assert(bytes.length >= 48 && bytes.toString('ascii', 0, 4) === 'wOF2' && bytes.readUInt32BE(8) === bytes.length && bytes.readUInt16BE(12) > 0, 'Invalid WOFF2 header: ' + font.file);
    const digest = sha(bytes); assert(!font.sha256 || font.sha256 === digest, 'Font changed since review: ' + font.name);
    const notice = sourceFile(join(dirname(configPath), 'source'), font.notice, 'licenses', 'txt'); licenseText(notice);
    const file = 'fonts/' + digest + '.woff2', noticePath = 'licenses/' + sha(notice) + '.txt';
    assert(!paths.has(file), 'Duplicate font binary; keep a single stable record: ' + font.name);
    names.add(font.name); paths.add(file); objects.set(file, bytes); objects.set(noticePath, notice);
    return { id: sha(font.name), name: font.name, label: font.label, enabled: font.enabled, file, url: new URL(file, base).href, sha256: digest, bytes: bytes.length, license: font.license, source: font.source, notice: noticePath, licenseUrl: new URL(noticePath, base).href };
  });
  const defaultFont = prepared.find(font => font.name === config.defaultFont);
  assert(defaultFont, 'Default font is not in the library');
  assert(prepared.some(font => font.enabled), 'At least one font must remain enabled');
  const core = { schemaVersion: 1, baseUrl: base.href, defaultFontId: defaultFont.id, fonts: prepared };
  const catalog = { ...core, revision: sha(JSON.stringify(core)) };
  // Validate all inputs before changing output. Keep prior immutable objects for old letters.
  mkdirSync(join(outputPath, 'fonts'), { recursive: true });
  mkdirSync(join(outputPath, 'licenses'), { recursive: true });
  for (const [key, bytes] of objects) immutable(join(outputPath, key), bytes);
  const index = ['# 漂流瓶公开字库与许可证', '', '字体分别按 SIL Open Font License 1.1 提供。完整版权和许可见下列独立文件，WOFF2 内部名称与版权字段保留。', '', ...prepared.map(font => '- ' + font.label.replace(/[\r\n]/g, ' ') + '（' + (font.enabled ? '参与新绑定' : '保留旧绑定') + '）：[' + font.name + '](' + font.notice.slice('licenses/'.length) + ')；作者来源：' + font.source), '', '保留版权、完整许可及其条件。字体不单独出售；应用程序自身的许可不替代字体许可。', '字体全部使用内容摘要路径；增加字体不重洗已有映射，停用新绑定时保留旧文件。'];
  writeFileSync(join(outputPath, 'licenses/README.md'), index.join('\n') + '\n', 'utf8');
  const metadata = [{ key: 'catalog.json', contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=300' }, { key: 'licenses/README.md', contentType: 'text/markdown; charset=utf-8', cacheControl: 'public, max-age=300' }, ...[...objects.keys()].map(key => ({ key, contentType: key.endsWith('.woff2') ? 'font/woff2' : 'text/plain; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' }))];
  json(join(dirname(outputPath), 'object-metadata.json'), { note: 'Local instructions only; uploading this file does not set R2 HTTP metadata. Configure during upload or in Cloudflare.', objects: metadata });
  atomicJson(join(outputPath, 'catalog.json'), catalog);
  return { directory: outputPath, fontCount: prepared.length, activeFontCount: prepared.filter(font => font.enabled).length, fontBytes: prepared.reduce((total, font) => total + font.bytes, 0), catalogUrl: new URL('catalog.json', base).href, revision: catalog.revision };
}
function main() {
  const args = process.argv.slice(2); let configPath = join(workspace, 'library.json'), outputPath;
  while (args.length) {
    const key = args.shift();
    if (key === '--config' || key === '--out') { const value = args.shift(); assert(value, 'Missing value for ' + key); if (key === '--config') configPath = resolve(value); else outputPath = resolve(value); }
    else throw Error('Unknown argument: ' + key);
  }
  console.log(JSON.stringify(buildFontUpload(configPath, outputPath), null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
