import { INITIAL_FONT_CATALOG, RemoteFontCatalog, writingFont } from './font-catalog.ts';
import { closeSync, openSync, readSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PageSnapshot } from './page.ts';

export const FONT_DIR = fileURLToPath(new URL('./fonts/', import.meta.url));
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
export const FONT_TYPES: Record<string, string> = { '00010000': 'font/ttf', '4f54544f': 'font/otf', '774f4646': 'font/woff', '774f4632': 'font/woff2' };
export interface FontFile { id: string; name: string; mime: string; path: string; url?: string; sha256?:string; bytes?:number; enabled?:boolean }
/** Root files are local imports. Only the explicitly audited subdirectory is scanned. */
export function fontLibrary(dir = FONT_DIR): FontFile[] {
  if (dir === FONT_DIR) return INITIAL_FONT_CATALOG.fonts.map(font => ({...font,path:'',mime:'font/woff2'}));
  const scan = (directory: string, aliases: Map<string, string>): FontFile[] => {
    try {
      if (lstatSync(directory).isSymbolicLink()) return [];
      return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && /\.(ttf|otf|woff2?)$/i.test(entry.name)).flatMap(entry => {
        let fd: number | undefined;
        try {
          const path = join(directory, entry.name);
          fd = openSync(path, 'r'); const header = Buffer.alloc(4); readSync(fd, header, 0, 4, 0);
          const mime = FONT_TYPES[header.toString('hex')], name = aliases.get(entry.name) ?? entry.name;
          return mime ? [{ id: hash(name), name, mime, path }] : [];
        } catch { return []; } finally { if (fd !== undefined) closeSync(fd); }
      });
    } catch { return []; }
  };
  const aliases = new Map<string, string>();
  try {
    const catalog = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'));
    if (Array.isArray(catalog.fonts)) for (const font of catalog.fonts) {
      if (font && typeof font.file === 'string' && typeof font.name === 'string' &&
          !/[\\/]/.test(font.file + font.name) && /\.woff2$/i.test(font.file) && /\.(ttf|otf|woff2?)$/i.test(font.name)) aliases.set(font.file, font.name);
    }
  } catch { /* Local-only font directories need no catalog. */ }
  // Prefer an explicitly imported original over its packaged conversion, without duplicate IDs.
  const fonts = [...scan(dir, new Map()), ...scan(join(dir, 'redistributable'), aliases)];
  const unique = new Map<string, FontFile>();
  for (const font of fonts) if (!unique.has(font.id)) unique.set(font.id, font);
  return [...unique.values()].sort((a,b) => a.name.localeCompare(b.name));
}
export function fontAsset(id: string, dir = FONT_DIR): { bytes: Buffer; mime: string } | null {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const file = fontLibrary(dir).find(font => font.id === id);
  if (!file) return null;
  try { if (!lstatSync(file.path).isFile() || lstatSync(file.path).isSymbolicLink()) return null;
    return { bytes: readFileSync(file.path), mime: file.mime }; } catch { return null; }
}

/** No reassignment on import/removal. Shared by loopback and LAN page dependencies. */
export class LetterFonts {
  private readonly file: string;
  private assignments: Record<string, string> = Object.create(null);
  private loaded = false;
  private readonly remote?:RemoteFontCatalog;
  constructor(dataDir: string, private readonly directory = FONT_DIR, remote?:RemoteFontCatalog) { this.file = join(dataDir, 'bottle-font-map.json'); this.remote = remote ?? (directory === FONT_DIR ? new RemoteFontCatalog(dataDir) : undefined); }
  refresh():Promise<void> { return this.remote?.refresh() ?? Promise.resolve(); }
  decorate(snapshot: PageSnapshot): PageSnapshot {
    if (!this.loaded) {
      try {
        const stored = JSON.parse(readFileSync(this.file, 'utf8'));
        if (stored.version !== 1 || !stored.assignments || typeof stored.assignments !== 'object') throw new Error('Invalid font dictionary');
        for (const [key,value] of Object.entries(stored.assignments)) {
          if (!/^[a-f0-9]{64}$/.test(key) || typeof value !== 'string' || !value || value.includes('/') || value.includes('\\')) throw new Error('Invalid font dictionary');
          this.assignments[key] = value;
        }
      } catch (error) {
        // Preserve a corrupt dictionary for manual recovery; never silently reshuffle it.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return snapshot;
      }
      this.loaded = true;
    }
    const catalog=this.remote?.current();
    const fonts:FontFile[] = catalog ? catalog.fonts.map(font=>({...font,path:'',mime:'font/woff2'})) : fontLibrary(this.directory);
    const available=fonts.filter(font=>font.enabled!==false);
    if (catalog) snapshot={...snapshot,fontResources:Object.fromEntries(catalog.fonts.map(font=>[font.id,{url:font.url,sha256:font.sha256,bytes:font.bytes}])),defaultFont:writingFont(catalog)};
    if (!fonts.length) return snapshot;
    const next = { ...this.assignments }; let changed = false;
    const assign = (from: string, seed?: boolean, signature?: string): string | undefined => {
      const identity = seed ? 'seed:' + (signature || from) : 'visitor:' + from;
      if (!(signature || from)) return undefined;
      const key = hash(identity);
      if (!next[key]) {
        if (!available.length) return undefined;
        const counts = available.map(font => Object.values(next).filter(name => name === font.name).length);
        const min = Math.min(...counts), candidates = available.filter((_, index) => counts[index] === min);
        next[key] = candidates[randomInt(candidates.length)].name; changed = true;
      }
      return fonts.find(font => font.name === next[key])?.id;
    };
    const result: PageSnapshot = {
      ...snapshot,
      held: snapshot.held ? { ...snapshot.held, fontId: assign(snapshot.held.from, snapshot.held.seed, snapshot.held.signature) } : null,
      received: snapshot.received.map(item => ({ ...item, fontId: assign(item.from, item.seed, item.signature) })),
      sent: snapshot.sent.map(item => ({ ...item, ...(item.reply ? { reply: { ...item.reply, fontId: assign(item.reply.from) } } : {}) })),
    };
    if (changed) {
      const temp = this.file + '.' + randomUUID() + '.tmp';
      try {
        writeFileSync(temp, JSON.stringify({ version: 1, assignments: next }, null, 2) + '\n', 'utf8');
        renameSync(temp, this.file); this.assignments = next;
      } catch { return snapshot; }
      finally { try { unlinkSync(temp); } catch { /* renamed */ } }
    }
    return result;
  }
}
