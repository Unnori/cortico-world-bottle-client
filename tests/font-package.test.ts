import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
const folders:string[]=[];
afterEach(()=>{for(const dir of folders.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'bottle-font-package-'));folders.push(dir);const base=join(dir,'world/fonts');mkdirSync(base,{recursive:true});writeFileSync(join(base,'catalog.json'),readFileSync(new URL('../world/fonts/catalog.json',import.meta.url)));return{dir,base};}
const run=(dir:string)=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/check-font-package.mjs',import.meta.url)),dir],{encoding:'utf8'});
it('远程字库发布校验允许元数据，拒绝任何本地字体与隔离目录',()=>{
 const{dir,base}=fixture();expect(run(dir).status).toBe(0);
 writeFileSync(join(base,'unknown.woff2'),'wOF2');expect(run(dir).stderr).toContain('Unnecessary binary');rmSync(join(base,'unknown.woff2'));
 mkdirSync(join(base,'restricted'));writeFileSync(join(base,'restricted','notice.txt'),'archive');expect(run(dir).stderr).toContain('Archived folder');
});
it('远程字库发布校验拒绝未知域名与被改写的稳定ID',()=>{
 const{dir,base}=fixture(),path=join(base,'catalog.json'),catalog=JSON.parse(readFileSync(path,'utf8'));
 catalog.fonts[0].url='https://example.org/font.woff2';writeFileSync(path,JSON.stringify(catalog));expect(run(dir).stderr).toContain('Invalid remote font record');
 catalog.fonts[0].url=catalog.baseUrl+catalog.fonts[0].file;catalog.fonts[0].id='0'.repeat(64);writeFileSync(path,JSON.stringify(catalog));expect(run(dir).stderr).toContain('Invalid remote font record');
});
