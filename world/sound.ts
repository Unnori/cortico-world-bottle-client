import { readdirSync, statSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SoundKind = 'incoming' | 'reply';
export interface SoundConfig {
  soundEnabled?: boolean; soundVolume?: number; soundFadeOutMs?: number;
  soundIncomingSource?: 'pack' | 'local' | 'off'; soundIncomingPack?: string; soundIncomingFile?: string;
  soundReplySource?: 'pack' | 'local' | 'off'; soundReplyPack?: string; soundReplyFile?: string;
}
export interface SoundFile { id: string; label: string; kind: SoundKind | 'shared' }
export const DEFAULT_SOUND_PACK = {
  incoming: 'incoming/incoming_default.wav',
  reply: 'reply/reply_default.wav',
} as const;

/** One mapping for native settings, browser preferences and old asset URLs. */
export const LEGACY_SOUND_ALIASES: Record<string, string> = {};
for (const kind of ['incoming', 'reply'] as const) {
  const fallback = DEFAULT_SOUND_PACK[kind];
  LEGACY_SOUND_ALIASES[`${kind}/default.wav`] = fallback;
  for (let n = 1; n <= 5; n++) LEGACY_SOUND_ALIASES[`${kind}/New_notifications_${n}.wav`] =
    n === 2 ? 'New_notifications_1.wav' : n === 4 ? 'New_notifications_2.wav' : n === 5 ? 'New_notifications_3.wav' : fallback;
  for (const name of ['michael-jackson-hee-hee', 'rockstone', 'taco-bell-bong', '呦吼_cut', '奶龙大笑_cut', '熊大抽象笑声_cut'])
    LEGACY_SOUND_ALIASES[`${kind}/memes_${name}.wav`] = fallback;
}
export function soundPackChoice(value: unknown, kind: SoundKind): string {
  if (typeof value !== 'string') return DEFAULT_SOUND_PACK[kind];
  return soundOptions(kind).some(file => file.id === value) ? value : LEGACY_SOUND_ALIASES[value] ?? value;
}
export interface CardSound { path: string; volume: number; fadeOutMs: number }
const ROOT = fileURLToPath(new URL('./sounds/', import.meta.url));
export const AUDIO_MAX = 10 * 1024 * 1024;
const MIME: Record<string,string> = {wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac'};
const extension = (name: string): string => name.split('.').at(-1)?.toLowerCase() ?? '';
export const soundNumber = (value: unknown, fallback: number, max: number): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;

export function soundLibrary(root = ROOT): SoundFile[] {
  const files: SoundFile[] = [];
  for (const kind of ['shared','incoming','reply'] as const) {
    const folder = kind === 'shared' ? '' : kind;
    try {
      for (const name of readdirSync(resolve(root,folder))) {
        if (!MIME[extension(name)]) continue;
        const id = folder ? folder + '/' + name : name;
        try {
          const path = realpathSync(resolve(root,id));
          const rel = relative(realpathSync(root),path);
          const stat = statSync(path);
          if (isAbsolute(rel) || rel === '..' || rel.startsWith('..'+sep) || !stat.isFile() || stat.size > AUDIO_MAX) continue;
          files.push({id,kind,label:name.replace(/\.[^.]+$/,'')});
        } catch { /* Invalid or unavailable sound is omitted, never executed. */ }
      }
    } catch { /* Empty custom pack is valid. */ }
  }
  return files.sort((a,b)=>a.id.localeCompare(b.id));
}

/** Root-level audio is shared; sibling subdirectories never leak into one another. */
export function soundOptions(kind: SoundKind, files = soundLibrary()): SoundFile[] {
  return files.filter(file => file.kind === kind || file.kind === 'shared');
}

export function packSound(id: string): { bytes: Uint8Array; mime: string } | null {
  const files = soundLibrary();
  if (!files.some(file => file.id === id)) id = LEGACY_SOUND_ALIASES[id] ?? id;
  if (!files.some(file => file.id === id)) return null;
  try { return {bytes:readFileSync(resolve(ROOT,id)),mime:MIME[extension(id)]!}; } catch { return null; }
}

export function cardSound(config: SoundConfig, kind: SoundKind): CardSound | null {
  if (config.soundEnabled === false) return null;
  const prefix = kind === 'incoming' ? 'Incoming' : 'Reply';
  const source = config[`sound${prefix}Source`] ?? 'pack';
  if (source === 'off') return null;
  const file = source === 'local' ? config[`sound${prefix}File`] ?? '' : soundPackChoice(config[`sound${prefix}Pack`], kind);
  if (!file || (source === 'pack' && !soundOptions(kind).some(item=>item.id === file))) return null;
  const path = source === 'pack' ? resolve(ROOT,file) : file;
  try {
    if (!isAbsolute(path) || !MIME[extension(path)] || !statSync(path).isFile() || statSync(path).size > AUDIO_MAX) return null;
    return {path,volume:soundNumber(config.soundVolume,70,100)/100,fadeOutMs:soundNumber(config.soundFadeOutMs,250,5000)};
  } catch { return null; }
}
