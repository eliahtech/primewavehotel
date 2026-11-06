// guard.js — load synchronously in <head> of every signed-in page:
//   <script src="/guard.js" data-min="admin"></script>
// Keeps the page from ever rendering for visitors who are signed out, expired, or under-privileged,
// and re-checks when the browser restores the page from its back/forward cache after sign-out.
// This is a UX layer. The real protection is on the server: every data route requires a valid token and role.
(function () {
  'use strict';
  var LEVEL = { user: 1, admin: 2, owner: 3, systemowner: 4 };
  var HOME  = { user: '/account.html', admin: '/admin.html', owner: '/owner.html', systemowner: '/systemowner.html' };
  var tag = document.currentScript;
  var min = (tag && tag.getAttribute('data-min')) || 'user';

  function jwtExpired(tok) {
    try {
      var p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return !!(p.exp && p.exp * 1000 < Date.now());
    } catch (e) { return true; }               // not a readable token → treat as invalid
  }

  /** @returns {string|null} where to send the visitor, or null if they may stay */
  function verdict() {
    var tok = null, user = null;
    try { tok = sessionStorage.getItem('pw_token'); user = JSON.parse(sessionStorage.getItem('pw_user') || 'null'); } catch (e) {}
    if (!tok || !user || jwtExpired(tok)) {
      try { sessionStorage.removeItem('pw_token'); sessionStorage.removeItem('pw_user'); } catch (e) {}
      return '/login.html?redirect=' + encodeURIComponent(location.pathname);
    }
    if ((LEVEL[user.role] || 0) < (LEVEL[min] || 1)) return HOME[user.role] || '/account.html';
    return null;
  }

  function enforce() {
    var to = verdict();
    if (to) { document.documentElement.style.display = 'none'; location.replace(to); }
  }
  enforce();
  window.addEventListener('pageshow', function (e) { if (e.persisted) enforce(); });
})();
