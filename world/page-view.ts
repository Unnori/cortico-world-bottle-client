import { pageStyles } from './page-style.ts';

/** 单文件页面。数据全部从 `/draft` 拿，这里只写骨架与交互。 */
export function pageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>漂流瓶 · 信箱</title>
<style>${pageStyles}</style>
</head>
<body>
<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
  <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7M3 19l6-6m12 6-6-6"/></symbol>
  <symbol id="i-pen" viewBox="0 0 24 24"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14zM4 20l3-7M13 21h8"/></symbol>
  <symbol id="i-bottle" viewBox="0 0 24 24"><path d="M10 2h4v5l3 4v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9l3-4zM9 3h6M7 14h10M10 17h4"/></symbol>
  <symbol id="i-post" viewBox="0 0 24 24"><path d="M3 10h18M5 10v10h14V10M3 7l9-5 9 5M9 20v-6h6v6M2 22h20"/></symbol>
  <symbol id="i-reply" viewBox="0 0 24 24"><path d="m9 5-6 6 6 6M3 11h11c5 0 7 3 7 8"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="m3 4 18 8-18 8 3-8zM6 12h15"/></symbol>
</defs></svg>
<div class="shell">
  <div class="masthead">
    <div class="brand"><span class="brand-mark"><svg class="icon" aria-hidden="true"><use href="#i-bottle"/></svg></span><div><h1>漂流瓶</h1><small>LETTERS FROM THE SEA</small></div></div>
    <div class="sub">一片海 · 一封信 · 一次相遇</div>
  </div>
  <section class="hero">
    <div><div class="eyebrow">THE SEASIDE LETTERBOX</div><h2>把远方，收进信箱。</h2><p id="hero-note">留一封信给海，也等一封信靠岸。</p></div>
    <div class="hero-art" aria-hidden="true"><div class="envelope-art"><span class="wax"><svg class="icon"><use href="#i-bottle"/></svg></span></div><div class="postmark">海边邮局<b>SEA</b>LETTERS</div><svg class="hero-wave" viewBox="0 0 130 30" fill="none" stroke="currentColor"><path d="M0 5q16-8 32 0t32 0 32 0 32 0M0 15q16-8 32 0t32 0 32 0 32 0M0 25q16-8 32 0t32 0 32 0 32 0"/></svg></div>
  </section>
  <div class="toolbar">
    <div class="actions">
      <button class="action-main" id="write-button" type="button"><svg class="icon" aria-hidden="true"><use href="#i-pen"/></svg><span><strong>写一封信</strong><small>把此刻的心事寄给远方</small></span></button>
      <button class="action-main catch" id="catch-button" type="button"><svg class="icon" aria-hidden="true"><use href="#i-bottle"/></svg><span><strong>去海边打捞</strong><small>捞起海上来客的一封信</small></span></button>
    </div>
    <p id="action-note" role="status">信写好后，寄不寄由你决定。</p>
  </div>
  <div id="announcements" aria-live="polite"></div>
  <section class="desk"><div class="section-heading"><h2>信笺桌 · 待你决定</h2><div class="tide" id="tide"></div></div><main id="stage"></main></section>
  <details class="book" id="letterbook" open>
    <summary><svg class="icon" aria-hidden="true"><use href="#i-mail"/></svg><span class="book-title">我的信箱</span><span class="book-count" id="book-count">收到 0 封</span><span class="fold-label" aria-hidden="true"></span></summary>
    <div class="book-layout">
      <nav class="mail-folders" aria-label="信件分类">
        <p class="folder-label">信件收纳 / LETTERS</p>
        <button class="folder" data-category="received" type="button" aria-pressed="true"><svg class="icon" aria-hidden="true"><use href="#i-bottle"/></svg><span>来客来信</span><b id="received-count">0</b></button>
        <button class="folder" data-category="seed" type="button" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-post"/></svg><span>海边邮局</span><b id="seed-count">0</b></button>
        <button class="folder" data-category="reply" type="button" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-reply"/></svg><span>收到的回信</span><b id="reply-count">0</b></button>
        <button class="folder" data-category="sent" type="button" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-send"/></svg><span>寄出的信</span><b id="sent-count">0</b></button>
        <p class="folder-note">有些相遇很短，<br>但一封信可以留很久。</p>
      </nav>
      <div class="mail-content">
        <div class="book-tools"><div><h3 id="folder-title">来客来信</h3><p id="folder-description">海上来客留下的信，随潮水来到你身边。</p></div><div class="date-tools"><label for="letter-date">归档日期</label><input type="date" id="letter-date"><button class="link" type="button" id="clear-date">全部日期</button></div></div>
        <section id="mail-list" aria-label="按日期归档的信件"></section>
      </div>
    </div>
  </details>
  <div class="foot" id="foot"></div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
(function () {
  var state = null;
  var busy = false;
  var waiting = false;
  var waitStarted = 0;
  var timer = null;
  var toastTimer = null;
  var openedLetters = Object.create(null);
  var category = readPref('bottle-category', 'received');
  if (['received', 'seed', 'reply', 'sent'].indexOf(category) < 0) category = 'received';
  var refreshSequence = 0;
  var renderedState = '';
  var arrivalKeys = new Set();

  function botName() { return state && state.botName || '它'; }
  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function readPref(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function rememberDetails(mail, key) {
    mail.dataset.foldKey = key;
    mail.open = openedLetters[key] === true;
    mail.ontoggle = function () { if (mail.isConnected) openedLetters[key] = mail.open; };
    return mail;
  }
  function captureDetails() {
    document.querySelectorAll('details[data-fold-key]').forEach(function (node) { openedLetters[node.dataset.foldKey] = node.open; });
  }
  function animateArrival(node, key) {
    if (!arrivalKeys.has(key)) { node.classList.add('enter'); arrivalKeys.add(key); }
    return node;
  }
  function dateKey(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function visibleItems(items, timeOf) {
    var date = document.getElementById('letter-date').value;
    return items.filter(function (item) { return !date || dateKey(timeOf(item)) === date; })
      .sort(function (a, b) { return dateKey(timeOf(b)).localeCompare(dateKey(timeOf(a))); });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function api(path, payload) {
    var options = { method: 'POST', headers: { 'x-bottle': '1' } };
    if (payload) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    return fetch(path, options).then(function (res) {
      return res.json();
    });
  }

  function toast(message, bad) {
    var node = document.getElementById('toast');
    node.textContent = message;
    node.className = 'toast on' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.className = 'toast'; }, 2600);
  }

  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function run(path, button, payload) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    api(path, payload).then(function (res) {
      busy = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (!res || res.ok !== true) {
        toast((res && res.message) || '没成，再试一次。', !(res && res.reason === 'tide_out'));
        refresh();
        return;
      }
      if (path === '/open') { waiting = true; waitStarted = Date.now(); }
      toast(res.message || '好了。');
      refresh();
    }).catch(function () {
      busy = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      toast('信箱暂时打不开，稍后再试一次。', true);
    });
  }

  function buttons(list) {
    var box = el('div', 'actions');
    list.forEach(function (item) {
      var btn = el('button', 'btn ' + (item.style || ''), item.label);
      btn.type = 'button';
      if (item.disabled) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.onclick = function () {
          run(item.path, btn, item.kind ? { kind: item.kind } : undefined);
        };
      }
      box.appendChild(btn);
    });
    return box;
  }

  function renderDraft(draft, s) {
    var card = el('div', 'card draft-card');
    var isLetter = draft.kind === 'letter';
    card.dataset.kind = draft.kind;
    var topic = isLetter ? draft.topic : null;
    card.appendChild(el('div', 'eyebrow', isLetter ? '信稿 · 尚未寄出' : '回信稿 · 尚未寄出'));
    card.appendChild(el('h2', 'title', isLetter ? topic || '无题信' : '回信'));

    if (!isLetter && s.held) {
      var detail = rememberDetails(el('details', 'original'), 'original:' + s.held.letterId);
      detail.appendChild(el('summary', null, '看看原来那一封（来自 ' + s.held.from + '）'));
      if (s.held.topic) detail.appendChild(el('div', 'mail-topic', s.held.topic));
      detail.appendChild(el('div', 'letter small', s.held.body));
      card.appendChild(detail);
    }

    card.appendChild(el('div', 'letter', draft.body));
    card.appendChild(el('div', 'meta', draft.chars + ' / 120 字'));

    if (draft.hints && draft.hints.length) {
      var hints = el('div', 'hints');
      draft.hints.forEach(function (hint) {
        var row = el('div', 'hint ' + hint.kind);
        row.appendChild(el('span', 'dot'));
        row.appendChild(el('span', null, hint.text));
        hints.appendChild(row);
      });
      card.appendChild(hints);
    }

    // 回信额度用完时：寄出先灰着，旁边留「扔回海里」——也可以放着等明天额度回来再寄
    var canReply = s.canReply !== false;
    var actions;
    if (!isLetter && !canReply) {
      actions = [
        { label: '多等一天', path: '/send', style: 'seal', kind: draft.kind, disabled: true },
        { label: '扔回海里', path: '/dismiss', style: 'ghost' }
      ];
      card.appendChild(el('div', 'hint spent', '今天的回信次数用完了。可以先放着，等明天再寄；也可以扔回海里，让别人去回。'));
    } else {
      actions = [
        { label: draft.hints && draft.hints.length ? '仍然寄出' : '寄出去', path: '/send', style: 'seal', kind: draft.kind },
        { label: '重写', path: '/rewrite', style: 'ghost', kind: draft.kind }
      ];
      // 自己写的那封信：还能反悔。删草稿不影响手里那封别人写的信
      if (isLetter) actions.push({ label: '算了吧', path: '/discard', style: 'ghost', kind: draft.kind });
    }
    card.appendChild(buttons(actions));
    return card;
  }

  function renderHeld(s) {
    var card = el('div', 'card');
    if (s.held.dead) return renderDeadHeld(s, card);
    if (s.held.seed) return renderSeedHeld(s, card);

    var head = el('div', 'eyebrow', '捞到一封 · 来自 ');
    head.appendChild(el('span', 'who', s.held.from));
    card.appendChild(head);
    card.appendChild(el('h2', 'title', s.held.topic || '还没决定要不要回'));
    card.appendChild(el('div', 'letter', s.held.body));
    card.appendChild(el('div', 'meta', s.held.hoursLeft > 0 ? '还有 ' + s.held.hoursLeft + ' 小时回海' : '随时会回海'));
    // 今天回不了就直说，别让人点了「回信」才发现第 4 封被 429
    if (s.canReply === false) {
      card.appendChild(el('div', 'hint spent', '今天的回信次数用完了。可以留着，等明天再回；也可以扔回海里，让别人去回。'));
    }
    card.appendChild(buttons([
      { label: s.canReply === false ? '多等一天' : '回信', path: '/open', style: 'seal', disabled: s.canReply === false },
      { label: '扔回海里', path: '/dismiss', style: 'ghost' }
    ]));
    return card;
  }

  // 海边邮局寄来的那一封：来源如实写出来，而且说清楚它不回信（§13.1 / §13.7）。
  // 没有「回信」按钮——留一个点了也没用的按钮，等于骗人类。
  //
  // 标题的位置放 topic（那才是这封信的名字）；「它不会回信」是状态，属于下面那行小字。
  // 它的字被海带走了：只剩一条路——把这封信留在自己的信册里。
  function renderDeadHeld(s, card) {
    var head = el('div', 'eyebrow', '捞到一封 · 来自 ');
    head.appendChild(el('span', 'who', s.held.from));
    card.appendChild(head);
    card.appendChild(el('h2', 'title', '它的字被海带走了'));
    card.appendChild(el('div', 'letter', s.held.body || '这封的字已经不在海上了。'));
    card.appendChild(el('div', 'meta', '海那边已经没有它了，你这边还留着。'));
    card.appendChild(buttons([{ label: '珍藏', path: '/keep', style: 'seal' }]));
    return card;
  }

  function renderSeedHeld(s, card) {
    var head = el('div', 'eyebrow', '海边邮局 · 来自 ');
    head.appendChild(el('span', 'who', s.held.from));
    card.appendChild(head);
    // 没有 topic 时才用来源顶替标题，免得标题位置空着
    card.appendChild(el('h2', 'title', s.held.topic || '来自群岛上的某位居民'));
    card.appendChild(el('div', 'letter', s.held.body));
    if (s.held.signature) card.appendChild(el('div', 'meta', '—— ' + s.held.signature));
    card.appendChild(el('div', 'meta', '来自群岛上的某位居民'));
    card.appendChild(buttons([{ label: '收好', path: '/dismiss', style: 'seal' }]));
    return card;
  }

  function render() {
    captureDetails();
    var focused = document.activeElement;
    var focusedFold = focused && focused.tagName === 'SUMMARY' && focused.parentElement.dataset.foldKey;
    var stage = document.getElementById('stage');
    stage.innerHTML = '';
    if (!state) {
      var loading = el('div', 'card');
      loading.appendChild(el('p', 'empty', '正在看海…'));
      stage.appendChild(loading);
      return;
    }

    // 信稿、手里那封（含回信稿）是两个独立的东西，必须同时显示：
    // 从前这里是「有草稿就只画草稿」，一封信稿就能把刚捞到的信整块藏掉。
    var replyDraft = state.replyDraft !== undefined ? state.replyDraft : (state.draft && state.draft.kind === 'reply' ? state.draft : null);
    var letterDraft = state.letterDraft !== undefined ? state.letterDraft : (state.draft && state.draft.kind === 'letter' ? state.draft : null);
    var shown = 0;

    if (letterDraft) {
      stage.appendChild(animateArrival(renderDraft(letterDraft, state), 'letter-draft:' + letterDraft.body));
      shown += 1;
    }
    if (replyDraft) {
      stage.appendChild(animateArrival(renderDraft(replyDraft, state), 'reply-draft:' + replyDraft.letterId + ':' + replyDraft.body));
      shown += 1;
      waiting = false;
    } else if (waiting) {
      var card = el('div', 'card');
      card.appendChild(el('div', 'eyebrow', botName() + '正在读那一封'));
      card.appendChild(el('p', 'empty', '读完就会把回信放到这里。'));
      stage.appendChild(card);
      shown += 1;
    }
    if (!replyDraft && state.held) {
      stage.appendChild(animateArrival(renderHeld(state), 'held:' + state.held.letterId));
      shown += 1;
    }
    if (shown === 0) {
      var empty = el('div', 'card');
      var box = el('div', 'empty');
      box.appendChild(icon('mail'));
      box.appendChild(el('div', 'big', '海面很安静'));
      box.appendChild(el('div', null, botName() + '写好的信，会在这里等你。'));
      empty.appendChild(box);
      stage.appendChild(empty);
    }

    renderTide();
    renderNotices();
    renderActionState(letterDraft);
    renderBook();
    renderFoot();
    document.title = (letterDraft || replyDraft) ? '● 有草稿 · 漂流瓶' : '漂流瓶 · 信箱';
    if (focusedFold) {
      var replacement = Array.from(document.querySelectorAll('details[data-fold-key]')).find(function (node) { return node.dataset.foldKey === focusedFold; });
      if (replacement) replacement.querySelector('summary').focus({ preventScroll: true });
    }
  }

  function renderTide() {
    var tide = document.getElementById('tide');
    tide.innerHTML = '';
    var q = state.quota;
    if (!q) {
      tide.appendChild(el('span', 'chip', '还没连上海边'));
      return;
    }
    var bottles = el('span', 'chip');
    bottles.appendChild(document.createTextNode('今天还能寄 '));
    bottles.appendChild(el('b', null, String(q.bottles_left)));
    bottles.appendChild(document.createTextNode(' 封'));
    tide.appendChild(bottles);
    var catches = el('span', 'chip');
    catches.appendChild(document.createTextNode('还能捞 '));
    catches.appendChild(el('b', null, String(q.catches_left)));
    catches.appendChild(document.createTextNode(' 次'));
    tide.appendChild(catches);
    // 回信额度：老服务端不给这个字段时干脆不显示，别显示成「还能回 0 封」
    if (typeof q.replies_left === 'number') {
      var replies = el('span', 'chip' + (q.replies_left > 0 ? '' : ' spent'));
      replies.appendChild(document.createTextNode('还能回 '));
      replies.appendChild(el('b', null, String(q.replies_left)));
      replies.appendChild(document.createTextNode(' 封'));
      tide.appendChild(replies);
    }
    if (state.online === false) tide.appendChild(el('span', 'chip', '海边没回音'));
  }

  function renderNotices() {
    var box = document.getElementById('announcements');
    box.innerHTML = '';
    if (state.announcement) {
      var a = state.announcement;
      box.appendChild(el('div', 'notice' + (a.level === 'alarm' ? ' alarm' : ''), a.text));
    }
    if (state.tideOut) {
      var notice = el('div', 'notice', state.tideOut.text);
      notice.appendChild(el('div', 'meta', '信稿已保留，可以重写或稍后再寄。' +
        (state.tideOut.until ? '预计回潮：' + fmt(state.tideOut.until) : '')));
      box.appendChild(notice);
    }
  }

  function renderActionState(letterDraft) {
    document.getElementById('write-button').disabled = busy || !!state.pendingAction || !!letterDraft;
    document.getElementById('catch-button').disabled = busy || !!state.pendingAction || !!state.held;
    document.getElementById('action-note').textContent = state.pendingAction
      ? (state.pendingAction === 'write' ? '已请' + botName() + '写信，等候落笔…' : '已请' + botName() + '去海边打捞…')
      : '和' + botName() + '一起写信、打捞，寄不寄由你。';
    document.getElementById('hero-note').textContent = '你与' + botName() + '的海边信箱。留一封信给海，也等一封信靠岸。';
    var replies = (state.sent || []).filter(function (item) { return item.reply; }).length;
    document.getElementById('book-count').textContent = '收到 ' + ((state.received || []).length + replies) +
      ' 封 · 寄出 ' + (state.sent || []).length + ' 封';
  }

  function deleteLink(letterId) {
    var btn = el('button', 'link mini', '删除');
    btn.type = 'button';
    btn.onclick = function () {
      if (!window.confirm('删掉这一条本地记录？只删这台机器上的，海里的信不受影响。')) return;
      run('/forget', btn, { letterId: letterId });
    };
    return btn;
  }

  // 我写的信现在到哪了。「被人捡起来了」只给状态、不说是谁——作者不该知道是谁捡的。
  function sentStateText(item) {
    if (item.reply || item.state === 'replied') return '收到回信';
    var table = {
      picked: '被人捡起来了',
      tsunami: '迷失在海啸中',
      sunk: '瓶子裂开了，没人来得及回',
      drifting: '还在漂'
    };
    return table[item.state] || '还在漂';
  }

  function sentSourceText(item) {
    if (item.reply || item.state === 'replied') return '已收进信箱';
    if (item.state === 'picked') return '正在别人手中';
    if (item.state === 'tsunami') return '随浪去了远方';
    if (item.state === 'sunk') return '海替你珍藏了这封信';
    return '已投进海里';
  }

  function sentStateBadge(item) {
    var key = item.reply || item.state === 'replied' ? 'replied' : item.state;
    if (['replied', 'picked', 'tsunami', 'sunk', 'drifting'].indexOf(key) < 0) key = 'drifting';
    return el('span', 'mail-status status-' + key, sentStateText(item));
  }

  function bookEntries() {
    var entries = [];
    (state.received || []).forEach(function (item) {
      entries.push({ category: item.seed === true ? 'seed' : 'received', item: item, at: item.at, body: item.body });
    });
    (state.sent || []).forEach(function (item) {
      entries.push({ category: 'sent', item: item, at: item.at, body: item.body });
      if (item.reply) entries.push({ category: 'reply', item: item, at: item.reply.at, body: item.reply.body });
    });
    return entries;
  }

  function renderBook() {
    var entries = bookEntries();
    var folders = {
      received: ['来客来信', '海上来客留下的信，随潮水来到你身边。'],
      seed: ['海边邮局', '邮局寄来的群岛故事。可以收好，这些信不收回信。'],
      reply: ['收到的回信', '寄往远方的心事，等到了回应。'],
      sent: ['寄出的信', '写出的信，都在这里留了一份。']
    };
    Object.keys(folders).forEach(function (key) {
      document.getElementById(key + '-count').textContent = String(entries.filter(function (entry) { return entry.category === key; }).length);
    });
    document.querySelectorAll('.folder').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.category === category)); });
    document.getElementById('folder-title').textContent = folders[category][0];
    document.getElementById('folder-description').textContent = folders[category][1];
    var list = document.getElementById('mail-list');
    list.innerHTML = '';
    entries = visibleItems(entries.filter(function (entry) { return entry.category === category; }), function (entry) { return entry.at; });
    var day = null;
    var group;
    entries.forEach(function (entry) {
      var key = dateKey(entry.at);
      if (key !== day) {
        day = key;
        group = el('section', 'day-group');
        group.dataset.date = key;
        var heading = el('h4', 'day-heading');
        heading.appendChild(el('b', null, fmt(entry.at) || '日期未记录'));
        heading.appendChild(el('span', null, entries.filter(function (row) { return dateKey(row.at) === key; }).length + ' 封'));
        group.appendChild(heading);
        list.appendChild(group);
      }
      group.appendChild(renderMail(entry));
    });
    if (!entries.length) {
      var empty = el('div', 'empty empty-mail');
      empty.appendChild(icon(category === 'seed' ? 'post' : 'mail'));
      empty.appendChild(el('div', 'big', document.getElementById('letter-date').value ? '这一天，没有留下信' : '这个信格还空着'));
      empty.appendChild(el('p', null, document.getElementById('letter-date').value ? '换一个日期，或者看看全部信件。' : '等下一次相遇，再把它好好收在这里。'));
      list.appendChild(empty);
    }
  }

  function renderMail(entry) {
    var item = entry.item;
    var kind = entry.category;
    var key = kind + ':' + item.letterId;
    var mail = rememberDetails(el('details', 'mail ' + kind), key);
    var isReply = kind === 'reply';
    var source = kind === 'seed' ? '海边邮局 · ' + (item.signature || '群岛来信') : kind === 'sent' ? sentSourceText(item) : isReply ? '来客回信 · ' + item.reply.from : '海上来客 · ' + item.from;
    var title = isReply ? item.reply.from + '的回信' : item.topic || (kind === 'seed' ? '群岛上的一封信' : kind === 'sent' ? '留在海上的一封信' : item.from + '的来信');
    var summary = el('summary');
    var symbol = el('span', 'mail-symbol');
    symbol.appendChild(icon(kind === 'seed' ? 'post' : kind === 'sent' ? 'send' : 'mail'));
    summary.appendChild(symbol);
    var subject = el('span', 'mail-subject');
    subject.appendChild(el('strong', null, title));
    subject.appendChild(el('small', null, source));
    summary.appendChild(subject);
    if (kind === 'sent') summary.appendChild(sentStateBadge(item));
    var chevron = el('span', 'mail-chevron', '›');
    chevron.setAttribute('aria-hidden', 'true');
    summary.appendChild(chevron);
    mail.appendChild(summary);
    var body = el('div', 'mail-body');
    var labels = { caught: '还没回', replied: '回过信', dismissed: '扔回海里', sank: '裂开沉底', expired: '自己回海了', kept: '珍藏' };
    var head = el('div', 'head');
    head.appendChild(el('span', null, source));
    head.appendChild(kind === 'sent' ? sentStateBadge(item) : el('span', null, kind === 'seed' ? '只需收好，不必回信' : isReply ? '回给你的' : (labels[item.outcome] || '看过')));
    body.appendChild(head);
    if (!isReply && item.topic) body.appendChild(el('div', 'mail-topic', item.topic));
    body.appendChild(el('div', 'letter small', entry.body));
    if (item.seed && item.signature) body.appendChild(el('div', 'meta', '—— ' + item.signature));
    if (isReply || item.myReply) {
      var quote = el('div', 'reply-quote');
      quote.appendChild(isReply ? el('div', 'reply-quote-label', '你写的') : el('div', 'reply-quote-label', '你回的'));
      if (isReply && item.topic) quote.appendChild(el('div', 'mail-topic', item.topic));
      quote.appendChild(el('div', 'letter small', isReply ? item.body : item.myReply));
      body.appendChild(quote);
    }
    if (kind === 'received' && !item.myReply && item.outcome === 'replied') body.appendChild(el('div', 'meta', '回过信，但这段没有留下来。'));
    var foot = el('div', 'mail-foot');
    if (kind !== 'sent') foot.appendChild(peruseLink(item));
    foot.appendChild(deleteLink(item.letterId));
    body.appendChild(foot);
    mail.appendChild(body);
    return animateArrival(mail, key);
  }

  function peruseLink(item) {
    var btn = el('button', 'read-together', '一起读信');
    btn.type = 'button';
    btn.onclick = function () {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      api('/peruse', { letterId: item.letterId }).then(function (res) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        if (!res || res.ok !== true) {
          toast((res && res.message) || '没成，再试一次。', true);
          return;
        }
        toast(botName() + '可以看了，等一下读信后的想法。');
      }).catch(function () {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        toast('信箱暂时打不开，稍后再试一次。', true);
      });
    };
    return btn;
  }

  function renderFoot() {
    var foot = document.getElementById('foot');
    var previous = foot.querySelector('details');
    var storageOpen = previous ? previous.open : false;
    foot.innerHTML = '';
    foot.appendChild(el('div', null, '字由' + botName() + '写，寄不寄由你。'));
    foot.appendChild(el('div', null, '只有你点「回信」或「一起读信」，' + botName() + '才能读到那一封。'));
    var storage = el('details');
    storage.open = storageOpen;
    storage.appendChild(el('summary', null, '本机存储与清理'));
    if (state.localFile) {
      var line = el('div', 'plain', '这些信以明文存在本机：');
      line.appendChild(el('code', null, state.localFile));
      storage.appendChild(line);
    }
    var clear = el('button', 'link', '清空这些记录');
    clear.type = 'button';
    clear.onclick = function () {
      if (!window.confirm('清空这台机器上保存的所有信件记录？这个动作不能撤销。')) return;
      run('/forget', clear, { all: true });
    };
    storage.appendChild(clear);
    foot.appendChild(storage);
  }

  function refresh() {
    clearTimeout(timer);
    var sequence = ++refreshSequence;
    fetch('/draft').then(function (res) { return res.json(); }).then(function (snapshot) {
      if (sequence !== refreshSequence) return;
      state = snapshot;
      // 它迟迟没动笔：25 秒后回到那一封，别让页面一直停在这儿
      if (waiting && Date.now() - waitStarted > 25000) waiting = false;
      var nextState = JSON.stringify(state) + ':' + waiting;
      if (nextState !== renderedState) {
        render();
        renderedState = JSON.stringify(state) + ':' + waiting;
      }
    }).catch(function () {
      if (sequence !== refreshSequence) return;
      state = state || { draft: null, held: null, sent: [], received: [], quota: null, online: false };
      state.online = false;
      render();
      renderedState = '';
    }).then(function () {
      if (sequence !== refreshSequence) return;
      var waitMs = waiting ? 1200 : (state && state.draft ? 2500 : 4000);
      timer = setTimeout(refresh, waitMs);
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  var book = document.getElementById('letterbook');
  book.open = readPref('bottle-fold-letterbook', 'open') === 'open';
  book.ontoggle = function () { savePref('bottle-fold-letterbook', book.open ? 'open' : 'closed'); };
  document.querySelectorAll('.folder').forEach(function (button) {
    button.onclick = function () {
      captureDetails();
      category = button.dataset.category;
      savePref('bottle-category', category);
      if (state) renderBook();
    };
  });
  document.getElementById('letter-date').onchange = function () { captureDetails(); if (state) renderBook(); };
  document.getElementById('clear-date').onclick = function () { captureDetails(); document.getElementById('letter-date').value = ''; if (state) renderBook(); };
  document.getElementById('write-button').onclick = function () { run('/write', this); };
  document.getElementById('catch-button').onclick = function () { run('/catch', this); };
  refresh();
})();
</script>
</body>
</html>`;
}
