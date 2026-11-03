/** Shared semantic colors for the mailbox and its native desktop cards. */
import type { MailboxTheme } from './theme.ts';
export type ThemeChoice = 'ocean' | 'paper' | 'coopanion' | 'custom';
export type AppearanceMode = 'system' | 'light' | 'dark';
export interface ThemePreference { theme: ThemeChoice; mode: AppearanceMode; customColor?: string; background?: string | null; backgroundTransparency?: number; myFont?: string | null; myFontName?: string }
export const DEFAULT_APPEARANCE: ThemePreference = { theme: 'ocean', mode: 'system' };
export function isThemePreference(value: unknown): value is ThemePreference {
  if (!value || typeof value !== 'object') return false;
  const pref = value as ThemePreference;
  return ['ocean','paper','coopanion','custom'].includes(pref.theme) && ['system','light','dark'].includes(pref.mode)
    && (pref.customColor === undefined || (typeof pref.customColor === 'string' && /^#[0-9a-f]{6}$/i.test(pref.customColor)))
    && (pref.backgroundTransparency === undefined || (typeof pref.backgroundTransparency === 'number' && Number.isFinite(pref.backgroundTransparency) && pref.backgroundTransparency >= 0 && pref.backgroundTransparency <= 100))
    && (pref.myFont === undefined || pref.myFont === null || (typeof pref.myFont === 'string' && /^[a-f0-9]{64}\.(ttf|otf|woff2?)$/.test(pref.myFont)))
    && (pref.myFontName === undefined || (typeof pref.myFontName === 'string' && pref.myFontName.length <= 120 && !/[\x00-\x1f\x7f]/.test(pref.myFontName)))
    && (pref.background === undefined || pref.background === null || (typeof pref.background === 'string' && /^[a-f0-9]{64}\.(png|jpg|webp)$/.test(pref.background)));
}
export const MAILBOX_PALETTES = {
  "ocean": {
    "light": {
      "paper": "#f0f4fb",
      "card": "#fffefa",
      "ink": "#25334f",
      "muted": "#65748b",
      "line": "#d9e1ed",
      "accent": "#4b62a0",
      "seal": "#4b60a2",
      "sea": "#37758e",
      "soft": "#eaf0f8",
      "panel": "#f8faff",
      "on-accent": "#ffffff",
      "warning-bg": "#fbf2df",
      "warning-line": "#e9d9b5",
      "warning-text": "#795a25",
      "danger-text": "#92483f"
    },
    "dark": {
      "paper": "#151d2e",
      "card": "#202c41",
      "ink": "#e5ecf7",
      "muted": "#acbad1",
      "line": "#37475e",
      "accent": "#a9bdf5",
      "seal": "#a9bdf5",
      "sea": "#9ed3e5",
      "soft": "#26344b",
      "panel": "#1c283c",
      "on-accent": "#18263e",
      "warning-bg": "#3c3021",
      "warning-line": "#70583a",
      "warning-text": "#ebce92",
      "danger-text": "#f0b2ae"
    }
  },
  "paper": {
    "light": {
      "paper": "#f6f1e6",
      "card": "#fffdf7",
      "ink": "#352f28",
      "muted": "#7d7467",
      "line": "#e3d9c8",
      "accent": "#8a6540",
      "seal": "#a8453c",
      "sea": "#527981",
      "soft": "#f4efe4",
      "panel": "#fffaf1",
      "on-accent": "#ffffff",
      "warning-bg": "#fbf2df",
      "warning-line": "#e9d9b5",
      "warning-text": "#795a25",
      "danger-text": "#92483f"
    },
    "dark": {
      "paper": "#211e19",
      "card": "#2c2822",
      "ink": "#f0e7d9",
      "muted": "#c1b29c",
      "line": "#4a4135",
      "accent": "#dbb48b",
      "seal": "#eba69c",
      "sea": "#a3cacf",
      "soft": "#362f26",
      "panel": "#29251f",
      "on-accent": "#34241d",
      "warning-bg": "#3c3021",
      "warning-line": "#70583a",
      "warning-text": "#ebce92",
      "danger-text": "#f0b2ae"
    }
  }
} as const;
export type MailboxPalette = Record<keyof typeof MAILBOX_PALETTES.ocean.light, string> & { 'accent-text'?: string };
export interface CardAppearance { preference: ThemePreference; palettes: Record<'light' | 'dark', MailboxPalette> }
export function paletteDeclarations(theme: 'ocean' | 'paper', mode: 'light' | 'dark'): string {
  return Object.entries(MAILBOX_PALETTES[theme][mode]).map(([key,value]) => `--${key}:${value};`).join(' ');
}
function mixColor(a: string, b: string, weight: number): string {
  return '#' + [1,3,5].map(index => Math.round(parseInt(a.slice(index,index+2),16)*weight + parseInt(b.slice(index,index+2),16)*(1-weight)).toString(16).padStart(2,'0')).join('');
}
export function cardAppearance(preference: ThemePreference, host: MailboxTheme): CardAppearance {
  if (preference.theme === 'custom') return { preference, palettes: customPalettes(preference.customColor ?? '#4b62a0') };
  const palettes = preference.theme === 'paper' ? MAILBOX_PALETTES.paper : MAILBOX_PALETTES.ocean;
  if (preference.theme !== 'coopanion' || !host.available || !host.palettes) return { preference, palettes };
  const map = (mode: 'light' | 'dark'): MailboxPalette => {
    const p = host.palettes![mode];
    return { paper:p.paper, card:p.sheet, ink:p.ink, muted:p['ink-soft'], line:p.line, accent:p.accent,
      seal:p.accent, sea:p['ink-blue'], soft:p['sheet-3'], panel:p['sheet-2'], 'on-accent':p['on-accent'],
      'warning-bg':mixColor(p.warn,p.sheet,.12), 'warning-line':mixColor(p.warn,p.line,.35), 'warning-text':p.warn, 'danger-text':p.danger };
  };
  return { preference, palettes: { light:map('light'), dark:map('dark') } };
}

/** Tint paper and ink together, but keep readable contrast even for white/black custom colors. */
export function customPalettes(color: string): Record<'light' | 'dark', MailboxPalette> {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid custom color');
  const luminance = (hex: string): number => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255)
    .map(c => c <= .04045 ? c/12.92 : Math.pow((c+.055)/1.055,2.4))
    .reduce((sum,c,i) => sum + c * [.2126,.7152,.0722][i],0);
  const contrast = (a: string, b: string): number => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  const map = (mode: 'light' | 'dark'): MailboxPalette => {
    const dark = mode === 'dark', base = dark ? '#141820' : '#ffffff';
    const card = mixColor(color,base,dark ? .09 : .025);
    const ink = dark ? '#f4f5f7' : '#20242c';
    let accent = color;
    for (let i=0; i<20 && contrast(accent,card)<4.5; i++) accent = mixColor(accent,dark ? '#ffffff' : '#000000',.85);
    return { ...MAILBOX_PALETTES.ocean[mode], card, ink, accent:color.toLowerCase(), seal:color.toLowerCase(), sea:color.toLowerCase(), 'accent-text':accent,
      paper:mixColor(color,base,dark ? .04 : .075), panel:mixColor(color,base,dark ? .07 : .04),
      soft:mixColor(color,base,dark ? .14 : .06), line:mixColor(ink,card,.2), muted:mixColor(ink,card,.72),
      'on-accent':contrast(color,'#ffffff') >= contrast(color,'#000000') ? '#ffffff' : '#000000' };
  };
  return { light:map('light'), dark:map('dark') };
}
