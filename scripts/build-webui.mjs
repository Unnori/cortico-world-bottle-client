import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// The host caches extension assets for a year using package version + basename.
// A development version can be rebuilt many times: content-addressed basenames
// avoid serving yesterday's panel without requiring a host/Core change.
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('webui/client.ts', root), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true,
} }).outputText;
if (/^import\s/m.test(output)) throw new Error('The browser entry must not have runtime imports');
const css = readFileSync(new URL('webui/style.css', root), 'utf8');
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 12);
const jsName = `webui-${digest(output)}.js`;
const cssName = `webui-${digest(css)}.css`;
const dist = new URL('dist/', root);
mkdirSync(dist, { recursive: true });
writeFileSync(new URL(jsName, dist), output);
writeFileSync(new URL(cssName, dist), css);
// Compatibility aliases are not referenced by the new manifest.
writeFileSync(new URL('webui.js', dist), output);
writeFileSync(new URL('webui.css', dist), css);
const manifestPath = new URL('package.json', root);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.cortico.webUiClient = `dist/${jsName}`;
manifest.cortico.webUiStyle = `dist/${cssName}`;
const temporary = new URL('package.json.webui-tmp', root);
writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n');
renameSync(temporary, manifestPath);
// Only remove this builder's obsolete generated files, never arbitrary dist files.
for (const name of readdirSync(dist)) {
  if (/^webui-[a-f0-9]{12}\.(?:js|css)$/.test(name) && name !== jsName && name !== cssName) unlinkSync(new URL(name, dist));
}
console.log(`Built dist/${jsName} and dist/${cssName}`);
