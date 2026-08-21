(function () {
  'use strict';

  var STORAGE_KEY   = 'holidayHacker_user';
  var OVERRIDES_KEY = 'holidayHacker_overrides';
  var CUSTOM_KEY    = 'holidayHacker_custom';
  var CAL_DONE_KEY  = 'holidayHacker_calSetup';
  var ADVISOR_SEEN_KEY = 'holidayHacker_advisorSeen';
  var SELECTED_BRIDGES_KEY = 'holidayHacker_selectedBridges';
  var PLAN_ADDED_AT_KEY = 'holidayHacker_planWindowAddedAt';
  var PLAN_SELECTED_KEY = 'holidayHacker_planSelectedWindow';
  var CONFIRMED_TRIPS_KEY = 'holidayHacker_confirmedTrips';
  var DB_BASE       = '../database/holiday';
  var SC_JSON       = '../database/state-city/data.json';

  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  var calSplit      = document.getElementById('calSplit');
  var splitTop      = document.getElementById('calSplitTop');
  var splitHandle   = document.getElementById('calSplitHandle');
  var splitBottom   = document.getElementById('calSplitBottom');
  var advisorMsgs   = document.getElementById('advisorMessages');
  var advisorReopenBtn = document.getElementById('calAdvisorReopenBtn');

  var user, stateData = { states: [] };
  var workHolidays = [];
  var DELAY = 1000;
  var MAX_WAIT = 3000;
  var advisorStarted = false;
  var advisorFlowInstant = false;

  function getAnnualLeavesBudget(u) {
    if (!u) return 0;
    if (u.annualLeaves != null && u.annualLeaves !== '') return parseInt(u.annualLeaves, 10) || 0;
    return parseInt(u.pendingLeaves, 10) || 0;
  }

  function getLeavesUsedFromConfirmedTrips() {
    try {
      var trips = JSON.parse(localStorage.getItem(CONFIRMED_TRIPS_KEY) || '[]');
      var tripUsed = trips.reduce(function (s, t) {
        return s + (parseInt(t.leaves, 10) || 0);
      }, 0);
      return tripUsed + getCustomLeaveDaysCount();
    } catch (e) {
      return 0;
    }
  }

  function getRemainingLeaveBudget(u) {
    return Math.max(0, getAnnualLeavesBudget(u) - getLeavesUsedFromConfirmedTrips());
  }

  function setAdvisorReopenVisible(isVisible) {
    if (!advisorReopenBtn) return;
    advisorReopenBtn.classList.toggle('is-visible', !!isVisible);
  }

  function getStoredAdvisorData() {
    try {
      return JSON.parse(localStorage.getItem('holidayHacker_advisorData') || '{}');
    } catch (e) {
      return {};
    }
  }

  function collapseAdvisorPanel() {
    calSplit.classList.remove('cal-split--active');
    calSplit.classList.add('cal-split--seen');
    if (splitTop) splitTop.style.height = '';
  }

  function openAdvisorRecap() {
    if (calSplit.classList.contains('cal-split--active')) {
      collapseAdvisorPanel();
      return;
    }

    var data = getStoredAdvisorData();
    var gifts = (window._advisorGifts || data.gifts || []).slice();
    var bridges = (window._advisorBridges || data.bridges || []).slice();
    var megas = (window._advisorMegaBridges || data.megas || []).slice();
    if (!gifts.length && !bridges.length && !megas.length) return;

    user = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

    if (advisorMsgs.childElementCount > 0) {
      calSplit.classList.remove('cal-split--seen');
      activateSplit();
      syncAdvisorToggles();
      scrollBottom();
      return;
    }

    advisorMsgs.innerHTML = '';
    calSplit.classList.remove('cal-split--seen');
    activateSplit();
    if (!localStorage.getItem(ADVISOR_SEEN_KEY)) {
      runConversation(gifts, bridges, megas);
    } else {
      advisorMsgs.classList.add('cal-advisor-messages--instant');
      advisorFlowInstant = true;
      runConversation(gifts, bridges, megas);
      advisorFlowInstant = false;
      advisorMsgs.classList.remove('cal-advisor-messages--instant');
    }
    scrollBottom();
  }

  /* ─── Data helpers ─────────────────────────────────── */

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

  function getOverrides() {
    try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function getCustomHolidays() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); }
    catch (e) { return []; }
  }

  var CUSTOM_PREFIX_LEAVE = '__custom_leave__:';
  var CUSTOM_PREFIX_HOLIDAY = '__custom_holiday__:';
  var CUSTOM_PREFIX_LEGACY = '__custom__:';

  function customLeaveMarker(name) {
    return CUSTOM_PREFIX_LEAVE + (name || 'Leave');
  }
  function customHolidayMarker(name) {
    return CUSTOM_PREFIX_HOLIDAY + (name || 'Holiday');
  }
  function isCustomLeaveMarker(value) {
    return typeof value === 'string' && value.indexOf(CUSTOM_PREFIX_LEAVE) === 0;
  }
  function isCustomHolidayMarker(value) {
    return typeof value === 'string' && value.indexOf(CUSTOM_PREFIX_HOLIDAY) === 0;
  }
  function isLegacyCustomMarker(value) {
    return typeof value === 'string' && value.indexOf(CUSTOM_PREFIX_LEGACY) === 0;
  }
  function holidayNameFromMarker(value) {
    if (typeof value !== 'string') return value;
    if (isCustomLeaveMarker(value)) return value.slice(CUSTOM_PREFIX_LEAVE.length) || 'Leave';
    if (isCustomHolidayMarker(value)) return value.slice(CUSTOM_PREFIX_HOLIDAY.length) || 'Holiday';
    if (isLegacyCustomMarker(value)) return value.slice(CUSTOM_PREFIX_LEGACY.length) || 'Custom';
    return value;
  }

  /** Week off, or a holiday that does not consume the user's leave quota (incl. manual holiday). */
  function isOffDayWithoutUserLeave(iso, holidaySet, dateObj) {
    if (isWeekOff(dateObj)) return true;
    var v = holidaySet[iso];
    if (!v) return false;
    return !isCustomLeaveMarker(v);
  }

  function getCustomLeaveDaysCount() {
    try {
      var list = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
      return list.reduce(function (s, c) {
        return s + (c && c.kind === 'leave' ? 1 : 0);
      }, 0);
    } catch (e) { return 0; }
  }

  /* ─── Weekly off logic (all bridge/gift/mega use isWeekOff) ─────────────
   * Future: custom pattern via user.customOffDays = [0,1,6] (Sun,Mon,Sat). */

  function getWeekOffDays() {
    var pref = user.weeklyOff || 'sat-sun';
    if (pref === 'sun-only')    return [0];
    if (pref === 'sat-sun')     return [6, 0];
    if (pref === '2nd-4th-sat') return [0];
    if (pref === 'custom' && Array.isArray(user.customOffDays)) return user.customOffDays;
    return [6, 0];
  }

  function is2nd4thSat(dateObj) {
    if (dateObj.getDay() !== 6) return false;
    var week = Math.ceil(dateObj.getDate() / 7);
    return week === 2 || week === 4;
  }

  function isWeekOff(dateObj) {
    var jsDay = dateObj.getDay();
    var offDays = getWeekOffDays();
    if (offDays.indexOf(jsDay) !== -1) return true;
    if (user.weeklyOff === '2nd-4th-sat' && is2nd4thSat(dateObj)) return true;
    return false;
  }

  /* ─── Date helpers ─────────────────────────────────── */

  function addDays(d, n) {
    var r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function toISO(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function formatRange(start, end) {
    var s = new Date(start + 'T00:00:00');
    var e = new Date(end + 'T00:00:00');
    var sm = MONTHS[s.getMonth()].slice(0, 3);
    var em = MONTHS[e.getMonth()].slice(0, 3);
    if (sm === em) return sm + ' ' + s.getDate() + ' – ' + e.getDate();
    return sm + ' ' + s.getDate() + ' – ' + em + ' ' + e.getDate();
  }

  function dayLabel(iso) {
    var d = new Date(iso + 'T00:00:00');
    return DAYS_SHORT[d.getDay()] + ', ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
  }

  /* ─── Analysis: build holiday set for the year ────── */

  function buildWorkHolidaySet(holidays) {
    var ov = getOverrides();
    var set = {};
    holidays.filter(function (h) { return h.type === 'gazetted'; }).forEach(function (h) {
      var patch = ov[h.date];
      if (patch && patch._hidden) return;
      var date = patch ? (patch.date || h.date) : h.date;
      var name = patch ? (patch.name || h.name) : h.name;
      set[date] = name;
    });
    /* Personal days: kind 'holiday' = extra off-day; kind 'leave' = uses leave quota. */
    getCustomHolidays().forEach(function (c) {
      if (!c || !c.date) return;
      var isLeave = c.kind === 'leave';
      set[c.date] = isLeave ? customLeaveMarker(c.name) : customHolidayMarker(c.name);
    });
    return set;
  }

  /* ─── Gift Weekends (Free holidays): natural 3-day breaks, 0 leaves ── */

  /* Range of years the advisor is willing to plan for. We always cover the
     calendar year the user is in plus the next one, so 2027 windows are
     discoverable while the user is still in 2026 (and so on). */
  function getAdvisorYearWindow() {
    var thisYear = new Date().getFullYear();
    return { minYear: thisYear, maxYear: thisYear + 1 };
  }

  function todayISO() {
    var n = new Date();
    n.setHours(0, 0, 0, 0);
    return toISO(n);
  }

  /** Window is still actionable if its last day is today or later. */
  function isWindowUpcoming(item) {
    return !!(item && item.end && item.end >= todayISO());
  }

  function filterUpcomingWindows(list) {
    return (list || []).filter(isWindowUpcoming);
  }

  function getCurrentYear() {
    return new Date().getFullYear();
  }

  function yearEndISO(year) {
    return year + '-12-31';
  }

  function windowOverlapsYear(item, year) {
    if (!item || !item.start || !item.end) return false;
    return item.start <= yearEndISO(year) && item.end >= (year + '-01-01');
  }

  /** Upcoming windows that still have days left in the given calendar year. */
  function filterUpcomingWindowsInYear(list, year) {
    year = year || getCurrentYear();
    return filterUpcomingWindows(list).filter(function (item) {
      return windowOverlapsYear(item, year);
    });
  }

  function filterWindowsInYear(list, year) {
    year = year || getCurrentYear();
    return (list || []).filter(function (item) {
      return windowOverlapsYear(item, year);
    });
  }

  /** Skip holiday anchors in the past unless they still belong to the current calendar year. */
  function skipPastAnchor(d, now) {
    if (d >= now) return false;
    return d.getFullYear() < getCurrentYear();
  }

  function isYearInAdvisorWindow(yearStr) {
    var w = getAdvisorYearWindow();
    var y = parseInt(yearStr, 10);
    return y >= w.minYear && y <= w.maxYear;
  }

  function findGiftWeekends(holidaySet) {
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var results = [];
    var checked = {};

    Object.keys(holidaySet).sort().forEach(function (iso) {
      if (checked[iso]) return;
      var d = new Date(iso + 'T00:00:00');
      if (skipPastAnchor(d, now)) return;

      var streak = [];
      var cur = new Date(d);
      var prev = addDays(cur, -1);
      while (isWeekOff(prev) || holidaySet[toISO(prev)]) {
        cur = prev;
        prev = addDays(cur, -1);
        if (!isYearInAdvisorWindow(toISO(cur).slice(0, 4))) break;
      }
      var walk = new Date(cur);
      while (isWeekOff(walk) || holidaySet[toISO(walk)]) {
        streak.push(toISO(walk));
        walk = addDays(walk, 1);
        if (streak.length > 10) break;
      }

      if (streak.length >= 3) {
        var customLeaveDays = streak.filter(function (s) { return isCustomLeaveMarker(holidaySet[s]); }).length;
        var manualHolidayDays = streak.filter(function (s) {
          return isCustomHolidayMarker(holidaySet[s]) || isLegacyCustomMarker(holidaySet[s]);
        }).length;
        var allFree = streak.every(function (s) {
          return isWeekOff(new Date(s + 'T00:00:00')) || !!holidaySet[s];
        });
        if (allFree) {
          var hName = holidayNameFromMarker(holidaySet[iso]) || 'Weekend';
          var leaveDayIsos = streak.filter(function (s) { return isCustomLeaveMarker(holidaySet[s]); });
          leaveDayIsos.sort();
          results.push({
            name: hName + ' Weekend',
            start: streak[0],
            end: streak[streak.length - 1],
            days: streak.length,
            leaves: customLeaveDays || 0,
            _manualHolidayDays: manualHolidayDays || 0,
            leaveDays: leaveDayIsos,
            _dates: streak
          });
          streak.forEach(function (s) { checked[s] = true; });
        }
      }
    });

    return results;
  }

  /* ─── Golden Bridges: 1-2 leaves unlock 3+ day breaks ─ */

  function findGoldenBridges(holidaySet) {
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var results = [];
    var used = {};

    Object.keys(holidaySet).sort().forEach(function (iso) {
      if (isCustomLeaveMarker(holidaySet[iso])) return;
      if (used[iso]) return;
      var d = new Date(iso + 'T00:00:00');
      if (skipPastAnchor(d, now)) return;

      for (var gap = 1; gap <= 2; gap++) {
        var bridgeAfter = tryBridge(d, gap, 1, holidaySet);
        if (bridgeAfter && !used[iso]) {
          results.push(bridgeAfter);
          bridgeAfter._dates.forEach(function (s) { used[s] = true; });
        }
        var bridgeBefore = tryBridge(d, gap, -1, holidaySet);
        if (bridgeBefore && !used[iso]) {
          results.push(bridgeBefore);
          bridgeBefore._dates.forEach(function (s) { used[s] = true; });
        }
      }
    });

    return results;
  }

  function tryBridge(holidayDate, gapSize, direction, holidaySet) {
    var iso = toISO(holidayDate);
    var streak = [iso];
    var leaveDays = [];

    for (var g = 1; g <= gapSize; g++) {
      var gd = addDays(holidayDate, g * direction);
      var gi = toISO(gd);
      if (isOffDayWithoutUserLeave(gi, holidaySet, gd)) {
        streak.push(gi);
      } else {
        leaveDays.push(gi);
        streak.push(gi);
      }
    }

    var beyond = addDays(holidayDate, (gapSize + 1) * direction);
    var beyondIso = toISO(beyond);
    if (!isOffDayWithoutUserLeave(beyondIso, holidaySet, beyond)) return null;

    while (isOffDayWithoutUserLeave(toISO(beyond), holidaySet, beyond)) {
      streak.push(toISO(beyond));
      beyond = addDays(beyond, direction);
      if (streak.length > 10) break;
    }

    var back = addDays(holidayDate, -direction);
    while (isOffDayWithoutUserLeave(toISO(back), holidaySet, back)) {
      streak.push(toISO(back));
      back = addDays(back, -direction);
      if (streak.length > 10) break;
    }

    if (leaveDays.length === 0 || leaveDays.length > 2) return null;

    streak.sort();
    leaveDays.sort();
    var totalDays = streak.length;
    if (totalDays < 3) return null;

    var name = holidayNameFromMarker(holidaySet[iso]) || 'Holiday';
    return {
      name: name + ' Bridge',
      start: streak[0],
      end: streak[streak.length - 1],
      days: totalDays,
      leaves: leaveDays.length,
      leaveDays: leaveDays,
      _dates: streak
    };
  }

  /* ─── Mega-Bridge: off-to-off span, 2+ holidays in week, 2-5 leaves ─
   * Uses user's actual weekly off. Leave count = ALL work days in span
   * (includes e.g. 1st/3rd Sat for 2nd-4th-sat). Supports sat-sun, 2nd-4th-sat,
   * sun-only (8-day Sun-to-Sun), and custom (from each off-day). */

  function getMegaStartDatesAndSpan(year) {
    var pref = user.weeklyOff || 'sat-sun';
    var out = { starts: [], spanDays: 9 };

    if (pref === 'sat-sun') {
      out.spanDays = 9;
      for (var m = 0; m < 12; m++) {
        var firstSat = new Date(year, m, 1);
        var dow = firstSat.getDay();
        var satOffset = dow === 6 ? 0 : (6 - dow + 7) % 7;
        firstSat.setDate(1 + satOffset);
        while (firstSat.getMonth() === m && firstSat.getFullYear() === year) {
          out.starts.push(new Date(firstSat));
          firstSat.setDate(firstSat.getDate() + 7);
        }
      }
    } else if (pref === '2nd-4th-sat') {
      out.spanDays = 9;
      for (var m = 0; m < 12; m++) {
        var firstSat = new Date(year, m, 1);
        var dow = firstSat.getDay();
        var satOffset = dow === 6 ? 0 : (6 - dow + 7) % 7;
        firstSat.setDate(1 + satOffset);
        var weekNum = 1;
        while (firstSat.getMonth() === m && firstSat.getFullYear() === year) {
          if (weekNum === 2 || weekNum === 4) out.starts.push(new Date(firstSat));
          firstSat.setDate(firstSat.getDate() + 7);
          weekNum++;
        }
      }
    } else if (pref === 'sun-only') {
      out.spanDays = 8;
      for (var m = 0; m < 12; m++) {
        var firstSun = new Date(year, m, 1);
        var dow = firstSun.getDay();
        var sunOffset = dow === 0 ? 0 : (7 - dow) % 7;
        firstSun.setDate(1 + sunOffset);
        while (firstSun.getMonth() === m && firstSun.getFullYear() === year) {
          out.starts.push(new Date(firstSun));
          firstSun.setDate(firstSun.getDate() + 7);
        }
      }
    } else if (pref === 'custom' && Array.isArray(user.customOffDays) && user.customOffDays.length) {
      out.spanDays = 9;
      var offDays = user.customOffDays;
      for (var m = 0; m < 12; m++) {
        for (var d = 1; d <= 31; d++) {
          var dt = new Date(year, m, d);
          if (dt.getMonth() !== m) continue;
          if (offDays.indexOf(dt.getDay()) !== -1) out.starts.push(new Date(dt));
        }
      }
    }

    return out;
  }

  function findMegaBridges(holidaySet) {
    var pref = user.weeklyOff || 'sat-sun';
    var win = getAdvisorYearWindow();
    /* Build a combined list of mega start dates spanning every year in the
       advisor window so 2027 mega-bridges are surfaced while the user is in
       2026, and so on each year. */
    var spanDays = 9;
    var startsAcrossYears = [];
    for (var y = win.minYear; y <= win.maxYear; y++) {
      var partial = getMegaStartDatesAndSpan(y);
      if (partial && partial.starts && partial.starts.length) {
        spanDays = partial.spanDays;
        startsAcrossYears = startsAcrossYears.concat(partial.starts);
      }
    }
    if (!startsAcrossYears.length) return [];
    var cfg = { starts: startsAcrossYears, spanDays: spanDays };

    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var results = [];
    var usedDates = {};

    cfg.starts.forEach(function (startSat) {
      if (skipPastAnchor(startSat, now)) return;
      if (!isWeekOff(startSat)) return;

      var mon = addDays(startSat, 2);
      var fri = addDays(startSat, 6);
      var holidaysInWeek = 0;
      for (var d = new Date(mon); d <= fri; d = addDays(d, 1)) {
        var wIso = toISO(d);
        var hv = holidaySet[wIso];
        if (hv && !isCustomLeaveMarker(hv)) holidaysInWeek++;
      }

      if (holidaysInWeek < 2) return;

      /* Leave days = ALL days in span that are work (not holiday, not week-off).
       * For 2nd-4th sat, Sat at index 7 may be work if not 2nd/4th. */
      var streak = [];
      var leaveDays = [];
      for (var i = 0; i < spanDays; i++) {
        var dayDate = addDays(startSat, i);
        var wi = toISO(dayDate);
        streak.push(wi);
        var hv = holidaySet[wi];
        var quotaFreeOff = hv && !isCustomLeaveMarker(hv);
        if (!quotaFreeOff && !isWeekOff(dayDate)) leaveDays.push(wi);
      }

      if (leaveDays.length < 2 || leaveDays.length > 4) return;

      if (streak.some(function (iso) { return usedDates[iso]; })) return;

      if (!isWeekOff(addDays(startSat, spanDays - 1))) return;

      var holSet = {};
      var firstHolidayName = null;
      streak.forEach(function (iso) {
        var hv = holidaySet[iso];
        if (hv && !isCustomLeaveMarker(hv)) {
          holSet[iso] = true;
          if (!firstHolidayName) firstHolidayName = holidayNameFromMarker(hv);
        }
      });

      var bridgeKind = spanDays === 9 ? 'Mega-Bridge' : 'Long Bridge';
      results.push({
        name: (firstHolidayName || 'Holiday') + ' ' + bridgeKind,
        start: streak[0],
        end: streak[spanDays - 1],
        days: spanDays,
        leaves: leaveDays.length,
        leaveDays: leaveDays,
        _dates: streak,
        _holidaySet: holSet
      });

      streak.forEach(function (iso) { usedDates[iso] = true; });
    });

    return results;
  }

  window.startCalendarAdvisor = startAdvisor;

  function buildMegaPatternDisplay(mega) {
    var leaveSet = {};
    mega.leaveDays.forEach(function (iso) { leaveSet[iso] = true; });
    var holSet = mega._holidaySet || {};
    var parts = [];
    mega._dates.forEach(function (iso) {
      var d = new Date(iso + 'T00:00:00');
      var dayName = DAYS_SHORT[d.getDay()].slice(0, 2);
      if (leaveSet[iso]) parts.push('<span class="mega-bar-seg mega-bar-seg--leave">L</span>');
      else if (holSet[iso]) parts.push('<span class="mega-bar-seg mega-bar-seg--hol">HOL</span>');
      else parts.push('<span class="mega-bar-seg mega-bar-seg--off">' + dayName + '</span>');
    });
    return parts.join('');
  }

  function dedupeOverlappingBridges(bridges) {
    bridges.sort(function (a, b) { return b.days - a.days; });
    var kept = [];
    var usedDates = {};
    bridges.forEach(function (b) {
      var overlap = b._dates.some(function (iso) { return usedDates[iso]; });
      if (overlap) return;
      kept.push(b);
      b._dates.forEach(function (iso) { usedDates[iso] = true; });
    });
    return kept;
  }

  /* ─── Chat UI helpers ──────────────────────────────── */

  function leavesLeftTipHtml() {
    return '<p>Still have leaves left? Toggle <strong>Bridge it?</strong> on a golden or mega bridge to send that window to <strong>Plan</strong>. ' +
      'You can also turn on <strong>Plan trip?</strong> on free holidays in the calendar above. Swipe through months to discover more opportunities!</p>';
  }

  function scrollBottom() {
    requestAnimationFrame(function () {
      splitBottom.scrollTop = splitBottom.scrollHeight;
    });
  }

  function addBotMsg(html, cb) {
    if (advisorFlowInstant) {
      var rowInstant = document.createElement('div');
      rowInstant.className = 'advisor-row';
      rowInstant.innerHTML =
        '<div class="advisor-avatar"><span class="material-symbols-outlined">smart_toy</span></div>' +
        '<div class="advisor-bubble">' + html + '</div>';
      advisorMsgs.appendChild(rowInstant);
      scrollBottom();
      if (cb) cb();
      return;
    }

    var typing = document.createElement('div');
    typing.className = 'advisor-row';
    typing.innerHTML =
      '<div class="advisor-avatar"><span class="material-symbols-outlined">smart_toy</span></div>' +
      '<div class="advisor-bubble">' +
        '<div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>' +
      '</div>';
    advisorMsgs.appendChild(typing);
    scrollBottom();

    var delay = Math.max(600, Math.min(html.length * 5, 1400));
    setTimeout(function () {
      typing.remove();
      var row = document.createElement('div');
      row.className = 'advisor-row';
      row.innerHTML =
        '<div class="advisor-avatar"><span class="material-symbols-outlined">smart_toy</span></div>' +
        '<div class="advisor-bubble">' + html + '</div>';
      advisorMsgs.appendChild(row);
      scrollBottom();
      if (cb) setTimeout(cb, 1000);
    }, delay);
  }

  function createCardElement(cardHTML) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = cardHTML;
    var card = wrapper.firstElementChild;
    card.className += ' advisor-card';
    return card;
  }

  function addCard(cardHTML) {
    advisorMsgs.appendChild(createCardElement(cardHTML));
    scrollBottom();
  }

  function createCardBatch() {
    var batch = document.createElement('div');
    batch.className = 'advisor-card-batch';
    advisorMsgs.appendChild(batch);
    scrollBottom();
    return batch;
  }

  function appendCardToBatch(batch, cardHTML) {
    batch.appendChild(createCardElement(cardHTML));
    scrollBottom();
  }

  var ADVISOR_INITIAL_CARDS = 3;

  /** Distinct calendar dates across the full calendar year (includes past days in the year). */
  function countUniqueOpportunityDaysFullYear(gifts, bridges, megas, year) {
    year = year || getCurrentYear();
    var yearStart = year + '-01-01';
    var yearEnd = yearEndISO(year);
    var set = {};
    function absorb(list) {
      (list || []).forEach(function (item) {
        if (!windowOverlapsYear(item, year)) return;
        (item._dates || []).forEach(function (iso) {
          if (iso && iso >= yearStart && iso <= yearEnd) set[iso] = true;
        });
      });
    }
    absorb(gifts);
    absorb(bridges);
    absorb(megas);
    return Object.keys(set).length;
  }

  /** Distinct calendar dates from today through end of year across upcoming windows (no double-count). */
  function countUniqueOpportunityDays(gifts, bridges, megas, year) {
    year = year || getCurrentYear();
    var today = todayISO();
    var yearEnd = yearEndISO(year);
    var set = {};
    function absorb(list) {
      (list || []).forEach(function (item) {
        if (!isWindowUpcoming(item) || !windowOverlapsYear(item, year)) return;
        (item._dates || []).forEach(function (iso) {
          if (iso && iso >= today && iso <= yearEnd) set[iso] = true;
        });
      });
    }
    absorb(gifts);
    absorb(bridges);
    absorb(megas);
    return Object.keys(set).length;
  }

  function insertShowMoreAfter(anchorEl, hiddenCount, onReveal) {
    if (hiddenCount <= 0 || typeof onReveal !== 'function') return null;
    var row = document.createElement('div');
    row.className = 'advisor-row advisor-row--show-more';
    row.innerHTML = '<button type="button" class="advisor-show-more-btn">Show ' + hiddenCount + ' more</button>';
    row.querySelector('button').addEventListener('click', function () {
      onReveal();
      row.remove();
      scrollBottom();
    });
    if (anchorEl && anchorEl.nextSibling) {
      advisorMsgs.insertBefore(row, anchorEl.nextSibling);
    } else {
      advisorMsgs.appendChild(row);
    }
    scrollBottom();
    return row;
  }

  function addCardsWithShowMore(items, buildCardFn, initialLimit) {
    initialLimit = initialLimit || ADVISOR_INITIAL_CARDS;
    var batch = createCardBatch();
    var visible = items.slice(0, initialLimit);
    var hidden = items.slice(initialLimit);
    visible.forEach(function (item) { appendCardToBatch(batch, buildCardFn(item)); });
    if (hidden.length) {
      insertShowMoreAfter(batch, hidden.length, function () {
        hidden.forEach(function (item) { appendCardToBatch(batch, buildCardFn(item)); });
      });
    }
  }

  function addCardsAnimatedWithShowMore(items, buildCardFn, initialLimit, done) {
    initialLimit = initialLimit || ADVISOR_INITIAL_CARDS;
    var batch = createCardBatch();
    var first = items.slice(0, initialLimit);
    var rest = items.slice(initialLimit);
    first.forEach(function (item, i) {
      setTimeout(function () { appendCardToBatch(batch, buildCardFn(item)); }, i * 300);
    });
    var afterFirst = first.length * 300 + 400;
    setTimeout(function () {
      if (rest.length) {
        insertShowMoreAfter(batch, rest.length, function () {
          rest.forEach(function (item, i) {
            setTimeout(function () { appendCardToBatch(batch, buildCardFn(item)); }, i * 300);
          });
        });
      }
      if (done) done();
    }, afterFirst);
  }

  function buildGiftCard(g) {
    var leaves = parseInt(g.leaves, 10) || 0;
    var manualHol = parseInt(g._manualHolidayDays, 10) || 0;
    var badge;
    var logic;
    var tick;
    if (leaves > 0) {
      badge = leaves + ' Leave' + (leaves === 1 ? '' : 's') + ' · ' + g.days + ' Days';
      logic = 'Uses ' + leaves + ' personal leave day' + (leaves === 1 ? '' : 's') + ' for this break.';
      tick = '✓ Uses leave';
    } else if (manualHol > 0) {
      badge = g.days + ' Days';
      logic = 'Includes ' + manualHol + ' manual holiday day' + (manualHol === 1 ? '' : 's') + ' (no leave quota).';
      tick = '✓ Manual holiday';
    } else {
      badge = '0 Leaves · ' + g.days + ' Days';
      logic = 'Free — no leaves needed';
      tick = '✓ Free';
    }
    var leaveDatesRow = '';
    if (leaves > 0 && g.leaveDays && g.leaveDays.length) {
      var glabels = g.leaveDays.map(function (iso) { return formatLeaveLabel(iso); });
      leaveDatesRow = '<p class="advisor-card-logic advisor-card-logic--leave-dates">Leave: ' + glabels.join(' &amp; ') + '</p>';
    }
    return '<div class="advisor-card advisor-card--gift">' +
      '<div class="advisor-card-header">' +
        '<h4 class="advisor-card-title">' + g.name + '</h4>' +
        '<span class="advisor-card-badge advisor-card-badge--gift">' + badge + '</span>' +
      '</div>' +
      '<p class="advisor-card-date">' + formatRange(g.start, g.end) + '</p>' +
      leaveDatesRow +
      '<div class="advisor-card-footer">' +
        '<span class="advisor-card-logic">' + logic + '</span>' +
        '<span style="font-size:0.65rem;color:#dc2626;font-weight:600;">' + tick + '</span>' +
      '</div>' +
    '</div>';
  }

  function formatLeaveLabel(iso) {
    var d = new Date(iso + 'T00:00:00');
    var dayName = DAYS_SHORT[d.getDay()];
    var rest = MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
    return '<span class="leave-day-name">' + dayName + '</span> ' + rest;
  }

  function buildBridgeCard(b, idx) {
    var leaveLabels = b.leaveDays.map(function (iso) { return formatLeaveLabel(iso); });
    var leaveStr = 'Leave on: ' + leaveLabels.join(' &amp; ');
    var sel = getSelectedBridges().indexOf(b.start) !== -1;

    return '<div class="advisor-card advisor-card--bridge" data-bridge-start="' + b.start + '" data-bridge-leaves="' + b.leaves + '">' +
      '<div class="advisor-card-header">' +
        '<h4 class="advisor-card-title">' + b.name + '</h4>' +
        '<span class="advisor-card-badge advisor-card-badge--bridge">' + b.leaves + ' Leave' + (b.leaves > 1 ? 's' : '') + ' / ' + b.days + ' Days</span>' +
      '</div>' +
      '<p class="advisor-card-date">' + formatRange(b.start, b.end) + '</p>' +
      '<div class="advisor-card-footer">' +
        '<span class="advisor-card-logic">' + leaveStr + '</span>' +
        '<div class="advisor-toggle-wrap">' +
          '<span>Bridge it?</span>' +
          '<button type="button" class="advisor-toggle' + (sel ? ' is-on' : '') + '" aria-label="Toggle bridge"></button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ─── Conversation flow ────────────────────────────── */

  function runConversation(gifts, bridges, megas) {
    var currentYear = getCurrentYear();
    var fullGifts = filterWindowsInYear(gifts, currentYear);
    var fullBridges = filterWindowsInYear(bridges, currentYear);
    var fullMegas = filterWindowsInYear(megas || [], currentYear);
    var upcomingGifts = filterUpcomingWindowsInYear(gifts, currentYear);
    var upcomingBridges = filterUpcomingWindowsInYear(bridges, currentYear);
    var upcomingMegas = filterUpcomingWindowsInYear(megas || [], currentYear);

    var name = user.name || 'there';
    var remaining = getRemainingLeaveBudget(user);
    var fullOppCount = fullGifts.length + fullBridges.length + fullMegas.length;
    var fullUniqueDays = countUniqueOpportunityDaysFullYear(fullGifts, fullBridges, fullMegas, currentYear);
    var upcomingOppCount = upcomingGifts.length + upcomingBridges.length + upcomingMegas.length;
    var upcomingUniqueDays = countUniqueOpportunityDays(upcomingGifts, upcomingBridges, upcomingMegas, currentYear);

    var fullMegaCount = fullMegas.length;
    var parts = [];
    if (fullGifts.length) parts.push('<strong>' + fullGifts.length + ' Free Holiday' + (fullGifts.length !== 1 ? 's' : '') + '</strong>');
    if (fullBridges.length) parts.push('<strong>' + fullBridges.length + ' Golden Bridge' + (fullBridges.length !== 1 ? 's' : '') + '</strong>');
    if (fullMegaCount) parts.push('<strong>' + fullMegaCount + ' Mega-Bridge' + (fullMegaCount !== 1 ? 's' : '') + '</strong>');
    var gotStr = parts.length ? 'That includes ' + parts.join(', ') + '.' : '';
    var msg1 =
      '<p>Okay, <strong>' + name + '</strong>, I\'ve mapped out your breaks for <strong>' + currentYear + '</strong>! Across the full year, I found <strong>' + fullOppCount + '</strong> trip window' +
      (fullOppCount === 1 ? '' : 's') + ' covering about <strong>' + fullUniqueDays +
      '</strong> distinct calendar days (weekends and public holidays included). ' + gotStr + '</p>' +
      '<p class="advisor-legend advisor-legend--free">🎁 Free Holidays: Natural 3-day breaks. No leaves needed.</p>' +
      '<p class="advisor-legend advisor-legend--bridge">🌉 Golden Bridges: 4-day (or more) breaks created by taking 1 or 2 strategic leaves.</p>';
    if (fullMegaCount) {
      msg1 += '<p class="advisor-legend advisor-legend--mega">🏆 Mega-Bridges: 8–9 days off in a row. When 2+ holidays fall in a week, take 2–4 leaves to bridge them (based on your weekly off).</p>';
    }

    var msg2Body =
      '<p>For the rest of <strong>' + currentYear + '</strong> (from today through Dec&nbsp;31), I found <strong>' + upcomingOppCount + '</strong> upcoming trip window' +
      (upcomingOppCount === 1 ? '' : 's') + ' covering about <strong>' + upcomingUniqueDays +
      '</strong> distinct calendar days still ahead this year (weekends and public holidays included; expired windows are excluded). ' +
      'You have <strong>' + remaining + '</strong> paid leave day' + (remaining === 1 ? '' : 's') +
      ' left in your quota for windows that need leave. Let\'s review!</p>';

    gifts = upcomingGifts;
    bridges = upcomingBridges;
    megas = upcomingMegas;
    var megaCount = megas.length;

    if (advisorFlowInstant) {
      var msg2Instant = msg2Body;
      addBotMsg(msg1, null);
      addBotMsg(msg2Instant, null);
      if (gifts.length) {
        addBotMsg('<p>Here are your <strong class="advisor-legend advisor-legend--free">Free Holidays</strong> — 3+ day breaks that cost 0 leaves.</p>', null);
        addCardsWithShowMore(gifts, buildGiftCard, ADVISOR_INITIAL_CARDS);
      }
      showMegasThenBridges(megas || [], bridges);
      return;
    }

    addBotMsg(msg1, function () {
      var msg2 = msg2Body;
      addBotMsg(msg2, function () {
        if (gifts.length) {
          addBotMsg('<p>Here are your <strong class="advisor-legend advisor-legend--free">Free Holidays</strong> — 3+ day breaks that cost 0 leaves.</p>', function () {
            addCardsAnimatedWithShowMore(gifts, buildGiftCard, ADVISOR_INITIAL_CARDS, function () {
              showMegasThenBridges(megas || [], bridges);
            });
          });
        } else {
          showMegasThenBridges(megas || [], bridges);
        }
      });
    });
  }

  function showMegasThenBridges(megas, bridges) {
    if (megas && megas.length) {
      var monthLabels = [];
      megas.forEach(function (m) {
        var s = new Date(m.start + 'T00:00:00');
        monthLabels.push(MONTHS[s.getMonth()]);
      });
      var monthStr = monthLabels.length === 1 ? monthLabels[0] : monthLabels.slice(0, -1).join(', ') + ' and ' + monthLabels[monthLabels.length - 1];
      if (advisorFlowInstant) {
        var m0 = megas[0];
        addBotMsg('<p>Wait... I\'ve found something special coming up in <strong>' + monthStr + ' ' + new Date().getFullYear() + '</strong>! 🤯</p>', null);
        addBotMsg('<p>By using <strong>' + m0.leaves + ' leave' + (m0.leaves > 1 ? 's' : '') + '</strong>, you can trigger a Mega-Bridge — <strong>' + m0.days + ' days</strong> in a row off, based on your weekly off pattern.</p>', null);
        megas.forEach(function (m) { addCard(buildMegaCard(m)); });
        showBridges(bridges, megas);
        return;
      }
      addBotMsg('<p>Wait... I\'ve found something special coming up in <strong>' + monthStr + ' ' + new Date().getFullYear() + '</strong>! 🤯</p>', function () {
        var m0 = megas[0];
        addBotMsg('<p>By using <strong>' + m0.leaves + ' leave' + (m0.leaves > 1 ? 's' : '') + '</strong>, you can trigger a Mega-Bridge — <strong>' + m0.days + ' days</strong> in a row off, based on your weekly off pattern.</p>', function () {
          megas.forEach(function (m, i) {
            setTimeout(function () { addCard(buildMegaCard(m)); }, i * 400);
          });
          setTimeout(function () { showBridges(bridges, megas); }, megas.length * 400 + 500);
        });
      });
    } else {
      showBridges(bridges);
    }
  }

  function buildMegaCard(m) {
    var leaveLabels = m.leaveDays.map(function (iso) { return formatLeaveLabel(iso); });
    var leaveStr = 'Leave on: ' + leaveLabels.join(' &amp; ');
    var barHtml = buildMegaPatternDisplay(m);
    var title = m.name || (m.days === 9 ? 'Mega-Bridge' : 'Long Bridge');
    var sel = getSelectedBridges().indexOf(m.start) !== -1;

    return '<div class="advisor-card advisor-card--mega" data-bridge-start="' + m.start + '" data-bridge-leaves="' + m.leaves + '">' +
      '<div class="advisor-card-header">' +
        '<h4 class="advisor-card-title">' + title + '</h4>' +
        '<span class="advisor-card-badge advisor-card-badge--mega">' + m.leaves + ' Leave' + (m.leaves > 1 ? 's' : '') + ' / ' + m.days + ' Days</span>' +
      '</div>' +
      '<p class="advisor-card-date">' + formatRange(m.start, m.end) + '</p>' +
      '<div class="advisor-card-mega-bar">' + barHtml + '</div>' +
      '<p class="advisor-card-mega-roi">' + m.leaves + ' Leaves spent = ' + m.days + ' Days gained.</p>' +
      '<div class="advisor-card-footer">' +
        '<span class="advisor-card-logic">' + leaveStr + '</span>' +
        '<div class="advisor-toggle-wrap">' +
          '<span>Bridge it?</span>' +
          '<button type="button" class="advisor-toggle advisor-toggle--mega' + (sel ? ' is-on' : '') + '" aria-label="Toggle mega bridge"></button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function showLeavesTipThenPlanNav(bridges, megas) {
    wireToggles(bridges, megas);
    if (advisorFlowInstant) {
      addBotMsg(leavesLeftTipHtml(), null);
      showPassportNav();
      return;
    }
    addBotMsg(leavesLeftTipHtml(), function () {
      setTimeout(showPassportNav, 400);
    });
  }

  function showBridges(bridges, megas) {
    megas = megas || [];
    if (!bridges.length && !megas.length) {
      if (advisorFlowInstant) {
        addBotMsg('<p>No upcoming Golden Bridges found in ' + new Date().getFullYear() + ' — but you can still tap any weekend on the calendar to manually bridge it!</p>', null);
        showPassportNav();
        return;
      }
      addBotMsg('<p>No upcoming Golden Bridges found in ' + new Date().getFullYear() + ' — but you can still tap any weekend on the calendar to manually bridge it!</p>', function () {
        setTimeout(showPassportNav, 400);
      });
      return;
    }
    if (!bridges.length) {
      showLeavesTipThenPlanNav(bridges, megas);
      return;
    }
    if (advisorFlowInstant) {
      addBotMsg('<p>These are the <strong class="advisor-legend advisor-legend--bridge">Golden Bridges</strong>. A tiny investment of 1–2 leaves unlocks a longer vacation.</p>', null);
      addCardsWithShowMore(bridges, buildBridgeCard, ADVISOR_INITIAL_CARDS);
      showLeavesTipThenPlanNav(bridges, megas);
      return;
    }
    addBotMsg('<p>These are the <strong class="advisor-legend advisor-legend--bridge">Golden Bridges</strong>. A tiny investment of 1–2 leaves unlocks a longer vacation.</p>', function () {
      addCardsAnimatedWithShowMore(bridges, buildBridgeCard, ADVISOR_INITIAL_CARDS, function () {
        showLeavesTipThenPlanNav(bridges, megas);
      });
    });
  }

  function showPassportNav() {
    if (document.getElementById('advisorNavBlock')) return;
    localStorage.setItem(ADVISOR_SEEN_KEY, '1');
    setAdvisorReopenVisible(true);
    var block = document.createElement('div');
    block.id = 'advisorNavBlock';
    block.className = 'advisor-row';
    block.innerHTML =
      '<div class="advisor-avatar"><span class="material-symbols-outlined">smart_toy</span></div>' +
      '<div class="advisor-bubble advisor-bubble--nav">' +
        '<p>Ready to plan your trips? Head to <strong>Plan</strong> for destination recommendations tailored to your free windows.</p>' +
        '<a href="../plan/index.html" class="advisor-nav-btn">Go to Plan</a>' +
      '</div>';
    advisorMsgs.appendChild(block);
    scrollBottom();
  }

  function hidePassportNav() {
    var el = document.getElementById('advisorNavBlock');
    if (el) el.remove();
  }

  function showLeaveOverWarning() {
    var existing = document.getElementById('advisorLeaveWarning');
    if (existing) existing.remove();
    var row = document.createElement('div');
    row.id = 'advisorLeaveWarning';
    row.className = 'advisor-row advisor-row--warning';
    row.innerHTML =
      '<div class="advisor-avatar"><span class="material-symbols-outlined">smart_toy</span></div>' +
      '<div class="advisor-bubble advisor-bubble--warning">' +
        '<p>You\'ve selected more bridges than your remaining leave budget allows (after confirmed trips). Ease off a bridge or adjust your annual quota on Profile.</p>' +
      '</div>';
    advisorMsgs.appendChild(row);
    scrollBottom();
  }

  function getSelectedBridges() {
    try {
      return JSON.parse(localStorage.getItem(SELECTED_BRIDGES_KEY) || '[]');
    } catch (e) { return []; }
  }

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
    window.dispatchEvent(new CustomEvent('bridgeSelectionChange'));
  }

  function syncAdvisorToggles() {
    var sel = getSelectedBridges();
    advisorMsgs.querySelectorAll('.advisor-card--bridge .advisor-toggle, .advisor-card--mega .advisor-toggle').forEach(function (btn) {
      var card = btn.closest('.advisor-card--bridge, .advisor-card--mega');
      var start = card ? card.getAttribute('data-bridge-start') : null;
      if (start) {
        if (sel.indexOf(start) !== -1) btn.classList.add('is-on');
        else btn.classList.remove('is-on');
      }
    });
  }

  window.addEventListener('bridgeSelectionChange', syncAdvisorToggles);

  function wireToggles(bridges, megas) {
    var toggles = advisorMsgs.querySelectorAll('.advisor-card--bridge .advisor-toggle, .advisor-card--mega .advisor-toggle');

    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var u = {};
        try { u = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e2) { u = {}; }
        var pending = getRemainingLeaveBudget(u);
        var card = btn.closest('.advisor-card--bridge, .advisor-card--mega');
        var start = card ? card.getAttribute('data-bridge-start') : null;
        btn.classList.toggle('is-on');
        var bridgeOn = btn.classList.contains('is-on');
        if (start) setSelectedBridge(start, bridgeOn);
        if (bridgeOn && typeof window.HH_showCalPlanToast === 'function') {
          var titleEl = card ? card.querySelector('.advisor-card-title') : null;
          window.HH_showCalPlanToast(titleEl ? titleEl.textContent.trim() : '');
        }

        var total = 0;
        toggles.forEach(function (t) {
          if (t.classList.contains('is-on')) {
            var c = t.closest('.advisor-card--bridge, .advisor-card--mega');
            if (c) total += parseInt(c.getAttribute('data-bridge-leaves') || '0', 10);
          }
        });

        if (total > pending) {
          hidePassportNav();
          showLeaveOverWarning();
          setTimeout(showPassportNav, 1500);
        }
      });
    });
  }

  /* ─── Split panel activation ───────────────────────── */

  function activateSplit() {
    var navH = 64;
    var pageH = calSplit.parentElement.clientHeight - navH;
    var topH = Math.round(pageH * 0.48);

    calSplit.classList.add('cal-split--active');
    splitTop.style.height = topH + 'px';

    setupDragHandle(pageH);
  }

  function setupDragHandle(pageH) {
    var startY, startH;
    var handleH = splitHandle.offsetHeight;
    var minTop = 120;
    var maxTop = pageH - 150 - handleH;

    function onMove(clientY) {
      var delta = clientY - startY;
      var newH = Math.max(minTop, Math.min(maxTop, startH + delta));
      splitTop.style.height = newH + 'px';
    }

    splitHandle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startY = e.clientY;
      startH = splitTop.offsetHeight;
      function mm(ev) { onMove(ev.clientY); }
      function mu() { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });

    splitHandle.addEventListener('touchstart', function (e) {
      startY = e.touches[0].clientY;
      startH = splitTop.offsetHeight;
      function tm(ev) { ev.preventDefault(); onMove(ev.touches[0].clientY); }
      function te() { document.removeEventListener('touchmove', tm); document.removeEventListener('touchend', te); }
      document.addEventListener('touchmove', tm, { passive: false });
      document.addEventListener('touchend', te);
    }, { passive: true });
  }

  /* ─── Native-alarm reconciliation (run on advisor recompute) ────────
   *
   * Trips and 65-day heads-up notifications live in a native AlarmManager via
   * the Capacitor HolidayAlarm plugin. When the user uses the advisor (e.g.
   * unticks a bridge) the underlying window can disappear from
   * holidayHacker_advisorData / holidayHacker_selectedBridges / 
   * holidayHacker_plannedTrips. Without explicit cleanup the alarm would
   * still fire even though the trip is gone. These helpers run from
   * scheduleAdvisor() so cancellation is immediate, without needing the user
   * to visit the Trips page first. */

  var SELECTED_BRIDGES_KEY_CONST = 'holidayHacker_selectedBridges';
  var PLANNED_TRIPS_KEY_CONST    = 'holidayHacker_plannedTrips';
  var ADVISOR_DATA_KEY_CONST     = 'holidayHacker_advisorData';

  function holidayAlarmPlugin() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayAlarm) {
      return window.Capacitor.Plugins.HolidayAlarm;
    }
    return null;
  }

  function readActiveWindowStarts() {
    var data, selected, planned;
    try { data     = JSON.parse(localStorage.getItem(ADVISOR_DATA_KEY_CONST) || '{}'); } catch (_) { data = {}; }
    try { selected = JSON.parse(localStorage.getItem(SELECTED_BRIDGES_KEY_CONST) || '[]'); } catch (_) { selected = []; }
    try { planned  = JSON.parse(localStorage.getItem(PLANNED_TRIPS_KEY_CONST) || '[]'); } catch (_) { planned = []; }
    var active = {};
    (data.gifts   || []).forEach(function (g) { if (planned.indexOf(g.start) !== -1) active[g.start] = true; });
    (data.bridges || []).forEach(function (b) { if (selected.indexOf(b.start) !== -1) active[b.start] = true; });
    (data.megas   || []).forEach(function (m) { if (selected.indexOf(m.start) !== -1) active[m.start] = true; });
    return active;
  }

  function cancelOrphanedTripAlarms() {
    /* Confirmed trips are user-owned, frozen at confirmation time. They are
       NOT touched by advisor recomputes, app updates, or by the user
       deselecting a bridge in Calendar. The only way a confirmed trip and
       its alarms go away is the explicit Remove button on the Trips page.
       This used to silently delete trips whose windowStart no longer
       matched an advisor-computed bridge, which lost user data across app
       updates — that behaviour is intentionally removed. Kept as a no-op
       so older call sites in this file still resolve. */
  }

  function cancelOrphanedHolidayPlanAlarms() {
    var p = holidayAlarmPlugin();
    if (!p || typeof p.listScheduled !== 'function') return;
    var data;
    try { data = JSON.parse(localStorage.getItem(ADVISOR_DATA_KEY_CONST) || '{}'); } catch (_) { return; }
    var validIds = {};
    function noteValid(type, item) {
      if (!item || !item.start) return;
      if ((item.days || 0) < 3) return;
      validIds['holiday-' + type + '-' + item.start] = true;
    }
    (data.gifts   || []).forEach(function (g) { noteValid('gift',   g); });
    (data.bridges || []).forEach(function (b) { noteValid('bridge', b); });
    (data.megas   || []).forEach(function (m) { noteValid('mega',   m); });
    try {
      p.listScheduled().then(function (res) {
        var alarms = (res && res.alarms) || [];
        alarms.forEach(function (a) {
          if (!a || typeof a.id !== 'string') return;
          if (a.id.indexOf('holiday-') !== 0) return;
          if (!validIds[a.id]) {
            try { p.cancel({ id: a.id }).catch(function () {}); } catch (_) {}
          }
        });
      }).catch(function () {});
    } catch (_) {}
  }

  /* ─── Init ─────────────────────────────────────────── */

  function startAdvisor() {
    if (advisorStarted) return;
    advisorStarted = true;
    if (!localStorage.getItem(CAL_DONE_KEY)) return;
    setAdvisorReopenVisible(true);
    user = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!user.workLocation) return;

    var advisorRan = false;
    function runOnce() {
      if (advisorRan) return;
      advisorRan = true;
      scheduleAdvisor();
    }

    setTimeout(runOnce, MAX_WAIT);

    fetch(SC_JSON)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        stateData = d;
        var workCode = stateCodeFromLocation(user.workLocation);
        if (workCode) {
          /* Pull every year the advisor is willing to plan for so bridges and
             mega-bridges that cross New Year (and next year's gazetted list)
             are part of the recommendation set. Years without a JSON bundle
             simply resolve to []. */
          var win = getAdvisorYearWindow();
          var fetches = [];
          for (var y = win.minYear; y <= win.maxYear; y++) {
            fetches.push(fetchHolidays(workCode, y));
          }
          Promise.all(fetches).then(function (lists) {
            workHolidays = [];
            lists.forEach(function (list) { workHolidays = workHolidays.concat(list || []); });
            runOnce();
          }).catch(runOnce);
        } else {
          runOnce();
        }
      })
      .catch(runOnce);
  }

  function scheduleAdvisor() {
    setTimeout(function () {
      var holidaySet = buildWorkHolidaySet(workHolidays);
      var gifts   = findGiftWeekends(holidaySet);
      var bridges = findGoldenBridges(holidaySet);
      var megas   = findMegaBridges(holidaySet);

      var giftDates = {};
      gifts.forEach(function (g) {
        var s = new Date(g.start + 'T00:00:00');
        var e = new Date(g.end + 'T00:00:00');
        while (s <= e) { giftDates[toISO(s)] = true; s = addDays(s, 1); }
      });
      bridges = bridges.filter(function (b) { return !giftDates[b.start]; });

      var megaDates = {};
      megas.forEach(function (m) {
        m._dates.forEach(function (iso) { megaDates[iso] = true; });
      });
      bridges = bridges.filter(function (b) {
        return !b._dates.some(function (iso) { return megaDates[iso]; });
      });

      window._advisorBridgesAll = bridges.slice();
      window._advisorMegaBridges = megas;
      window._advisorGifts = gifts;
      bridges = dedupeOverlappingBridges(bridges);
      window._advisorBridges = bridges;

      try {
        localStorage.setItem('holidayHacker_advisorData', JSON.stringify({
          gifts: gifts,
          bridges: window._advisorBridges,
          bridgesAll: window._advisorBridgesAll,
          megas: megas
        }));
      } catch (e) {}

      /* Whenever advisor recomputes the set of free-holiday / bridge / mega
         windows, immediately reconcile any native alarms so a deleted window
         (unticked bridge, advisor recompute that drops a stale window, etc.)
         cannot ring on a trip that no longer exists. */
      try { cancelOrphanedTripAlarms(); } catch (e) {}
      try { cancelOrphanedHolidayPlanAlarms(); } catch (e) {}

      if (typeof window.refreshCalendarBreaks === 'function') {
        window.refreshCalendarBreaks();
      }

      if (localStorage.getItem(ADVISOR_SEEN_KEY)) {
        calSplit.classList.add('cal-split--seen');
      } else {
        activateSplit();
        setTimeout(function () { runConversation(gifts, bridges, megas); }, 600);
      }
    }, DELAY);
  }

  if (advisorReopenBtn) {
    advisorReopenBtn.addEventListener('click', openAdvisorRecap);
  }

  setAdvisorReopenVisible(!!localStorage.getItem(CAL_DONE_KEY));

  if (localStorage.getItem(CAL_DONE_KEY)) {
    startAdvisor();
  }

})();
