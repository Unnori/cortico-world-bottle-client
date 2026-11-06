/**
 * 小纸条的形状：一张暖黄的便签，右上角折起。
 *
 * 样式单独放在这里，方便 page-style 在“纸感·书信”主题里换成另一张便签纸，
 * 又不会被 page-extras 的旧样式按顺序盖掉。
 */

export const slipGeometry = `
  /* The note is its own stationery: a small, warm sheet with a folded corner. */
  .paper-slip { --slip-stock:linear-gradient(178deg,#fff9dc 0%,#fdf1c4 100%); --slip-tape:#ffe28966; --slip-ink:#5a4520; --slip-fold:22px;
    position:relative; box-sizing:border-box; display:flex; flex-direction:column; gap:10px; max-width:400px; margin:24px 0 4px;
    padding:20px 22px calc(18px + var(--slip-fold) * .35) 22px; border:1px solid #e7d69f;
    border-radius:3px 3px 3px 12px; background:var(--slip-stock); color:var(--slip-ink);
    box-shadow:0 14px 22px -18px #5a4520, 0 2px 0 #ffffff8c inset;
    font:15px/1.75 "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .paper-slip::before { content:''; position:absolute; top:-9px; left:50%; width:74px; height:18px; margin-left:-37px;
    background:repeating-linear-gradient(-45deg,var(--slip-tape) 0 5px,transparent 5px 10px);
    border-left:1px solid #ffffff66; border-right:1px solid #ffffff66; transform:rotate(-2.2deg); pointer-events:none; }
  .paper-slip::after { content:''; position:absolute; right:0; bottom:0; width:var(--slip-fold); height:var(--slip-fold);
    border-radius:0 0 12px 0;
    background:linear-gradient(225deg,#f1dda2 0 49%,transparent 50%), linear-gradient(45deg,transparent 49%,#d9c384 50%);
    box-shadow:-2px -2px 6px -4px #5a452055; pointer-events:none; }
  .paper-slip > * { position:relative; z-index:1; }
  .paper-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .paper-slip .paper-heading small { color:#8a6f36; font-size:11px; letter-spacing:.04em; }
  .paper-status { display:inline-block; border-radius:999px; padding:2px 9px; font-size:10.5px; line-height:1.6; letter-spacing:.04em; }
  .paper-status.paper-unread { color:#8a5a10; background:#ffe7b0; }
  .paper-status.paper-read { color:#3f6438; background:#e5efcd; }
  .paper-slip p { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; color:inherit; font-size:16px; line-height:1.85; letter-spacing:.02em; }
  .paper-slip small,.paper-slip .paper-hint,#paper-result { color:#8a6f36; font-size:11px; line-height:1.7; }
  .paper-slip .paper-hint { margin:0; }
  .paper-slip strong { color:var(--slip-ink); font-size:13px; letter-spacing:.04em; }
  .paper-slip .actions { display:flex; flex-wrap:wrap; gap:8px; margin:4px 0 0; }
  .paper-slip .btn { border:1px solid #c9b477; background:#ffffffb8; color:#4d3b17; border-radius:7px; padding:7px 14px; font-size:12px; box-shadow:none; }
  .paper-slip .btn:hover:not(:disabled) { background:#fff; transform:translateY(-1px); box-shadow:0 6px 12px -8px #5a4520; }
  .paper-slip .btn.ghost { background:transparent; border-color:#d8c692; color:#7a6128; }
  .paper-slip .read-together { border:1px dashed #c9a35a; background:#fff5cc; color:#7a5a12; border-radius:7px; padding:6px 12px; font-size:12px; }
  .paper-slip .paper-status { flex:none; }
  .paper-slip[hidden] { display:none; }
  .paper-slot { display:flex; flex-direction:column; align-items:center; }
  .paper-badge { color:var(--accent-text,var(--accent)); font-size:11px; }
  .paper-badge[hidden] { display:none; }
`;

/** 纸条贴在通信后；入场只由显式新草稿触发，不因轮询/重新挂载播放。 */
export const slipLayout = `
  .paper-slip { width:100%; max-width:520px; margin:14px 0 0; transform:none; animation:none; }
  .paper-tray { max-width:780px; margin:22px auto 0; padding:18px 0 0; border-top:1px dashed var(--line); }
  .paper-tray[hidden],.paper-invite[hidden] { display:none; }
  .paper-invite { display:flex; align-items:center; flex-wrap:wrap; gap:14px 22px; }
  .paper-invite-copy { flex:1 1 200px; min-width:0; }
  .paper-invite-copy strong { font-size:12px; font-weight:500; color:var(--ink); }
  .paper-invite-copy p { margin:5px 0 0; font-size:11px; line-height:1.8; color:var(--muted); }
  .paper-invite-button { flex:none; max-width:100%; white-space:normal; overflow-wrap:anywhere; }
  .paper-slot { gap:18px; }
  #paper-result:empty { display:none; }
  @media(max-width:560px) {
    .paper-slip { margin-top:18px; padding:16px 16px 20px; max-width:100%; }
    .paper-slip .btn,.paper-slip .read-together { flex:1 1 auto; }
  }
  @media(prefers-reduced-motion:reduce) {
    .paper-slip { animation:none; transform:none; }
  }
`;
