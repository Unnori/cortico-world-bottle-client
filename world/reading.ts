import type { Stationery } from '../shared/contract.ts';

/** Describe the saved layout without pretending a model has seen a rendered image. */
export function stationeryContext(label:string,stationery?:Stationery,rejected?:boolean):string[] {
  if(rejected)return [label+'：装饰校验未通过，未显示图像。'];
  if(!stationery)return [];
  const metadata=JSON.parse(JSON.stringify(stationery,(key,value)=>key==='customSvg'?'[自定义静态 SVG，未渲染]':value));
  return [label+'：'+JSON.stringify(metadata),'以上仅保存的装饰参数，非渲染图；不臆造图像细节。'];
}
