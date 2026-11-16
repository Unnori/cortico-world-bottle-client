import {readLocalDocument,writeLocalDocument} from './local-db.ts';
/** Browser-observed colors, owned by Bottle. Never reads deployment theme files. */

import {join} from 'node:path';


export const HOST_THEME_KEYS = ['paper','sheet','sheet-2','sheet-3','ink','ink-soft','line','line-strong','accent','on-accent','ink-blue','ok','warn','danger'] as const;
export type HostThemeKey = typeof HOST_THEME_KEYS[number];
export interface HostThemeSnapshot {
  selectedId: string;
  appearance: 'light'|'dark';
  palette: Partial<Record<HostThemeKey,string>>;
  at: number;
  observedAt: number;
  hostVersion: string;
}
function input(value:unknown): Omit<HostThemeSnapshot,'observedAt'>|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  if(typeof v.selectedId!=='string'||!v.selectedId.trim()||v.selectedId.length>128||/[\x00-\x1f\x7f]/.test(v.selectedId)||
    !['light','dark'].includes(String(v.appearance))||typeof v.at!=='number'||!Number.isFinite(v.at)||v.at<0||
    !v.palette||typeof v.palette!=='object'||Array.isArray(v.palette))return null;
  const source=v.palette as Record<string,unknown>,palette:HostThemeSnapshot['palette']={};
  for(const key of HOST_THEME_KEYS){
    if(!Object.hasOwn(source,key))continue;
    if(typeof source[key]!=='string'||!/^#[0-9a-f]{6}$/i.test(source[key]))return null;
    palette[key]=(source[key] as string).toLowerCase();
  }
  if(!Object.keys(palette).length)return null;
  const hostVersion=typeof v.hostVersion==='string'&&/^[a-z0-9.+_-]{1,64}$/i.test(v.hostVersion)?v.hostVersion:'unknown';
  return {selectedId:v.selectedId.trim(),appearance:v.appearance as 'light'|'dark',palette,at:v.at,hostVersion};
}
export function readHostTheme(dataDir:string):HostThemeSnapshot|null {
  try{
    const stored=readLocalDocument(join(dataDir,'bottle-host-theme.json')),valid=input(stored);
    return valid&&typeof stored.observedAt==='number'&&Number.isFinite(stored.observedAt)&&stored.observedAt>=0
      ? {...valid,observedAt:stored.observedAt}:null;
  }catch{return null;}
}
export function hostThemeSummary(snapshot:HostThemeSnapshot|null):Omit<HostThemeSnapshot,'palette'>|null {
  if(!snapshot)return null;
  const {palette:_,...summary}=snapshot;return summary;
}
export function saveHostTheme(dataDir:string,value:unknown,observedAt=Date.now()):HostThemeSnapshot {
  const valid=input(value);if(!valid)throw new Error('Invalid host theme snapshot');
  const snapshot={...valid,observedAt};
  writeLocalDocument(join(dataDir,'bottle-host-theme.json'),snapshot);
  return snapshot;
}
