import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkReleaseFiles } from '../scripts/check-release-package.mjs';

function fixture() {
  const js = Buffer.from('export default {};\n'), css = Buffer.from('body{}\n');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const manifest = { name: 'cortico-world-bottle', version: '0.8.0', cortico: { webUiClient: `dist/webui-${hash(js)}.js`, webUiStyle: `dist/webui-${hash(css)}.css` } };
  const entries = new Map(['package.json', 'README.md', 'CHANGELOG.md', 'describe.json', 'world/index.ts', 'world/definition.ts', 'world/world.ts', 'world/ENV_PROMPT.md', 'world/icon.png', 'world/card-host.ps1', 'world/card-sound.ps1', 'world/sounds/incoming/incoming_default.wav', 'world/sounds/reply/reply_default.wav', 'shared/contract.ts', 'shared/stationery.ts', 'shared/text.ts', 'shared/hints.ts', 'shared/ago.ts'].map(file => ['package/' + file, Buffer.from('')]));
  entries.set('package/' + manifest.cortico.webUiClient, js); entries.set('package/' + manifest.cortico.webUiStyle, css);
  entries.set('package/world/fonts/catalog.json', Buffer.from(JSON.stringify({ baseUrl: 'https://fontsforletters.sqnori.com/', fonts: [{}] })));
  entries.set('package/world/index.ts', Buffer.from("import { BOTTLE } from './definition.ts'; export default BOTTLE;"));
  return { manifest, entries, run: files => checkReleaseFiles(files ?? [...entries.keys()], manifest, name => entries.get(name)) };
}
it('accepts only the runtime client, hashed WebUI, audio and remote font metadata', () => {
  const h = fixture(); expect(h.run()).toMatchObject({ version: '0.8.0', bundledFontBinaries: 0, remoteFonts: 1 });
});
it.each(['tests/private.test.ts', 'server/db.ts', 'backups/snapshot.json', 'scratch/session.log', 'node_modules/private.js', '.env', '.npmrc', 'world/bottle-notes.json', 'world/font.woff2', 'world/fonts/restricted/license.txt', 'world/sounds/test.tgz', 'dist/webui.js', 'promo-video/render.mp4', 'world/../README.md'])('rejects non-client or unsafe tarball file %s', file => {
  const h = fixture(); expect(() => h.run([...h.entries.keys(), 'package/' + file])).toThrow(/Unexpected file|Unsafe tarball/);
});
it('rejects duplicate, missing runtime files and altered hashed assets', () => {
  const h = fixture(); expect(() => h.run([...h.entries.keys(), 'package/world/index.ts'])).toThrow('Duplicate');
  h.entries.delete('package/world/card-host.ps1'); expect(() => h.run()).toThrow('Missing runtime file');
  h.entries.set('package/world/card-host.ps1', Buffer.from('')); h.entries.set('package/' + h.manifest.cortico.webUiStyle, Buffer.from('changed')); expect(() => h.run()).toThrow('digest mismatch');
});
it('rejects a runtime import whose source is not in the tarball', () => {
  const h = fixture(); h.entries.set('package/world/index.ts', Buffer.from("export { x } from '../server/app.ts'")); expect(() => h.run()).toThrow('Missing packaged import');
});
it('CI retains the Trusted Publishing identity and publishes the exact checked archive', () => {
  const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');
  expect(workflow).toContain('environment: npm'); expect(workflow).toContain('id-token: write');
  expect(workflow).toContain('types: [published]'); expect(workflow).toContain('node scripts/check-release-package.mjs "$archive"');
  expect(workflow).toContain('npm publish "${{ steps.pack.outputs.archive }}" --provenance --access public');
  expect(workflow).not.toContain('npm pack --dry-run');
});
