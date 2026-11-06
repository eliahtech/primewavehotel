// news.js — renders news cards and articles. Everything that came from the API is HTML-escaped before it touches the page.
(function (root) {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var date = function (v) { return v ? new Date(v).toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'long', year: 'numeric' }) : ''; };
  var safeImg = function (u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : ''; };

  function card(n) {
    var img = safeImg(n.image_url);
    return '<a class="n-card" href="/news.html?id=' + encodeURIComponent(n.id) + '">' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback>' : '<div class="ph">PRIMEWAVE</div>') +
      '<div class="b"><div class="meta">' + (n.pinned ? '<span class="pin">📌 Pinned</span>' : '') + '<span>' + esc(date(n.published_at)) + '</span></div>' +
      '<h3>' + esc(n.title) + '</h3><p>' + esc(n.summary) + '</p><span class="more">Read more →</span></div></a>';
  }

  function article(n) {
    var img = safeImg(n.image_url);
    var paras = String(n.body || '').split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
    return '<a class="back" href="/news.html">← All news</a><h1>' + esc(n.title) + '</h1>' +
      '<div class="meta">' + esc(date(n.published_at)) + ' · By ' + esc(n.author_name || 'PrimeWave Hotel') + '</div>' +
      (img ? '<img class="cover" src="' + esc(img) + '" alt="" referrerpolicy="no-referrer" data-fallback>' : '') + '<div class="txt">' + paras + '</div>';
  }

  function fallbacks(el) {   // a broken cover image should never leave a hole in the layout
    el.querySelectorAll('img[data-fallback]').forEach(function (im) {
      im.addEventListener('error', function () { var d = document.createElement('div'); d.className = im.className === 'cover' ? '' : 'ph'; if (d.className) { d.textContent = 'PRIMEWAVE'; im.replaceWith(d); } else im.remove(); }, { once: true });
    });
  }

  async function get(path) { var r = await fetch('/api/news' + path); var j = await r.json().catch(function () { return {}; }); if (!r.ok) { var e = new Error(j.message || 'Request failed'); e.status = r.status; throw e; } return j; }

  // Home page: the three latest stories (the section stays hidden when there are none)
  async function mountLatest(gridId, sectionId, limit) {
    try {
      var j = await get('?limit=' + (limit || 3)), list = (j.data || []).slice(0, limit || 3);
      if (!list.length) return;
      var g = document.getElementById(gridId); g.innerHTML = list.map(card).join(''); fallbacks(g);
      document.getElementById(sectionId).hidden = false;
    } catch (e) { /* the news block is optional on the home page */ }
  }

  root.PWNews = { card: card, article: article, fallbacks: fallbacks, get: get, mountLatest: mountLatest, esc: esc, date: date };
})(window);
