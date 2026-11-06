// console.js — every dashboard module, written once. Admin, Owner and System Owner pages just choose which modules to show,
// so a higher role always has everything the lower roles have. (Needs staff.js loaded first.)
//
//   Console.start({ min: 'admin', modules: ['overview', 'bookings', …] })
(function () {
  'use strict';
  var REG = {}, ORDER = [];
  function def(id, label, min, html, init, load) { REG[id] = { id: id, label: label, min: min, html: html, init: init || function () {}, load: load || function () {} }; ORDER.push(id); }
  var badge = function (s, text) { return '<span class="badge ' + esc(s) + '">' + esc(text || s) + '</span>'; };
  var sel = function (f, opts, cur) { return '<select data-f="' + f + '">' + opts.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>'; };
  var rolesBelowMe = function () { return Object.keys(LEVEL).filter(function (r) { return LEVEL[r] < ME; }); };
  var row = function (cells) { return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; };
  var none = function (cols, text) { return '<tr><td colspan="' + cols + '">' + text + '</td></tr>'; };

  // ── Password dialog (admins set a password for a user and read it out / copy it) ──
  function genPassword() { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', n = 14, out = '', r = new Uint32Array(n); crypto.getRandomValues(r); for (var i = 0; i < n; i++) out += a[r[i] % a.length]; return out; }
  function askPassword(title, text) {
    return new Promise(function (resolve) {
      var d = $('dlg'), pw = $('dlg-pw'); $('dlg-title').textContent = title; $('dlg-text').textContent = text; $('dlg-err').textContent = ''; pw.value = '';
      d.hidden = false; pw.focus();
      function done(v) { d.hidden = true; d.onkeydown = null; resolve(v); }
      $('dlg-ok').onclick = function () { if (pw.value.length < 8 || pw.value.length > 72) { $('dlg-err').textContent = 'Use 8–72 characters.'; return; } done(pw.value); };
      $('dlg-cancel').onclick = function () { done(null); };
      $('dlg-gen').onclick = function () { pw.value = genPassword(); $('dlg-err').textContent = ''; };
      $('dlg-copy').onclick = function () { if (navigator.clipboard && pw.value) navigator.clipboard.writeText(pw.value); };
      d.onkeydown = function (e) { if (e.key === 'Escape') done(null); if (e.key === 'Enter') $('dlg-ok').click(); };
    });
  }

  // ════════════ OPERATIONS (admin) ════════════
  def('overview', 'Overview', 'admin', '<div class="grid" id="ov-stats"></div>', null, async function () {
    var j = await api('GET', '/dashboard'); if (j.status !== 'success') return note(j.message || 'Failed to load.'); var d = j.data;
    var S = [['Total revenue', kes(d.totalRevenue)], ['Online', kes(d.onlineRevenue)], ['Walk-in', kes(d.walkInRevenue)], ['Bookings', d.totalBookings], ['Confirmed', d.confirmed], ['Checked in', d.checkedIn],
      ['Pending', d.pending], ['Cancelled', d.cancelled], ['Rooms available', d.availableRooms + '/' + d.totalRooms], ['Tables available', d.availableTables + '/' + d.totalTables]];
    $('ov-stats').innerHTML = S.map(function (s) { return '<div class="stat"><b>' + esc(s[1]) + '</b><span>' + esc(s[0]) + '</span></div>'; }).join('');
  });

  def('bookings', 'Bookings', 'admin',
    '<div style="margin-bottom:10px"><select id="bk-f" style="width:auto"><option value="">All statuses</option><option>pending_payment</option><option>confirmed</option><option>checked_in</option><option>checked_out</option><option>cancelled</option></select></div>' +
    '<div class="tbl"><table><thead><tr><th>ID</th><th>Guest</th><th>Type</th><th>Check-in</th><th>Check-out</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead><tbody id="bk-t"></tbody></table></div>',
    function () {
      $('bk-f').addEventListener('change', function () { REG.bookings.load(); });
      $('bk-t').addEventListener('click', async function (e) {
        var id = e.target.dataset.bk, st = e.target.dataset.st; if (!id) return;
        if (st === 'cancelled' && !confirm('Cancel booking ' + id + '?')) return;
        var j = await api('PUT', '/bookings/' + encodeURIComponent(id), { status: st }); note(j.message || 'Done', j.status === 'success'); REG.bookings.load();
      });
    },
    async function () {
      var s = $('bk-f').value, j = await api('GET', '/bookings' + (s ? '?status=' + encodeURIComponent(s) : '')); if (j.status !== 'success') return note(j.message);
      $('bk-t').innerHTML = j.data.map(function (b) {
        var acts = [];
        if (b.status === 'confirmed') acts.push(['checked_in', 'Check in']);
        if (b.status === 'checked_in') acts.push(['checked_out', 'Check out']);
        if (['pending_payment', 'confirmed'].indexOf(b.status) >= 0) acts.push(['cancelled', 'Cancel']);
        return row([esc(b.booking_id), esc(b.guest_name) + '<br><small>' + esc(b.guest_phone) + '</small>', esc(b.type), dt(b.checkin_date), dt(b.checkout_date), kes(b.total_amount), badge(b.status, b.status.replace('_', ' ')),
          acts.map(function (a) { return '<button class="btn sm ' + (a[0] === 'cancelled' ? 'red' : '') + '" data-bk="' + esc(b.booking_id) + '" data-st="' + a[0] + '">' + a[1] + '</button>'; }).join(' ')]);
      }).join('') || none(8, 'No bookings.');
    });

  var WI = { rooms: [], tables: [] };
  def('walkin', 'Walk-in', 'admin',
    '<div class="card"><form class="form" id="wi-form">' +
    '<div><label>Type</label><select id="wi-type"><option value="room">Room</option><option value="table">Table</option></select></div>' +
    '<div><label>Room / table</label><select id="wi-item" required></select></div>' +
    '<div><label>Guest name</label><input id="wi-name" required></div><div><label>Phone</label><input id="wi-phone" required></div>' +
    '<div><label>Email (optional)</label><input id="wi-email" type="email"></div><div><label>National ID (7–8 digits)</label><input id="wi-nid" required inputmode="numeric"></div>' +
    '<div><label>Check-in</label><input id="wi-in" type="datetime-local" required></div><div><label>Check-out</label><input id="wi-out" type="datetime-local" required></div>' +
    '<div><label>Guests</label><input id="wi-guests" type="number" min="1" value="1" required></div><div><label>Amount paid (KES, incl. VAT)</label><input id="wi-amt" type="number" min="1" required></div>' +
    '<div><label>Method</label><select id="wi-method"><option>cash</option><option>mpesa</option><option>card</option><option>bank</option></select></div><div><label>Reference (optional)</label><input id="wi-ref"></div>' +
    '<div style="grid-column:1/-1"><button class="btn gold" id="wi-btn">Record walk-in</button></div></form></div>',
    function () {
      function fill() {
        var isT = $('wi-type').value === 'table', list = isT ? WI.tables : WI.rooms;
        $('wi-item').innerHTML = list.filter(function (i) { return ['maintenance', 'hidden'].indexOf(i.status) < 0; })
          .map(function (i) { return '<option value="' + esc(i.id) + '">' + (isT ? esc(i.table_name) + ' (' + esc(i.table_number) + ')' : 'Room ' + esc(i.room_number) + ' — ' + esc(i.room_type)) + '</option>'; }).join('');
      }
      REG.walkin.fill = fill; $('wi-type').addEventListener('change', fill);
      $('wi-form').addEventListener('submit', async function (e) {
        e.preventDefault(); var b = $('wi-btn'); b.disabled = true; var isT = $('wi-type').value === 'table';
        var body = { type: $('wi-type').value, guest_name: $('wi-name').value, guest_phone: $('wi-phone').value, guest_email: $('wi-email').value, national_id: $('wi-nid').value,
          checkin: $('wi-in').value, checkout: $('wi-out').value, guests: $('wi-guests').value, amount: $('wi-amt').value, method: $('wi-method').value, tracking_id: $('wi-ref').value };
        body[isT ? 'table_id' : 'room_id'] = $('wi-item').value;
        var j = await api('POST', '/payments/walk-in', body); b.disabled = false;
        note(j.status === 'success' ? 'Recorded: ' + j.booking_id : (j.message || 'Failed.'), j.status === 'success'); if (j.status === 'success') { e.target.reset(); fill(); }
      });
    },
    async function () { var r = await Promise.all([api('GET', '/rooms/admin/all'), api('GET', '/tables')]); WI.rooms = r[0].data || []; WI.tables = r[1].data || []; REG.walkin.fill(); });

  def('payments', 'Payments', 'admin',
    '<div class="tbl"><table><thead><tr><th>Date</th><th>Booking</th><th>Guest</th><th>Amount</th><th>Method</th><th>Source</th><th>Status</th></tr></thead><tbody id="pay-t"></tbody></table></div>', null,
    async function () {
      var j = await api('GET', '/payments'); if (j.status !== 'success') return note(j.message);
      $('pay-t').innerHTML = j.data.map(function (p) { return row([dt(p.created_at), esc(p.booking_id), esc(p.guest_name), kes(p.amount), esc(p.method), esc(p.source), badge(p.status)]); }).join('') || none(7, 'No payments.');
    });

  // Rooms & tables: admins change status; owners and system owners also add, edit prices and delete
  def('rooms', 'Rooms & tables', 'admin',
    function () {
      var full = ME >= 3;
      return (full ? '<div class="card" style="margin-bottom:14px"><h3>Add room</h3><form class="form" id="rm-addroom">' +
        '<div><label>Room number</label><input id="r-num" required></div><div><label>Type</label><input id="r-type" required placeholder="Deluxe"></div>' +
        '<div><label>Price / night (KES)</label><input id="r-price" type="number" min="1" required></div><div><label>Max guests</label><input id="r-max" type="number" min="1" value="2" required></div>' +
        '<div><label>Image URL</label><input id="r-img" type="url"></div><div><label>Description</label><input id="r-desc"></div>' +
        '<div><label>Air conditioning</label><select id="r-ac"><option value="true">Yes</option><option value="false">No</option></select></div><div style="align-self:end"><button class="btn gold">Add room</button></div></form></div>' : '') +
        '<h3>Rooms</h3><div class="tbl"><table><thead><tr><th>Room</th><th>Type</th><th>Price/night</th><th>Max</th><th>Status</th><th></th></tr></thead><tbody id="rm-rooms"></tbody></table></div>' +
        (full ? '<div class="card" style="margin-bottom:14px"><h3>Add table</h3><form class="form" id="rm-addtable">' +
        '<div><label>Table number</label><input id="tb-num" required></div><div><label>Name</label><input id="tb-name"></div><div><label>Seats</label><input id="tb-seats" type="number" min="1" required></div>' +
        '<div><label>Location</label><input id="tb-loc" placeholder="Garden"></div><div><label>Price / hour (KES)</label><input id="tb-price" type="number" min="0" value="0"></div><div style="align-self:end"><button class="btn gold">Add table</button></div></form></div>' : '') +
        '<h3>Tables</h3><div class="tbl"><table><thead><tr><th>Table</th><th>Seats</th><th>Price/hour</th><th>Status</th><th></th></tr></thead><tbody id="rm-tables"></tbody></table></div>';
    },
    function () {
      async function act(e) {
        var a = e.target.dataset.a, tr = e.target.closest('tr'); if (!a || !tr) return; var k = tr.dataset.k, id = encodeURIComponent(tr.dataset.id);
        if (a === 'del') { if (!confirm('Delete this item? It is archived first, but it will disappear from the site.')) return; var d = await api('DELETE', '/' + k + '/' + id); note(d.message || 'Done', d.status === 'success'); return REG.rooms.load(); }
        var body = {}; tr.querySelectorAll('[data-f]').forEach(function (i) { body[i.dataset.f] = i.value; });
        var j = await api('PUT', '/' + k + '/' + id, body); note(j.message || 'Saved', j.status === 'success'); REG.rooms.load();
      }
      $('rm-rooms').addEventListener('click', act); $('rm-tables').addEventListener('click', act);
      if (ME >= 3) {
        $('rm-addroom').addEventListener('submit', async function (e) { e.preventDefault();
          var j = await api('POST', '/rooms', { room_number: $('r-num').value, room_type: $('r-type').value, price_per_night: $('r-price').value, max_guests: $('r-max').value, image_url: $('r-img').value, description: $('r-desc').value, has_ac: $('r-ac').value });
          note(j.message || 'Done', j.status === 'success'); if (j.status === 'success') { e.target.reset(); REG.rooms.load(); } });
        $('rm-addtable').addEventListener('submit', async function (e) { e.preventDefault();
          var j = await api('POST', '/tables', { table_number: $('tb-num').value, table_name: $('tb-name').value, seats: $('tb-seats').value, location: $('tb-loc').value, price_per_hour: $('tb-price').value });
          note(j.message || 'Done', j.status === 'success'); if (j.status === 'success') { e.target.reset(); REG.rooms.load(); } });
      }
    },
    async function () {
      var full = ME >= 3, r = await Promise.all([api('GET', '/rooms/admin/all'), api('GET', '/tables')]);
      var btns = '<button class="btn sm" data-a="save">Save</button>' + (full ? ' <button class="btn sm red" data-a="del">Delete</button>' : '');
      var num = function (f, v, w, min) { return '<input data-f="' + f + '" type="number" min="' + min + '" value="' + esc(v) + '" style="width:' + w + 'px">'; };
      $('rm-rooms').innerHTML = (r[0].data || []).map(function (x) {
        return '<tr data-id="' + esc(x.id) + '" data-k="rooms"><td>Room ' + esc(x.room_number) + '</td><td>' + (full ? '<input data-f="room_type" value="' + esc(x.room_type) + '" size="10">' : esc(x.room_type)) + '</td>' +
          '<td>' + (full ? num('price_per_night', x.price_per_night, 90, 1) : kes(x.price_per_night)) + '</td><td>' + (full ? num('max_guests', x.max_guests, 60, 1) : esc(x.max_guests)) + '</td>' +
          '<td>' + sel('status', ['available', 'occupied', 'maintenance', 'hidden'], x.status) + '</td><td>' + btns + '</td></tr>'; }).join('') || none(6, 'No rooms.');
      $('rm-tables').innerHTML = (r[1].data || []).map(function (t) {
        return '<tr data-id="' + esc(t.id) + '" data-k="tables"><td>' + esc(t.table_name) + ' (' + esc(t.table_number) + ')</td><td>' + (full ? num('seats', t.seats, 60, 1) : esc(t.seats)) + '</td>' +
          '<td>' + (full ? num('price_per_hour', t.price_per_hour, 90, 0) : kes(t.price_per_hour)) + '</td><td>' + sel('status', ['available', 'reserved', 'maintenance'], t.status) + '</td><td>' + btns + '</td></tr>'; }).join('') || none(5, 'No tables.');
    });

  // ════════════ NEWS (admin) ════════════
  var NEWS = { editing: null, list: [] };
  def('news', 'News', 'admin',
    '<div class="card" style="margin-bottom:14px"><h3 id="nw-ftitle">Write a story</h3><form class="form" id="nw-form">' +
    '<div style="grid-column:1/-1"><label for="nw-title">Headline</label><input id="nw-title" maxlength="150" required></div>' +
    '<div style="grid-column:1/-1"><label for="nw-sum">Short summary <small>(optional — shown on the news cards)</small></label><input id="nw-sum" maxlength="300"></div>' +
    '<div style="grid-column:1/-1"><label for="nw-body">Story</label><textarea id="nw-body" rows="8" maxlength="20000" required></textarea><div class="hint" id="nw-count" style="font-size:12px;color:var(--muted);margin-top:4px"></div></div>' +
    '<div><label for="nw-img">Cover image link <small>(optional, https://…)</small></label><input id="nw-img" type="url" inputmode="url" placeholder="https://…"></div>' +
    '<div><label for="nw-status">When</label><select id="nw-status"><option value="published">Publish now</option><option value="draft">Save as draft</option></select></div>' +
    '<div><label for="nw-pin">Pin to the top</label><select id="nw-pin"><option value="false">No</option><option value="true">Yes</option></select></div>' +
    '<div style="grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap"><button class="btn gold" id="nw-save">Publish story</button><button type="button" class="btn ghost" id="nw-cancel" style="display:none">Cancel edit</button><a class="btn ghost" href="/news.html" target="_blank" rel="noopener">Open news page</a></div></form></div>' +
    '<div class="tbl"><table><thead><tr><th>Headline</th><th>Status</th><th>Author</th><th>Date</th><th></th></tr></thead><tbody id="nw-t"></tbody></table></div>',
    function () {
      function reset() { NEWS.editing = null; $('nw-form').reset(); $('nw-ftitle').textContent = 'Write a story'; $('nw-cancel').style.display = 'none'; label(); count(); }
      function label() { $('nw-save').textContent = NEWS.editing ? 'Save changes' : ($('nw-status').value === 'draft' ? 'Save draft' : 'Publish story'); }
      function count() { $('nw-count').textContent = $('nw-body').value.length.toLocaleString() + ' / 20,000 characters'; }
      $('nw-status').addEventListener('change', label); $('nw-body').addEventListener('input', count); $('nw-cancel').addEventListener('click', reset);
      $('nw-form').addEventListener('submit', async function (e) {
        e.preventDefault(); var b = $('nw-save'); b.disabled = true;
        var body = { title: $('nw-title').value, summary: $('nw-sum').value, body: $('nw-body').value, image_url: $('nw-img').value, status: $('nw-status').value, pinned: $('nw-pin').value === 'true' };
        var j = NEWS.editing ? await api('PUT', '/news/' + encodeURIComponent(NEWS.editing), body) : await api('POST', '/news', body);
        b.disabled = false; note(j.message || 'Failed.', j.status === 'success'); if (j.status === 'success') { reset(); REG.news.load(); }
      });
      $('nw-t').addEventListener('click', async function (e) {
        var a = e.target.dataset.a, id = e.target.dataset.id; if (!a) return;
        var p = NEWS.list.filter(function (x) { return x.id === id; })[0]; if (!p) return;
        if (a === 'edit') {
          NEWS.editing = p.id; $('nw-title').value = p.title; $('nw-sum').value = p.summary || ''; $('nw-body').value = p.body; $('nw-img').value = p.image_url || '';
          $('nw-status').value = p.status; $('nw-pin').value = String(!!p.pinned); $('nw-ftitle').textContent = 'Edit story'; $('nw-cancel').style.display = ''; label(); count(); return scrollTo(0, 0);
        }
        var j;
        if (a === 'toggle') j = await api('PUT', '/news/' + encodeURIComponent(id), { status: p.status === 'published' ? 'draft' : 'published' });
        if (a === 'del') { if (!confirm('Delete “' + p.title + '”? This cannot be undone.')) return; j = await api('DELETE', '/news/' + encodeURIComponent(id)); if (NEWS.editing === id) reset(); }
        note((j && j.message) || 'Done', j && j.status === 'success'); REG.news.load();
      });
      count();
    },
    async function () {
      var j = await api('GET', '/news/manage/all'); if (j.status !== 'success') return note(j.message); NEWS.list = j.data;
      $('nw-t').innerHTML = j.data.map(function (p) {
        var can = ME >= 3 || p.author_id === USER.user_id;
        return row([(p.pinned ? '📌 ' : '') + esc(p.title), badge(p.status === 'published' ? 'confirmed' : 'pending', p.status), esc(p.author_name || '') + '<br><small>' + esc(p.author_role || '') + '</small>', dt(p.published_at || p.created_at),
          can ? '<button class="btn sm ghost" data-a="edit" data-id="' + esc(p.id) + '">Edit</button> <button class="btn sm ghost" data-a="toggle" data-id="' + esc(p.id) + '">' + (p.status === 'published' ? 'Unpublish' : 'Publish') + '</button> <button class="btn sm red" data-a="del" data-id="' + esc(p.id) + '">Delete</button>' : '<small>Only the author or an owner can change this.</small>']);
      }).join('') || none(5, 'No stories yet — write the first one above.');
    });

  // ════════════ USERS (admin: guests+admins · owner: +owners · system owner: everyone) ════════════
  var USERS = [];
  def('users', 'Users', 'admin',
    function () {
      var roles = rolesBelowMe();
      return (ME >= 3 ? '<div class="card" style="margin-bottom:14px"><h3>Create account</h3><form class="form" id="us-form">' +
        '<div><label>Name</label><input id="us-name" required></div><div><label>Email</label><input id="us-email" type="email" required></div><div><label>Phone</label><input id="us-phone" required></div>' +
        '<div><label>Temporary password (min 8)</label><input id="us-pass" type="password" minlength="8" maxlength="72" required autocomplete="new-password"></div>' +
        '<div><label>Role</label><select id="us-role">' + roles.map(function (r) { return '<option' + (r === 'admin' ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></div>' +
        '<div style="align-self:end"><button class="btn gold">Create</button></div></form></div>' : '') +
        '<div style="margin-bottom:10px"><input id="us-q" type="search" placeholder="Search name, email or role…" style="max-width:340px"></div>' +
        '<div class="tbl"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Last login</th><th>Actions</th></tr></thead><tbody id="us-t"></tbody></table></div>';
    },
    function () {
      if (ME >= 3) $('us-form').addEventListener('submit', async function (e) { e.preventDefault();
        var j = await api('POST', '/users', { name: $('us-name').value, email: $('us-email').value, phone: $('us-phone').value, password: $('us-pass').value, role: $('us-role').value });
        note(j.message || 'Done', j.status === 'success'); if (j.status === 'success') { e.target.reset(); REG.users.load(); } });
      $('us-q').addEventListener('input', render);
      $('us-t').addEventListener('click', async function (e) {
        var a = e.target.dataset.a, tr = e.target.closest('tr'); if (!a || !tr) return;
        var id = tr.dataset.id, email = tr.dataset.email, enc = encodeURIComponent(id), j;
        if (a === 'pw') {
          var pw = await askPassword('Set a new password', 'For ' + email + '. They are emailed that it was changed and signed out of every device. Tell them the password privately.');
          if (!pw) return; j = await api('POST', '/auth/reset-password', { target_user_id: id, new_password: pw });
          return note(j.status === 'success' ? 'Password updated for ' + email + '.' : (j.message || 'Failed.'), j.status === 'success');
        }
        if (a === 'role') j = await api('PUT', '/users/' + enc, { role: tr.querySelector('[data-f=role]').value });
        if (a === 'toggle') j = await api('PUT', '/users/' + enc, { is_active: e.target.dataset.on === '1' });
        if (a === 'history') { var t = document.querySelector('[data-t=audit]'); if (t && window.ConsoleAudit) { t.click(); return window.ConsoleAudit(email); } return; }
        if (a === 'unlock') j = await api('POST', '/auth/password-reset/admin-unlock', { target_email: email });
        if (a === 'selfreset') j = await api('POST', '/auth/password-reset/admin-set-self-reset', { target_email: email, allow: e.target.dataset.on === '1' });
        if (a === 'revoke') { if (!confirm('Sign ' + email + ' out of all devices?')) return; j = await api('POST', '/system/users/' + enc + '/revoke-sessions'); }
        if (a === 'del') { if (!confirm('Permanently delete ' + email + '? The record is archived first.')) return; j = await api('DELETE', '/users/' + enc); }
        note((j && j.message) || 'Done', j && j.status === 'success'); REG.users.load();
      });
      function render() {
        var q = $('us-q').value.trim().toLowerCase(), roles = rolesBelowMe();
        $('us-t').innerHTML = USERS.filter(function (u) { return !q || (u.name + ' ' + u.email + ' ' + u.role).toLowerCase().indexOf(q) >= 0; }).map(function (u) {
          var me = u.user_id === USER.user_id, below = (LEVEL[u.role] || 0) < ME, b = [];
          if (!me) b.push('<button class="btn sm gold" data-a="pw">Set password</button>');
          if (below) { b.push(sel('role', roles, u.role) + ' <button class="btn sm ghost" data-a="role">Save role</button>'); b.push('<button class="btn sm ghost" data-a="toggle" data-on="' + (u.is_active ? '0' : '1') + '">' + (u.is_active ? 'Deactivate' : 'Activate') + '</button>'); }
          if (ME >= 4) {
            b.push('<button class="btn sm ghost" data-a="history">History</button>');
            if (!me) { b.push('<button class="btn sm ghost" data-a="unlock">Clear OTP lock</button>', '<button class="btn sm ghost" data-a="selfreset" data-on="' + (u.allow_self_reset ? '0' : '1') + '">' + (u.allow_self_reset ? 'Disable' : 'Enable') + ' self-reset</button>',
              '<button class="btn sm ghost" data-a="revoke">Sign out everywhere</button>', '<button class="btn sm red" data-a="del">Delete</button>'); }
          }
          return '<tr data-id="' + esc(u.user_id) + '" data-email="' + esc(u.email) + '"><td>' + esc(u.name) + (me ? ' <small>(you)</small>' : '') + '</td><td>' + esc(u.email) + '</td><td>' + badge(u.role === 'user' ? 'available' : 'checked_in', u.role) + '</td><td>' + (u.is_active ? 'Yes' : 'No') + '</td><td>' + dt(u.last_login) + '</td><td>' + b.join(' ') + '</td></tr>';
        }).join('') || none(6, 'No matching users.');
      }
      REG.users.render = render;
    },
    async function () { var j = await api('GET', '/users'); if (j.status !== 'success') return note(j.message); USERS = j.data; REG.users.render(); });

  // ════════════ OWNER ════════════
  def('business', 'Business', 'owner',
    '<div class="grid" id="bz-kpis"></div><div class="row2"><div class="card"><h3>Revenue — last 30 days</h3><div id="bz-daily"></div></div><div class="card"><h3>Revenue — last 12 months</h3><div id="bz-monthly"></div></div></div>' +
    '<div class="row2"><div class="card"><h3>By payment method</h3><div id="bz-method"></div></div><div class="card"><h3>Online vs walk-in</h3><div id="bz-source"></div></div></div>' +
    '<div class="card"><h3>Top earning rooms &amp; tables</h3><div class="tbl"><table><thead><tr><th>Item</th><th>Bookings</th><th>Revenue</th></tr></thead><tbody id="bz-top"></tbody></table></div></div>', null,
    async function () {
      var j = await api('GET', '/dashboard/owner'); if (j.status !== 'success') return note(j.message || 'Failed to load.'); var d = j.data;
      $('bz-kpis').innerHTML = [['Revenue (30 days)', kes(d.revenue30d)], ['Revenue (12 months)', kes(d.revenue12m)], ['Occupancy (next 30 nights)', d.occupancy30d + '%'], ['Avg booking value', kes(d.avgBookingValue)], ['Cancellation rate', d.cancellationRate + '%'], ['Bookings (12 months)', d.totalBookings12m]]
        .map(function (s) { return '<div class="stat"><b>' + esc(s[1]) + '</b><span>' + esc(s[0]) + '</span></div>'; }).join('');
      bars($('bz-daily'), d.daily); bars($('bz-monthly'), d.monthly);
      var list = function (o) { return Object.keys(o).map(function (k) { return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>' + esc(k) + '</span><b>' + kes(o[k]) + '</b></div>'; }).join('') || '<p style="color:var(--muted)">No data.</p>'; };
      $('bz-method').innerHTML = list(d.byMethod); $('bz-source').innerHTML = list(d.bySource);
      $('bz-top').innerHTML = d.topItems.map(function (i) { return row([esc(i.name), i.bookings, kes(i.revenue)]); }).join('') || none(3, 'No bookings yet.');
    });

  var REPORT = [];
  def('reports', 'Revenue reports', 'owner',
    '<div class="card" style="margin-bottom:14px"><form class="form" id="rp-form"><div><label>From</label><input id="rp-from" type="date"></div><div><label>To</label><input id="rp-to" type="date"></div>' +
    '<div><label>Source</label><select id="rp-src"><option value="">All</option><option>online</option><option>walk_in</option></select></div><div style="align-self:end"><button class="btn">Run report</button> <button type="button" class="btn ghost" id="rp-csv">Export CSV</button></div></form></div>' +
    '<div class="stat" style="margin-bottom:14px"><b id="rp-total">—</b><span>Total in range</span></div>' +
    '<div class="tbl"><table><thead><tr><th>Date</th><th>Booking</th><th>Guest</th><th>Amount</th><th>Method</th><th>Source</th></tr></thead><tbody id="rp-body"></tbody></table></div>',
    function () {
      $('rp-form').addEventListener('submit', function (e) { e.preventDefault(); REG.reports.load(); });
      $('rp-csv').addEventListener('click', function () { csv([['Date', 'Booking', 'Guest', 'Amount', 'Method', 'Source']].concat(REPORT.map(function (p) { return [p.created_at, p.booking_id, p.guest_name, p.amount, p.method, p.source]; })), 'primewave-revenue.csv'); });
    },
    async function () {
      var qs = new URLSearchParams(); if ($('rp-from').value) qs.set('from', $('rp-from').value); if ($('rp-to').value) qs.set('to', $('rp-to').value); if ($('rp-src').value) qs.set('source', $('rp-src').value);
      var j = await api('GET', '/dashboard/revenue?' + qs); if (j.status !== 'success') return note(j.message || 'Failed.');
      REPORT = j.data; $('rp-total').textContent = kes(j.total);
      $('rp-body').innerHTML = j.data.map(function (p) { return row([dt(p.created_at), esc(p.booking_id), esc(p.guest_name), kes(p.amount), esc(p.method), esc(p.source)]); }).join('') || none(6, 'No payments in range.');
    });

  def('settings', 'Site settings', 'owner',
    '<div class="card"><h3>Social media links</h3><p style="font-size:13.5px;color:var(--muted);margin-bottom:6px">Shown as coloured icons in the footer of every public page. Leave a box empty to hide that icon.</p>' +
    '<form class="form" id="st-form"><div><label for="st-facebook">Facebook page</label><input id="st-facebook" type="url" placeholder="https://www.facebook.com/yourpage"></div>' +
    '<div><label for="st-youtube">YouTube channel</label><input id="st-youtube" type="url" placeholder="https://www.youtube.com/@yourchannel"></div>' +
    '<div><label for="st-tiktok">TikTok profile</label><input id="st-tiktok" type="url" placeholder="https://www.tiktok.com/@yourname"></div>' +
    '<div><label for="st-instagram">Instagram profile</label><input id="st-instagram" type="url" placeholder="https://www.instagram.com/yourname"></div>' +
    '<div style="grid-column:1/-1"><button class="btn gold">Save links</button></div></form><h3 style="margin-top:22px">Preview</h3><div class="social" id="st-prev" style="justify-content:flex-start"></div></div>',
    function () {
      $('st-form').addEventListener('submit', async function (e) {
        e.preventDefault(); var body = {}; ['facebook', 'youtube', 'tiktok', 'instagram'].forEach(function (n) { body[n] = $('st-' + n).value; });
        var j = await api('PUT', '/site/social', body); note(j.message || 'Failed.', j.status === 'success'); if (j.status === 'success') REG.settings.load();
      });
    },
    async function () {
      var r = await fetch('/api/site'), j = await r.json().catch(function () { return {}; }), s = j.social || {};
      ['facebook', 'youtube', 'tiktok', 'instagram'].forEach(function (n) { $('st-' + n).value = s[n] || ''; });
      if (window.PWSocial) window.PWSocial.render($('st-prev'), s);
    });

  // ════════════ SYSTEM OWNER ════════════
  var sev = function (s) { return badge(s === 'critical' ? 'failed' : s === 'warn' ? 'pending' : 'confirmed', s); };
  var topList = function (a) { return a.length ? a.map(function (x) { return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>' + esc(x.key) + '</span><b>' + x.count + '</b></div>'; }).join('') : '<p style="color:var(--muted)">None 🎉</p>'; };

  def('security', 'Security', 'systemowner',
    '<div class="grid" id="sc-kpis"></div><div class="row2"><div class="card"><h3>Top failed-login IPs (24h)</h3><div id="sc-ips"></div></div><div class="card"><h3>Top failed-login accounts (24h)</h3><div id="sc-emails"></div></div></div>' +
    '<div class="card"><h3>Recent critical events</h3><div class="tbl"><table><thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody id="sc-crit"></tbody></table></div></div>', null,
    async function () {
      var j = await api('GET', '/system/overview'); if (j.status !== 'success') return note(j.message || 'Failed.'); var d = j.data;
      $('sc-kpis').innerHTML = [['Logins (24h)', d.loginSuccess], ['Failed logins (24h)', d.loginFailed], ['Warnings (24h)', d.warnings], ['Critical events (24h)', d.critical], ['Open incidents', d.openIncidents],
        ['Last backup', d.lastBackup ? dt(d.lastBackup.created_at) : 'Never'], ['Last job', d.lastJob ? d.lastJob.job_name + ' · ' + d.lastJob.status : '—']]
        .map(function (s) { return '<div class="stat"><b style="font-size:' + (String(s[1]).length > 10 ? '15' : '22') + 'px">' + esc(s[1]) + '</b><span>' + esc(s[0]) + '</span></div>'; }).join('');
      $('sc-ips').innerHTML = topList(d.topFailedIps); $('sc-emails').innerHTML = topList(d.topFailedEmails);
      $('sc-crit').innerHTML = d.recentCritical.map(function (r) { return row([dt(r.timestamp), esc(r.action), esc(r.entity_type || '') + ' ' + esc(r.entity_id || ''), '<span style="white-space:normal;display:block;max-width:420px">' + esc(JSON.stringify(r.new_value || {})) + '</span>']); }).join('') || none(4, 'No critical events in the last 24 hours.');
    });

  var ACTIONS = ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'ROLE_CHANGE', 'BOOKING_UPDATE', 'BOOKING_CANCEL', 'PAYMENT_LOG', 'WALKIN_CREATE', 'ROOM_ADD', 'ROOM_EDIT', 'ROOM_DELETE', 'TABLE_ADD', 'TABLE_EDIT', 'TABLE_DELETE', 'NEWS_CREATE', 'NEWS_UPDATE', 'NEWS_DELETE', 'CONFIG_CHANGE', 'AUTO_DELETE_RUN', 'BACKUP_CREATE', 'SESSION_REVOKE', 'SECURITY_EVENT'];
  def('audit', 'Audit log', 'systemowner',
    '<div class="card" style="margin-bottom:14px"><form class="form" id="au-form"><div><label>Action</label><select id="au-action"><option value="">Any</option>' + ACTIONS.map(function (a) { return '<option>' + a + '</option>'; }).join('') + '</select></div>' +
    '<div><label>User email</label><input id="au-email" type="email"></div><div><label>Severity</label><select id="au-sev"><option value="">Any</option><option>info</option><option>warn</option><option>critical</option></select></div>' +
    '<div><label>From</label><input id="au-from" type="date"></div><div><label>To</label><input id="au-to" type="date"></div><div style="align-self:end"><button class="btn">Search</button></div></form></div>' +
    '<div class="tbl"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>IP</th><th>Severity</th><th>Status</th></tr></thead><tbody id="au-t"></tbody></table></div>',
    function () { $('au-form').addEventListener('submit', function (e) { e.preventDefault(); REG.audit.load(); }); window.ConsoleAudit = function (email) { $('au-email').value = email; REG.audit.load(); }; },
    async function () {
      var qs = new URLSearchParams(); [['action', 'au-action'], ['email', 'au-email'], ['severity', 'au-sev'], ['from', 'au-from'], ['to', 'au-to']].forEach(function (p) { if ($(p[1]).value) qs.set(p[0], $(p[1]).value); });
      var j = await api('GET', '/system/audit?' + qs); if (j.status !== 'success') return note(j.message || 'Failed.');
      $('au-t').innerHTML = j.data.map(function (r) { return row([dt(r.timestamp), esc(r.user_email) + '<br><small>' + esc(r.user_role) + '</small>', esc(r.action), esc(r.entity_type || '') + ' ' + esc(r.entity_id || ''), esc(r.ip_address), sev(r.severity), esc(r.status)]); }).join('') || none(7, 'No matching entries.');
    });

  def('incidents', 'Incidents', 'systemowner',
    '<div class="card" style="margin-bottom:14px"><h3>Open an incident</h3><form class="form" id="in-form"><div><label>Title</label><input id="in-title" required></div><div><label>Severity</label><select id="in-sev"><option>medium</option><option>high</option><option>critical</option></select></div>' +
    '<div><label>Service</label><input id="in-svc" placeholder="payments, email, db…"></div><div><label>Description</label><input id="in-desc"></div><div style="align-self:end"><button class="btn gold">Open incident</button></div></form></div>' +
    '<div class="tbl"><table><thead><tr><th>Opened</th><th>Severity</th><th>Service</th><th>Title</th><th>Status</th><th></th></tr></thead><tbody id="in-t"></tbody></table></div>',
    function () {
      $('in-form').addEventListener('submit', async function (e) { e.preventDefault();
        var j = await api('POST', '/system/incidents', { title: $('in-title').value, severity: $('in-sev').value, service: $('in-svc').value, description: $('in-desc').value });
        note(j.status === 'success' ? 'Incident opened.' : (j.message || 'Failed.'), j.status === 'success'); if (j.status === 'success') { e.target.reset(); REG.incidents.load(); } });
      $('in-t').addEventListener('click', async function (e) { var id = e.target.dataset.id; if (!id) return; var j = await api('PUT', '/system/incidents/' + encodeURIComponent(id) + '/resolve'); note(j.message || 'Done', j.status === 'success'); REG.incidents.load(); });
    },
    async function () {
      var j = await api('GET', '/system/incidents'); if (j.status !== 'success') return note(j.message);
      $('in-t').innerHTML = j.data.map(function (i) { return row([dt(i.opened_at), sev(i.severity === 'medium' ? 'warn' : 'critical') + ' ' + esc(i.severity), esc(i.service), '<b>' + esc(i.title) + '</b><br><small>' + esc(i.description || '') + '</small>', badge(i.status === 'open' ? 'failed' : 'confirmed', i.status),
        i.status === 'open' ? '<button class="btn sm" data-id="' + esc(i.incident_id) + '">Resolve</button>' : dt(i.resolved_at)]); }).join('') || none(6, 'No incidents.');
    });

  def('backups', 'Backups', 'systemowner',
    '<p style="margin-bottom:12px"><button class="btn gold" id="bu-make">Create backup now</button><span style="color:var(--muted);font-size:12.5px;margin-left:8px">Saved to a private Supabase Storage bucket. Download links expire after 2 minutes.</span></p>' +
    '<div class="tbl"><table><thead><tr><th>Created</th><th>By</th><th>Rows</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody id="bu-t"></tbody></table></div>',
    function () {
      $('bu-make').addEventListener('click', async function () { var b = $('bu-make'); b.disabled = true; note('Creating backup…', true); var j = await api('POST', '/system/backups'); b.disabled = false; note(j.message || 'Failed.', j.status === 'success'); REG.backups.load(); });
      $('bu-t').addEventListener('click', async function (e) { var id = e.target.dataset.id; if (!id) return; var j = await api('GET', '/system/backups/' + encodeURIComponent(id) + '/download'); if (j.status === 'success') window.open(j.url, '_blank', 'noopener'); else note(j.message || 'Failed.'); });
    },
    async function () {
      var j = await api('GET', '/system/backups'); if (j.status !== 'success') return note(j.message);
      $('bu-t').innerHTML = j.data.map(function (b) { return row([dt(b.created_at), esc(b.created_by), '<span style="white-space:normal">' + esc(Object.keys(b.row_counts || {}).map(function (k) { return k + ': ' + b.row_counts[k]; }).join(', ')) + '</span>', esc(b.size_kb) + ' KB', badge('confirmed', b.status), '<button class="btn sm ghost" data-id="' + esc(b.backup_id) + '">Download</button>']); }).join('') || none(6, 'No backups yet.');
    });

  def('jobs', 'Jobs', 'systemowner',
    '<p style="margin-bottom:12px"><button class="btn" id="jb-run">Run housekeeping now</button><span style="color:var(--muted);font-size:12.5px;margin-left:8px">Expires stale payment holds and archives bookings older than 180 days.</span></p>' +
    '<div class="tbl"><table><thead><tr><th>Finished</th><th>Job</th><th>Trigger</th><th>Duration</th><th>Records</th><th>Status</th><th>Error</th></tr></thead><tbody id="jb-t"></tbody></table></div>',
    function () { $('jb-run').addEventListener('click', async function () { var b = $('jb-run'); b.disabled = true; var j = await api('POST', '/system/jobs/housekeeping'); b.disabled = false; note(j.message || 'Failed.', j.status === 'success'); REG.jobs.load(); }); },
    async function () {
      var j = await api('GET', '/system/jobs'); if (j.status !== 'success') return note(j.message);
      $('jb-t').innerHTML = j.data.map(function (r) { return row([dt(r.finished_at), esc(r.job_name), esc(r.trigger_type), esc(r.duration_ms) + ' ms', esc(r.records_processed), badge(r.status === 'success' ? 'confirmed' : 'failed', r.status), '<span style="white-space:normal">' + esc(r.error_message || '') + '</span>']); }).join('') || none(7, 'No runs logged yet.');
    });

  // ════════════ START ════════════
  var DIALOG = '<div class="dlg" id="dlg" hidden><div class="dlg-box" role="dialog" aria-modal="true" aria-labelledby="dlg-title"><h3 id="dlg-title"></h3><p id="dlg-text"></p>' +
    '<input id="dlg-pw" type="text" autocomplete="off" spellcheck="false" maxlength="72" aria-label="New password"><div class="dlg-err" id="dlg-err" role="alert"></div>' +
    '<div class="dlg-row"><button type="button" class="btn ghost sm" id="dlg-gen">Generate strong password</button><button type="button" class="btn ghost sm" id="dlg-copy">Copy</button></div>' +
    '<div class="dlg-act"><button type="button" class="btn ghost" id="dlg-cancel">Cancel</button><button type="button" class="btn" id="dlg-ok">Set password</button></div></div></div>';

  function start(opts) {
    if (!gate(opts.min)) return;
    document.body.insertAdjacentHTML('beforeend', DIALOG);
    var ids = opts.modules.filter(function (id) { return REG[id] && ME >= LEVEL[REG[id].min]; });
    var panes = $('panes'), loaders = {};
    ids.forEach(function (id) {
      var m = REG[id]; panes.insertAdjacentHTML('beforeend', '<div class="pane" id="p-' + id + '">' + (typeof m.html === 'function' ? m.html() : m.html) + '</div>');
      m.init(); loaders[id] = function () { return m.load(); };
    });
    tabs(ids.map(function (id) { return [id, REG[id].label]; }), loaders);
  }

  window.Console = { start: start, modules: function () { return ORDER.slice(); }, _reg: REG };
})();
