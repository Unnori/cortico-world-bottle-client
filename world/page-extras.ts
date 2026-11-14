export const extrasHtml = `<div id="paper-parking" hidden><section id="paper-compose" class="paper-slip paper-compose" hidden aria-label="小纸条草稿"><strong>随这封回信，留张小纸条</strong><p class="paper-hint">由桌宠写下，寄出用一次打捞机会。草稿最多保留一小时。</p><p id="paper-body"></p><div class="actions"><button id="paper-send" class="btn" type="button">寄出小纸条</button><button id="paper-rewrite" class="btn ghost" type="button">请桌宠重写</button><button id="paper-skip" class="btn ghost" type="button">放弃这张</button></div><p id="paper-result" role="status"></p></section></div>`;
export const archiveHtml = `<div class="archive-tools" role="group" aria-label="信册备份"><button type="button" class="link" id="archive-export">导出信册</button><button type="button" class="link" id="archive-import">导入信册</button><input id="archive-file" type="file" accept="application/json,.json" hidden><small>备份是含正文的明文文件，请妥善保管，别随意转发。</small></div>`;
export const extrasStyles = `.archive-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;padding:14px 0 0;margin:0}.archive-tools small{flex-basis:100%;text-align:center;color:var(--muted);font-size:11px}.archive-tools .link{color:var(--muted)}.archive-tools .link:hover{color:var(--ink)}.paper-compose .actions{flex-wrap:wrap}`;
export const extrasScript = String.raw`
  var paperTarget = null, paperBusy = false, paperFetching = false, paperDraftFocus = false, paperClosed = false;
  var paperRows = new Map(), paperComposer = document.getElementById('paper-compose');
  function renderPaperDraft(draft) {
    var key=draft?draft.letterId+':'+draft.at+':'+draft.body:'';
    var changed=paperComposer.dataset.draftKey!==key;paperComposer.dataset.draftKey=key;
    var nextTarget=draft?draft.letterId:null, firstDraft=nextTarget&&nextTarget!==paperTarget;
    paperTarget=nextTarget;paperComposer.hidden=!draft;
    if(changed)document.getElementById('paper-body').textContent=draft?draft.body:'';
    var rewriting=!!(state&&state.noteRewriting);
    document.getElementById('paper-send').disabled=paperBusy||rewriting||!draft;
    document.getElementById('paper-rewrite').disabled=paperBusy||rewriting||!draft;
    document.getElementById('paper-rewrite').textContent=rewriting?botName()+'正在重写…':'请'+botName()+'重写';
    document.getElementById('paper-skip').disabled=paperBusy||!draft;
    if(draft&&changed)document.getElementById('paper-result').textContent='';
    if(firstDraft){
      paperDraftFocus=true;
      category='reply';savePref('bottle-category',category);document.getElementById('letter-date').value='';
      document.getElementById('letterbook').open=true;openedLetters['reply:'+draft.letterId]=true;
    }
  }
  function attachPapers(){
    var parking=document.getElementById('paper-parking'), slots=Array.from(document.querySelectorAll('.paper-slot'));
    function place(node,target){if(node.parentElement!==target)target.appendChild(node);}
    paperRows.forEach(function(row){
      var slot=slots.find(function(slot){return slot.dataset.letterId===row.letterId;});
      place(row.node,slot||parking);
    });
    var draftSlot=slots.find(function(slot){return slot.dataset.letterId===paperTarget&&slot.dataset.category==='reply';});
    place(paperComposer,draftSlot||parking);
    slots.forEach(function(slot){
      var hasDraft=slot===draftSlot&&!paperComposer.hidden;
      var hasNotes=Array.from(slot.children).some(function(node){return node!==paperComposer;});
      var tray=slot.closest('.paper-tray'), invite=tray&&tray.querySelector('.paper-invite');
      if(invite)invite.hidden=hasDraft||Array.from(paperRows.values()).some(function(row){return row.letterId===slot.dataset.letterId&&row.direction==='sent';});
      if(tray)tray.hidden=!hasNotes&&!hasDraft&&!invite;
      var badge=slot.closest('.mail').querySelector('.paper-badge');
      if(badge)badge.hidden=!hasNotes&&!hasDraft;
    });
    if(paperDraftFocus&&draftSlot&&paperComposer.isConnected){
      paperDraftFocus=false;
      var mail=paperComposer.closest('.mail');if(mail)mail.open=true;
      reveal(paperComposer);requestAnimationFrame(function(){
        if(paperComposer.isConnected&&!paperComposer.closest('[hidden]'))paperComposer.scrollIntoView({block:'center',behavior:reducedMotion()?'instant':'smooth'});
      });
    }
  }
  function paperInvite(id){
    var button=el('button','read-together paper-invite-button','请'+botName()+'留张小纸条');button.type='button';
    button.onclick=function(){if(button.disabled)return;button.disabled=true;api('/note/request',{letterId:id}).then(function(r){toast(r.message||'未能递出邀请。',!r.ok);return refresh();}).catch(function(){toast('没有递出邀请，请稍后重试。',true);}).then(function(){button.disabled=false;});};return button;
  }
  document.getElementById('paper-rewrite').onclick=function(){
    if(!paperTarget||paperBusy||state.noteRewriting)return;paperBusy=true;renderPaperDraft(state.noteDraft);
    api('/note/rewrite',{letterId:paperTarget}).then(function(r){document.getElementById('paper-result').textContent=r.message||'没有递出重写邀请，原稿还在。';}).catch(function(){document.getElementById('paper-result').textContent='没有递出重写邀请，原稿还在。';}).then(function(){paperBusy=false;refresh();});
  };
  document.getElementById('paper-skip').onclick=function(){if(!paperTarget||paperBusy)return;paperBusy=true;api('/note/discard',{letterId:paperTarget}).then(function(r){if(!r.ok)toast(r.message,true);}).catch(function(){toast('没有放弃，请稍后重试。',true);}).then(function(){paperBusy=false;refresh();});};
  document.getElementById('paper-send').onclick=function(){
    if(paperBusy||!paperTarget||state.noteRewriting)return;paperBusy=true;renderPaperDraft(state.noteDraft);
    api('/note',{letterId:paperTarget}).then(function(r){document.getElementById('paper-result').textContent=r.message||'纸条没有寄出。';toast(r.message||'纸条没有寄出。',!r.ok);}).catch(function(){document.getElementById('paper-result').textContent='纸条没有寄出，请稍后重试。';}).then(function(){paperBusy=false;refresh();});
  };
  function refreshPapers(){
    if(paperFetching||document.hidden||paperClosed)return;
    paperFetching=true;
    fetch('/notes',{cache:'no-store'}).then(function(r){return r.json();}).then(function(rows){
      if(!Array.isArray(rows)||paperClosed)return;
      var added=false,live=new Set(rows.map(function(row){return row&&row.id;}));
      paperRows.forEach(function(row,id){if(!live.has(id)){row.node.textContent='';row.node.remove();paperRows.delete(id);added=true;}});
      rows.forEach(function(row){
        if(!row||typeof row.id!=='string'||typeof row.letterId!=='string'||!row.letterId||typeof row.body!=='string'||typeof row.from!=='string'||!Number.isFinite(Date.parse(row.at))||[...row.body].length>40)return;
        var outgoing=row.direction==='sent',pending=outgoing&&(row.delivery==='pending'||row.delivery==='unconfirmed');
        var existing=paperRows.get(row.id);
        if(existing){
          if(existing.read===(row.read===true)&&existing.delivery===row.delivery&&existing.direction===row.direction)return;
          existing.node.remove();paperRows.delete(row.id);
        }
        var node=el('article','paper-slip');node.dataset.noteId=row.id;
        var heading=el('div','paper-heading');heading.appendChild(el('small',null,row.from+(outgoing?'寄出的小纸条':'留下的小纸条')));
        var status=el('span','paper-status '+(pending||(!outgoing&&!row.read)?'paper-unread':'paper-read'),outgoing?(row.delivery==='unconfirmed'?'备份留存 · 寄送结果未知':pending?'寄送待确认':'已寄出'):(row.read?'已读':'未读'));heading.appendChild(status);node.appendChild(heading);node.appendChild(el('p',null,row.body));
        var together=el('button','read-together',pending&&row.delivery!=='unconfirmed'?'确认寄送结果':'一起看');together.type='button';
        together.onclick=function(){if(together.disabled)return;together.disabled=true;var retry=pending&&row.delivery!=='unconfirmed';api(retry?'/note':'/note/read',retry?{letterId:row.letterId}:{id:row.id}).then(function(r){toast(r.message||'没有递过去，请稍后重试。',!r.ok);refreshPapers();refresh();}).catch(function(){toast('没有递过去，请稍后重试。',true);}).then(function(){together.disabled=false;});};
        node.appendChild(together);
        paperRows.set(row.id,{node:node,letterId:row.letterId,from:row.from,at:row.at,read:row.read===true,direction:row.direction,delivery:row.delivery,status:status});added=true;
      });
      if(added&&state){captureDetails();renderBook();}else attachPapers();
    }).catch(function(){}).then(function(){paperFetching=false;});
  }
  window.addEventListener('pagehide',function(){paperClosed=true;paperRows.forEach(function(r){r.node.textContent='';r.node.remove();});paperRows.clear();document.getElementById('paper-body').textContent='';paperComposer.dataset.draftKey='';paperTarget=null;paperDraftFocus=false;});
  window.addEventListener('pageshow',function(e){if(e.persisted){paperClosed=false;refresh();}});
  document.getElementById('archive-export').onclick=function(){
    var button=this;button.disabled=true;
    fetch('/archive/export',{cache:'no-store'}).then(function(r){if(!r.ok)throw Error();return r.json();}).then(function(doc){
      var blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
      var a=document.createElement('a');a.href=url;a.download='漂流瓶信册-明文请勿转发-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
      toast('明文备份已导出，请妥善保管。');
    }).catch(function(){toast('未能导出，请稍后再试。',true);}).then(function(){button.disabled=false;});
  };
  document.getElementById('archive-import').onclick=function(){document.getElementById('archive-file').click();};
  document.getElementById('archive-file').onchange=function(){
    var file=this.files&&this.files[0],input=this;if(!file)return;
    if(file.size>32*1024*1024){toast('信册文件不能超过 32 MiB。',true);input.value='';return;}
    file.text().then(function(text){var doc=JSON.parse(text);return api('/archive/import',doc);}).then(function(r){toast(r.message||'未能导入。',!r.ok);if(r.ok)refresh();}).catch(function(){toast('文件不是有效信册，原有信件没有改动。',true);}).then(function(){input.value='';});
  };
`;
