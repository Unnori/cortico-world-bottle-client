import { DEFAULT_SOUND_PACK, LEGACY_SOUND_ALIASES } from './sound.ts';

/** Per-browser notification audio. Local files stay in this device's IndexedDB. */
export const soundSettingsHtml = `<details class="invitation-settings sound-settings" id="sound-settings">
<summary>信箱声音 · 本设备</summary>
<p>来信与回信可以用不同的声音。设置只保存在当前浏览器，不影响桌面卡片或其他设备。</p>
<div class="sound-toolbar"><label><input type="checkbox" id="sound-enabled"> 提醒我有新信</label><button class="btn" type="button" id="sound-unlock">启用声音</button><label>音量 <input id="sound-volume" type="range" min="0" max="100" value="70"></label><label>末尾淡出 <input id="sound-fade" type="number" min="0" max="5000" step="50" value="250"> 毫秒</label></div>
<div class="sound-row"><label for="sound-incoming">来信提示音</label><select id="sound-incoming"><option value="pack:${DEFAULT_SOUND_PACK.incoming}">默认来信</option><option value="local">本设备文件</option><option value="off">静音</option></select><input id="sound-incoming-file" type="file" accept="audio/*" aria-label="选择本设备的来信音效"><button id="sound-incoming-preview" class="btn" type="button">试听来信</button><small id="sound-incoming-name"></small></div>
<div class="sound-row"><label for="sound-reply">回信提示音</label><select id="sound-reply"><option value="pack:${DEFAULT_SOUND_PACK.reply}">默认回信</option><option value="local">本设备文件</option><option value="off">静音</option></select><input id="sound-reply-file" type="file" accept="audio/*" aria-label="选择本设备的回信音效"><button id="sound-reply-preview" class="btn" type="button">试听回信</button><small id="sound-reply-name"></small></div>
<p id="sound-note" role="status">手机浏览器需要先点击启用声音。打开页面不会为旧信补播；页面关闭或设备休眠时，网页无法保证声音提醒。</p>
</details>`;

export const pageSoundScript = String.raw`
(function () {
  var KEY = 'bottle-device-sound', SEEN = 'bottle-sound-seen';
  var defaults = ${JSON.stringify(DEFAULT_SOUND_PACK)}, aliases = ${JSON.stringify(LEGACY_SOUND_ALIASES)};
  var original = {}, pendingMigrations = {}, availableIds = null;
  var kinds = ['incoming', 'reply'], prefs = {}, initialized = false, context = null, queue = Promise.resolve(), sources = [];
  var versions = {incoming:0,reply:0}, previewVersion = 0;
  var MAX = 10 * 1024 * 1024, dbPromise = null, memorySeen = {incoming:[],reply:[]};
  function node(id) { return document.getElementById('sound-' + id); }
  function note(text) { node('note').textContent = text; }
  function number(value, fallback, max) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback; }
  try { prefs = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) {}
  original = {incoming:prefs.incoming,reply:prefs.reply};
  function selection(value, kind) {
    var fallback = 'pack:' + defaults[kind];
    if(value === 'local' || value === 'off')return value;
    if(typeof value !== 'string' || value.indexOf('pack:') !== 0)return fallback;
    var id = value.slice(5);
    if (availableIds && !availableIds[id] && aliases[id]) { id = aliases[id]; value = 'pack:' + id; }
    return id && (id.indexOf('/') < 0 || id.indexOf(kind + '/') === 0) ? value : fallback;
  }
  prefs = { enabled: prefs.enabled === true, volume: number(prefs.volume,70,100), fade: number(prefs.fade,250,5000),
    incoming: selection(prefs.incoming, 'incoming'), reply: selection(prefs.reply, 'reply') };
  kinds.forEach(function(kind){if(original[kind] && original[kind]!==prefs[kind])pendingMigrations[kind]=original[kind];});
  function save() { try { var stored=Object.assign({},prefs,pendingMigrations);localStorage.setItem(KEY, JSON.stringify(stored)); } catch (_) { note('浏览器未允许保存，设置仅对当前页面有效。'); } }
  function db() {
    if (!dbPromise) dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(Error('storage')); return; }
      var request = indexedDB.open('bottle-notification-audio',1);
      request.onupgradeneeded = function () { request.result.createObjectStore('files'); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return dbPromise;
  }
  function file(kind, value) { return db().then(function (database) { return new Promise(function (resolve,reject) {
    var tx=database.transaction('files',value===undefined?'readonly':'readwrite'), store=tx.objectStore('files');
    var req=value===undefined?store.get(kind):store.put(value,kind);
    tx.oncomplete=function(){resolve(req.result);}; tx.onerror=tx.onabort=function(){reject(tx.error);};
  }); }); }
  function unlock() {
    var Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return Promise.reject(Error('unsupported'));
    if (!context || context.state === 'closed') context = new Audio();
    return context.resume().then(function () { if(context.state!=='running') throw Error('blocked'); node('unlock').textContent='声音已就绪'; });
  }
  function audioData(kind, choice) {
    if(choice==='off')return Promise.resolve(null);
    if(choice==='local')return file(kind).then(function(value){if(!value)throw Error('missing');return value.arrayBuffer();});
    if(choice.indexOf('pack:')!==0)return Promise.reject(Error('missing'));
    return fetch('/sounds/'+encodeURIComponent(choice.slice(5)), {cache:'no-store'}).then(function(res){if(!res.ok)throw Error('missing');return res.arrayBuffer();});
  }
  function stopSources(kind, previewOnly) {
    sources.slice().forEach(function(item){
      if((!kind || item.kind===kind) && (!previewOnly || item.preview)) { try{item.source.stop();}catch(_){} }
    });
  }
  function choose(kind, choice) {
    if(prefs[kind]!==choice)delete pendingMigrations[kind];
    if(prefs[kind]!==choice){prefs[kind]=choice;versions[kind]++;stopSources(kind,false);}
    node(kind+'-file').hidden=choice!=='local';save();
  }
  function currentChoice(kind) {
    // Some mobile select controls commit change only after the next button press.
    var value=node(kind).value;
    if(value)choose(kind,selection(value,kind));
    return prefs[kind];
  }
  function play(kind, preview, choice, version, previewId) {
    if(!preview && (!prefs.enabled || !context || context.state!=='running'))return Promise.resolve();
    var audio=context;
    function stale(){return versions[kind]!==version || prefs[kind]!==choice || (preview && previewVersion!==previewId) || (!preview && !prefs.enabled);}
    if(stale())return Promise.resolve();
    return audioData(kind,choice).then(function(bytes){if(!bytes||stale())return null;return audio.decodeAudioData(bytes.slice(0));}).then(function(buffer){
      if(!buffer||stale())return;
      var source=audio.createBufferSource(), gain=audio.createGain(), start=audio.currentTime;
      var duration=Math.min(30,buffer.duration), fade=Math.min(prefs.fade/1000,duration), level=prefs.volume/100;
      source.buffer=buffer;source.connect(gain);gain.connect(audio.destination);
      gain.gain.setValueAtTime(level,start);
      if(fade>0){gain.gain.setValueAtTime(level,start+duration-fade);gain.gain.linearRampToValueAtTime(0,start+duration);}
      var item={source:source,kind:kind,preview:preview};sources.push(item);
      return new Promise(function(resolve){source.onended=function(){source.disconnect();gain.disconnect();sources=sources.filter(function(s){return s!==item;});resolve();};source.start(start,0,duration);});
    }).catch(function(){if(!stale())note('这段音效暂时无法播放，请重新选文件或换成 WAV / MP3。');});
  }
  node('enabled').checked=prefs.enabled;node('volume').value=prefs.volume;node('fade').value=prefs.fade;
  node('enabled').onchange=function(){prefs.enabled=this.checked;save();if(!prefs.enabled)stopSources(null,false);if(prefs.enabled)unlock().then(function(){note('已开启本设备的新信提醒。');}).catch(function(){note('请点击启用声音，允许浏览器播放。');});};
  node('unlock').onclick=function(){unlock().then(function(){prefs.enabled=true;node('enabled').checked=true;save();note('声音已就绪，有新信时会提醒。');}).catch(function(){note('浏览器暂未允许播放，请检查声音权限。');});};
  node('volume').oninput=function(){prefs.volume=number(Number(this.value),70,100);save();};
  node('fade').onchange=function(){prefs.fade=number(Number(this.value),250,5000);this.value=prefs.fade;save();};
  kinds.forEach(function(kind){
    var select=node(kind), picker=node(kind+'-file');select.value=prefs[kind];picker.hidden=prefs[kind]!=='local';
    select.oninput=select.onchange=function(){choose(kind,selection(this.value,kind));};
    picker.onchange=function(){var value=this.files&&this.files[0];if(!value)return;if(value.size>MAX){note('请选择不超过 10MB 的音效。');this.value='';return;}
      var version=++versions[kind];stopSources(kind,false);
      file(kind,value).then(function(){node(kind+'-name').textContent=value.name;if(versions[kind]!==version)return;select.value='local';choose(kind,'local');note('已保存在本设备，文件不会上传。');}).catch(function(){note('浏览器无法保存此文件，请检查本地存储权限。');});};
    node(kind+'-preview').onclick=function(){var choice=currentChoice(kind),version=versions[kind],id=++previewVersion;stopSources(null,true);unlock().then(function(){return play(kind,true,choice,version,id);}).catch(function(){note('请先允许浏览器播放声音。');});};
    file(kind).then(function(value){if(value)node(kind+'-name').textContent=value.name;}).catch(function(){});
  });
  fetch('/sounds').then(function(res){if(!res.ok)throw Error();return res.json();}).then(function(data){
    availableIds={};(data.files||[]).forEach(function(item){availableIds[item.id]=true;});
    kinds.forEach(function(kind){var select=node(kind), current=selection(prefs[kind],kind);select.textContent='';
      var files = (data.files||[]).filter(function(item){return item.kind === kind || item.kind === 'shared';});
      files.forEach(function(item){var option=document.createElement('option');option.value='pack:'+item.id;option.textContent=(item.kind==='shared'?'通用 · ':kind==='incoming'?'来信 · ':'回信 · ')+item.label;select.appendChild(option);});
      [['local','本设备文件'],['off','静音']].forEach(function(item){var option=document.createElement('option');option.value=item[0];option.textContent=item[1];select.appendChild(option);});
      if(current !== 'local' && current !== 'off' && !files.some(function(item){return 'pack:'+item.id === current;})) {
        current = files.some(function(item){return item.id === defaults[kind];}) ? 'pack:' + defaults[kind] : 'off';
      }
      if (current!==prefs[kind] && original[kind])pendingMigrations[kind]=original[kind];
      prefs[kind] = current;select.value=current;node(kind+'-file').hidden=current!=='local';
    });
    return Promise.all(kinds.map(function(kind){
      var choice=prefs[kind];
      if(!pendingMigrations[kind] || choice.indexOf('pack:')!==0)return Promise.resolve();
      return audioData(kind,choice).then(function(bytes){if(bytes && bytes.byteLength && prefs[kind]===choice){delete pendingMigrations[kind];save();}}).catch(function(){});
    }));
  }).then(function(){save();}).catch(function(){});
  document.addEventListener('pointerdown',function(){if(prefs.enabled&&(!context||context.state!=='running'))unlock().catch(function(){});},{passive:true});
  window.addEventListener('pagehide',function(){previewVersion++;kinds.forEach(function(kind){versions[kind]++;});stopSources(null,false);if(context)context.close().catch(function(){});});
  window.bottleSound={snapshot:function(snapshot){
    var ids={incoming:[],reply:[]};
    (snapshot.received||[]).forEach(function(item){ids.incoming.push(item.letterId);});
    if(snapshot.held)ids.incoming.push(snapshot.held.letterId);
    (snapshot.sent||[]).forEach(function(item){if(item.reply)ids.reply.push(item.letterId);});
    var seen=memorySeen;try{seen=JSON.parse(localStorage.getItem(SEEN))||memorySeen;}catch(_){}
    if(!seen || typeof seen!=='object' || Array.isArray(seen))seen=memorySeen;
    var fresh=[];
    kinds.forEach(function(kind){var known=Array.isArray(seen[kind])?seen[kind]:[];
      if(initialized&&ids[kind].some(function(id){return id&&known.indexOf(id)<0;}))fresh.push(kind);
      seen[kind]=Array.from(new Set(known.concat(ids[kind].filter(Boolean)))).slice(-1000);
    });
    memorySeen=seen;try{localStorage.setItem(SEEN,JSON.stringify(seen));}catch(_){}
    initialized=true;
    // The loopback desktop uses its native card sound; other devices use this browser.
    if(snapshot.desktopCards&&['127.0.0.1','localhost','[::1]'].indexOf(location.hostname)>=0)return;
    fresh.forEach(function(kind){var choice=currentChoice(kind),version=versions[kind];queue=queue.then(function(){return play(kind,false,choice,version);}).catch(function(){});});
  }};
})();
`;
