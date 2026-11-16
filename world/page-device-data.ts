/** Explicit device collection: browser caches are never silently uploaded. */
export const deviceDataScript=String.raw`
(function(){
  var collect=document.getElementById('device-data-collect'),refreshData=document.getElementById('device-data-refresh'),apply=document.getElementById('device-data-apply'),source=document.getElementById('device-data-source'),note=document.getElementById('device-data-result');
  if(!collect)return;
  var busy=false,device;
  try{device=localStorage.getItem('bottle-data-device');}catch(e){}
  if(!/^[a-z0-9-]{1,64}$/.test(device||'')){device=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'device-'+Date.now()+'-'+Math.random().toString(16).slice(2);try{localStorage.setItem('bottle-data-device',device);}catch(e){}}
  function encode(bytes){var text='';for(var i=0;i<bytes.length;i+=8192)text+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));return btoa(text);}
  async function call(method,input,path){var response=await fetch(path||'/data/action',{method:'POST',headers:{'content-type':'application/json','x-bottle':'1'},body:JSON.stringify(path?input:{method:method,input:input})});var data=await response.json();if(!response.ok||data.ok===false)throw Error(data.message||'没有完成，原有数据仍保留。');return data;}
  function controls(value){busy=value;collect.disabled=refreshData.disabled=apply.disabled=value;}
  collect.onclick=async function(){if(busy)return;controls(true);note.textContent='正在收集本设备素材…';try{
    if(!window.bottleDeviceAudio)throw Error('声音设置尚未就绪，请稍后再试。');
    var data=await window.bottleDeviceAudio.snapshot(),preferences={sound:data.preferences},assets=[];
    var size=Number(readPref('bottle-reading-size','26'));if(size>=18&&size<=40)preferences.readingSize=size;
    try{var dock=JSON.parse(readPref('bottle-reader-dock','null'));if(dock)preferences.readerDock=dock;}catch(e){}
    for(var item of data.files){if(item.file.size>10485760)throw Error('自选音效不能超过 10 MiB。');var bytes=new Uint8Array(await item.file.arrayBuffer());assets.push({name:item.file.name||'我的音效.wav',data:encode(bytes),slot:item.slot,type:item.file.type});}
    var result=await call('collectDevice',{id:device,preferences:preferences,assets:assets},'/data/device');note.textContent=result.message;
  }catch(e){note.textContent=e.message||'素材没有收集成功，浏览器原文件仍在。';}finally{controls(false);}};
  refreshData.onclick=async function(){if(busy)return;controls(true);try{var status=await call('status');source.replaceChildren();(status.devices||[]).forEach(function(id,index){var option=document.createElement('option');option.value=id;option.textContent=id===device?'本设备上次保存的偏好':'以前保存的设备 '+(index+1);source.append(option);});document.getElementById('device-data-restore').hidden=!source.options.length;note.textContent=source.options.length?'请选择要在本设备使用的偏好，不会改动其他设备。':'备份库里还没有收集过的设备偏好。';}catch(e){note.textContent=e.message;}finally{controls(false);}};
  apply.onclick=async function(){if(busy||!source.value)return;controls(true);try{
    var data=await call('device',{id:source.value});if(!data.preferences)throw Error('这份设备偏好已不在了。');
    await window.bottleDeviceAudio.apply(data);
    if(typeof data.preferences.readingSize==='number')applyReadingSize(data.preferences.readingSize,true);
    if(data.preferences.readerDock){savePref('bottle-reader-dock',JSON.stringify(data.preferences.readerDock));readerEdge=data.preferences.readerDock.edge;readerY=data.preferences.readerDock.y;dockReader(false);}
    note.textContent='已用于本设备。声音仍需你点击「启用声音」后才能播放。';
  }catch(e){note.textContent=e.message||'没有应用成功。';}finally{controls(false);}};
})();
`;
