/** Only the currently running loopback mailbox may be opened. */
export function mailboxUrl(value) {
    if (typeof value !== 'string')
        return null;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port &&
            !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
            ? url.href : null;
    }
    catch {
        return null;
    }
}
export async function mountMailbox(ctx) {
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
    let url = null;
    const button = ui.button(t.open, { variant: 'primary', onClick: () => {
            if (url && !ctx.signal.aborted)
                ctx.root.ownerDocument.defaultView?.open(url, '_blank', 'noopener,noreferrer');
        } });
    button.classList.add('bottle-open-mailbox');
    button.disabled = true;
    const note = ui.h('p', 'bottle-mailbox-note', t.loading);
    card.append(copy, button, note);
    ctx.root.append(card);
    const invitations = ui.h('section', 'bottle-wake-controls');
    invitations.append(ui.h('h3', null, zh ? '海边的邀请' : 'Seaside invitations'));
    const controls = ['write', 'catch', 'remind'].map(action => {
        const row = ui.h('div', 'bottle-wake-row');
        const label = ui.h('span');
        const toggle = ui.button(zh ? '稍等' : 'Loading', { onClick: () => { void changeWake(action); } });
        toggle.disabled = true;
        const hoursLabel = ui.h('label', 'bottle-wake-interval', zh ? '最短间隔（小时）' : 'Minimum interval (hours)');
        const hours = ui.h('input');
        hours.type = 'number';
        hours.min = '2';
        hours.max = '24';
        hours.step = '1';
        hours.value = '2';
        hoursLabel.append(hours);
        const save = ui.button(zh ? '调整' : 'Apply', { onClick: () => {
                const value = Number(hours.value);
                if (!Number.isFinite(value) || value < 2 || value > 24) {
                    outcome.textContent = zh ? '请填写 2—24 小时。' : 'Enter 2–24 hours.';
                    return;
                }
                void changeWake(action, value);
            } });
        row.append(label, hoursLabel, save, toggle);
        invitations.append(row);
        return { action, label, toggle, hours, save };
    });
    invitations.append(ui.h('p', 'bottle-wake-outcome', zh ? '实际时刻在最短间隔的 1—2 倍内随机，最长 24 小时；每类每天最多 3 次。配置页顶栏为快照，信箱页签每 5 秒同步。' : 'Random timing: 1–2× the minimum, capped at 24 hours; at most 3 per type daily. Header snapshots sync every 5 seconds on this tab.'));
    const outcome = ui.h('p', 'bottle-wake-outcome');
    invitations.append(outcome);
    ctx.root.append(invitations);
    let wake = null;
    let changing = false;
    async function changeWake(action, hours) {
        if (!wake || changing || ctx.signal.aborted)
            return;
        changing = true;
        controls.forEach(item => { item.toggle.disabled = true; item.save.disabled = true; });
        const lane = wake.lanes[action];
        try {
            const result = await ctx.invoke('wake', hours === undefined
                ? [action, lane.paused || lane.declined || lane.failed ? 'resume' : 'pause'] : [action, 'interval', hours]);
            if (result?.ok === false)
                throw new Error(result.message);
            if (!ctx.signal.aborted)
                await refresh();
        }
        catch {
            if (!ctx.signal.aborted)
                outcome.textContent = zh ? '暂时没能保存，请稍后再试。' : 'Could not save. Please retry.';
        }
        finally {
            changing = false;
            if (!ctx.signal.aborted)
                controls.forEach(item => { item.toggle.disabled = !wake?.lanes[item.action]; item.save.disabled = !wake?.lanes[item.action]; });
        }
    }
    function renderWake() {
        controls.forEach(({ action, label, toggle, hours, save }) => {
            const lane = wake?.lanes[action];
            const name = action === 'write' ? (zh ? '写信邀请' : 'Writing') : action === 'catch' ? (zh ? '打捞邀请' : 'Catching') : (zh ? '待办提醒' : 'Reminders');
            label.textContent = name + (lane ? (zh ? ' · 今天邀请 ' + lane.count + ' 次' : ' · ' + lane.count + ' today') : '');
            toggle.textContent = lane?.paused || lane?.declined || lane?.failed ? (zh ? '恢复邀请' : 'Resume') : (zh ? '暂停邀请' : 'Pause');
            toggle.disabled = !lane || changing;
            save.disabled = !lane || changing;
            if (ctx.root.ownerDocument.activeElement !== hours)
                hours.value = String(lane?.intervalHours ?? 2);
        });
        const last = wake?.history.at(-1);
        const labels = zh ? {
            completed: '已经处理', deferred: '它选择暂不做', declined: '今天不再邀请', paused: '已按人的选择暂停',
            uncompleted: '这一轮没有结果，将有限重试', failed: '重试后仍未完成，今天不再邀请', cancelled: '条件变化，已取消', interrupted: '重启中断，已延后',
        } : { completed: 'Completed', deferred: 'Deferred by the bot', declined: 'Declined for today', paused: 'Paused by the human',
            uncompleted: 'No result; one bounded retry', failed: 'Retry exhausted; stopped for today', cancelled: 'Conditions changed', interrupted: 'Interrupted by restart; delayed' };
        const active = wake?.active;
        if (active) {
            outcome.textContent = active.phase === 'retry'
                ? (zh ? '上一轮没有结果，稍后只补试一次。' : 'No result in the last turn; one retry is scheduled.')
                : (zh ? '已有一份邀请在等它选择，写不写、捞不捞都由它。' : 'One invitation is pending. The bot may still decline.');
            return;
        }
        const result = last?.result === 'deferred' && last.reason === 'no_idea' ? (zh ? '它暂时没有灵感，已选择暂不做；不算失败，也不补试' : 'No inspiration right now; voluntarily deferred, not a failure or retry') : last?.reason === 'reminder_delivered' ? (zh ? '提醒已送达，是否询问由它决定' : 'Reminder delivered; the bot chooses whether to ask') : last?.reason === 'queue_failed' ? (zh ? '邀请未能送达，今天不再尝试' : 'Could not deliver; stopped for today') : last ? (labels[last.result] ?? last.result) : '';
        outcome.textContent = last ? (zh ? (last.action === 'write' ? '最近的写信邀请：' : last.action === 'catch' ? '最近的打捞邀请：' : '最近的待办提醒：') : 'Last result: ') + result
            : (zh ? '有想说或想听的时候再做，小感受也值得写；不必为邀请勉强。' : 'An invitation, not an obligation. No letter is better than filler.');
    }
    let pending = false;
    const refresh = async () => {
        if (pending || ctx.signal.aborted)
            return;
        pending = true;
        try {
            const status = await ctx.invoke('status');
            if (ctx.signal.aborted)
                return;
            wake = status.wake ?? null;
            renderWake();
            let headerFailed = false;
            if (typeof ctx.refresh === 'function') {
                try {
                    await ctx.refresh();
                }
                catch {
                    headerFailed = true;
                }
            }
            if (ctx.signal.aborted)
                return;
            url = mailboxUrl(status.url);
            button.disabled = !url;
            note.textContent = url ? t.ready + (headerFailed ? (zh ? ' 顶栏暂未同步，稍后会重试。' : ' Header sync failed; retrying shortly.') : '') : t.unavailable;
        }
        catch {
            if (!ctx.signal.aborted) {
                wake = null;
                controls.forEach(item => { item.toggle.disabled = true; item.save.disabled = true; });
                url = null;
                button.disabled = true;
                note.textContent = t.error;
            }
        }
        finally {
            pending = false;
        }
    };
    await refresh();
    if (!ctx.signal.aborted)
        ctx.interval(() => { void refresh(); }, 5000);
}
const bundle = { panels: { mailbox: { mount: mountMailbox } } };
export default bundle;
