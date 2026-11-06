// Shared helpers for staff consoles (owner.html, systemowner.html).
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kes = n => 'KES ' + Number(n||0).toLocaleString();
const dt  = v => v ? new Date(v).toLocaleString('en-GB',{timeZone:'Africa/Nairobi',dateStyle:'short',timeStyle:'short'}) : '';
const LEVEL = {user:1,admin:2,owner:3,systemowner:4};
let TOKEN = sessionStorage.getItem('pw_token');
let USER = null; try{ USER = JSON.parse(sessionStorage.getItem('pw_user')||'null'); }catch(e){}
const ME = LEVEL[USER && USER.role] || 0;

function logout(){ sessionStorage.clear(); location.href='/login.html'; }
function gate(minRole){
  if(!TOKEN || !USER){ location.href='/login.html?redirect='+encodeURIComponent(location.pathname); return false; }
  if(ME < LEVEL[minRole]){ location.href = ME>=2 ? '/admin.html' : '/book.html'; return false; }
  $('who').textContent = USER.name+' · '+USER.role;
  return true;
}
function note(t, ok){ const m=$('msg'); m.textContent=t; m.className='msg '+(ok?'ok':'err'); scrollTo(0,0); setTimeout(()=>m.className='msg',7000); }
async function api(method, path, body){
  const r = await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+TOKEN},body:body?JSON.stringify(body):undefined});
  if(r.status===401){ logout(); return {status:'error',message:'Signed out.'}; }
  try{ return await r.json(); }catch(e){ return {status:'error',message:'Bad server response.'}; }
}
function tabs(list, loaders){
  $('tabs').innerHTML = list.map(t=>'<button data-t="'+t[0]+'">'+t[1]+'</button>').join('');
  const go = t => {
    document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
    document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id==='p-'+t));
    history.replaceState(null,'','#'+t); loaders[t]();
  };
  $('tabs').addEventListener('click',e=>{ if(e.target.dataset.t) go(e.target.dataset.t); });
  go(list.find(t=>'#'+t[0]===location.hash) ? location.hash.slice(1) : list[0][0]);
}
// Dependency-free SVG bar chart
function bars(el, data){
  if(!data.length){ el.innerHTML='<p style="color:var(--muted);font-size:13px">No data yet.</p>'; return; }
  const W=640,H=180,P=24, max=Math.max(1,...data.map(d=>d.value)), bw=(W-P*2)/data.length;
  el.innerHTML='<svg viewBox="0 0 '+W+' '+(H+34)+'" style="width:100%;height:auto">'
   + data.map((d,i)=>{ const h=Math.round((d.value/max)*H), x=P+i*bw;
      return '<rect x="'+(x+bw*0.15)+'" y="'+(H-h+8)+'" width="'+(bw*0.7)+'" height="'+h+'" rx="3" fill="#0a3d62"><title>'+esc(d.label)+': '+kes(d.value)+'</title></rect>'
        + (data.length<=14 || i%Math.ceil(data.length/12)===0 ? '<text x="'+(x+bw/2)+'" y="'+(H+26)+'" font-size="10" text-anchor="middle" fill="#6b7280">'+esc(d.label)+'</text>':''); }).join('')
   + '</svg>';
}
function csv(rows, name){
  const q = v => '"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const blob = new Blob([rows.map(r=>r.map(q).join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href);
}
