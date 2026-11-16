import {readLocalDocument,writeLocalDocument} from './local-db.ts';
/** Appearance belongs to Bottle; no host config files or internal theme modules. */


import { isThemePreference, type ThemePreference } from './appearance.ts';
import { join } from 'node:path';
import {readHostTheme,type HostThemeSnapshot} from './host-theme.ts';

export interface MailboxTheme {
  available: boolean;
  preference?: ThemePreference;
  hostTheme?: HostThemeSnapshot|null;
}

/** Local mailbox endpoint, backed exclusively by extension-owned data. */
export async function readMailboxTheme(dataDir: string): Promise<MailboxTheme> {
  return {available: true, preference: readThemePreference(dataDir),hostTheme:readHostTheme(dataDir)};
}

/** Only mailbox preferences live in extension-owned data. */
export function readThemePreference(dataDir: string): ThemePreference | undefined {
  try {
    const value = readLocalDocument(join(dataDir, 'bottle-appearance.json'));
    return isThemePreference(value) ? { theme: value.theme === 'coopanion' ? 'ocean' : value.theme, mode: value.mode, ...(value.customColor !== undefined ? { customColor:value.customColor } : {}), ...(value.background !== undefined ? { background:value.background } : {}), ...(value.backgroundTransparency !== undefined ? { backgroundTransparency:value.backgroundTransparency } : {}), ...(value.myFont !== undefined ? { myFont:value.myFont } : {}), ...(value.myFontName !== undefined ? { myFontName:value.myFontName } : {}) } : undefined;
  } catch { return undefined; }
}
export function saveThemePreference(dataDir: string, value: ThemePreference): void {
  if (!isThemePreference(value)) throw new Error('Invalid mailbox appearance');
  // An older open page may only submit theme/mode; preserve newer optional settings.
  value = { ...readThemePreference(dataDir), ...value, theme: value.theme === 'coopanion' ? 'ocean' : value.theme };
  const {theme,mode,customColor,background,backgroundTransparency,myFont,myFontName}=value;
  writeLocalDocument(join(dataDir,'bottle-appearance.json'),{theme,mode,...(customColor!==undefined?{customColor}:{}),...(background!==undefined?{background}:{}),...(backgroundTransparency!==undefined?{backgroundTransparency}:{}),...(myFont!==undefined?{myFont}:{}),...(myFontName!==undefined?{myFontName}:{})});
}
