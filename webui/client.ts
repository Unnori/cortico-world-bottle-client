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
  const botName = zh ? '桌宠' : 'the companion';
  const button = ui.button(t.open, { variant: 'primary', onClick: () => {
    if (url && !ctx.signal.aborted) ctx.root.ownerDocument.defaultView?.open(url, '_blank', 'noopener,noreferrer');
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
  invitations.append(ui.h('p', 'bottle-wake-outcome', zh ? '写信、打捞默认每天各 3 次，间隔 2—24 小时并随机延长；待办提醒默认每天 12 次（可设 3—20 次），仅有待处理来信时每 30—60 分钟轻声提醒。包含自动补试，手动邀请不占上限。配置页顶栏为快照，信箱页签每 5 秒同步。' : 'Writing/catching default to 3/day, with a randomized 2–24 hour minimum. Reminders default to 12/day (3–20), every 30–60 minutes only while holding incoming mail. Retries count; manual invitations are separate. Header snapshots sync every 5 seconds on this tab.'));
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
      completed: '已经处理', deferred: botName + '选择暂不做', declined: '今天不再邀请', paused: '已按人的选择暂停',
      uncompleted: botName + '没有回应邀请…稍后再轻轻问一次。', failed: botName + '没有回应邀请…今天先不打扰了。', cancelled: '条件变化，已取消', interrupted: '重启中断，已延后',
    } : { completed: 'Completed', deferred: 'Deferred by the bot', declined: 'Declined for today', paused: 'Paused by the human',
      uncompleted: 'No result; one bounded retry', failed: 'Retry exhausted; stopped for today', cancelled: 'Conditions changed', interrupted: 'Interrupted by restart; delayed' };
    const active = wake?.active;
    if (active) {
      outcome.textContent = active.phase === 'retry'
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
  let pending = false;
  const refresh = async (): Promise<void> => {
    if (pending || ctx.signal.aborted) return;
    pending = true;
    try {
      const status = await ctx.invoke<{ version?: string; feedbackUrl?: string; botName?: string; url: string | null; links?: Array<{ href: string }>; wake?: WakeState | null; lan?: LanStatus }>('status');
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
      button.disabled = !url;
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

const bundle: WebUiClientBundle = { panels: { mailbox: { mount: mountMailbox } } };
export default bundle;
