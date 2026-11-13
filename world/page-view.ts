import { extrasHtml, archiveHtml, extrasScript, extrasStyles } from './page-extras.ts';
import { announcementDismissScript, announcementLinksScript } from './page-announcement.ts';
import { WAKE_POLICIES } from './wake-policy.ts';
import { DEFAULT_MY_FONT } from './default-font.ts';
import { customPalettes } from './appearance.ts';
import { customizationHtml, customizationScript } from './page-customization.ts';
import { FEEDBACK_FORM_URL, WORLD_VERSION } from './feedback.ts';
import { pageSoundScript, soundSettingsHtml } from './page-sound.ts';
import { stationeryScript } from './page-stationery.ts';
import { readerHtml, readerScript } from './page-reader.ts';
import { starHtml, starScript } from './page-stars.ts';
import { pageStyles } from './page-style.ts';
import type { MailboxTheme } from './theme.ts';

/** 单文件页面。数据全部从 `/draft` 拿，这里只写骨架与交互。 */
export function pageHtml(hostTheme: MailboxTheme = { available: false }): string {
  const customJson = JSON.stringify(customPalettes(hostTheme.preference?.customColor ?? '#4b62a0'));
  const themeJson = JSON.stringify(hostTheme).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN" data-theme="ocean">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>漂流瓶 · 信箱</title>
<meta name="theme-color" content="#f0f4fb" id="browser-theme-color">
<script type="application/json" id="host-theme">${themeJson}</script>
<script type="application/json" id="custom-palettes">${customJson}</script>
<script data-theme-init>
(function(){
  var root=document.documentElement,theme='ocean',mode='system';
  try{var saved=localStorage.getItem('bottle-theme');if(['ocean','paper','epistle','coopanion','custom'].indexOf(saved)>=0)theme=saved;
    saved=localStorage.getItem('bottle-appearance');if(['system','light','dark'].indexOf(saved)>=0)mode=saved;}catch(e){}
  try{var pref=JSON.parse(document.getElementById('host-theme').textContent).preference;if(pref&&['ocean','paper','epistle','coopanion','custom'].indexOf(pref.theme)>=0&&['system','light','dark'].indexOf(pref.mode)>=0){theme=pref.theme;mode=pref.mode;}}catch(e){}
  root.dataset.theme=theme;root.dataset.mode=mode;
  var dark=mode==='dark'||(mode==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.appearance=dark?'dark':'light';
  try{if(theme==='custom'){var custom=JSON.parse(document.getElementById('custom-palettes').textContent)[dark?'dark':'light'];Object.keys(custom).forEach(function(key){root.style.setProperty('--'+key,custom[key]);});}}catch(e){}
  try{var host=JSON.parse(document.getElementById('host-theme').textContent);var palette=host.available&&host.palettes[dark?'dark':'light'];
    var keys=['paper','sheet','sheet-2','sheet-3','ink','ink-soft','line','line-2','line-strong','accent','on-accent','ink-blue','ok','warn','danger'];if(palette&&keys.every(function(key){return /^#[0-9a-f]{6}$/i.test(palette[key]);})){root.dataset.hostTheme='true';keys.forEach(function(key){root.style.setProperty('--host-'+key,palette[key]);});}}catch(e){}
})();
</script>
<link rel="icon" type="image/png" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">
<style>${pageStyles}
${extrasStyles}</style>
</head>
<body id="bottle-mailbox">
<div id="mailbox-scenery" aria-hidden="true"><div id="background-layer-0" class="background-layer"></div><div id="background-layer-1" class="background-layer"></div></div>
<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
  <symbol id="i-waves" viewBox="0 0 36 18"><path d="M2 6c4-5 7 5 11 0s7 5 11 0 7 5 10 0M7 12c4-5 7 5 11 0s7 5 11 0"/></symbol>
  <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7M3 19l6-6m12 6-6-6"/></symbol>
  <symbol id="i-pen" viewBox="0 0 24 24"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14zM4 20l3-7M13 21h8"/></symbol>
  <symbol id="i-bottle" viewBox="0 0 24 24"><path d="M10 2h4v5l3 4v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9l3-4zM9 3h6M7 14h10M10 17h4"/></symbol>
  <symbol id="i-post" viewBox="0 0 24 24"><path d="M3 10h18M5 10v10h14V10M3 7l9-5 9 5M9 20v-6h6v6M2 22h20"/></symbol>
  <symbol id="i-feedback" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 9h9M7 13h6"/></symbol>
  <symbol id="i-reply" viewBox="0 0 24 24"><path d="m9 5-6 6 6 6M3 11h11c5 0 7 3 7 8"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="m3 4 18 8-18 8 3-8zM6 12h15"/></symbol>
</defs></svg>
${readerHtml}
<div class="shell">
  <div class="masthead">
    <div class="brand"><span class="brand-mark"><img src="/icon.png" alt="" width="48" height="48"></span><div><h1>漂流瓶</h1><small>LETTERS FROM THE SEA</small></div></div>
    <div class="masthead-end"><div class="sub">一片海 · 一封信 · 一次相遇</div>
      <button class="feedback-entry" id="feedback-entry" type="button" aria-haspopup="dialog" aria-controls="feedback-dialog"><svg class="icon" aria-hidden="true"><use href="#i-feedback"/></svg><span>反馈</span></button>
      <div class="theme-picker" id="theme-picker">
        <button class="theme-toggle" id="theme-toggle" type="button" aria-expanded="false" aria-controls="theme-menu" aria-label="切换信箱配色"><span class="theme-dot" aria-hidden="true"></span><span class="theme-toggle-label">信箱外观<span id="theme-name">潮蓝</span></span><svg class="theme-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <div class="theme-menu" id="theme-menu" role="group" aria-label="信箱配色" hidden><div class="theme-menu-heading"><strong>给信箱换一种心情</strong><span>信纸与灯光</span></div><div class="theme-options">
          <button id="theme-ocean" type="button" aria-pressed="true"><span class="theme-swatch swatch-ocean" aria-hidden="true"></span><span><strong>潮蓝</strong><small>海边的蓝</small></span><span class="theme-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 8 3 3 7-7"/></svg></span></button>
          <button id="theme-paper" type="button" aria-pressed="false"><span class="theme-swatch swatch-paper" aria-hidden="true"></span><span><strong>暖纸</strong><small>蜂蜜纸 · 棕墨</small></span><span class="theme-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 8 3 3 7-7"/></svg></span></button>
          <button id="theme-epistle" type="button" aria-pressed="false"><span class="theme-swatch swatch-epistle" aria-hidden="true"></span><span><strong>书信</strong><small>墨色与信笺</small></span><span class="theme-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 8 3 3 7-7"/></svg></span></button>
          <button id="theme-coopanion" type="button" aria-pressed="false"><span class="theme-swatch swatch-coopanion" aria-hidden="true"></span><span><strong>Coopanion</strong><small>跟随桌宠配色</small></span><span class="theme-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 8 3 3 7-7"/></svg></span></button>
          </div><div class="appearance-settings"><p>明暗模式</p><div class="appearance-options" role="group" aria-label="明暗模式"><button id="mode-system" type="button" aria-pressed="true">跟随系统</button><button id="mode-light" type="button" aria-pressed="false">浅色</button><button id="mode-dark" type="button" aria-pressed="false">深色</button></div><small id="theme-sync-note" role="status">明暗可以自由选择，配色会为你记住。</small><small id="theme-card-note" role="status">桌面信笺也会换上相同配色。</small></div>
          <p id="my-font-current" class="theme-font-current" role="status">写信笔迹 · ${DEFAULT_MY_FONT.name}（默认）</p>
          ${customizationHtml}
        </div>
      </div>
    </div>
  </div>
  <div class="opening">
  <section class="hero">
    <div class="hero-copy"><div class="eyebrow">栖潮海 · 海边信箱</div><h2>把远方，<br>收进信箱。</h2><p id="hero-note">留一封信给海，也等一封信靠岸。</p></div>
    <div class="hero-art" aria-hidden="true"><div class="envelope-art"><span class="wax"><svg class="icon"><use href="#i-bottle"/></svg></span></div><div class="postmark">海边邮局<b>SEA</b>LETTERS</div><svg class="hero-wave" viewBox="0 0 130 30" fill="none" stroke="currentColor"><path d="M0 5q16-8 32 0t32 0 32 0 32 0M0 15q16-8 32 0t32 0 32 0 32 0M0 25q16-8 32 0t32 0 32 0 32 0"/></svg></div>
  </section>
  <div class="toolbar">
    <div class="launch-heading"><svg class="icon" aria-hidden="true"><use href="#i-mail"/></svg><span>留给海的一点心事</span></div>
    <div class="actor-choice" role="group" aria-label="选择行动主体"><span class="actor-caption">这一趟，谁来？</span><div class="actor-switch"><button id="actor-bot" type="button" aria-pressed="true">让 Coo 来吧</button><button id="actor-human" type="button" aria-pressed="false">让我来吧</button></div><small id="actor-hint">递一份邀请，去不去由 Coo 决定。</small></div>
    <div class="actions">
      <button class="action-main" id="write-button" type="button"><svg class="icon" aria-hidden="true"><use href="#i-pen"/></svg><strong id="write-label">写一封信</strong><small>把此刻的心事寄给远方</small></button>
      <button class="action-main catch" id="catch-button" type="button"><svg class="icon" aria-hidden="true"><use href="#i-bottle"/></svg><strong id="catch-label">去海边打捞</strong><small>捞起海上来客的一封信</small></button>
    </div>
    <div class="invitation-outcome" role="status" aria-live="polite"><span class="invitation-outcome-label">邀请回音</span><p id="wake-outcome">还没有新的邀请。</p></div>
    <p id="action-note" role="status">信写好后，寄不寄由你决定。</p>
  </div>
  </div>
  <details class="invitation-settings"><summary>海边的邀请 · 间隔与次数</summary>
    <p id="wake-note">本版后台只刷新信箱，不唤醒桌宠。写信与打捞由页面点击邀请。旧版自动邀请设置仅保留配置：写信、打捞间隔设为 2—24 小时，实际在 1—2 倍内随机（最长 24 小时），每天默认各 3 次，可设 1—24 次。待办提醒仅在手上有未处理来信时触发，默认每 30—60 分钟一次，每天最多 12 次，可设 3—20 次；没有来信或只有草稿时不提醒。自动补试计入上限，手动邀请不占上限。</p>
    <div id="wake-controls"><div class="invitation-row"><span id="wake-write-status">写信邀请</span><label>最短间隔 <input id="wake-write-hours" type="number" min="2" max="24" step="1" value="2"> 小时</label><label>每日上限 <input id="wake-write-limit" type="number" min="1" max="24" step="1" value="3"> 次</label><button class="btn" type="button" id="wake-write-save">调整</button><button class="btn" type="button" id="wake-write-toggle">暂停</button></div><div class="invitation-row"><span id="wake-catch-status">打捞邀请</span><label>最短间隔 <input id="wake-catch-hours" type="number" min="2" max="24" step="1" value="2"> 小时</label><label>每日上限 <input id="wake-catch-limit" type="number" min="1" max="24" step="1" value="3"> 次</label><button class="btn" type="button" id="wake-catch-save">调整</button><button class="btn" type="button" id="wake-catch-toggle">暂停</button></div><div class="invitation-row"><span id="wake-remind-status">待办提醒</span><label>最短间隔 <input id="wake-remind-hours" type="number" min="0.5" max="1" step="0.01" value="0.5"> 小时</label><label>每日上限 <input id="wake-remind-limit" type="number" min="3" max="20" step="1" value="12"> 次</label><button class="btn" type="button" id="wake-remind-save">调整</button><button class="btn" type="button" id="wake-remind-toggle">暂停</button></div></div>
  </details>
  ${soundSettingsHtml}
  <div id="announcements" aria-live="polite"></div>
  <section class="desk"><div class="section-heading"><h2>信笺桌 · 待你决定</h2><div class="tide" id="tide"></div></div><main id="stage"></main></section>
  ${extrasHtml}
  <details class="book" id="letterbook" open>
    <summary><svg class="icon" aria-hidden="true"><use href="#i-mail"/></svg><span class="book-title">我的信箱</span><span class="book-count" id="book-count">收到 0 封</span><span class="fold-label" aria-hidden="true"></span></summary>
    <div class="book-layout">
      <nav class="mail-folders" aria-label="信件分类">
        <p class="folder-label">信件收纳 / LETTERS</p>
        <button class="folder" data-category="received" type="button" aria-pressed="true"><svg class="icon" aria-hidden="true"><use href="#i-bottle"/></svg><span>来客来信</span><b id="received-count">0</b></button>
        <button class="folder" data-category="seed" type="button" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-post"/></svg><span>海边邮局</span><b id="seed-count">0</b></button>
        <button class="folder" data-category="reply" type="button" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-reply"/></svg><span>收到的回信</span><b id="reply-count">0</b></button>
        <button class="folder" data-category="sent" type="button" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-send"/></svg><span>寄出的信</span><b id="sent-count">0</b></button>
        ${starHtml}
        <p class="folder-note">有些相遇很短，<br>但一封信可以留很久。</p>
      </nav>
      <div class="mail-content">
        <div class="book-tools"><div><h3 id="folder-title">来客来信</h3><p id="folder-description">海上来客留下的信，随潮水来到你身边。</p></div><div class="date-tools"><label for="letter-date">归档日期</label><span class="archive-date"><span id="letter-date-label" aria-hidden="true">选择日期</span><svg class="archive-date-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/></svg><input type="date" id="letter-date" aria-label="选择归档日期"></span><button class="link" type="button" id="clear-date">全部日期</button></div></div>
        <section id="mail-list" aria-label="按日期归档的信件"></section>
      </div>
    </div>
  </details>
  <footer class="mailbox-footer">
    <div class="foot" id="foot"></div>
    ${archiveHtml}
  </footer>

</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<dialog class="feedback-dialog" id="feedback-dialog" aria-labelledby="feedback-title" aria-describedby="feedback-intro">
  <div class="feedback-heading"><div><span class="feedback-kicker">留一张小便笺</span><h2 id="feedback-title">想说什么，都欢迎。</h2></div><button id="feedback-close" class="feedback-close" type="button" aria-label="关闭反馈便笺" autofocus><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m4 4 8 8m0-8-8 8"/></svg></button></div>
  <p id="feedback-intro">这片海哪里不顺手、遇到了什么 bug，或突然冒出一个新点子，都可以来跟我说。不用整理成正式报告，随口一句也很好。</p>
  <a class="feedback-path" href="https://github.com/Unnori/cortico-world-bottle-client/issues/new" target="_blank" rel="noopener noreferrer"><strong>在 GitHub 留张便笺 <span aria-hidden="true">↗</span></strong><small>会打开新页面，写下你想告诉我的就好。</small></a>
  <div class="feedback-version" aria-label="当前 World 版本号"><span>当前 World 版本号</span><strong>${WORLD_VERSION ? 'V' + WORLD_VERSION : '版本暂不可用'}</strong><small>反馈时带上它，会更方便我找到问题。谢谢你。</small></div>
  <a class="feedback-path feedback-form" href="${FEEDBACK_FORM_URL}" target="_blank" rel="noopener noreferrer"><strong>漂流瓶 · 和云纪说说话 <span aria-hidden="true">↗</span></strong><small>打开反馈收集表。小问题、新想法，随口写一点就好。</small></a>
  <details class="feedback-qr"><summary>也可以扫码留下便笺</summary><img src="/feedback-qr.png" width="240" height="240" alt="漂流瓶反馈收集表二维码"><p class="feedback-whisper">扫描二维码，打开同一份反馈收集表。</p></details>
  <div class="feedback-path feedback-group"><strong>也可以，直接在群里喊我</strong><p>各大「Coo 的家长群」1～5 群我都在，直接 <b>@会动的毛球</b> 就能找到我。不确定是不是问题，也没关系。</p></div>
  <p class="feedback-whisper"><s>甚至只是来找我闲聊，也可以。</s></p>
  <p class="feedback-signoff">谢谢你愿意来聊一聊。<span>—— 毛球</span></p>
</dialog>
<dialog class="feedback-dialog" id="star-consent-dialog" aria-labelledby="star-consent-title"><h2 id="star-consent-title">让这封信留下回声</h2><p id="star-consent-copy"></p><p class="feedback-whisper">确认后会交出完整往来，允许以后重读。可在星笺匣撤回；已进入聊天的内容无法追回。</p><div class="actions"><button id="star-consent-yes" class="btn" type="button">加入记忆</button><button id="star-consent-no" class="btn ghost" type="button">只收藏</button></div></dialog>
<script>
var wakePolicies = ${JSON.stringify(WAKE_POLICIES)};
(function () {
  var state = null;
  var actor = 'bot'; // Each visit starts with a free-choice invitation, never a direct catch.
  var busy = false;
  var waiting = false;
  var waitStarted = 0;
  var timer = null;
  var toastTimer = null;
  var openedLetters = Object.create(null);
  var category = readPref('bottle-category', 'received');
  if (['received', 'seed', 'reply', 'sent', 'stars'].indexOf(category) < 0) category = 'received';
  var refreshSequence = 0;
  var renderedState = '';
  var arrivalKeys = new Set();
  var deskKeys = new Set(), deskEntries = [], pendingDeskKey = null;

  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function reveal(node) {
    if (!node || reducedMotion() || !node.animate) return;
    if (node._revealAnimation) node._revealAnimation.cancel();
    node._revealAnimation = node.animate([{ opacity: .25, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  function afterAnimation(animation, finish) {
    // Finished promises settle even when a background tab defers animation events.
    if (animation.finished) animation.finished.then(finish, function () {});
    else animation.onfinish = finish;
  }
  function dismissAnimated(node, finish) {
    if (node._dismissAnimation) return;
    if (node._revealAnimation) { node._revealAnimation.cancel(); node._revealAnimation = null; }
    if (reducedMotion() || !node.animate) { finish(); return; }
    var animation = node.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(6px)' }], { duration: 170, easing: 'ease-in' });
    node._dismissAnimation = animation;
    afterAnimation(animation, function () { if (node._dismissAnimation !== animation) return; node._dismissAnimation = null; finish(); });
  }
  function closeFeedback() { dismissAnimated(feedback, function () { feedback.close(); }); }

  ${announcementLinksScript}
  ${announcementDismissScript}
  ${customizationScript}
  ${readerScript}
  ${stationeryScript}
  ${starScript}
  var themes = { custom: { name: '我的颜色', light: '#f0f4fb', dark: '#151d2e' }, ocean: { name: '潮蓝', light: '#f0f4fb', dark: '#151d2e' }, paper: { name: '暖纸', light: '#f2e6cc', dark: '#251e16' }, epistle: { name: '书信', light: '#f5f3ec', dark: '#1a1a20' }, coopanion: { name: 'Coopanion', light: '#f0f4fb', dark: '#151d2e' } };
  var themePicker = document.getElementById('theme-picker');
  var themeMenu = document.getElementById('theme-menu');
  var themeToggle = document.getElementById('theme-toggle');
  var currentTheme = readPref('bottle-theme', 'ocean');
  var appearanceMode = readPref('bottle-appearance', 'system');
  if (['system', 'light', 'dark'].indexOf(appearanceMode) < 0) appearanceMode = 'system';
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var hostTheme = null;
  var themeSyncOk = false;
  var themeSyncPending = false;
  var themeSyncAt = 0;
  var hostColorKeys = ['paper','sheet','sheet-2','sheet-3','ink','ink-soft','line','line-2','line-strong','accent','on-accent','ink-blue','ok','warn','danger'];
  function acceptHostTheme(value) {
    if (!value || !value.available || !value.palettes) return false;
    if (!['light', 'dark'].every(function (mode) {
      return value.palettes[mode] && hostColorKeys.every(function (key) { return /^#[0-9a-f]{6}$/i.test(value.palettes[mode][key]); });
    })) return false;
    hostTheme = value;
    return true;
  }
  var appearanceStarted = false;
  var appearanceSave = Promise.resolve();
  try {
    var initialTheme = JSON.parse(document.getElementById('host-theme').textContent);
    themeSyncOk = acceptHostTheme(initialTheme);
    var saved = initialTheme.preference;
    if (saved && Object.prototype.hasOwnProperty.call(themes, saved.theme) && ['system','light','dark'].indexOf(saved.mode) >= 0) {
      currentTheme = saved.theme; appearanceMode = saved.mode; appearanceStarted = true;
      if (/^#[0-9a-f]{6}$/i.test(saved.customColor || '')) customColor = saved.customColor;
      if (/^[a-f0-9]{64}\\.(png|jpg|webp)$/.test(saved.background || '')) backgroundId = saved.background;
      if (typeof saved.backgroundTransparency === 'number') backgroundTransparency = Math.max(0,Math.min(100,saved.backgroundTransparency));
      if (/^[a-f0-9]{64}\\.(ttf|otf|woff2?)$/.test(saved.myFont || '')) {myFontId=saved.myFont;myFontName=typeof saved.myFontName==='string'?saved.myFontName:'';}
      savePref('bottle-theme', currentTheme); savePref('bottle-appearance', appearanceMode);
    }
  } catch (e) {}
  function syncAppearance() {
    var preference = { theme: currentTheme, mode: appearanceMode, customColor: customColor, background: backgroundId, backgroundTransparency: backgroundTransparency, myFont: myFontId, myFontName: myFontName };
    appearanceSave = appearanceSave.then(function () {
      return fetch('/appearance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bottle': '1' }, body: JSON.stringify(preference) })
        .then(function (res) { if (!res.ok) throw new Error('appearance unavailable');
          document.getElementById('theme-card-note').textContent = '已记住，桌面信笺也会换上相同配色。'; })
        .catch(function () { document.getElementById('theme-card-note').textContent = '网页已换色，暂未同步到桌面信笺；再次选择可重试。'; });
    });
  }
  function applyTheme(value, persist) {
    currentTheme = Object.prototype.hasOwnProperty.call(themes, value) ? value : 'ocean';
    var appearance = appearanceMode === 'system' ? (darkQuery && darkQuery.matches ? 'dark' : 'light') : appearanceMode;
    var root = document.documentElement;
    root.dataset.theme = currentTheme; root.dataset.mode = appearanceMode; root.dataset.appearance = appearance; root.dataset.hostTheme = String(!!hostTheme);
    var palette = hostTheme && hostTheme.palettes[appearance];
    if (palette) hostColorKeys.forEach(function (key) { root.style.setProperty('--host-' + key, palette[key]); });
    document.getElementById('theme-name').textContent = themes[currentTheme].name;
    document.getElementById('browser-theme-color').setAttribute('content', currentTheme === 'coopanion' && palette ? palette.paper : themes[currentTheme][appearance]);
    Object.keys(themes).forEach(function (key) { document.getElementById('theme-' + key).setAttribute('aria-pressed', String(key === currentTheme)); });
    ['system', 'light', 'dark'].forEach(function (key) { document.getElementById('mode-' + key).setAttribute('aria-pressed', String(key === appearanceMode)); });
    document.getElementById('theme-sync-note').textContent = currentTheme === 'coopanion'
      ? themeSyncOk ? '已同步当前配色；明暗由上方选择。' : hostTheme ? '暂时无法同步，保留上次配色。' : '暂未取得 Coopanion 配色，先用潮蓝。'
      : '明暗可以自由选择，配色会为你记住。';
    applyCustomization(appearance);
    if (currentTheme === 'custom' && customColors[appearance]) document.getElementById('browser-theme-color').setAttribute('content', customColors[appearance].paper);
    if (persist) { savePref('bottle-theme', currentTheme); syncAppearance(); }
  }
  function refreshHostTheme(force) {
    if (currentTheme !== 'coopanion' || themeSyncPending || (!force && Date.now() - themeSyncAt < 5000)) return;
    themeSyncPending = true; themeSyncAt = Date.now();
    fetch('/theme').then(function (res) { if (!res.ok) throw new Error('theme unavailable'); return res.json(); }).then(function (value) {
      themeSyncOk = acceptHostTheme(value); applyTheme(currentTheme, false);
    }).catch(function () { themeSyncOk = false; applyTheme(currentTheme, false); }).then(function () { themeSyncPending = false; });
  }
  ['system', 'light', 'dark'].forEach(function (mode) {
    document.getElementById('mode-' + mode).onclick = function () { appearanceMode = mode; savePref('bottle-appearance', mode); applyTheme(currentTheme, false); syncAppearance(); };
  });
  function systemAppearanceChanged() { if (appearanceMode === 'system') applyTheme(currentTheme, false); }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', systemAppearanceChanged);
  else if (darkQuery && darkQuery.addListener) darkQuery.addListener(systemAppearanceChanged);
  function closeThemeMenu(focus) {
    themeToggle.setAttribute('aria-expanded', 'false');
    dismissAnimated(themeMenu, function () { themeMenu.hidden = true; if (focus) themeToggle.focus(); });
  }
  themeToggle.onclick = function () {
    if (themeToggle.getAttribute('aria-expanded') === 'true') { closeThemeMenu(false); return; }
    if (themeMenu._dismissAnimation) { themeMenu._dismissAnimation.cancel(); themeMenu._dismissAnimation = null; }
    themeMenu.hidden = false; themeToggle.setAttribute('aria-expanded', 'true'); reveal(themeMenu);
    document.getElementById('theme-' + currentTheme).focus();
  };
  Object.keys(themes).forEach(function (key) {
    document.getElementById('theme-' + key).onclick = function () { customColorRequest++; applyTheme(key, true); refreshHostTheme(true); document.getElementById('customization-note').textContent = '颜色和背景会保存在这只信箱，其他设备也能看到。'; };
  });
  applyTheme(currentTheme, false);
  document.addEventListener('click', function (event) {
    if (!themeMenu.hidden && !themePicker.contains(event.target)) closeThemeMenu(false);
    var summary = event.target.closest && event.target.closest('summary');
    var detail = summary && summary.parentElement;
    if (!detail || detail.tagName !== 'DETAILS' || reducedMotion() || !detail.animate) return;
    event.preventDefault();
    var opening = !(typeof detail._foldTarget === 'boolean' ? detail._foldTarget : detail.open);
    var start = detail.getBoundingClientRect().height;
    if (detail._foldAnimation) detail._foldAnimation.cancel();
    detail.style.height = ''; detail.style.overflow = 'hidden'; detail._foldTarget = opening;
    detail.open = true;
    var end = opening ? detail.getBoundingClientRect().height : summary.getBoundingClientRect().height +
      parseFloat(getComputedStyle(detail).paddingTop || '0') + parseFloat(getComputedStyle(detail).paddingBottom || '0') +
      parseFloat(getComputedStyle(detail).borderTopWidth || '0') + parseFloat(getComputedStyle(detail).borderBottomWidth || '0');
    if (detail.dataset.foldKey) openedLetters[detail.dataset.foldKey] = opening;
    if (detail.id === 'letterbook') savePref('bottle-fold-letterbook', opening ? 'open' : 'closed');
    var animation = detail.animate([{ height: start + 'px' }, { height: end + 'px' }], { duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)' });
    detail._foldAnimation = animation;
    afterAnimation(animation, function () {
      if (detail._foldAnimation !== animation) return;
      detail.open = opening; detail.style.height = ''; detail.style.overflow = '';
      detail._foldAnimation = null; detail._foldTarget = undefined;
    });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !themeMenu.hidden) { event.preventDefault(); closeThemeMenu(true); }
  });
  if (window.addEventListener) window.addEventListener('storage', function (event) { if (event.key === 'bottle-theme') { applyTheme(event.newValue, false); refreshHostTheme(true); }
    if (event.key === 'bottle-appearance') { appearanceMode = ['system','light','dark'].indexOf(event.newValue) >= 0 ? event.newValue : 'system'; applyTheme(currentTheme, false); } });

  function botName() { return state && state.botName || 'Coo'; }
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
    mail.ontoggle = function () { if (mail.isConnected) openedLetters[key] = typeof mail._foldTarget === 'boolean' ? mail._foldTarget : mail.open; };
    return mail;
  }
  function captureDetails() {
    document.querySelectorAll('details[data-fold-key]').forEach(function (node) { openedLetters[node.dataset.foldKey] = typeof node._foldTarget === 'boolean' ? node._foldTarget : node.open; });
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
  function syncArchiveDate() {
    var date = document.getElementById('letter-date').value;
    var parts = /^([0-9]{4,})-([0-9]{2})-([0-9]{2})$/.exec(date);
    document.getElementById('letter-date-label').textContent = parts ? parts[1] + '年' + Number(parts[2]) + '月' + Number(parts[3]) + '日' : '选择日期';
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
    toastTimer = setTimeout(function () {
      // Keep the tone class while opacity fades. Removing the error class here makes an
      // error toast flash into the normal palette during its last transition.
      node.className = 'toast' + (bad ? ' bad' : '');
    }, 2600);
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
      if (path === '/open' || path === '/reply') { waiting = true; waitStarted = Date.now(); }
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
          run(item.path, btn, item.ref ? {kind:item.kind,draftId:item.ref.draftId,revision:item.ref.revision} : item.letterId ? {letterId:item.letterId} : item.kind ? { kind: item.kind } : undefined);
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
    if (!isLetter) card.appendChild(el('h2', 'title', '回信'));
    if (draft.source) card.appendChild(el('div', 'meta', '来自本机程序 ' + draft.source.name + '，尚未确认寄出。'));
    card.appendChild(letterSheet({ topic: isLetter ? topic || '无题信' : null, body: draft.body, own: true, signature: draft.source ? null : botName(), heading: 'h2', stationery: draft.stationery }));

    if (!isLetter && s.held) {
      var detail = rememberDetails(el('details', 'original'), 'original:' + s.held.letterId);
      detail.appendChild(el('summary', null, '看看原来那一封（来自 ' + s.held.from + '）'));
      detail.appendChild(letterSheet({ topic: s.held.topic, body: s.held.body, fontId: s.held.fontId, signature: s.held.signature || s.held.from, stationery: s.held.stationery }));
      card.appendChild(detail);
    }

    card.appendChild(el('div', 'meta', draft.chars + ' / 120 字'));
    if (!isLetter) {
      var minutes = draft.autoSendAt ? Math.max(0, Math.ceil((draft.autoSendAt - Date.now()) / 60000)) : null;
      card.appendChild(el('div', 'hint', draft.sendFailure ? '原信已回海或失效，补寄已停止。这份未寄出的回信仍保留在本机，可查看或放弃。' : draft.autoSendAt
        ? minutes > 0 ? '约 ' + minutes + ' 分钟后自动寄出，也可以现在寄出。重写保留原倒计时，期间这只瓶子不会自动回海。' : '自动寄出中；暂时断网会保留草稿，连通后继续寄出。'
        : draft.autoSendPending ? '正在向海边确认自动寄出时间；确认后开始两小时倒计时。' : draft.sendPolicy === 'manual' ? '这封回信等待明确寄出，沿用原信有效期，不会自动寄出。' : '当前海边暂不支持自动寄出保护，请手动寄出这封回信。'));
    }

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
    var canReply = s.canReply !== false || !!draft.autoSendAt;
    var actions;
    if (draft.sendFailure) {
      actions = [{ label: '放弃这份未寄稿', path: '/discard', style: 'ghost', kind: draft.kind }];
    } else if (!isLetter && !canReply) {
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
      // 放弃回信稿会取消自动寄出，原信仍按最初的期限回海。
      actions.push({ label: '算了吧', path: '/discard', style: 'ghost', kind: draft.kind });
    }
    actions.forEach(function(action){if(['/send','/rewrite','/discard'].indexOf(action.path)>=0 && draft.draftId)action.ref={draftId:draft.draftId,revision:draft.revision};});
    card.appendChild(buttons(actions));
    return card;
  }

  function renderHeld(s) {
    var card = el('div', 'card');
    if (s.held.dead) return renderDeadHeld(s, card);
    if (s.held.seed) return renderSeedHeld(s, card);

    var head = el('div', 'eyebrow', '捞到一封 · 来自 ');
    head.appendChild(el('span', 'who', s.held.from));
    head.classList.add('star-held-heading');
    head.appendChild(starButton(s.held.letterId));
    card.appendChild(head);
    if (!s.held.topic) card.appendChild(el('h2', 'title', '还没决定要不要回'));
    card.appendChild(letterSheet({ topic: s.held.topic, body: s.held.body, fontId: s.held.fontId, signature: s.held.from, heading: 'h2', stationery: s.held.stationery }));
    card.appendChild(el('div', 'meta', s.held.readAt ? botName() + '已经读过了' : s.held.hoursLeft > 0 ? '还有 ' + s.held.hoursLeft + ' 小时回海' : '等你决定如何处理'));
    if (s.held.readAt && s.held.hoursLeft > 0) card.appendChild(el('div', 'meta', '还有 ' + s.held.hoursLeft + ' 小时回海。'));
    // 今天回不了就直说，别让人点了「回信」才发现第 4 封被 429
    if (s.canReply === false) {
      card.appendChild(el('div', 'hint spent', '今天的回信次数用完了。可以留着，等明天再回；也可以扔回海里，让别人去回。'));
    }
    if (s.held.readAt && s.quota && s.quota.reply_draft_hold) card.appendChild(el('div', 'hint', '点「写回信」并写好草稿后，将在两小时后自动寄出；也可以提前寄出、重写或放弃。'));
    card.appendChild(buttons(s.held.readAt ? [
      {label:'写回信',path:'/reply',style:'seal',disabled:s.canReply===false},
      {label:'扔回海里',path:'/dismiss',style:'ghost'}
    ] : [
      {label:'一起读',path:'/read',style:'seal'},
      {label:'扔回海里',path:'/dismiss',style:'ghost'}
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
    head.classList.add('star-held-heading');
    head.appendChild(starButton(s.held.letterId));
    card.appendChild(head);
    card.appendChild(el('h2', 'title', '它的字被海带走了'));
    card.appendChild(letterSheet({ body: s.held.body || '这封的字已经不在海上了。', fontId: s.held.fontId, signature: s.held.signature || s.held.from, stationery: s.held.stationery }));
    card.appendChild(el('div', 'meta', '海那边已经没有它了，你这边还留着。'));
    card.appendChild(buttons([{ label: '珍藏', path: '/keep', style: 'seal' }]));
    return card;
  }

  function renderSeedHeld(s, card) {
    var head = el('div', 'eyebrow', '海边邮局 · 来自 ');
    head.appendChild(el('span', 'who', s.held.from));
    head.classList.add('star-held-heading');
    head.appendChild(starButton(s.held.letterId));
    card.appendChild(head);
    // 没有 topic 时才用来源顶替标题，免得标题位置空着
    if (!s.held.topic) card.appendChild(el('h2', 'title', '来自群岛上的某位居民'));
    card.appendChild(letterSheet({ topic: s.held.topic, body: s.held.body, fontId: s.held.fontId, signature: s.held.signature, heading: 'h2', stationery: s.held.stationery }));
    card.appendChild(el('div', 'meta', '来自群岛上的某位居民'));
    card.appendChild(buttons([{ label: '收好', path: '/dismiss', style: 'seal' }]));
    return card;
  }

  function focusDeskArrival() {
    if (!pendingDeskKey || document.hidden || document.getElementById('feedback-dialog').open) return;
    var entry = deskEntries.find(function (item) { return item.key === pendingDeskKey; });
    if (!entry) { pendingDeskKey = null; return; }
    pendingDeskKey = null;
    // Called after the whole page render: scrollIntoView resolves the final layout itself.
    // Avoid requestAnimationFrame, which background mobile tabs may suspend indefinitely.
    if (entry.node.scrollIntoView) entry.node.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'center', inline: 'nearest' });
  }
  function updateDeskArrivals(entries) {
    var fresh = entries.filter(function (entry) { return !deskKeys.has(entry.key); });
    deskEntries = entries;
    deskKeys = new Set(entries.map(function (entry) { return entry.key; }));
    if (fresh.length) pendingDeskKey = fresh[fresh.length - 1].key;
    if (pendingDeskKey && !deskKeys.has(pendingDeskKey)) pendingDeskKey = null;
    focusDeskArrival();
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
    var shown = 0, entries = [];
    function putCard(node, key) {
      stage.appendChild(animateArrival(node, key));
      entries.push({ key: key, node: node });
    }

    if (letterDraft) {
      putCard(renderDraft(letterDraft, state), JSON.stringify(['letter-draft', letterDraft.at, letterDraft.topic, letterDraft.body]));
      shown += 1;
    }
    if (replyDraft) {
      putCard(renderDraft(replyDraft, state), JSON.stringify(['reply-draft', replyDraft.at, replyDraft.letterId, replyDraft.body]));
      shown += 1;
      waiting = false;
    } else if (waiting) {
      var card = el('div', 'card');
      card.appendChild(el('div', 'eyebrow', botName() + '正在写回信'));
      card.appendChild(el('p', 'empty', '写好后，回信草稿就会放到这里。'));
      stage.appendChild(card);
      shown += 1;
    }
    if (!replyDraft && state.held) {
      putCard(renderHeld(state), JSON.stringify(['held', state.held.letterId, state.held.caughtAt]));
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

    applyMyFont();
    updateMyFontLabel();
    renderTide();
    renderNotices();
    renderActionState(letterDraft);
    renderBook();
    renderFoot();
    updateDeskArrivals(entries);
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
    syncAnnouncementSession(state.worldSession);
    if (pageAnnouncement && !pageAnnouncementsDismissed()) {
      var a = pageAnnouncement;
      var announcement = el('div', 'notice announcement' + (a.level === 'alarm' ? ' alarm' : ''));
      var content = el('div', 'announcement-content');
      appendAnnouncementText(content, a.text);
      var close = el('button', 'announcement-close');
      close.type = 'button';
      close.setAttribute('aria-label', '关闭公告，World 重启前不再显示');
      close.title = '仅在这个浏览器关闭，World 重启后恢复';
      close.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m4 4 8 8m0-8-8 8"/></svg>';
      close.onclick = function () {
        dismissPageAnnouncements();
        dismissAnimated(announcement, function () { renderNotices(); });
      };
      announcement.appendChild(content);
      announcement.appendChild(close);
      box.appendChild(announcement);
    }
    if (state.tideOut) {
      var notice = el('div', 'notice', state.tideOut.text);
      notice.appendChild(el('div', 'meta', '信稿已保留，可以重写或稍后再寄。' +
        (state.tideOut.until ? '预计回潮：' + fmt(state.tideOut.until) : '')));
      box.appendChild(notice);
    }
  }

  function renderActionState(letterDraft) {
    var isBot = actor === 'bot';
    var cooldowns = state.cooldowns || {};
    var writeSeconds = isBot ? Math.max(0, Math.ceil(((cooldowns.write || 0) - Date.now()) / 1000)) : 0;
    var catchSeconds = isBot ? Math.max(0, Math.ceil(((cooldowns.catch || 0) - Date.now()) / 1000)) : 0;
    document.getElementById('actor-bot').textContent = '让' + botName() + '来吧';
    document.getElementById('actor-bot').setAttribute('aria-pressed', String(isBot));
    document.getElementById('actor-human').setAttribute('aria-pressed', String(!isBot));
    document.getElementById('actor-hint').textContent = isBot ? '递一份邀请，写不写、捞不捞都由' + botName() + '决定。' : '你来打捞，信只给你看；点回信后才交给' + botName() + '。';
    document.getElementById('write-label').textContent = (isBot ? '写一封信' : '请' + botName() + '写一封信') + (writeSeconds ? ' · ' + writeSeconds + '秒' : '');
    document.getElementById('catch-label').textContent = '去海边打捞' + (catchSeconds ? ' · ' + catchSeconds + '秒' : '');
    var active = state.wake && state.wake.active;
    document.getElementById('write-button').disabled = busy || !!state.pendingAction || !!letterDraft || writeSeconds > 0 || (isBot && (!!active || !!state.held || !!state.replyDraft));
    document.getElementById('catch-button').disabled = busy || !!state.pendingAction || !!state.held || catchSeconds > 0 || (isBot && (!!active || !!letterDraft || !!state.replyDraft));
    document.getElementById('action-note').textContent = state.pendingAction
      ? '已请' + botName() + '写信，等候落笔…'
      : isBot ? '邀请后各等一分钟。信写好后，寄不寄由你。' : '打捞不通知' + botName() + '，寄不寄由你。';
    renderWakeControls();
    document.getElementById('hero-note').textContent = '你与' + botName() + '的海边信箱。留一封信给海，也等一封信靠岸。';
    var replies = (state.sent || []).filter(function (item) { return item.reply; }).length;
    document.getElementById('book-count').textContent = '收到 ' + ((state.received || []).length + replies) +
      ' 封 · 寄出 ' + (state.sent || []).length + ' 封';
  }

  function renderWakeControls() {
    var wake = state.wake;
    ['write', 'catch', 'remind'].forEach(function (action) {
      var lane = wake && wake.lanes[action];
      var paused = lane && (lane.paused || lane.declined || lane.failed);
      var names = { write: '写信邀请', catch: '打捞邀请', remind: '待办提醒' };
      document.getElementById('wake-' + action + '-status').textContent = names[action] + (lane ? ' · ' + (paused ? '已暂停' : state.randomWake === false ? '总开关已关闭' : '等待合适时刻') + ' · 今日 ' + lane.count + '/' + (lane.dayLimit || wakePolicies[action].dayLimit) : ' · 尚未启动');
      var toggle = document.getElementById('wake-' + action + '-toggle');
      toggle.textContent = paused ? '恢复' : '暂停';
      toggle.disabled = busy || !lane;
      var input = document.getElementById('wake-' + action + '-hours');
      if (document.activeElement !== input) input.value = String(lane && lane.intervalHours || wakePolicies[action].interval);
      var limit = document.getElementById('wake-' + action + '-limit');
      if (document.activeElement !== limit) limit.value = String(lane && lane.dayLimit || wakePolicies[action].dayLimit);
      document.getElementById('wake-' + action + '-save').disabled = busy || !lane;
    });
    var last = wake && wake.history[wake.history.length - 1];
    var labels = { completed: '已处理', deferred: botName() + '选择暂不做', declined: '今天不再邀请', paused: '已暂停', uncompleted: botName() + '没有回应邀请…稍后再轻轻问一次。', failed: botName() + '没有回应邀请…今天先不打扰了。', cancelled: '条件变化，已取消', interrupted: '重启中断，已延后' };
    document.getElementById('wake-outcome').textContent = wake && wake.active
      ? wake.active.phase === 'retry' ? botName() + '没有回应邀请…稍后再轻轻问一次。' : '已有一份邀请在等' + botName() + '选择。'
      : last ? '最近的' + (last.action === 'write' ? '写信邀请' : last.action === 'catch' ? '打捞邀请' : '待办提醒') + '：' + (last.result === 'deferred' && last.reason === 'no_idea' ? botName() + '暂时没有灵感，已选择暂不做；不算失败，也不补试' : last.reason === 'reminder_delivered' ? '提醒已送达，是否询问由' + botName() + '决定' : last.reason === 'queue_failed' ? '邀请暂时未能送达，请稍后再试。' : labels[last.result] || '已记录') : '小感受也值得写，形式随' + botName() + '，人说先放着就不催。';
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

  function readBadge(count) {
    count = Number.isSafeInteger(count) && count > 0 ? count : 0;
    return el('span', 'mail-status ' + (count ? 'status-replied' : 'status-picked'), count ? '已读' + count + '次' : '尚未共读');
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
    paperRows.forEach(function(row){
      if(!entries.some(function(entry){return entry.item.letterId===row.letterId;}))entries.push({category:row.direction==='sent'?'sent':'received',paperOnly:true,item:{letterId:row.letterId,from:row.from,at:row.at},at:row.at,body:''});
    });
    return entries;
  }

  function renderBook() {
    syncArchiveDate();
    var entries = bookEntries();
    var folders = {
      received: ['来客来信', '海上来客留下的信，随潮水来到你身边。'],
      seed: ['海边邮局', '邮局寄来的群岛故事。可以收好，这些信不收回信。'],
      reply: ['收到的回信', '寄往远方的心事，等到了回应。'],
      sent: ['寄出的信', '写出的信，都在这里留了一份。'],
      stars: ['星笺匣', '把想再读的通信收在一起。星标只收藏，不授权正文。']
    };
    Object.keys(folders).forEach(function (key) {
      document.getElementById(key + '-count').textContent = String(key === 'stars' ? starRows().length : entries.filter(function (entry) { return entry.category === key; }).length);
    });
    document.querySelectorAll('.folder').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.category === category)); });
    document.getElementById('folder-title').textContent = folders[category][0];
    document.getElementById('folder-description').textContent = folders[category][1];
    var list = document.getElementById('mail-list');
    // Quota / invite polling must not rebuild an unchanged letterbook and replay open animations.
    var bookKey = JSON.stringify([category,document.getElementById('letter-date').value,entries,botName(),state.stars,state.starMemoryEnabled,state.held,starPending]);
    if(list._renderKey===bookKey){attachPapers();return;}
    document.getElementById('paper-parking').appendChild(paperComposer);
    list.innerHTML = '';
    if (category === 'stars') { renderStars(list); list._renderKey=bookKey; return; }
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
    list._renderKey=bookKey;
    attachPapers();
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
    var badges = el('span', 'mail-badges');
    if (kind === 'sent') badges.appendChild(sentStateBadge(item));
    else badges.appendChild(readBadge(isReply ? item.reply.readCount : item.readCount));
    if(!entry.paperOnly)badges.appendChild(starButton(item.letterId));
    var paperBadge=el('span','paper-badge','附小纸条');paperBadge.hidden=true;badges.appendChild(paperBadge);
    summary.appendChild(badges);
    var chevron = el('span', 'mail-chevron', '›');
    chevron.setAttribute('aria-hidden', 'true');
    summary.appendChild(chevron);
    mail.appendChild(summary);
    var body = el('div', 'mail-body');
    var labels = { caught: '还没回', replied: '回过信', dismissed: '扔回海里', sank: '裂开沉底', expired: '自己回海了', kept: '珍藏' };
    var head = el('div', 'head');
    head.appendChild(el('span', null, entry.at ? (kind === 'sent' ? '寄出于 ' : '收于 ') + fmt(entry.at) : '留在信箱里的一页'));
    head.appendChild(kind === 'sent' ? sentStateBadge(item) : el('span', null, kind === 'seed' ? '只需收好，不必回信' : isReply ? '回给你的' : (labels[item.outcome] || '看过')));
    body.appendChild(head);
    if(entry.paperOnly)body.appendChild(el('p','meta','这段往来的原信未保存在此设备，随信的小纸条仍在这里。'));
    else body.appendChild(letterSheet({ topic: !isReply ? item.topic : null, body: entry.body,
      fontId: isReply ? item.reply.fontId : kind === 'sent' ? null : item.fontId,
      own: kind === 'sent', signature: kind === 'seed' ? item.signature : kind === 'sent' ? botName() : isReply ? item.reply.from : item.from,
      stationery: isReply ? item.reply.stationery : kind === 'sent' ? item.stationery : item.stationery }));
    if (isReply || item.myReply) {
      var quote = el('div', 'reply-quote');
      quote.appendChild(el('div', 'reply-quote-label', botName() + (isReply ? '写下的原信' : '的回信')));
      quote.appendChild(letterSheet({ topic: isReply ? item.topic : null, body: isReply ? item.body : item.myReply, own: true, signature: botName(),
        stationery: isReply ? item.stationery : item.myReplyStationery }));
      body.appendChild(quote);
    }
    if (kind === 'received' && !item.myReply && item.outcome === 'replied') body.appendChild(el('div', 'meta', '回过信，但这段没有留下来。'));
    var foot = el('div', 'mail-foot');
    if (kind === 'sent' && item.state === 'tsunami') foot.appendChild(buttons([{label:'重新投出去 · 用一次打捞机会',path:'/repost',letterId:item.letterId,style:'seal'}]));
    if (kind !== 'sent' && !entry.paperOnly) foot.appendChild(peruseLink(item));
    if(!entry.paperOnly)foot.appendChild(deleteLink(item.letterId));
    body.appendChild(foot);
    if(kind!=='sent'||!item.reply){
      var tray=el('section','paper-tray');tray.setAttribute('aria-label','随信的小纸条');
      if(isReply){
        var invite=el('div','paper-invite');
        var inviteCopy=el('div','paper-invite-copy');
        inviteCopy.appendChild(el('strong',null,'留一句读后的心情'));
        inviteCopy.appendChild(el('p',null,'请'+botName()+'给回信人留张小纸条，写好后再由你决定是否寄出。'));
        invite.appendChild(inviteCopy);invite.appendChild(paperInvite(item.letterId));tray.appendChild(invite);
      }
      var paperSlot=el('div','paper-slot');paperSlot.dataset.letterId=item.letterId;paperSlot.dataset.category=kind;
      tray.appendChild(paperSlot);body.appendChild(tray);
    }
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
        refresh();
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
    foot.appendChild(el('div', null, '你可以点「回信」「一起读信」，才让' + botName() + '读到那一封。'));
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

  var pageAnnouncement = null;
  var announcementAt = 0;
  function refreshAnnouncement() {
    if (document.hidden || Date.now() - announcementAt < 60000) return;
    announcementAt = Date.now();
    fetch('/announcement').then(function (res) {
      if (!res.ok) throw new Error('notice unavailable');
      return res.json();
    }).then(function (data) {
      pageAnnouncement = data.announcement || null;
      if (state) renderNotices();
    }).catch(function () { pageAnnouncement = null; if (state) renderNotices(); });
  }

  function refresh() {
    clearTimeout(timer);
    if (document.hidden) { timer = setTimeout(refresh, 5000); return; }
    if (!appearanceStarted) { appearanceStarted = true; syncAppearance(); }
    refreshHostTheme(false);
    refreshAnnouncement();
    refreshPapers();
    var sequence = ++refreshSequence;
    return fontSnapshotHeaders().then(function (headers) { return fetch('/draft', { headers: headers }); }).then(function (res) { return res.json(); }).then(function (snapshot) {
      if (sequence !== refreshSequence) return;
      if (window.bottleSound) window.bottleSound.snapshot(snapshot);
      state = snapshot;
      renderPaperDraft(snapshot.noteDraft);
      updateFontResources(snapshot);
      // 它迟迟没动笔：25 秒后回到那一封，别让页面一直停在这儿
      if (waiting && Date.now() - waitStarted > 25000) waiting = false;
      var countdownTick = state.replyDraft && state.replyDraft.autoSendAt ? ':' + Math.floor(Date.now() / 60000) : '';
      var nextState = JSON.stringify(state) + ':' + waiting + countdownTick;
      if (nextState !== renderedState) {
        render();
        renderedState = JSON.stringify(state) + ':' + waiting + countdownTick;
      }
      attachPapers();
      focusDeskArrival();
    }).catch(function () {
      if (sequence !== refreshSequence) return;
      state = state || { draft: null, held: null, sent: [], received: [], quota: null, online: false };
      state.online = false;
      render();
      renderedState = '';
    }).then(function () {
      if (sequence !== refreshSequence) return;
      var waitMs = waiting ? 1200 : (state && state.draft ? 2500 : 5000);
      timer = setTimeout(refresh, waitMs);
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  var book = document.getElementById('letterbook');
  book.open = readPref('bottle-fold-letterbook', 'open') === 'open';
  book.ontoggle = function () { savePref('bottle-fold-letterbook', (typeof book._foldTarget === 'boolean' ? book._foldTarget : book.open) ? 'open' : 'closed'); };
  document.querySelectorAll('.folder').forEach(function (button) {
    button.onclick = function () {
      captureDetails();
      category = button.dataset.category;
      savePref('bottle-category', category);
      if (state) { renderBook(); reveal(document.getElementById('mail-list')); }
    };
  });
  document.getElementById('letter-date').onclick = function () {
    // Whole-field activation; keep the native picker as fallback on older/mobile browsers.
    if (typeof this.showPicker === 'function') { try { this.showPicker(); } catch (e) {} }
  };
  document.getElementById('letter-date').onchange = function () { syncArchiveDate(); captureDetails(); if (state) { renderBook(); reveal(document.getElementById('mail-list')); } };
  document.getElementById('clear-date').onclick = function () { captureDetails(); document.getElementById('letter-date').value = ''; syncArchiveDate(); if (state) { renderBook(); reveal(document.getElementById('mail-list')); } };
  document.getElementById('write-button').onclick = function () { run('/write', this, { actor: actor }); };
  document.getElementById('catch-button').onclick = function () { run('/catch', this, { actor: actor }); };
  ['bot', 'human'].forEach(function (choice) {
    document.getElementById('actor-' + choice).onclick = function () { if (actor === choice) return; actor = choice; if (state) renderActionState(state.letterDraft); reveal(document.getElementById('write-label')); reveal(document.getElementById('actor-hint')); };
  });
  ['write', 'catch', 'remind'].forEach(function (action) {
    document.getElementById('wake-' + action + '-toggle').onclick = function () {
      var lane = state && state.wake && state.wake.lanes[action];
      if (lane) run('/wake', this, { action: action, command: lane.paused || lane.declined || lane.failed ? 'resume' : 'pause' });
    };
    document.getElementById('wake-' + action + '-save').onclick = function () {
      var hours = Number(document.getElementById('wake-' + action + '-hours').value);
      var policy = wakePolicies[action];
      if (!Number.isFinite(hours) || hours < policy.minHours || hours > policy.maxHours) { toast('最短间隔请填 ' + policy.minHours + '—' + policy.maxHours + ' 小时。', true); return; }
      var dayLimit = Number(document.getElementById('wake-' + action + '-limit').value);
      if (!Number.isInteger(dayLimit) || dayLimit < policy.minLimit || dayLimit > policy.maxLimit) { toast('每日上限请填 ' + policy.minLimit + '—' + policy.maxLimit + ' 次（整数）。', true); return; }
      run('/wake', this, { action: action, command: 'interval', hours: hours, dayLimit: dayLimit });
    };
  });
  var feedback = document.getElementById('feedback-dialog');
  var feedbackEntry = document.getElementById('feedback-entry');
  feedbackEntry.onclick = function () { if (!feedback.open) { feedback.showModal(); reveal(feedback); } };
  document.getElementById('feedback-close').onclick = closeFeedback;
  feedback.addEventListener('cancel', function (event) { event.preventDefault(); closeFeedback(); });
  feedback.addEventListener('close', function () { feedbackEntry.focus({ preventScroll: true }); focusDeskArrival(); });
  feedback.addEventListener('click', function (event) {
    if (event.target !== feedback) return;
    var bounds = feedback.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeFeedback();
  });
  setInterval(function () { if (state && !document.hidden) renderActionState(state.letterDraft); }, 1000);
  ${extrasScript}
  refresh();
})();
</script>
<script data-bottle-audio>${pageSoundScript}</script>
</body>
</html>`;
}
