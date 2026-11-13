/** Validate the actual npm tarball, not human-oriented npm log formatting. No network or extraction to disk. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkReleaseFiles(files, manifest, readEntry) {
  const names = new Set(files);
  if (names.size !== files.length) throw Error('Duplicate tarball entry');
  const assets = [manifest.cortico?.webUiClient, manifest.cortico?.webUiStyle];
  if (!/^dist\/webui-[a-f0-9]{12}\.js$/.test(assets[0] ?? '') || !/^dist\/webui-[a-f0-9]{12}\.css$/.test(assets[1] ?? '')) throw Error('Missing hashed WebUI asset declarations');
  const rootFiles = new Set(['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'LICENSE.md', 'describe.json']);
  const sharedFiles = new Set(['shared/contract.ts', 'shared/stationery.ts', 'shared/text.ts', 'shared/hints.ts', 'shared/ago.ts']);
  for (const name of files) {
    if (!name.startsWith('package/') || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Unsafe tarball path: ' + name);
    const file = name.slice('package/'.length);
    const allowed = rootFiles.has(file) || sharedFiles.has(file) || assets.includes(file)
      || /^world\/[a-z][a-z0-9-]*\.ts$/.test(file)
      || ['world/ENV_PROMPT.md', 'world/icon.png', 'world/card-host.ps1', 'world/card-sound.ps1', 'world/fonts/catalog.json', 'world/fonts/README.md', 'world/sounds/README.md'].includes(file)
      || /^world\/stationery\/(?:catalog\.json|sources\.json|README\.md|ATTRIBUTION\.md|[a-z0-9-]+\.svg)$/.test(file)
      || /^world\/fonts\/licenses\/[^/]+\.(?:txt|md)$/.test(file)
      || /^world\/sounds\/(?:incoming\/|reply\/)?[^/]+\.(?:wav|mp3|ogg|m4a|aac|flac)$/i.test(file);
    if (!allowed) throw Error('Unexpected file in client package: ' + name);
  }
  const required = ['package.json', 'README.md', 'CHANGELOG.md', 'describe.json', 'world/index.ts', 'world/definition.ts', 'world/world.ts', 'world/ENV_PROMPT.md', 'world/icon.png', 'world/card-host.ps1', 'world/card-sound.ps1', 'world/fonts/catalog.json', 'world/sounds/incoming/incoming_default.wav', 'world/sounds/reply/reply_default.wav', ...sharedFiles, ...assets];
  for (const file of required) if (!names.has('package/' + file)) throw Error('Missing runtime file: ' + file);
  for (const asset of assets) {
    const hash = createHash('sha256').update(readEntry('package/' + asset)).digest('hex').slice(0, 12);
    if (!asset.includes(hash)) throw Error('WebUI digest mismatch: ' + asset);
  }
  // Check relative TS dependencies inside the shipped source, including dynamic imports.
  for (const name of files.filter(file => file.endsWith('.ts'))) {
    const source = readEntry(name).toString('utf8');
    const references = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g);
    for (const [, ref] of references) {
      const target = posix.normalize(posix.join(posix.dirname(name), ref));
      if (!names.has(target)) throw Error('Missing packaged import: ' + name + ' -> ' + ref);
    }
  }
  const catalog = JSON.parse(readEntry('package/world/fonts/catalog.json').toString('utf8'));
  if (catalog.baseUrl !== 'https://fontsforletters.sqnori.com/' || !catalog.fonts?.length) throw Error('Invalid remote font metadata');
  return { name: manifest.name, version: manifest.version, files: files.length, webUiAssets: assets, remoteFonts: catalog.fonts.length, bundledFontBinaries: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const archive = resolve(process.argv[2] ?? '');
  if (!archive.endsWith('.tgz')) throw Error('Usage: node scripts/check-release-package.mjs <archive.tgz>');
  function tar(args) {
    const result = spawnSync('tar', args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stderr.toString());
    return result.stdout;
  }
  const files = tar(['-tzf', archive]).toString('utf8').split(/\r?\n/).filter(Boolean);
  const cache = new Map();
  const readEntry = name => {
    if (!cache.has(name)) cache.set(name, tar(['-xOf', archive, name]));
    return cache.get(name);
  };
  const manifest = JSON.parse(readEntry('package/package.json').toString('utf8'));
  const local = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (manifest.name !== local.name || manifest.version !== local.version) throw Error('Tarball does not match local package name/version');
  const result = checkReleaseFiles(files, manifest, readEntry);
  const bytes = readFileSync(archive);
  console.log(JSON.stringify({ ...result, packedBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }, null, 2));
}
