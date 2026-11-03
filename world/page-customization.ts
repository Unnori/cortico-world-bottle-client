import { DEFAULT_MY_FONT } from './default-font.ts';

export const customizationHtml = `
  <details class="customization-settings" id="customization-settings">
    <summary><span>个性化信箱</span><span class="customization-caption">颜色、风景与笔迹</span></summary>
    <div class="customization-content">
      <section class="customization-section">
        <div class="customization-heading"><label for="custom-color">我的主题色</label><span id="custom-color-value">#4B62A0</span></div>
        <div class="custom-color-row"><label class="color-choice" for="custom-color"><input id="custom-color" type="color" value="#4b62a0" aria-label="自定义主题色"><span>选一种喜欢的颜色</span></label><button id="theme-custom" type="button" aria-pressed="false"><span>使用此色</span><span class="theme-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 8 3 3 7-7"/></svg></span></button></div>
        <p class="customization-help">保留你选的颜色，文字会随明暗调节。</p>
      </section>
      <section class="customization-section">
        <div class="customization-heading"><label for="background-file">信箱背景</label><button id="background-remove" type="button" disabled>恢复默认</button></div>
        <label class="asset-upload" for="background-file"><span class="asset-thumb" id="background-preview" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 17 6-6 4 4 3-3 5 5"/><circle cx="16" cy="8" r="1"/></svg></span><span class="asset-copy"><strong id="background-label">选择一张风景</strong><small>PNG / JPEG / WebP · 最大 8 MB</small></span><span class="asset-plus" aria-hidden="true">＋</span><input class="asset-input" id="background-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <div id="background-options" class="background-options" hidden><div class="customization-heading"><label for="background-transparency">背景透明度</label><output id="background-transparency-value" for="background-transparency">82%</output></div><input id="background-transparency" type="range" min="0" max="100" step="1" value="82"><div class="range-captions"><span>清晰</span><span>淡出</span></div></div>
      </section>
      <section class="customization-section">
        <div class="customization-heading"><label for="my-font-file">自定义我的字体</label><button id="my-font-remove" type="button" disabled>恢复默认</button></div>
        <label class="asset-upload" for="my-font-file"><span class="asset-thumb font-thumb" aria-hidden="true">笺</span><span class="asset-copy"><strong id="my-font-name">${DEFAULT_MY_FONT.name}（默认）</strong><small>TTF / OTF / WOFF / WOFF2 · 最大 32 MB</small></span><span class="asset-plus" aria-hidden="true">＋</span><input class="asset-input" id="my-font-file" type="file" accept=".ttf,.otf,.woff,.woff2"></label>
        <p id="my-font-preview" class="my-font-preview" data-my-letter="true">把这一刻的心事，写给远方。</p>
        <p class="customization-help">字体仅在本地信箱生效，不会随信寄出，也不会影响收件人的展示效果。</p>
      </section>
      <p id="customization-note" class="customization-note" role="status">外观会保存在这只信箱。</p>
    </div>
  </details>`;

export const customizationScript = String.raw`
  var customColor = '#4b62a0', backgroundId = null, backgroundTransparency = 82;
  var defaultMyFont = ${JSON.stringify(DEFAULT_MY_FONT)};
  var myFontId = null, myFontName = '', backgroundBusy = false, myFontBusy = false;
  var customColors = JSON.parse(document.getElementById('custom-palettes').textContent || '{}');
  var customColorRequest = 0, backgroundRequest = 0, requestedBackground;
  var letterFaces = Object.create(null), fontResources = Object.create(null), backgroundLayer = 0;
  var fontDbPromise;
  function fontDatabase() {
    if (!fontDbPromise) fontDbPromise = new Promise(function (resolve) {
      var database;try{database=window.indexedDB;}catch(error){resolve(null);return;}
      if (!database) { resolve(null); return; }
      var finished=false,timer=setTimeout(function(){finished=true;resolve(null);},2000);
      try {
        var request=database.open('bottle-letter-fonts',1);
        request.onupgradeneeded=function(){if(!request.result.objectStoreNames.contains('fonts'))request.result.createObjectStore('fonts');};
        request.onsuccess=function(){clearTimeout(timer);if(finished){request.result.close();return;}finished=true;request.result.onversionchange=function(){request.result.close();};resolve(request.result);};
        request.onerror=request.onblocked=function(){clearTimeout(timer);finished=true;resolve(null);};
      } catch(error) {clearTimeout(timer);finished=true;resolve(null);}
    });
    return fontDbPromise;
  }
  function fontCache(action,key,value) {
    return fontDatabase().then(function(db){return new Promise(function(resolve){
      if(!db){resolve(null);return;}
      var timer=setTimeout(function(){resolve(null);},1500);
      try {
        var tx=db.transaction('fonts',action==='get'?'readonly':'readwrite'),store=tx.objectStore('fonts');
        var request=action==='get'?store.get(key):action==='delete'?store.delete(key):store.put(value,key);
        request.onsuccess=function(){if(action==='get'){clearTimeout(timer);resolve(request.result);}};
        tx.oncomplete=function(){clearTimeout(timer);resolve(null);};
        request.onerror=function(){clearTimeout(timer);resolve(null);};
        tx.onabort=function(){clearTimeout(timer);resolve(null);};
      } catch(error){clearTimeout(timer);resolve(null);}
    });});
  }
  function validFontResource(resource) {
    return resource && /^[a-f0-9]{64}$/.test(resource.sha256||'') && Number.isSafeInteger(resource.bytes) && resource.bytes>=48 && resource.bytes<=33554432 && resource.url==='https://fontsforletters.sqnori.com/fonts/'+resource.sha256+'.woff2';
  }
  async function checkFontBytes(bytes,resource) {
    if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==resource.bytes)throw Error('Invalid font size');
    var view=new DataView(bytes);
    if(view.getUint32(0)!==0x774f4632||view.getUint32(8)!==bytes.byteLength)throw Error('Invalid font data');
    if(window.crypto&&crypto.subtle){var hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(function(n){return n.toString(16).padStart(2,'0');}).join('');if(hash!==resource.sha256)throw Error('Invalid font digest');}
  }
  async function remoteFontFace(family,resource) {
    var bytes=await fontCache('get',resource.url);
    if(bytes)try{await checkFontBytes(bytes,resource);var cached=new FontFace(family,bytes,{display:'swap'});await cached.load();return cached;}catch(error){await fontCache('delete',resource.url);}
    var response=await fetch(resource.url,{mode:'cors',credentials:'omit',cache:'force-cache',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Font unavailable');
    bytes=await response.arrayBuffer();await checkFontBytes(bytes,resource);
    var face=new FontFace(family,bytes,{display:'swap'});await face.load();
    await fontCache('put',resource.url,bytes);return face;
  }
  function fontNode(node, fontId, own) {
    if (own) { node.dataset.myLetter = 'true'; fontId = myFontId || defaultMyFont.id; }
    else if(fontId) node.dataset.letterFont=fontId;
    var valid = own ? /^[a-f0-9]{64}\.(ttf|otf|woff2?)$/.test(fontId || '') : /^[a-f0-9]{64}$/.test(fontId || '');
    var resource=own&&(!myFontId||myFontId===defaultMyFont.id)?defaultMyFont:!own?fontResources[fontId]:null;
    var personal=own&&myFontId&&myFontId!==defaultMyFont.id;
    if (valid && (personal||validFontResource(resource)) && typeof FontFace !== 'undefined' && document.fonts) {
      var family = (own ? 'bottle-mine-' : 'bottle-') + fontId,url=personal?'/my-font/'+fontId:resource.url;
      var previous=letterFaces[family];
      if (!previous||previous.url!==url||(!previous.loading&&!previous.face&&Date.now()>=previous.retryAt)) {
        if(previous&&previous.face)document.fonts.delete(previous.face);
        var record={url:url,loading:true,face:null,retryAt:0};letterFaces[family]=record;
        var task;
        if(personal){var localFace=new FontFace(family,'url("'+url+'")',{display:'swap'});task=localFace.load();}
        else task=remoteFontFace(family,resource);
        task.then(function(face){if(letterFaces[family]!==record)return;record.face=face;record.loading=false;document.fonts.add(face);}).catch(function(){record.loading=false;record.retryAt=Date.now()+60000;});
      }
      node.style.fontFamily = '"' + family + '", "Songti SC", "Microsoft YaHei", serif';
    } else node.style.fontFamily = '';
    return node;
  }
  function updateFontResources(snapshot) {
    fontResources=Object.create(null);
    Object.keys(snapshot.fontResources||{}).forEach(function(id){if(/^[a-f0-9]{64}$/.test(id)&&validFontResource(snapshot.fontResources[id]))fontResources[id]=snapshot.fontResources[id];});
    if(validFontResource(snapshot.defaultFont)&&snapshot.defaultFont.id===snapshot.defaultFont.sha256+'.woff2'&&typeof snapshot.defaultFont.name==='string')defaultMyFont=snapshot.defaultFont;
    document.querySelectorAll('[data-letter-font]').forEach(function(node){fontNode(node,node.dataset.letterFont,false);});
    applyMyFont();updateMyFontLabel();
  }
  function fontLetter(text, fontId, small, own) { return fontNode(el('div', small ? 'letter small' : 'letter', text), fontId, own); }
  function updateMyFontLabel() {
    var name = myFontId ? myFontName || '已选择我的字体' : defaultMyFont.name + '（默认）';
    document.getElementById('my-font-name').textContent = myFontBusy ? '正在读取字体…' : name;
    document.getElementById('my-font-current').textContent = '写信笔迹 · ' + name;
  }
  function applyMyFont() { document.querySelectorAll('[data-my-letter]').forEach(function (node) { fontNode(node, null, true); }); }
  function showBackgroundOptions(show) {
    var node = document.getElementById('background-options');
    if (node._visibilityAnimation && node._visibilityTarget === show) return;
    node._visibilityTarget = show;
    if (node._visibilityAnimation) { node._visibilityAnimation.cancel(); node._visibilityAnimation = null; }
    if (show === !node.hidden) return;
    if (!node.animate || reducedMotion()) { node.hidden = !show; return; }
    node.hidden = false;
    if (document.hidden || (node.getClientRects && !node.getClientRects().length)) { node.hidden = !show; return; }
    var height = node.getBoundingClientRect().height;
    var animation = node.animate(show ? [{height:'0px',opacity:0},{height:height+'px',opacity:1}] : [{height:height+'px',opacity:1},{height:'0px',opacity:0}],{duration:240,easing:'cubic-bezier(.2,.7,.2,1)'});
    node._visibilityAnimation = animation;
    afterAnimation(animation,function(){if(node._visibilityAnimation===animation){node.hidden=!show;node._visibilityAnimation=null;}});
  }
  function updateBackground() {
    var root=document.documentElement;
    root.style.setProperty('--background-opacity',String((100-backgroundTransparency)/100));
    if (requestedBackground === backgroundId) return;
    requestedBackground=backgroundId; var request=++backgroundRequest;
    if (!backgroundId) { root.dataset.backgroundVisible='false'; return; }
    var url='/background/'+backgroundId, image=new Image();
    image.onload=function(){
      if(request!==backgroundRequest)return;
      var next=document.getElementById('background-layer-'+(1-backgroundLayer)),previous=document.getElementById('background-layer-'+backgroundLayer);
      next.style.backgroundImage='url("'+url+'")'; next.classList.add('visible');previous.classList.remove('visible');
      backgroundLayer=1-backgroundLayer;root.dataset.backgroundVisible='true';
    };
    image.onerror=function(){if(request===backgroundRequest){requestedBackground=undefined;document.getElementById('customization-note').textContent='背景暂时没能加载，可以重新选择图片。';}};
    image.src=url;
  }
  function applyCustomization(appearance) {
    var root = document.documentElement, palette = customColors[appearance] || {};
    Object.keys(palette).forEach(function (key) { root.style.setProperty('--' + key, currentTheme === 'custom' ? palette[key] : ''); });
    root.dataset.customBackground = backgroundId ? 'true' : 'false';
    root.style.setProperty('--mailbox-background', backgroundId ? 'url("/background/' + backgroundId + '")' : 'none');
    root.style.setProperty('--custom-color', customColor);
    document.getElementById('custom-color').value = customColor;
    document.getElementById('custom-color-value').textContent=customColor.toUpperCase();
    document.getElementById('background-remove').disabled = !backgroundId || backgroundBusy;
    document.getElementById('background-label').textContent=backgroundBusy?'正在放入风景…':backgroundId?'换一张风景':'选择一张风景';
    var preview=document.getElementById('background-preview');
    if(preview.style)preview.style.backgroundImage=backgroundId?'url("/background/'+backgroundId+'")':'';
    preview.setAttribute('data-has-image',String(!!backgroundId));
    document.getElementById('background-transparency').value=String(backgroundTransparency);
    document.getElementById('background-transparency-value').textContent=backgroundTransparency+'%';
    showBackgroundOptions(!!backgroundId);
    document.getElementById('my-font-remove').disabled=!myFontId||myFontBusy;
    updateMyFontLabel();
    updateBackground();applyMyFont();
  }
  document.getElementById('background-transparency').oninput=function(){
    backgroundTransparency=Math.max(0,Math.min(100,Number(this.value)||0));
    document.getElementById('background-transparency-value').textContent=backgroundTransparency+'%';
    document.documentElement.style.setProperty('--background-opacity',String((100-backgroundTransparency)/100));
  };
  document.getElementById('background-transparency').onchange=function(){this.oninput();syncAppearance();};
  document.getElementById('custom-color').onchange = function () {
    var selected = this.value;
    if (!/^#[0-9a-f]{6}$/i.test(selected)) return;
    var request = ++customColorRequest, note = document.getElementById('customization-note');
    note.textContent = '正在换上你的颜色…';
    fetch('/palette/' + selected.slice(1)).then(function (res) { if (!res.ok) throw new Error('palette'); return res.json(); }).then(function (palettes) {
      if (request !== customColorRequest) return;
      if (!palettes.light || !palettes.dark || !Object.keys(palettes.light).length || !Object.keys(palettes.dark).length || ![palettes.light,palettes.dark].every(function (p) { return Object.keys(p).every(function (k) { return /^#[0-9a-f]{6}$/i.test(p[k]); }); })) throw new Error('palette');
      customColor = selected; customColors = palettes; applyTheme('custom', true);
      note.textContent = '已换上你选的颜色。';
    }).catch(function () { if (request === customColorRequest) { document.getElementById('custom-color').value = customColor; note.textContent = '暂时没能换色，请再试一次。'; } });
  };
  function readUpload(file) {return new Promise(function(resolve,reject){var reader=new FileReader();reader.onerror=reject;reader.onload=function(){resolve(String(reader.result).split(',')[1]);};reader.readAsDataURL(file);});}
  document.getElementById('background-file').onchange = function () {
    var input = this, file = input.files && input.files[0], note = document.getElementById('customization-note');
    if (!file || backgroundBusy) return;
    if (file.size > 8 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) { note.textContent = '请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。'; input.value = ''; return; }
    input.disabled = true;backgroundBusy=true;document.getElementById('background-remove').disabled=true;
    document.getElementById('background-label').textContent='正在放入风景…';note.textContent='正在把这片风景放进信箱…';
    readUpload(file).then(function(data){return new Promise(function(resolve,reject){var image=new Image();image.onerror=reject;image.onload=function(){if(image.naturalWidth*image.naturalHeight>40000000){reject(new Error('size'));return;}resolve(data);};image.src='data:'+file.type+';base64,'+data;});})
      .then(function(data){return fetch('/background',{method:'POST',headers:{'Content-Type':'application/json','x-bottle':'1'},body:JSON.stringify({data:data})});})
      .then(function(res){if(!res.ok)throw new Error('upload');return res.json();})
      .then(function(result){if(!result.ok||!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(result.id))throw new Error('upload');backgroundId=result.id;applyTheme(currentTheme,false);syncAppearance();note.textContent='风景已换好，可以用下方滑条调整透明度。';})
      .catch(function(){note.textContent='背景没有换成。请换一张可打开的图片，或稍后重试。';})
      .then(function(){input.disabled=false;input.value='';backgroundBusy=false;applyCustomization(document.documentElement.dataset.appearance);});
  };
  document.getElementById('background-remove').onclick = function () {
    backgroundId = null; applyTheme(currentTheme, false); syncAppearance();
    document.getElementById('customization-note').textContent = '已恢复信箱原来的背景。';
  };
  document.getElementById('my-font-file').onchange=function(){
    var input=this,file=input.files&&input.files[0],note=document.getElementById('customization-note');
    if(!file||myFontBusy)return;
    if(file.size>32*1024*1024||!/[.](ttf|otf|woff2?)$/i.test(file.name)){note.textContent='请选择不超过 32 MB 的 TTF、OTF、WOFF 或 WOFF2 字体。';input.value='';return;}
    myFontBusy=true;input.disabled=true;document.getElementById('my-font-remove').disabled=true;document.getElementById('my-font-name').textContent='正在读取字体…';
    file.arrayBuffer().then(function(bytes){return new FontFace('bottle-upload-check',bytes).load();})
      .then(function(){return readUpload(file);})
      .then(function(data){return fetch('/my-font',{method:'POST',headers:{'Content-Type':'application/json','x-bottle':'1'},body:JSON.stringify({data:data,name:file.name})});})
      .then(function(res){if(!res.ok)throw new Error('font upload');return res.json();})
      .then(function(result){if(!result.ok||!/^[a-f0-9]{64}\.(ttf|otf|woff2?)$/.test(result.id))throw new Error('font upload');myFontId=result.id;myFontName=result.name;applyMyFont();syncAppearance();reveal(document.getElementById('my-font-preview'));note.textContent='你的笔迹已换好，仅改变本地信箱里的展示。';})
      .catch(function(){note.textContent='字体没有换成。请选择可用的字体文件，或稍后重试。';})
      .then(function(){myFontBusy=false;input.disabled=false;input.value='';applyCustomization(document.documentElement.dataset.appearance);});
  };
  document.getElementById('my-font-remove').onclick=function(){myFontId=null;myFontName='';applyMyFont();applyCustomization(document.documentElement.dataset.appearance);syncAppearance();reveal(document.getElementById('my-font-preview'));document.getElementById('customization-note').textContent='已恢复默认写信字体。';};
`;
