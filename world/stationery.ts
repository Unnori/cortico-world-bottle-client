/**
 * 内置手账素材目录。素材随客户端分发，不上传服务器：信里只传稳定 ID。
 *
 * 目录条目按 `id` 认，不按文件顺序；`file` 只允许本目录下的 `.svg` 文件名。
 * 内置素材同样经过 shared/stationery.ts 的白名单校验，校验不过的条目不会出现在目录里——
 * 免得某天随手放进一张带外链的 SVG，就绕过了自创图的那道闸。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sanitizeSvg, checkStationery, recolorSvg } from '../shared/stationery.ts';
import type { Stationery, Quota } from '../shared/contract.ts';

export interface DoodleCatalogItem { id: string; name: string; tags: string[]; file: string }
export interface DoodleSummary { id: string; name: string; tags: string[] }

const ROOT = new URL('./stationery/', import.meta.url);
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const FILE = /^[a-z0-9][a-z0-9-]{0,63}\.svg$/;

interface LoadedDoodle extends DoodleCatalogItem { svg: string }
let cache: { root: string; items: LoadedDoodle[] } | null = null;

/** 读取并校验目录；同一目录只读一次。`root` 只给测试用。 */
export function loadDoodles(root: URL = ROOT): LoadedDoodle[] {
  if (cache?.root === root.href) return cache.items;
  const items: LoadedDoodle[] = [];
  try {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL('catalog.json', root)), 'utf8')) as { doodles?: unknown };
    const seen = new Set<string>();
    for (const entry of Array.isArray(raw.doodles) ? raw.doodles : []) {
      const row = entry as Partial<DoodleCatalogItem> | null;
      if (!row || typeof row.id !== 'string' || !ID.test(row.id) || seen.has(row.id)) continue;
      if (typeof row.file !== 'string' || !FILE.test(row.file)) continue;
      if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 24) continue;
      const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length <= 16).slice(0, 6) : [];
      let checked;
      try { checked = sanitizeSvg(readFileSync(fileURLToPath(new URL(row.file, root)), 'utf8')); } catch { continue; }
      if (!checked.ok) continue;
      seen.add(row.id);
      items.push({ id: row.id, name: row.name.trim(), tags, file: row.file, svg: checked.svg });
    }
  } catch { /* 没有目录或目录损坏：只是没有内置素材，写信照常。 */ }
  cache = { root: root.href, items };
  return items;
}

/** 给桌宠的精简目录：只有 ID、名字和语义标签，没有 SVG 源码和文件名。 */
export function doodleSummary(root?: URL): DoodleSummary[] {
  return loadDoodles(root).map(({ id, name, tags }) => ({ id, name, tags }));
}

export function hasDoodle(id: unknown, root?: URL): boolean {
  return typeof id === 'string' && loadDoodles(root).some(item => item.id === id);
}

/** 信箱页取图用；返回的是校验后的规范文本。 */
export function doodleAsset(id: string, root?: URL, color?: string): { bytes: Buffer; mime: string } | null {
  const item = loadDoodles(root).find(row => row.id === id);
  if (!item) return null;
  const svg = color === undefined ? sanitizeSvg(item.svg) : recolorSvg(item.svg, color);
  return svg.ok ? { bytes: Buffer.from(svg.svg, 'utf8'), mime: 'image/svg+xml' } : null;
}

/** 稳定的本机画笔色；只传最终颜色，不把本机标识带进信里。 */
export function defaultDoodleColor(identity: string): string {
  const hash = createHash('sha256').update('bottle-doodle:' + identity).digest();
  const h = hash.readUInt16BE(0) / 65536 * 6, s = .35 + hash[2] / 255 * .3, l = .34 + hash[3] / 255 * .16;
  const chroma = (1 - Math.abs(2 * l - 1)) * s, x = chroma * (1 - Math.abs(h % 2 - 1)), m = l - chroma / 2;
  const rgb = [[chroma,x,0],[x,chroma,0],[0,chroma,x],[0,x,chroma],[x,0,chroma],[chroma,0,x]][Math.floor(h)];
  return '#' + rgb.map(n => Math.round((n + m) * 255).toString(16).padStart(2,'0')).join('');
}

/** 只用于新起草的信；历史信件不改色。将自动选色固化在草稿里供双方一致预览。 */
export function prepareDraftStationery(value: Stationery, identity: string): Stationery {
  const color = defaultDoodleColor(identity);
  if (value.v === 1) {
    if (!value.doodle) return value;
    const checked = checkStationery({ ...value, v: 2, color });
    return checked.ok && checked.value ? checked.value : value;
  }
  return { ...value, ...(value.decorations ? { decorations: value.decorations.map(d => d.doodle && !d.color ? { ...d, color } : d) } : {}) };
}

/** 老海边只传它已声明能理解的版本，不能静默丢掉新属性。 */
export function stationeryDelivery(value: Stationery | undefined, quota: Quota | null | undefined): { stationery?: Stationery; notice: string; mode: 'full' | 'legacy' | 'plain' } {
  if (!value) return { notice: '', mode: 'full' };
  if (!quota?.stationery) return { notice: '当前海边不支持装饰，已降级为纯正文，完整排版保留在本机。', mode: 'plain' };
  if (value.v === 1 || quota.stationery_layout === 2) return { stationery: value, notice: '', mode: 'full' };
  const first = value.decorations?.[0];
  let svg: string | undefined = first?.customSvg;
  if (first?.doodle && first.color) svg = doodleAsset(first.doodle, undefined, first.color)?.bytes.toString('utf8');
  const legacy: Stationery = { v: 1, ...(value.paper ? { paper: value.paper } : {}),
    ...(svg ? { customSvg: svg } : first?.doodle ? { doodle: first.doodle } : {}) };
  const checked = checkStationery(legacy);
  return { ...(checked.ok && checked.value ? { stationery: checked.value } : {}), mode: 'legacy',
    notice: '当前海边只支持旧版装饰，已降级为单图角落样式，完整排版保留在本机。' };
}
