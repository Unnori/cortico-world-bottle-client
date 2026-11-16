import type { WakeAction, WakeState } from '../world/wake.ts';
import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

// This standalone browser bundle cannot import runtime modules. Bounds mirror wake-policy.ts;
// webui.test.js verifies the controls against that shared scheduler policy.
const WAKE_POLICIES = {
  write: { interval: 2, minHours: 2, maxHours: 24, dayLimit: 3, minLimit: 1, maxLimit: 24 },
  catch: { interval: 2, minHours: 2, maxHours: 24, dayLimit: 3, minLimit: 1, maxLimit: 24 },
  remind: { interval: 0.5, minHours: 0.5, maxHours: 1, dayLimit: 12, minLimit: 3, maxLimit: 20 },
};

/** Only HTTP(S) mailbox roots supplied by this World may be opened. */
export function mailboxUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      ? url.href : null;
  } catch { return null; }
}

export function reachableMailbox(links: Array<{ href: string }>, hostname?: string): string | null {
  const urls = links.map(link => mailboxUrl(link.href)).filter((url): url is string => !!url);
  const local = (host: string): boolean => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
  if (!hostname || local(hostname)) return urls.find(url => local(new URL(url).hostname)) ?? urls[0] ?? null;
  return urls.find(url => new URL(url).hostname === hostname) ?? urls.find(url => !local(new URL(url).hostname)) ?? null;
}

interface LanStatus { enabled: boolean; running: boolean; error?: string | null; urls: string[]; port: number; publicUrl: string }

// Browser-observed tokens only; never import the host's internal theme module.
export const HOST_THEME_KEYS = ['paper','sheet','sheet-2','sheet-3','ink','ink-soft','line','line-strong','accent','on-accent','ink-blue','ok','warn','danger'] as const;
export async function captureHostTheme(ctx:WebUiPanelContext) {
  const view=ctx.root.ownerDocument.defaultView;
  if(!view?.getComputedStyle)return null;
  const response=await view.fetch('/api/theme',{credentials:'same-origin',signal:ctx.signal});
  if(!response.ok)throw new Error('Host theme unavailable');
  const payload=await response.json(),theme=payload.theme??payload;
  const style=view.getComputedStyle(ctx.root),palette:Record<string,string>={};
  for(const key of HOST_THEME_KEYS){const value=style.getPropertyValue('--'+key).trim();if(/^#[0-9a-f]{6}$/i.test(value))palette[key]=value.toLowerCase();}
  if(!Object.keys(palette).length)throw new Error('Host colors unavailable');
  const scheme=style.colorScheme.trim();
  const appearance=scheme==='dark'||scheme==='light'?scheme:theme.mode==='dark'||theme.mode==='light'?theme.mode:view.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  return {selectedId:theme.selectedId??payload.defaultScheme??'unknown',appearance,palette,at:Date.now(),hostVersion:payload.hostVersion??'unknown'};
}

export async function mountMailbox(ctx: WebUiPanelContext): Promise<void> {
  const zh = ctx.language === 'zh' || ctx.language === 'zh-Hant';
  const t = zh ? {
    title: '去信箱看看',
    description: '写好的信、捞到的来信和等来的回音，都收在这里。',
    open: '打开信箱', loading: '正在找信箱…',
    unavailable: '信箱暂时没有打开，请重启漂流瓶 World 后再试。',
    error: '暂时没找到信箱，请稍后再试。', ready: '在浏览器中打开，寄不寄仍由你决定。',
  } : {
    title: 'Visit your mailbox', description: 'Your drafts, found letters and replies are waiting here.',
    open: 'Open mailbox', loading: 'Finding your mailbox…',
    unavailable: 'The mailbox is not running. Restart the Bottle World and try again.',
    error: 'Could not find the mailbox. Please try again shortly.',
    ready: 'Opens in your browser. You still decide whether to send each letter.',
  };
  const ui = ctx.ui;
  const card = ui.h('section', 'bottle-mailbox-entry');
  const copy = ui.h('div', 'bottle-mailbox-copy');
  copy.append(ui.h('h2', null, t.title), ui.h('p', null, t.description));
  let url: string | null = null;
  let opening=false;
  const botName = zh ? '桌宠' : 'the companion';
  const button = ui.button(t.open, { variant: 'primary', onClick: async () => {
    if(!url||ctx.signal.aborted||opening)return;
    opening=true;
    const target=url,view=ctx.root.ownerDocument.defaultView;
    // Reserve a blank window during the click; navigate only after the snapshot is saved.
    const popup=view?.open('about:blank','_blank');
    if(popup){popup.opener=null;try{const meta=popup.document.createElement('meta');meta.name='referrer';meta.content='no-referrer';popup.document.head.append(meta);}catch{/* No content is opened yet. */}}
    button.disabled=true;
    try{
      const snapshot=await captureHostTheme(ctx);
      if(snapshot&&!ctx.signal.aborted)await ctx.invoke('hostTheme',[snapshot]);
    }catch{/* Keep the previous theme snapshot or the built-in fallback. */}
    finally{opening=false;if(ctx.signal.aborted)popup?.close();else if(popup&&!popup.closed)popup.location.replace(target);else view?.open(target,'_blank','noopener,noreferrer');if(!ctx.signal.aborted)button.disabled=!url;}
  } });
  button.classList.add('bottle-open-mailbox');
  button.disabled = true;
  const note = ui.h('p', 'bottle-mailbox-note', t.loading);
  let feedbackUrl: string | null = null;
  const feedback = ui.h('button', 'bottle-feedback', zh ? '反馈收集 · 版本加载中' : 'Feedback · loading version');
  feedback.type = 'button'; feedback.disabled = true;
  feedback.title = zh ? '小问题、新想法，都可以留在这张便笺里。反馈时请带上当前 World 版本号。' : 'Share a problem or an idea, with your current World version.';
  feedback.onclick = () => {
    if (feedbackUrl && !ctx.signal.aborted) ctx.root.ownerDocument.defaultView?.open(feedbackUrl, '_blank', 'noopener,noreferrer');
  };
  card.append(copy, button, feedback, note);
  ctx.root.append(card);
  const invitations = ui.h('section', 'bottle-wake-controls');
  invitations.append(ui.h('h3', null, zh ? '海边的邀请' : 'Seaside invitations'));
  const controls = (['write', 'catch', 'remind'] as const).map(action => {
    const policy = WAKE_POLICIES[action];
    const row = ui.h('div', 'bottle-wake-row');
    const label = ui.h('span');
    const toggle = ui.button(zh ? '稍等' : 'Loading', { onClick: () => { void changeWake(action); } });
    toggle.disabled = true;
    const hoursLabel = ui.h('label', 'bottle-wake-interval', zh ? '最短间隔（小时）' : 'Minimum interval (hours)');
    const hours = ui.h('input');
    hours.type = 'number'; hours.min = String(policy.minHours); hours.max = String(policy.maxHours); hours.step = action === 'remind' ? '0.01' : '1'; hours.value = String(policy.interval);
    hoursLabel.append(hours);
    const limitLabel = ui.h('label', 'bottle-wake-interval', zh ? '每日上限（次）' : 'Daily limit');
    const limit = ui.h('input');
    limit.type = 'number'; limit.min = String(policy.minLimit); limit.max = String(policy.maxLimit); limit.step = '1'; limit.value = String(policy.dayLimit);
    limitLabel.append(limit);
    const save = ui.button(zh ? '调整' : 'Apply', { onClick: () => {
      const value = Number(hours.value);
      if (!Number.isFinite(value) || value < policy.minHours || value > policy.maxHours) { outcome.textContent = zh ? `请填写 ${policy.minHours}—${policy.maxHours} 小时。` : `Enter ${policy.minHours}–${policy.maxHours} hours.`; return; }
      const dayLimit = Number(limit.value);
      if (!Number.isInteger(dayLimit) || dayLimit < policy.minLimit || dayLimit > policy.maxLimit) { outcome.textContent = zh ? `每日上限请填 ${policy.minLimit}—${policy.maxLimit} 次（整数）。` : `Enter an integer from ${policy.minLimit} to ${policy.maxLimit}.`; return; }
      void changeWake(action, value, dayLimit);
    } });
    row.append(label, hoursLabel, limitLabel, save, toggle); invitations.append(row);
    return { action, label, toggle, hours, limit, save };
  });
  invitations.append(ui.h('p', 'bottle-wake-outcome', zh ? '定时写信与打捞邀请随下次对话或其他消息带入，不单独唤醒；手动点击的邀请立即生效。写信、打捞默认每天各 3 次，间隔 2—24 小时并随机延长；待办提醒默认每天 12 次（可设 3—20 次），有待处理来信或待寄草稿时每 30—60 分钟轻声提醒。包含自动补试，手动邀请不占上限。配置页顶栏为快照，信箱页签每 5 秒读取本机状态；去海边同步按设置间隔，默认 10 分钟一次。' : 'Scheduled writing/catching invitations join the next conversation or other event without waking on their own. Manual invitations remain immediate. Writing/catching default to 3/day, with a randomized 2–24 hour minimum. Reminders default to 12/day (3–20), every 30–60 minutes only while incoming mail or unsent drafts remain. Retries count; manual invitations are separate. This tab reads local status every 5 seconds; sea synchronization follows your configured interval, 10 minutes by default.'));
  const outcome = ui.h('p', 'bottle-wake-outcome');
  invitations.append(outcome); ctx.root.append(invitations);
  let wake: WakeState | null = null;
  let changing = false;
  async function changeWake(action: WakeAction, hours?: number, dayLimit?: number): Promise<void> {
    if (!wake || changing || ctx.signal.aborted) return;
    changing = true;
    controls.forEach(item => { item.toggle.disabled = true; item.save.disabled = true; });
    const lane = wake.lanes[action];
    try {
      const result = await ctx.invoke<{ ok: boolean; message?: string }>('wake', hours === undefined
        ? [action, lane.paused || lane.declined || lane.failed ? 'resume' : 'pause'] : [action, 'interval', hours, dayLimit]);
      if (result?.ok === false) throw new Error(result.message);
      if (!ctx.signal.aborted) await refresh();
    } catch { if (!ctx.signal.aborted) outcome.textContent = zh ? '暂时没能保存，请稍后再试。' : 'Could not save. Please retry.'; }
    finally {
      changing = false;
      if (!ctx.signal.aborted) controls.forEach(item => { item.toggle.disabled = !wake?.lanes[item.action]; item.save.disabled = !wake?.lanes[item.action]; });
    }
  }
  function renderWake(): void {
    controls.forEach(({ action, label, toggle, hours, limit, save }) => {
      const lane = wake?.lanes[action];
      const name = action === 'write' ? (zh ? '写信邀请' : 'Writing') : action === 'catch' ? (zh ? '打捞邀请' : 'Catching') : (zh ? '待办提醒' : 'Reminders');
      label.textContent = name + (lane ? (zh ? ' · 今天邀请 ' + lane.count + '/' + (lane.dayLimit ?? WAKE_POLICIES[action].dayLimit) + ' 次' : ' · ' + lane.count + ' today') : '');
      toggle.textContent = lane?.paused || lane?.declined || lane?.failed ? (zh ? '恢复邀请' : 'Resume') : (zh ? '暂停邀请' : 'Pause');
      toggle.disabled = !lane || changing;
      save.disabled = !lane || changing;
      if (ctx.root.ownerDocument.activeElement !== limit) limit.value = String(lane?.dayLimit ?? WAKE_POLICIES[action].dayLimit);
      if (ctx.root.ownerDocument.activeElement !== hours) hours.value = String(lane?.intervalHours ?? WAKE_POLICIES[action].interval);
    });
    const last = wake?.history.at(-1);
    const labels: Record<string, string> = zh ? {
      completed: '已经处理', deferred: botName + '选择暂不做', declined: '今天不再邀请', paused: '已按伙伴的选择暂停',
      uncompleted: botName + '没有回应邀请…稍后再轻轻问一次。', failed: botName + '没有回应邀请…今天先不打扰了。', cancelled: '条件变化，已取消', interrupted: '重启中断，已延后',
    } : { completed: 'Completed', deferred: 'Deferred by the bot', declined: 'Declined for today', paused: 'Paused by the partner',
      uncompleted: 'No result; one bounded retry', failed: 'Retry exhausted; stopped for today', cancelled: 'Conditions changed', interrupted: 'Interrupted by restart; delayed' };
    const active = wake?.active;
    if (active) {
      outcome.textContent = active.phase==='queued'&&!active.manual
        ? (zh ? (active.action==='remind'?'待办提醒':'定时邀请')+'已备好，等下次对话或其他消息时再带入。' : 'Ready for the next conversation or other event; this does not wake the companion on its own.')
        : active.phase === 'retry'
        ? (zh ? botName + '没有回应邀请…稍后再轻轻问一次。' : 'No result in the last turn; one retry is scheduled.')
        : (zh ? '已有一份邀请在等' + botName + '选择，写不写、捞不捞都由' + botName + '。' : 'One invitation is pending. The bot may still decline.');
      return;
    }
    const result = last?.result === 'deferred' && last.reason === 'no_idea' ? (zh ? botName + '暂时没有灵感，已选择暂不做；不算失败，也不补试' : 'No inspiration right now; voluntarily deferred, not a failure or retry') : last?.reason === 'reminder_delivered' ? (zh ? '提醒已送达，是否询问由' + botName + '决定' : 'Reminder delivered; the bot chooses whether to ask') : last?.reason === 'queue_failed' ? (zh ? '邀请未能送达，今天不再尝试' : 'Could not deliver; stopped for today') : last ? (labels[last.result] ?? last.result) : '';
    outcome.textContent = last ? (zh ? (last.action === 'write' ? '最近的写信邀请：' : last.action === 'catch' ? '最近的打捞邀请：' : '最近的待办提醒：') : 'Last result: ') + result
      : (zh ? '有想说或想听的时候再做，小感受也值得写；不必为邀请勉强。' : 'An invitation, not an obligation. No letter is better than filler.');
  }
  // Pairing is a separate human-only surface. Keep one selected QR visible.
  const lanCard = ui.h('section', 'bottle-lan-card');
  const lanHeader = ui.h('header', 'bottle-lan-header');
  const lanIntro = ui.h('div');
  lanIntro.append(ui.h('h3', null, zh ? '把信箱带在身边' : 'Take your mailbox with you'),
    ui.h('p', null, zh ? '手机扫一次码，就能随时翻信、确认寄出。' : 'Scan once to read letters and approve sending on your phone.'));
  const lanBadge = ui.h('span', 'bottle-lan-badge');
  lanHeader.append(lanIntro, lanBadge);
  const lanBody = ui.h('div', 'bottle-lan-body');
  const settings = ui.h('section', 'bottle-lan-settings');
  settings.append(ui.h('h4', null, zh ? '访问设置' : 'Access settings'));
  const enabledLabel = ui.h('label', 'bottle-lan-toggle');
  const enabled = ui.h('input'); enabled.type = 'checkbox';
  enabledLabel.append(enabled, ui.h('span', null, zh ? '允许其他设备访问' : 'Allow other devices'));
  const portLabel = ui.h('label', 'bottle-lan-field', zh ? '对外端口' : 'External port');
  const port = ui.h('input'); port.type = 'number'; port.min = '1'; port.max = '65535'; port.value = '7798'; portLabel.append(port);
  const addressLabel = ui.h('label', 'bottle-lan-field', zh ? '对外地址 · 可选' : 'Public address · optional');
  const address = ui.h('input'); address.type = 'url'; address.placeholder = 'http://192.168.1.10:7798/'; addressLabel.append(address);
  let lanDirty = false, lanBusy = false, resetArmed = false;
  for (const input of [enabled, port, address]) input.oninput = () => { lanDirty = true; };
  let lan: LanStatus | undefined;
  let pairingCards: Array<{ url: string; qr: string }> = [];
  let addressKey = '';
  let actionNote = '';
  const saveLan = ui.button(zh ? '保存访问设置' : 'Save access settings', { onClick: () => { void saveAccess(); } });
  saveLan.classList.add('bottle-lan-save');
  settings.append(enabledLabel, portLabel, addressLabel,
    ui.h('p', 'bottle-lan-help', zh ? '同一网络下通常留空；服务器部署时，填写手机可达的地址。' : 'Usually leave blank on the same network. For a server, enter an address reachable from your phone.'),
    saveLan,
    ui.h('p', 'bottle-lan-help', zh ? '保存后重启漂流瓶 World 生效。本机入口不受影响。' : 'Restart Bottle World after saving. Local access stays available.'));
  const pairing = ui.h('section', 'bottle-lan-pairing');
  pairing.append(ui.h('h4', null, zh ? '设备配对' : 'Pair a device'));
  const pickLabel = ui.h('label', 'bottle-lan-field', zh ? '手机可达的地址' : 'Address reachable from your phone');
  const pick = ui.h('select'); pickLabel.append(pick);
  const qrList = ui.h('div', 'bottle-lan-qr-list');
  const lanActions = ui.h('div', 'bottle-lan-actions');
  const pairButton = ui.button(zh ? '显示配对二维码' : 'Show pairing QR code', { variant: 'primary', onClick: () => {
    if (pairingCards.length) { pairingCards = []; drawPairing(); return; }
    void showPairing(false);
  } });
  pairButton.classList.add('bottle-lan-reveal');
  const resetButton = ui.button(zh ? '重置配对' : 'Reset pairing', { onClick: () => {
    if (!resetArmed) { resetArmed = true; resetButton.textContent = zh ? '确认让旧配对失效' : 'Confirm revocation'; return; }
    void showPairing(true);
  } });
  pairButton.disabled = true; resetButton.disabled = true;
  lanActions.append(pairButton, resetButton);
  const lanNote = ui.h('p', 'bottle-lan-feedback'); lanNote.setAttribute('role', 'status');
  pairing.append(pickLabel, qrList, lanActions, lanNote);
  lanBody.append(settings, pairing);
  const footer = ui.h('footer', 'bottle-lan-footer');
  footer.append(ui.h('p', 'bottle-lan-warning', zh
    ? 'HTTP 裸端口会明文传输信件与配对凭据，使用风险需自行承担；公网建议使用 HTTPS。二维码是信箱钥匙，请勿分享。'
    : 'HTTP sends letters and pairing credentials unencrypted, at your own risk. Use HTTPS on public networks. Keep your QR code private.'),
    ui.h('p', 'bottle-lan-help', zh ? '服务器需自行放行端口；这里不会改动防火墙或端口映射。' : 'Allow the port on your server. Firewall and port forwarding are not changed automatically.'));
  lanCard.append(lanHeader, lanBody, footer); ctx.root.append(lanCard);
  pick.onchange = () => { actionNote = ''; drawPairing(); };
  function drawPairing(): void {
    qrList.replaceChildren();
    const item = pairingCards.find(item => new URL(item.url).origin === new URL(pick.value || 'http://localhost').origin);
    if (item) {
      const figure = ui.h('figure', 'bottle-lan-qr');
      const img = ui.h('img'); img.src = item.qr; img.alt = zh ? '手机信箱配对二维码' : 'Mailbox pairing QR code'; img.width = img.height = 224;
      const caption = ui.h('figcaption', null, zh ? '用手机扫码，配对后会记住这台设备' : 'Scan with your phone. This device will be remembered.');
      const linkDetails = ui.h('details', 'bottle-lan-link');
      const link = ui.h('input'); link.type = 'text'; link.readOnly = true; link.value = item.url;
      link.setAttribute('aria-label', zh ? '配对链接（请勿分享）' : 'Private pairing link'); link.onclick = () => link.select();
      linkDetails.append(ui.h('summary', null, zh ? '查看配对链接' : 'View pairing link'), link);
      figure.append(img, caption, linkDetails); qrList.append(figure);
    } else {
      const empty = ui.h('div', 'bottle-lan-empty');
      empty.append(ui.h('span', null, zh ? '让信箱陪你走远一点' : 'Keep your mailbox close'),
        ui.h('p', null, lan?.running ? (zh ? '选好地址，再显示二维码' : 'Choose an address, then show the QR code') : (zh ? '开启访问并重启 World 后，即可扫码' : 'Enable access and restart World to pair')));
      qrList.append(empty);
    }
    pairButton.textContent = pairingCards.length ? (zh ? '收起二维码' : 'Hide QR code') : (zh ? '显示配对二维码' : 'Show pairing QR code');
    lanNote.textContent = actionNote;
  }
  function renderLan(): void {
    pairButton.disabled = !lan?.running || !lan.urls.length || lanBusy;
    resetButton.disabled = !lan?.running || lanBusy;
    if (!lanDirty) { enabled.checked = lan?.enabled ?? false; port.value = String(lan?.port ?? 7798); address.value = lan?.publicUrl ?? ''; }
    lanBadge.textContent = lan?.error ? (zh ? '暂不可用' : 'Unavailable') : lan?.running ? (zh ? '已开启' : 'Listening') : (zh ? '未开启' : 'Off');
    lanNote.textContent = lan?.error || actionNote || (lan?.enabled && !lan.running ? (zh ? '等待重启 World 后生效。' : 'Restart World to apply.') : '');
    const urls = lan?.urls ?? [];
    const key = JSON.stringify(urls);
    if (key !== addressKey) {
      const previous = pick.value;
      addressKey = key; pairingCards = []; pick.replaceChildren();
      for (const href of urls) { const option = ui.h('option', null, href); option.value = href; pick.append(option); }
      if (!urls.length) { const option = ui.h('option', null, zh ? '尚无可用地址' : 'No address available'); option.value = ''; pick.append(option); }
      pick.value = urls.includes(previous) ? previous : urls.find(href => href === lan?.publicUrl || /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(href)) ?? urls[0] ?? '';
      drawPairing();
    }
    pick.disabled = !lan?.running || !urls.length || lanBusy;
    if (!lan?.running && pairingCards.length) { pairingCards = []; drawPairing(); }
    lanNote.textContent = lan?.error || actionNote || (lan?.enabled && !lan.running ? (zh ? '等待重启 World 后生效。' : 'Restart World to apply.') : '');
  }
  async function saveAccess(): Promise<void> {
    if (lanBusy || ctx.signal.aborted) return;
    const value = Number(port.value), publicUrl = address.value.trim(), allow = enabled.checked;
    if (!Number.isInteger(value) || value < 1 || value > 65535 || value === 7797 || (publicUrl && !mailboxUrl(publicUrl))) {
      actionNote = zh ? '请检查端口（1—65535，避开 7797）和对外地址（仅支持 HTTP/HTTPS 根路径）。' : 'Check the port and HTTP/HTTPS root address.';
      lanNote.textContent = actionNote; return;
    }
    lanBusy = true; saveLan.disabled = true; renderLan();
    try {
      await ctx.setConfig('world:bottle', { 'worlds.bottle.lanEnabled': allow, 'worlds.bottle.lanPort': value, 'worlds.bottle.lanPublicUrl': publicUrl });
      if (!ctx.signal.aborted) { lanDirty = false; pairingCards = []; actionNote = zh ? '已保存，请重启漂流瓶 World 后扫码。' : 'Saved. Restart Bottle World, then scan.'; drawPairing(); }
    } catch { if (!ctx.signal.aborted) { actionNote = zh ? '未能保存，请稍后重试。' : 'Could not save. Please retry.'; lanNote.textContent = actionNote; } }
    finally { lanBusy = false; if (!ctx.signal.aborted) { saveLan.disabled = false; renderLan(); } }
  }
  async function showPairing(reset: boolean): Promise<void> {
    if (lanBusy || !lan?.running || ctx.signal.aborted) return;
    lanBusy = true; pairingCards = []; actionNote = zh ? '正在准备配对码…' : 'Preparing a pairing code…'; drawPairing(); renderLan();
    try {
      const result = await ctx.invoke<{ cards: Array<{ url: string; qr: string }> }>(reset ? 'resetPairing' : 'pairing');
      if (ctx.signal.aborted) return;
      pairingCards = result.cards.filter(item => item.qr.startsWith('data:image/png;base64,') && lan?.urls.some(href => new URL(href).origin === new URL(item.url).origin));
      actionNote = pairingCards.length ? (reset ? (zh ? '旧配对已失效，请重新扫码。' : 'Old pairings revoked. Scan again.') : '')
        : (zh ? '未找到可用配对地址，请检查访问设置。' : 'No pairing address available. Check access settings.');
      drawPairing();
    } catch { if (!ctx.signal.aborted) { actionNote = zh ? '未能取得配对码，请稍后重试。' : 'Could not obtain a pairing code. Please retry.'; drawPairing(); } }
    finally {
      lanBusy = false; resetArmed = false;
      if (!ctx.signal.aborted) { resetButton.textContent = zh ? '重置配对' : 'Reset pairing'; renderLan(); }
    }
  }
  mountDataManager(ctx);
  let pending = false;
  const refresh = async (): Promise<void> => {
    if (pending || ctx.signal.aborted) return;
    pending = true;
    try {
      const status = await ctx.invoke<{ version?: string; feedbackUrl?: string; botName?: string; url: string | null; links?: Array<{ href: string }>; wake?: WakeState | null; lan?: LanStatus;hostTheme?:{selectedId:string}|null }>('status');
      if (ctx.signal.aborted) return;
      // Extension settings deliberately use a generic label, not the pet's personal name.
      feedbackUrl = null;
      try {
        const target = new URL(status.feedbackUrl ?? '');
        if (target.protocol === 'https:' && target.hostname === 'docs.qq.com' && !target.username && !target.password) feedbackUrl = target.href;
      } catch { /* Older hosts may not yet expose the form. */ }
      feedback.disabled = !feedbackUrl;
      feedback.textContent = (zh ? '反馈收集 · ' : 'Feedback · ') + (status.version ? 'V' + status.version : (zh ? '版本暂不可用' : 'Version unavailable'));
      wake = status.wake ?? null;
      lan = status.lan;
      if (!lanBusy) renderLan();
      renderWake();
      let headerFailed = false;
      if (typeof ctx.refresh === 'function') {
        try { await ctx.refresh(); } catch { headerFailed = true; }
      }
      if (ctx.signal.aborted) return;
      url = reachableMailbox(status.links ?? (status.url ? [{ href: status.url }] : []), ctx.root.ownerDocument.defaultView?.location?.hostname);
      button.disabled = opening||!url;
      note.textContent = url ? t.ready + (headerFailed ? (zh ? ' 顶栏暂未同步，稍后会重试。' : ' Header sync failed; retrying shortly.') : '') : t.unavailable;
    } catch {
      if (!ctx.signal.aborted) {
        wake = null;
        lan = undefined; renderLan();
        controls.forEach(item => { item.toggle.disabled = true; item.save.disabled = true; });
        url = null;
        button.disabled = true;
        note.textContent = t.error;
      }
    } finally { pending = false; }
  };
  await refresh();
  if (!ctx.signal.aborted) ctx.interval(() => { void refresh(); }, 5000);
}

/** Dedicated human data card. Never send file contents through config, memo or logs. */
export function mountDataManager(ctx:WebUiPanelContext):void {
  const zh=ctx.language==='zh'||ctx.language==='zh-Hant',ui=ctx.ui;
  const card=ui.h('section','bottle-data-card');card.id='bottle-data-manager';
  const heading=ui.h('h3',null,zh?'数据迁移与备份':'Data migration and backup');
  const status=ui.h('p','bottle-data-note',zh?'正在检查本机保存方式…':'Checking local storage…');status.setAttribute('role','status');
  const check=ui.button(zh?'检查迁移状态':'Check migration',{onClick:()=>{void refreshData();}});
  const types=ui.h('fieldset','bottle-data-types');types.append(ui.h('legend',null,zh?'这次想带走什么':'Choose what to back up'));
  const labels:Record<string,string>=zh?{letters:'信件与回信',notes:'小纸条',system:'系统来信',drafts:'未寄草稿',stars:'星标',doodles:'自定义涂鸦',fonts:'自定义字体与笔迹',sounds:'自定义音效',theme:'主题与背景',preferences:'阅读与设备偏好'}:{letters:'Letters and replies',notes:'Short notes',system:'System letters',drafts:'Unsent drafts',stars:'Stars',doodles:'Custom doodles',fonts:'Custom fonts and assignments',sounds:'Custom sounds',theme:'Theme and background',preferences:'Reading and device preferences'};
  const checks=Object.entries(labels).map(([id,label])=>{const row=ui.h('label'),input=ui.h('input');input.type='checkbox';input.checked=true;input.value=id;row.append(input,ui.h('span',null,label));types.append(row);return input;});
  const actions=ui.h('div','bottle-data-actions');
  const exportButton=ui.button(zh?'导出备份':'Export backup',{variant:'primary',onClick:()=>{void run(async()=>{const selected=checks.filter(i=>i.checked).map(i=>i.value);await download(await invoke('export',selected));notice.textContent=zh?'备份已下载，请妥善保管。':'Backup downloaded. Keep it private.';});}});
  const picker=ui.h('input');picker.type='file';picker.hidden=true;picker.accept='.bottle-backup,.json,application/json,application/gzip';
  const importButton=ui.button(zh?'选择备份，先比较':'Choose backup and compare',{onClick:()=>picker.click()});
  const notice=ui.h('p','bottle-data-note');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  const comparison=ui.h('section','bottle-data-comparison');comparison.hidden=true;comparison.setAttribute('aria-label',zh?'导入前比较':'Compare before import');
  const saved=ui.h('details','bottle-data-saved');saved.append(ui.h('summary',null,zh?'本机保留的迁移与覆盖前备份':'Saved migration and replacement backups'));
  const savedList=ui.h('div','bottle-data-backups');saved.append(savedList);
  const soundArea=ui.h('div','bottle-data-sounds');
  actions.append(exportButton,importButton);
  card.append(heading,status,check,types,actions,picker,notice,comparison,
    ui.h('p','bottle-data-help',zh?'备份含明文正文，请勿随意转发。内置音效不重复打包；只存在手机或浏览器里的自选音效，请先在那台设备的信箱中点「收集本设备素材」。':'Backups contain plaintext letters. Built-in sounds are excluded. First collect browser-only custom sounds from the mailbox on that device.'),saved,soundArea);
  ctx.root.append(card);
  let busy=false,previewId:string|null=null,transferId:string|null=null;
  const invoke=<T=any>(method:string,input?:unknown)=>ctx.invoke<T>('data:'+method,input===undefined?[]:[input]);
  function disable(value:boolean):void{busy=value;card.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=value);checks.forEach(c=>c.disabled=value);card.setAttribute('aria-busy',String(value));}
  async function run(action:()=>Promise<void>):Promise<void>{if(busy||ctx.signal.aborted)return;disable(true);notice.textContent=zh?'正在处理，请稍候…':'Working…';try{await action();}catch(e){if(!ctx.signal.aborted)notice.textContent=e instanceof Error?e.message:(zh?'没有完成，原有数据仍保留。':'Could not complete. Existing data is preserved.');}finally{if(!ctx.signal.aborted)disable(false);}}
  function bytesToBase64(bytes:Uint8Array):string{let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
  async function download(item:{id:string;size:number;name:string;chunkBytes:number}):Promise<void>{
    transferId=item.id;const pieces:Uint8Array[]=[];let offset=0;
    try{while(offset<item.size){if(ctx.signal.aborted)throw Error('Cancelled');const result=await invoke<{data:string}>('download',{id:item.id,offset});const data=Uint8Array.from(atob(result.data),c=>c.charCodeAt(0));if(!data.length)throw Error('Download interrupted');pieces.push(data);offset+=data.length;notice.textContent=(zh?'正在下载备份 ':'Downloading backup ')+Math.round(offset/item.size*100)+'%';}
      const blob=new Blob(pieces as BlobPart[],{type:'application/gzip'}),href=URL.createObjectURL(blob),link=ui.h('a');link.href=href;link.download=item.name;link.hidden=true;card.append(link);link.click();link.remove();const resource=ctx.own({dispose:()=>URL.revokeObjectURL(href)});ctx.timeout(()=>resource.dispose(),1000);
    }finally{await invoke('cancel',{id:item.id}).catch(()=>{});transferId=null;}
  }
  async function refreshData():Promise<void>{
    try{const data=await invoke('status');if(ctx.signal.aborted)return;
      const migration=data.migration?.files?((zh?'；旧版 ':'; migrated ')+data.migration.files+(zh?' 份数据已迁入，迁移前备份已保留':' source files; original backup retained')):'';
      status.textContent=(zh?'当前使用 SQLite，信件共 ':'Using SQLite. Letters: ')+(data.counts?.total??0)+(zh?' 封':'')+migration;
      if(data.retainedSources?.length)status.textContent+=zh?'；少量旧文件尚未清理，当前以数据库为准。':'; some old files remain; the database is authoritative.';
      savedList.replaceChildren();
      for(const backup of data.backups??[]){const row=ui.h('div','bottle-data-backup-row'),text=ui.h('span',null,(backup.id.startsWith('migration-')?(zh?'迁移前备份':'Before migration'):(zh?'覆盖前备份':'Before replacement'))+' '+new Date(backup.at).toLocaleString());
        const get=ui.button(zh?'下载':'Download',{onClick:()=>{void run(async()=>{await download(await invoke('backup',{id:backup.id}));});}});
        let armed=false;const remove=ui.button(zh?'删除':'Delete',{onClick:()=>{if(!armed){armed=true;remove.textContent=zh?'再次点击，删除这份备份':'Click again to delete this backup';return;}void run(async()=>{await invoke('removeBackup',{id:backup.id});await refreshData();notice.textContent=zh?'这份本机备份已删除，当前信册未改动。':'Saved backup deleted. Current letters are unchanged.';});}});
        row.append(text,get,remove);savedList.append(row);
      }
      if(!data.backups?.length)savedList.append(ui.h('p',null,zh?'这里还没有保留的备份。':'No saved backups.'));
      soundArea.replaceChildren();if(data.sounds?.length){const label=ui.h('label',null,zh?'已保存的自定义音效':'Saved custom sounds'),select=ui.h('select');for(const sound of data.sounds){const option=ui.h('option',null,sound.name);option.value=sound.id;select.append(option);}label.append(select);soundArea.append(label);for(const kind of ['incoming','reply'])soundArea.append(ui.button(zh?(kind==='incoming'?'用于桌面来信':'用于桌面回信'):(kind==='incoming'?'Use for desktop incoming':'Use for desktop replies'),{onClick:()=>{void run(async()=>{await ctx.invoke('data:applySound',[{kind,id:select.value}]);notice.textContent=zh?'已用于下一次桌面提示，网页设备设置不变。':'Applied to future desktop notifications. Browser settings are unchanged.';});}}));}
    }catch(e){if(!ctx.signal.aborted)status.textContent=e instanceof Error?e.message:(zh?'无法读取保存状态，原数据未改动。':'Could not read storage status. Existing data is unchanged.');}
  }
  picker.onchange=()=>{const file=picker.files?.[0];picker.value='';if(!file)return;void run(async()=>{
    if(file.size>128*1024*1024)throw Error(zh?'请选择不超过 128 MiB 的备份。':'Choose a backup under 128 MiB.');
    if(previewId){await invoke('cancel',{id:previewId});previewId=null;}comparison.hidden=true;
    const upload=await invoke<{id:string;chunkBytes:number}>('begin',{size:file.size});transferId=upload.id;
    try{for(let offset=0;offset<file.size;offset+=upload.chunkBytes){const bytes=new Uint8Array(await file.slice(offset,offset+upload.chunkBytes).arrayBuffer());await invoke('chunk',{id:upload.id,offset,data:bytesToBase64(bytes)});notice.textContent=(zh?'正在读取备份 ':'Reading backup ')+Math.round((offset+bytes.length)/file.size*100)+'%';}
      const result=await invoke('preview',{id:upload.id});transferId=null;if(ctx.signal.aborted)return;previewId=result.id;showComparison(result);notice.textContent=zh?'文件已检查，尚未导入。请在下方选择使用哪份数据。':'File checked. Nothing imported yet. Choose how to use it below.';
    }catch(e){await invoke('cancel',{id:upload.id}).catch(()=>{});transferId=null;throw e;}
  });};
  function showComparison(data:any):void{
    comparison.replaceChildren();comparison.hidden=false;comparison.append(ui.h('h4',null,zh?'先看看两份信册':'Compare the two letterbooks'));
    const table=ui.h('table'),thead=ui.h('thead'),head=ui.h('tr');for(const text of [zh?'信件数量':'Letter count',zh?'本机现有':'Current',zh?'备份带来':'In backup'])head.append(ui.h('th',null,text));thead.append(head);table.append(thead);const body=ui.h('tbody');
    for(const [key,name]of Object.entries(zh?{sent:'寄出的信',received:'收到的信',reply:'收到的回信',system:'系统来信',total:'合计'}:{sent:'Sent',received:'Received',reply:'Replies',system:'System',total:'Total'})){const row=ui.h('tr');row.append(ui.h('th',null,name),ui.h('td',null,String(data.current[key])),ui.h('td',null,String(data.incoming[key])));body.append(row);}table.append(body);comparison.append(table);
    comparison.append(ui.h('p',null,(zh?'这次包含：':'Included: ')+(data.categories??[]).map((c:any)=>labels[c.id]??c.label).join('、')),
      ui.h('p','bottle-data-help',zh?'替换只影响备份包含的类别。正在处理的信件会保留；本机有草稿时不能用替换撤销原稿。':'Replacement affects only included categories. Active letters remain protected; existing drafts must be handled first.'));
    const backupLabel=ui.h('label','bottle-data-backup-choice'),backup=ui.h('input');backup.type='checkbox';backup.checked=true;backupLabel.append(backup,ui.h('span',null,zh?'替换前，先备份将被替换的数据':'Save the current data before replacement'));comparison.append(backupLabel);
    const buttons=ui.h('div','bottle-data-actions');
    buttons.append(ui.button(zh?'保留本机，不导入':'Keep current, cancel import',{onClick:()=>{void run(async()=>{await invoke('cancel',{id:previewId});previewId=null;comparison.hidden=true;notice.textContent=zh?'已保留本机数据，没有导入。':'Current data kept. Nothing imported.';});}}));
    for(const mode of ['merge','replace'])buttons.append(ui.button(zh?(mode==='merge'?'合并，本机已有优先':'使用备份，替换所选类别'):(mode==='merge'?'Merge, keep existing records':'Replace included categories'),{variant:mode==='merge'?'primary':undefined,onClick:()=>{void run(async()=>{const result=await invoke('confirm',{id:previewId,mode,backup:backup.checked});notice.textContent=result.message;previewId=null;comparison.hidden=true;await refreshData();});}}));
    comparison.append(buttons);comparison.tabIndex=-1;comparison.focus({preventScroll:true});
  }
  ctx.own({dispose:()=>{if(transferId)ctx.notifyOnUnmount?.('data:cancel',[{id:transferId}]);if(previewId)ctx.notifyOnUnmount?.('data:cancel',[{id:previewId}]);}});
  ctx.timeout(()=>{void refreshData();},0);
}

const bundle: WebUiClientBundle = { panels: { mailbox: { mount: mountMailbox } } };
export default bundle;
