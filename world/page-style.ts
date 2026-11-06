import { stationeryStyles } from './page-stationery.ts';
import { starStyles } from './page-stars.ts';
import { readerStyles } from './page-reader.ts';
import { slipGeometry, slipLayout } from './page-slip.ts';
import { paletteDeclarations } from './appearance.ts';
/** 信纸、邮戳与海水色；网页布局独立于 Windows 原生卡片。 */
export const pageStyles = `
  :root {
    ${paletteDeclarations('ocean', 'light')}

       --edge:#afbdd4; --focus:#588fc1;
      --tint:#e8eef8; --active:#dfe7fa; --active-line:#afbfdf; --sea-soft:#e3f0f4;
     --on-sea:#fff; --wash-a:#c8def455; --wash-b:#dcdff622;

    --info-bg:#e9f2f8; --info-text:#3e6178; --danger-bg:#f9e9e7;
    --backdrop:#17254366; --shadow:0 3px 8px #20366104,0 18px 50px #20366109;
    --motion:280ms; --ease:cubic-bezier(.2,.7,.2,1);
    --rule:1px solid var(--line); --rule-dash:1px dashed var(--line);
    --serif:Georgia,"Songti SC","Noto Serif CJK SC","Source Han Serif SC",serif;
    --slip-stock:linear-gradient(178deg,#fff9dc 0%,#fdf1c4 100%); --slip-ink:#5a4520; --slip-fold-color:#f1dda2;
  }
  :root[data-theme="paper"] {
    ${paletteDeclarations('paper', 'light')}

       --edge:#b59a6b; --focus:#885c24;
      --tint:#eaddbc; --active:#ead3a7; --active-line:#bca06c; --sea-soft:#e7e0c3;
    --wash-a:#eacb8590; --wash-b:#dfcba455; --backdrop:#352f2859;
    --shadow:0 3px 5px #59452a04,0 18px 50px #59452a09;
  }
  :root[data-theme="epistle"] {
    ${paletteDeclarations('epistle', 'light')}

       --edge:#cbc2b1; --focus:#5a68ac;
      --tint:#eeebe0; --active:#eae4d2; --active-line:#c9bfa7; --sea-soft:#e3ebe4;
     --on-sea:#fff; --wash-a:#dfe2f022; --wash-b:#ecdccc11;
    --backdrop:#22202e66; --shadow:0 2px 4px #2c2a4210,0 22px 60px #2c2a4212;
    --rule:1px solid var(--line); --rule-dash:1px dashed var(--edge);
  }
  :root[data-appearance="dark"] {
    ${paletteDeclarations('ocean', 'dark')}
    color-scheme:dark;

       --edge:#667d9e; --focus:#9ed3e5;
      --tint:#293750; --active:#34476b; --active-line:#6f87b3; --sea-soft:#233e4c;
     --on-sea:#142c36; --wash-a:#638ecc12; --wash-b:#8290c90d;

    --info-bg:#243643; --info-text:#b2d4e8; --danger-bg:#43292f;
    --backdrop:#080c1699; --shadow:0 4px 14px #00000016,0 20px 50px #00000022;
  }
  :root[data-theme="paper"][data-appearance="dark"] {
    ${paletteDeclarations('paper', 'dark')}

       --edge:#a78a5f; --focus:#e6bc78;
      --tint:#3a3026; --active:#49392c; --active-line:#947350; --sea-soft:#393b26;
     --on-sea:#28281a; --wash-a:#e6bc7814; --wash-b:#c5c18c0c;
  }
  :root[data-theme="epistle"][data-appearance="dark"] {
    ${paletteDeclarations('epistle', 'dark')}

       --edge:#55546a; --focus:#aab6f2;
      --tint:#26262d; --active:#2e2e38; --active-line:#4a4960; --sea-soft:#253430;
     --on-sea:#16241f; --wash-a:#aab6f20c; --wash-b:#e89a8f08;
    --backdrop:#05050a99; --shadow:0 2px 4px #00000018,0 22px 60px #00000026;
    --slip-stock:linear-gradient(178deg,#2e2b24 0%,#292620 100%); --slip-ink:#f2e6c6; --slip-fold-color:#4a402c;
  }
  :root[data-theme="coopanion"][data-host-theme="true"] {
    --paper:var(--host-paper); --card:var(--host-sheet); --panel:var(--host-sheet-2); --soft:var(--host-sheet-3);
    --ink:var(--host-ink); --muted:var(--host-ink-soft); --line:var(--host-line); --edge:var(--host-line-strong);
    --accent:var(--host-accent); --seal:var(--host-accent); --sea:var(--host-ink-blue); --focus:var(--host-accent);
    --on-accent:var(--host-on-accent); --on-sea:var(--host-ink);
    --tint:var(--host-sheet-3); --active:color-mix(in srgb,var(--accent) 14%,var(--card));
    --active-line:color-mix(in srgb,var(--accent) 50%,var(--line)); --sea-soft:var(--host-sheet-2);
    --wash-a:transparent; --wash-b:transparent;
    --warning-bg:color-mix(in srgb,var(--host-warn) 12%,var(--card)); --warning-line:color-mix(in srgb,var(--host-warn) 35%,var(--line)); --warning-text:var(--host-warn);
    --info-bg:var(--host-sheet-2); --info-text:var(--host-ink-blue);
    --danger-bg:color-mix(in srgb,var(--host-danger) 12%,var(--card)); --danger-text:var(--host-danger);
  }
  :root[data-theme="custom"] { --edge:var(--line); --focus:var(--accent); --tint:var(--soft); --active:var(--soft); --active-line:var(--accent); --sea-soft:var(--soft); --on-sea:var(--on-accent); --info-bg:var(--soft); --info-text:var(--sea); --wash-a:transparent; --wash-b:transparent; }
  body#bottle-mailbox { isolation:isolate; }
  #mailbox-scenery { position:fixed; inset:0; z-index:-1; pointer-events:none; opacity:0; transition:opacity 360ms var(--ease); }
  :root[data-background-visible="true"] #mailbox-scenery { opacity:var(--background-opacity,.18); }
  .background-layer { position:absolute; inset:0; background-size:cover; background-position:center; opacity:0; transition:opacity 420ms var(--ease); }
  .background-layer.visible { opacity:1; }
  * { box-sizing:border-box; }
  html { color-scheme:light; }
  body#bottle-mailbox { margin:0; background:radial-gradient(ellipse at 80% 0%,var(--wash-a),transparent 45%),radial-gradient(ellipse at 0% 45%,var(--wash-b),transparent 50%),var(--paper); color:var(--ink); font:15px/1.65 "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; padding:0 32px 48px; }
  button,input,select { font:inherit; }
  button { cursor:pointer; }
  button:disabled { cursor:default; opacity:.48; }
  button:focus-visible,summary:focus-visible,input:focus-visible { outline:3px solid var(--focus); outline-offset:4px; }
  [hidden] { display:none!important; }
  .shell { max-width:1160px; margin:auto; }
  .masthead { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:24px 0; border-bottom:1px solid var(--line); }
  .brand { min-width:0; display:flex; align-items:center; gap:12px; }
  .brand-mark { flex:none; display:grid; place-items:center; width:48px; height:48px; color:var(--accent-text,var(--accent)); }
  .brand-mark img { display:block; width:100%; height:100%; object-fit:contain; }
  .brand h1 { margin:0; font:600 19px Georgia,"Songti SC",serif; letter-spacing:.15em; }
  .brand small { display:block; margin-top:4px; font-size:9px; letter-spacing:.23em; color:var(--muted); }
  .masthead .sub { font-size:12px; letter-spacing:.12em; color:var(--muted); }
  .icon { width:24px; height:24px; flex:none; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
  .hero { display:grid; grid-template-columns:1fr 300px; gap:24px; align-items:center; padding:42px 12px 28px; }
  .eyebrow { font-size:11px; letter-spacing:.17em; color:var(--accent-text,var(--accent)); margin-bottom:12px; }
  .hero h2 { margin:0 0 14px; font:400 clamp(27px,3.5vw,40px)/1.45 Georgia,"Songti SC",serif; letter-spacing:.06em; }
  .hero p { margin:0; color:var(--muted); font-size:14px; }
  .hero-art { position:relative; height:175px; display:grid; place-items:center; pointer-events:none; }
  .envelope-art { width:225px; height:138px; position:relative; border:1px solid var(--line); border-radius:5px; background:linear-gradient(148deg,transparent 49.5%,var(--soft) 50%,transparent 50.5%),linear-gradient(32deg,var(--soft) 49.5%,var(--edge) 50%,var(--card) 50.5%); box-shadow:0 18px 25px color-mix(in srgb,var(--ink) 12%,transparent); transform:rotate(-8deg); animation:arrive .8s ease both; }
  .envelope-art::before { content:''; position:absolute; width:190px; height:100px; top:-29px; left:16px; background:repeating-linear-gradient(transparent 0 18px,color-mix(in srgb,var(--line) 70%,transparent) 18px 19px),var(--card); border:1px solid var(--line); transform:rotate(4deg); z-index:-1; }
  .wax { position:absolute; left:92px; top:48px; width:39px; height:39px; border-radius:48% 52% 45% 55%; background:var(--seal); box-shadow:inset 0 0 0 4px #ffffff12,0 3px 5px color-mix(in srgb,var(--ink) 12%,transparent); display:grid; place-items:center; color:var(--on-accent); }
  .postmark { position:absolute; right:0; top:10px; border:2px solid color-mix(in srgb,var(--sea) 40%,transparent); border-radius:50%; width:86px; height:86px; display:grid; place-content:center; text-align:center; color:var(--accent-text,var(--sea)); font-size:10px; line-height:1.9; letter-spacing:.12em; transform:rotate(12deg); }
  .postmark b { font:21px Georgia,serif; }
  .hero-wave { position:absolute; bottom:0; right:12px; width:130px; height:30px; color:var(--accent-text,var(--sea)); }
  .toolbar { display:flex; align-items:center; gap:16px; padding:0 12px 28px; flex-wrap:wrap; }
  .toolbar .actions { margin:0; gap:12px; }
  .action-main { display:flex; align-items:center; gap:13px; border:1px solid transparent; border-radius:12px; padding:15px 23px; background:var(--seal); color:var(--on-accent); text-align:left; box-shadow:0 5px 0 color-mix(in srgb,var(--accent) 18%,transparent),0 9px 22px color-mix(in srgb,var(--accent) 18%,transparent); transition:transform .22s,box-shadow .22s,background .22s; }
  .action-main.catch { background:var(--sea); box-shadow:0 5px 0 color-mix(in srgb,var(--sea) 15%,transparent),0 9px 22px color-mix(in srgb,var(--sea) 15%,transparent); }
  .action-main strong { display:block; font-size:16px; font-weight:600; letter-spacing:.08em; }
  .action-main small { display:block; font-size:10px; margin-top:2px; opacity:.8; letter-spacing:.04em; }
  .action-main .icon { width:28px; height:28px; transition:transform .3s; }
  .action-main:hover:not(:disabled) { transform:translateY(-3px); box-shadow:0 12px 24px color-mix(in srgb,var(--ink) 12%,transparent); }
  .action-main:hover:not(:disabled) .icon { transform:rotate(-9deg); }
  .action-main:active:not(:disabled) { transform:translateY(1px); }
  #action-note { margin:0; max-width:250px; color:var(--muted); font-size:12px; }
  .tide { display:flex; gap:8px; flex-wrap:wrap; }
  .chip { font-size:11px; color:var(--muted); border:1px solid var(--line); background:var(--panel); border-radius:6px; padding:5px 10px; }
  .chip b { color:var(--ink); font-weight:600; }
  .chip.spent { color:var(--accent-text,var(--seal)); }
  .desk { padding:25px 0 30px; border-top:1px solid var(--line); }
  .section-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
  .section-heading h2 { font-size:14px; font-weight:500; letter-spacing:.1em; margin:0; }
  .section-heading h2::before { content:''; display:inline-block; width:6px; height:6px; background:var(--accent); border-radius:50%; margin-right:10px; vertical-align:middle; }
  #stage { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr)); gap:20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:5px 16px 16px 16px; box-shadow:var(--shadow); padding:28px 30px; position:relative; overflow:hidden; }
  .card::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--edge); }
  .title { margin:0 0 18px; font:500 21px/1.5 Georgia,"Songti SC",serif; overflow-wrap:anywhere; }
  .letter, .letter.small { font:var(--letter-size,26px)/1.85 Georgia,"Songti SC","Noto Serif CJK SC",serif; white-space:pre-wrap; overflow-wrap:anywhere; padding:18px 0 24px; max-width:680px; margin-inline:auto; text-align:start; }
  .letter-signature { font:var(--letter-size,26px)/1.85 Georgia,"Songti SC","Noto Serif CJK SC",serif; color:var(--ink); max-width:680px; margin:0 auto 20px; text-align:end; overflow-wrap:anywhere; white-space:pre-wrap; }
  .meta { margin-top:12px; color:var(--muted); font-size:12px; display:flex; gap:12px; flex-wrap:wrap; }
  .actions { display:flex; align-items:center; gap:10px; margin-top:22px; flex-wrap:wrap; }
  .btn { border:1px solid var(--ink); background:var(--ink); color:var(--paper); border-radius:8px; padding:10px 20px; font-size:13px; transition:transform .2s,box-shadow .2s; }
  .btn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 6px 14px color-mix(in srgb,var(--ink) 12%,transparent); }
  .btn.seal { color:var(--on-accent); background:var(--seal); border-color:var(--accent-text,var(--seal)); }
  .btn.ghost { background:transparent; border-color:var(--line); color:var(--accent-text,var(--accent)); }
  button[aria-busy=true] { opacity:.6; cursor:wait; }
  button[aria-busy=true]::after { content:''; width:10px; height:10px; display:inline-block; margin-left:7px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin .8s linear infinite; }
  .empty { padding:12px 4px; color:var(--muted); text-align:center; font-size:13px; }
  .empty .big { font:23px/1.5 Georgia,"Songti SC",serif; color:var(--ink); margin:8px 0; }
  .empty .icon { display:block; width:45px; height:45px; margin:0 auto 14px; color:var(--accent-text,var(--accent)); }
  .empty-mail { padding:50px 20px; border:1px dashed var(--line); border-radius:12px; background:var(--panel); }
  .notice { border:1px solid color-mix(in srgb,var(--sea) 28%,var(--line)); border-left:3px solid var(--sea); background:var(--sea-soft); padding:12px 18px; border-radius:8px; margin-bottom:18px; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; }
  .announcement { display:flex; align-items:flex-start; gap:14px; }
  .announcement-content { flex:1; min-width:0; }
  #bottle-mailbox .announcement-close { display:grid; place-items:center; flex:none; width:28px; height:28px; padding:0; border:1px solid currentColor; border-color:color-mix(in srgb,currentColor 25%,transparent); border-radius:50%; color:inherit; background:transparent; line-height:0; opacity:.75; transition:opacity 180ms var(--ease),background-color 180ms var(--ease),transform 180ms var(--ease); }
  .announcement-close svg { display:block; width:14px; height:14px; }
  #bottle-mailbox .announcement-close:hover { opacity:1; background:color-mix(in srgb,currentColor 8%,transparent); }
  .announcement-close:focus-visible { outline:2px solid var(--focus); outline-offset:3px; }
  .notice a { color:inherit; text-decoration:underline; text-underline-offset:3px; text-decoration-thickness:1px; border-radius:2px; transition:opacity 180ms var(--ease); }
  .notice a:hover { opacity:.75; }
  .notice a:focus-visible { outline:2px solid var(--focus); outline-offset:3px; }
  .notice.alarm { border-color:var(--warning-line); background:var(--warning-bg); }
  .hints { display:grid; gap:8px; margin-top:12px; }
  .hint { font-size:12px; color:var(--warning-text); background:var(--warning-bg); border:1px solid var(--warning-line); border-radius:8px; padding:10px 12px; }
  .hint.local { color:var(--info-text); background:var(--info-bg); }
  .hint.spent { color:var(--danger-text); background:var(--danger-bg); }
  summary { cursor:pointer; }
  .original { margin:0 0 15px; padding:10px 14px; background:var(--soft); border:1px solid var(--line); border-radius:8px; font-size:12px; color:var(--accent-text,var(--accent)); }
  .book { border:1px solid var(--line); border-radius:18px; background:var(--panel); box-shadow:var(--shadow); overflow:hidden; }
  .book > summary { display:flex; align-items:center; gap:12px; list-style:none; padding:23px 28px; background:var(--tint); }
  .book > summary::-webkit-details-marker,.mail > summary::-webkit-details-marker { display:none; }
  .book-title { font:500 22px Georgia,"Songti SC",serif; letter-spacing:.1em; }
  .book-count { color:var(--muted); font-size:12px; margin-left:auto; }
  .fold-label { color:var(--accent-text,var(--accent)); font-size:11px; padding-left:12px; }
  .fold-label::after { content:'展开 ↓'; }
  .book[open] .fold-label::after { content:'收起 ↑'; }
  .book-layout { display:grid; grid-template-columns:218px minmax(0,1fr); }
  .mail-folders { padding:24px 16px; border-right:1px solid var(--line); background:var(--tint); }
  .folder-label { font-size:10px; letter-spacing:.2em; margin:0 12px 16px; color:var(--muted); }
  .folder { width:100%; display:flex; align-items:center; gap:10px; border:1px solid transparent; background:transparent; color:var(--muted); border-radius:9px; padding:13px 12px; text-align:left; margin-bottom:6px; transition:background .2s,color .2s,transform .2s; }
  .folder .icon { width:19px; height:19px; }
  .folder span { font-size:13px; }
  .folder b { margin-left:auto; font:12px Georgia,serif; padding:1px 6px; border-radius:4px; background:var(--tint); }
  .folder:hover { background:var(--tint); transform:translateX(2px); }
  .folder[aria-pressed=true] { color:var(--accent-text,var(--seal)); border-color:var(--active-line); background:var(--active); font-weight:600; }
  .folder[data-category=seed][aria-pressed=true] { color:var(--accent-text,var(--sea)); background:var(--sea-soft); border-color:color-mix(in srgb,var(--sea) 28%,var(--line)); }
  .folder-note { color:var(--muted); font:13px/1.9 Georgia,"Songti SC",serif; border-top:1px solid var(--line); padding-top:20px; margin:24px 12px 0; }
  .mail-content { padding:25px 28px 30px; min-width:0; }
  .book-tools { display:flex; justify-content:space-between; gap:14px; align-items:center; flex-wrap:wrap; padding-bottom:20px; border-bottom:1px solid var(--line); }
  .book-tools h3 { margin:0 0 3px; font-size:17px; font-weight:500; }
  .book-tools p { margin:0; font-size:11px; color:var(--muted); }
  .date-tools { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .date-tools label { color:var(--muted); font-size:11px; }
  .archive-date { position:relative; display:inline-flex; align-items:center; justify-content:space-between; gap:12px; min-width:146px; min-height:44px; max-width:100%; padding:9px 12px; color:var(--ink); border:1px solid var(--line); border-radius:7px; background:var(--card); font-size:12px; cursor:pointer; transition:border-color var(--motion) var(--ease),background var(--motion) var(--ease); }
  .archive-date:hover { border-color:var(--edge); background:var(--soft); }
  .archive-date:focus-within { outline:2px solid var(--focus); outline-offset:3px; }
  .archive-date-icon { width:16px; height:16px; flex:none; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; color:var(--muted); }
  .archive-date input[type=date] { position:absolute; z-index:1; inset:0; width:100%; height:100%; margin:0; padding:0; border:0; opacity:0; cursor:pointer; }
  .archive-date input[type=date]::-webkit-calendar-picker-indicator { position:absolute; inset:0; width:100%; height:100%; margin:0; padding:0; cursor:pointer; }
  @media(prefers-reduced-motion:reduce) { .archive-date { transition:none; } }
  .day-heading { display:flex; align-items:center; gap:12px; color:var(--muted); font-size:11px; font-weight:400; margin:24px 0 12px; }
  .day-heading::after { content:''; flex:1; border-top:1px solid var(--line); }
  .day-heading b { font-weight:500; color:var(--accent-text,var(--accent)); }
  .mail { background:var(--card); border:1px solid var(--line); border-radius:10px; margin-bottom:12px; overflow:hidden; transition:box-shadow .25s,border-color .25s; }
  .mail:hover { border-color:var(--edge); box-shadow:0 6px 18px color-mix(in srgb,var(--ink) 6%,transparent); }
  .mail > summary { display:flex; list-style:none; align-items:center; gap:14px; padding:18px; }
  .mail-symbol { width:40px; height:46px; display:grid; place-items:center; background:var(--soft); color:var(--accent-text,var(--accent)); border:1px solid var(--line); border-radius:4px; flex:none; }
  .mail.seed .mail-symbol { background:var(--sea-soft); color:var(--accent-text,var(--sea)); border-style:dashed; border-color:color-mix(in srgb,var(--sea) 28%,var(--line)); }
  .mail-subject { min-width:0; flex:1; }
  .mail-subject strong { display:block; font:16px/1.5 Georgia,"Songti SC",serif; overflow-wrap:anywhere; }
  .mail-subject small { display:block; color:var(--muted); font-size:11px; margin-top:4px; }
  @media(max-width:560px) {
    .mail > summary { display:grid; grid-template-columns:32px minmax(0,1fr) 12px; }
    .mail-symbol { grid-column:1; grid-row:1; }
    .mail-subject { grid-column:2; grid-row:1; }
    .mail-chevron { grid-column:3; grid-row:1; }
    .mail > summary > .mail-badges { grid-column:2/-1; grid-row:2; max-width:100%; }
  }
  .mail-badges { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
  .mail-status { display:inline-block; flex-shrink:0; max-width:150px; border-radius:999px; padding:2px 9px; font:10.5px/1.6 system-ui,sans-serif; letter-spacing:.04em; overflow-wrap:anywhere; }
  .status-replied { color:#246743; background:#e4f1e8; }
  .status-drifting { color:#32667c; background:#e7f0f5; }
  .status-picked { color:#855719; background:#faf0d9; }
  .status-tsunami { color:#954239; background:#f7e6e2; }
  .status-sunk { color:#665c72; background:#eeeaf2; }
  .mail-chevron { color:var(--muted); transition:transform .25s; font-size:18px; }
  .mail[open] .mail-chevron { transform:rotate(90deg); }
  #bottle-mailbox .mail-body { padding:4px 24px 22px; border-top:1px dashed var(--line); }
  #bottle-mailbox .mail[open] .mail-body { animation:unfold .25s ease; }
  .mail .head { display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:11px; color:var(--muted); padding-top:16px; }
  .mail .mail-topic { font:18px Georgia,"Songti SC",serif; margin:15px 0 4px; }
  .reply-quote { border-left:2px solid var(--edge); padding:8px 14px; background:var(--soft); margin:12px 0; border-radius:0 6px 6px 0; }
  .mail-body > .reply-quote { max-width:680px; margin-inline:auto; }
  .mail-body > .mail-topic { max-width:680px; margin-inline:auto; }
  .reply-quote-label { font-size:11px; color:var(--accent-text,var(--accent)); }
  .mail-foot { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding-top:14px; border-top:1px solid var(--line); }
  .mail-actions { display:flex; align-items:center; gap:10px; }
  .link { border:0; background:none; color:var(--accent-text,var(--accent)); padding:4px 0; font-size:12px; text-decoration:underline; text-underline-offset:4px; }
  .link:hover { color:var(--accent-text,var(--seal)); }
  .link.mini { font-size:11px; color:var(--muted); }
  .read-together { border:1px solid color-mix(in srgb,var(--sea) 28%,var(--line)); background:var(--sea-soft); color:var(--accent-text,var(--sea)); border-radius:6px; padding:7px 12px; font-size:12px; transition:background .2s; }
  .read-together:hover { background:var(--sea-soft); }
  .foot { margin:30px auto 0; color:var(--muted); font-size:11px; text-align:center; line-height:2; }
  .foot details { margin-top:12px; }
  .foot code { font-size:10px; overflow-wrap:anywhere; }
  .toast { position:fixed; z-index:10; left:50%; bottom:25px; transform:translate(-50%,12px); padding:12px 22px; background:var(--ink); color:var(--paper); border-radius:10px; box-shadow:0 6px 24px color-mix(in srgb,var(--ink) 12%,transparent); font-size:13px; max-width:min(90vw,540px); width:max-content; opacity:0; pointer-events:none; transition:opacity .2s,transform .2s; }
  .toast.on { opacity:1; transform:translate(-50%,0); }
  .toast.bad { background:var(--seal); }
  .enter { animation:arrive .5s ease both; }
  @keyframes arrive { from { opacity:0; translate:0 10px; } to { opacity:1; translate:0 0; } }
  @keyframes unfold { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media(max-width:800px) { body#bottle-mailbox { padding:0 20px 32px; } .hero { grid-template-columns:1fr 210px; padding:30px 0; } .hero-art { transform:scale(.8); transform-origin:right center; } .toolbar { padding-left:0; padding-right:0; } .book-layout { grid-template-columns:170px minmax(0,1fr); } .mail-folders { padding:20px 10px; } .mail-content { padding:20px; } }
  @media(max-width:560px) { body#bottle-mailbox { padding:0 14px 30px; } .masthead { padding:19px 0; } .masthead .sub { font-size:10px; } .hero { grid-template-columns:1fr; padding:26px 3px 22px; } .hero-art { display:none; } .hero h2 { font-size:29px; } .toolbar { gap:12px; } .toolbar .actions { width:100%; display:grid; grid-template-columns:1fr 1fr; } .action-main { padding:14px 13px; gap:10px; } .action-main small { font-size:9px; } #action-note { max-width:none; } .desk { padding-top:20px; } .card { padding:23px 20px; } .book > summary { padding:18px; flex-wrap:wrap; gap:8px; } .book-title { font-size:20px; } .book-count { font-size:10px; } .fold-label { padding:0; } .book-layout { display:block; } .mail-folders { border-right:0; border-bottom:1px solid var(--line); display:grid; grid-template-columns:1fr 1fr; padding:12px; gap:5px; } .folder { margin:0; padding:10px; gap:7px; } .folder-label,.folder-note { display:none; } .mail-content { padding:18px 14px; } .mail > summary { padding:14px 12px; gap:10px; } .mail-subject strong { font-size:15px; } .mail-symbol { width:32px; height:39px; } #bottle-mailbox .mail-body { padding:2px 16px 18px; } }
  @media(max-width:560px) { .masthead .sub { display:none; } .brand small { white-space:nowrap; font-size:8px; } .card { min-width:0; } }
  .actor-choice { flex-basis:100%; display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding-bottom:9px; }
  .actor-caption { font-size:12px; letter-spacing:.08em; color:var(--muted); }
  .actor-switch { display:inline-flex; padding:4px; gap:3px; border:1px solid var(--line); border-radius:24px; background:var(--soft); }
  .actor-switch button { border:0; background:transparent; border-radius:20px; padding:9px 17px; color:inherit; cursor:pointer; font:inherit; font-size:13px; }
  .actor-switch button[aria-pressed="true"] { background:var(--accent); color:var(--on-accent); box-shadow:0 2px 8px color-mix(in srgb,var(--accent) 18%,transparent); }
  .actor-choice small { font-size:11px; color:var(--muted); }
  .actor-switch button:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
  .invitation-settings { margin:0 0 22px; padding:13px 16px; border:1px dashed var(--line); border-radius:10px; font-size:12px; }
  .invitation-settings summary { cursor:pointer; color:var(--accent-text,var(--accent)); }
  .invitation-settings p { line-height:1.8; }
  .invitation-outcome { border:1px solid var(--line); border-left:3px solid var(--sea); border-radius:12px; padding:12px 14px; background:var(--panel); color:var(--ink); transition:background-color var(--motion) var(--ease),border-color var(--motion) var(--ease),color var(--motion) var(--ease); overflow-wrap:anywhere; }
  .invitation-outcome-label { font-size:11px; color:var(--muted); }
  #wake-outcome { margin:5px 0 0; font-size:13px; line-height:1.7; }
  .invitation-row { display:flex; flex-wrap:wrap; gap:9px; align-items:center; padding:9px 0; }
  .invitation-row > span { flex:1 1 220px; }
  .invitation-row input { width:58px; padding:6px; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; }
  .invitation-row .btn { padding:6px 12px; font-size:12px; }
  .feedback-entry { display:inline-flex; align-items:center; justify-content:center; gap:6px; flex:none; border:1px solid var(--line); border-radius:9px; padding:9px 11px; background:transparent; color:var(--muted); font-size:12px; white-space:nowrap; }
  .feedback-entry .icon { width:15px; height:15px; }
  .feedback-entry:hover { color:var(--ink); border-color:var(--edge); background:var(--soft); }
  .feedback-version { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; margin:18px 0; padding:14px 16px; border:2px solid var(--sea); border-radius:12px; background:var(--soft); color:var(--ink); }
  .feedback-version > span { font-size:13px; font-weight:600; }
  .feedback-version > strong { font-size:20px; color:var(--ink); overflow-wrap:anywhere; }
  .feedback-version > small { flex-basis:100%; color:var(--muted); line-height:1.6; }
  .feedback-qr { margin:14px 0; color:var(--muted); }
  .feedback-qr summary { cursor:pointer; font-size:13px; padding:8px 0; }
  .feedback-qr img { display:block; width:200px; height:200px; max-width:100%; margin:12px auto; border-radius:8px; background:#fff; }
  .feedback-qr > p { text-align:center; }
  .feedback-dialog { width:calc(100% - 32px); max-width:440px; max-height:88vh; max-height:88dvh; overflow:auto; border:1px solid var(--line); border-radius:16px; padding:27px; color:var(--ink); background:var(--card); box-shadow:0 20px 90px color-mix(in srgb,var(--ink) 23%,transparent); }
  .feedback-dialog::backdrop { background:var(--backdrop); }
  .feedback-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .feedback-kicker { color:var(--muted); font-size:11px; }
  .feedback-dialog h2 { margin:6px 0 12px; font:400 23px/1.4 Georgia,"Songti SC",serif; }
  .feedback-close { display:grid; place-items:center; width:30px; height:30px; padding:0; border:1px solid var(--line); border-radius:50%; background:transparent; color:var(--muted); line-height:0; flex:none; }
  .feedback-close svg { display:block; width:16px; height:16px; flex:none; }
  .feedback-dialog p { margin:0 0 16px; font-size:13px; line-height:1.9; }
  .feedback-path { display:block; margin-top:12px; padding:14px 16px; border:1px solid var(--line); border-radius:10px; text-decoration:none; color:var(--ink); background:var(--soft); }
  a.feedback-path:hover { border-color:var(--accent-text,var(--accent)); background:var(--paper); }
  .feedback-path strong { display:flex; justify-content:space-between; font-size:13px; font-weight:500; }
  .feedback-path small { display:block; margin-top:5px; color:var(--muted); font-size:11px; }
  .feedback-path p { margin:7px 0 0; font-size:12px; }
  .feedback-group b { font-weight:500; color:var(--accent-text,var(--accent)); }
  .feedback-dialog .feedback-whisper { margin:16px 0 20px; color:var(--muted); font-size:11px; opacity:.8; }
  .feedback-dialog .feedback-signoff { display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px; margin:0; color:var(--muted); font-size:12px; }
  @media(max-width:560px) { .feedback-dialog { padding:22px; } }

  /* A paper letterbox, with an action desk beside the seaside title. */
  body#bottle-mailbox { background-color:var(--paper); }
  .shell { max-width:1160px; }
  .masthead { position:relative; z-index:3; padding:23px 0; }
  .brand-mark { width:56px; height:56px; }
  .brand h1 { font-size:22px; }
  .masthead-end { display:flex; align-items:center; gap:24px; }
  .opening { display:grid; grid-template-columns:minmax(0,1.08fr) minmax(350px,.92fr); gap:48px; align-items:center; padding:36px 0 30px; }
  .hero { display:block; min-height:320px; padding:12px 0 130px; position:relative; }
  .hero > div:first-child { position:relative; z-index:1; }
  .hero .eyebrow { font-size:11px; letter-spacing:.22em; margin-bottom:17px; }
  .hero h2 { font-size:clamp(36px,4.2vw,52px); line-height:1.3; letter-spacing:.06em; margin-bottom:18px; }
  .hero p { font-size:13px; }
  .hero-art { position:absolute; width:285px; height:155px; right:8px; bottom:-6px; transform:scale(.82); transform-origin:right bottom; opacity:.92; }
  .hero .postmark { top:0; right:0; }
  .toolbar { display:flex; align-items:stretch; gap:20px; padding:27px; border:1px solid var(--line); border-radius:18px; background:var(--panel); box-shadow:var(--shadow); position:relative; }
  .toolbar::before { content:''; position:absolute; left:24px; right:24px; top:0; height:3px; background:repeating-linear-gradient(110deg,var(--seal) 0 12px,transparent 12px 20px,var(--sea) 20px 32px,transparent 32px 40px); opacity:.6; }
  .launch-heading { display:flex; justify-content:space-between; align-items:center; width:100%; color:var(--accent-text,var(--accent)); font:16px/1.5 Georgia,"Songti SC",serif; }
  .launch-heading .icon { width:20px; height:20px; opacity:.65; }
  .actor-choice { width:100%; padding:0; gap:10px; }
  .actor-caption { flex-basis:100%; font-size:11px; }
  .actor-switch { padding:3px; border-radius:10px; gap:2px; }
  .actor-switch button { padding:8px 14px; border-radius:7px; font-size:12px; }
  .actor-switch button[aria-pressed=true] { background:var(--accent); color:var(--on-accent); box-shadow:0 2px 6px color-mix(in srgb,var(--ink) 12%,transparent); }

  #actor-hint { flex-basis:100%; min-height:18px; }
  .toolbar .actions { display:grid; width:100%; grid-template-columns:1fr 1fr; gap:12px; }
  .action-main { display:flex; flex-direction:column; align-items:flex-start; padding:17px; gap:12px; min-height:125px; border-radius:10px; }
  .action-main strong { font-size:14px; letter-spacing:.03em; line-height:1.6; }
  .action-main small { font-size:10px; line-height:1.7; }
  .action-main.catch { color:var(--on-sea); }
  :root[data-theme="coopanion"][data-host-theme="true"] .action-main.catch { background:var(--sea-soft); color:var(--accent-text,var(--sea)); border-color:var(--edge); }
  #action-note { max-width:none; font-size:11px; width:100%; padding-top:12px; border-top:1px dashed var(--line); }
  .invitation-settings { background:var(--panel); margin:0 0 26px; padding:15px 19px; border-style:solid; }
  .invitation-settings summary { font-weight:500; }
  .invitation-settings > p { color:var(--muted); max-width:850px; }
  .invitation-row { border-top:1px dashed var(--line); padding:12px 0; }
  .desk { padding:4px 0 32px; border-top:0; }
  .section-heading h2 { font-size:15px; letter-spacing:.04em; }
  .card { border-radius:5px 14px 14px 14px; }
  .card::before { background:var(--edge); }
  .card .title { padding-bottom:14px; border-bottom:1px dashed var(--line); }
  .letter { color:var(--ink); }
  .empty { padding:28px 8px; }
  .book { background:var(--panel); border-radius:16px; }
  .book > summary { background:var(--soft); }
  .book-layout { grid-template-columns:208px minmax(0,1fr); }
  .mail-folders { background:var(--panel); }
  .folder[aria-pressed=true] { color:var(--accent-text,var(--accent)); }
  .folder b { background:var(--tint); }
  .mail-symbol { background:var(--soft); }
  .mail.seed .mail-symbol { background:var(--sea-soft); }
  .feedback-version { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; margin:18px 0; padding:14px 16px; border:2px solid var(--sea); border-radius:12px; background:var(--soft); color:var(--ink); }
  .feedback-version > span { font-size:13px; font-weight:600; }
  .feedback-version > strong { font-size:20px; color:var(--ink); overflow-wrap:anywhere; }
  .feedback-version > small { flex-basis:100%; color:var(--muted); line-height:1.6; }
  .feedback-qr { margin:14px 0; color:var(--muted); }
  .feedback-qr summary { cursor:pointer; font-size:13px; padding:8px 0; }
  .feedback-qr img { display:block; width:200px; height:200px; max-width:100%; margin:12px auto; border-radius:8px; background:#fff; }
  .feedback-qr > p { text-align:center; }
  .feedback-dialog { box-shadow:0 24px 90px color-mix(in srgb,var(--backdrop) 70%,transparent); }
  .feedback-dialog[open]::backdrop { animation:backdrop-in 220ms ease both; }
  .feedback-close:hover { background:var(--soft); color:var(--ink); transform:rotate(90deg); }
  .toast { color:var(--paper); }
  .toast.bad { color:var(--danger-text); background:var(--danger-bg); }
  :root[data-appearance=dark] .status-replied { color:#a2ddba; background:#243b30; }
  :root[data-appearance=dark] .status-drifting { color:#add7ed; background:#273b48; }
  :root[data-appearance=dark] .status-picked { color:#efcf95; background:#403421; }
  :root[data-appearance=dark] .status-tsunami { color:#efb2ad; background:#492d32; }
  :root[data-appearance=dark] .status-sunk { color:#cfc1e2; background:#393040; }

  /* A small palette menu; selections are buttons, not colour-only controls. */
  .theme-picker { position:relative; flex:none; }
  .theme-toggle { display:flex; align-items:center; gap:9px; background:var(--card); color:var(--ink); border:1px solid var(--line); border-radius:24px; padding:9px 13px; font-size:12px; }
  .theme-toggle:hover { border-color:var(--edge); box-shadow:var(--shadow); }
  .theme-dot { width:12px; height:12px; border-radius:50%; background:var(--seal); box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink) 12%,transparent); }
  .theme-chevron { color:var(--muted); font-size:16px; line-height:1; }
  .theme-toggle[aria-expanded=true] .theme-chevron { transform:rotate(180deg); }
  .theme-menu { position:absolute; right:0; top:calc(100% + 12px); width:266px; padding:10px; background:var(--card); border:1px solid var(--line); border-radius:14px; box-shadow:0 15px 50px color-mix(in srgb,var(--ink) 14%,transparent); z-index:25; }
  .theme-menu > p { font-size:11px; color:var(--muted); margin:6px 9px 10px; }
  .theme-menu button { display:flex; align-items:center; gap:12px; width:100%; border:1px solid transparent; background:transparent; color:var(--ink); padding:11px 9px; border-radius:9px; text-align:left; }
  .theme-menu button:hover { background:var(--soft); }
  .theme-menu button[aria-pressed=true] { background:var(--active); border-color:var(--active-line); }
  .theme-menu strong,.theme-menu small { display:block; }
  .theme-menu strong { font-size:12px; font-weight:600; }
  .theme-menu small { font-size:10px; color:var(--muted); margin-top:2px; }
  .theme-check { margin-left:auto; color:var(--accent-text,var(--accent)); opacity:0; }
  .theme-menu button[aria-pressed=true] .theme-check { opacity:1; }
  .appearance-settings { border-top:1px solid var(--line); margin-top:8px; padding:12px 4px 2px; }
  .appearance-settings p { margin:0 4px 9px; color:var(--muted); font-size:11px; line-height:1.7; }
  .appearance-options { display:flex; gap:4px; margin-bottom:10px; }
  .appearance-options button { flex:1; justify-content:center; padding:8px 4px; font-size:11px; white-space:nowrap; }
  .theme-swatch { width:29px; height:35px; border-radius:4px; border:1px solid #00000015; flex:none; box-shadow:0 2px 4px #00000009; }
  .swatch-ocean { background:linear-gradient(155deg,#fffefa 50%,#4b60a2 51% 72%,#79b9da 73%); }
  .swatch-paper { background:linear-gradient(155deg,#fff8e8 50%,#946327 51% 72%,#70663c 73%); }
  .swatch-epistle { background:linear-gradient(155deg,#fdfbf5 0 44%,#f6f1e6 45% 66%,#3f4a8c 67% 82%,#9c3b30 83%); }
  .swatch-coopanion { background:linear-gradient(155deg,var(--host-sheet,var(--card)) 50%,var(--host-accent,var(--seal)) 51% 72%,var(--host-ink-blue,var(--sea)) 73%); }
  body,button,input,summary,.card,.book,.mail,.mail-folders,.mail-symbol,.folder b,.original,.reply-quote,.toolbar,.invitation-settings,.theme-menu,.theme-check,.theme-chevron,.chip,.feedback-dialog,.feedback-path,.actor-switch,.masthead,.day-heading,.letter,.meta,.empty,.foot,.hero p,.eyebrow,.section-heading,.launch-heading,.date-tools label,.book-tools p,.mail-subject small,.folder-note,.folder-label {
    transition:background-color var(--motion) var(--ease),color var(--motion) var(--ease),border-color var(--motion) var(--ease),box-shadow var(--motion) var(--ease),transform 220ms var(--ease),opacity 200ms ease;
  }
  input:focus-visible { box-shadow:0 0 0 4px color-mix(in srgb,var(--focus) 12%,transparent); }
  button:active:not(:disabled) { transform:translateY(1px); }
  @keyframes backdrop-in { from { opacity:0; } to { opacity:1; } }
  @media(max-width:960px) { .masthead .sub { display:none; } .opening { gap:28px; grid-template-columns:minmax(0,1fr) minmax(330px,1fr); } .toolbar { padding:23px; } .hero-art { right:-15px; transform:scale(.7); } }
  @media(max-width:740px) { .opening { grid-template-columns:1fr; gap:12px; padding:25px 0; } .hero { min-height:215px; padding:4px 0 28px; } .hero h2 { font-size:38px; } .hero-art { right:0; bottom:25px; transform:scale(.65); opacity:.7; } .toolbar .actions { grid-template-columns:1fr 1fr; } .actor-choice { gap:10px; } .actor-caption { flex-basis:auto; } #actor-hint { flex-basis:100%; } .book-layout { grid-template-columns:160px minmax(0,1fr); } }
  @media(max-width:560px) { body#bottle-mailbox { padding:0 16px 30px; } .masthead { gap:10px; padding:17px 0; } .brand { gap:9px; } .brand-mark { width:45px; height:45px; } .brand h1 { font-size:19px; } .brand small { font-size:7px; letter-spacing:.14em; } .theme-toggle { gap:6px; padding:8px 10px; font-size:11px; } .theme-menu { width:min(266px,calc(100vw - 32px)); } .hero { min-height:auto; padding:5px 2px 10px; } .hero h2 { font-size:35px; } .hero h2 br { display:none; } .hero-art { display:none; } .hero p { font-size:12px; } .hero .eyebrow { margin-bottom:10px; font-size:10px; } .toolbar { padding:22px 18px; gap:16px; } .actor-switch button { padding:8px 12px; } .action-main { min-height:119px; padding:15px 12px; } .action-main strong { font-size:13px; } .action-main small { font-size:9px; } .invitation-settings { padding:13px 15px; } .invitation-row > span { flex-basis:100%; } .book-layout { display:block; } .book > summary { padding:18px; } .book-title { font-size:19px; } .mail-folders { display:grid; grid-template-columns:1fr 1fr; } .folder { padding:10px 8px; } .folder span { font-size:12px; } .section-heading { gap:10px; } .section-heading h2 { font-size:13px; } .chip { padding:4px 7px; font-size:10px; } .card { padding:22px 19px; } }
  /* Keep mailbox text legible even when a browser add-on injects generic body/button styles. */
  #bottle-mailbox { color:var(--ink); }
  #bottle-mailbox :is(h1,h2,h3,h4,.book-title,.mail-topic,.mail-subject strong) { color:var(--ink); }
  #bottle-mailbox :is(button,input,select) { font-family:inherit; }
  #bottle-mailbox .actor-switch button { color:var(--ink); }
  #bottle-mailbox .actor-switch button[aria-pressed=true] { color:var(--on-accent); }
  #bottle-mailbox .theme-toggle { border-radius:12px; padding:9px 12px; gap:10px; background:var(--panel); color:var(--ink); }
  .theme-toggle-label { display:grid; gap:1px; text-align:left; font-size:12px; line-height:1.5; }
  #theme-name { font-size:10px; color:var(--muted); }
  #bottle-mailbox .theme-chevron { width:16px; height:16px; }
  #bottle-mailbox .theme-menu { width:min(392px,calc(100vw - 32px)); padding:18px; border-radius:18px; background:var(--card); color:var(--ink); box-shadow:0 14px 44px color-mix(in srgb,var(--backdrop) 45%,transparent); }
  #bottle-mailbox .theme-menu { max-height:calc(100dvh - 110px); overflow-y:auto; overscroll-behavior:contain; }
  #bottle-mailbox .theme-font-current { margin:14px 0 0; padding:9px 11px; border:1px solid var(--line); border-radius:8px; background:var(--soft); color:var(--ink); font-size:11px; line-height:1.7; overflow-wrap:anywhere; transition:background-color var(--motion) var(--ease),color var(--motion) var(--ease),border-color var(--motion) var(--ease); }
  .customization-settings { border-top:1px solid var(--line); margin-top:16px; padding-top:12px; }
  .customization-settings > summary { display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--ink); font-size:12px; cursor:pointer; padding:7px 0; list-style:none; }
  .customization-settings > summary::-webkit-details-marker { display:none; }
  .customization-settings > summary::after { content:'+'; color:var(--muted); font-size:17px; transition:transform 240ms var(--ease); }
  .customization-settings[open] > summary::after { transform:rotate(45deg); }
  #bottle-mailbox .customization-caption { margin-left:auto; font-size:10px; color:var(--muted); }
  .customization-content { padding-top:8px; }
  .customization-section { padding:16px 0; border-bottom:1px solid var(--line); }
  .customization-section:first-child { padding-top:6px; }
  .customization-section:last-of-type { padding-bottom:4px; border-bottom:0; }
  .customization-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; color:var(--ink); font-size:12px; font-weight:500; }
  #bottle-mailbox .customization-heading > :is(span,output) { font-size:11px; font-weight:400; color:var(--muted); font-variant-numeric:tabular-nums; }
  #bottle-mailbox .customization-heading button { display:block; width:auto; padding:2px 0; font-size:11px; color:var(--muted); border:0; border-radius:0; background:transparent; }
  #bottle-mailbox .customization-heading button:hover:not(:disabled) { color:var(--ink); text-decoration:underline; text-underline-offset:3px; }
  .custom-color-row { display:flex; align-items:stretch; gap:10px; }
  .color-choice { display:flex; flex:1; align-items:center; gap:8px; min-width:0; color:var(--muted); font-size:11px; cursor:pointer; }
  .color-choice input { flex:none; width:38px; height:38px; padding:3px; border:1px solid var(--line); border-radius:10px; background:var(--card); cursor:pointer; }
  .color-choice input::-webkit-color-swatch-wrapper { padding:0; }
  .color-choice input::-webkit-color-swatch { border:0; border-radius:6px; }
  #bottle-mailbox #theme-custom { position:relative; display:flex; width:auto; flex:none; align-items:center; gap:8px; margin:0; padding:8px 10px; border:1px solid var(--line); font-size:11px; }
  #bottle-mailbox #theme-custom[aria-pressed="true"] { border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
  #bottle-mailbox #theme-custom .theme-check { position:static; margin:0; width:15px; height:15px; background:var(--custom-color); color:var(--on-accent); }
  #bottle-mailbox .customization-help { margin:9px 0 0; font-size:11px; line-height:1.75; color:var(--muted); }
  .asset-upload { position:relative; display:flex; align-items:center; gap:11px; padding:10px; min-width:0; border:1px solid var(--line); border-radius:10px; background:var(--soft); cursor:pointer; transition:border-color 200ms var(--ease),background-color 200ms var(--ease),transform 200ms var(--ease); }
  .asset-upload:hover { border-color:var(--accent-text,var(--accent)); background:var(--panel); }
  .asset-upload:focus-within { outline:2px solid var(--focus); outline-offset:3px; }
  .asset-upload:has(input:disabled) { cursor:progress; opacity:.65; }
  .asset-thumb { display:grid; place-items:center; flex:none; width:44px; height:44px; color:var(--muted); border:1px solid var(--line); border-radius:6px; background-color:var(--card); background-size:cover; background-position:center; }
  .asset-thumb .icon { width:21px; height:21px; }
  .asset-thumb[data-has-image=true] .icon { opacity:0; }
  .font-thumb { font:24px/1 Georgia,"Songti SC",serif; }
  .asset-copy { display:block; min-width:0; flex:1; }
  #bottle-mailbox .asset-copy strong { color:var(--ink); font-size:12px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #bottle-mailbox .asset-copy small { margin-top:5px; font-size:10px; line-height:1.5; }
  .asset-plus { color:var(--muted); font-size:18px; }
  .asset-input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
  .background-options { overflow:hidden; padding-top:14px; }
  .background-options[hidden] { display:none; }
  #background-transparency { display:block; width:100%; height:20px; margin:0; cursor:pointer; accent-color:var(--accent-text,var(--accent)); }
  .range-captions { display:flex; justify-content:space-between; margin-top:3px; font-size:10px; color:var(--muted); }
  .my-font-preview { padding:13px 10px; margin:10px 0 0; border-left:2px solid var(--line); color:var(--ink); background:var(--panel); font:16px/1.8 "Songti SC",serif; overflow-wrap:anywhere; }
  #bottle-mailbox .customization-note { margin:10px 0 0; font-size:10px; line-height:1.7; color:var(--muted); }
  .theme-menu-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 0 16px; }
  #bottle-mailbox .theme-menu-heading strong { font-size:13px; color:var(--ink); }
  .theme-menu-heading > span { font-size:10px; color:var(--muted); }
  .theme-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  #bottle-mailbox .theme-options button { position:relative; display:flex; flex-direction:column; align-items:stretch; gap:9px; padding:7px 7px 10px; border:1px solid var(--line); border-radius:10px; color:var(--ink); min-width:0; }
  #bottle-mailbox .theme-options button[aria-pressed=true] { border-color:var(--accent-text,var(--accent)); background:var(--active); box-shadow:0 0 0 1px var(--accent); }
  #bottle-mailbox .theme-options button:hover { transform:translateY(-2px); }
  #bottle-mailbox .theme-swatch { width:100%; height:48px; border-radius:5px; position:relative; overflow:hidden; }
  .theme-swatch::after { content:''; position:absolute; left:13%; right:13%; top:18%; bottom:18%; border:1px solid #ffffff75; border-radius:2px; background:linear-gradient(155deg,transparent 49%,#ffffff66 50%,transparent 52%); }
  #bottle-mailbox .theme-options strong { font-size:11px; line-height:1.6; font-weight:600; }
  #bottle-mailbox .theme-options small { font-size:10px; line-height:1.5; color:var(--muted); }
  #bottle-mailbox .theme-check { position:absolute; right:9px; top:9px; width:17px; height:17px; display:grid; place-items:center; flex:none; line-height:0; border-radius:50%; color:var(--on-accent); background:var(--accent); }
  #bottle-mailbox .theme-check svg { display:block; width:10px; height:10px; }
  #bottle-mailbox .appearance-settings { margin-top:18px; padding:14px 0 0; }
  #bottle-mailbox .appearance-options { background:var(--soft); border-radius:10px; padding:4px; gap:3px; }
  #bottle-mailbox .appearance-options button { color:var(--muted); padding:8px 4px; border-radius:7px; border-color:transparent; }
  #bottle-mailbox .appearance-options button[aria-pressed=true] { color:var(--ink); background:var(--card); box-shadow:0 2px 5px color-mix(in srgb,var(--ink) 8%,transparent); }
  #bottle-mailbox .appearance-settings > small { display:block; font-size:10px; line-height:1.7; color:var(--muted); margin:6px 2px 0; }
  @media(max-width:560px) { #bottle-mailbox .theme-menu { position:fixed; left:16px; right:16px; top:84px; width:auto; max-height:calc(100dvh - 100px); } #bottle-mailbox .theme-toggle { padding:7px 9px; } #bottle-mailbox .theme-menu { padding:14px; } .theme-menu-heading > span { display:none; } }
  @media(max-width:560px) { .masthead-end { gap:8px; } .masthead .brand small { display:none; } }
  @media(max-width:360px) { .masthead { flex-wrap:wrap; } .masthead-end { margin-left:auto; } }
  @media(max-width:400px) { #bottle-mailbox .brand small { display:none; } #bottle-mailbox .brand { gap:7px; } #bottle-mailbox .theme-toggle { gap:7px; } }
  @media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }

  .sound-toolbar { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin:16px 0; }
  .sound-toolbar label { display:flex; align-items:center; gap:8px; font-size:13px; }
  .sound-toolbar input[type=number] { width:80px; }
  .sound-row { display:grid; grid-template-columns:90px minmax(120px,1fr) minmax(140px,1fr) auto; align-items:center; gap:12px; margin:16px 0; }
  .sound-row small { grid-column:2/-1; color:var(--muted); overflow-wrap:anywhere; }
  .sound-settings select, .sound-toolbar input[type=number] { color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px; min-width:0; }
  .sound-row input[type=file] { max-width:100%; min-width:0; font-size:12px; color:var(--muted); }
  .sound-row select { grid-column:2; }
  .sound-row input[hidden] { display:none; }
  .sound-row button { grid-column:4; }
  @media(max-width:560px) { .sound-row { grid-template-columns:1fr auto; } .sound-row label, .sound-row small { grid-column:1/-1; } .sound-row select { grid-column:1; } .sound-row button { grid-column:2;grid-row:2; } .sound-row input[type=file] { grid-column:1/-1; } }

  /* ── 书信的秩序 ────────────────────────────────────────────────────────────
     整页像一份摊开的信笺：居中的窄栏、细横线、编号的小节。
     动作与阅读分区，纸条长在对应的信下面，不再各占一块挤成一团。 */
  body#bottle-mailbox { padding:0 28px 56px; line-height:1.7; }
  .shell { max-width:1080px; }
  .masthead { gap:18px; padding:18px 4px; border-bottom:0; position:relative; }
  .masthead::after { content:''; position:absolute; left:4px; right:4px; bottom:0; height:1px; background:linear-gradient(90deg,var(--line),color-mix(in srgb,var(--line) 20%,transparent)); }
  .brand { gap:13px; }
  .brand-mark { width:44px; height:44px; }
  .brand h1 { font:600 20px/1.3 var(--serif); letter-spacing:.2em; }
  .brand small { margin-top:5px; font-size:9px; letter-spacing:.3em; color:var(--muted); }
  .masthead-end { gap:14px; }
  .masthead .sub { font-size:11px; letter-spacing:.18em; color:var(--muted); opacity:.85; }

  .opening { display:block; padding:clamp(30px,5vw,58px) 0 30px; }
  .hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,.9fr); gap:clamp(20px,4vw,54px); align-items:end; min-height:0; padding:0 4px 30px; position:relative; }
  .hero .eyebrow { display:flex; align-items:center; gap:12px; font-size:11px; letter-spacing:.28em; margin-bottom:20px; }
  .hero .eyebrow::after { content:''; flex:1; max-width:120px; height:1px; background:linear-gradient(90deg,currentColor,transparent); opacity:.45; }
  .hero h2 { margin:0 0 16px; font:400 clamp(40px,5vw,66px)/1.22 var(--serif); letter-spacing:.1em; text-wrap:balance; }
  .hero h2 br { display:block; }
  .hero p { margin:0; max-width:34em; font-size:13.5px; line-height:2; color:var(--muted); }
  .hero-art { position:relative; inset:auto; width:auto; height:auto; min-height:190px; display:grid; place-items:center; transform:none; opacity:1; }
  .envelope-art { width:min(300px,100%); height:186px; border-radius:3px; transform:rotate(-4deg); box-shadow:0 24px 30px -24px color-mix(in srgb,var(--ink) 28%,transparent); }
  .envelope-art::before { width:calc(100% - 34px); height:106px; left:17px; top:-30px; transform:rotate(2.6deg); }
  .wax { left:50%; top:46px; margin-left:-19px; width:40px; height:40px; }
  .hero .postmark { top:auto; bottom:0; right:8px; width:78px; height:78px; font-size:9px; }
  .hero .postmark b { font-size:19px; }
  .hero-wave { display:none; }

  /* 一封信的三件事：谁写的、做了什么、几点了。 */
  .toolbar { display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,.86fr); grid-template-areas:"actor heading" "actions actions" "note outcome"; gap:20px 30px; align-items:start; padding:30px clamp(20px,3vw,34px) 26px; border:var(--rule); border-radius:4px 4px 0 0; background:var(--card); box-shadow:none; position:relative; }
  .toolbar::before { left:0; right:0; top:0; height:3px; opacity:.85; border-radius:4px 4px 0 0; }
  .launch-heading { grid-area:heading; justify-content:flex-end; align-self:center; font-size:15px; letter-spacing:.14em; color:var(--muted); }
  .launch-heading .icon { order:-1; width:18px; height:18px; opacity:.55; }
  .actor-choice { grid-area:actor; display:flex; flex-wrap:wrap; min-width:0; gap:9px 12px; padding:0; align-items:center; }
  .actor-caption { flex:0 0 auto; font-size:11px; letter-spacing:.16em; color:var(--muted); }
  #actor-hint { flex:0 0 100%; min-width:0; min-height:0; font-size:11px; line-height:1.7; }
  .actor-switch { display:inline-flex; flex:0 1 auto; min-width:0; max-width:100%; padding:3px; border-radius:9px; background:var(--soft); border-color:var(--line); }
  .actor-switch button { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:7px 13px; border-radius:6px; font-size:12px; color:var(--muted); }
  .toolbar .actions { grid-area:actions; display:grid; grid-template-columns:1fr 1fr; gap:14px; margin:0; width:auto; }
  .action-main { display:grid; grid-template-columns:auto minmax(0,1fr); grid-template-rows:auto auto; align-items:center; column-gap:14px; row-gap:2px; padding:18px 20px; min-height:0; border-radius:10px; box-shadow:none; border:1px solid transparent; letter-spacing:.04em; }
  .action-main .icon { grid-row:1 / span 2; width:26px; height:26px; }
  .action-main strong { grid-column:2; font-size:15px; font-weight:600; line-height:1.5; }
  .action-main small { grid-column:2; font-size:11px; line-height:1.6; opacity:.82; }
  .action-main:hover:not(:disabled) { transform:translateY(-2px); }
  .invitation-outcome { grid-area:outcome; margin:0; padding:14px 16px; border-radius:8px; border:1px solid var(--line); border-left:2px solid var(--sea); background:var(--panel); font-size:12px; align-self:stretch; }
  .invitation-outcome-label { font-size:10px; letter-spacing:.2em; }
  #wake-outcome { font-size:12px; line-height:1.8; }
  #action-note { grid-area:note; align-self:center; max-width:none; width:auto; padding:0; border:0; font-size:11.5px; line-height:1.9; }

  /* 设置与回音收进可折叠的页脚，主栏只留信。 */
  details.invitation-settings { margin:0 0 22px; padding:0 clamp(20px,3vw,34px) 4px; border:var(--rule); border-top:0; border-radius:0 0 4px 4px; background:var(--card); }
  details.invitation-settings > summary { padding:14px 0 12px; font-size:12px; letter-spacing:.06em; color:var(--muted); }
  details.invitation-settings > p { color:var(--muted); font-size:12px; line-height:2; max-width:62em; }
  .invitation-row { border-top:var(--rule-dash); padding:12px 0; }
  .invitation-row > span:first-child { color:var(--ink); font-size:12px; }
  #announcements:empty { display:none; }
  .notice { border-radius:6px; padding:14px 18px; margin-bottom:16px; font-size:12.5px; }
  #sound-settings { margin:0 0 22px; }

  .desk { padding:34px 0 10px; border-top:var(--rule); display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px 20px; align-items:end; }
  .desk > .section-heading { grid-column:1 / -1; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin:0 0 8px; }
  .section-heading h2 { display:flex; align-items:baseline; gap:14px; font:400 24px/1.3 var(--serif); letter-spacing:.12em; }
  .section-heading h2::before { content:'—'; width:auto; height:auto; background:none; border-radius:0; margin:0; color:var(--accent-text,var(--accent)); font-size:13px; letter-spacing:0; }
  .tide { gap:6px; }
  .chip { border:0; background:none; padding:0 2px; font-size:11.5px; letter-spacing:.04em; }
  .chip + .chip::before { content:'·'; margin-right:8px; color:var(--line); }
  .chip b { font:600 15px/1 var(--serif); color:var(--ink); margin:0 1px; }
  #stage { grid-column:1 / -1; display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr)); gap:22px; align-items:start; }
  .card { padding:0 clamp(10px,2vw,22px) 22px; border:0; border-top:1px solid var(--line); border-radius:0; background:transparent; box-shadow:none; overflow:visible; }
  .card::before { display:none; }
  .card > .eyebrow { display:flex; align-items:center; gap:10px; padding:16px 0 0; font-size:10.5px; letter-spacing:.2em; color:var(--muted); }
  .card > .eyebrow .who { color:var(--accent-text,var(--accent)); letter-spacing:.06em; }
  .card > .title { margin:6px 0 0; padding:0 0 12px; border:0; font:400 20px/1.5 var(--serif); }
  .card > .meta { margin-top:2px; padding-top:10px; border-top:var(--rule-dash); font-size:11.5px; color:var(--muted); }
  .card > .hint { margin-top:12px; border-radius:6px; font-size:12px; }
  .card > .actions { margin-top:18px; gap:12px; }
  .card .btn { padding:11px 22px; border-radius:7px; letter-spacing:.08em; box-shadow:none; }
  .card .btn.seal { box-shadow:0 8px 18px -14px color-mix(in srgb,var(--seal) 70%,transparent); }
  .card .btn.ghost { border-color:var(--edge); color:var(--ink); }
  .card .btn.ghost:hover:not(:disabled) { border-color:var(--ink); }
  .card > .letter-sheet { margin-top:10px; }
  .empty { padding:34px 8px; }
  .empty .big { font:400 24px/1.5 var(--serif); letter-spacing:.08em; }
  .empty .icon { color:var(--muted); opacity:.6; }

  /* 信册：一条书脊，左边分格，右边摊开的信。 */
  .book { border:var(--rule); border-radius:4px; background:var(--card); box-shadow:none; overflow:hidden; }
  .book > summary { padding:20px clamp(18px,3vw,30px); background:transparent; border-bottom:var(--rule); gap:14px; }
  .book > summary .icon { color:var(--accent-text,var(--accent)); }
  .book-title { font:400 21px/1.4 var(--serif); letter-spacing:.16em; }
  .book-count { font-size:11px; letter-spacing:.06em; }
  .fold-label { font-size:10.5px; letter-spacing:.1em; }
  .book-layout { grid-template-columns:206px minmax(0,1fr); }
  .mail-folders { padding:22px 14px; background:var(--panel); border-right:var(--rule); }
  .folder-label { font-size:9.5px; letter-spacing:.3em; margin:0 10px 14px; }
  .folder { border-radius:6px; padding:11px 10px; margin-bottom:3px; gap:10px; }
  .folder span { font-size:12.5px; letter-spacing:.04em; }
  .folder b { font:12px/1.5 var(--serif); background:transparent; border:1px solid var(--line); min-width:22px; text-align:center; }
  .folder[aria-pressed=true] { background:var(--tint); border-color:transparent; box-shadow:inset 3px 0 0 var(--accent); }
  .folder-note { font:12px/1.9 var(--serif); border-top:var(--rule-dash); margin:20px 10px 0; padding-top:16px; }
  .mail-content { padding:24px clamp(16px,2.4vw,30px) 34px; }
  .book-tools { padding-bottom:14px; border-bottom:0; align-items:flex-end; }
  .book-tools h3 { font:400 18px/1.5 var(--serif); letter-spacing:.1em; }
  .archive-tools { gap:14px; padding-bottom:16px; margin-bottom:6px; }
  .day-heading { margin:22px 0 10px; font-size:10.5px; letter-spacing:.14em; }
  .day-heading b { color:var(--muted); font-weight:500; letter-spacing:.08em; }
  .mail { border:0; border-bottom:var(--rule); border-radius:0; background:transparent; margin:0; overflow:visible; }
  .mail:hover { border-color:var(--line); box-shadow:none; }
  .mail > summary { padding:15px 4px; gap:14px; border-radius:6px; transition:background-color .2s; }
  .mail > summary:hover { background:color-mix(in srgb,var(--soft) 55%,transparent); }
  .mail[open] { margin:0 0 14px; }
  .mail[open] > summary { border-bottom:var(--rule-dash); }
  .mail-symbol { width:30px; height:34px; background:transparent; border:1px solid var(--line); border-radius:3px; color:var(--muted); }
  .mail.seed .mail-symbol { background:transparent; }
  .mail-subject strong { font:400 16.5px/1.55 var(--serif); letter-spacing:.03em; }
  .mail-subject small { margin-top:3px; font-size:11px; letter-spacing:.04em; }
  .mail-status { border-radius:999px; padding:2px 9px; font-size:10.5px; letter-spacing:.04em; }
  #bottle-mailbox .mail-body { padding:6px 2px 18px; border-top:0; background:transparent; }
  .mail .head { padding:10px 0 0; font-size:11px; }
  .mail-foot { padding-top:14px; }
  .read-together { border-radius:7px; padding:7px 13px; font-size:11.5px; letter-spacing:.04em; }
  .link { font-size:11.5px; }
  .foot { margin-top:34px; padding-top:22px; border-top:var(--rule); font-size:11px; line-height:2.1; letter-spacing:.04em; }
  .toast { border-radius:8px; font-size:12.5px; letter-spacing:.04em; }

  @media(max-width:960px) {
    .toolbar { grid-template-columns:minmax(0,1fr); grid-template-areas:"heading" "actor" "actions" "outcome" "note"; gap:18px; }
    .launch-heading { justify-content:flex-start; order:-1; }
    .actor-choice { }
    .toolbar .actions { }
    .invitation-outcome { }
    #action-note { }
    .hero { grid-template-columns:1fr; gap:6px; align-items:start; }
    .hero-art { min-height:150px; margin-top:6px; }
    .envelope-art { width:230px; height:146px; }
    .book-layout { grid-template-columns:174px minmax(0,1fr); }
  }
  @media(max-width:740px) {
    .hero h2 { font-size:clamp(34px,9vw,44px); }
    .hero-art { display:none; }
    .card { padding-left:2px; padding-right:2px; }
  }
  @media(max-width:560px) {
    body#bottle-mailbox { padding:0 15px 40px; }
    .masthead { padding:14px 0; }
    .brand-mark { width:38px; height:38px; }
    .brand h1 { font-size:17px; letter-spacing:.14em; }
    .hero { gap:0; padding:0 0 22px; }
    .hero h2 { font-size:clamp(31px,9.4vw,40px); letter-spacing:.06em; }
    .hero h2 br { display:none; }
    .hero .eyebrow { margin-bottom:14px; letter-spacing:.2em; }
    .hero p { font-size:12.5px; line-height:1.95; }
    .opening { padding-top:26px; }
    .toolbar { padding:22px 16px 20px; gap:14px; }
    .toolbar .actions { grid-template-columns:1fr; gap:10px; }
    .action-main { padding:15px 16px; }
    details.invitation-settings { padding:0 16px 2px; }
    .desk { grid-template-columns:1fr; padding-top:26px; }
    .desk > .section-heading { flex-direction:column; align-items:flex-start; gap:8px; }
    .section-heading h2 { font-size:21px; }
    .tide { flex-wrap:wrap; }
    .book > summary { padding:16px 15px; }
    .book-title { font-size:18px; }
    .book-layout { display:block; }
    .mail-folders { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:12px; border-right:0; border-bottom:var(--rule); }
    .folder { margin:0; padding:9px 8px; }
    .mail-content { padding:16px 12px 22px; }
    .book-tools { gap:10px; }
    .mail > summary { padding:13px 2px; }
    .mail-subject strong { font-size:15px; }
    .card > .actions .btn { flex:1 1 auto; }
  }

  /* 「还在漂」这类状态沿用与读信状态同一种小药丸。 */
  .mail-status { flex:none; }
  ${slipGeometry}
  ${slipLayout}
  ${stationeryStyles}
  ${starStyles}
  ${readerStyles}
  @media(prefers-reduced-motion:reduce) { .letter-sheet,.letter-watermark,.reply-quote-label { transition:none; } }
`;
