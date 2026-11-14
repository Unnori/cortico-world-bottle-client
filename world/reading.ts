import type { Stationery } from '../shared/contract.ts';

/** Describe the saved layout without pretending a model has seen a rendered image. */
export function stationeryContext(label:string,stationery?:Stationery,rejected?:boolean):string[] {
  if(rejected)return [label+': the decoration could not be validated; no image was displayed.'];
  if(!stationery)return [];
  const metadata=JSON.parse(JSON.stringify(stationery,(key,value)=>key==='customSvg'?'[custom static SVG; not rendered here]':value));
  return [label+': '+JSON.stringify(metadata),'This is saved stationery metadata, not a rendered image. Do not invent visual details that it does not describe.'];
}
