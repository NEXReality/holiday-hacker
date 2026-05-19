/* Trips: confirmed trips from Plan + leaves saved logic */
(function () {
  'use strict';

  var CONFIRMED_TRIPS_KEY = 'holidayHacker_confirmedTrips';
  var ADVISOR_DATA_KEY    = 'holidayHacker_advisorData';
  var SELECTED_BRIDGES_KEY = 'holidayHacker_selectedBridges';
  var PLANNED_TRIPS_KEY   = 'holidayHacker_plannedTrips';
  var FAVORITES_KEY       = 'holidayHacker_favorites';
  var TRIP_SETTINGS_KEY   = 'holidayHacker_tripSettings';
  var ALARM_PERMS_KEY     = 'holidayHacker_alarmPermsAsked';
  var HOMETOWN_IMAGE_URL  = 'https://img.freepik.com/free-vector/suburban-house-illustration_33099-2357.jpg';
  var DEST_PLACEHOLDER_IMAGE_URL = 'https://img.magnific.com/premium-vector/summer-time-car-beach-with-few-suitcase-vacation-travel-huge-pile-things-holiday-flat-cartoon-style-illustration-landscape-concept-isolated_185796-16.jpg';
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* kind: 'booking' modes (train/bus/flight) get a booking-opens alarm plus a 9 PM
     heads-up notification the previous night. 'pretrip' modes (car) get a single
     reminder a few days before travel — no "booking opens" semantics apply. */
  var BOOKING_CONFIG = {
    train:  { days: 60, time: '08:00', label: 'Book Train',     kind: 'booking' },
    bus:    { days: 30, time: '08:00', label: 'Book Bus',       kind: 'booking' },
    flight: { days: 45, time: '10:00', label: 'Book Flight',    kind: 'booking' },
    car:    { days:  3, time: '09:00', label: 'Road trip prep', kind: 'pretrip' }
  };

  function tripCardImageUrl(d) {
    d = d || {};
    var u = String(d.imageUrl || '').trim();
    if ((d.isHometown || d.slug === '__hometown__') && !u) return HOMETOWN_IMAGE_URL;
    return u || DEST_PLACEHOLDER_IMAGE_URL;
  }

  function toISODateLocal(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  /** Last Mon–Fri on or before (windowStart − 1 calendar day). */
  function defaultTravelDepartureDate(windowStart) {
    var d = new Date(windowStart + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    return toISODateLocal(d);
  }
  function travelDateBounds(windowStart, windowEnd) {
    var min = defaultTravelDepartureDate(windowStart);
    var max = windowEnd || windowStart;
    if (max < min) max = min;
    return { min: min, max: max };
  }
  /** Saved travel day from trip settings, or default last working day before the holiday window. */
  function getEffectiveTravelDepartureDate(windowStart, windowEnd, settingsEntry) {
    var saved = settingsEntry && settingsEntry.travelDepartureDate;
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
    var bounds = travelDateBounds(windowStart, windowEnd);
    return bounds.min;
  }

  /* Native loud-alarm bridge (Capacitor / Android only). On the web build all
     of these become no-ops, so the same code runs unchanged in the browser. */
  function holidayAlarmPlugin() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayAlarm) {
      return window.Capacitor.Plugins.HolidayAlarm;
    }
    return null;
  }
  function armNativeAlarm(id, whenMs, title, body, context) {
    var p = holidayAlarmPlugin();
    if (!p) return;
    if (!whenMs || whenMs <= Date.now()) return;
    var payload = {
      id: String(id),
      timestamp: whenMs,
      title: title || 'Holiday Hacker',
      body: body || ''
    };
    if (context) {
      if (context.destName)    payload.destName    = String(context.destName);
      if (context.destState)   payload.destState   = String(context.destState);
      if (context.windowName)  payload.windowName  = String(context.windowName);
      if (context.windowStart) payload.windowStart = String(context.windowStart);
      if (context.windowEnd)   payload.windowEnd   = String(context.windowEnd);
      if (context.windowDays)  payload.windowDays  = Number(context.windowDays) || 0;
      if (context.mode)        payload.mode        = String(context.mode);
      if (context.imageUrl)    payload.imageUrl    = String(context.imageUrl);
    }
    p.schedule(payload).catch(function () {});
  }
  function buildAlarmContext(trip, mode) {
    if (!trip) return null;
    var dest = trip.destination || {};
    return {
      destName:    dest.name || '',
      destState:   dest.state || '',
      windowName:  trip.windowName || '',
      windowStart: trip.windowStart || '',
      windowEnd:   trip.windowEnd || trip.windowStart || '',
      windowDays:  trip.windowDays || 0,
      mode:        mode || '',
      imageUrl:    tripCardImageUrl(dest)
    };
  }
  function clearNativeAlarm(id) {
    var p = holidayAlarmPlugin();
    if (!p) return;
    p.cancel({ id: String(id) }).catch(function () {});
  }
  function requestAlarmPermissionsOnce() {
    var p = holidayAlarmPlugin();
    if (!p) return;
    if (localStorage.getItem(ALARM_PERMS_KEY) === '1') return;
    localStorage.setItem(ALARM_PERMS_KEY, '1');
    try { p.requestPermissions(); } catch (_) {}
    setTimeout(function () {
      try {
        var ua = (navigator.userAgent || '').toLowerCase();
        if (!/xiaomi|redmi|poco|oppo|realme|vivo|iqoo|huawei|honor/.test(ua)) return;
        var msg = 'On your phone, the system may stop trip alarms when Holiday Hacker is in deep sleep. Allow it to run unrestricted in the background so alarms ring on time. Open battery settings now?';
        if (window.confirm(msg)) {
          try { p.openBatterySettings(); } catch (_) {}
        }
      } catch (_) {}
    }, 2500);
  }
  function buildAlarmTimestamp(anchorDateStr, daysBefore, time) {
    var d = new Date(anchorDateStr + 'T00:00:00');
    d.setDate(d.getDate() - (daysBefore || 0));
    var parts = (time || '10:00').split(':');
    var h = parseInt(parts[0], 10); if (isNaN(h)) h = 10;
    var m = parseInt(parts[1], 10); if (isNaN(m)) m = 0;
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  function leaveAlarmId(windowStart) { return 'leave-' + windowStart; }
  function bookAlarmId(windowStart) { return 'book-' + windowStart; }
  function bookPreAlarmId(windowStart) { return 'book-pre-' + windowStart; }
  function destNameOf(trip) {
    return (trip && trip.destination && trip.destination.name) || 'your trip';
  }
  function armLeaveAlarm(trip, settings) {
    if (!trip || !trip.windowStart) return;
    if ((trip.leaves || 0) <= 0) return;
    var ts = (settings && settings[trip.windowStart]) || {};
    var when = buildAlarmTimestamp(trip.windowStart, ts.reminderDays || 30, ts.reminderTime || '10:00');
    var name = destNameOf(trip);
    armNativeAlarm(
      leaveAlarmId(trip.windowStart),
      when,
      'Apply leave for ' + name + ' trip',
      'Submit your leave application for the upcoming ' + name + ' trip.',
      buildAlarmContext(trip, ts.mode)
    );
  }
  function bookingOpenTimestamp(travelIso, cfg, bookingTime) {
    return buildAlarmTimestamp(travelIso, cfg.days, bookingTime);
  }
  /* Returns the timestamp of 9:00 PM on the day before the given timestamp.
     Used so the heads-up notification lands the evening before the loud alarm. */
  function nightBeforeAt9pm(timestamp) {
    var d = new Date(timestamp);
    d.setDate(d.getDate() - 1);
    d.setHours(21, 0, 0, 0);
    return d.getTime();
  }
  function armBookingAlarm(trip, settings) {
    if (!trip || !trip.windowStart) return;
    var ts = (settings && settings[trip.windowStart]) || {};
    var mode = ts.mode;
    if (!mode || !BOOKING_CONFIG[mode]) {
      var fallbackModes = getTravelModes();
      mode = (fallbackModes && fallbackModes[0]) || 'car';
      if (!BOOKING_CONFIG[mode]) return;
      ts.mode = mode;
      if (settings && settings[trip.windowStart]) settings[trip.windowStart].mode = mode;
    }
    if (!mode || !BOOKING_CONFIG[mode]) return;
    var cfg = BOOKING_CONFIG[mode];
    var isPretrip = cfg.kind === 'pretrip';
    var bookingTime = getEffectiveBookingTime(mode, ts);
    var travelIso = getEffectiveTravelDepartureDate(trip.windowStart, trip.windowEnd, ts);
    var directWhen = buildAlarmTimestamp(travelIso, 0, bookingTime);
    var testWindowMs = 2 * 24 * 60 * 60 * 1000;
    var useDirectTest = directWhen > Date.now() && (directWhen - Date.now()) <= testWindowMs;
    var openAt = bookingOpenTimestamp(travelIso, cfg, bookingTime);
    var isDefaultTime = isDefaultBookingTime(mode, bookingTime);
    var name = destNameOf(trip);
    var travelLbl = reminderDateLabel(travelIso, 0);
    var alarmCtx = buildAlarmContext(trip, mode);

    /* Car / pretrip flow: a single loud reminder, no booking-window logic and no
       9 PM heads-up. Fires `cfg.days` before travel at the user's chosen time, or
       at the test offset when travel is imminent. */
    if (isPretrip) {
      clearNativeAlarm(bookPreAlarmId(trip.windowStart));
      var pretripAt = useDirectTest ? directWhen : openAt;
      if (!pretripAt || pretripAt <= Date.now()) {
        clearNativeAlarm(bookAlarmId(trip.windowStart));
        return;
      }
      armNativeAlarm(
        bookAlarmId(trip.windowStart),
        pretripAt,
        cfg.label + ' for ' + name,
        cfg.days + '-day countdown to ' + travelLbl + ' — check fuel, route and vehicle.',
        alarmCtx
      );
      return;
    }

    /* Booking flow (train / bus / flight). */
    var alarmAt = useDirectTest
      ? directWhen
      : (isDefaultTime ? (openAt - (10 * 60 * 1000)) : openAt);
    /* If default-time 10-min alarm already passed but booking is still ahead,
       fall back to booking-open time so users still get a loud alarm. */
    if (!useDirectTest && isDefaultTime && alarmAt <= Date.now() && openAt > Date.now()) {
      alarmAt = openAt;
    }
    /* Heads-up notification at 9 PM the previous evening so the user is primed
       for the loud morning alarm. Falls back to (openAt − 24h) if 9 PM is in
       the past, so we never schedule a no-op alarm. */
    var nightBefore = nightBeforeAt9pm(openAt);
    var preAt = nightBefore > Date.now() ? nightBefore : (openAt - (24 * 60 * 60 * 1000));
    if (!useDirectTest && isBookingWindowAlreadyOpen(travelIso, cfg)) {
      clearNativeAlarm(bookAlarmId(trip.windowStart));
      clearNativeAlarm(bookPreAlarmId(trip.windowStart));
      return;
    }
    armNativeAlarm(
      bookAlarmId(trip.windowStart),
      alarmAt,
      cfg.label + ' for ' + name,
      (isDefaultTime
        ? ('IRCTC booking starts in 10 min at ' + formatTime12(bookingTime) + ' for travel on ' + travelLbl + '.')
        : ('Booking starts now at ' + formatTime12(bookingTime) + ' for travel on ' + travelLbl + '.')),
      alarmCtx
    );
    armNativeAlarm(
      bookPreAlarmId(trip.windowStart),
      preAt,
      cfg.label + ' tomorrow morning · ' + name,
      'Heads-up: booking opens tomorrow at ' + formatTime12(bookingTime) + ' for travel on ' + travelLbl + '. Get ready for the alarm in the morning.',
      alarmCtx
    );
  }
  function clearTripAlarms(windowStart) {
    if (!windowStart) return;
    clearNativeAlarm(leaveAlarmId(windowStart));
    clearNativeAlarm(bookAlarmId(windowStart));
    clearNativeAlarm(bookPreAlarmId(windowStart));
  }

  /* ───────── Holiday planning notification (65 days out) ───────── */

  /* Fires once for each upcoming Free Holiday / Golden Bridge / Mega Bridge so
     users have time to book before transport inventories open. The advisor data
     itself filters out plain working-day holidays that don't bridge into a
     long break, so anything in gifts/bridges/megas is by definition planable. */
  var HOLIDAY_PLAN_DAYS = 65;
  var HOLIDAY_PLAN_TIME = '10:00';

  function holidayPlanAlarmId(type, start) {
    return 'holiday-' + type + '-' + start;
  }
  function holidayTypeLabel(type) {
    if (type === 'gift') return 'Free Holiday';
    if (type === 'mega') return 'Mega Bridge';
    return 'Golden Bridge';
  }
  function buildHolidayBodyText(item, type) {
    var range = (item && item.end && item.end !== item.start)
      ? (reminderDateLabel(item.start, 0) + ' – ' + reminderDateLabel(item.end, 0))
      : reminderDateLabel(item.start, 0);
    var days = Math.max(1, item && item.days ? item.days : 1);
    var leaves = (item && item.leaves) || 0;
    var bits = [range + ' · ' + days + (days === 1 ? ' day' : ' days')];
    if (type === 'gift') {
      bits.push('no leaves needed');
    } else {
      bits.push(leaves > 0 ? (leaves + (leaves === 1 ? ' leave' : ' leaves')) : 'no leaves needed');
    }
    bits.push('Plan ahead — bookings open soon.');
    return bits.join(' · ');
  }
  function holidayItemHasPlanPotential(item, type) {
    if (!item || !item.start) return false;
    var days = item.days || 0;
    if (type === 'gift') {
      /* A gift weekend with only 1 working day off and 0 leaves is essentially
         a regular weekend — skip the heads-up. */
      return days >= 3;
    }
    /* Bridges and megas are by construction multi-day plannable breaks. */
    return days >= 3;
  }
  function syncHolidayPlanningNotifications() {
    var data;
    try { data = JSON.parse(localStorage.getItem(ADVISOR_DATA_KEY) || '{}'); } catch (e) { return; }
    if (!data || typeof data !== 'object') return;

    var entries = [];
    (data.gifts   || []).forEach(function (g) { entries.push({ type: 'gift',   item: g }); });
    (data.bridges || []).forEach(function (b) { entries.push({ type: 'bridge', item: b }); });
    (data.megas   || []).forEach(function (m) { entries.push({ type: 'mega',   item: m }); });

    var validIds = {};
    entries.forEach(function (entry) {
      var item = entry.item;
      var type = entry.type;
      if (!item || !item.start) return;
      if (!holidayItemHasPlanPotential(item, type)) return;

      var id = holidayPlanAlarmId(type, item.start);
      if (validIds[id]) return;
      validIds[id] = true;

      var whenMs = buildAlarmTimestamp(item.start, HOLIDAY_PLAN_DAYS, HOLIDAY_PLAN_TIME);
      if (whenMs <= Date.now()) {
        clearNativeAlarm(id);
        return;
      }
      var name = (item.name || holidayTypeLabel(type));
      armNativeAlarm(
        id,
        whenMs,
        holidayTypeLabel(type) + ' in 65 days · ' + name,
        buildHolidayBodyText(item, type),
        {
          windowName:  name,
          windowStart: item.start,
          windowEnd:   item.end || item.start,
          windowDays:  item.days || 0
        }
      );
    });

    /* Reconcile against the native scheduler: any holiday-* alarm that is no
       longer in the freshly-computed advisor set has had its underlying
       window removed (calendar shifted, holiday data updated, user unticked
       a bridge, etc.) — cancel it so it can never fire for a deleted window. */
    var p = holidayAlarmPlugin();
    if (p && typeof p.listScheduled === 'function') {
      try {
        p.listScheduled().then(function (res) {
          var alarms = (res && res.alarms) || [];
          alarms.forEach(function (a) {
            if (!a || typeof a.id !== 'string') return;
            if (a.id.indexOf('holiday-') !== 0) return;
            if (!validIds[a.id]) clearNativeAlarm(a.id);
          });
        }).catch(function () {});
      } catch (_) {}
    }
  }

  function getTripSettings() {
    try { return JSON.parse(localStorage.getItem(TRIP_SETTINGS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveTripSettings(settings) {
    localStorage.setItem(TRIP_SETTINGS_KEY, JSON.stringify(settings));
  }
  function pruneTripSettings(activeTrips) {
    var settings = getTripSettings();
    var valid = {};
    (activeTrips || []).forEach(function (t) {
      if (t && t.windowStart) valid[t.windowStart] = true;
    });
    var dirty = false;
    Object.keys(settings).forEach(function (k) {
      if (!valid[k]) { delete settings[k]; dirty = true; }
    });
    if (dirty) saveTripSettings(settings);
  }
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveFavorites(favs) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  }
  function isFavorite(windowStart) {
    return getFavorites().some(function (f) { return f.windowStart === windowStart; });
  }

  function getConfirmedTrips() {
    try {
      return JSON.parse(localStorage.getItem(CONFIRMED_TRIPS_KEY) || '[]');
    } catch (e) { return []; }
  }

  function getActiveWindowStarts() {
    var data, selected, planned;
    try { data = JSON.parse(localStorage.getItem(ADVISOR_DATA_KEY) || '{}'); } catch (e) { data = {}; }
    try { selected = JSON.parse(localStorage.getItem(SELECTED_BRIDGES_KEY) || '[]'); } catch (e) { selected = []; }
    try { planned = JSON.parse(localStorage.getItem(PLANNED_TRIPS_KEY) || '[]'); } catch (e) { planned = []; }

    var active = {};
    (data.gifts || []).forEach(function (g) {
      if (planned.indexOf(g.start) !== -1) active[g.start] = true;
    });
    (data.bridges || []).forEach(function (b) {
      if (selected.indexOf(b.start) !== -1) active[b.start] = true;
    });
    (data.megas || []).forEach(function (m) {
      if (selected.indexOf(m.start) !== -1) active[m.start] = true;
    });
    return active;
  }

  function syncConfirmedTrips() {
    /* Confirmed trips are user-owned personal data — they snapshot their own
       windowStart / windowEnd / windowDays / windowName / windowType at the
       moment the user taps "Confirm trip" on the Plan page. They are NEVER
       auto-deleted by the advisor, by app data updates, or by the user
       deselecting a bridge in Calendar. The only way a confirmed trip goes
       away is the explicit Remove button on the Trips page (which also
       cancels its alarms). This function is kept as a no-op for backward
       compatibility with old call sites. */
    return getConfirmedTrips();
  }

  function formatRange(start, end) {
    var s = new Date(start + 'T00:00:00');
    var e = new Date(end + 'T00:00:00');
    return MONTHS[s.getMonth()] + ' ' + s.getDate() + ' - ' + MONTHS[e.getMonth()] + ' ' + e.getDate();
  }

  function countWeekdays(startStr, endStr) {
    var start = new Date(startStr + 'T00:00:00');
    var end = new Date(endStr + 'T00:00:00');
    var count = 0;
    var d = new Date(start);
    while (d <= end) {
      var day = d.getDay();
      if (day >= 1 && day <= 5) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  function computeLeavesSaved(trip) {
    var weekdays = countWeekdays(trip.windowStart, trip.windowEnd);
    var leavesUsed = trip.leaves || 0;
    return Math.max(0, weekdays - leavesUsed);
  }

  function getTravelModes() {
    try {
      var p = JSON.parse(localStorage.getItem('holidayHacker_travelPreferences') || '{}');
      var modes = p.travelModes || (p.travelMode ? [p.travelMode] : null) || ['car'];
      return Array.isArray(modes) && modes.length ? modes : ['car'];
    } catch (e) { return ['car']; }
  }

  var MODE_ICONS = { flight: 'flight', train: 'train', bus: 'directions_bus', car: 'directions_car' };

  /* Format helpers used by reminder/booking labels so users see actual dates,
     not just relative offsets like "30 days before". */
  function formatTime12(time) {
    var p = (time || '10:00').split(':');
    var h = parseInt(p[0], 10); if (isNaN(h)) h = 10;
    var mm = (p[1] || '00').slice(0, 2);
    var ampm = h < 12 ? 'AM' : 'PM';
    var h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
    return h12 + ':' + mm + ' ' + ampm;
  }
  function reminderDateLabel(windowStart, daysBefore) {
    if (!windowStart) return '';
    var d = new Date(windowStart + 'T00:00:00');
    d.setDate(d.getDate() - (daysBefore || 0));
    var label = MONTHS[d.getMonth()] + ' ' + d.getDate();
    if (d.getFullYear() !== new Date().getFullYear()) {
      label += ', ' + d.getFullYear();
    }
    return label;
  }
  function leaveReminderSubText(windowStart, days, time) {
    var dateLabel = reminderDateLabel(windowStart, days);
    var timeLabel = formatTime12(time);
    return dateLabel
      ? days + ' days before • ' + dateLabel + ' at ' + timeLabel
      : days + ' days before • ' + timeLabel;
  }
  function getEffectiveBookingTime(mode, settingsEntry) {
    var cfg = BOOKING_CONFIG[mode] || {};
    var saved = settingsEntry && settingsEntry.bookingReminderTime;
    if (saved && /^\d{2}:\d{2}$/.test(saved)) return saved;
    return cfg.time || '08:00';
  }
  function isDefaultBookingTime(mode, bookingTime) {
    var cfg = BOOKING_CONFIG[mode];
    if (!cfg) return false;
    return (bookingTime || '') === cfg.time;
  }
  function bookingTravelSuffix(travelAnchorIso) {
    if (!travelAnchorIso) return '';
    return ' · for travel on ' + reminderDateLabel(travelAnchorIso, 0);
  }
  function isBookingWindowAlreadyOpen(travelAnchorIso, cfg) {
    if (!travelAnchorIso || !cfg) return false;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var openDay = new Date(travelAnchorIso + 'T00:00:00');
    openDay.setHours(0, 0, 0, 0);
    openDay.setDate(openDay.getDate() - (cfg.days || 0));
    return today >= openDay;
  }
  function bookingModeContent(mode, travelAnchorIso, bookingTime) {
    var icons = MODE_ICONS;
    var cfg = BOOKING_CONFIG[mode];
    var suff = bookingTravelSuffix(travelAnchorIso);
    var effectiveTime = bookingTime || (cfg && cfg.time) || '08:00';
    if (mode === 'train' && cfg) {
      if (isBookingWindowAlreadyOpen(travelAnchorIso, cfg)) {
        return { icon: icons.train, text: 'Booking already open — check availability' + suff };
      }
      return {
        icon: icons.train,
        text: 'Booking opens ' + reminderDateLabel(travelAnchorIso, cfg.days) + ' at ' + formatTime12(effectiveTime) + (isDefaultBookingTime(mode, effectiveTime) ? ' (alarm 10 min before)' : '') + suff
      };
    }
    if ((mode === 'bus' || mode === 'flight') && cfg) {
      if (isBookingWindowAlreadyOpen(travelAnchorIso, cfg)) {
        return { icon: icons[mode], text: 'Booking already open — check availability' + suff };
      }
      return {
        icon: icons[mode],
        text: 'Ideal booking ' + reminderDateLabel(travelAnchorIso, cfg.days) + ' at ' + formatTime12(effectiveTime) + (isDefaultBookingTime(mode, effectiveTime) ? ' (alarm 10 min before)' : '') + suff
      };
    }
    if (mode === 'car' && cfg) {
      return {
        icon: icons.car,
        text: 'Road trip prep ' + reminderDateLabel(travelAnchorIso, cfg.days) + ' at ' + formatTime12(effectiveTime) + suff
      };
    }
    if (mode === 'car') {
      return { icon: icons.car, text: 'Pre-departure checklist' + suff };
    }
    return { icon: icons[mode] || mode, text: 'Pre-departure checklist' + suff };
  }

  function populate() {
    var container = document.getElementById('tripsHacks');
    var trips = syncConfirmedTrips();
    pruneTripSettings(trips);
    var totalLeavesSaved = 0;
    trips.forEach(function (t) {
      totalLeavesSaved += computeLeavesSaved(t);
    });

    var statHero = document.querySelector('.passport-stat-hero h2');
    if (statHero) statHero.innerHTML = totalLeavesSaved + ' <span>Days</span>';

    var confirmedEl = document.querySelector('.passport-stat-card--confirmed h3');
    if (confirmedEl) confirmedEl.textContent = trips.length;

    var plannedCount = 0;
    try {
      trips.forEach(function (t) {
        var totalDays = t.windowDays || 0;
        var leavesUsed = t.leaves || 0;
        plannedCount += Math.max(0, totalDays - leavesUsed);
      });
    } catch (e) {}
    var holidaysEl = document.querySelector('.passport-stat-card--holidays h3');
    if (holidaysEl) holidaysEl.textContent = plannedCount;

    /* Dynamic benchmark text based on holiday utilization */
    var beatTextEl = document.querySelector('.passport-stat-hero-footer span:last-child');
    try {
      var advisorData = JSON.parse(localStorage.getItem(ADVISOR_DATA_KEY) || '{}');
      var possibleHolidayDays = 0;
      (advisorData.gifts || []).forEach(function (g) { possibleHolidayDays += (g.days || 0); });
      (advisorData.bridges || []).forEach(function (b) { possibleHolidayDays += (b.days || 0); });
      (advisorData.megas || []).forEach(function (m) { possibleHolidayDays += (m.days || 0); });
      var utilizationPct = possibleHolidayDays > 0 ? Math.round((plannedCount / possibleHolidayDays) * 100) : 0;
      utilizationPct = Math.max(0, Math.min(100, utilizationPct));
      if (beatTextEl) beatTextEl.textContent = "You're beating " + utilizationPct + '% of hackers!';
    } catch (err) {}

    try { syncHolidayPlanningNotifications(); } catch (e) {}

    /* Re-arm any alarms that were left in a pending state by an in-flight
       holiday-date edit on the Calendar page. Idempotent — schedule() will
       just overwrite the existing alarm with the same id. */
    try { drainPendingRearm(); } catch (_) {}

    var travelModes = getTravelModes();
    var allSettings = getTripSettings();
    var tripSettingsDirty = false;
    var html = '';
    trips.forEach(function (t, idx) {
      var d = t.destination || {};
      var isHometownTrip = d.slug === '__hometown__' || d.isHometown;
      var imgUrl = tripCardImageUrl(d);
      var imgCls = isHometownTrip ? ' trips-card-img--hometown' : '';
      var imgStyle = 'background-image: url(\'' + imgUrl.replace(/'/g, "\\'") + '\')';
      var label = formatRange(t.windowStart, t.windowEnd);
      var leavesUsed = t.leaves || 0;
      var needsLeaveReminder = leavesUsed > 0;
      var typeLabel = t.windowType === 'golden' ? 'Golden Bridge' : (t.windowType === 'mega' ? 'Mega-Bridge' : 'Free Holiday');
      var badge = (t.windowName || typeLabel);
      var badgeCls = t.windowType === 'free' ? 'trips-card-badge--free' : (t.windowType === 'golden' ? 'trips-card-badge--golden' : 'trips-card-badge--mega');
      var meta = t.windowDays + 'D/' + (t.windowDays - 1) + 'N • ' + leavesUsed + ' Leave' + (leavesUsed !== 1 ? 's' : '') + ' used';
      var destName = (d.name || '').replace(/</g, '&lt;');
      var ts = allSettings[t.windowStart] || {};
      if (ts.travelDepartureDate && !/^\d{4}-\d{2}-\d{2}$/.test(ts.travelDepartureDate)) {
        delete ts.travelDepartureDate;
        allSettings[t.windowStart] = ts;
        tripSettingsDirty = true;
      }
      var savedDays = ts.reminderDays || 30;
      var savedTime = ts.reminderTime || '10:00';
      var travelPick = getEffectiveTravelDepartureDate(t.windowStart, t.windowEnd, ts);
      var defaultModeForCard = (ts.mode || travelModes[0] || 'car');
      var bookingTime = getEffectiveBookingTime(defaultModeForCard, ts);
      var fav = isFavorite(t.windowStart);
      var favIcon = fav ? 'favorite' : 'favorite_border';
      var favCls = fav ? ' trips-card-action-btn--fav-active' : '';
      var leaveReminderHtml = needsLeaveReminder
        ? ('<div class="trips-card-leave-reminder">' +
            '<div class="trips-card-reminder-row">' +
              '<div class="trips-card-reminder-icon"><span class="material-symbols-outlined">event_note</span></div>' +
              '<div class="trips-card-reminder-display"><p class="trips-card-reminder-title">Leave Application</p><p class="trips-card-reminder-sub">' + leaveReminderSubText(t.windowStart, savedDays, savedTime) + '</p></div>' +
              '<button type="button" class="trips-card-reminder-edit" aria-label="Edit"><span class="material-symbols-outlined">edit</span></button>' +
              '<button type="button" class="trips-card-advisor-toggle is-on" aria-label="Toggle reminder"></button>' +
            '</div>' +
            '<div class="trips-card-edit-wrap" style="display:none">' +
              '<section class="edit-field"><label class="edit-field-label">Days before trip</label><input type="number" class="edit-field-input trips-edit-days" min="1" max="60" value="' + savedDays + '" placeholder="30"/></section>' +
              '<section class="edit-field"><label class="edit-field-label">Reminder time</label><input type="time" class="edit-field-input trips-edit-time" value="' + savedTime + '"/></section>' +
              '<button type="button" class="trips-card-edit-done">Done</button>' +
            '</div>' +
          '</div>')
        : '';
      html += '<div class="trips-card" data-idx="' + idx + '" data-window-start="' + t.windowStart + '">' +
        '<div class="trips-card-img-wrap">' +
          '<div class="trips-card-img' + imgCls + '" style="' + imgStyle + '"></div>' +
          '<div class="trips-card-overlay"></div>' +
          '<div class="trips-card-caption">' +
            '<span class="trips-card-badge ' + badgeCls + '">' + badge + '</span>' +
            '<h4 class="trips-card-title">' + destName + '</h4>' +
          '</div>' +
        '</div>' +
        '<div class="trips-card-body">' +
          '<div class="trips-card-meta">' +
            '<div class="trips-card-meta-left">' +
              '<span class="trips-card-date"><span class="material-symbols-outlined">date_range</span> ' + label + '</span>' +
              '<span class="trips-card-days">' + meta + '</span>' +
            '</div>' +
            '<label class="trips-card-reminders-toggle"><span class="trips-card-reminders-label">Reminders</span><span class="trips-card-switch"><input type="checkbox" class="trips-card-reminders-cb" checked/><span class="trips-card-switch-slider"></span></span></label>' +
          '</div>' +
          '<div class="trips-card-expand-row"><button type="button" class="trips-card-expand-btn" aria-label="Expand"><span class="material-symbols-outlined">expand_more</span></button></div>' +
          '<div class="trips-card-expanded">' +
            leaveReminderHtml +
            '<div class="trips-card-transport">' +
              '<p class="trips-card-transport-label">Transport Mode</p>' +
              '<div class="trips-card-transport-btns">' + (function () {
                var defaultMode = travelModes[0] || 'car';
                var icons = { flight: 'flight', train: 'train', bus: 'directions_bus', car: 'directions_car' };
                var btns = '';
                travelModes.forEach(function (m) {
                  var icon = icons[m] || MODE_ICONS[m] || m;
                  var active = m === defaultMode ? ' trips-card-transport-btn--active' : '';
                  btns += '<button type="button" class="trips-card-transport-btn' + active + '" data-mode="' + m + '"><span class="material-symbols-outlined">' + icon + '</span></button>';
                });
                return btns;
              })() + '</div>' +
              '<div class="trips-card-booking" data-mode="' + (travelModes[0] || 'car') + '">' +
                '<button type="button" class="trips-card-booking-text trips-card-booking-edit-trigger">' + bookingModeContent((travelModes[0] || 'car'), travelPick, bookingTime).text + '</button>' +
                '<button type="button" class="trips-card-reminder-edit trips-card-booking-date-edit" aria-label="Edit travel day"><span class="material-symbols-outlined">edit</span></button>' +
              '</div>' +
              '<div class="trips-card-booking-edit-wrap" style="display:none">' +
                '<section class="edit-field">' +
                  '<label class="edit-field-label" for="trips-travel-' + idx + '">Travel day</label>' +
                  '<input id="trips-travel-' + idx + '" type="date" class="edit-field-input trips-travel-date-input" value="' + travelPick + '" aria-label="Travel day"/>' +
                '</section>' +
                '<section class="edit-field">' +
                  '<label class="edit-field-label" for="trips-book-time-' + idx + '">Booking reminder time</label>' +
                  '<input id="trips-book-time-' + idx + '" type="time" class="edit-field-input trips-booking-time-input" value="' + bookingTime + '" aria-label="Booking reminder time"/>' +
                '</section>' +
                '<div class="trips-card-booking-edit-actions">' +
                  '<button type="button" class="trips-card-edit-done trips-card-booking-edit-done">Done</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="trips-card-actions">' +
              '<div class="trips-card-actions-grid">' +
                '<button type="button" class="trips-card-action-btn trips-card-view-details"><span class="material-symbols-outlined">info</span><span>View Details</span></button>' +
                '<button type="button" class="trips-card-action-btn trips-card-change-window"><span class="material-symbols-outlined">calendar_month</span><span>Change Window</span></button>' +
                '<button type="button" class="trips-card-action-btn trips-card-add-cal"><span class="material-symbols-outlined">calendar_add_on</span><span>Add to Calendar</span></button>' +
                '<button type="button" class="trips-card-action-btn trips-card-favorite' + favCls + '"><span class="material-symbols-outlined">' + favIcon + '</span><span>Favorite</span></button>' +
                '<button type="button" class="trips-card-action-btn trips-card-remove"><span class="material-symbols-outlined">delete_outline</span><span>Remove</span></button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    });

    if (tripSettingsDirty) saveTripSettings(allSettings);

    if (container) container.innerHTML = html;

    var emptyEl = document.querySelector('.passport-empty');
    if (emptyEl) emptyEl.style.display = trips.length ? 'none' : '';

    container.querySelectorAll('.trips-card').forEach(function (card) {
      var idx = parseInt(card.getAttribute('data-idx'), 10);
      var windowStart = card.getAttribute('data-window-start');
      var trip = trips[idx];
      var expandBtn = card.querySelector('.trips-card-expand-btn');
      var viewDetailsBtn = card.querySelector('.trips-card-view-details');
      var titleEl = card.querySelector('.trips-card-title');
      var imgWrap = card.querySelector('.trips-card-img-wrap');

      /* Expand/collapse */
      if (expandBtn) {
        expandBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          card.classList.toggle('trips-card--expanded');
          var icon = expandBtn.querySelector('.material-symbols-outlined');
          if (icon) icon.textContent = card.classList.contains('trips-card--expanded') ? 'expand_less' : 'expand_more';
        });
      }

      /* View details */
      function openDetail() {
        if (!isNaN(idx) && trips[idx]) openTripDetail(trips[idx]);
      }
      if (viewDetailsBtn) viewDetailsBtn.addEventListener('click', function (e) { e.stopPropagation(); openDetail(); });
      if (titleEl) titleEl.addEventListener('click', function (e) { e.stopPropagation(); openDetail(); });
      if (imgWrap) imgWrap.addEventListener('click', function (e) { e.stopPropagation(); openDetail(); });

      /* Transport mode */
      var transportBtns = card.querySelectorAll('.trips-card-transport-btn');
      var bookingEl = card.querySelector('.trips-card-booking');
      function refreshBookingLine() {
        if (!bookingEl || !trip) return;
        var tsNow = getTripSettings()[windowStart] || {};
        var anchor = getEffectiveTravelDepartureDate(trip.windowStart, trip.windowEnd, tsNow);
        var activeBtn = card.querySelector('.trips-card-transport-btn--active');
        var mode = activeBtn ? activeBtn.getAttribute('data-mode') : (travelModes[0] || 'car');
        var content = bookingModeContent(mode, anchor, getEffectiveBookingTime(mode, tsNow));
        var textEl = bookingEl.querySelector('.trips-card-booking-text');
        if (textEl) textEl.textContent = content.text;
      }
      function setTransportActive(btn, opts) {
        transportBtns.forEach(function (b) { b.classList.remove('trips-card-transport-btn--active'); });
        btn.classList.add('trips-card-transport-btn--active');
        var mode = btn.getAttribute('data-mode');
        var tsAnchor = getTripSettings()[windowStart] || {};
        var anchor = getEffectiveTravelDepartureDate(trip.windowStart, trip.windowEnd, tsAnchor);
        var content = bookingModeContent(mode, anchor, getEffectiveBookingTime(mode, tsAnchor));
        if (bookingEl) {
          var textEl = bookingEl.querySelector('.trips-card-booking-text');
          if (textEl) textEl.textContent = content.text;
        }
        if (bookingEl) bookingEl.setAttribute('data-mode', mode);

        if (!opts || !opts.skipPersist) {
          var allSettingsLocal = getTripSettings();
          var entry = allSettingsLocal[windowStart] || {};
          entry.mode = mode;
          allSettingsLocal[windowStart] = entry;
          saveTripSettings(allSettingsLocal);
          if (remindersCb && remindersCb.checked) {
            requestAlarmPermissionsOnce();
            armBookingAlarm(trip, allSettingsLocal);
          }
        }
      }
      transportBtns.forEach(function (btn) {
        btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); setTransportActive(btn); });
        btn.addEventListener('click', function (e) { e.stopPropagation(); setTransportActive(btn); });
      });

      var savedMode = (allSettings[windowStart] && allSettings[windowStart].mode) || null;
      if (savedMode) {
        var savedBtn = card.querySelector('.trips-card-transport-btn[data-mode="' + savedMode + '"]');
        if (savedBtn) setTransportActive(savedBtn, { skipPersist: true });
      }

      /* Actions grid is always visible when card is expanded (no toggle needed) */

      /* Reminder edit + save to localStorage */
      var editBtn = card.querySelector('.trips-card-reminder-edit');
      var editWrap = card.querySelector('.trips-card-edit-wrap');
      var reminderDisplay = card.querySelector('.trips-card-reminder-display');
      var editDays = card.querySelector('.trips-edit-days');
      var editTime = card.querySelector('.trips-edit-time');
      var editDone = card.querySelector('.trips-card-edit-done');
      if (editBtn && editWrap) {
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          editWrap.style.display = editWrap.style.display === 'none' ? 'block' : 'none';
        });
      }
      if (editDone && editWrap && reminderDisplay && editDays && editTime) {
        editDone.addEventListener('click', function (e) {
          e.stopPropagation();
          var sub = reminderDisplay.querySelector('.trips-card-reminder-sub');
          var tv = editTime.value || '10:00';
          var dv = parseInt(editDays.value, 10) || 30;
          if (sub) sub.textContent = leaveReminderSubText(windowStart, dv, tv);
          editWrap.style.display = 'none';
          var settings = getTripSettings();
          var prev = settings[windowStart] || {};
          settings[windowStart] = {
            reminderDays: dv,
            reminderTime: tv,
            mode: prev.mode,
            travelDepartureDate: prev.travelDepartureDate,
            bookingReminderTime: prev.bookingReminderTime
          };
          saveTripSettings(settings);
          if (remindersCb && remindersCb.checked) {
            requestAlarmPermissionsOnce();
            armLeaveAlarm(trip, settings);
            armBookingAlarm(trip, settings);
          }
        });
      }

      /* Reminders toggle */
      var remindersCb = card.querySelector('.trips-card-reminders-cb');
      var advisorToggle = card.querySelector('.trips-card-advisor-toggle');
      var transportSection = card.querySelector('.trips-card-transport');
      function syncRemindersState(isUserChange) {
        var on = remindersCb && remindersCb.checked;
        if (advisorToggle) advisorToggle.classList.toggle('is-on', on);
        if (transportSection) transportSection.classList.toggle('trips-card-transport--muted', !on);
        if (on) {
          if (isUserChange) requestAlarmPermissionsOnce();
          var s = getTripSettings();
          armLeaveAlarm(trip, s);
          armBookingAlarm(trip, s);
        } else {
          clearTripAlarms(windowStart);
        }
      }
      if (remindersCb) {
        remindersCb.addEventListener('change', function () { syncRemindersState(true); });
        syncRemindersState(false);
      }

      var bookingDateEditBtn = card.querySelector('.trips-card-booking-date-edit');
      var bookingTextEditBtn = card.querySelector('.trips-card-booking-edit-trigger');
      var bookingDateEditWrap = card.querySelector('.trips-card-booking-edit-wrap');
      var travelInput = bookingDateEditWrap ? bookingDateEditWrap.querySelector('.trips-travel-date-input') : null;
      var bookingTimeInput = bookingDateEditWrap ? bookingDateEditWrap.querySelector('.trips-booking-time-input') : null;
      var bookingSaveBtn = bookingDateEditWrap ? bookingDateEditWrap.querySelector('.trips-card-booking-edit-done') : null;
      function toggleBookingEditor(e) {
        if (e) e.stopPropagation();
        if (!bookingDateEditWrap) return;
        var isHidden = bookingDateEditWrap.style.display === 'none' || bookingDateEditWrap.style.display === '';
        bookingDateEditWrap.style.display = isHidden ? 'block' : 'none';
      }
      function saveBookingEditorValues() {
        if (!trip || !travelInput || !bookingTimeInput) return null;
        var v = travelInput.value;
        if (!v) return null;
        var bt = bookingTimeInput.value || '08:00';
        var allS = getTripSettings();
        var ent = allS[windowStart] || {};
        var activeBtn = card.querySelector('.trips-card-transport-btn--active');
        var activeMode = activeBtn ? activeBtn.getAttribute('data-mode') : ((ent.mode && BOOKING_CONFIG[ent.mode]) ? ent.mode : (travelModes[0] || 'car'));
        if (BOOKING_CONFIG[activeMode]) ent.mode = activeMode;
        ent.travelDepartureDate = v;
        ent.bookingReminderTime = bt;
        allS[windowStart] = ent;
        saveTripSettings(allS);
        refreshBookingLine();
        return allS;
      }
      if (bookingDateEditBtn && bookingDateEditWrap && travelInput && bookingTimeInput && trip) {
        bookingDateEditBtn.addEventListener('click', toggleBookingEditor);
        if (bookingTextEditBtn) bookingTextEditBtn.addEventListener('click', toggleBookingEditor);
        if (bookingSaveBtn) bookingSaveBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var updated = saveBookingEditorValues();
          if (!updated) return;
          bookingDateEditWrap.style.display = 'none';
          if (remindersCb && remindersCb.checked) {
            requestAlarmPermissionsOnce();
            armBookingAlarm(trip, updated);
          }
        });
      }

      card.querySelectorAll('.trips-card-advisor-toggle').forEach(function (tgl) {
        tgl.addEventListener('click', function (e) {
          e.stopPropagation();
          if (remindersCb && !remindersCb.checked) return;
          tgl.classList.toggle('is-on');
        });
      });

      /* Favorite */
      var favBtn = card.querySelector('.trips-card-favorite');
      if (favBtn && trip) {
        favBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var favs = getFavorites();
          var existIdx = favs.findIndex(function (f) { return f.windowStart === windowStart; });
          if (existIdx >= 0) {
            favs.splice(existIdx, 1);
            favBtn.classList.remove('trips-card-action-btn--fav-active');
            favBtn.querySelector('.material-symbols-outlined').textContent = 'favorite_border';
          } else {
            favs.push({
              windowStart: trip.windowStart,
              windowEnd: trip.windowEnd,
              windowName: trip.windowName,
              windowType: trip.windowType,
              windowDays: trip.windowDays,
              leaves: trip.leaves,
              destination: trip.destination
            });
            favBtn.classList.add('trips-card-action-btn--fav-active');
            favBtn.querySelector('.material-symbols-outlined').textContent = 'favorite';
          }
          saveFavorites(favs);
        });
      }

      /* Change Window */
      var changeWindowBtn = card.querySelector('.trips-card-change-window');
      if (changeWindowBtn && trip) {
        changeWindowBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openChangeWindowPopup(trip, idx);
        });
      }

      /* Add to Calendar */
      var addCalBtn = card.querySelector('.trips-card-add-cal');
      if (addCalBtn && trip) {
        addCalBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openCalendarSheet(trip, card);
        });
      }

      /* Remove */
      var removeBtn = card.querySelector('.trips-card-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!confirm('Remove this trip? The holiday window will remain available for a new destination.')) return;
          clearTripAlarms(windowStart);
          var settings = getTripSettings();
          if (settings[windowStart]) {
            delete settings[windowStart];
            saveTripSettings(settings);
          }
          var allTrips = getConfirmedTrips();
          allTrips = allTrips.filter(function (t) { return t.windowStart !== windowStart; });
          localStorage.setItem(CONFIRMED_TRIPS_KEY, JSON.stringify(allTrips));
          populate();
        });
      }
    });
  }

  /* ─── Add to Calendar sheet ───────────────────────────── */

  function dateMinus(isoDate, days) {
    var d = new Date(isoDate + 'T00:00:00');
    d.setDate(d.getDate() - days);
    return d;
  }

  function fmtDateShort(d) {
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function toICSDate(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return String(y) + (m < 10 ? '0' : '') + m + (day < 10 ? '0' : '') + day;
  }

  function toICSDateTime(d, time) {
    var p = (time || '10:00').split(':');
    var h = (parseInt(p[0], 10) || 10);
    var m = (parseInt(p[1], 10) || 0);
    return toICSDate(d) + 'T' + (h < 10 ? '0' : '') + h + (m < 10 ? '0' : '') + m + '00';
  }

  function toGCalDate(d) {
    return toICSDate(d);
  }

  function toGCalDateTime(d, time) {
    return toICSDateTime(d, time);
  }

  function buildCalendarEvents(trip, card) {
    var dName = (trip.destination && trip.destination.name) || 'Trip';
    var winName = trip.windowName || 'Holiday';
    var rangeLabel = fmtDateShort(new Date(trip.windowStart + 'T00:00:00')) + '-' +
                     fmtDateShort(new Date(trip.windowEnd + 'T00:00:00'));
    var events = [];

    var endDate = new Date(trip.windowEnd + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 1);
    events.push({
      id: 'trip',
      label: 'Trip: ' + dName + ' (' + rangeLabel + ')',
      summary: dName + ' - ' + winName,
      description: trip.windowDays + ' day trip to ' + dName,
      allDay: true,
      startDate: trip.windowStart,
      endDateExcl: endDate.toISOString().slice(0, 10)
    });

    var settings = getTripSettings();
    var ts = settings[trip.windowStart] || {};
    var travelAnchorIso = getEffectiveTravelDepartureDate(trip.windowStart, trip.windowEnd, ts);
    var reminderDays = ts.reminderDays || 30;
    var reminderTime = ts.reminderTime || '10:00';
    var remCb = card ? card.querySelector('.trips-card-reminders-cb') : null;
    var remOn = remCb ? remCb.checked : true;

    var tripLeaves = trip.leaves || 0;
    if (remOn && tripLeaves > 0) {
      var leaveDate = dateMinus(trip.windowStart, reminderDays);
      var p = reminderTime.split(':');
      var h = parseInt(p[0], 10) || 10;
      var mm = (p[1] || '00').slice(0, 2);
      var ampm = h < 12 ? 'AM' : 'PM';
      var h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
      var timeLabel = h12 + ':' + mm + ' ' + ampm;
      events.push({
        id: 'leave',
        label: 'Apply Leave - ' + fmtDateShort(leaveDate) + ' at ' + timeLabel,
        summary: 'Apply Leave: ' + dName + ' trip (' + rangeLabel + ')',
        description: 'Submit leave application for your ' + dName + ' trip on ' + rangeLabel,
        allDay: false,
        dateObj: leaveDate,
        time: reminderTime
      });
    }

    var activeBtn = card ? card.querySelector('.trips-card-transport-btn--active') : null;
    var mode = activeBtn ? activeBtn.getAttribute('data-mode') : null;
    var bookingConfig = { train: { days: 60, time: '08:00', label: 'Book Train' },
                          bus:   { days: 30, time: '08:00', label: 'Book Bus' },
                          flight:{ days: 45, time: '10:00', label: 'Book Flight' } };
    var bc = mode ? bookingConfig[mode] : null;
    if (bc && remOn && !isBookingWindowAlreadyOpen(travelAnchorIso, bc)) {
      var bookingEventTime = getEffectiveBookingTime(mode, ts);
      var bookDate = dateMinus(travelAnchorIso, bc.days);
      var bp = bookingEventTime.split(':');
      var bh = parseInt(bp[0], 10);
      var bmm = bp[1] || '00';
      var bampm = bh < 12 ? 'AM' : 'PM';
      var bh12 = bh === 0 ? 12 : (bh > 12 ? bh - 12 : bh);
      var bTimeLabel = bh12 + ':' + bmm + ' ' + bampm;
      var travelShort = fmtDateShort(new Date(travelAnchorIso + 'T00:00:00'));
      events.push({
        id: 'booking',
        label: bc.label + ' - ' + fmtDateShort(bookDate) + ' at ' + bTimeLabel,
        summary: bc.label + ': ' + dName + ' trip (' + rangeLabel + ')',
        description: bc.label + ' for travel on ' + travelShort + ' — ' + dName + ' (' + rangeLabel + ')',
        allDay: false,
        dateObj: bookDate,
        time: bookingEventTime
      });
    }
    return events;
  }

  function buildGoogleCalURL(evt) {
    var base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    var text = '&text=' + encodeURIComponent(evt.summary);
    var dates;
    if (evt.allDay) {
      dates = '&dates=' + toGCalDate(new Date(evt.startDate + 'T00:00:00')) + '/' +
              toGCalDate(new Date(evt.endDateExcl + 'T00:00:00'));
    } else {
      var startDT = toGCalDateTime(evt.dateObj, evt.time);
      var endObj = new Date(evt.dateObj);
      endObj.setMinutes(endObj.getMinutes() + 30);
      var endDT = toGCalDateTime(endObj, evt.time.split(':')[0] + ':30');
      dates = '&dates=' + startDT + '/' + endDT;
    }
    var details = '&details=' + encodeURIComponent(evt.description || '');
    return base + text + dates + details;
  }

  function buildICSContent(events) {
    var ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//HolidayHacker//EN\r\n';
    events.forEach(function (evt) {
      ics += 'BEGIN:VEVENT\r\n';
      if (evt.allDay) {
        ics += 'DTSTART;VALUE=DATE:' + toICSDate(new Date(evt.startDate + 'T00:00:00')) + '\r\n';
        ics += 'DTEND;VALUE=DATE:' + toICSDate(new Date(evt.endDateExcl + 'T00:00:00')) + '\r\n';
      } else {
        ics += 'DTSTART:' + toICSDateTime(evt.dateObj, evt.time) + '\r\n';
        var endObj = new Date(evt.dateObj);
        endObj.setMinutes(endObj.getMinutes() + 30);
        ics += 'DTEND:' + toICSDateTime(endObj, evt.time.split(':')[0] + ':30') + '\r\n';
        ics += 'BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\n';
      }
      ics += 'SUMMARY:' + (evt.summary || '').replace(/[\r\n]/g, ' ') + '\r\n';
      ics += 'DESCRIPTION:' + (evt.description || '').replace(/[\r\n]/g, ' ') + '\r\n';
      ics += 'END:VEVENT\r\n';
    });
    ics += 'END:VCALENDAR';
    return ics;
  }

  function openCalendarSheet(trip, card) {
    var existing = document.getElementById('calSheetOverlay');
    if (existing) existing.remove();

    var events = buildCalendarEvents(trip, card);
    var defaultId = events.find(function (e) { return e.id === 'booking'; }) ?
      'booking' :
      ((events.find(function (e) { return e.id === 'leave'; }) ? 'leave' : 'trip'));
    var checkListHtml = '';
    events.forEach(function (evt) {
      var checkedAttr = evt.id === defaultId ? ' checked' : '';
      checkListHtml += '<label class="trips-cal-check">' +
        '<input type="radio" name="tripsCalOnePick" value="' + evt.id + '"' + checkedAttr + '/>' +
        '<span>' + evt.label + '</span></label>';
    });

    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/i.test(ua);
    var secondaryBtnHtml = isIOS
      ? '<button type="button" class="trips-cal-btn trips-cal-btn--apple"><img class="trips-cal-apple-icon" src="https://upload.wikimedia.org/wikipedia/commons/5/5e/Apple_Calendar_%28iOS%29.svg" alt="Apple Calendar"/><span>Apple Calendar</span></button>'
      : '<button type="button" class="trips-cal-btn trips-cal-btn--download"><span class="material-symbols-outlined">download</span><span>Download Calendar File</span></button>';

    var overlay = document.createElement('div');
    overlay.id = 'calSheetOverlay';
    overlay.className = 'trips-cal-overlay';
    overlay.innerHTML = '<div class="trips-cal-popup">' +
      '<div class="trips-cal-header"><h3>Add to Calendar</h3><button type="button" class="trips-cal-close" aria-label="Close"><span class="material-symbols-outlined">close</span></button></div>' +
      '<p class="trips-cal-note"><span class="material-symbols-outlined">info</span><span>Google Calendar adds one entry at a time. Choose one event below.</span></p>' +
      '<div class="trips-cal-list">' + checkListHtml + '</div>' +
      '<div class="trips-cal-buttons">' +
        '<button type="button" class="trips-cal-btn trips-cal-btn--google"><img class="trips-cal-google-icon" src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg" alt="Google Calendar"/><span>Google Calendar</span></button>' +
        secondaryBtnHtml +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.trips-cal-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    function getPickedEvent() {
      var picked = overlay.querySelector('.trips-cal-check input[type="radio"]:checked');
      if (!picked) return null;
      var id = picked.value;
      return events.find(function (ev) { return ev.id === id; }) || null;
    }

    function downloadIcsForEvents(selectedEvents) {
      if (!selectedEvents.length) { overlay.remove(); return; }
      var ics = buildICSContent(selectedEvents);
      var blob = new Blob([ics], { type: 'text/calendar' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var dName = ((trip.destination && trip.destination.name) || 'Trip').replace(/\s+/g, '_');
      a.download = dName + '_calendar_events.ics';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      overlay.remove();
    }

    overlay.querySelector('.trips-cal-btn--google').addEventListener('click', function () {
      var picked = getPickedEvent();
      if (!picked) { overlay.remove(); return; }
      var url = buildGoogleCalURL(picked);
      window.open(url, '_blank');
      overlay.remove();
    });

    var appleBtn = overlay.querySelector('.trips-cal-btn--apple');
    var downloadBtn = overlay.querySelector('.trips-cal-btn--download');
    if (appleBtn) {
      appleBtn.addEventListener('click', function () { downloadIcsForEvents(events); });
    }
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function () { downloadIcsForEvents(events); });
    }
  }

  /* ─── Change Window popup ────────────────────────────── */

  function getAllAvailableWindows() {
    var data;
    try { data = JSON.parse(localStorage.getItem(ADVISOR_DATA_KEY) || '{}'); } catch (e) { data = {}; }
    var todayISO = new Date().toISOString().slice(0, 10);
    var windows = [];
    (data.gifts || []).forEach(function (g) {
      if (g.end >= todayISO) windows.push({ type: 'free', name: g.name, start: g.start, end: g.end, days: g.days, leaves: 0 });
    });
    (data.bridges || []).forEach(function (b) {
      if (b.end >= todayISO) windows.push({ type: 'golden', name: b.name, start: b.start, end: b.end, days: b.days, leaves: b.leaves });
    });
    (data.megas || []).forEach(function (m) {
      if (m.end >= todayISO) {
        var n = m.days === 9 ? '9-Day Mega-Bridge' : (m.days + '-Day Long Bridge');
        windows.push({ type: 'mega', name: n, start: m.start, end: m.end, days: m.days, leaves: m.leaves });
      }
    });
    windows.sort(function (a, b) { return a.start.localeCompare(b.start); });
    return windows;
  }

  function openChangeWindowPopup(currentTrip, tripIdx) {
    var existing = document.getElementById('changeWindowOverlay');
    if (existing) existing.remove();

    var windows = getAllAvailableWindows();
    var confirmedTrips = getConfirmedTrips();
    var usedStarts = {};
    confirmedTrips.forEach(function (t) { usedStarts[t.windowStart] = true; });

    var listHtml = '';
    windows.forEach(function (w) {
      var isCurrent = w.start === currentTrip.windowStart;
      var isUsed = !isCurrent && usedStarts[w.start];
      var typeCls = w.type === 'free' ? 'trips-cw-item--free' : (w.type === 'golden' ? 'trips-cw-item--golden' : 'trips-cw-item--mega');
      var disabledCls = isUsed ? ' trips-cw-item--disabled' : '';
      var currentCls = isCurrent ? ' trips-cw-item--current' : '';
      var typeLabel = w.type === 'golden' ? 'Golden Bridge' : (w.type === 'mega' ? 'Mega-Bridge' : 'Free Holiday');
      listHtml += '<button type="button" class="trips-cw-item ' + typeCls + disabledCls + currentCls + '" data-start="' + w.start + '"' + (isUsed ? ' disabled' : '') + '>' +
        '<div class="trips-cw-item-name">' + (w.name || typeLabel).replace(/</g, '&lt;') + '</div>' +
        '<div class="trips-cw-item-meta">' + formatRange(w.start, w.end) + ' • ' + w.days + 'D' + (isCurrent ? ' • Current' : '') + (isUsed ? ' • In use' : '') + '</div>' +
      '</button>';
    });

    var overlay = document.createElement('div');
    overlay.id = 'changeWindowOverlay';
    overlay.className = 'trips-cw-overlay';
    overlay.innerHTML = '<div class="trips-cw-popup">' +
      '<div class="trips-cw-header"><h3>Change Window</h3><button type="button" class="trips-cw-close" aria-label="Close"><span class="material-symbols-outlined">close</span></button></div>' +
      '<div class="trips-cw-list">' + listHtml + '</div>' +
    '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.trips-cw-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.trips-cw-item:not([disabled])').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var newStart = btn.getAttribute('data-start');
        if (newStart === currentTrip.windowStart) { overlay.remove(); return; }
        var w = windows.find(function (x) { return x.start === newStart; });
        if (!w) return;

        /* Ensure the new window is toggled on in calendar selections */
        if (w.type === 'free') {
          try {
            var pl = JSON.parse(localStorage.getItem(PLANNED_TRIPS_KEY) || '[]');
            if (pl.indexOf(w.start) === -1) { pl.push(w.start); localStorage.setItem(PLANNED_TRIPS_KEY, JSON.stringify(pl)); }
          } catch (ex) {}
        } else {
          try {
            var sb = JSON.parse(localStorage.getItem(SELECTED_BRIDGES_KEY) || '[]');
            if (sb.indexOf(w.start) === -1) { sb.push(w.start); localStorage.setItem(SELECTED_BRIDGES_KEY, JSON.stringify(sb)); }
          } catch (ex) {}
        }

        var allTrips = getConfirmedTrips();
        var match = allTrips.find(function (t) { return t.windowStart === currentTrip.windowStart; });
        if (match) {
          var oldStart = match.windowStart;
          match.windowStart = w.start;
          match.windowEnd = w.end;
          match.windowDays = w.days;
          match.windowName = w.name;
          match.windowType = w.type;
          match.leaves = w.leaves || 0;
          localStorage.setItem(CONFIRMED_TRIPS_KEY, JSON.stringify(allTrips));
          try {
            var tripSettings = getTripSettings();
            if (tripSettings[oldStart]) {
              tripSettings[w.start] = tripSettings[oldStart];
              delete tripSettings[oldStart];
              saveTripSettings(tripSettings);
            }
          } catch (ex) {}
        }
        overlay.remove();
        populate();
      });
    });
  }

  function escapeHtml(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function applyInlineFormat(seg) {
    return seg
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>');
  }

  function formatWvText(s) {
    if (!s) return '';
    var escaped = escapeHtml(s).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    var lines = escaped.split('\n');
    var html = '';
    var i = 0;

    function flushList(listType, items) {
      if (items.length === 0) return;
      var tag = listType === 'ol' ? 'ol' : 'ul';
      html += '<' + tag + '>';
      items.forEach(function (it) { html += '<li>' + applyInlineFormat(it) + '</li>'; });
      html += '</' + tag + '>';
    }

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();
      if (trimmed === '') {
        i++;
        continue;
      }
      var olMatch = trimmed.match(/^\d+[\.\)]?\s+(.*)$/);
      var ulMatch = trimmed.match(/^[-*•·]\s+(.*)$/) || trimmed.match(/^\*\s+(.*)$/);
      if (olMatch) {
        var olItems = [];
        while (i < lines.length) {
          var t = lines[i].trim();
          var m = t.match(/^\d+[\.\)]?\s+(.*)$/);
          if (!m) break;
          olItems.push(m[1]);
          i++;
        }
        flushList('ol', olItems);
        continue;
      }
      if (ulMatch) {
        var ulItems = [];
        while (i < lines.length) {
          var ul = lines[i].trim().match(/^[-*•·]\s+(.*)$/) || lines[i].trim().match(/^\*\s+(.*)$/);
          if (!ul) break;
          ulItems.push(ul[1]);
          i++;
        }
        flushList('ul', ulItems);
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^\d+[\.\)]?\s+/.test(lines[i].trim()) && !/^[-*•·]\s+/.test(lines[i].trim()) && !/^\*\s+/.test(lines[i].trim())) {
        para.push(lines[i]);
        i++;
      }
      html += '<p>' + applyInlineFormat(para.join('\n').trim()) + '</p>';
    }
    return html || '<p>' + applyInlineFormat(escaped.trim()) + '</p>';
  }

  function openTripDetail(trip) {
    var overlay = document.getElementById('tripDetailOverlay');
    var titleEl = document.getElementById('tripDetailTitle');
    var imgEl = document.getElementById('tripDetailImg');
    var catEl = document.getElementById('tripDetailCategory');
    var descEl = document.getElementById('tripDetailDesc');
    var underEl = document.getElementById('tripDetailUnderstand');
    var seeEl = document.getElementById('tripDetailSee');
    var descPanel = document.getElementById('tripDetailDescPanel');
    var underPanel = document.getElementById('tripDetailUnderstandPanel');
    var seePanel = document.getElementById('tripDetailSeePanel');
    if (!overlay || !titleEl) return;
    var d = trip.destination || {};
    titleEl.textContent = (d.name || '') + ' · ' + formatRange(trip.windowStart, trip.windowEnd);
    if (imgEl) {
      imgEl.style.backgroundImage = 'none';
      imgEl.style.backgroundColor = 'var(--gray-200)';
      var detailImg = tripCardImageUrl(d);
      var sep = detailImg.indexOf('?') >= 0 ? '&' : '?';
      var bust = detailImg + sep + '_t=' + Date.now();
      imgEl.style.backgroundImage = 'url("' + bust.replace(/"/g, '%22') + '")';
      imgEl.style.backgroundColor = 'transparent';
    }
    if (catEl) {
      var catShow = '';
      if (d.isHometown || d.slug === '__hometown__') catShow = 'Hometown visit';
      else if (d.categories && d.categories.length) catShow = d.categories.join(' · ');
      else if (Array.isArray(d.category)) catShow = d.category.join(' · ');
      else catShow = d.category || '';
      catEl.textContent = catShow;
    }
    var descHtml = (d.isHometown || d.slug === '__hometown__')
      ? ('<p>Family time in your hometown.' +
          ((trip.leaves || 0) > 0
            ? ' Use reminders below for leave and travel.'
            : ' This window does not need leave days; use transport reminders if you are booking travel.') +
        '</p>')
      : formatWvText((d.description || '') || 'No description available.');
    var underHtml = formatWvText(d.understand_brief || '');
    var seeHtml = formatWvText(d.see_brief || '');
    if (descEl) descEl.innerHTML = descHtml;
    if (underEl) underEl.innerHTML = underHtml || 'No content.';
    if (seeEl) seeEl.innerHTML = seeHtml || 'No content.';
    var tabs = overlay.querySelectorAll('.trip-detail-tab');
    var panels = overlay.querySelectorAll('.trip-detail-panel');
    tabs.forEach(function (t) { t.classList.remove('trip-detail-tab--active'); });
    panels.forEach(function (p) { p.classList.remove('trip-detail-panel--active'); });
    if (tabs[0]) tabs[0].classList.add('trip-detail-tab--active');
    if (descPanel) descPanel.classList.add('trip-detail-panel--active');
    var underTab = overlay.querySelector('.trip-detail-tab[data-tab="understand"]');
    var seeTab = overlay.querySelector('.trip-detail-tab[data-tab="see"]');
    if (underTab) underTab.style.display = underHtml ? '' : 'none';
    if (seeTab) seeTab.style.display = seeHtml ? '' : 'none';
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function setActiveTab(tabName) {
    var overlay = document.getElementById('tripDetailOverlay');
    if (!overlay) return;
    overlay.querySelectorAll('.trip-detail-tab').forEach(function (t) {
      t.classList.toggle('trip-detail-tab--active', t.getAttribute('data-tab') === tabName);
    });
    overlay.querySelectorAll('.trip-detail-panel').forEach(function (p) {
      var id = p.id;
      var isDesc = id === 'tripDetailDescPanel' && tabName === 'desc';
      var isUnder = id === 'tripDetailUnderstandPanel' && tabName === 'understand';
      var isSee = id === 'tripDetailSeePanel' && tabName === 'see';
      p.classList.toggle('trip-detail-panel--active', isDesc || isUnder || isSee);
    });
  }

  function closeTripDetail() {
    var overlay = document.getElementById('tripDetailOverlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function wireTripDetailListeners() {
    var closeBtn = document.querySelector('.trip-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeTripDetail);
    var overlay = document.getElementById('tripDetailOverlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeTripDetail();
      });
      overlay.querySelectorAll('.trip-detail-tab').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tab = btn.getAttribute('data-tab');
          if (tab) setActiveTab(tab);
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireTripDetailListeners);
  } else {
    wireTripDetailListeners();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populate);
  } else {
    populate();
  }

  window.addEventListener('storage', function (e) {
    if (e.key === CONFIRMED_TRIPS_KEY) populate();
    if (e.key === ADVISOR_DATA_KEY) {
      try { syncHolidayPlanningNotifications(); } catch (_) {}
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') populate();
  });

  /* Expose the holiday-planning notifier and trip reconciler so the calendar
     advisor can refresh both in-place right after recomputing bridges. This
     keeps alarms cancelled as soon as a window is removed (unselected
     bridge, unfavorited gift, advisor recompute, etc.) instead of waiting
     for the next visit to the Trips page. */
  window.HolidayHacker = window.HolidayHacker || {};
  window.HolidayHacker.syncHolidayPlanningNotifications = syncHolidayPlanningNotifications;
  window.HolidayHacker.reconcileConfirmedTripsAndAlarms = function () {
    try { syncConfirmedTrips(); } catch (_) {}
  };

  /* ───────── Pending re-arm handoff from the Holidays-edit flow ─────────
   *
   * When the user edits a holiday date in /holidays/, holiday-shift.js
   * (loaded on both pages) updates the trip's windowStart/windowEnd in
   * localStorage and cancels the old native alarms immediately so they
   * don't fire at the wrong time. It also pushes the new windowStart(s)
   * into PENDING_REARM_KEY. Next time we land on /trips/, populate() runs,
   * we drain that queue and re-arm every leave/booking/heads-up alarm at
   * the new dates using the full trips.js scheduling logic. */
  var PENDING_REARM_KEY = 'holidayHacker_pendingTripRearm';
  function drainPendingRearm() {
    var pending;
    try { pending = JSON.parse(localStorage.getItem(PENDING_REARM_KEY) || '[]'); }
    catch (_) { pending = []; }
    if (!pending || !pending.length) return;
    var trips = getConfirmedTrips();
    var settings = getTripSettings();
    var byStart = {};
    trips.forEach(function (t) { if (t && t.windowStart) byStart[t.windowStart] = t; });
    pending.forEach(function (ws) {
      var trip = byStart[ws];
      if (!trip) return;
      try { armLeaveAlarm(trip, settings); } catch (_) {}
      try { armBookingAlarm(trip, settings); } catch (_) {}
    });
    try { localStorage.removeItem(PENDING_REARM_KEY); } catch (_) {}
  }
  window.HolidayHacker.drainPendingRearm = drainPendingRearm;
})();
