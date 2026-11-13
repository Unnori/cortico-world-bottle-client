import { expect, it } from 'vitest';
import { checkStationery, recolorSvg, sanitizeSvg, receivedStationery } from '../shared/stationery.ts';
import { defaultDoodleColor, prepareDraftStationery, stationeryDelivery, doodleAsset, loadDoodles } from '../world/stationery.ts';
import type { Stationery } from '../shared/contract.ts';

const SVG = '<svg viewBox="0 0 10 10"><defs><linearGradient id="ink"><stop stop-color="#123456"/></linearGradient><clipPath id="cut"><circle r="5"/></clipPath></defs><g fill="none" stroke="#123456"><path d="M0 0L10 10"/><rect fill="white"/><circle fill="url(#ink)" clip-path="url(#cut)"/></g></svg>';
const checked = (value: unknown): Stationery => { const r = checkStationery(value); expect(r.ok).toBe(true); if (!r.ok || !r.value) throw Error('bad fixture'); return r.value; };

it('normalizes simple presets and explicit coordinates to one stable wire format', () => {
  const value = checked({v:2,paper:'grid',paperColor:'#AABBCC',doodle:'rain-cloud',color:'#DDAACC',placement:'top-left',size:'large',x:20,rotation:-35,flipX:true,extra:'discard'});
  expect(value).toEqual({v:2,paper:'grid',paperColor:'#aabbcc',decorations:[{doodle:'rain-cloud',color:'#ddaacc',x:20,y:14,width:48,rotation:-35,opacity:.28,layer:'behind',z:0,flipX:true}]});
  expect(checkStationery(value)).toEqual({ok:true,value});
  expect(checkStationery({v:2})).toEqual({ok:true,value:null});
  expect(checked({v:2,paperColor:'#000000'})).toEqual({v:2,paperColor:'#000000'});
});

it.each([
  {x:-1},{x:101},{y:Infinity},{width:0},{width:101},{rotation:181},{opacity:.66},{opacity:NaN},
  {z:1.1},{z:8},{flipX:'true'},{flipY:1},{layer:'outside'},{placement:'__proto__'},{size:'constructor'},
  {color:'red'},{color:'#abc'},{color:'url(https://example.com)'},{doodle:'../x'},
  {doodle:'wave-line',customSvg:SVG},
])('rejects invalid drawing parameters without coercion: %j', (bad) => {
  expect(checkStationery({v:2,decorations:[{doodle:'wave-line',...bad}]}).ok).toBe(false);
});

it('bounds the whole composition, SVG bytes and malformed entries', () => {
  expect(checkStationery({v:2,doodle:'wave-line',decorations:[]}).ok).toBe(false);
  expect(checkStationery({v:2,decorations:[null]}).ok).toBe(false);
  expect(checkStationery({v:2,decorations:[{}]}).ok).toBe(false);
  expect(checkStationery({v:2,decorations:'no'}).ok).toBe(false);
  expect(checkStationery({v:2,paperColor:'rgb(0,0,0)'}).ok).toBe(false);
  expect(checkStationery({v:2,decorations:Array.from({length:9},()=>({doodle:'wave-line'}))}).ok).toBe(false);
  const svg='<svg viewBox="0 0 10 10"><text>'+ 'x'.repeat(6000) +'</text></svg>';
  expect(sanitizeSvg(svg).ok).toBe(true);
  expect(checkStationery({v:2,decorations:[{customSvg:svg},{customSvg:svg}]}).ok).toBe(true);
  expect(checkStationery({v:2,decorations:[{customSvg:svg},{customSvg:svg},{customSvg:svg}]}).ok).toBe(false);
  const quoteSvg='<svg viewBox="0 0 1 1"><text>'+ '"'.repeat(8100) +'</text></svg>';
  expect(sanitizeSvg(quoteSvg).ok).toBe(true);
  expect(checkStationery({v:2,decorations:[{customSvg:quoteSvg},{customSvg:quoteSvg}]}).ok).toBe(false);
  expect(checkStationery({v:1,doodle:'wave-line',color:'#112233'}).ok).toBe(false);
  expect(receivedStationery({v:2,decorations:[{customSvg:'<svg viewBox="0 0 1 1"><script/></svg>'}]})).toEqual({stationeryRejected:true});
});

it('tints paint while preserving transparent areas, white cutouts, gradients, clipping and geometry', () => {
  const result = recolorSvg(SVG,'#ee7788');
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.svg).toContain('stroke="#ee7788"');
  for(const part of ['fill="none"','fill="white"','fill="url(#ink)"','clip-path="url(#cut)"','d="M0 0L10 10"','stop-color="#ee7788"']) expect(result.svg).toContain(part);
  expect(recolorSvg(result.svg,'#ee7788')).toEqual(result);
  expect(recolorSvg(SVG,'url(https://example.com)').ok).toBe(false);
  expect(recolorSvg('<svg viewBox="0 0 1 1" onload="x()"/>','#112233').ok).toBe(false);
  expect(checked({v:2,customSvg:SVG}).decorations![0].customSvg).toContain('stroke="#123456"');
  expect(checked({v:2,customSvg:SVG,color:'#ee7788'}).decorations![0].customSvg).toEqual(result.svg);
});

it('freezes a personal built-in tint only in new drafts, with explicit overrides and unchanged source assets', () => {
  const original=doodleAsset('rain-cloud')!.bytes.toString('utf8');
  const legacy:Stationery={v:1,doodle:'rain-cloud'};
  const one=prepareDraftStationery(legacy,'one');
  expect(one.decorations![0].color).toEqual(defaultDoodleColor('one'));
  expect(prepareDraftStationery(legacy,'one')).toEqual(one);
  expect(defaultDoodleColor('two')).not.toEqual(defaultDoodleColor('one'));
  expect(JSON.stringify(one)).not.toContain('one');
  expect(legacy).toEqual({v:1,doodle:'rain-cloud'});
  const explicit=checked({v:2,decorations:[{doodle:'rain-cloud',color:'#112233'},{customSvg:SVG}]});
  expect(prepareDraftStationery(explicit,'one')).toEqual(explicit);
  expect(doodleAsset('rain-cloud',undefined,'#112233')!.bytes.toString('utf8')).toContain('#112233');
  expect(doodleAsset('rain-cloud')!.bytes.toString('utf8')).toBe(original);
  for(const item of loadDoodles())for(const color of ['#112233','#ffffff','#000000'])expect(doodleAsset(item.id,undefined,color)).not.toBeNull();
});

it('negotiates full layout, legacy tinted corner SVG, or plain text while retaining the local composition', () => {
  const value=checked({v:2,paper:'line',decorations:[{doodle:'rain-cloud',color:'#112233'},{doodle:'wave-line',x:5}]});
  const quota={bottles_left:1,catches_left:1,stationery:1 as const};
  expect(stationeryDelivery(value,{...quota,stationery_layout:2}).stationery).toBe(value);
  const legacy=stationeryDelivery(value,quota);
  expect(legacy.mode).toBe('legacy');expect(legacy.notice).toContain('降级');
  expect(legacy.stationery?.v).toBe(1);expect(legacy.stationery?.customSvg).toContain('#112233');
  expect(checkStationery(legacy.stationery).ok).toBe(true);
  expect(stationeryDelivery(value,{bottles_left:1,catches_left:1})).toMatchObject({mode:'plain',notice:expect.stringContaining('纯正文')});
  expect(value.decorations).toHaveLength(2);
});
