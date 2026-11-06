/** One sheet per letter. Text is rendered verbatim; interface labels stay outside the paper. */
export const stationeryScript = String.raw`
  function letterSheet(options) {
    var sheet = el('article', 'letter-sheet' + (options.own ? ' own-sheet' : ''));
    sheet.setAttribute('aria-label', options.topic || (options.own ? botName() + '写下的信' : '信笺正文'));
    var mark = el('div', 'letter-watermark');
    mark.setAttribute('aria-hidden', 'true');
    mark.appendChild(icon('waves'));
    sheet.appendChild(mark);
    var copy = el('div', 'letter-copy');
    if (options.topic) copy.appendChild(fontNode(el(options.heading || 'h3', 'mail-topic letter-title' + (options.heading === 'h2' ? ' title' : ''), options.topic), options.fontId, options.own));
    copy.appendChild(fontLetter(options.body, options.fontId, false, options.own));
    if (options.signature) copy.appendChild(fontNode(el('div', 'letter-signature', '—— ' + options.signature), options.fontId, options.own));
    sheet.appendChild(copy);
    return sheet;
  }
`;

export const stationeryStyles = `
  /* The mailbox holds paper; status and controls never become part of the letter. */
  #bottle-mailbox .mail-body { padding:16px clamp(12px,2vw,24px) 24px; background:transparent; }
  #bottle-mailbox .mail-body > .head { max-width:780px; padding:0 0 4px; margin:0 auto; gap:14px; flex-wrap:wrap; font-size:11px; }
  .letter-sheet { --letter-stock:var(--card); position:relative; isolation:isolate; min-width:0; max-width:780px; margin:18px auto 24px; padding:46px clamp(22px,4vw,44px) 32px; border:1px solid color-mix(in srgb,var(--edge) 48%,var(--card)); border-radius:2px 12px 3px 3px; color:var(--ink); background:repeating-linear-gradient(0deg,transparent 0 3px,color-mix(in srgb,var(--ink) 1.3%,transparent) 3px 4px),var(--letter-stock); box-shadow:0 2px 3px color-mix(in srgb,var(--backdrop) 10%,transparent),0 8px 20px color-mix(in srgb,var(--backdrop) 8%,transparent); }
  .letter-sheet::before { content:''; position:absolute; z-index:-1; inset:0; pointer-events:none; background:linear-gradient(90deg,transparent 49.7%,color-mix(in srgb,var(--ink) 2.5%,transparent) 50%,transparent 50.5%); }
  .letter-sheet::after { content:''; position:absolute; top:-1px; right:-1px; width:23px; height:23px; border-radius:0 10px 0 5px; background:linear-gradient(225deg,var(--panel) 47%,var(--edge) 49%,var(--letter-stock) 54%); opacity:.65; pointer-events:none; }
  .letter-sheet.own-sheet { --letter-stock:color-mix(in srgb,var(--card) 96%,var(--accent)); }
  .letter-watermark { display:flex; justify-content:center; margin:-28px 0 22px; color:color-mix(in srgb,var(--accent-text,var(--accent)) 50%,var(--muted)); }
  .letter-watermark .icon { width:34px; height:18px; stroke-width:1; }
  .letter-copy { max-width:620px; min-width:0; margin:0 auto; }
  #bottle-mailbox .letter-sheet .letter-title { margin:0 0 28px; padding:0; border:0; font:400 calc(var(--letter-size,26px) * 1.16)/1.55 Georgia,"Songti SC",serif; color:var(--ink); text-align:center; letter-spacing:.06em; white-space:pre-wrap; overflow-wrap:anywhere; text-wrap:pretty; }
  #bottle-mailbox .letter-sheet .letter { max-width:none; margin:0; padding:0; font-size:var(--letter-size,26px); line-height:1.95; letter-spacing:.025em; white-space:pre-wrap; overflow-wrap:anywhere; text-align:start; }
  #bottle-mailbox .letter-sheet .letter-signature { margin:28px 0 0; font-size:var(--letter-size,26px); line-height:1.8; text-align:end; letter-spacing:.02em; }
  #bottle-mailbox .reply-quote { max-width:780px; margin:26px auto 0; padding:0; border:0; border-radius:0; background:transparent; }
  .reply-quote-label { display:flex; align-items:center; justify-content:flex-start; gap:12px; font-size:12px; color:var(--muted); }
  .reply-quote-label::before,.reply-quote-label::after { content:''; flex:1; max-width:64px; border-top:1px solid var(--line); }
  .reply-quote-label::before { display:none; }
  .reply-quote-label::after { max-width:none; }
  .reply-quote > .letter-sheet { margin-top:14px; }
  #bottle-mailbox .mail-foot { max-width:780px; margin:20px auto 0; padding-top:14px; justify-content:flex-start; gap:10px 16px; }
  .mail-foot > .link { margin-left:auto; }
  #bottle-mailbox .original { margin:16px 0; padding:12px 0 0; background:transparent; border:0; border-top:1px solid var(--line); }
  .original > summary { color:var(--muted); font-size:12px; }
  .original > .letter-sheet { margin-top:16px; }
  .card > .letter-sheet { margin-top:18px; }
  .letter-sheet,.letter-watermark,.reply-quote-label { transition:background-color var(--motion) var(--ease),border-color var(--motion) var(--ease),color var(--motion) var(--ease),box-shadow var(--motion) var(--ease); }
  @media(max-width:560px) {
    #bottle-mailbox .mail-body { padding-left:10px; padding-right:10px; }
    #bottle-mailbox .mail-body > .head,#bottle-mailbox .mail-foot { margin-left:0; margin-right:0; }
    .letter-sheet { margin-top:16px; margin-bottom:22px; padding:42px 18px 28px; }
    .letter-watermark { margin-top:-20px; margin-bottom:18px; }
    #bottle-mailbox .letter-sheet .letter-title { margin-bottom:24px; letter-spacing:.03em; }
    #bottle-mailbox .letter-sheet .letter { line-height:1.85; letter-spacing:0; }
    #bottle-mailbox .letter-sheet .letter-signature { margin-top:24px; }
    #bottle-mailbox .card:has(> .letter-sheet) { padding-left:12px; padding-right:12px; }
    .card > :is(.eyebrow,.meta,.buttons,.hints,.hint) { margin-left:7px; margin-right:7px; }
  }
`;
