import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('builds identical content-addressed assets from LF and CRLF source files', () => {
  const require = createRequire(import.meta.url);
  const outputs = ['\n', '\r\n'].map(eol => {
    const dir = mkdtempSync(join(tmpdir(), 'bottle-build-')); dirs.push(dir);
    for (const folder of ['scripts', 'webui', 'node_modules']) mkdirSync(join(dir, folder));
    symlinkSync(realpathSync(join(require.resolve('typescript/package.json'), '..')), join(dir, 'node_modules/typescript'), 'junction');
    writeFileSync(join(dir, 'scripts/build-webui.mjs'), readFileSync(new URL('../scripts/build-webui.mjs', import.meta.url)));
    writeFileSync(join(dir, 'webui/client.ts'), ["export default { id: 'fixture' };", ''].join(eol));
    writeFileSync(join(dir, 'webui/style.css'), ['.fixture {', '  color:red;', '}', ''].join(eol));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'build-fixture', type: 'module', cortico: {}, ...(eol === '\n' ? { files: ['world', 'dist', 'dist/webui-old.js', 'README.md'] } : {}) }));
    const built = spawnSync(process.execPath, [join(dir, 'scripts/build-webui.mjs')], { encoding: 'utf8', timeout: 10_000 });
    expect(built.status, built.stderr || built.stdout).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (eol === '\n') expect(manifest.files).toEqual(['world', manifest.cortico.webUiClient, manifest.cortico.webUiStyle, 'README.md']);
    else expect(manifest.files).toBeUndefined();
    return ['webUiClient', 'webUiStyle'].map(key => {
      const path = manifest.cortico[key];
      const bytes = readFileSync(join(dir, path));
      expect(bytes.includes(13)).toBe(false);
      expect(path).toContain(createHash('sha256').update(bytes).digest('hex').slice(0, 12));
      return { path, text: bytes.toString('utf8') };
    });
  });
  expect(outputs[0]).toEqual(outputs[1]);
});
