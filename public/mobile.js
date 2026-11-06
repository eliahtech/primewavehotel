// Labels every table cell with its column header so the CSS can render tables as cards on phones.
(function(){
  function label(tbl){
    var heads = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function(t){ return t.textContent; });
    tbl.querySelectorAll('tbody tr').forEach(function(tr){
      Array.prototype.forEach.call(tr.children, function(td,i){ if(heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]); });
    });
  }
  function watch(){
    document.querySelectorAll('.tbl table').forEach(function(tbl){
      label(tbl);
      new MutationObserver(function(){ label(tbl); }).observe(tbl.tBodies[0], {childList:true});
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
