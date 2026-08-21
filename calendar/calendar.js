(function () {
  'use strict';

  var STORAGE_KEY   = 'holidayHacker_user';
  var OVERRIDES_KEY = 'holidayHacker_overrides';
  var CUSTOM_KEY    = 'holidayHacker_custom';
  var CAL_DONE_KEY  = 'holidayHacker_calSetup';
  var CAL_VIEW_KEY  = 'holidayHacker_calendarView';
  var DB_BASE       = '../database/holiday';
  var SC_JSON       = '../database/state-city/data.json';

  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var DAYS_FULL  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  /* ─── DOM ──────────────────────────────────────────── */
  var monthTitle    = document.getElementById('monthTitle');
  var monthChevron  = document.getElementById('monthChevron');
  var monthSelector = document.getElementById('monthSelector');
  var monthDropdown = document.getElementById('monthDropdown');
  var prevBtn       = document.getElementById('prevMonth');
  var nextBtn       = document.getElementById('nextMonth');
  var calGrid       = document.getElementById('calGrid');
  var calWeekdays   = document.getElementById('calWeekdays');
  var calSwipeArea  = document.getElementById('calSwipeArea');
  var calMain       = document.getElementById('calMain');
  var calEventsList = document.getElementById('calEventsList');

  /* ─── State ────────────────────────────────────────── */
  var user      = {};
  var stateData = { states: [] };
  var viewMonth = new Date().getMonth();
  var viewYear  = new Date().getFullYear();
  var holidayMap = {};
  var nowDate   = new Date();
  var todayISO  = nowDate.getFullYear() + '-' +
    String(nowDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(nowDate.getDate()).padStart(2, '0');

  function saveCalendarView() {
    try {
      localStorage.setItem(CAL_VIEW_KEY, JSON.stringify({
        month: viewMonth,
        year: viewYear
      }));
    } catch (e) {}
  }

  function restoreCalendarView() {
    try {
      var raw = localStorage.getItem(CAL_VIEW_KEY);
      if (!raw) return false;
      var v = JSON.parse(raw);
      var m = parseInt(v.month, 10);
      var y = parseInt(v.year, 10);
      if (isNaN(m) || isNaN(y) || m < 0 || m > 11 || y < 2000 || y > 2100) return false;
      viewMonth = m;
      viewYear = y;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ─── Weekly-off logic (from user preference) ──────── */

  function getWeekOffDays() {
    var pref = user.weeklyOff || 'sat-sun';
    if (pref === 'sun-only')    return [0];
    if (pref === 'sat-sun')     return [6, 0];
    if (pref === '2nd-4th-sat') return [0];
    return [6, 0];
  }

  function is2nd4thSat(dateObj) {
    if (dateObj.getDay() !== 6) return false;
    var day = dateObj.getDate();
    var week = Math.ceil(day / 7);
    return week === 2 || week === 4;
  }

  /* ─── Data helpers (mirrored from timeline) ────────── */

  function stateCodeFromLocation(loc) {
    if (!loc) return null;
    var parts = loc.split(',');
    var sn = parts[parts.length - 1].trim().toLowerCase();
    for (var i = 0; i < stateData.states.length; i++) {
      if (stateData.states[i].name.toLowerCase() === sn) return stateData.states[i].code;
    }
    return null;
  }

  function fetchHolidays(code, year) {
    var url = DB_BASE + '/' + year + '/in/' + code.toLowerCase() + '.json';
    return fetch(url).then(function (r) {
      if (!r.ok) return [];
      return r.json().then(function (d) { return d.holidays || []; });
    }).catch(function () { return []; });
  }

  function loadAllHolidays(code) {
    var years = [viewYear];
    if (viewMonth === 11) years.push(viewYear + 1);
    if (viewMonth === 0)  years.push(viewYear - 1);
    var proms = years.map(function (y) { return fetchHolidays(code, y); });
    return Promise.all(proms).then(function (res) {
      var all = [];
      res.forEach(function (a) { all = all.concat(a); });
      return all;
    });
  }

  function getOverrides() {
    try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function getCustomHolidays() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function buildHolidayMap(workList, homeList, workSN, homeSN) {
    holidayMap = {};
    var ov = getOverrides();

    function add(h, ctx) {
      var origDate = h.date;
      var patch = ov[origDate];
      if (patch && patch._hidden) return;
      var name = patch ? (patch.name || h.name) : h.name;
      var date = patch ? (patch.date || h.date) : h.date;
      var c    = patch ? (patch.ctx  || ctx)    : ctx;
      if (!holidayMap[date]) {
        holidayMap[date] = { name: name, _ctx: c };
      }
    }

    workList.filter(function (h) { return h.type === 'gazetted'; })
            .forEach(function (h) { add(h, 'work'); });
    homeList.filter(function (h) { return h.type === 'gazetted'; })
            .forEach(function (h) { if (!holidayMap[h.date]) add(h, 'home'); });

    getCustomHolidays().forEach(function (c) {
      var d = c.date;
      if (!holidayMap[d]) {
        holidayMap[d] = {
          name: c.name,
          _ctx: 'personal',
          _customKind: c.kind === 'leave' ? 'leave' : 'holiday'
        };
      }
    });
  }

  /* ─── Free holiday streak detection (red outline) ──── */
  var freeStreakSet = {};

  function isWorkHoliday(iso) {
    var h = holidayMap[iso];
    return h && h._ctx === 'work';
  }

  function isWeekOffRaw(jsDay, dateObj) {
    var offDays = getWeekOffDays();
    if (offDays.indexOf(jsDay) !== -1) return true;
    if (user.weeklyOff === '2nd-4th-sat' && dateObj && is2nd4thSat(dateObj)) return true;
    return false;
  }

  function isWeekOff(jsDay, dateObj) {
    return isWeekOffRaw(jsDay, dateObj);
  }

  function isDayOff(iso) {
    var dt = new Date(iso + 'T00:00:00');
    return isWeekOffRaw(dt.getDay(), dt) || isWorkHoliday(iso);
  }

  function isoFor(viewY, viewM, day) {
    return viewY + '-' + String(viewM + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function prevDayISO(iso) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function nextDayISO(iso) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function buildFreeStreaks() {
    freeStreakSet = {};
    var gifts = window._advisorGifts || [];
    if (gifts.length) {
      gifts.forEach(function (g) {
        (g._dates || []).forEach(function (iso) { freeStreakSet[iso] = true; });
      });
      return;
    }
    var dim = new Date(viewYear, viewMonth + 1, 0).getDate();
    var prevDim = new Date(viewYear, viewMonth, 0).getDate();
    var prevM = viewMonth === 0 ? 11 : viewMonth - 1;
    var prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
    var nextM = viewMonth === 11 ? 0 : viewMonth + 1;
    var nextY = viewMonth === 11 ? viewYear + 1 : viewYear;

    var streaks = [];
    var current = [];

    for (var d = prevDim - 6; d <= prevDim; d++) {
      if (d < 1) continue;
      var iso = isoFor(prevY, prevM, d);
      if (isDayOff(iso)) {
        current.push(iso);
      } else {
        if (current.length >= 3) streaks.push(current.slice());
        current = [];
      }
    }
    for (var d = 1; d <= dim; d++) {
      var iso = isoFor(viewYear, viewMonth, d);
      if (isDayOff(iso)) {
        current.push(iso);
      } else {
        if (current.length >= 3) streaks.push(current.slice());
        current = [];
      }
    }
    for (var d = 1; d <= 7; d++) {
      var iso = isoFor(nextY, nextM, d);
      if (isDayOff(iso)) {
        current.push(iso);
      } else {
        if (current.length >= 3) streaks.push(current.slice());
        current = [];
      }
    }
    if (current.length >= 3) streaks.push(current);

    streaks.forEach(function (s) {
      s.forEach(function (iso) { freeStreakSet[iso] = true; });
    });
  }

  /* ─── Mega-Bridge & Golden Bridge detection ── */
  var bridgeLeaveDaySet = {};
  var bridgeFullSet = {};
  var megaFullSet = {};

  function buildBridgeHighlights() {
    bridgeLeaveDaySet = {};
    bridgeFullSet = {};
    megaFullSet = {};

    var monthPrefix = viewYear + '-' + String(viewMonth + 1).padStart(2, '0');

    var megas = window._advisorMegaBridges || [];
    megas.forEach(function (m) {
      var inMonth = false;
      m._dates.forEach(function (iso) {
        if (iso.slice(0, 7) === monthPrefix) inMonth = true;
      });
      if (!inMonth) return;
      m._dates.forEach(function (iso) { megaFullSet[iso] = true; });
    });

    var bridges = window._advisorBridgesAll || window._advisorBridges || [];
    bridges.forEach(function (b) {
      var inMonth = false;
      b._dates.forEach(function (iso) {
        if (iso.slice(0, 7) === monthPrefix) inMonth = true;
      });
      if (!inMonth) return;
      b._dates.forEach(function (iso) {
        if (!megaFullSet[iso]) bridgeFullSet[iso] = true;
      });
      b.leaveDays.forEach(function (iso) {
        bridgeLeaveDaySet[iso] = true;
      });
    });
  }

  /* ─── Calendar grid rendering ──────────────────────── */

  function renderWeekdays() {
    var pref = user.weeklyOff || 'sat-sun';
    var spans = calWeekdays.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var jsDay = (i + 1) % 7;
      var off = false;
      if (pref === 'sat-sun')      off = (jsDay === 6 || jsDay === 0);
      else if (pref === 'sun-only') off = (jsDay === 0);
      else if (pref === '2nd-4th-sat') off = (jsDay === 0 || jsDay === 6);
      else                          off = (jsDay === 6 || jsDay === 0);
      spans[i].classList.toggle('calendar-weekday--off', off);
    }
  }

  function renderGrid() {
    var firstDay = new Date(viewYear, viewMonth, 1);
    var startDow = (firstDay.getDay() + 6) % 7;
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    var prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    var prevViewMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    var prevViewYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    var nextViewMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    var nextViewYear = viewMonth === 11 ? viewYear + 1 : viewYear;

    var cells = [];
    var isPastMonth = (viewYear < nowDate.getFullYear()) ||
                      (viewYear === nowDate.getFullYear() && viewMonth < nowDate.getMonth());

    for (var p = startDow - 1; p >= 0; p--) {
      var pd = prevMonthDays - p;
      var pIso = prevViewYear + '-' + String(prevViewMonth + 1).padStart(2, '0') + '-' + String(pd).padStart(2, '0');
      var pHoliday = holidayMap[pIso] && (holidayMap[pIso]._ctx === 'work' || holidayMap[pIso]._ctx === 'home') ? holidayMap[pIso] : null;
      cells.push({ day: pd, other: true, iso: pIso, holiday: pHoliday });
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var iso = viewYear + '-' + String(viewMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var dt  = new Date(viewYear, viewMonth, d);
      cells.push({
        day: d,
        iso: iso,
        jsDay: dt.getDay(),
        dateObj: dt,
        isToday: iso === todayISO,
        holiday: holidayMap[iso] || null,
        weekOff: isWeekOff(dt.getDay(), dt)
      });
    }
    var remainder = 7 - (cells.length % 7);
    if (remainder < 7) {
      for (var n = 1; n <= remainder; n++) {
        var nIso = nextViewYear + '-' + String(nextViewMonth + 1).padStart(2, '0') + '-' + String(n).padStart(2, '0');
        var nHoliday = holidayMap[nIso] && (holidayMap[nIso]._ctx === 'work' || holidayMap[nIso]._ctx === 'home') ? holidayMap[nIso] : null;
        cells.push({ day: n, other: true, iso: nIso, holiday: nHoliday });
      }
    }

    var html = '';
    cells.forEach(function (c) {
      if (c.other) {
        var dot = '';
        var wrapCls = 'calendar-day-wrap';
        var otherCls = 'calendar-day calendar-day--other';
        if (c.holiday) {
          otherCls += ' calendar-day--other-holiday calendar-day--other-' + c.holiday._ctx;
          var dotCls = c.holiday._ctx === 'work' ? 'calendar-day-dot--other-work' : 'calendar-day-dot--other-home';
          dot = '<span class="calendar-day-dot calendar-day-dot--other ' + dotCls + '"></span>';
        }
        var prevIso = prevDayISO(c.iso);
        var nextIso = nextDayISO(c.iso);
        var isMega = !!megaFullSet[c.iso];
        var isBridge = !!bridgeFullSet[c.iso];
        var isFree = !!freeStreakSet[c.iso];
        if (isMega) {
          var prevM = !!megaFullSet[prevIso];
          var nextM = !!megaFullSet[nextIso];
          wrapCls += ' calendar-day-wrap--mega';
          if (!prevM) wrapCls += ' calendar-day-wrap--mega-start';
          if (!nextM) wrapCls += ' calendar-day-wrap--mega-end';
        } else if (isBridge) {
          var prevB = !!bridgeFullSet[prevIso];
          var nextB = !!bridgeFullSet[nextIso];
          wrapCls += ' calendar-day-wrap--bridge';
          if (!prevB) wrapCls += ' calendar-day-wrap--bridge-start';
          if (!nextB) wrapCls += ' calendar-day-wrap--bridge-end';
        } else if (isFree) {
          var prevF = !!freeStreakSet[prevIso];
          var nextF = !!freeStreakSet[nextIso];
          wrapCls += ' calendar-day-wrap--gb';
          if (!prevF) wrapCls += ' calendar-day-wrap--gb-start';
          if (!nextF) wrapCls += ' calendar-day-wrap--gb-end';
        }
        html += '<div class="' + wrapCls + '"><div class="' + otherCls + '" data-iso="' + c.iso + '" aria-hidden="true">' + c.day + dot + '</div></div>';
        return;
      }
      var wrapCls = 'calendar-day-wrap';
      var cls = 'calendar-day';
      var dot = '';

      var isFreeStreak = !!freeStreakSet[c.iso];
      var isMegaFull = !!megaFullSet[c.iso];
      var isBridgeFull = !!bridgeFullSet[c.iso];

      if (isMegaFull) {
        var prevM = !!megaFullSet[prevDayISO(c.iso)];
        var nextM = !!megaFullSet[nextDayISO(c.iso)];
        wrapCls += ' calendar-day-wrap--mega';
        if (!prevM) wrapCls += ' calendar-day-wrap--mega-start';
        if (!nextM) wrapCls += ' calendar-day-wrap--mega-end';
        if (prevM && nextM) wrapCls += ' calendar-day-wrap--mega-mid';
      } else if (isBridgeFull) {
        var prevBF = !!bridgeFullSet[prevDayISO(c.iso)];
        var nextBF = !!bridgeFullSet[nextDayISO(c.iso)];
        wrapCls += ' calendar-day-wrap--bridge';
        if (!prevBF) wrapCls += ' calendar-day-wrap--bridge-start';
        if (!nextBF) wrapCls += ' calendar-day-wrap--bridge-end';
        if (prevBF && nextBF) wrapCls += ' calendar-day-wrap--bridge-mid';
      } else if (isFreeStreak) {
        var prevGB = !!freeStreakSet[prevDayISO(c.iso)];
        var nextGB = !!freeStreakSet[nextDayISO(c.iso)];
        wrapCls += ' calendar-day-wrap--gb';
        if (!prevGB)  wrapCls += ' calendar-day-wrap--gb-start';
        if (!nextGB)  wrapCls += ' calendar-day-wrap--gb-end';
        if (prevGB && nextGB) wrapCls += ' calendar-day-wrap--gb-mid';
      }

      if (c.holiday) {
        var ctx = c.holiday._ctx;
        if (ctx === 'work')     cls += ' calendar-day--work';
        else if (ctx === 'home') cls += ' calendar-day--home';
        else if (ctx === 'personal') cls += ' calendar-day--personal';
        dot = '<span class="calendar-day-dot"></span>';
      }
      if (c.isToday) cls += ' calendar-day--today';
      if (c.weekOff && !c.holiday) cls += ' calendar-day--weekoff';
      if (isPastMonth || (viewYear === nowDate.getFullYear() && viewMonth === nowDate.getMonth() && c.day < nowDate.getDate())) {
        cls += ' calendar-day--past';
      }
      html += '<div class="' + wrapCls + '"><div class="' + cls + '" data-iso="' + c.iso + '" aria-hidden="true">' + c.day + dot + '</div></div>';
    });
    calGrid.innerHTML = html;
  }

  function getGiftStreaks() {
    var gifts = window._advisorGifts || [];
    var monthPrefix = viewYear + '-' + String(viewMonth + 1).padStart(2, '0');
    return gifts.filter(function (g) {
      return (g._dates || []).some(function (iso) { return iso.slice(0, 7) === monthPrefix; });
    });
  }

  /** Dates when the user must take personal leave (matches Golden Bridge card pattern). */
  function giftManualLeaveDates(g) {
    if (g.leaveDays && g.leaveDays.length) return g.leaveDays.slice().sort();
    try {
      var list = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
      var leaveByDate = {};
      list.forEach(function (c) {
        if (c && c.kind === 'leave' && c.date) leaveByDate[c.date] = true;
      });
      return (g._dates || []).filter(function (iso) { return leaveByDate[iso]; }).sort();
    } catch (e) {
      return [];
    }
  }

  function getMegaBridgeStreaks() {
    var megas = window._advisorMegaBridges || [];
    var monthPrefix = viewYear + '-' + String(viewMonth + 1).padStart(2, '0');
    return megas.filter(function (m) {
      return m._dates.some(function (iso) { return iso.slice(0, 7) === monthPrefix; });
    });
  }

  function getGoldenBridgeStreaks() {
    var bridges = window._advisorBridges || [];
    var monthPrefix = viewYear + '-' + String(viewMonth + 1).padStart(2, '0');
    var result = [];

    bridges.forEach(function (b) {
      var inMonth = b._dates.some(function (iso) { return iso.slice(0, 7) === monthPrefix; });
      if (!inMonth) return;
      var datesInMonth = b._dates.filter(function (iso) { return iso.slice(0, 7) === monthPrefix; });
      result.push({
        dates: datesInMonth,
        leaveDays: b.leaveDays,
        name: b.name,
        days: b.days,
        start: b.start,
        end: b.end,
        leaves: b.leaves
      });
    });

    return result;
  }

  var SELECTED_BRIDGES_KEY = 'holidayHacker_selectedBridges';
  var PLANNED_TRIPS_KEY = 'holidayHacker_plannedTrips';
  var PLAN_ADDED_AT_KEY = 'holidayHacker_planWindowAddedAt';
  var PLAN_SELECTED_KEY = 'holidayHacker_planSelectedWindow';

  function markPlanWindowAdded(start) {
    if (!start) return;
    try {
      var map = JSON.parse(localStorage.getItem(PLAN_ADDED_AT_KEY) || '{}');
      map[start] = Date.now();
      localStorage.setItem(PLAN_ADDED_AT_KEY, JSON.stringify(map));
      localStorage.setItem(PLAN_SELECTED_KEY, JSON.stringify(start));
    } catch (e) {}
  }

  function clearPlanWindowAdded(start) {
    if (!start) return;
    try {
      var map = JSON.parse(localStorage.getItem(PLAN_ADDED_AT_KEY) || '{}');
      if (map[start] != null) {
        delete map[start];
        localStorage.setItem(PLAN_ADDED_AT_KEY, JSON.stringify(map));
      }
    } catch (e) {}
  }

  function getSelectedBridges() {
    try {
      return JSON.parse(localStorage.getItem(SELECTED_BRIDGES_KEY) || '[]');
    } catch (e) { return []; }
  }

  function setSelectedBridge(start, selected) {
    var arr = getSelectedBridges();
    var idx = arr.indexOf(start);
    if (selected && idx === -1) {
      arr.push(start);
      markPlanWindowAdded(start);
    } else if (!selected && idx !== -1) {
      arr.splice(idx, 1);
      clearPlanWindowAdded(start);
    }
    localStorage.setItem(SELECTED_BRIDGES_KEY, JSON.stringify(arr));
  }

  function isBridgeSelected(start) {
    return getSelectedBridges().indexOf(start) !== -1;
  }

  function getPlannedTrips() {
    try {
      return JSON.parse(localStorage.getItem(PLANNED_TRIPS_KEY) || '[]');
    } catch (e) { return []; }
  }

  function setPlannedTrip(start, planned) {
    var arr = getPlannedTrips();
    var idx = arr.indexOf(start);
    if (planned && idx === -1) {
      arr.push(start);
      markPlanWindowAdded(start);
    } else if (!planned && idx !== -1) {
      arr.splice(idx, 1);
      clearPlanWindowAdded(start);
    }
    localStorage.setItem(PLANNED_TRIPS_KEY, JSON.stringify(arr));
    window.dispatchEvent(new CustomEvent('tripSelectionChange'));
  }

  function isTripPlanned(start) {
    return getPlannedTrips().indexOf(start) !== -1;
  }

  var _calPlanToastTimer = null;

  function showCalPlanToast(windowName) {
    var toast = document.getElementById('calPlanToast');
    if (!toast) return;
    var titleEl = document.getElementById('calPlanToastTitle');
    var textEl = document.getElementById('calPlanToastText');
    if (titleEl) {
      titleEl.textContent = windowName ? (windowName + ' added') : 'Added to Plan';
    }
    if (textEl) {
      var safeWin = windowName ? String(windowName).replace(/</g, '&lt;') : '';
      textEl.innerHTML = safeWin
        ? '<strong>' + safeWin + '</strong> is in Plan. Head to <strong>Plan</strong> to pick a destination, then <strong>Trips</strong> to customize.'
        : 'Head to <strong>Plan</strong> to pick a destination, then <strong>Trips</strong> to customize.';
    }
    toast.hidden = false;
    requestAnimationFrame(function () { toast.classList.add('plan-toast--show'); });
    if (_calPlanToastTimer) clearTimeout(_calPlanToastTimer);
    _calPlanToastTimer = setTimeout(hideCalPlanToast, 6000);
  }

  function hideCalPlanToast() {
    var toast = document.getElementById('calPlanToast');
    if (!toast) return;
    toast.classList.remove('plan-toast--show');
    if (_calPlanToastTimer) { clearTimeout(_calPlanToastTimer); _calPlanToastTimer = null; }
    setTimeout(function () { if (!toast.classList.contains('plan-toast--show')) toast.hidden = true; }, 250);
  }

  function calendarCardTitle(card) {
    if (!card) return '';
    var titleEl = card.querySelector('.calendar-event-body h4, .advisor-card-title');
    return titleEl ? titleEl.textContent.trim() : '';
  }

  window.HH_showCalPlanToast = showCalPlanToast;
  window.HH_hideCalPlanToast = hideCalPlanToast;

  function renderEvents() {
    var entries = [];
    Object.keys(holidayMap).forEach(function (iso) {
      if (iso.slice(0, 7) === viewYear + '-' + String(viewMonth + 1).padStart(2, '0')) {
        entries.push({ date: iso, name: holidayMap[iso].name, _ctx: holidayMap[iso]._ctx });
      }
    });
    entries.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    var html = '';
    var gifts = getGiftStreaks();
    gifts.forEach(function (g) {
      var first = new Date(g.start + 'T00:00:00');
      var last  = new Date(g.end + 'T00:00:00');
      var label = MONTHS[first.getMonth()].slice(0, 3) + ' ' + first.getDate() +
                  ' – ' + MONTHS[last.getMonth()].slice(0, 3) + ' ' + last.getDate();
      var planned = isTripPlanned(g.start);
      var pastCls = g.end < todayISO ? ' calendar-event-card--past' : '';
      var giftLeaves = parseInt(g.leaves, 10) || 0;
      var manualHol = parseInt(g._manualHolidayDays, 10) || 0;
      var giftBadge;
      var metaLabel;
      if (giftLeaves > 0) {
        giftBadge = giftLeaves + ' Leave' + (giftLeaves === 1 ? '' : 's') + ' · ' + g.days + ' Days';
        metaLabel = giftLeaves + ' Leave' + (giftLeaves === 1 ? '' : 's');
      } else if (manualHol > 0) {
        giftBadge = g.days + ' Days · Manual holiday';
        metaLabel = 'Manual holiday';
      } else {
        giftBadge = '0 Leaves · ' + g.days + ' Days — Free';
        metaLabel = 'Free';
      }
      var leaveDatesForCard = giftManualLeaveDates(g);
      var giftLeaveLineHtml = '';
      if (giftLeaves > 0 && leaveDatesForCard.length) {
        var giftLeaveLabels = leaveDatesForCard.map(function (iso) {
          var d = new Date(iso + 'T00:00:00');
          var dayName = DAYS_FULL[d.getDay()];
          var rest = MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
          return '<span class="leave-day-name">' + dayName + '</span> ' + rest;
        });
        giftLeaveLineHtml = '<p class="calendar-event-leave calendar-event-leave--bridge">Leave: ' + giftLeaveLabels.join(', ') + '</p>';
      }
      html += '<div class="calendar-event-card calendar-event-card--gift' + pastCls + '" data-gift-start="' + g.start + '">' +
        '<div class="calendar-event-icon calendar-event-icon--gift">' +
          '<span class="material-symbols-outlined">celebration</span>' +
        '</div>' +
        '<div class="calendar-event-body">' +
          '<h4>' + g.name + '</h4>' +
          '<p>' + label + '</p>' +
          '<p class="calendar-event-gift-badge">' + giftBadge + '</p>' +
          giftLeaveLineHtml +
          '<div class="calendar-event-toggle-wrap">' +
            '<span>Plan trip?</span>' +
            '<button type="button" class="advisor-toggle advisor-toggle--plan' + (planned ? ' is-on' : '') + '" aria-label="Plan trip"></button>' +
          '</div>' +
        '</div>' +
        '<span class="calendar-event-meta">' + metaLabel + '</span>' +
      '</div>';
    });

    var megas = getMegaBridgeStreaks();
    megas.forEach(function (m) {
      var first = new Date(m.start + 'T00:00:00');
      var last  = new Date(m.end + 'T00:00:00');
      var label = MONTHS[first.getMonth()].slice(0, 3) + ' ' + first.getDate() +
                  ' – ' + MONTHS[last.getMonth()].slice(0, 3) + ' ' + last.getDate();
      var leaveLabels = m.leaveDays.map(function (iso) {
        var d = new Date(iso + 'T00:00:00');
        var dayName = DAYS_FULL[d.getDay()];
        var rest = MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
        return '<span class="leave-day-name">' + dayName + '</span> ' + rest;
      });
      var sel = isBridgeSelected(m.start);
      var pastCls = m.end < todayISO ? ' calendar-event-card--past' : '';
      html += '<div class="calendar-event-card calendar-event-card--mega' + pastCls + '" data-bridge-start="' + m.start + '" data-bridge-leaves="' + m.leaves + '">' +
        '<div class="calendar-event-icon calendar-event-icon--mega">' +
          '<span class="material-symbols-outlined">workspace_premium</span>' +
        '</div>' +
        '<div class="calendar-event-body">' +
          '<h4>' + (m.name || (m.days === 9 ? 'Mega-Bridge' : 'Long Bridge')) + '</h4>' +
          '<p>' + label + '</p>' +
          '<p class="calendar-event-mega-roi">' + m.leaves + ' Leaves = ' + m.days + ' Days</p>' +
          '<p class="calendar-event-leave">Leave: ' + leaveLabels.join(', ') + '</p>' +
          '<div class="calendar-event-toggle-wrap">' +
            '<span>Bridge it?</span>' +
            '<button type="button" class="advisor-toggle advisor-toggle--mega' + (sel ? ' is-on' : '') + '" aria-label="Toggle mega bridge"></button>' +
          '</div>' +
        '</div>' +
        '<span class="calendar-event-meta">' + m.leaves + ' Leave' + (m.leaves > 1 ? 's' : '') + '</span>' +
      '</div>';
    });

    var bridges = getGoldenBridgeStreaks();
    bridges.forEach(function (b) {
      var visibleDays = b.dates.length;
      var first = new Date(b.start + 'T00:00:00');
      var last  = new Date(b.end + 'T00:00:00');
      var label = MONTHS[first.getMonth()].slice(0, 3) + ' ' + first.getDate() +
                  ' – ' + MONTHS[last.getMonth()].slice(0, 3) + ' ' + last.getDate();
      var leaveLabels = b.leaveDays.map(function (iso) {
        var d = new Date(iso + 'T00:00:00');
        var dayName = DAYS_FULL[d.getDay()];
        var rest = MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
        return '<span class="leave-day-name">' + dayName + '</span> ' + rest;
      });
      var sel = isBridgeSelected(b.start);
      var pastCls = b.end < todayISO ? ' calendar-event-card--past' : '';
      html += '<div class="calendar-event-card calendar-event-card--gb' + pastCls + '" data-bridge-start="' + b.start + '" data-bridge-leaves="' + b.leaves + '">' +
        '<div class="calendar-event-icon calendar-event-icon--gb">' +
          '<span class="material-symbols-outlined">offline_bolt</span>' +
        '</div>' +
        '<div class="calendar-event-body">' +
          '<h4>' + visibleDays + '-Day Golden Bridge</h4>' +
          '<p>' + label + '</p>' +
          '<p class="calendar-event-leave calendar-event-leave--bridge">Leave: ' + leaveLabels.join(', ') + '</p>' +
          '<div class="calendar-event-toggle-wrap">' +
            '<span>Bridge it?</span>' +
            '<button type="button" class="advisor-toggle' + (sel ? ' is-on' : '') + '" aria-label="Toggle bridge"></button>' +
          '</div>' +
        '</div>' +
        '<span class="calendar-event-meta">' + b.leaves + ' Leave' + (b.leaves > 1 ? 's' : '') + '</span>' +
      '</div>';
    });

    if (entries.length) {
      entries.forEach(function (e) {
        var d = new Date(e.date + 'T00:00:00');
        var dayName = DAYS_SHORT[(d.getDay() + 6) % 7];
        var dateStr = MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
        var icon, iconCls, label;
        if (e._ctx === 'work')        { icon = 'apartment'; iconCls = 'calendar-event-icon--work'; label = 'Work City'; }
        else if (e._ctx === 'home')   { icon = 'home';      iconCls = 'calendar-event-icon--home'; label = 'Hometown'; }
        else                          { icon = 'person';     iconCls = 'calendar-event-icon--personal'; label = 'Personal'; }

        var pastCls = e.date < todayISO ? ' calendar-event-card--past' : '';
        html += '<div class="calendar-event-card' + pastCls + '" data-holiday-date="' + e.date + '">' +
          '<div class="calendar-event-icon ' + iconCls + '">' +
            '<span class="material-symbols-outlined">' + icon + '</span>' +
          '</div>' +
          '<div class="calendar-event-body">' +
            '<h4>' + e.name + '</h4>' +
            '<p>' + dateStr + ' · ' + label + '</p>' +
          '</div>' +
          '<span class="calendar-event-meta">' + dayName + '</span>' +
        '</div>';
      });
    }

    if (!html) {
      calEventsList.innerHTML = '<p class="calendar-events-empty">No breaks this month. Swipe right to find a holiday.</p>';
    } else {
      calEventsList.innerHTML = '<h3 class="calendar-events-title">This Month\'s Breaks</h3>' + html;
    }
  }

  function updateTitle() {
    monthTitle.innerHTML = MONTHS[viewMonth] + ' ' + viewYear +
      ' <span class="material-symbols-outlined" id="monthChevron">expand_more</span>';
    monthChevron = document.getElementById('monthChevron');
  }

  function renderAll() {
    updateTitle();
    buildFreeStreaks();
    buildBridgeHighlights();
    renderGrid();
    renderEvents();
    buildMonthDropdown();
    highlightFocusCard();
    highlightFocusDate();
  }

  window.refreshCalendarBreaks = function () {
    /* If we arrived with ?focus=… / ?start=… but advisor data wasn't yet computed on
       the first render, retry the jump now that advisor finished computing. */
    if ((pendingFocus || pendingStartIso) && !pendingFocusItem) {
      applyPendingFocus();
      if (pendingFocusItem) {
        updateTitle();
        buildFreeStreaks();
        buildBridgeHighlights();
        renderGrid();
        renderEvents();
        buildMonthDropdown();
        highlightFocusCard();
        highlightFocusDate();
        return;
      }
    }
    buildBridgeHighlights();
    renderGrid();
    renderEvents();
    highlightFocusCard();
    highlightFocusDate();
  };

  /* ─── Month navigation ─────────────────────────────── */

  var isAnimating = false;

  function go(delta) {
    if (isAnimating) return;
    isAnimating = true;

    var exitCls = delta > 0 ? 'calendar-grid--exit-left' : 'calendar-grid--exit-right';
    var enterCls = delta > 0 ? 'calendar-grid--enter-right' : 'calendar-grid--enter-left';

    calGrid.classList.add(exitCls);
    calEventsList.classList.add('calendar-events--fading');

    setTimeout(function () {
      viewMonth += delta;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
      saveCalendarView();

      calGrid.classList.remove(exitCls);
      calGrid.classList.add(enterCls);
      loadAndRender();

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          calGrid.classList.remove(enterCls);
          calEventsList.classList.remove('calendar-events--fading');
          setTimeout(function () { isAnimating = false; }, 320);
        });
      });
    }, 300);
  }

  prevBtn.addEventListener('click', function () { go(-1); });
  nextBtn.addEventListener('click', function () { go(1); });

  /* Swipe – use calMain so swipes work in calendar grid, legend, and events list */
  var swipeStartX = 0;
  var swiping = false;

  calMain.addEventListener('touchstart', function (e) {
    if (isAnimating) return;
    swipeStartX = e.touches[0].clientX;
    swiping = true;
    calGrid.style.transition = 'none';
  }, { passive: true });

  calMain.addEventListener('touchmove', function (e) {
    if (!swiping) return;
    var dx = e.touches[0].clientX - swipeStartX;
    var clamped = Math.max(-120, Math.min(120, dx));
    calGrid.style.transform = 'translateX(' + clamped + 'px)';
    calGrid.style.opacity = 1 - Math.abs(clamped) / 300;
  }, { passive: true });

  calMain.addEventListener('touchend', function (e) {
    if (!swiping) return;
    swiping = false;
    var diff = e.changedTouches[0].clientX - swipeStartX;
    calGrid.style.transition = '';
    calGrid.style.transform = '';
    calGrid.style.opacity = '';
    if (Math.abs(diff) > 50) {
      go(diff < 0 ? 1 : -1);
    }
  }, { passive: true });

  /* Month dropdown */
  function buildMonthDropdown() {
    var html = '';
    var now = new Date();
    for (var i = -2; i <= 12; i++) {
      var m = (now.getMonth() + i + 120) % 12;
      var y = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
      var isActive = m === viewMonth && y === viewYear;
      var isPast = (y < now.getFullYear()) || (y === now.getFullYear() && m < now.getMonth());
      html += '<button type="button" class="calendar-month-option' +
        (isActive ? ' is-active' : '') +
        (isPast ? ' is-past' : '') +
        '" data-m="' + m + '" data-y="' + y + '">' +
        MONTHS[m].slice(0, 3) + ' ' + y + '</button>';
    }
    monthDropdown.innerHTML = html;

    monthDropdown.querySelectorAll('.calendar-month-option').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        viewMonth = parseInt(btn.getAttribute('data-m'));
        viewYear  = parseInt(btn.getAttribute('data-y'));
        saveCalendarView();
        monthDropdown.classList.remove('is-open');
        monthChevron.textContent = 'expand_more';
        loadAndRender();
      });
    });
  }

  monthSelector.addEventListener('click', function (e) {
    e.stopPropagation();
    monthDropdown.classList.toggle('is-open');
    monthChevron.textContent = monthDropdown.classList.contains('is-open') ? 'expand_less' : 'expand_more';
  });

  document.addEventListener('click', function () {
    monthDropdown.classList.remove('is-open');
    if (monthChevron) monthChevron.textContent = 'expand_more';
  });

  /* ─── Deep-link focus from Plan page ────────────────────
   * Plan page can pass ?focus=free|golden|mega so the calendar jumps to the
   * month containing the user's first upcoming window of that kind and
   * briefly highlights the matching event card.
   * Holidays page can pass ?date=YYYY-MM-DD to open that month and flash
   * the matching day (and holiday event card if present). */
  var pendingFocus = null;
  var pendingFocusItem = null;
  var pendingStartIso = null;
  var pendingDateIso = null;

  function parseFocusFromUrl() {
    try {
      var p = new URLSearchParams(window.location.search);
      var f = p.get('focus');
      if (f === 'free' || f === 'golden' || f === 'mega' || f === 'any') return f;
    } catch (_) {}
    return null;
  }

  function parseStartFromUrl() {
    try {
      var p = new URLSearchParams(window.location.search);
      var s = p.get('start');
      if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    } catch (_) {}
    return null;
  }

  function parseDateFromUrl() {
    try {
      var p = new URLSearchParams(window.location.search);
      var d = p.get('date');
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    } catch (_) {}
    return null;
  }

  function clearFocusFromUrl() {
    try {
      if (window.history && window.history.replaceState) {
        var url = window.location.pathname + (window.location.hash || '');
        window.history.replaceState({}, document.title, url);
      }
    } catch (_) {}
  }

  /* Returns `{ type, item }` where `type` is the actual kind of window
     surfaced (may differ from the requested focus if the user has no
     upcoming items of that type — e.g. requested 'mega' but only Golden
     Bridges remain this year, we fall back to the next-soonest Golden, then
     to a Free Holiday, then nothing). For 'any' we just pick the
     chronologically nearest upcoming window of any kind. */
  function firstUpcomingFocusItem(focus) {
    loadPersistedAdvisorData();
    var today = new Date(); today.setHours(0, 0, 0, 0);

    function future(arr, type) {
      return (arr || []).filter(function (it) {
        if (!it || !it.start) return false;
        var d = new Date(it.start + 'T00:00:00');
        return !isNaN(d.getTime()) && d >= today;
      }).map(function (it) { return { type: type, item: it }; });
    }
    function pickEarliest(list) {
      if (!list.length) return null;
      list.sort(function (a, b) { return a.item.start.localeCompare(b.item.start); });
      return list[0];
    }

    var futureFree   = future(window._advisorGifts, 'free');
    var futureGolden = future(window._advisorBridges || window._advisorBridgesAll, 'golden');
    var futureMega   = future(window._advisorMegaBridges, 'mega');
    var futureAny    = futureFree.concat(futureGolden).concat(futureMega);

    /* Preferred-type ladders: try the user's chosen filter first, then fall
       through to other window types so something useful always shows up. */
    var order;
    if (focus === 'free')        order = [futureFree,   futureGolden, futureMega];
    else if (focus === 'golden') order = [futureGolden, futureMega,   futureFree];
    else if (focus === 'mega')   order = [futureMega,   futureGolden, futureFree];
    else                          order = [futureAny];

    for (var i = 0; i < order.length; i++) {
      var pick = pickEarliest(order[i]);
      if (pick) return pick;
    }
    return null;
  }

  function findItemByStart(startIso) {
    if (!startIso) return null;
    loadPersistedAdvisorData();
    var lists = [
      { type: 'free', arr: window._advisorGifts },
      { type: 'golden', arr: window._advisorBridges || window._advisorBridgesAll },
      { type: 'mega', arr: window._advisorMegaBridges }
    ];
    for (var i = 0; i < lists.length; i++) {
      var arr = lists[i].arr || [];
      for (var j = 0; j < arr.length; j++) {
        if (arr[j] && arr[j].start === startIso) {
          return { type: lists[i].type, item: arr[j] };
        }
      }
    }
    return null;
  }

  function resolveFocusItem(focus, startIso) {
    if (startIso) {
      var exact = findItemByStart(startIso);
      if (exact) return exact;
      /* Explicit start from a deep link: do not fall through to an unrelated
         upcoming window — the caller may also set the month via ?date=. */
      if (!focus) return null;
    }
    return firstUpcomingFocusItem(focus || 'any');
  }

  function focusItemSelector(picked) {
    if (!picked || !picked.item || !picked.item.start) return null;
    var start = picked.item.start;
    if (picked.type === 'free')   return '.calendar-event-card--gift[data-gift-start="' + start + '"]';
    if (picked.type === 'mega')   return '.calendar-event-card--mega[data-bridge-start="' + start + '"]';
    if (picked.type === 'golden') return '.calendar-event-card--gb[data-bridge-start="' + start + '"]';
    return null;
  }

  function highlightFocusCard() {
    if (!pendingFocusItem) return;
    var sel = focusItemSelector(pendingFocusItem);
    if (!sel) return;
    /* renderEvents() has just written innerHTML; defer to next frame so the
       layout exists before we scroll. */
    requestAnimationFrame(function () {
      var el = document.querySelector(sel);
      if (!el) return;
      el.classList.add('calendar-event-card--focus-flash');
      setTimeout(function () {
        el.classList.remove('calendar-event-card--focus-flash');
      }, 2400);
      scrollCalendarMainToEl(el);
      /* One-shot: clear pending so navigating to another month doesn't keep
         hijacking the scroll position. */
      pendingFocus = null;
      pendingFocusItem = null;
      pendingStartIso = null;
    });
  }

  function applyPendingFocus() {
    var focus = pendingFocus || parseFocusFromUrl();
    var startIso = pendingStartIso || parseStartFromUrl();
    if (!focus && !startIso) return;
    if (startIso) pendingStartIso = startIso;
    if (focus) pendingFocus = focus;
    var picked = resolveFocusItem(focus, startIso);
    if (!picked || !picked.item || !picked.item.start) return;
    var d = new Date(picked.item.start + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    viewMonth = d.getMonth();
    viewYear  = d.getFullYear();
    pendingFocusItem = picked;
    saveCalendarView();
    clearFocusFromUrl();
  }

  function applyPendingDate() {
    var dateIso = pendingDateIso || parseDateFromUrl();
    if (!dateIso) return;
    var d = new Date(dateIso + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    pendingDateIso = dateIso;
    viewMonth = d.getMonth();
    viewYear  = d.getFullYear();
    saveCalendarView();
    clearFocusFromUrl();
  }

  function scrollCalendarMainToEl(el) {
    var main = document.getElementById('calMain');
    if (!main || !el) return;
    try {
      var mainRect = main.getBoundingClientRect();
      var elRect = el.getBoundingClientRect();
      var target = main.scrollTop + (elRect.top - mainRect.top) - 24;
      if (target < 0) target = 0;
      if (typeof main.scrollTo === 'function') {
        main.scrollTo({ top: target, behavior: 'smooth' });
      } else {
        main.scrollTop = target;
      }
    } catch (_) {}
  }

  function highlightFocusDate() {
    if (!pendingDateIso) return;
    var iso = pendingDateIso;
    pendingDateIso = null;
    requestAnimationFrame(function () {
      var main = document.getElementById('calMain');
      if (main) main.scrollTop = 0;

      var day = document.querySelector('.calendar-day[data-iso="' + iso + '"]');
      if (day) {
        day.classList.add('calendar-day--focus-flash');
        setTimeout(function () {
          day.classList.remove('calendar-day--focus-flash');
        }, 2400);
      }
      var card =
        document.querySelector('.calendar-event-card--gift[data-gift-start="' + iso + '"]') ||
        document.querySelector('.calendar-event-card--mega[data-bridge-start="' + iso + '"]') ||
        document.querySelector('.calendar-event-card--gb[data-bridge-start="' + iso + '"]') ||
        document.querySelector('.calendar-event-card[data-holiday-date="' + iso + '"]');
      if (card) {
        card.classList.add('calendar-event-card--focus-flash');
        setTimeout(function () {
          card.classList.remove('calendar-event-card--focus-flash');
        }, 2400);
        scrollCalendarMainToEl(card);
      }
    });
  }

  function loadPersistedAdvisorData() {
    try {
      var raw = localStorage.getItem('holidayHacker_advisorData');
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.gifts) window._advisorGifts = d.gifts;
      if (d.bridges) window._advisorBridges = d.bridges;
      if (d.bridgesAll) window._advisorBridgesAll = d.bridgesAll;
      if (d.megas) window._advisorMegaBridges = d.megas;
    } catch (e) {}
  }

  /* ─── Data loading (combined view like timeline) ───── */

  function loadAndRender() {
    var workCode = stateCodeFromLocation(user.workLocation);
    var homeCode = stateCodeFromLocation(user.homeLocation || user.workLocation);
    var workSN   = user.workLocation || '–';
    var homeSN   = user.homeLocation || workSN;

    var homePromise = (homeCode && homeCode !== workCode)
      ? loadAllHolidays(homeCode) : Promise.resolve([]);

    loadPersistedAdvisorData();
    Promise.all([
      workCode ? loadAllHolidays(workCode) : Promise.resolve([]),
      homePromise
    ]).then(function (res) {
      buildHolidayMap(res[0], res[1], workSN, homeSN);
      renderAll();
    });
  }

  /* ─── Init ─────────────────────────────────────────── */

  calEventsList.addEventListener('click', function (e) {
    var btn = e.target.closest('.advisor-toggle');
    if (!btn) return;
    var bridgeCard = btn.closest('.calendar-event-card--mega') || btn.closest('.calendar-event-card--gb');
    var giftCard = btn.closest('.calendar-event-card--gift');
    if (bridgeCard) {
      var start = bridgeCard.getAttribute('data-bridge-start');
      if (!start) return;
      btn.classList.toggle('is-on');
      var bridgeOn = btn.classList.contains('is-on');
      setSelectedBridge(start, bridgeOn);
      if (bridgeOn) showCalPlanToast(calendarCardTitle(bridgeCard));
      window.dispatchEvent(new CustomEvent('bridgeSelectionChange'));
    } else if (giftCard) {
      var start = giftCard.getAttribute('data-gift-start');
      if (!start) return;
      btn.classList.toggle('is-on');
      var isOn = btn.classList.contains('is-on');
      setPlannedTrip(start, isOn);
      if (isOn) showCalPlanToast(calendarCardTitle(giftCard));
      window.dispatchEvent(new CustomEvent('tripSelectionChange'));
    }
  });

  function init() {
    var calToastClose = document.getElementById('calPlanToastClose');
    if (calToastClose) calToastClose.addEventListener('click', hideCalPlanToast);
    var calToastCta = document.getElementById('calPlanToastCta');
    if (calToastCta) {
      calToastCta.addEventListener('click', function () { hideCalPlanToast(); });
    }

    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.location.href = '../index.html';
      return;
    }
    user = JSON.parse(raw);
    if (!user.name && !user.workLocation) {
      window.location.href = '../index.html';
      return;
    }

    renderWeekdays();

    /* Restore last viewed month unless a deep-link (?focus / ?start / ?date)
       is about to jump the calendar. */
    restoreCalendarView();

    /* If we arrived from the Plan page's "Go to Calendar" link, jump the
       calendar to the first upcoming Free/Golden/Mega window of the kind the
       user had filtered on, before the first render so the user lands
       directly on it. If advisor data hasn't been computed yet (fresh
       install path), the retry inside refreshCalendarBreaks() will pick it
       up once cal-advisor.js finishes computing. */
    applyPendingFocus();
    applyPendingDate();

    if (localStorage.getItem('holidayHacker_advisorSeen')) {
      var split = document.getElementById('calSplit');
      if (split) split.classList.add('cal-split--seen');
    }

    window.addEventListener('bridgeSelectionChange', function () {
      buildBridgeHighlights();
      renderGrid();
      renderEvents();
    });

    window.addEventListener('tripSelectionChange', function () {
      renderEvents();
    });

    if (typeof window.startCalendarAdvisor === 'function') {
      setTimeout(window.startCalendarAdvisor, 0);
    }

    fetch(SC_JSON)
      .then(function (r) { return r.json(); })
      .then(function (d) { stateData = d; loadAndRender(); })
      .catch(function ()  { loadAndRender(); });
  }

  window.initCalendar = init;

  if (localStorage.getItem(CAL_DONE_KEY)) {
    init();
  }
})();
