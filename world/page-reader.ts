/** Reading size is device-local and deliberately independent of mailbox appearance. */
export const readerHtml = `
<aside class="reader-tools" id="reader-tools" aria-label="信件阅读设置">
  <span id="reader-safe-area" class="reader-safe-area" aria-hidden="true"></span>
  <button id="reader-toggle" class="reader-toggle" type="button" aria-expanded="false" aria-controls="reader-panel" aria-label="调整信件字号"><span class="reader-label" aria-hidden="true">Aa</span><span class="reader-label">字号</span><svg class="reader-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
  <div id="reader-panel" class="reader-panel" hidden>
    <div class="reader-heading"><label for="reader-size">正文字号</label><output id="reader-size-value" for="reader-size">26 px</output></div>
    <input id="reader-size" type="range" min="18" max="40" step="1" value="26">
  </div>
</aside>`;

export const readerStyles = `
  .reader-tools { position:fixed; z-index:30; left:max(8px,env(safe-area-inset-left)); top:50%; width:44px; }
  .reader-safe-area { position:fixed; inset:0; padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left)); visibility:hidden; pointer-events:none; }
  #bottle-mailbox .reader-toggle { display:grid; justify-items:center; gap:1px; width:100%; min-width:0; border:1px solid var(--line); background:var(--card); color:var(--ink); touch-action:none; user-select:none; -webkit-user-select:none; padding:9px 7px; border-radius:12px; box-shadow:0 4px 18px color-mix(in srgb,var(--backdrop) 18%,transparent); font-size:10px; }
  #bottle-mailbox .reader-tools[data-dragging=true] .reader-toggle { cursor:grabbing; transform:none; }
  #bottle-mailbox .reader-toggle:focus-visible { outline:2px solid var(--focus); outline-offset:3px; }
  .reader-toggle .reader-label:first-child { font:20px Georgia,serif; }
  .reader-arrow { display:none; width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .reader-tools[data-compact=true] { width:28px; }
  #bottle-mailbox .reader-tools[data-compact=true] .reader-toggle { min-height:44px; padding:10px 4px; border-radius:8px; }
  .reader-tools[data-compact=true] .reader-label { display:none; }
  .reader-tools[data-compact=true] .reader-arrow { display:block; }
  .reader-tools[data-edge=right] .reader-arrow { transform:rotate(180deg); }
  .reader-panel { position:absolute; left:calc(100% + 10px); top:0; box-sizing:border-box; width:232px; padding:18px; overflow:auto; overscroll-behavior:contain; border:1px solid var(--line); border-radius:16px; background:var(--card); color:var(--ink); box-shadow:0 8px 32px color-mix(in srgb,var(--backdrop) 28%,transparent); }
  .reader-panel[hidden] { display:none; }
  .reader-heading { font-size:13px; font-weight:600; }
  #reader-size-value { font-size:12px; font-variant-numeric:tabular-nums; color:var(--accent-text,var(--accent)); }
  #bottle-mailbox #reader-size { display:block; width:100%; height:32px; margin:14px 0 0; padding:0; accent-color:var(--accent); cursor:ew-resize; }
  @media(prefers-reduced-motion:reduce) { .reader-tools,.reader-tools * { animation:none!important; transition:none!important; } }
`;

export const readerScript = String.raw`
  var readerTools = document.getElementById('reader-tools');
  var readerToggle = document.getElementById('reader-toggle');
  var readerPanel = document.getElementById('reader-panel');
  var readerSize = document.getElementById('reader-size');
  var readerEdge = 'left', readerY = window.innerWidth <= 1200 ? 1 : .5;
  var readerX = 0, readerTop = 0, readerDrag = null, readerSnap = null, readerPanelSnap = null, readerSuppressClickUntil = 0;
  try {
    var readerSaved = JSON.parse(readPref('bottle-reader-dock', 'null'));
    if (readerSaved && (readerSaved.edge === 'left' || readerSaved.edge === 'right') &&
        typeof readerSaved.y === 'number' && Number.isFinite(readerSaved.y) && readerSaved.y >= 0 && readerSaved.y <= 1) {
      readerEdge = readerSaved.edge; readerY = readerSaved.y;
    }
  } catch (e) {}
  function readerClamp(value, min, max) { return Math.max(min, Math.min(Math.max(min, max), value)); }
  function readerBounds() {
    var viewport = window.visualViewport;
    var safe = window.getComputedStyle(document.getElementById('reader-safe-area'));
    var x = viewport ? viewport.offsetLeft : 0, y = viewport ? viewport.offsetTop : 0;
    var width = viewport ? viewport.width : document.documentElement.clientWidth || window.innerWidth;
    var height = viewport ? viewport.height : window.innerHeight;
    var tools = readerTools.getBoundingClientRect();
    return { left: x + parseFloat(safe.paddingLeft), top: y + parseFloat(safe.paddingTop),
      right: x + width - parseFloat(safe.paddingRight), bottom: y + height - parseFloat(safe.paddingBottom),
      toolWidth: tools.width, toolHeight: tools.height };
  }
  function layoutReaderPanel(bounds) {
    if (readerPanel.hidden) return;
    readerPanel.style.width = Math.max(1, Math.min(232, bounds.right - bounds.left)) + 'px';
    readerPanel.style.maxHeight = Math.max(1, bounds.bottom - bounds.top) + 'px';
    var panel = readerPanel.getBoundingClientRect();
    var preferredLeft = readerEdge === 'left' ? readerX + bounds.toolWidth + 10 : readerX - panel.width - 10;
    readerPanel.style.left = (readerClamp(preferredLeft, bounds.left, bounds.right - panel.width) - readerX) + 'px';
    readerPanel.style.top = (readerClamp(readerTop, bounds.top, bounds.bottom - panel.height) - readerTop) + 'px';
  }
  function positionReader(x, y, bounds) {
    readerX = readerClamp(x, bounds.left, bounds.right - bounds.toolWidth);
    readerTop = readerClamp(y, bounds.top, bounds.bottom - bounds.toolHeight);
    readerTools.style.left = readerX + 'px'; readerTools.style.top = readerTop + 'px';
    readerTools.dataset.edge = readerEdge;
    layoutReaderPanel(bounds);
  }
  function cancelReaderSnap() {
    if (readerSnap) { readerSnap.cancel(); readerSnap = null; }
    if (readerPanelSnap) { readerPanelSnap.cancel(); readerPanelSnap = null; }
  }
  function dockReader(animate) {
    var bounds = readerBounds(), old = readerTools.getBoundingClientRect();
    var oldPanel = readerPanel.hidden ? null : readerPanel.getBoundingClientRect();
    cancelReaderSnap();
    positionReader(readerEdge === 'left' ? bounds.left : bounds.right - bounds.toolWidth,
      bounds.top + readerY * Math.max(0, bounds.bottom - bounds.top - bounds.toolHeight), bounds);
    var dx = old.left - readerX, dy = old.top - readerTop;
    if (animate && !reducedMotion() && readerTools.animate && (dx || dy)) {
      var panel = readerPanel.hidden ? null : readerPanel.getBoundingClientRect();
      readerSnap = readerTools.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px)' },
        { transform: 'translate(0,0)' }
      ], { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' });
      // Counter the parent's translation so both panel endpoints stay inside the safe area.
      if (panel && oldPanel && readerPanel.animate) readerPanelSnap = readerPanel.animate([
        { transform: 'translate(' + (oldPanel.left - panel.left - dx) + 'px,' + (oldPanel.top - panel.top - dy) + 'px)' },
        { transform: 'translate(0,0)' }
      ], { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }
  function rememberReader() {
    var bounds = readerBounds(), travel = bounds.bottom - bounds.top - bounds.toolHeight;
    if (travel > 0) readerY = readerClamp((readerTop - bounds.top) / travel, 0, 1);
    savePref('bottle-reader-dock', JSON.stringify({ edge: readerEdge, y: readerY }));
  }
  readerTools.addEventListener('pointerdown', function (event) {
    if (readerDrag || event.isPrimary === false || event.button !== 0) return;
    readerSuppressClickUntil = 0;
    var source = readerToggle.contains(event.target) ? readerToggle : null;
    if (!source) return;
    var rect = readerTools.getBoundingClientRect();
    cancelReaderSnap();
    positionReader(rect.left, rect.top, readerBounds());
    readerDrag = { id: event.pointerId, source: source, x: event.clientX, y: event.clientY, left: readerX, top: readerTop, moved: false };
    try { source.setPointerCapture(event.pointerId); } catch (e) {}
  });
  function moveReader(event) {
    if (!readerDrag || readerDrag.id !== event.pointerId) return;
    var dx = event.clientX - readerDrag.x, dy = event.clientY - readerDrag.y;
    if (!readerDrag.moved && Math.hypot(dx, dy) < 6) return;
    readerDrag.moved = true; readerTools.dataset.dragging = 'true';
    event.preventDefault();
    positionReader(readerDrag.left + dx, readerDrag.top + dy, readerBounds());
  }
  function finishReaderDrag(event) {
    if (!readerDrag || (event && readerDrag.id !== event.pointerId)) return;
    if (event && event.type === 'pointerup') moveReader(event);
    var drag = readerDrag; readerDrag = null;
    delete readerTools.dataset.dragging;
    if (drag.moved) {
      var bounds = readerBounds();
      readerEdge = readerX + bounds.toolWidth / 2 <= (bounds.left + bounds.right) / 2 ? 'left' : 'right';
      readerSuppressClickUntil = Date.now() + 500;
      rememberReader(); dockReader(true);
    } else dockReader(true);
    try { drag.source.releasePointerCapture(drag.id); } catch (e) {}
  }
  readerTools.addEventListener('pointermove', moveReader);
  readerTools.addEventListener('pointerup', finishReaderDrag);
  readerTools.addEventListener('pointercancel', finishReaderDrag);
  readerTools.addEventListener('lostpointercapture', finishReaderDrag);
  readerTools.addEventListener('click', function (event) {
    if (event.detail !== 0 && Date.now() < readerSuppressClickUntil) {
      readerSuppressClickUntil = 0; event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  readerToggle.addEventListener('keydown', function (event) {
    if (event.altKey || event.ctrlKey || event.metaKey || readerDrag) return;
    var step = event.shiftKey ? 48 : 16, bounds = readerBounds();
    if (event.key === 'ArrowLeft') readerEdge = 'left';
    else if (event.key === 'ArrowRight') readerEdge = 'right';
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      positionReader(readerX, readerTop + (event.key === 'ArrowUp' ? -step : step), bounds);
    } else if (event.key === 'Home' || event.key === 'End') {
      positionReader(readerX, event.key === 'Home' ? bounds.top : bounds.bottom, bounds);
    } else return;
    event.preventDefault(); rememberReader(); dockReader(true);
  });
  function reflowReader() { finishReaderDrag(); dockReader(false); }
  window.addEventListener('resize', reflowReader);
  window.addEventListener('orientationchange', reflowReader);
  window.addEventListener('blur', function () { finishReaderDrag(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', reflowReader);
    window.visualViewport.addEventListener('scroll', reflowReader);
  }
  if (window.ResizeObserver) {
    var readerObserver = new window.ResizeObserver(function () { if (!readerDrag) dockReader(false); });
    readerObserver.observe(readerTools); readerObserver.observe(readerPanel);
  }
  dockReader(false);
  function applyReadingSize(value, persist) {
    var size = Number(value);
    if (!Number.isFinite(size) || size <= 0) size = 26;
    size = Math.max(18, Math.min(40, Math.round(size)));
    document.documentElement.style.setProperty('--letter-size', size + 'px');
    readerSize.value = String(size);
    readerSize.setAttribute('aria-valuetext', size + ' 像素');
    document.getElementById('reader-size-value').textContent = size + ' px';
    if (persist) savePref('bottle-reading-size', String(size));
  }
  applyReadingSize(readPref('bottle-reading-size', '26'), false);
  readerSize.oninput = function () { applyReadingSize(readerSize.value, true); };
  function closeReader(returnFocus) {
    readerToggle.setAttribute('aria-expanded', 'false');
    dismissAnimated(readerPanel, function () { readerPanel.hidden = true; dockReader(false); });
    if (returnFocus) readerToggle.focus();
  }
  readerToggle.onclick = function () {
    if (readerToggle.getAttribute('aria-expanded') === 'true') { closeReader(false); return; }
    delete readerTools.dataset.compact;
    if (readerPanel._dismissAnimation) { readerPanel._dismissAnimation.cancel(); readerPanel._dismissAnimation = null; }
    readerToggle.setAttribute('aria-expanded', 'true');
    readerPanel.hidden = false;
    dockReader(false);
    reveal(readerPanel);
  };
  window.addEventListener('scroll', function () {
    if (readerDrag || readerTools.dataset.compact === 'true') return;
    closeReader(false);
    readerTools.dataset.compact = 'true';
    dockReader(true);
  }, { passive: true });
  document.addEventListener('click', function (event) {
    if (readerToggle.getAttribute('aria-expanded') === 'true' && !readerTools.contains(event.target)) closeReader(false);
  });
  readerTools.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && readerToggle.getAttribute('aria-expanded') === 'true') { event.preventDefault(); closeReader(true); }
  });
`;
