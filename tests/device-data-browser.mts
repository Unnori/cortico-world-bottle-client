/** Explicit collection and application using synthetic device files, never personal browser data. */
import assert from 'node:assert/strict';
import {makeHarness} from './helpers.ts';
import {FakeHost} from './fake-host.ts';
import {readSetting,listAssets} from '../world/local-db.ts';
const h=makeHarness({port:0,config:{randomWake:false}});await h.world.start(new FakeHost());let tab:string|undefined;
async function rpc(path:string,body?:string):Promise<any>{const response=await fetch('http://localhost:3456'+path,{method:body===undefined?'GET':'POST',body,signal:AbortSignal.timeout(20000)});const data=await response.json();if(Object.hasOwn(data,'error'))throw Error(JSON.stringify(data.error));return data;}
const run=async(code:string)=>(await rpc('/eval?target='+tab,code)).value;
async function until(code:string){for(let n=0;n<100;n++){if(await run(code))return;await new Promise(done=>setTimeout(done,100));}throw Error('Timed out '+code);}
try{
  const url=Reflect.get(h.world,'page').url;tab=(await rpc('/new',url)).targetId;
  await until("!!window.bottleDeviceAudio && !!document.getElementById('device-data-collect')");
  await run("window.testErrors=[];addEventListener('error',e=>testErrors.push(e.message));addEventListener('unhandledrejection',e=>testErrors.push(String(e.reason)));document.getElementById('device-data').open=true;true");
  await run("(()=>{const bytes=new Uint8Array(48),view=new DataView(bytes.buffer);bytes.set([82,73,70,70],0);view.setUint32(4,40,true);bytes.set([87,65,86,69,102,109,116,32],8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);bytes.set([100,97,116,97],36);view.setUint32(40,4,true);const input=document.getElementById('sound-incoming-file'),data=new DataTransfer();data.items.add(new File([bytes],'synthetic-own.wav',{type:'audio/wav'}));input.files=data.files;input.dispatchEvent(new Event('change'));return true})()");
  await until("document.getElementById('sound-incoming-name').textContent==='synthetic-own.wav'");
  assert.equal(listAssets(h.dir,'sound').length,0,'Selecting a browser file alone must not upload it.');
  await run("document.getElementById('device-data-collect').click();true");await until("document.getElementById('device-data-result').textContent.includes('已收进本机备份库')");
  const device=await run("localStorage.getItem('bottle-data-device')");const preferences=readSetting(h.dir,'device:'+device);assert.equal(preferences.sound.incoming,'local');assert.equal(preferences.readingSize,26);assert.equal(listAssets(h.dir,'sound').length,1);
  await run("document.getElementById('sound-incoming').value='off';document.getElementById('sound-incoming').dispatchEvent(new Event('change'));document.getElementById('device-data-refresh').click();true");await until("document.getElementById('device-data-source').options.length>0");
  await run("document.getElementById('device-data-apply').click();true");await until("document.getElementById('device-data-result').textContent.includes('已用于本设备')");
  assert.equal(await run("document.getElementById('sound-incoming').value"),'local');assert.equal(await run("document.getElementById('sound-incoming-name').textContent"),'synthetic-own.wav');assert.equal(await run("document.getElementById('sound-enabled').checked"),false);
  assert.deepEqual(await run('window.testErrors'),[]);
  console.log(JSON.stringify({synthetic:true,fileStaysInBrowserUntilExplicitCollection:true,collectedIntoSqlite:true,readingPreferences:true,restoredFileAndSelection:true,noAutomaticPlayback:true}));
}finally{if(tab)await rpc('/close?target='+tab).catch(()=>{});await h.stop();}
