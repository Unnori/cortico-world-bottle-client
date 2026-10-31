import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import ts from 'typescript';

// This single browser entry has type-only imports and no runtime dependencies.
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('webui/client.ts', root), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true,
} }).outputText;
if (/^import\s/m.test(output)) throw new Error('The browser entry must not have runtime imports');
mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/webui.js', root), output);
copyFileSync(new URL('webui/style.css', root), new URL('dist/webui.css', root));
console.log('Built dist/webui.js and dist/webui.css');
