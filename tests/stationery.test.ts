import { expect, it, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sanitizeSvg, checkStationery } from '../shared/stationery.ts';
import { loadDoodles, doodleSummary, hasDoodle, doodleAsset } from '../world/stationery.ts';
import { STATIONERY_SVG_MAX_BYTES } from '../shared/contract.ts';

const SVG_VALID = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#336699"/></svg>';

describe('SVG 校验与规范化（shared/stationery）', () => {
  it('合法 SVG 通过并输出规范化文本', () => {
    const result = sanitizeSvg(SVG_VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain('circle');
    expect(result.svg.startsWith('<svg ')).toBe(true);
  });

  it('规范化结果幂等：再次校验不变', () => {
    const first = sanitizeSvg(SVG_VALID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = sanitizeSvg(first.svg);
    expect(second).toEqual(first);
  });

  it('拒绝 script 标签', () => {
    const result = sanitizeSvg('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>');
    expect(result.ok).toBe(false);
  });

  it('拒绝 foreignObject', () => {
    const result = sanitizeSvg('<svg viewBox="0 0 1 1"><foreignObject/></svg>');
    expect(result.ok).toBe(false);
  });

  it('拒绝含 href / xlink:href', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><use href="#a"/></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><rect xlink:href="javascript:x()"/></svg>').ok).toBe(false);
  });

  it('拒绝事件属性', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1" onload="alert(1)"></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><rect onclick="x()"/></svg>').ok).toBe(false);
  });

  it('拒绝外部 URL 引用', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><rect fill="url(https://x/#a)"/></svg>').ok).toBe(false);
  });

  it('拒绝缺 viewBox', () => {
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>').ok).toBe(false);
  });

  it('拒绝超过 8 KiB', () => {
    const rects = Array.from({ length: 200 }, (_, i) => `<rect x="${i}" y="${i}" width="10" height="10" fill="#336699"/>`).join('');
    const result = sanitizeSvg(`<svg viewBox="0 0 300 300">${rects}</svg>`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(String(STATIONERY_SVG_MAX_BYTES));
  });

  it('拒绝空/非字符串输入', () => {
    expect(sanitizeSvg('').ok).toBe(false);
    expect(sanitizeSvg(null as unknown as string).ok).toBe(false);
    expect(sanitizeSvg(42 as unknown as string).ok).toBe(false);
  });
});

describe('Stationery 字段校验（shared/stationery）', () => {
  it('空/null/undefined 返回 null 值（无装饰）', () => {
    expect(checkStationery(undefined)).toEqual({ ok: true, value: null });
    expect(checkStationery(null)).toEqual({ ok: true, value: null });
    expect(checkStationery({ v: 1 })).toEqual({ ok: true, value: null });
  });

  it('有效纸张类型保留', () => {
    const result = checkStationery({ v: 1, paper: 'grid' });
    expect(result).toEqual({ ok: true, value: { v: 1, paper: 'grid' } });
  });

  it('未知字段丢弃', () => {
    const result = checkStationery({ v: 1, paper: 'line', extra: 'x' });
    expect(result).toEqual({ ok: true, value: { v: 1, paper: 'line' } });
  });

  it('内置图案 ID 格式验证', () => {
    const result = checkStationery({ v: 1, doodle: 'wave-line' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value?.doodle).toBe('wave-line');
  });

  it('doodle 与 customSvg 互斥', () => {
    expect(checkStationery({ v: 1, doodle: 'wave-line', customSvg: SVG_VALID }).ok).toBe(false);
  });

  it('版本号错误拒绝', () => {
    expect(checkStationery({ v: 3, paper: 'grid' }).ok).toBe(false);
  });

  it('未知纸张类型拒绝', () => {
    expect(checkStationery({ v: 1, paper: 'parchment' }).ok).toBe(false);
  });

  it('危险 doodle ID 拒绝（路径穿越）', () => {
    expect(checkStationery({ v: 1, doodle: '../etc/passwd' }).ok).toBe(false);
  });

  it('非对象输入拒绝', () => {
    expect(checkStationery('grid').ok).toBe(false);
  });
});

describe('内置图案目录（world/stationery）', () => {
  it('loadDoodles 返回数组，无重复 ID', () => {
    const doodles = loadDoodles();
    expect(Array.isArray(doodles)).toBe(true);
    const ids = doodles.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Invalid or missing files are silently skipped at runtime: every shipped entry must actually load.
    const catalog=JSON.parse(readFileSync(new URL('../world/stationery/catalog.json',import.meta.url),'utf8'));
    expect(ids).toEqual(catalog.doodles.map((item:{id:string})=>item.id));
  });

  it('keeps source attribution and hashes aligned with the imported illustrations',()=>{
    const sources=JSON.parse(readFileSync(new URL('../world/stationery/sources.json',import.meta.url),'utf8'));
    const attribution=readFileSync(new URL('../world/stationery/ATTRIBUTION.md',import.meta.url),'utf8');
    expect(attribution).toContain(sources.creator);expect(attribution).toContain(sources.licenseUrl);
    for(const item of sources.assets){
      expect(hasDoodle(item.id)).toBe(true);
      const raw=readFileSync(new URL('../world/stationery/'+item.file,import.meta.url));
      expect(createHash('sha256').update(raw).digest('hex')).toBe(item.sha256);
      expect(sanitizeSvg(raw.toString('utf8')).ok).toBe(true);
    }
  });

  it('doodleSummary 包含必要字段', () => {
    const summary = doodleSummary();
    for (const item of summary) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(typeof item.id).toBe('string');
    }
  });

  it('包含预期内置图案 ID', () => {
    const ids = loadDoodles().map((d) => d.id);
    expect(ids).toContain('wave-line');
    expect(ids).toContain('corner-flower');
    expect(ids).toContain('star-border');
  });

  it('hasDoodle 对已知/未知 ID 给出正确结果', () => {
    expect(hasDoodle('wave-line')).toBe(true);
    expect(hasDoodle('no-such-doodle')).toBe(false);
    expect(hasDoodle(123)).toBe(false);
    expect(hasDoodle('')).toBe(false);
  });

  it('doodleAsset 返回 SVG 字节', () => {
    const asset = doodleAsset('wave-line');
    expect(asset).not.toBeNull();
    if (!asset) return;
    expect(asset.mime).toBe('image/svg+xml');
    expect(asset.bytes.length).toBeGreaterThan(0);
    // 已经通过 sanitizeSvg 验证，内容合规
    expect(asset.bytes.toString('utf8')).toContain('<svg');
  });

  it('doodleAsset 对未知 ID 返回 null', () => {
    expect(doodleAsset('no-such-doodle')).toBeNull();
  });
});
