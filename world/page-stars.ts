// Keep the supplied icon path intact, including its hollow centre.
const starPath = 'M908.1 353.1l-253.9-36.9L540.7 86.1c-3.1-6.3-8.2-11.4-14.5-14.5-15.8-7.8-35-1.3-42.9 14.5L369.8 316.2l-253.9 36.9c-7 1-13.4 4.3-18.3 9.3-12.3 12.7-12.1 32.9 0.6 45.3l183.7 179.1-43.4 252.9c-1.2 6.9-0.1 14.1 3.2 20.3 8.2 15.6 27.6 21.7 43.2 13.4L512 754l227.1 119.4c6.2 3.3 13.4 4.4 20.3 3.2 17.4-3 29.1-19.5 26.1-36.9l-43.4-252.9 183.7-179.1c5-4.9 8.3-11.3 9.3-18.3 2.7-17.5-9.5-33.7-27-36.3zM664.8 561.6l36.1 210.3L512 672.7 323.1 772l36.1-210.3-152.8-149L417.6 382 512 190.7 606.4 382l211.2 30.7-152.8 148.9z';

export const starHtml = `<button class="folder star-folder" data-category="stars" type="button" aria-pressed="false"><svg class="star-icon" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false"><path d="${starPath}"/></svg><span>星笺匣</span><b id="stars-count">0</b></button>`;

export const starScript = String.raw`
  var starPending = false;

  function starRows() {
    var rows = new Map();
    (state && state.stars || []).forEach(function (row) {
      if (!row || typeof row.letterId !== 'string' || !row.letterId) return;
      var previous = rows.get(row.letterId);
      if (!previous || row.category === 'reply' || (previous.category !== 'reply' && row.starredAt > previous.starredAt)) rows.set(row.letterId, row);
    });
    return Array.from(rows.values()).sort(function (a, b) { return b.starredAt - a.starredAt; });
  }
  function starIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'star-icon');
    svg.setAttribute('viewBox', '0 0 1024 1024');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ${JSON.stringify(starPath)});
    svg.appendChild(path);
    return svg;
  }
  function starControl(control, memory) {
    control.dataset.starControl = memory || 'star';
    control.disabled = starPending || (memory === 'letter' && !(state && state.starMemoryEnabled === true));
    if (starPending) control.setAttribute('aria-busy', 'true');
    return control;
  }
  function syncStarControls() {
    document.querySelectorAll('[data-star-control]').forEach(function (control) {
      starControl(control, control.dataset.starControl);
      if (!starPending) control.removeAttribute('aria-busy');
    });
  }
  function changeStar(path, payload) {
    if (starPending || busy) return;
    starPending = true;
    syncStarControls();
    return api(path, payload).then(function (result) {
      if (!result || result.ok !== true) toast(result && result.message || '没有保存成功，请再试一次。', true);
      else toast(result.message || '已保存。');
      return refresh().then(function(){return result;});
    }).catch(function () {
      toast('信箱暂时打不开，稍后再试一次。', true);
    }).then(function (result) {
      starPending = false;
      syncStarControls();
      return result;
    });
  }
  function starButton(letterId) {
    var starred = starRows().some(function (row) { return row.letterId === letterId; });
    var button = starControl(el('button', 'letter-star'));
    button.type = 'button';
    button.dataset.letterId = letterId;
    button.setAttribute('aria-pressed', String(starred));
    button.setAttribute('aria-label', starred ? '移出星笺匣' : '加入星笺匣');
    button.title = starred ? '移出星笺匣' : '加入星笺匣';
    button.appendChild(starIcon());
    button.appendChild(el('span', 'star-button-label', starred ? '已星标' : '星标'));
    button.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      var request=changeStar('/star', { letterId: letterId, starred: !starred });
      if(request&&!starred)request.then(function(r){if(r&&r.ok===true)askStarMemory(letterId);});
    };
    return button;
  }
  function askStarMemory(letterId){
    var dialog=document.getElementById('star-consent-dialog'),yes=document.getElementById('star-consent-yes');
    document.getElementById('star-consent-title').textContent='让这封信留在'+botName()+'的记忆里？';
    document.getElementById('star-consent-copy').textContent='星标已经收好。你也可以让'+botName()+'记住这段往来，往后的聊天里或许会想起它。';
    function close(){if(dialog.close)dialog.close();else dialog.open=false;}
    document.getElementById('star-consent-no').onclick=close;
    yes.disabled=false;yes.onclick=async function(){
      if(yes.disabled)return;yes.disabled=true;
      try{
        if(!state||state.starMemoryEnabled!==true){var enabled=await api('/star-memory-setting',{enabled:true});if(!enabled.ok){toast(enabled.message||'未能开启记忆。',true);return;}}
        var result=await changeStar('/star-memory',{letterId:letterId,enabled:true});if(result&&result.ok)close();
      }catch(e){toast('没有加入记忆，请稍后重试。',true);}finally{yes.disabled=false;}
    };
    if(!dialog.open){if(dialog.showModal)dialog.showModal();else dialog.open=true;if(typeof reveal==='function')reveal(dialog);}
  }
  function starTarget(row) {
    var matches = bookEntries().filter(function (entry) { return entry.item.letterId === row.letterId; });
    return matches.find(function (entry) { return entry.category === 'reply'; }) ||
      matches.find(function (entry) { return entry.category === row.category; }) || matches[0];
  }
  function jumpToStar(row) {
    var target = starTarget(row);
    if (!target) {
      var held = state && state.held;
      var heldButton = held && held.letterId === row.letterId && Array.from(document.querySelectorAll('#stage .letter-star')).find(function (button) { return button.dataset.letterId === row.letterId; });
      if (heldButton) { centerStar(heldButton.closest('.card'), heldButton); return; }
      toast('这封通信已不在信箱中，请刷新后再试。', true);
      return;
    }
    captureDetails();
    category = target.category;
    savePref('bottle-category', category);
    document.getElementById('letter-date').value = '';
    var key = category + ':' + row.letterId;
    openedLetters[key] = true;
    var book = document.getElementById('letterbook');
    if (book._foldAnimation) { book._foldAnimation.cancel(); book._foldAnimation = null; }
    book.style.height = ''; book.style.overflow = ''; book._foldTarget = undefined; book.open = true;
    renderBook();
    var mail = Array.from(document.querySelectorAll('details[data-fold-key]')).find(function (node) { return node.dataset.foldKey === key; });
    if (mail) centerStar(mail, mail.querySelector('summary'));
  }
  function centerStar(node, focus) {
    if (!node) return;
    node.classList.add('star-location');
    if (focus) focus.focus({ preventScroll: true });
    if (node.scrollIntoView) node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'instant' : 'smooth' });
  }
  function starMemoryPanel() {
    var enabled = state.starMemoryEnabled === true;
    var panel = el('section', 'star-memory-panel');
    panel.setAttribute('aria-label', '星笺匣记忆授权');
    var label = el('label', 'star-memory-global');
    var input = starControl(el('input'), 'global');
    input.type = 'checkbox'; input.checked = enabled;
    input.setAttribute('aria-describedby', 'star-memory-privacy');
    input.onchange = function () {
      var next = input.checked; input.checked = enabled;
      changeStar('/star-memory-setting', { enabled: next });
    };
    label.appendChild(input);
    label.appendChild(el('strong', null, '允许' + botName() + '记住选中的通信'));
    panel.appendChild(label);
    panel.appendChild(el('p', 'star-global-state', enabled ? '已开启，请逐封选择想让' + botName() + '记住的通信。' : '只收藏，不会把正文交给' + botName() + '。'));
    var explanation = el('details', 'star-memory-explanation');
    explanation.appendChild(el('summary', null, '关于信件与记忆'));
    var privacy = el('p', 'star-memory-privacy', '星标本身不会把正文提供给' + botName() + '。开启总开关后，还需要逐封勾选「让' + botName() + '记住」。取消勾选、取消星标或关闭总开关，会移除这项功能管理的记忆，但不会撤回已经进入对话上下文或摘要的内容。关闭总开关也会清空逐封选择。');
    privacy.id = 'star-memory-privacy';
    explanation.appendChild(privacy);
    panel.appendChild(explanation);
    return panel;
  }
  function renderStars(list) {
    list.appendChild(starMemoryPanel());
    var enabled = state.starMemoryEnabled === true;
    var date = document.getElementById('letter-date').value;
    var rows = starRows().filter(function (row) { return !date || dateKey(row.at) === date; });
    rows.forEach(function (row) {
      var article = el('article', 'mail star-row');
      var jump = el('button', 'star-open');
      jump.type = 'button';
      var symbol = el('span', 'mail-symbol');
      symbol.appendChild(icon('mail'));
      jump.appendChild(symbol);
      var subject = el('span', 'mail-subject');
      subject.appendChild(el('strong', null, row.title || '无题信'));
      var labels = { received: '来客来信', seed: '海边邮局', sent: '寄出的信', reply: '收到的回信' };
      var target = starTarget(row);
      subject.appendChild(el('small', null, (labels[target ? target.category : row.category] || '信件') + ' · ' + (row.from || '') + (fmt(row.at) ? ' · ' + fmt(row.at) : '')));
      subject.appendChild(el('span', 'star-open-hint', '重读这封信'));
      jump.appendChild(subject);
      jump.onclick = function () { jumpToStar(row); };
      article.appendChild(jump);
      article.appendChild(starButton(row.letterId));
      var memory = el('div', 'star-memory-choice');
      var label = el('label');
      var input = starControl(el('input'), 'letter');
      input.type = 'checkbox'; input.checked = enabled && row.memorySelected === true;
      input.setAttribute('aria-describedby', 'star-memory-privacy');
      input.onchange = function () {
        var next = input.checked; input.checked = enabled && row.memorySelected === true;
        if (!state || state.starMemoryEnabled !== true) return;
        changeStar('/star-memory', { letterId: row.letterId, enabled: next });
      };
      label.appendChild(input);
      label.appendChild(el('strong', null, '让' + botName() + '记住'));
      memory.appendChild(label);
      var active = enabled && row.memorySelected === true && row.memoryActive === true;
      memory.dataset.active = String(active);
      memory.appendChild(el('span', 'star-memory-state', !enabled ? '全局已关闭 · 未授权' : !row.memorySelected ? '未授权记忆' : active ? '记忆已生效' : '已选择 · 尚未生效'));
      article.appendChild(memory);
      list.appendChild(article);
    });
    if (!rows.length) {
      var empty = el('div', 'empty empty-mail');
      empty.appendChild(starIcon());
      empty.appendChild(el('div', 'big', date ? '这一天，没有星标通信' : '星笺匣还空着'));
      empty.appendChild(el('p', null, date ? '选择全部日期，看看其他星标通信。' : '点亮信件旁的星标，把想再读的通信收在这里。'));
      list.appendChild(empty);
    }
  }
`;

export const starStyles = `
  #bottle-mailbox { --star-gold:#ac780b; }
  :root[data-appearance="dark"] #bottle-mailbox { --star-gold:#efc35d; }
  #bottle-mailbox .star-icon { display:block; width:20px; height:20px; flex:none; fill:currentColor; stroke:none; }
  #bottle-mailbox .star-folder > .star-icon { width:19px; height:19px; }
  #bottle-mailbox .letter-star { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-width:44px; min-height:44px; padding:6px 8px; border:1px solid transparent; border-radius:8px; background:transparent; color:var(--muted); font-family:inherit; font-size:11px; line-height:1.4; cursor:pointer; flex:none; transition:background var(--motion) var(--ease),color var(--motion) var(--ease); }
  #bottle-mailbox .letter-star .star-icon { width:18px; height:18px; transition:transform .18s var(--ease),color var(--motion) var(--ease); }
  #bottle-mailbox .letter-star[aria-pressed="true"] .star-icon { color:var(--star-gold); }
  #bottle-mailbox .letter-star[aria-pressed="true"] { color:var(--ink); }
  #bottle-mailbox .letter-star:hover:not(:disabled) { background:var(--tint); }
  #bottle-mailbox .letter-star:active:not(:disabled) .star-icon { transform:scale(.9); }
  #bottle-mailbox .star-held-heading { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
  #bottle-mailbox .star-held-heading > .letter-star { margin-left:auto; letter-spacing:normal; }
  #bottle-mailbox .star-memory-panel { padding:0 0 18px; margin-bottom:18px; border-bottom:1px solid var(--line); }
  #bottle-mailbox .star-memory-global,#bottle-mailbox .star-memory-choice label { display:flex; align-items:center; gap:9px; min-height:44px; cursor:pointer; font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
  #bottle-mailbox :is(.star-memory-global,.star-memory-choice) strong { font-weight:500; }
  #bottle-mailbox :is(.star-memory-global,.star-memory-choice) input { flex:none; width:22px; height:22px; margin:0; accent-color:var(--accent-text,var(--accent)); cursor:pointer; }
  #bottle-mailbox .star-global-state { margin:0 0 6px 31px; color:var(--muted); font-size:12px; }
  #bottle-mailbox .star-memory-explanation { margin-left:31px; }
  #bottle-mailbox .star-memory-explanation > summary { width:fit-content; min-height:32px; padding:4px 0; color:var(--accent-text,var(--accent)); cursor:pointer; font-size:11px; }
  #bottle-mailbox .star-memory-privacy { max-width:74ch; margin:6px 0 0; color:var(--muted); font-size:12px; line-height:1.85; overflow-wrap:anywhere; }
  #bottle-mailbox .star-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:0; }
  #bottle-mailbox .star-open { display:flex; align-items:center; gap:14px; min-width:0; padding:18px 0 16px 18px; border:0; background:transparent; color:var(--ink); text-align:left; cursor:pointer; }
  #bottle-mailbox .star-open small { overflow-wrap:anywhere; }
  #bottle-mailbox .star-open-hint { display:block; margin-top:6px; color:var(--accent-text,var(--accent)); font-size:11px; }
  #bottle-mailbox .star-open:hover .star-open-hint { text-decoration:underline; text-underline-offset:3px; }
  #bottle-mailbox .star-row > .letter-star { align-self:start; margin:12px 8px 0 4px; }
  #bottle-mailbox .star-memory-choice { grid-column:1/-1; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0 12px; padding:2px 18px; border-top:1px solid var(--line); background:var(--panel); transition:background var(--motion) var(--ease); }
  #bottle-mailbox .star-memory-state { font-size:12px; color:var(--muted); }
  #bottle-mailbox .star-memory-choice[data-active="true"] .star-memory-state { color:var(--ok); }
  #bottle-mailbox :is(.letter-star,.star-open,input[data-star-control]):focus-visible { outline:3px solid var(--focus); outline-offset:3px; }
  #bottle-mailbox [data-star-control]:disabled { cursor:not-allowed; opacity:.55; }
  #bottle-mailbox .empty-mail > .star-icon { width:42px; height:42px; margin:0 auto 14px; color:var(--star-gold); }
  #bottle-mailbox .star-location { animation:star-location 1.1s ease-out; }
  @keyframes star-location { from { box-shadow:0 0 0 3px var(--star-gold); } to { box-shadow:0 0 0 0 transparent; } }
  @media(max-width:560px) { #bottle-mailbox .mail-badges .star-button-label,#bottle-mailbox .star-row .star-button-label { display:none; } #bottle-mailbox .star-open { padding:14px 0 14px 12px; gap:10px; } #bottle-mailbox .star-open .mail-symbol { width:30px; height:38px; } #bottle-mailbox .star-row > .letter-star { margin:8px 4px 0 0; } #bottle-mailbox .star-memory-choice { padding:4px 12px 8px; gap:0 8px; } #bottle-mailbox .star-memory-state { font-size:11px; } }
  @media(prefers-reduced-motion:reduce) { #bottle-mailbox :is(.letter-star,.star-icon,.star-location,.star-memory-choice) { animation:none; transition:none; } }
`;
