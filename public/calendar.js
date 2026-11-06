// calendar.js — availability date-range picker. No dependencies.
// Dates are "YYYY-MM-DD" strings in Nairobi time throughout (never JS Date objects), so the browser's timezone can't shift a booking.
//
//   var cal = PWCalendar.mount(element, { onPick: function (checkin, checkout) {} });
//   cal.setBusy(['2026-11-03', ...], closed);   // taken NIGHTS
//   cal.setValue('2026-11-10', '2026-11-12');   // reflect inputs without firing onPick
//   cal.reset();
(function (root) {
  'use strict';
  var DAY = 86400000, EAT = 3 * 3600000;
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  function todayKey() { return new Date(Date.now() + EAT).toISOString().slice(0, 10); }
  function parse(k) { var p = k.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fmt(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function add(k, n) { return fmt(parse(k) + n * DAY); }
  function nice(k) { var p = k.split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1].slice(0, 3); }

  /** Pure selection logic (kept separate so it can be unit-tested). */
  function maxCheckout(start, busy) {          // first taken night at/after start; checking out on that date is allowed
    for (var d = start, i = 0; i < 400; i++, d = add(d, 1)) if (busy[d]) return d;
    return null;                                // open-ended
  }
  function rangeIsFree(start, end, busy) {
    for (var d = start; d < end; d = add(d, 1)) if (busy[d]) return false;
    return true;
  }

  function mount(host, opts) {
    opts = opts || {};
    var busy = {}, closed = false, start = null, end = null, note = '';
    var today = todayKey();
    var view = today.slice(0, 7);               // month shown on the left, "YYYY-MM"

    host.classList.add('pwcal');
    host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Availability calendar');

    function monthCount() { return host.clientWidth >= 560 || (host.clientWidth === 0 && window.innerWidth >= 700) ? 2 : 1; }
    function shiftMonth(ym, n) { var p = ym.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1)); return d.toISOString().slice(0, 7); }

    function cell(k) {
      var past = k < today, isBusy = !!busy[k], cls = ['d'], dis = false, label = nice(k);
      var limit = (start && !end) ? maxCheckout(start, busy) : null;
      var choosingEnd = !!(start && !end);
      if (past) { cls.push('past'); dis = true; }
      else if (closed) { cls.push('busy'); dis = true; }
      else if (choosingEnd) {
        if (k <= start) { if (isBusy) { cls.push('busy'); dis = true; } }
        else if (limit && k > limit) { cls.push('off'); dis = true; }
        else if (isBusy && k !== limit) { cls.push('busy'); dis = true; }
        else if (isBusy && k === limit) cls.push('co');          // checkout-only: the night is taken, the morning is free
      } else if (isBusy) { cls.push('busy'); dis = true; }
      if (start && k === start) cls.push('sel', 'start');
      if (end && k === end) cls.push('sel', 'end');
      if (start && end && k > start && k < end) cls.push('mid');
      if (k === today) cls.push('today');
      var aria = label + (isBusy ? ', unavailable' : ', available') + (cls.indexOf('co') >= 0 ? ' (check-out only)' : '');
      return '<button type="button" class="' + cls.join(' ') + '" data-k="' + k + '"' + (dis ? ' disabled' : '') + ' aria-label="' + aria + '">' + (+k.slice(8)) + '</button>';
    }

    function monthHtml(ym) {
      var p = ym.split('-'), first = Date.UTC(+p[0], +p[1] - 1, 1);
      var lead = (new Date(first).getUTCDay() + 6) % 7;                       // Monday-first
      var dim = new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(), h = '';
      for (var i = 0; i < lead; i++) h += '<span class="d blank"></span>';
      for (var n = 1; n <= dim; n++) h += cell(ym + '-' + (n < 10 ? '0' : '') + n);
      return '<div class="m"><div class="mt">' + MONTHS[+p[1] - 1] + ' ' + p[0] + '</div><div class="g">' + DOW.map(function (w) { return '<span class="w">' + w + '</span>'; }).join('') + h + '</div></div>';
    }

    function render() {
      var n = monthCount(), months = '';
      for (var i = 0; i < n; i++) months += monthHtml(shiftMonth(view, i));
      var msg = closed ? 'This room is currently not open for booking.'
        : note ? note
        : !start ? 'Choose your check-in date.'
        : !end ? 'Now choose your check-out date.'
        : nice(start) + ' → ' + nice(end) + ' · ' + Math.round((parse(end) - parse(start)) / DAY) + ' night' + (parse(end) - parse(start) > DAY ? 's' : '');
      host.innerHTML =
        '<div class="nav"><button type="button" class="prev" aria-label="Previous month"' + (view <= today.slice(0, 7) ? ' disabled' : '') + '>‹</button>' +
        '<span class="msg" role="status" aria-live="polite">' + msg + '</span><button type="button" class="next" aria-label="Next month">›</button></div>' +
        '<div class="ms">' + months + '</div>' +
        '<div class="key"><span><i class="k free"></i>Available</span><span><i class="k busy"></i>Booked</span><span><i class="k sel"></i>Your stay</span></div>';
    }

    host.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !host.contains(b)) return;
      if (b.classList.contains('prev')) { view = shiftMonth(view, -1); return render(); }
      if (b.classList.contains('next')) { view = shiftMonth(view, 1); return render(); }
      var k = b.getAttribute('data-k'); if (!k || b.disabled) return;
      note = '';
      if (!start || end) { start = k; end = null; return render(); }           // (re)start
      if (k <= start) { start = k; return render(); }
      if (!rangeIsFree(start, k, busy)) { start = k; end = null; note = 'Those dates include a booked night — pick another check-in.'; return render(); }
      end = k; render();
      if (opts.onPick) opts.onPick(start, end);
    });
    root.addEventListener && root.addEventListener('resize', function () { if (host.isConnected) render(); });

    var api = {
      setBusy: function (nights, isClosed) {
        busy = {}; (nights || []).forEach(function (n) { busy[n] = true; }); closed = !!isClosed;
        if (start && (!rangeIsFree(start, end || add(start, 1), busy) || closed)) { start = end = null; }   // selection no longer valid
        render();
      },
      setValue: function (a, b) {
        start = a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : null; end = b && start && b > start ? b : null;
        if (start) view = start.slice(0, 7); render();
      },
      reset: function () { start = end = null; note = ''; render(); },
      _maxCheckout: maxCheckout, _rangeIsFree: rangeIsFree,
    };
    render(); return api;
  }

  root.PWCalendar = { mount: mount, maxCheckout: maxCheckout, rangeIsFree: rangeIsFree, _add: add };
})(typeof window !== 'undefined' ? window : globalThis);
