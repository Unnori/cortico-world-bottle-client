/** Reading size is device-local and deliberately independent of mailbox appearance. */
export const readerHtml = `
<aside class="reader-tools" id="reader-tools" aria-label="信件阅读设置">
  <button id="reader-toggle" class="reader-toggle" type="button" aria-expanded="false" aria-controls="reader-panel"><span aria-hidden="true">Aa</span><span>字号</span></button>
  <div id="reader-panel" class="reader-panel" hidden>
    <div class="reader-heading"><label for="reader-size">正文字号</label><output id="reader-size-value" for="reader-size">26 px</output></div>
    <input id="reader-size" type="range" min="18" max="40" step="1" value="26" aria-describedby="reader-hint">
    <div class="reader-scale" aria-hidden="true"><span>18</span><span>40</span></div>
    <div class="reader-footer"><small id="reader-hint">正文与信内标题<br>记住这台设备的习惯</small><button id="reader-reset" type="button">默认</button></div>
  </div>
</aside>`;

export const readerScript = String.raw`
  var readerTools = document.getElementById('reader-tools');
  var readerToggle = document.getElementById('reader-toggle');
  var readerPanel = document.getElementById('reader-panel');
  var readerSize = document.getElementById('reader-size');
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
  document.getElementById('reader-reset').onclick = function () { applyReadingSize(26, true); };
  function closeReader(returnFocus) {
    readerToggle.setAttribute('aria-expanded', 'false');
    dismissAnimated(readerPanel, function () { readerPanel.hidden = true; });
    if (returnFocus) readerToggle.focus();
  }
  readerToggle.onclick = function () {
    if (readerToggle.getAttribute('aria-expanded') === 'true') { closeReader(false); return; }
    if (readerPanel._dismissAnimation) { readerPanel._dismissAnimation.cancel(); readerPanel._dismissAnimation = null; }
    readerToggle.setAttribute('aria-expanded', 'true');
    readerPanel.hidden = false;
    reveal(readerPanel);
  };
  document.addEventListener('click', function (event) {
    if (readerToggle.getAttribute('aria-expanded') === 'true' && !readerTools.contains(event.target)) closeReader(false);
  });
  readerTools.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && readerToggle.getAttribute('aria-expanded') === 'true') { event.preventDefault(); closeReader(true); }
  });
`;
