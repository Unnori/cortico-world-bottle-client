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
    let pending = false;
    const refresh = async () => {
        if (pending || ctx.signal.aborted)
            return;
        pending = true;
        try {
            const status = await ctx.invoke('status');
            if (ctx.signal.aborted)
                return;
            url = mailboxUrl(status.url);
            button.disabled = !url;
            note.textContent = url ? t.ready : t.unavailable;
        }
        catch {
            if (!ctx.signal.aborted) {
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
