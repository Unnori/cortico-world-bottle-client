/** Read the same deployment record used by Core GET /api/theme; never write host settings. */
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isThemePreference, type ThemePreference } from './appearance.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MailboxTheme {
  available: boolean;
  preference?: ThemePreference;
  scheme?: string;
  mode?: 'system' | 'light' | 'dark';
  palettes?: Record<'light' | 'dark', Record<string, string>>;
}

const KEYS = ['paper', 'sheet', 'sheet-2', 'sheet-3', 'ink', 'ink-soft', 'line', 'line-2', 'line-strong',
  'accent', 'on-accent', 'ink-blue', 'ok', 'warn', 'danger'] as const;

async function json(file: string): Promise<any> {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function readMailboxTheme(botDir: string): Promise<MailboxTheme> {
  try {
    // Resolve at request time: older hosts without the theme contract can still run the mailbox.
    const [contract, stored, config] = await Promise.all([
      import('cortico/web/shared/theme.ts'), json(join(botDir, 'theme.json')), json(join(botDir, 'config.json')),
    ]);
    const { BUILTIN_PALETTES, DEFAULT_SCHEME_ID, normalizeStoredTheme, defaultStoredTheme } = contract;
    const configured = config?.web?.theme;
    const fallback = typeof configured === 'string' && Object.hasOwn(BUILTIN_PALETTES, configured) ? configured : DEFAULT_SCHEME_ID;
    const theme = stored == null ? { ...defaultStoredTheme(), selectedId: fallback } : normalizeStoredTheme(stored);
    // The settings window resolves built-ins before custom schemes and falls back to its deployment default.
    const builtin = Object.hasOwn(BUILTIN_PALETTES, theme.selectedId) ? BUILTIN_PALETTES[theme.selectedId] : null;
    const custom = theme.custom.find(item => item.id === theme.selectedId);
    const palettes = builtin ?? custom?.palettes ?? BUILTIN_PALETTES[fallback];
    const pick = (appearance: 'light' | 'dark'): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const key of KEYS) {
        const value = palettes[appearance][key];
        if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Invalid theme color');
        result[key] = value.toLowerCase();
      }
      return result;
    };
    // No custom scheme text, deployment paths or unrelated config leave this boundary.
    return { available: true, scheme: builtin ? theme.selectedId : custom ? 'custom' : fallback,
      mode: theme.mode, palettes: { light: pick('light'), dark: pick('dark') } };
  } catch { return { available: false }; }
}

/** Only mailbox preferences live in extension data; host theme settings stay read-only. */
export function readThemePreference(dataDir: string): ThemePreference | undefined {
  try {
    const value = JSON.parse(readFileSync(join(dataDir, 'bottle-appearance.json'), 'utf8'));
    return isThemePreference(value) ? { theme: value.theme, mode: value.mode, ...(value.customColor !== undefined ? { customColor:value.customColor } : {}), ...(value.background !== undefined ? { background:value.background } : {}), ...(value.backgroundTransparency !== undefined ? { backgroundTransparency:value.backgroundTransparency } : {}), ...(value.myFont !== undefined ? { myFont:value.myFont } : {}), ...(value.myFontName !== undefined ? { myFontName:value.myFontName } : {}) } : undefined;
  } catch { return undefined; }
}
export function saveThemePreference(dataDir: string, value: ThemePreference): void {
  if (!isThemePreference(value)) throw new Error('Invalid mailbox appearance');
  // An older open page may only submit theme/mode; preserve newer optional settings.
  value = { ...readThemePreference(dataDir), ...value };
  const path = join(dataDir, 'bottle-appearance.json');
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify({ theme: value.theme, mode: value.mode, ...(value.customColor !== undefined ? { customColor:value.customColor } : {}), ...(value.background !== undefined ? { background:value.background } : {}), ...(value.backgroundTransparency !== undefined ? { backgroundTransparency:value.backgroundTransparency } : {}), ...(value.myFont !== undefined ? { myFont:value.myFont } : {}), ...(value.myFontName !== undefined ? { myFontName:value.myFontName } : {}) }) + '\n', 'utf8');
    renameSync(temp, path);
  } finally { try { unlinkSync(temp); } catch { /* renamed, or never created */ } }
}
