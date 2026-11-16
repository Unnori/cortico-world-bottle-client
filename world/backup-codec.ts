/** Keep large JSON parsing and compression off the desktop event loop. No file/network access. */
import {Worker} from 'node:worker_threads';
const code=String.raw`
const {parentPort,workerData}=require('node:worker_threads');
const {gzipSync,gunzipSync}=require('node:zlib');
if(workerData.action==='encode'){
  const json=JSON.stringify(workerData.value);
  if(Buffer.byteLength(json)>workerData.limit)throw Error('展开后的备份超过 256 MiB，请分开选择类别导出。');
  parentPort.postMessage(gzipSync(json));
}else{
  const source=Buffer.from(workerData.value);
  const bytes=source[0]===31&&source[1]===139?gunzipSync(source,{maxOutputLength:workerData.limit}):source;
  if(bytes.length>workerData.limit)throw Error('展开后的备份过大。');
  parentPort.postMessage(JSON.parse(bytes.toString('utf8')));
}
`;
function codec(action:'encode'|'decode',value:unknown,limit:number):Promise<any>{return new Promise((resolve,reject)=>{
  const worker=new Worker(code,{eval:true,execArgv:[],workerData:{action,value,limit}});let settled=false;
  const finish=(error:unknown,result?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(Error('备份处理超时，原有数据没有改动。')),60000);timer.unref();
  worker.once('message',value=>finish(null,value));worker.once('error',error=>finish(error));worker.once('exit',status=>{if(!settled)finish(Error('备份处理进程提前退出：'+status));});
});}
export async function encodeBackup(value:unknown,limit:number):Promise<Buffer>{return Buffer.from(await codec('encode',value,limit));}
export async function decodeBackup(bytes:Buffer,limit:number):Promise<unknown>{return codec('decode',bytes,limit);}
