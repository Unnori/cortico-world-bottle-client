/** 信纸、邮戳与海水色；网页布局独立于 Windows 原生卡片。 */
export const pageStyles = `
  :root { --paper:#f6f1e6; --card:#fffdf7; --ink:#352f28; --muted:#7d7467; --line:#e3d9c8; --accent:#8a6540; --seal:#a8453c; --sea:#527981; --shadow:0 3px 5px #59452a04,0 18px 50px #59452a09; }
  * { box-sizing:border-box; }
  html { color-scheme:light; }
  body { margin:0; background:radial-gradient(ellipse at 80% 0%,#e9ebe0aa,transparent 45%),radial-gradient(ellipse at 0% 45%,#ecdcc455,transparent 50%),var(--paper); color:var(--ink); font:15px/1.65 "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; padding:0 32px 48px; }
  button,input,select { font:inherit; }
  button { cursor:pointer; }
  button:disabled { cursor:default; opacity:.48; }
  button:focus-visible,summary:focus-visible,input:focus-visible { outline:3px solid #70969a; outline-offset:4px; }
  [hidden] { display:none!important; }
  .shell { max-width:1160px; margin:auto; }
  .masthead { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:24px 0; border-bottom:1px solid var(--line); }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand-mark { display:grid; place-items:center; width:42px; height:42px; border:1px solid var(--accent); border-radius:50%; color:var(--accent); }
  .brand h1 { margin:0; font:600 19px Georgia,"Songti SC",serif; letter-spacing:.15em; }
  .brand small { display:block; margin-top:4px; font-size:9px; letter-spacing:.23em; color:var(--muted); }
  .masthead .sub { font-size:12px; letter-spacing:.12em; color:var(--muted); }
  .icon { width:24px; height:24px; flex:none; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
  .hero { display:grid; grid-template-columns:1fr 300px; gap:24px; align-items:center; padding:42px 12px 28px; }
  .eyebrow { font-size:11px; letter-spacing:.17em; color:var(--accent); margin-bottom:12px; }
  .hero h2 { margin:0 0 14px; font:400 clamp(27px,3.5vw,40px)/1.45 Georgia,"Songti SC",serif; letter-spacing:.06em; }
  .hero p { margin:0; color:var(--muted); font-size:14px; }
  .hero-art { position:relative; height:175px; display:grid; place-items:center; pointer-events:none; }
  .envelope-art { width:225px; height:138px; position:relative; border:1px solid #d8c8ae; border-radius:5px; background:linear-gradient(148deg,transparent 49.5%,#e9ddca 50%,transparent 50.5%),linear-gradient(32deg,#f5ead7 49.5%,#dccdb6 50%,#fff9eb 50.5%); box-shadow:0 18px 25px #634b2515; transform:rotate(-8deg); animation:arrive .8s ease both; }
  .envelope-art::before { content:''; position:absolute; width:190px; height:100px; top:-29px; left:16px; background:repeating-linear-gradient(transparent 0 18px,#d7c7ac77 18px 19px),#fffcf3; border:1px solid #e2d5bf; transform:rotate(4deg); z-index:-1; }
  .wax { position:absolute; left:92px; top:48px; width:39px; height:39px; border-radius:48% 52% 45% 55%; background:var(--seal); box-shadow:inset 0 0 0 4px #ffffff12,0 3px 5px #633b2820; display:grid; place-items:center; color:#f8e9d1; }
  .postmark { position:absolute; right:0; top:10px; border:2px solid #52798166; border-radius:50%; width:86px; height:86px; display:grid; place-content:center; text-align:center; color:var(--sea); font-size:10px; line-height:1.9; letter-spacing:.12em; transform:rotate(12deg); }
  .postmark b { font:21px Georgia,serif; }
  .hero-wave { position:absolute; bottom:0; right:12px; width:130px; height:30px; color:#8ca4a1; }
  .toolbar { display:flex; align-items:center; gap:16px; padding:0 12px 28px; flex-wrap:wrap; }
  .toolbar .actions { margin:0; gap:12px; }
  .action-main { display:flex; align-items:center; gap:13px; border:1px solid transparent; border-radius:12px; padding:15px 23px; background:var(--seal); color:#fff9ed; text-align:left; box-shadow:0 5px 0 #833a3414,0 9px 22px #a8453c18; transition:transform .22s,box-shadow .22s,background .22s; }
  .action-main.catch { background:var(--sea); box-shadow:0 5px 0 #52798114,0 9px 22px #52798118; }
  .action-main strong { display:block; font-size:16px; font-weight:600; letter-spacing:.08em; }
  .action-main small { display:block; font-size:10px; margin-top:2px; opacity:.8; letter-spacing:.04em; }
  .action-main .icon { width:28px; height:28px; transition:transform .3s; }
  .action-main:hover:not(:disabled) { transform:translateY(-3px); box-shadow:0 12px 24px #59452a20; }
  .action-main:hover:not(:disabled) .icon { transform:rotate(-9deg); }
  .action-main:active:not(:disabled) { transform:translateY(1px); }
  #action-note { margin:0; max-width:250px; color:var(--muted); font-size:12px; }
  .tide { display:flex; gap:8px; flex-wrap:wrap; }
  .chip { font-size:11px; color:var(--muted); border:1px solid var(--line); background:#ffffff55; border-radius:6px; padding:5px 10px; }
  .chip b { color:var(--ink); font-weight:600; }
  .chip.spent { color:var(--seal); }
  .desk { padding:25px 0 30px; border-top:1px solid var(--line); }
  .section-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
  .section-heading h2 { font-size:14px; font-weight:500; letter-spacing:.1em; margin:0; }
  .section-heading h2::before { content:''; display:inline-block; width:6px; height:6px; background:var(--accent); border-radius:50%; margin-right:10px; vertical-align:middle; }
  #stage { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr)); gap:20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:5px 16px 16px 16px; box-shadow:var(--shadow); padding:28px 30px; position:relative; overflow:hidden; }
  .card::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:#b99d75; }
  .title { margin:0 0 18px; font:500 21px/1.5 Georgia,"Songti SC",serif; overflow-wrap:anywhere; }
  .letter { font:19px/2.1 Georgia,"Songti SC","Noto Serif CJK SC",serif; white-space:pre-wrap; overflow-wrap:anywhere; padding:8px 0 16px; }
  .letter.small { font-size:16px; line-height:1.95; }
  .meta { margin-top:12px; color:var(--muted); font-size:12px; display:flex; gap:12px; flex-wrap:wrap; }
  .actions { display:flex; align-items:center; gap:10px; margin-top:22px; flex-wrap:wrap; }
  .btn { border:1px solid var(--ink); background:var(--ink); color:#fff9ed; border-radius:8px; padding:10px 20px; font-size:13px; transition:transform .2s,box-shadow .2s; }
  .btn:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 6px 14px #352f2819; }
  .btn.seal { background:var(--seal); border-color:var(--seal); }
  .btn.ghost { background:transparent; border-color:#d6c8b3; color:var(--accent); }
  button[aria-busy=true] { opacity:.6; cursor:wait; }
  button[aria-busy=true]::after { content:''; width:10px; height:10px; display:inline-block; margin-left:7px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin .8s linear infinite; }
  .empty { padding:12px 4px; color:var(--muted); text-align:center; font-size:13px; }
  .empty .big { font:23px/1.5 Georgia,"Songti SC",serif; color:var(--ink); margin:8px 0; }
  .empty .icon { display:block; width:45px; height:45px; margin:0 auto 14px; color:#a48c6b; }
  .empty-mail { padding:50px 20px; border:1px dashed #d9cbb7; border-radius:12px; background:#fffdf74d; }
  .notice { border:1px solid #d7e2de; border-left:3px solid var(--sea); background:#edf2ee; padding:12px 18px; border-radius:8px; margin-bottom:18px; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; }
  .notice.alarm { border-color:#dfceae; background:#f2e8d5; }
  .hints { display:grid; gap:8px; margin-top:12px; }
  .hint { font-size:12px; color:#7a5b3a; background:#fbf3e2; border:1px solid #efe0c6; border-radius:8px; padding:10px 12px; }
  .hint.local { color:#4b6070; background:#eef4f6; }
  .hint.spent { color:#8a4038; background:#fbeeec; }
  summary { cursor:pointer; }
  .original { margin:0 0 15px; padding:10px 14px; background:#f4efe4; border:1px solid var(--line); border-radius:8px; font-size:12px; color:var(--accent); }
  .book { border:1px solid var(--line); border-radius:18px; background:#fffaf1a6; box-shadow:var(--shadow); overflow:hidden; }
  .book > summary { display:flex; align-items:center; gap:12px; list-style:none; padding:23px 28px; background:#eee5d666; }
  .book > summary::-webkit-details-marker,.mail > summary::-webkit-details-marker { display:none; }
  .book-title { font:500 22px Georgia,"Songti SC",serif; letter-spacing:.1em; }
  .book-count { color:var(--muted); font-size:12px; margin-left:auto; }
  .fold-label { color:var(--accent); font-size:11px; padding-left:12px; }
  .fold-label::after { content:'展开 ↓'; }
  .book[open] .fold-label::after { content:'收起 ↑'; }
  .book-layout { display:grid; grid-template-columns:218px minmax(0,1fr); }
  .mail-folders { padding:24px 16px; border-right:1px solid var(--line); background:#eee5d633; }
  .folder-label { font-size:10px; letter-spacing:.2em; margin:0 12px 16px; color:var(--muted); }
  .folder { width:100%; display:flex; align-items:center; gap:10px; border:1px solid transparent; background:transparent; color:var(--muted); border-radius:9px; padding:13px 12px; text-align:left; margin-bottom:6px; transition:background .2s,color .2s,transform .2s; }
  .folder .icon { width:19px; height:19px; }
  .folder span { font-size:13px; }
  .folder b { margin-left:auto; font:12px Georgia,serif; padding:1px 6px; border-radius:4px; background:#dfd4c44d; }
  .folder:hover { background:#e9dfcf70; transform:translateX(2px); }
  .folder[aria-pressed=true] { color:var(--seal); border-color:#d8bbae; background:#f1e2d9; font-weight:600; }
  .folder[data-category=seed][aria-pressed=true] { color:var(--sea); background:#e4ece5; border-color:#bacdc5; }
  .folder-note { color:var(--muted); font:13px/1.9 Georgia,"Songti SC",serif; border-top:1px solid var(--line); padding-top:20px; margin:24px 12px 0; }
  .mail-content { padding:25px 28px 30px; min-width:0; }
  .book-tools { display:flex; justify-content:space-between; gap:14px; align-items:center; flex-wrap:wrap; padding-bottom:20px; border-bottom:1px solid var(--line); }
  .book-tools h3 { margin:0 0 3px; font-size:17px; font-weight:500; }
  .book-tools p { margin:0; font-size:11px; color:var(--muted); }
  .date-tools { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .date-tools label { color:var(--muted); font-size:11px; }
  input[type=date] { color:var(--ink); border:1px solid #d7cbb9; border-radius:7px; background:var(--card); padding:7px 8px; font-size:12px; max-width:100%; }
  .day-heading { display:flex; align-items:center; gap:12px; color:var(--muted); font-size:11px; font-weight:400; margin:24px 0 12px; }
  .day-heading::after { content:''; flex:1; border-top:1px solid var(--line); }
  .day-heading b { font-weight:500; color:var(--accent); }
  .mail { background:var(--card); border:1px solid var(--line); border-radius:10px; margin-bottom:12px; overflow:hidden; transition:box-shadow .25s,border-color .25s; }
  .mail:hover { border-color:#c7b79d; box-shadow:0 6px 18px #59452a0a; }
  .mail > summary { display:flex; list-style:none; align-items:center; gap:14px; padding:18px; }
  .mail-symbol { width:40px; height:46px; display:grid; place-items:center; background:#f3eade; color:#a47c51; border:1px solid #e1d1b9; border-radius:4px; flex:none; }
  .mail.seed .mail-symbol { background:#eaf0e9; color:var(--sea); border-style:dashed; border-color:#b8ccc3; }
  .mail-subject { min-width:0; flex:1; }
  .mail-subject strong { display:block; font:16px/1.5 Georgia,"Songti SC",serif; overflow-wrap:anywhere; }
  .mail-subject small { display:block; color:var(--muted); font-size:11px; margin-top:4px; }
  @media(max-width:560px) { .mail > summary { flex-wrap:wrap; } .mail > summary > .mail-status { margin-left:42px; max-width:calc(100% - 42px); order:1; } }
  .mail-status { display:inline-block; flex-shrink:0; max-width:150px; border-radius:6px; padding:4px 8px; font:11px/1.5 system-ui,sans-serif; overflow-wrap:anywhere; }
  .status-replied { color:#246743; background:#e4f1e8; }
  .status-drifting { color:#32667c; background:#e7f0f5; }
  .status-picked { color:#855719; background:#faf0d9; }
  .status-tsunami { color:#954239; background:#f7e6e2; }
  .status-sunk { color:#665c72; background:#eeeaf2; }
  .mail-chevron { color:#ab9579; transition:transform .25s; font-size:18px; }
  .mail[open] .mail-chevron { transform:rotate(90deg); }
  .mail-body { padding:4px 24px 22px; border-top:1px dashed var(--line); }
  .mail[open] .mail-body { animation:unfold .25s ease; }
  .mail .head { display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:11px; color:var(--muted); padding-top:16px; }
  .mail .mail-topic { font:18px Georgia,"Songti SC",serif; margin:15px 0 4px; }
  .reply-quote { border-left:2px solid #d3bea0; padding:8px 14px; background:#f7f1e6; margin:12px 0; border-radius:0 6px 6px 0; }
  .reply-quote-label { font-size:11px; color:var(--accent); }
  .mail-foot { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding-top:14px; border-top:1px solid var(--line); }
  .mail-actions { display:flex; align-items:center; gap:10px; }
  .link { border:0; background:none; color:var(--accent); padding:4px 0; font-size:12px; text-decoration:underline; text-underline-offset:4px; }
  .link:hover { color:var(--seal); }
  .link.mini { font-size:11px; color:var(--muted); }
  .read-together { border:1px solid #c5d4ca; background:#edf2ec; color:var(--sea); border-radius:6px; padding:7px 12px; font-size:12px; transition:background .2s; }
  .read-together:hover { background:#dce8df; }
  .foot { margin:30px auto 0; color:var(--muted); font-size:11px; text-align:center; line-height:2; }
  .foot details { margin-top:12px; }
  .foot code { font-size:10px; overflow-wrap:anywhere; }
  .toast { position:fixed; z-index:10; left:50%; bottom:25px; transform:translate(-50%,12px); padding:12px 22px; background:var(--ink); color:#fff9ed; border-radius:10px; box-shadow:0 6px 24px #352f2822; font-size:13px; max-width:min(90vw,540px); width:max-content; opacity:0; pointer-events:none; transition:opacity .2s,transform .2s; }
  .toast.on { opacity:1; transform:translate(-50%,0); }
  .toast.bad { background:var(--seal); }
  .enter { animation:arrive .5s ease both; }
  @keyframes arrive { from { opacity:0; translate:0 10px; } to { opacity:1; translate:0 0; } }
  @keyframes unfold { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media(max-width:800px) { body { padding:0 20px 32px; } .hero { grid-template-columns:1fr 210px; padding:30px 0; } .hero-art { transform:scale(.8); transform-origin:right center; } .toolbar { padding-left:0; padding-right:0; } .book-layout { grid-template-columns:170px minmax(0,1fr); } .mail-folders { padding:20px 10px; } .mail-content { padding:20px; } }
  @media(max-width:560px) { body { padding:0 14px 30px; } .masthead { padding:19px 0; } .masthead .sub { font-size:10px; } .hero { grid-template-columns:1fr; padding:26px 3px 22px; } .hero-art { display:none; } .hero h2 { font-size:29px; } .toolbar { gap:12px; } .toolbar .actions { width:100%; display:grid; grid-template-columns:1fr 1fr; } .action-main { padding:14px 13px; gap:10px; } .action-main small { font-size:9px; } #action-note { max-width:none; } .desk { padding-top:20px; } .card { padding:23px 20px; } .letter { font-size:17px; } .book > summary { padding:18px; flex-wrap:wrap; gap:8px; } .book-title { font-size:20px; } .book-count { font-size:10px; } .fold-label { padding:0; } .book-layout { display:block; } .mail-folders { border-right:0; border-bottom:1px solid var(--line); display:grid; grid-template-columns:1fr 1fr; padding:12px; gap:5px; } .folder { margin:0; padding:10px; gap:7px; } .folder-label,.folder-note { display:none; } .mail-content { padding:18px 14px; } .mail > summary { padding:14px 12px; gap:10px; } .mail-subject strong { font-size:15px; } .mail-symbol { width:32px; height:39px; } .mail-body { padding:2px 16px 18px; } }
  @media(max-width:560px) { .masthead .sub { display:none; } .brand small { white-space:nowrap; font-size:8px; } .card { min-width:0; } }
  @media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }
`;
