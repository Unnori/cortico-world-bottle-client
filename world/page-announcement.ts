/** Render announcement URLs as links while keeping all other content as plain text. */
export const announcementLinksScript = String.raw`
  function appendAnnouncementText(container, text) {
    var pattern = /https?:\/\/[^\s<>"'，。！？；：、（）【】《》「」]+/gi;
    var match, offset = 0;
    while ((match = pattern.exec(text)) !== null) {
      var candidate = match[0].replace(/[.,!?;:]+$/, '');
      // Keep closing brackets that belong to the URL, but leave prose punctuation outside.
      var pairs = { ')': '(', ']': '[', '}': '{' };
      while (pairs[candidate.slice(-1)]) {
        var closing = candidate.slice(-1), opening = pairs[closing];
        if (candidate.split(closing).length <= candidate.split(opening).length) break;
        candidate = candidate.slice(0, -1).replace(/[.,!?;:]+$/, '');
      }
      var url;
      try { url = new URL(candidate); } catch (_) { continue; }
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) continue;
      container.appendChild(document.createTextNode(text.slice(offset, match.index)));
      var link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = candidate;
      container.appendChild(link);
      offset = match.index + candidate.length;
    }
    container.appendChild(document.createTextNode(text.slice(offset)));
  }
`;


/** Dismissal belongs to this browser origin and one World lifetime, never a server-wide read flag. */
export const announcementDismissScript = String.raw`
  var announcementDismissKey = 'bottle-announcement-dismissed-session';
  var announcementWorldSession = '';
  var announcementDismissedSession = '';
  try { announcementDismissedSession = localStorage.getItem(announcementDismissKey) || ''; } catch (_) {}
  function syncAnnouncementSession(session) {
    if (typeof session === 'string' && session) announcementWorldSession = session;
  }
  function pageAnnouncementsDismissed() {
    return !!announcementDismissedSession && announcementDismissedSession === (announcementWorldSession || 'page');
  }
  function dismissPageAnnouncements() {
    announcementDismissedSession = announcementWorldSession || 'page';
    // Old/isolated pages without World metadata can still dismiss in memory for this tab.
    if (announcementWorldSession) {
      try { localStorage.setItem(announcementDismissKey, announcementDismissedSession); } catch (_) {}
    }
  }
  if (window.addEventListener) window.addEventListener('storage', function (event) {
    if (event.key !== announcementDismissKey && event.key !== null) return;
    announcementDismissedSession = event.newValue || '';
    if (state) renderNotices();
  });
`;
