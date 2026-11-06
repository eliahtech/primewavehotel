// site.js — mobile menu + account chip, shared by every public page.
(function(){
  'use strict';
  var nav = document.getElementById('siteNav'), ham = document.getElementById('siteHam'), root = document.documentElement;
  function close(){ if(!nav) return; nav.classList.remove('open'); root.classList.remove('nav-open'); if(ham){ ham.setAttribute('aria-expanded','false'); ham.textContent='☰'; } }
  function toggle(){ var o = !nav.classList.contains('open'); nav.classList.toggle('open',o); root.classList.toggle('nav-open',o); ham.setAttribute('aria-expanded',String(o)); ham.textContent = o ? '✕' : '☰'; }
  if(ham && nav){
    ham.addEventListener('click', toggle);
    nav.addEventListener('click', function(e){ if(e.target.closest('a')) close(); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') close(); });
    window.addEventListener('resize', function(){ if(window.innerWidth>860) close(); });
  }

  var HOME = {systemowner:'/systemowner.html', owner:'/owner.html', admin:'/admin.html'};
  function refresh(){
    var a = document.getElementById('navAcct'); if(!a) return;
    var tok = null, user = null;
    try{ tok = sessionStorage.getItem('pw_token'); user = JSON.parse(sessionStorage.getItem('pw_user')||'null'); }catch(e){}
    try{ var p = JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if(p.exp && p.exp*1000 < Date.now()){ sessionStorage.clear(); tok = user = null; } }catch(e){ if(tok){ sessionStorage.clear(); tok = user = null; } }
    var av = a.querySelector('.av'), lb = a.querySelector('.lb');
    if(tok && user){
      a.href = HOME[user.role] || '/account.html'; a.classList.add('in');
      av.textContent = (user.name||user.email||'G').charAt(0).toUpperCase();
      lb.textContent = (user.name||user.email||'Account').split(' ')[0];
    } else {
      a.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search);
      a.classList.remove('in'); lb.textContent = 'Sign in';
    }
  }
  var here = location.pathname.replace(/\/index\.html$/,'/') || '/';
  document.querySelectorAll('#siteNav a:not(.nav-book):not(.nav-acct)').forEach(function(l){ if(l.getAttribute('href')===here) l.classList.add('active'); });
  window.PWnav = { refresh: refresh, close: close };
  refresh();
})();
