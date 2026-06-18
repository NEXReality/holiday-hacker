/* ===========================================================================
 * Holiday Hacker — confirmed-trip shift helper
 *
 * Shared between the Calendar/Holidays page (where the user can edit an
 * existing holiday's date) and the Trips page (which actually re-arms the
 * alarms after the shift). Sits on top of localStorage + the Capacitor
 * HolidayAlarm bridge — no UI dependencies, no DOM, no framework. Safe to
 * load on any page.
 *
 * Public surface (mounted on window.HolidayHacker):
 *
 *   findConfirmedTripsCoveringDate(isoDate)
 *       → Trip[]    confirmed trips whose [windowStart, windowEnd] contains
 *                   `isoDate`. Used to tell the user up-front which trips
 *                   would be affected by editing this holiday.
 *
 *   shiftConfirmedTripsByHolidayEdit(origDate, newDate)
 *       → { shifted, deltaDays, affected: [{oldStart, newStart, destName}] }
 *
 *       Atomically:
 *         1. cancels old native alarms (leave-, book-, book-pre-) on the
 *            obsolete windowStart keys so they never fire at the old time,
 *         2. shifts each affected trip's windowStart + windowEnd + the
 *            user-customised travelDepartureDate (if any) by delta days,
 *         3. migrates the tripSettings entry under the new windowStart key,
 *         4. queues the new windowStart(s) into PENDING_REARM_KEY so the
 *            Trips page re-arms them on its next populate().
 *
 *   PENDING_REARM_KEY
 *       The localStorage key that the Trips page reads to know which trips
 *       need a fresh leave/booking alarm scheduled after the shift.
 *
 * NOTE: we intentionally do NOT re-arm alarms from this module directly.
 *       The full booking-alarm logic (modes, 9 PM heads-up, pretrip vs
 *       booking flow, etc.) lives in trips.js and we don't want to fork it.
 *       Cancelling stale alarms is safe and enough to prevent wrong-time
 *       firings; the user's next visit to /trips/ refreshes the schedule.
 * =========================================================================== */
(function () {
  'use strict';

  var CONFIRMED_TRIPS_KEY = 'holidayHacker_confirmedTrips';
  var TRIP_SETTINGS_KEY   = 'holidayHacker_tripSettings';
  var PENDING_REARM_KEY   = 'holidayHacker_pendingTripRearm';

  function isoToDate(iso) { return new Date(iso + 'T00:00:00'); }
  function dateToIso(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function shiftIso(iso, deltaDays) {
    if (!iso) return iso;
    var d = isoToDate(iso);
    d.setDate(d.getDate() + deltaDays);
    return dateToIso(d);
  }
  function deltaDaysBetween(oldIso, newIso) {
    var a = isoToDate(oldIso).getTime();
    var b = isoToDate(newIso).getTime();
    return Math.round((b - a) / 86400000);
  }
  function isWithinInclusive(iso, startIso, endIso) {
    return iso >= startIso && iso <= endIso;
  }

  function readTrips() {
    try { return JSON.parse(localStorage.getItem(CONFIRMED_TRIPS_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function writeTrips(trips) {
    localStorage.setItem(CONFIRMED_TRIPS_KEY, JSON.stringify(trips));
  }
  function readSettings() {
    try { return JSON.parse(localStorage.getItem(TRIP_SETTINGS_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function writeSettings(s) {
    localStorage.setItem(TRIP_SETTINGS_KEY, JSON.stringify(s));
  }

  function plugin() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayAlarm) {
        return window.Capacitor.Plugins.HolidayAlarm;
      }
    } catch (_) {}
    return null;
  }
  function cancelStaleAlarmsFor(oldWindowStart) {
    var p = plugin();
    if (!p) return;
    ['leave-', 'book-return-pre-', 'book-return-', 'book-pre-', 'book-'].forEach(function (prefix) {
      try { p.cancel({ id: prefix + oldWindowStart }).catch(function () {}); } catch (_) {}
    });
  }

  function findConfirmedTripsCoveringDate(isoDate) {
    if (!isoDate) return [];
    return readTrips().filter(function (t) {
      if (!t || !t.windowStart) return false;
      return isWithinInclusive(isoDate, t.windowStart, t.windowEnd || t.windowStart);
    });
  }

  function queueRearm(newStarts) {
    if (!newStarts || !newStarts.length) return;
    var pending = [];
    try { pending = JSON.parse(localStorage.getItem(PENDING_REARM_KEY) || '[]'); }
    catch (_) {}
    newStarts.forEach(function (s) {
      if (pending.indexOf(s) === -1) pending.push(s);
    });
    try { localStorage.setItem(PENDING_REARM_KEY, JSON.stringify(pending)); } catch (_) {}
  }

  function shiftConfirmedTripsByHolidayEdit(origDate, newDate) {
    var result = { shifted: 0, deltaDays: 0, affected: [] };
    if (!origDate || !newDate || origDate === newDate) return result;
    var delta = deltaDaysBetween(origDate, newDate);
    if (delta === 0) return result;
    result.deltaDays = delta;

    var trips = readTrips();
    if (!trips.length) return result;
    var settings = readSettings();
    var newStarts = [];

    var updated = trips.map(function (t) {
      if (!t || !t.windowStart) return t;
      var end = t.windowEnd || t.windowStart;
      if (!isWithinInclusive(origDate, t.windowStart, end)) return t;

      var oldStart = t.windowStart;
      var newStart = shiftIso(oldStart, delta);
      var newEnd   = shiftIso(end, delta);

      cancelStaleAlarmsFor(oldStart);

      var oldTs = settings[oldStart];
      if (oldTs) {
        var newTs = {};
        Object.keys(oldTs).forEach(function (k) { newTs[k] = oldTs[k]; });
        if (newTs.travelDepartureDate && /^\d{4}-\d{2}-\d{2}$/.test(newTs.travelDepartureDate)) {
          newTs.travelDepartureDate = shiftIso(newTs.travelDepartureDate, delta);
        }
        if (newTs.returnTravelDate && /^\d{4}-\d{2}-\d{2}$/.test(newTs.returnTravelDate)) {
          newTs.returnTravelDate = shiftIso(newTs.returnTravelDate, delta);
        }
        settings[newStart] = newTs;
        delete settings[oldStart];
      }

      t.windowStart = newStart;
      t.windowEnd   = newEnd;
      result.shifted += 1;
      result.affected.push({
        oldStart: oldStart,
        newStart: newStart,
        destName: (t.destination && t.destination.name) || ''
      });
      newStarts.push(newStart);
      return t;
    });

    if (result.shifted > 0) {
      writeTrips(updated);
      writeSettings(settings);
      queueRearm(newStarts);
    }
    return result;
  }

  window.HolidayHacker = window.HolidayHacker || {};
  window.HolidayHacker.findConfirmedTripsCoveringDate = findConfirmedTripsCoveringDate;
  window.HolidayHacker.shiftConfirmedTripsByHolidayEdit = shiftConfirmedTripsByHolidayEdit;
  window.HolidayHacker.PENDING_REARM_KEY = PENDING_REARM_KEY;
})();
