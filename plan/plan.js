(function () {
  'use strict';

  var STORAGE_KEY = 'holidayHacker_user';
  var ADVISOR_DATA_KEY = 'holidayHacker_advisorData';
  var SELECTED_BRIDGES_KEY = 'holidayHacker_selectedBridges';
  var PLANNED_TRIPS_KEY = 'holidayHacker_plannedTrips';
  var PLAN_SELECTED_KEY = 'holidayHacker_planSelectedWindow';
  var RANKING_SEEN_KEY = 'holidayHacker_planRankingSeen';
  var TRAVEL_PREFS_KEY = 'holidayHacker_travelPreferences';
  var PLAN_SELECTED_DEST_KEY = 'holidayHacker_planSelectedDestination';
  var CONFIRMED_TRIPS_KEY = 'holidayHacker_confirmedTrips';
  var FAVORITES_KEY = 'holidayHacker_favorites';
  var VISITED_PLACES_KEY = 'holidayHacker_visitedPlaces';
  var CAL_DONE_KEY = 'holidayHacker_calSetup';
  var INITIAL_DEST_COUNT = 3;
  var RANKING_BULLET_CYCLE_MS = 1200;
  var RANKING_BULLET_FADE_MS = 280;
  var RANKING_RESULTS_REVEAL_MS = 2000;
  var HOMETOWN_SLUG = '__hometown__';
  var HOMETOWN_IMAGE_URL = 'https://img.freepik.com/free-vector/suburban-house-illustration_33099-2357.jpg';
  var DEST_PLACEHOLDER_IMAGE_URL = 'https://img.magnific.com/premium-vector/summer-time-car-beach-with-few-suitcase-vacation-travel-huge-pile-things-holiday-flat-cartoon-style-illustration-landscape-concept-isolated_185796-16.jpg';

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  var MODE_LABELS = { car: 'Car', bus: 'Bus', train: 'Train', flight: 'Flight' };
  var SEGMENT_LABELS = {
    beach: 'Beach / Coastal',
    mountain: 'Mountain / Hills',
    heritage: 'Heritage / Culture',
    wildlife: 'Wildlife / Nature',
    city: 'City / Urban',
    spiritual: 'Spiritual / Pilgrimage'
  };
  var SEGMENT_SHORT = {
    beach: 'Beach',
    mountain: 'Hills',
    heritage: 'Heritage',
    wildlife: 'Wildlife',
    city: 'City',
    spiritual: 'Spiritual'
  };

  var _rankingCycleTimer = null;
  var _rankingEarlyRevealTimer = null;

  var scrollEl = document.getElementById('planWindowsScroll');
  var progressText = document.getElementById('planProgressText');
  var progressFill = document.getElementById('planProgressFill');
  var progressWrap = document.getElementById('planProgressWrap');
  var progressHint = document.getElementById('planProgressHint');
  var _progressHintPct = 0;

  function getCurrentYear() {
    return new Date().getFullYear();
  }

  function todayISO() {
    var n = new Date();
    n.setHours(0, 0, 0, 0);
    var y = n.getFullYear();
    var m = n.getMonth() + 1;
    var d = n.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  function yearEndISO(year) {
    return year + '-12-31';
  }

  function windowOverlapsYear(item, year) {
    if (!item || !item.start || !item.end) return false;
    return item.start <= yearEndISO(year) && item.end >= (year + '-01-01');
  }

  function isWindowUpcoming(item) {
    return !!(item && item.end && item.end >= todayISO());
  }

  var allWindows = [];
  var currentFilter = 'all';
  var destSearchQuery = '';
  var currentUser = null;
  var planDestFilterListenersBound = false;
  var planDestFilterJurisdictions = [];

  function formatRange(start, end) {
    return fmtDateWithYear(start) + ' – ' + fmtDateWithYear(end);
  }

  function fmtDateWithYear(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatStateDisplayName(state) {
    if (!state || typeof state !== 'string') return '';
    return state.replace(/_/g, ' ');
  }

  function stateMetaLookupKey(state) {
    return formatStateDisplayName(state || '').toLowerCase().trim();
  }

  function normalizeLocationKey(str) {
    return (str || '').toLowerCase().replace(/[\s\-_.]/g, '');
  }

  function hasDistinctHometown(user) {
    if (!user) return false;
    var home = (user.homeLocation || '').trim();
    var work = (user.workLocation || '').trim();
    if (!home || !work) return false;
    return normalizeLocationKey(work) !== normalizeLocationKey(home);
  }

  function parseHomeLocation(user) {
    if (!user || !user.homeLocation) return null;
    var raw = String(user.homeLocation).trim();
    if (!raw) return null;
    var parts = raw.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    if (!parts.length) return null;
    var city = parts[0];
    var state = parts.length > 1 ? parts[parts.length - 1] : '';
    return { city: city, state: state, raw: raw };
  }

  function getAdvisorData() {
    try {
      return JSON.parse(localStorage.getItem(ADVISOR_DATA_KEY) || '{}');
    } catch (e) { return {}; }
  }

  function getSelectedBridges() {
    try {
      return JSON.parse(localStorage.getItem(SELECTED_BRIDGES_KEY) || '[]');
    } catch (e) { return []; }
  }

  function getPlannedTrips() {
    try {
      return JSON.parse(localStorage.getItem(PLANNED_TRIPS_KEY) || '[]');
    } catch (e) { return []; }
  }

  function getPlanSelected() {
    try {
      return JSON.parse(localStorage.getItem(PLAN_SELECTED_KEY) || 'null');
    } catch (e) { return null; }
  }

  function setPlanSelected(start) {
    localStorage.setItem(PLAN_SELECTED_KEY, JSON.stringify(start));
  }

  function buildAllWindows() {
    var data = getAdvisorData();
    var selected = getSelectedBridges();
    var planned = getPlannedTrips();
    var list = [];

    /* Free holidays: show only those with "Plan trip?" toggled on in Calendar/Holidays */
    (data.gifts || []).forEach(function (g) {
      if (planned.indexOf(g.start) !== -1) {
        var gl = parseInt(g.leaves, 10) || 0;
        var mh = parseInt(g._manualHolidayDays, 10) || 0;
        var giftSubtype = 'free';
        if (gl > 0) giftSubtype = 'manual_leave';
        else if (mh > 0) giftSubtype = 'manual_holiday';
        list.push({
          type: 'free',
          giftSubtype: giftSubtype,
          name: g.name,
          start: g.start,
          end: g.end,
          days: g.days,
          leaves: gl
        });
      }
    });

    /* Golden bridges: show only those toggled on in Calendar */
    (data.bridges || []).forEach(function (b) {
      if (selected.indexOf(b.start) !== -1) {
        list.push({ type: 'golden', name: b.name, start: b.start, end: b.end, days: b.days, leaves: b.leaves });
      }
    });

    /* Mega bridges: show only those toggled on in Calendar */
    (data.megas || []).forEach(function (m) {
      if (selected.indexOf(m.start) !== -1) {
        var n = m.days === 9 ? '9-Day Mega-Bridge' : (m.days + '-Day Long Bridge');
        list.push({ type: 'mega', name: n, start: m.start, end: m.end, days: m.days, leaves: m.leaves });
      }
    });

    list.sort(function (a, b) { return a.start.localeCompare(b.start); });
    return list;
  }

  function filterWindows() {
    var list = allWindows.filter(isWindowUpcoming);
    if (currentFilter === 'free') list = list.filter(function (w) { return w.type === 'free'; });
    else if (currentFilter === 'golden') list = list.filter(function (w) { return w.type === 'golden'; });
    else if (currentFilter === 'mega') list = list.filter(function (w) { return w.type === 'mega'; });
    return list;
  }

  function getCardTypeClass(w) {
    if (w.type === 'free') return 'plan-window-card--free';
    if (w.type === 'golden') return 'plan-window-card--golden';
    return 'plan-window-card--mega';
  }

  function getFreeGiftTag(w) {
    if (w.giftSubtype === 'manual_holiday') {
      return { cls: 'plan-tag plan-tag--manual-holiday', label: 'Manual holiday' };
    }
    if (w.giftSubtype === 'manual_leave') {
      return { cls: 'plan-tag plan-tag--manual-leave', label: 'Manual Leave' };
    }
    return { cls: 'plan-tag plan-tag--free', label: 'Free holiday' };
  }

  function getTypeLabel(w) {
    if (w.type === 'free') return getFreeGiftTag(w).label;
    if (w.type === 'golden') return 'Golden Bridge';
    return 'Mega-Bridge';
  }

  function getConfirmedDestForWindow(windowStart) {
    var trips = getConfirmedTrips();
    var match = trips.find(function (t) { return t.windowStart === windowStart; });
    return match && match.destination ? match.destination : null;
  }

  /** Hero image for a destination row (Wikivoyage photo or shared placeholder). */
  function resolveDestinationPhotoUrl(raw) {
    if (!raw) return DEST_PLACEHOLDER_IMAGE_URL;
    var u = (raw.images && raw.images[0] && raw.images[0].url) || raw.imageUrl || '';
    u = String(u).trim();
    return u || DEST_PLACEHOLDER_IMAGE_URL;
  }

  function renderWindowCard(w, isSelected) {
    var sel = isSelected ? ' plan-window-card--selected' : '';
    var typeCls = getCardTypeClass(w);
    var tagCls = w.type === 'free'
      ? getFreeGiftTag(w).cls
      : (w.type === 'golden' ? 'plan-tag plan-tag--bridge' : 'plan-tag plan-tag--mega');
    var title = w.name.length > 35 ? w.name.slice(0, 32) + '…' : w.name;
    var dest = getConfirmedDestForWindow(w.start);
    var hasDest = !!dest;
    var destCls = hasDest ? ' plan-window-card--has-dest' : '';
    var bgHtml = '';
    var destChip = '';
    if (hasDest) {
      var isHometownWin = dest.slug === HOMETOWN_SLUG || dest.isHometown;
      var rawImg = String(dest.imageUrl || '').trim();
      if (isHometownWin && !rawImg) rawImg = HOMETOWN_IMAGE_URL;
      if (!rawImg) rawImg = DEST_PLACEHOLDER_IMAGE_URL;
      var imgUrl = rawImg.replace(/'/g, "\\'");
      bgHtml = '<div class="plan-window-bg" style="background-image: url(\'' + imgUrl + '\')"></div>' +
               '<div class="plan-window-bg-overlay"></div>';
      var destName = (dest.name || '').replace(/</g, '&lt;');
      var destState = formatStateDisplayName(dest.state || '').replace(/</g, '&lt;');
      destChip = '<div class="plan-window-dest">' +
        '<span class="material-symbols-outlined">location_on</span>' +
        '<span>' + destName + (destState ? ', ' + destState : '') + '</span>' +
      '</div>';
    }
    var leavesCountTag = '';
    if (w.type === 'golden' || w.type === 'mega') {
      if (w.leaves > 0) {
        leavesCountTag = '<span class="plan-tag">' + w.leaves + ' Leave' + (w.leaves > 1 ? 's' : '') + '</span>';
      }
    } else if (w.type === 'free') {
      if (w.giftSubtype === 'manual_leave' && w.leaves > 0) {
        leavesCountTag = '<span class="plan-tag">' + w.leaves + ' Leave' + (w.leaves > 1 ? 's' : '') + '</span>';
      } else if (w.giftSubtype === 'manual_holiday') {
        leavesCountTag = '<span class="plan-tag">0 Leaves</span>';
      }
    }
    return '<div class="plan-window-card ' + typeCls + sel + destCls + '" data-start="' + w.start + '" data-type="' + w.type + '" title="' + (w.name || '').replace(/"/g, '&quot;') + '">' +
      bgHtml +
      '<h3 class="plan-window-title">' + title + '</h3>' +
      '<div class="plan-window-dates">' +
        '<span class="material-symbols-outlined">calendar_month</span>' +
        '<span>' + formatRange(w.start, w.end) + '</span>' +
      '</div>' +
      '<div class="plan-window-tags">' +
        '<span class="plan-tag ' + tagCls + '">' + getTypeLabel(w) + '</span>' +
        '<span class="plan-tag plan-tag--primary">' + w.days + ' Days</span>' +
        leavesCountTag +
      '</div>' +
      destChip +
    '</div>';
  }

  function getEmptyMessage() {
    var data = getAdvisorData();
    var hasAdvisorData = (data.gifts && data.gifts.length) || (data.bridges && data.bridges.length) || (data.megas && data.megas.length);

    if (allWindows.length === 0) {
      if (!hasAdvisorData) {
        return { title: 'Complete Calendar setup', body: 'See your trip windows after Calendar setup.', link: true };
      }
      return {
        title: 'No trip windows selected',
        body: 'Go to Calendar and toggle "Plan trip?" on free holidays or "Bridge it?" on golden/mega bridges.',
        link: true
      };
    }
    var msg = {};
    if (currentFilter === 'free') {
      msg = { title: 'No free holidays selected', body: 'Go to Calendar or Holidays and toggle "Plan trip?" on free holidays.', link: true };
    } else if (currentFilter === 'golden') {
      msg = { title: 'No golden bridges selected', body: 'Go to Calendar and toggle "Bridge it?" on golden bridges.', link: true };
    } else if (currentFilter === 'mega') {
      msg = { title: 'No mega-bridges selected', body: 'Go to Calendar and toggle "Bridge it?" on mega-bridges.', link: true };
    } else {
      msg = { title: 'No trip windows yet', body: 'Go to Calendar and toggle "Plan trip?" or "Bridge it?" to add windows.', link: true };
    }
    return msg;
  }

  /* Build a Calendar URL that primes the calendar to scroll to the first
     upcoming Free Holiday / Golden Bridge / Mega Bridge based on which
     filter the user currently has active. The 'all' filter sends `any` so
     the calendar still picks the closest upcoming window of any kind. The
     calendar will fall back to another type if the chosen one has none
     upcoming. */
  function calendarLinkForCurrentFilter() {
    var base = '../calendar/index.html';
    var focus = 'any';
    if (currentFilter === 'free')        focus = 'free';
    else if (currentFilter === 'golden') focus = 'golden';
    else if (currentFilter === 'mega')   focus = 'mega';
    return base + '?focus=' + focus;
  }

  function renderWindows() {
    if (!scrollEl) return;
    var filtered = filterWindows();
    if (allWindows.length === 0) {
      var m = getEmptyMessage();
      scrollEl.innerHTML = '<div class="plan-windows-empty"><p class="plan-windows-empty-title">' + m.title + '</p><p class="plan-windows-empty-body">' + m.body + '</p>' + (m.link ? '<a href="' + calendarLinkForCurrentFilter() + '" class="plan-empty-link">Go to Calendar</a>' : '') + '</div>';
      return;
    }
    if (filtered.length === 0) {
      var m = getEmptyMessage();
      scrollEl.innerHTML = '<div class="plan-windows-empty"><p class="plan-windows-empty-title">' + m.title + '</p><p class="plan-windows-empty-body">' + m.body + '</p>' + (m.link ? '<a href="' + calendarLinkForCurrentFilter() + '" class="plan-empty-link">Go to Calendar</a>' : '') + '</div>';
      return;
    }
    var selectedStart = getPlanSelected();
    var html = filtered.map(function (w) {
      return renderWindowCard(w, selectedStart === w.start);
    }).join('');
    scrollEl.innerHTML = html;
    scrollEl.querySelectorAll('.plan-window-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var start = card.getAttribute('data-start');
        setPlanSelected(start);
        updateUI();
        if (currentUser && allDestinations.length) {
          loadAndScoreDestinations(currentUser);
        } else if (currentUser) {
          fetchRecommendationData(currentUser);
        }
      });
    });
  }

  function progressHintText(year, pct) {
    return 'Using ' + pct + '% of hackable days in ' + year;
  }

  function hideProgressHint() {
    if (!progressHint || !progressWrap) return;
    progressHint.hidden = true;
    progressWrap.setAttribute('aria-expanded', 'false');
  }

  function toggleProgressHint() {
    if (!progressHint || !progressWrap) return;
    var open = progressHint.hidden;
    if (open) {
      progressHint.textContent = progressHintText(getCurrentYear(), _progressHintPct);
      progressHint.hidden = false;
      progressWrap.setAttribute('aria-expanded', 'true');
    } else {
      hideProgressHint();
    }
  }

  function wireProgressHint() {
    if (!progressWrap) return;
    progressWrap.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleProgressHint();
    });
    progressWrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleProgressHint();
      }
      if (e.key === 'Escape') hideProgressHint();
    });
    document.addEventListener('click', function (e) {
      if (!progressWrap.contains(e.target) && !(progressHint && progressHint.contains(e.target))) {
        hideProgressHint();
      }
    });
  }

  function updateProgress() {
    if (!progressText || !progressFill) return;
    var year = getCurrentYear();
    var data = getAdvisorData();
    var totalDays = 0;
    (data.gifts || []).forEach(function (g) {
      if (windowOverlapsYear(g, year)) totalDays += (g.days || 0);
    });
    (data.bridges || []).forEach(function (b) {
      if (windowOverlapsYear(b, year)) totalDays += (b.days || 0);
    });
    (data.megas || []).forEach(function (m) {
      if (windowOverlapsYear(m, year)) totalDays += (m.days || 0);
    });

    if (totalDays <= 0) {
      progressText.textContent = '0%';
      _progressHintPct = 0;
      if (progressHint && !progressHint.hidden) {
        progressHint.textContent = progressHintText(year, 0);
      }
      progressFill.setAttribute('stroke-dashoffset', 100);
      return;
    }

    var usedDays = allWindows.filter(function (w) {
      return windowOverlapsYear(w, year);
    }).reduce(function (s, w) { return s + (w.days || 0); }, 0);
    var pct = Math.min(100, Math.round((usedDays / totalDays) * 100));
    _progressHintPct = pct;

    progressText.textContent = pct + '%';
    if (progressHint && !progressHint.hidden) {
      progressHint.textContent = progressHintText(year, pct);
    }
    if (progressWrap) progressWrap.setAttribute('aria-label', progressHintText(year, pct));
    var circumference = 100;
    progressFill.setAttribute('stroke-dashoffset', circumference - (pct / 100) * circumference);
  }

  function updateUI() {
    renderWindows();
    updateProgress();
  }

  function wireFilterPills() {
    var pills = document.querySelectorAll('#planFilterPills .plan-pill');
    pills.forEach(function (p) {
      p.addEventListener('click', function () {
        pills.forEach(function (x) { x.classList.remove('plan-pill--active'); });
        p.classList.add('plan-pill--active');
        currentFilter = p.getAttribute('data-filter');
        renderWindows();
      });
    });
  }

  function wireDestSearch() {
    var el = document.getElementById('planDestSearch');
    if (!el) return;
    el.addEventListener('input', function () {
      destSearchQuery = (el.value || '').trim();
      destVisibleCount = INITIAL_DEST_COUNT;
      cancelRankingReveal();
      renderDestinations();
    });
  }

  function hidePlanDestStateSuggest() {
    var box = document.getElementById('planDestFilterStateSuggest');
    if (box) {
      box.hidden = true;
      box.textContent = '';
    }
  }

  function isPlanDestStateSelected(form, stateName) {
    var key = String(stateName || '').toLowerCase();
    var found = false;
    form.querySelectorAll('input[name="destState"]').forEach(function (i) {
      if (String(i.value || '').toLowerCase() === key) found = true;
    });
    return found;
  }

  function removePlanDestState(stateName) {
    var form = document.getElementById('planDestFilterForm');
    var wrap = document.getElementById('planDestFilterSelectedWrap');
    if (!form || !wrap) return;
    var key = String(stateName || '').toLowerCase();
    wrap.querySelectorAll('.plan-dest-filter-state-chip').forEach(function (chip) {
      var h = chip.querySelector('input[name="destState"]');
      if (h && String(h.value || '').toLowerCase() === key) chip.remove();
    });
    form.querySelectorAll('input[name="destState"]').forEach(function (i) {
      if (String(i.value || '').toLowerCase() === key) i.remove();
    });
    syncPlanDestPopularButtons();
    renderDestinations();
  }

  function addPlanDestState(stateName) {
    var form = document.getElementById('planDestFilterForm');
    var wrap = document.getElementById('planDestFilterSelectedWrap');
    if (!form || !wrap || !stateName) return;
    if (isPlanDestStateSelected(form, stateName)) return;
    var chip = document.createElement('span');
    chip.className = 'plan-dest-filter-state-chip';
    chip.appendChild(document.createTextNode(stateName));
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'plan-dest-filter-state-chip-remove';
    rm.setAttribute('aria-label', 'Remove ' + stateName);
    rm.textContent = '\u00D7';
    rm.addEventListener('click', function () {
      removePlanDestState(stateName);
    });
    var hid = document.createElement('input');
    hid.type = 'hidden';
    hid.name = 'destState';
    hid.value = stateName;
    chip.appendChild(rm);
    chip.appendChild(hid);
    wrap.appendChild(chip);
    syncPlanDestPopularButtons();
    renderDestinations();
  }

  function clearPlanDestStateSelection() {
    var wrap = document.getElementById('planDestFilterSelectedWrap');
    var form = document.getElementById('planDestFilterForm');
    if (wrap) wrap.textContent = '';
    if (form) {
      form.querySelectorAll('input[name="destState"]').forEach(function (i) {
        i.remove();
      });
    }
    var search = document.getElementById('planDestFilterStateSearch');
    if (search) search.value = '';
    hidePlanDestStateSuggest();
    syncPlanDestPopularButtons();
  }

  function updatePlanDestStateSuggest() {
    var input = document.getElementById('planDestFilterStateSearch');
    var box = document.getElementById('planDestFilterStateSuggest');
    var form = document.getElementById('planDestFilterForm');
    if (!input || !box || !form) return;
    var q = (input.value || '').trim().toLowerCase();
    box.textContent = '';
    if (!q) {
      box.hidden = true;
      return;
    }
    var matches = planDestFilterJurisdictions.filter(function (j) {
      if (!j || !j.name) return false;
      if (isPlanDestStateSelected(form, j.name)) return false;
      return j.name.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
    if (!matches.length) {
      box.hidden = true;
      return;
    }
    matches.forEach(function (j) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'plan-dest-filter-state-suggest-item';
      btn.setAttribute('role', 'option');
      btn.textContent = j.name;
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        addPlanDestState(j.name);
        input.value = '';
        hidePlanDestStateSuggest();
      });
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  function pickFirstPlanDestStateSuggest() {
    var box = document.getElementById('planDestFilterStateSuggest');
    if (!box || box.hidden) return;
    var first = box.querySelector('.plan-dest-filter-state-suggest-item');
    if (first) {
      first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }
  }

  function setPlanDestFilterJurisdictions(jurisdictions) {
    planDestFilterJurisdictions = (jurisdictions || []).slice().sort(function (a, b) {
      return String(a && a.name || '').localeCompare(String(b && b.name || ''));
    });
    updatePlanDestStateSuggest();
  }

  function syncPlanDestPopularButtons() {
    var form = document.getElementById('planDestFilterForm');
    if (!form) return;
    document.querySelectorAll('.plan-dest-filter-popular-btn').forEach(function (btn) {
      var st = btn.getAttribute('data-state');
      btn.classList.toggle('is-selected', !!(st && isPlanDestStateSelected(form, st)));
    });
  }

  function planDestFilterEscHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePlanDestFilter();
    }
  }

  function openPlanDestFilter() {
    var overlay = document.getElementById('planDestFilterOverlay');
    var openBtn = document.getElementById('planDestFilterOpen');
    var popup = document.getElementById('planDestFilterPopup');
    if (!overlay || !openBtn) return;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    openBtn.setAttribute('aria-expanded', 'true');
    updatePlanDestStateSuggest();
    updatePlanDestFilterTriggerUI();
    document.addEventListener('keydown', planDestFilterEscHandler);
    if (popup && typeof popup.focus === 'function') {
      try { popup.focus(); } catch (err) { /* ignore */ }
    }
  }

  function closePlanDestFilter() {
    var overlay = document.getElementById('planDestFilterOverlay');
    var openBtn = document.getElementById('planDestFilterOpen');
    if (!overlay || !openBtn) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    openBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', planDestFilterEscHandler);
    hidePlanDestStateSuggest();
    updatePlanDestFilterTriggerUI();
    try { openBtn.focus(); } catch (err) { /* ignore */ }
  }

  function wirePlanDestFilter() {
    if (planDestFilterListenersBound) return;
    var openBtn = document.getElementById('planDestFilterOpen');
    var overlay = document.getElementById('planDestFilterOverlay');
    var form = document.getElementById('planDestFilterForm');
    var stateSearch = document.getElementById('planDestFilterStateSearch');
    var applyBtn = document.getElementById('planDestFilterApply');
    if (!openBtn || !overlay || !form) return;
    planDestFilterListenersBound = true;

    openBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (overlay.classList.contains('is-open')) closePlanDestFilter();
      else openPlanDestFilter();
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePlanDestFilter();
    });

    document.addEventListener('click', function (e) {
      if (!overlay.classList.contains('is-open')) return;
      var field = document.querySelector('.plan-dest-filter-state-field');
      if (field && !field.contains(e.target)) hidePlanDestStateSuggest();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
    });

    form.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.name === 'category') {
        var allInp = form.querySelector('input[name="category"][value="__all__"]');
        if (t.value === '__all__' && t.checked) {
          form.querySelectorAll('input[name="category"]').forEach(function (x) {
            if (x !== t) x.checked = false;
          });
        } else if (t.value !== '__all__' && t.checked && allInp) {
          allInp.checked = false;
        } else if (t.value !== '__all__' && !t.checked) {
          var anyOther = false;
          form.querySelectorAll('input[name="category"]').forEach(function (x) {
            if (x.value !== '__all__' && x.checked) anyOther = true;
          });
          if (!anyOther && allInp) allInp.checked = true;
        }
      }
      var allInp2 = form.querySelector('input[name="category"][value="__all__"]');
      var anyCatChecked = false;
      form.querySelectorAll('input[name="category"]').forEach(function (x) {
        if (x.checked) anyCatChecked = true;
      });
      if (!anyCatChecked && allInp2) allInp2.checked = true;
      syncPlanDestPopularButtons();
      renderDestinations();
    });

    form.addEventListener('reset', function () {
      setTimeout(function () {
        clearPlanDestStateSelection();
        renderDestinations();
      }, 0);
    });

    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        closePlanDestFilter();
        renderDestinations();
      });
    }

    document.querySelectorAll('.plan-dest-filter-popular-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var st = btn.getAttribute('data-state');
        if (!st) return;
        if (isPlanDestStateSelected(form, st)) removePlanDestState(st);
        else addPlanDestState(st);
      });
    });

    if (stateSearch) {
      stateSearch.addEventListener('input', updatePlanDestStateSuggest);
      stateSearch.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          pickFirstPlanDestStateSuggest();
        }
      });
      stateSearch.addEventListener('blur', function () {
        setTimeout(hidePlanDestStateSuggest, 180);
      });
    }
  }

  /** Optional `categories: string[]` plus legacy `category` (string or string[]). Deduped for display and search. */
  function collectDestinationCategoryStrings(raw) {
    if (!raw) return [];
    var out = [];
    var seen = {};
    function add(v) {
      if (v == null || v === '') return;
      if (Array.isArray(v)) {
        v.forEach(add);
        return;
      }
      var t = String(v).trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(t);
    }
    add(raw.categories);
    add(raw.category);
    return out;
  }

  function destinationCategoryBlobLower(raw) {
    return collectDestinationCategoryStrings(raw).join(' ').toLowerCase();
  }

  function planFilterMetaBlobLower(raw) {
    if (!raw) return '';
    var parts = [];
    collectDestinationCategoryStrings(raw).forEach(function (s) {
      parts.push(s);
    });
    if (raw.vibe) parts.push(String(raw.vibe));
    return parts.join(' ').toLowerCase();
  }

  /** Curator-written factual blurbs (not wiki excerpts). Used for scoring, filters, and destination search. */
  function destinationTravelFactsText(raw) {
    if (!raw || !raw.travel_facts) return '';
    var tf = raw.travel_facts;
    var parts = [];
    if (typeof tf.summary === 'string' && tf.summary.trim()) parts.push(tf.summary.trim());
    if (Array.isArray(tf.keywords)) parts.push(tf.keywords.join(' '));
    return parts.join(' ');
  }

  function planFilterSpiritualContextLower(raw) {
    if (!raw) return '';
    var parts = [planFilterMetaBlobLower(raw)];
    if (raw.name) parts.push(String(raw.name));
    if (raw.description) {
      parts.push(String(raw.description)
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .slice(0, 900));
    }
    var tf = destinationTravelFactsText(raw);
    if (tf) parts.push(tf.slice(0, 500));
    var sb = raw.section_briefs;
    if (sb && sb.understand && sb.understand.brief) {
      parts.push(String(sb.understand.brief));
    }
    return parts.join(' ').toLowerCase();
  }

  var PLAN_FILTER_SEGMENT_LABELS = {
    beach: 'beach / coastal',
    mountain: 'mountain / hills',
    heritage: 'heritage / culture',
    wildlife: 'wildlife / nature',
    city: 'city / urban',
    spiritual: 'spiritual / pilgrimage'
  };

  var PLAN_FILTER_FORMAL_CATEGORIES = {
    beach: ['beaches'],
    mountain: ['mountains', 'mountain'],
    heritage: ['historic sites', 'heritage'],
    wildlife: ['nature & wildlife areas', 'nature', 'wildlife'],
    city: ['points of interest & landmarks', 'city'],
    spiritual: ['religious sites', 'religious', 'spiritual', 'pilgrimage']
  };

  /** Plan filter chips: stricter than recommendation scoring — no “one temple in the see list” matches. */
  function destMatchesPlanFilterSegment(chip, raw) {
    if (chip === '__all__') return true;
    if (!raw) return false;

    var narrow = planFilterMetaBlobLower(raw);
    var label = PLAN_FILTER_SEGMENT_LABELS[chip];
    if (label && narrow.indexOf(label) !== -1) return true;

    var formal = PLAN_FILTER_FORMAL_CATEGORIES[chip] || [];
    for (var f = 0; f < formal.length; f++) {
      if (narrow.indexOf(formal[f]) !== -1) return true;
    }

    var segs = (recConfig && recConfig.destination_segments) || {};

    if (chip === 'spiritual') {
      var strong = recConfig.spiritual_filter_strong_keywords || [
        'pilgrimage', 'holy city', 'city of temples', 'sacred city', 'most sacred',
        'char dham', 'ghats', 'tirth', 'tirtha', 'major holy', 'important pilgrimage'
      ];
      var ctx = planFilterSpiritualContextLower(raw);
      for (var si = 0; si < strong.length; si++) {
        if (ctx.indexOf(String(strong[si]).toLowerCase()) !== -1) return true;
      }
      var spiritKw = segs.spiritual || [];
      for (var wi = 0; wi < spiritKw.length; wi++) {
        if (narrow.indexOf(String(spiritKw[wi]).toLowerCase()) !== -1) return true;
      }
      return false;
    }

    var kwList = segs[chip];
    if (kwList && kwList.length) {
      for (var ki = 0; ki < kwList.length; ki++) {
        if (narrow.indexOf(String(kwList[ki]).toLowerCase()) !== -1) return true;
      }
    }
    return false;
  }

  function destinationMatchesDestFilterForm(d) {
    var form = document.getElementById('planDestFilterForm');
    if (!form) return true;
    var cats = [];
    form.querySelectorAll('input[name="category"]:checked').forEach(function (i) {
      cats.push(i.value);
    });
    if (cats.length && cats.indexOf('__all__') === -1) {
      var okCat = false;
      for (var ci = 0; ci < cats.length; ci++) {
        if (destMatchesPlanFilterSegment(cats[ci], d.raw)) {
          okCat = true;
          break;
        }
      }
      if (!okCat) return false;
    }
    var stateMap = {};
    form.querySelectorAll('input[name="destState"]').forEach(function (i) {
      stateMap[String(i.value || '').toLowerCase()] = true;
    });
    var stateKeys = Object.keys(stateMap);
    if (stateKeys.length) {
      var sk = formatStateDisplayName(d.raw.state || '').toLowerCase();
      if (!stateMap[sk]) return false;
    }
    var distInput = form.querySelector('input[name="distance"]:checked');
    var band = distInput ? distInput.value : '';
    if (band) {
      var km = d.distance_km;
      if (km == null || isNaN(Number(km))) return false;
      km = Number(km);
      if (band === 'near' && !(km < 300)) return false;
      if (band === 'mid' && !(km >= 300 && km < 600)) return false;
      if (band === 'far' && !(km >= 600)) return false;
    }
    return true;
  }

  function getPlanDestFilterActiveCriteria() {
    var form = document.getElementById('planDestFilterForm');
    if (!form) return { categories: false, states: false, distance: false };
    var cats = [];
    form.querySelectorAll('input[name="category"]:checked').forEach(function (i) {
      cats.push(i.value);
    });
    var categoryActive = cats.length > 0 && cats.indexOf('__all__') === -1;
    var stateActive = false;
    form.querySelectorAll('input[name="destState"]').forEach(function () {
      stateActive = true;
    });
    var distInput = form.querySelector('input[name="distance"]:checked');
    var distanceActive = !!(distInput && distInput.value);
    return { categories: categoryActive, states: stateActive, distance: distanceActive };
  }

  function isPlanDestFilterActive() {
    var c = getPlanDestFilterActiveCriteria();
    return c.categories || c.states || c.distance;
  }

  function countPlanDestFilterActiveCriteria() {
    var c = getPlanDestFilterActiveCriteria();
    var n = 0;
    if (c.categories) n++;
    if (c.states) n++;
    if (c.distance) n++;
    return n;
  }

  function updatePlanDestFilterTriggerUI() {
    var openBtn = document.getElementById('planDestFilterOpen');
    var badge = document.getElementById('planDestFilterTriggerBadge');
    var overlay = document.getElementById('planDestFilterOverlay');
    if (!openBtn) return;
    var active = isPlanDestFilterActive();
    var isOpen = overlay && overlay.classList.contains('is-open');
    openBtn.classList.toggle('plan-dest-filter-trigger--active', active);
    openBtn.classList.toggle('plan-dest-filter-trigger--open', isOpen);
    var count = countPlanDestFilterActiveCriteria();
    if (badge) {
      if (active && count > 0) {
        badge.hidden = false;
        badge.textContent = String(count);
        badge.removeAttribute('aria-hidden');
        badge.setAttribute('aria-label', count + ' active filter' + (count === 1 ? '' : 's'));
      } else {
        badge.hidden = true;
        badge.textContent = '';
        badge.setAttribute('aria-hidden', 'true');
        badge.removeAttribute('aria-label');
      }
    }
    var icon = openBtn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = active ? 'filter_alt' : 'filter_list';
    var label = openBtn.querySelector('.plan-dest-filter-trigger-text');
    if (label) label.textContent = active ? 'Filtered' : 'Filter';
    openBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    openBtn.setAttribute('aria-label', active
      ? ('Filters on — showing ' + count + ' filtered ' + (count === 1 ? 'criterion' : 'criteria') + '. Tap to change.')
      : 'Filter destinations');
  }

  /* ─── Recommendation Engine ──────────────────────────────────────────── */

  var recConfig = {};
  var stateCityData = { states: [] };
  var stateCentroidByLowerName = null;
  var allDestinations = [];
  var scoredDestinations = [];
  var destVisibleCount = INITIAL_DEST_COUNT;

  function invalidateStateCentroidCache() {
    stateCentroidByLowerName = null;
  }

  /** State-level lat/lon from state-city data (approximate); used when a destination has no point coordinates. */
  function getStateCentroidCoords(stateField) {
    if (!stateField || !stateCityData.states || !stateCityData.states.length) return null;
    if (!stateCentroidByLowerName) {
      stateCentroidByLowerName = {};
      stateCityData.states.forEach(function (s) {
        if (!s || !s.name) return;
        var c = s.coordinates;
        if (c && c.lat != null && c.lon != null) {
          stateCentroidByLowerName[s.name.toLowerCase()] = { lat: Number(c.lat), lon: Number(c.lon) };
        }
      });
    }
    var key = stateMetaLookupKey(stateField);
    return key ? (stateCentroidByLowerName[key] || null) : null;
  }

  function getTravelPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(TRAVEL_PREFS_KEY) || '{}');
      var modes = p.travelModes || (p.travelMode ? [p.travelMode] : null) || ['car'];
      return {
        travelModes: Array.isArray(modes) && modes.length ? modes : ['car'],
        travelParty: p.travelParty || 'solo',
        hasKidsUnder10: !!p.hasKidsUnder10,
        destinationSegments: Array.isArray(p.destinationSegments) ? p.destinationSegments : []
      };
    } catch (e) {
      return { travelModes: ['car'], travelParty: 'solo', hasKidsUnder10: false, destinationSegments: [] };
    }
  }

  /** Modes that can reach this destination from the user's mainland city (car|bus|train|flight). */
  function getDestinationReachableModes(d) {
    var ta = d && d.travel_access;
    if (ta && Array.isArray(ta.reachable_by) && ta.reachable_by.length) return ta.reachable_by;
    return null;
  }

  /** Hide destinations that cannot be reached by any of the user's selected travel modes.
   * Ferry-only / island destinations (no road or rail from mainland) are hidden unless the
   * user has flight selected, since they're realistically only reachable via flight + local ferry. */
  function destinationMatchesTravelModes(d, travelModes) {
    if (!d || !travelModes || !travelModes.length) return true;
    var ta = d.travel_access || {};
    var ferryOnly = ta.road_access_quality === 'island_ferry_or_road' || !!ta.ferry_hub;
    if (ferryOnly && travelModes.indexOf('flight') === -1) return false;
    var reachable = getDestinationReachableModes(d);
    if (!reachable || !reachable.length) return true;
    for (var i = 0; i < travelModes.length; i++) {
      if (reachable.indexOf(travelModes[i]) !== -1) return true;
    }
    return false;
  }

  function getUserCoords(user) {
    var loc = (user && user.workLocation) || '';
    if (!loc) return { lat: 12.9716, lon: 77.5946 };
    var parts = loc.split(',').map(function (p) { return p.trim(); });
    var cityPart = parts[0] || '';
    var statePart = parts.length > 1 ? parts[parts.length - 1] : '';
    for (var i = 0; i < stateCityData.states.length; i++) {
      var s = stateCityData.states[i];
      var stateMatches = !statePart || s.name.toLowerCase() === statePart.toLowerCase();
      if (!stateMatches) continue;
      if (cityPart) {
        if (s.name.toLowerCase() === cityPart.toLowerCase()) return s.coordinates || { lat: 12.9716, lon: 77.5946 };
        var cities = s.cities || [];
        for (var j = 0; j < cities.length; j++) {
          var c = cities[j];
          var cName = typeof c === 'string' ? c : (c && c.name);
          if (cName && cName.toLowerCase() === cityPart.toLowerCase()) {
            if (c.lat != null && c.lon != null) return { lat: c.lat, lon: c.lon };
            return s.coordinates || { lat: 12.9716, lon: 77.5946 };
          }
        }
      }
      if (s.coordinates) return s.coordinates;
    }
    return { lat: 12.9716, lon: 77.5946 };
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  function getAvailableDays() {
    var sel = getPlanSelected();
    if (!sel || !allWindows.length) return 2;
    var w = allWindows.find(function (x) { return x.start === sel; });
    return w ? (w.days || 2) : 2;
  }

  function getBandForDistance(km, mode) {
    var bands = (recConfig.distance_bands_by_mode || {})[mode] || (recConfig.distance_bands_by_mode || {}).car || {};
    if (km <= 300) return bands['0_300'] || 0;
    if (km <= 600) return bands['300_600'] || 0;
    if (km <= 1200) return (bands['600_1200'] != null ? bands['600_1200'] : bands['600_plus']) || 0;
    return (bands['1200_plus'] != null ? bands['1200_plus'] : bands['600_plus']) || 0;
  }

  function hasKeyword(text, keywords) {
    if (!text || !keywords || !keywords.length) return false;
    var t = String(text).toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
      if (t.indexOf(keywords[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  function isUserHomeCity(dest, user) {
    if (!user || !dest) return false;
    var loc = (user.workLocation || user.homeLocation || '').trim();
    if (!loc) return false;
    var cityPart = loc.split(',')[0];
    if (!cityPart) return false;
    cityPart = cityPart.trim().toLowerCase();
    var destName = (dest.name || '').toLowerCase();
    var altNames = (dest.alt_names || []).map(function (a) { return String(a).toLowerCase(); });
    var toMatch = [destName].concat(altNames);
    var cityAliases = { bangalore: ['bengaluru', 'bangalore'], bengaluru: ['bengaluru', 'bangalore'], mysore: ['mysuru', 'mysore'], mysuru: ['mysuru', 'mysore'], mangalore: ['mangaluru', 'mangalore'], mangaluru: ['mangaluru', 'mangalore'], trivandrum: ['thiruvananthapuram', 'trivandrum'], thiruvananthapuram: ['thiruvananthapuram', 'trivandrum'], cochin: ['kochi', 'cochin'], kochi: ['kochi', 'cochin'] };
    var aliases = cityAliases[cityPart] || [cityPart];
    for (var i = 0; i < toMatch.length; i++) {
      var m = toMatch[i];
      for (var j = 0; j < aliases.length; j++) {
        if (m === aliases[j] || m.indexOf(aliases[j]) !== -1 || aliases[j].indexOf(m) !== -1) return true;
      }
    }
    return false;
  }

  function getAllBriefText(d) {
    var sb = d.section_briefs || {};
    var parts = [];
    ['understand', 'see', 'do', 'get_in'].forEach(function (k) {
      if (sb[k] && sb[k].brief) parts.push(sb[k].brief);
    });
    if (d.description) parts.push(d.description);
    var tft = destinationTravelFactsText(d);
    if (tft) parts.push(tft);
    collectDestinationCategoryStrings(d).forEach(function (x) {
      parts.push(x);
    });
    return parts.join(' ');
  }

  /** Map an "available days" window to a curated leave_block_type token. */
  function getLeaveBlockForDays(days) {
    if (days <= 2) return '2_day_weekend';
    if (days === 3) return '3_day_bridge';
    if (days === 4) return '4_day_extended';
    return '5_day_plus';
  }

  /** Canonical city token used to match the user's home city against curated direct-route lists. */
  function getUserCityCanonical(user) {
    if (!user) return '';
    var loc = String(user.workLocation || user.homeLocation || '').trim();
    if (!loc) return '';
    var cityPart = loc.split(',')[0];
    return planAliasCanonical(cityPart);
  }

  /** Returns true if any city in `list` matches the user's canonical city. */
  function listIncludesUserCity(list, userCity) {
    if (!list || !list.length || !userCity) return false;
    for (var i = 0; i < list.length; i++) {
      if (planAliasCanonical(list[i]) === userCity) return true;
    }
    return false;
  }

  /** Score how strongly the destination's curated categories match a user-selected segment.
   * Returns one of: 'primary' (top-level category match), 'secondary' (any category match),
   * 'text' (brief text mentions the segment), or '' (no match). */
  function destinationSegmentStrength(d, segment, cfg) {
    if (!d || !segment) return '';
    var segMap = (cfg && cfg.destination_segments) || {};
    var kw = segMap[segment] || [];
    if (!kw.length) return '';
    var primary = String(d.category || '').toLowerCase();
    var categories = collectDestinationCategoryStrings(d).join(' · ').toLowerCase();
    for (var i = 0; i < kw.length; i++) {
      var token = String(kw[i]).toLowerCase();
      if (!token) continue;
      if (primary.indexOf(token) !== -1) return 'primary';
    }
    for (var j = 0; j < kw.length; j++) {
      var t2 = String(kw[j]).toLowerCase();
      if (t2 && categories.indexOf(t2) !== -1) return 'secondary';
    }
    return '';
  }

  function scoreDestination(d, userCoords, prefs, availableDays, tripMonth, user) {
    var cfg = recConfig;
    var fb = cfg.fallbacks || {};
    var score = 0;

    var dist = d.distance_km;
    var destPt = null;
    if (d.coordinates && d.coordinates.lat != null && d.coordinates.lon != null) {
      destPt = { lat: Number(d.coordinates.lat), lon: Number(d.coordinates.lon) };
    } else {
      destPt = getStateCentroidCoords(d.state);
    }
    if (userCoords && destPt) {
      dist = haversineKm(userCoords.lat, userCoords.lon, destPt.lat, destPt.lon);
    } else if (dist == null) dist = 600;

    var minDays = d.min_days != null ? d.min_days : (fb.min_days || 2);
    var durationWeight = (cfg.decision_table && cfg.decision_table.duration_match && cfg.decision_table.duration_match.weight) || 50;
    if (minDays > availableDays) {
      score -= 80;
    } else {
      score += durationWeight;
      if (availableDays <= 3 && minDays <= 3) score += 25;
      else if (availableDays >= 5 && minDays >= 4) score += 25;
      else if (availableDays >= 7 && minDays >= 5) score += 15;
    }

    // Leave-block tag match (uses curated ideal_leave_block_type)
    var userBlock = getLeaveBlockForDays(availableDays);
    var blockList = Array.isArray(d.ideal_leave_block_type) ? d.ideal_leave_block_type : [];
    if (blockList.length) {
      if (blockList.indexOf(userBlock) !== -1) {
        score += (cfg.leave_block_match_bonus != null ? cfg.leave_block_match_bonus : 25);
      } else if (minDays <= availableDays) {
        score += (cfg.leave_block_mismatch_penalty != null ? cfg.leave_block_mismatch_penalty : -15);
      }
    }

    // Travel-mode banding: only consider modes the destination is actually reachable by.
    var modes = prefs.travelModes || ['car'];
    var reachable = (d.travel_access && Array.isArray(d.travel_access.reachable_by) && d.travel_access.reachable_by.length)
      ? d.travel_access.reachable_by
      : ['car', 'bus', 'train', 'flight'];
    var effectiveModes = [];
    for (var em = 0; em < modes.length; em++) {
      if (reachable.indexOf(modes[em]) !== -1) effectiveModes.push(modes[em]);
    }
    if (!effectiveModes.length) {
      // user's modes can't reach this destination but it survived the filter (e.g., no reachable_by set)
      score += (cfg.impossible_mode_penalty != null ? cfg.impossible_mode_penalty : -250);
      effectiveModes = modes.slice();
    }
    var bestModeScore = -999;
    var bestMode = effectiveModes[0] || 'car';
    for (var m = 0; m < effectiveModes.length; m++) {
      var ms = getBandForDistance(dist, effectiveModes[m]);
      if (ms > bestModeScore) { bestModeScore = ms; bestMode = effectiveModes[m]; }
    }
    score += bestModeScore > -999 ? bestModeScore : getBandForDistance(dist, 'car');
    var distWeight = cfg.distance_actual_weight;
    if (typeof distWeight === 'number' && distWeight !== 0) {
      score += Math.round((500 - dist) * distWeight);
    }

    // Last-mile friction (airport drive for flight users, station drive for train users)
    var ta = d.travel_access || {};
    var lastMileKm = null;
    if (bestMode === 'flight' && ta.nearest_airport && typeof ta.nearest_airport.distance_km === 'number') {
      lastMileKm = ta.nearest_airport.distance_km;
    } else if (bestMode === 'train' && ta.nearest_railway_station && typeof ta.nearest_railway_station.distance_km === 'number') {
      lastMileKm = ta.nearest_railway_station.distance_km;
    }
    if (lastMileKm != null) {
      var lmThresh = cfg.last_mile_threshold_km != null ? cfg.last_mile_threshold_km : 100;
      var lmRate = cfg.last_mile_penalty_per_km != null ? cfg.last_mile_penalty_per_km : 0.15;
      var lmMax = cfg.last_mile_max_penalty != null ? cfg.last_mile_max_penalty : -25;
      if (lastMileKm > lmThresh) {
        var pen = Math.round(-(lastMileKm - lmThresh) * lmRate);
        score += Math.max(lmMax, pen);
      }
    }

    // Direct-route bonus (curated direct_train / direct_flight from the user's home city)
    var userCity = getUserCityCanonical(user);
    if (userCity) {
      var hasTrainList = Array.isArray(ta.direct_train_available_from_major_cities) && ta.direct_train_available_from_major_cities.length;
      var hasFlightList = Array.isArray(ta.direct_flight_available_from_major_cities) && ta.direct_flight_available_from_major_cities.length;
      var directBonus = cfg.direct_route_bonus != null ? cfg.direct_route_bonus : 25;
      var noDirectPenalty = cfg.no_direct_route_penalty != null ? cfg.no_direct_route_penalty : -10;
      var awarded = false;
      var penalized = false;
      for (var im = 0; im < effectiveModes.length; im++) {
        var mode = effectiveModes[im];
        if (mode === 'train' && hasTrainList) {
          if (listIncludesUserCity(ta.direct_train_available_from_major_cities, userCity)) {
            if (!awarded) { score += directBonus; awarded = true; }
          } else if (!penalized) { score += noDirectPenalty; penalized = true; }
        } else if (mode === 'flight' && hasFlightList) {
          if (listIncludesUserCity(ta.direct_flight_available_from_major_cities, userCity)) {
            if (!awarded) { score += directBonus; awarded = true; }
          } else if (!penalized) { score += noDirectPenalty; penalized = true; }
        }
      }
    }

    var briefText = getAllBriefText(d);
    var cat = destinationCategoryBlobLower(d);
    var spiritualSite = isSpiritualSite(d);
    var primaryReligious = categoryHasSpiritualToken(cat);
    var segments = prefs.destinationSegments || [];
    var spiritualPenalty = (cfg.spiritual_not_selected_penalty != null) ? cfg.spiritual_not_selected_penalty : -80;
    var spiritualBonus = (cfg.spiritual_selected_bonus != null) ? cfg.spiritual_selected_bonus : 90;
    var primaryBonus = cfg.category_match_primary_bonus != null ? cfg.category_match_primary_bonus : 40;
    var secondaryBonus = cfg.category_match_secondary_bonus != null ? cfg.category_match_secondary_bonus : 15;
    var offSegmentPenalty = cfg.off_segment_penalty != null ? cfg.off_segment_penalty : -12;
    var spiritualSelected = segments.indexOf('spiritual') !== -1;

    if (spiritualSelected && spiritualSite) {
      score += spiritualBonus;
    } else if (primaryReligious && !spiritualSelected) {
      // Only the heaviest penalty when the place is _purely_ pilgrimage and no other segment matches.
      var mixedSecular = cat.indexOf('city') !== -1 || cat.indexOf('heritage') !== -1 ||
        cat.indexOf('hill') !== -1 || cat.indexOf('mountain') !== -1 ||
        cat.indexOf('beach') !== -1 || cat.indexOf('cultural town') !== -1 ||
        cat.indexOf('archaeological') !== -1;
      score += mixedSecular ? Math.round(spiritualPenalty / 2) : spiritualPenalty;
    }

    if (segments.length) {
      var matchedAny = spiritualSelected && spiritualSite;
      var primaryHit = false;
      var secondaryHit = false;
      for (var s = 0; s < segments.length; s++) {
        var seg = segments[s];
        if (seg === 'spiritual') continue;
        var strength = destinationSegmentStrength(d, seg, cfg);
        if (strength === 'primary') { primaryHit = true; matchedAny = true; break; }
        if (strength === 'secondary') { secondaryHit = true; matchedAny = true; }
        else {
          var kwList = (cfg.destination_segments || {})[seg];
          if (kwList && hasKeyword(briefText, kwList)) { secondaryHit = true; matchedAny = true; }
        }
      }
      if (primaryHit) score += primaryBonus;
      else if (secondaryHit) score += secondaryBonus;
      if (!matchedAny) score += offSegmentPenalty;
    }

    // Same-state nudges (small): weekend trips often prefer "close to home" same-state picks.
    if (user && d.state) {
      var userLoc = String((user.workLocation || user.homeLocation || ''));
      var userStateParts = userLoc.split(',');
      var userStatePart = userStateParts.length > 1 ? userStateParts[userStateParts.length - 1].trim() : '';
      if (userStatePart && d.state.toLowerCase() === userStatePart.toLowerCase()) {
        if (availableDays <= 2) {
          score += (cfg.same_state_weekend_bonus != null ? cfg.same_state_weekend_bonus : 6);
        } else {
          score += (cfg.same_state_penalty != null ? cfg.same_state_penalty : -8);
        }
      }
    }

    var richness = (d.ranking_signals && d.ranking_signals.content_richness_score) != null
      ? d.ranking_signals.content_richness_score
      : (fb.content_richness_score || 0.3);
    var mult = cfg.popularity_multiplier;
    if (typeof mult === 'number' && mult > 0) {
      score += Math.round(richness * mult);
    } else {
      var bands = cfg.popularity_bands || {};
      if (bands.high && richness >= bands.high.min) score += (bands.high.weight || 50);
      else if (bands.medium && richness >= bands.medium.min) score += (bands.medium.weight || 25);
      else if (bands.low && richness >= bands.low.min) score += (bands.low.weight || 10);
      else score += 5;
    }

    var credRecs = d.credibility_recognitions;
    if (Array.isArray(credRecs) && credRecs.length) {
      var credWeights = cfg.credibility_weights || {};
      for (var c = 0; c < credRecs.length; c++) {
        var w = credWeights[credRecs[c]];
        if (typeof w === 'number') score += w;
      }
    }

    var hasKids = prefs.hasKidsUnder10;
    if (hasKids && hasKeyword(briefText, cfg.child_friendly_keywords || [])) {
      score += (cfg.decision_table && cfg.decision_table.child_friendly && cfg.decision_table.child_friendly.weight) || 20;
    }
    if (hasKids && hasKeyword(briefText, cfg.strenuous_keywords || [])) {
      score += (cfg.decision_table && cfg.decision_table.strenuous_penalty && cfg.decision_table.strenuous_penalty.weight) || -40;
    }
    // Structured wildlife-caution penalty for kids (data-driven, complements keyword scan)
    if (hasKids && d.safety_profile && d.safety_profile.wildlife_caution) {
      score -= 30;
    }

    // Per-destination climate signals from curated climate_profile
    var clim = d.climate_profile || {};
    var avoidMonthPen = cfg.climate_avoid_month_penalty != null ? cfg.climate_avoid_month_penalty : -60;
    var monsoonNaturePen = cfg.climate_monsoon_nature_penalty != null ? cfg.climate_monsoon_nature_penalty : -25;
    var peakBonus = cfg.peak_season_bonus != null ? cfg.peak_season_bonus : 25;
    if (tripMonth) {
      if (Array.isArray(clim.avoid_months) && clim.avoid_months.indexOf(tripMonth) !== -1) {
        score += avoidMonthPen;
      }
      if (Array.isArray(clim.monsoon_months) && clim.monsoon_months.indexOf(tripMonth) !== -1) {
        var monsoonRiskCats = ['nature', 'wildlife', 'national park', 'mountain', 'hill', 'trek'];
        var inMonsoonRiskCat = false;
        for (var mri = 0; mri < monsoonRiskCats.length; mri++) {
          if (cat.indexOf(monsoonRiskCats[mri]) !== -1) { inMonsoonRiskCat = true; break; }
        }
        if (inMonsoonRiskCat) score += monsoonNaturePen;
      }
      if (Array.isArray(clim.peak_season_months) && clim.peak_season_months.indexOf(tripMonth) !== -1) {
        score += peakBonus;
      }
    }

    // Landslide states in monsoon — additional penalty on top of climate signal
    var sm = cfg.seasonal_map || {};
    var monsoonMonthsGlobal = sm.monsoon_risk_months || [6, 7, 8];
    var monsoonLandslide = sm.monsoon_landslide_states || [];
    if (tripMonth && monsoonMonthsGlobal.indexOf(tripMonth) !== -1) {
      var st = (d.state || '').toLowerCase();
      var stateInLandslide = monsoonLandslide.some(function (x) { return String(x).toLowerCase() === st; });
      if (stateInLandslide) score -= 30;
    }

    // Legacy summer beach/ruins penalty (kept for cases without curated avoid_months)
    var summerMonths = sm.summer_risk_months || [3, 4, 5];
    if (tripMonth && summerMonths.indexOf(tripMonth) !== -1 && !(Array.isArray(clim.avoid_months) && clim.avoid_months.length)) {
      if (cat.indexOf('beach') !== -1 || cat.indexOf('ruins') !== -1) score -= 30;
    }

    return { score: score, distance_km: dist, min_days: minDays };
  }

  var SPIRITUAL_CATEGORY_TOKENS = ['religious', 'spiritual', 'pilgrimage', 'yoga', 'temple', 'ashram', 'holy'];
  var SPIRITUAL_TEXT_KEYWORDS = ['temple', 'pilgrimage', 'shrine', 'sabarimala', 'tirth', 'tirtha', 'sacred', 'holy city', 'char dham', 'jyotirlinga', 'ashram', 'yoga capital'];

  function categoryHasSpiritualToken(cat) {
    if (!cat) return false;
    for (var i = 0; i < SPIRITUAL_CATEGORY_TOKENS.length; i++) {
      if (cat.indexOf(SPIRITUAL_CATEGORY_TOKENS[i]) !== -1) return true;
    }
    return false;
  }

  function isSpiritualSite(d) {
    if (!d) return false;
    var cat = destinationCategoryBlobLower(d);
    if (categoryHasSpiritualToken(cat)) return true;
    var brief = (d.description || '') + ' ' + (d.name || '') + ' ' +
      (d.travel_facts && d.travel_facts.summary ? d.travel_facts.summary : '');
    return hasKeyword(brief, SPIRITUAL_TEXT_KEYWORDS);
  }

  var CREDIBILITY_LABELS = { unesco_world_heritage: 'UNESCO', unesco_tentative: 'UNESCO Tentative', geo_heritage: 'Geo-heritage', asi_monument: 'ASI Monument' };

  function deriveTags(d, hasKids, tripMonth) {
    var tags = [];
    var credRecs = d.credibility_recognitions;
    if (Array.isArray(credRecs) && credRecs.length) {
      var label = CREDIBILITY_LABELS[credRecs[0]] || credRecs[0];
      tags.push({ text: label, cls: 'plan-dest-badge--credibility', prio: 11 });
    }
    if (d.safety_profile && d.safety_profile.requires_permit) {
      tags.push({ text: 'Permit required', cls: 'plan-dest-badge--permit', prio: 9 });
    }
    var sm = recConfig.seasonal_map || {};
    var summerMonths = sm.summer_risk_months || [3, 4, 5];
    var isSummer = tripMonth && summerMonths.indexOf(tripMonth) !== -1;
    var months = d.ideal_months || (d.best_time_to_visit && d.best_time_to_visit.months) || (d.climate_profile && d.climate_profile.peak_season_months) || [];
    var cat = destinationCategoryBlobLower(d);
    var spiritual = isSpiritualSite(d);
    if (months.length > 0 && months.length <= 3) {
      var names = months.map(function (m) { return MONTHS[m - 1] || ''; }).filter(Boolean);
      if (names.length) tags.push({ text: 'Ideal in ' + names.join('/'), cls: 'plan-dest-badge--ideal', prio: 10 });
    } else {
      var brief = getAllBriefText(d);
      var cf = hasKeyword(brief, recConfig.child_friendly_keywords || []);
      var strenuous = hasKeyword(brief, recConfig.strenuous_keywords || []);
      if (hasKids) {
        if (cf && !strenuous) tags.push({ text: 'Family friendly', cls: '', prio: 8 });
        if (cf) tags.push({ text: 'Child friendly', cls: '', prio: 7 });
      }
      if (isSummer && (cat.indexOf('beach') !== -1 || cat.indexOf('nature') !== -1)) tags.push({ text: 'Best in summer', cls: '', prio: 5 });
      var monsoonMonthsTag = sm.monsoon_risk_months || [6, 7, 8];
      var isMonsoonTrip = tripMonth && monsoonMonthsTag.indexOf(tripMonth) !== -1;
      if (isMonsoonTrip && cat.indexOf('nature') !== -1) {
        var friendlyList = sm.monsoon_nature_friendly_states;
        var regions = sm.monsoon_nature_friendly_regions || ['South', 'West'];
        var extras = sm.monsoon_nature_friendly_states_extra || [];
        var stateDispLower = formatStateDisplayName(d.state || '').toLowerCase();
        var monsoonStateOk = false;
        if (friendlyList && friendlyList.length) {
          monsoonStateOk = friendlyList.some(function (x) { return String(x).toLowerCase() === stateDispLower; });
        } else {
          monsoonStateOk = (d._indiaRegion && regions.indexOf(d._indiaRegion) !== -1) ||
            extras.some(function (x) { return String(x).toLowerCase() === stateDispLower; });
        }
        if (monsoonStateOk) tags.push({ text: 'Suitable in monsoon', cls: '', prio: 5 });
      }
      if (!spiritual && !cf && !strenuous && (cat.indexOf('garden') !== -1 || cat.indexOf('park') !== -1 || cat.indexOf('nature') !== -1 || cat.indexOf('wildlife') !== -1 || cat.indexOf('mountain') !== -1)) tags.push({ text: 'Best for couples', cls: '', prio: 6 });
    }
    var minD = d.min_days != null ? d.min_days : 2;
    var nights = Math.max(1, minD - 1);
    tags.push({ text: minD + 'D/' + nights + 'N', cls: '', prio: 1 });
    tags.sort(function (a, b) { return (b.prio || 0) - (a.prio || 0); });
    return tags.slice(0, 1);
  }

  function getPlanFavorites() {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch (e) { return []; }
  }
  function isDestFavorite(slug) {
    return getPlanFavorites().some(function (f) { return f.destination && f.destination.slug === slug; });
  }

  function getVisitedPlaces() {
    try {
      var arr = JSON.parse(localStorage.getItem(VISITED_PLACES_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function setVisitedPlaces(arr) {
    localStorage.setItem(VISITED_PLACES_KEY, JSON.stringify(arr || []));
  }

  /* Resolve "Bangalore" → "bengaluru", "Bombay" → "mumbai", etc., using the
   * alias map shipped in database/state-city/data.json. Falls back to the
   * normalised raw string when no alias is found. */
  function planAliasCanonical(s) {
    var key = normalizeLocationKey(s);
    if (!key) return '';
    var map = (stateCityData && stateCityData.aliases) || {};
    return map[key] || key;
  }

  /* A destination is considered "visited" when:
   * - the visited entry is a single token (state or single-name city/UT, e.g. "Goa", "Karnataka")
   *   → matches every destination whose state or name equals that token; or
   * - the visited entry is "City, State"
   *   → matches a destination whose name == City and state == State.
   * Comparison runs through the alias map AND whitespace/punctuation/case
   * normalisation, so "Bangalore", "Bengaluru" and "bengaluru" all match
   * "Bengaluru, Karnataka". */
  function isDestinationVisited(d, visitedList) {
    if (!d || !visitedList || !visitedList.length) return false;
    var dName = planAliasCanonical(d.name);
    var dState = planAliasCanonical(d.state);
    for (var i = 0; i < visitedList.length; i++) {
      var entry = String(visitedList[i] || '').trim();
      if (!entry) continue;
      var parts = entry.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      if (parts.length === 1) {
        var token = planAliasCanonical(parts[0]);
        if (token && (token === dState || token === dName)) return true;
      } else {
        var pCity = planAliasCanonical(parts[0]);
        var pState = planAliasCanonical(parts[parts.length - 1]);
        if (pCity === dName && (!pState || pState === dState)) return true;
      }
    }
    return false;
  }

  /* Toggle the visited flag for a single destination. When unmarking, drops
   * any matching entry (city-level or state-level) so the toggle truly turns off. */
  function setDestinationVisited(dest, makeVisited) {
    if (!dest || !dest.raw || !dest.raw.name) return;
    var canonName = planAliasCanonical(dest.raw.name);
    var canonState = planAliasCanonical(dest.raw.state);
    var arr = getVisitedPlaces().filter(function (entry) {
      var parts = String(entry || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      if (parts.length === 1) {
        var t = planAliasCanonical(parts[0]);
        return !(t === canonName || t === canonState);
      }
      var pc = planAliasCanonical(parts[0]);
      var ps = planAliasCanonical(parts[parts.length - 1]);
      return !(pc === canonName && (!ps || ps === canonState));
    });
    if (makeVisited) {
      var stateDisp = formatStateDisplayName(dest.raw.state || '');
      var label = stateDisp ? (dest.raw.name + ', ' + stateDisp) : dest.raw.name;
      arr.push(label);
    }
    setVisitedPlaces(arr);
  }

  function closeAllPlanMenus() {
    document.querySelectorAll('.plan-dest-menu').forEach(function (m) {
      if (!m.hidden) m.hidden = true;
    });
    document.querySelectorAll('.plan-dest-menu-btn[aria-expanded="true"]').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false');
    });
  }

  function refreshVisitedFlags() {
    var visitedList = getVisitedPlaces();
    scoredDestinations.forEach(function (d) {
      d.visited = isDestinationVisited(d.raw, visitedList);
    });
    scoredDestinations.sort(function (a, b) {
      if (a.visited !== b.visited) return a.visited ? 1 : -1;
      var diff = (b.score || 0) - (a.score || 0);
      if (diff !== 0) return diff;
      return (b.content_richness || 0) - (a.content_richness || 0);
    });
  }

  function renderDestCard(dest, isSelected) {
    var d = dest.raw;
    var tags = dest.tags || [];
    var imgUrl = resolveDestinationPhotoUrl(d).replace(/'/g, "\\'");
    var selCls = isSelected ? ' plan-dest-card--selected' : '';
    var visitedCls = dest.visited ? ' plan-dest-card--visited' : '';
    var bestTag = tags[0];
    var tagHtml = bestTag ? '<span class="plan-dest-badge ' + (bestTag.cls || '') + '">' + (bestTag.text || '').replace(/</g, '&lt;') + '</span>' : '';
    var scoreDebug = '<span class="plan-dest-score-debug" title="Calculated score">' + (dest.score != null ? dest.score : '–') + '</span>';
    var favActive = isDestFavorite(d.slug);
    var favIconName = favActive ? 'favorite' : 'favorite_border';
    var favActiveCls = favActive ? ' plan-dest-fav--active' : '';
    var slugAttr = (d.slug || '').replace(/"/g, '&quot;');
    return '<div class="plan-dest-card' + selCls + visitedCls + '" data-slug="' + slugAttr + '">' +
      '<div class="plan-dest-img" style="background-image: url(\'' + imgUrl + '\')"></div>' +
      '<div class="plan-dest-overlay"></div>' +
      '<button type="button" class="plan-dest-fav' + favActiveCls + '" data-slug="' + slugAttr + '" aria-label="Favorite"><span class="material-symbols-outlined">' + favIconName + '</span></button>' +
      '<div class="plan-dest-badges">' + tagHtml + scoreDebug + '</div>' +
      '<div class="plan-dest-info">' +
        '<div><h3 class="plan-dest-name">' + (d.name || '').replace(/</g, '&lt;') + '</h3><p class="plan-dest-region">' + formatStateDisplayName(d.state || '').replace(/</g, '&lt;') + '</p></div>' +
        '<button type="button" class="plan-dest-menu-btn" data-slug="' + slugAttr + '" aria-label="More options" aria-haspopup="menu" aria-expanded="false"><span class="material-symbols-outlined">more_vert</span></button>' +
      '</div>' +
      '<div class="plan-dest-menu" role="menu" hidden>' +
        '<button type="button" class="plan-dest-menu-item" data-action="visit" data-slug="' + slugAttr + '" role="menuitem">' +
          '<span class="material-symbols-outlined">flag</span>' +
          '<span>Already visited</span>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function renderHometownCard(parsed, isSelected) {
    var selCls = isSelected ? ' plan-dest-card--selected' : '';
    var city = (parsed.city || '').replace(/</g, '&lt;');
    var stateDisp = formatStateDisplayName(parsed.state || '').replace(/</g, '&lt;');
    var sub = stateDisp ? (city + ', ' + stateDisp) : city;
    var homeCardImg = HOMETOWN_IMAGE_URL.replace(/'/g, "\\'");
    return '<div class="plan-dest-card plan-dest-card--hometown' + selCls + '" data-slug="' + HOMETOWN_SLUG + '">' +
      '<div class="plan-dest-img plan-dest-img--hometown" style="background-image: url(\'' + homeCardImg + '\')"></div>' +
      '<div class="plan-dest-overlay plan-dest-overlay--hometown"></div>' +
      '<div class="plan-dest-badges">' +
        '<span class="plan-dest-badge plan-dest-badge--hometown">Hometown</span>' +
      '</div>' +
      '<div class="plan-dest-info">' +
        '<div><h3 class="plan-dest-name">Visit hometown</h3>' +
        '<p class="plan-dest-region">' + sub + '</p>' +
        '<p class="plan-dest-hometown-hint">Not traveling elsewhere? Use this break for family time back home.</p></div>' +
        '<div class="plan-dest-icons"><span class="material-symbols-outlined">home</span></div>' +
      '</div></div>';
  }

  function wirePlanDestCardClicks(sel) {
    var grid = document.getElementById('planDestGrid');
    if (!grid) return;
    grid.querySelectorAll('.plan-dest-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (
          e.target.closest('.plan-explore-btn') ||
          e.target.closest('.plan-dest-fav') ||
          e.target.closest('.plan-dest-menu-btn') ||
          e.target.closest('.plan-dest-menu')
        ) return;
        var slug = card.getAttribute('data-slug');
        var w = allWindows.find(function (x) { return x.start === sel; });
        if (!w) return;
        var trips = getConfirmedTrips();
        var existing = trips.findIndex(function (t) { return t.windowStart === sel; });

        if (slug === HOMETOWN_SLUG) {
          var parsed = currentUser ? parseHomeLocation(currentUser) : null;
          if (!parsed) return;
          var entry = {
            windowStart: w.start,
            windowEnd: w.end,
            windowDays: w.days,
            windowName: w.name,
            windowType: w.type,
            leaves: w.leaves || 0,
            destination: {
              slug: HOMETOWN_SLUG,
              name: parsed.city,
              state: parsed.state,
              category: 'Hometown',
              isHometown: true,
              imageUrl: HOMETOWN_IMAGE_URL,
              description: '',
              understand_brief: '',
              see_brief: '',
              min_days: w.days,
              distance_km: null
            }
          };
          var didAddHome = false;
          if (existing >= 0) {
            if (trips[existing].destination && trips[existing].destination.slug === HOMETOWN_SLUG) {
              trips.splice(existing, 1);
            } else {
              trips[existing] = entry;
              didAddHome = true;
            }
          } else {
            trips.push(entry);
            didAddHome = true;
          }
          setConfirmedTrips(trips);
          renderWindows();
          renderDestinations();
          if (didAddHome) showPlanToast('Hometown visit', w.name);
          return;
        }

        var dest = scoredDestinations.find(function (x) { return x.raw.slug === slug; });
        if (!dest) return;
        var imgUrl = resolveDestinationPhotoUrl(dest.raw);
        var sb = dest.raw.section_briefs || {};
        var entry2 = {
          windowStart: w.start,
          windowEnd: w.end,
          windowDays: w.days,
          windowName: w.name,
          windowType: w.type,
          leaves: w.leaves || 0,
          destination: {
            slug: dest.raw.slug,
            name: dest.raw.name,
            state: dest.raw.state,
            distance_km: dest.distance_km,
            imageUrl: imgUrl,
            min_days: dest.min_days,
            description: dest.raw.description || '',
            category: collectDestinationCategoryStrings(dest.raw).join(' · ') || (dest.raw.category || ''),
            understand_brief: (sb.understand && sb.understand.brief) || '',
            see_brief: (sb.see && sb.see.brief) || ''
          }
        };
        var didAddDest = false;
        if (existing >= 0) {
          if (trips[existing].destination && trips[existing].destination.slug === slug) {
            trips.splice(existing, 1);
          } else {
            trips[existing] = entry2;
            didAddDest = true;
          }
        } else {
          trips.push(entry2);
          didAddDest = true;
        }
        setConfirmedTrips(trips);
        renderWindows();
        renderDestinations();
        if (didAddDest) showPlanToast(dest.raw.name, w.name);
      });
    });
  }

  function getConfirmedTrips() {
    try {
      return JSON.parse(localStorage.getItem(CONFIRMED_TRIPS_KEY) || '[]');
    } catch (e) { return []; }
  }

  function setConfirmedTrips(trips) {
    localStorage.setItem(CONFIRMED_TRIPS_KEY, JSON.stringify(trips));
  }

  var _planToastTimer = null;
  function showPlanToast(destName, windowName) {
    var toast = document.getElementById('planToast');
    if (!toast) return;
    var titleEl = document.getElementById('planToastTitle');
    var textEl = document.getElementById('planToastText');
    if (titleEl) {
      titleEl.textContent = destName ? (destName + ' saved') : 'Trip saved';
    }
    if (textEl) {
      var safeWin = windowName ? String(windowName).replace(/</g, '&lt;') : '';
      textEl.innerHTML = safeWin
        ? 'Locked in for <strong>' + safeWin + '</strong>. Head to <strong>Trips</strong> to customize.'
        : 'Head to <strong>Trips</strong> to customize this plan.';
    }
    toast.hidden = false;
    requestAnimationFrame(function () { toast.classList.add('plan-toast--show'); });
    if (_planToastTimer) clearTimeout(_planToastTimer);
    _planToastTimer = setTimeout(hidePlanToast, 6000);
  }
  function hidePlanToast() {
    var toast = document.getElementById('planToast');
    if (!toast) return;
    toast.classList.remove('plan-toast--show');
    if (_planToastTimer) { clearTimeout(_planToastTimer); _planToastTimer = null; }
    setTimeout(function () { if (!toast.classList.contains('plan-toast--show')) toast.hidden = true; }, 250);
  }

  function syncConfirmedTripsToWindows() {
    var trips = getConfirmedTrips();
    if (!trips.length) return;
    var activeStarts = {};
    allWindows.forEach(function (w) { activeStarts[w.start] = true; });
    var cleaned = trips.filter(function (t) { return !!activeStarts[t.windowStart]; });
    if (cleaned.length !== trips.length) {
      setConfirmedTrips(cleaned);
    }
  }

  function updatePlanDestFilterDestinationCount(n) {
    var el = document.getElementById('planDestFilterCount');
    if (el) el.textContent = String(n != null ? n : 0);
  }

  function clearPlanDestSearchAndFilters() {
    destSearchQuery = '';
    var searchEl = document.getElementById('planDestSearch');
    if (searchEl) searchEl.value = '';
    var form = document.getElementById('planDestFilterForm');
    if (form) form.reset();
    clearPlanDestStateSelection();
    destVisibleCount = INITIAL_DEST_COUNT;
    renderDestinations();
  }

  function getSelectedWindow() {
    var sel = getPlanSelected();
    if (!sel) return null;
    for (var i = 0; i < allWindows.length; i++) {
      if (allWindows[i].start === sel) return allWindows[i];
    }
    return null;
  }

  function cancelRankingEarlyReveal() {
    if (_rankingEarlyRevealTimer) {
      clearTimeout(_rankingEarlyRevealTimer);
      _rankingEarlyRevealTimer = null;
    }
  }

  function cancelRankingCarousel() {
    if (_rankingCycleTimer) {
      clearTimeout(_rankingCycleTimer);
      _rankingCycleTimer = null;
    }
  }

  function cancelRankingReveal() {
    cancelRankingEarlyReveal();
    cancelRankingCarousel();
  }

  function loadRankingSeenList() {
    try {
      var arr = JSON.parse(localStorage.getItem(RANKING_SEEN_KEY) || '[]');
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (s) { return typeof s === 'string' && s; });
    } catch (e) {
      return [];
    }
  }

  function hasRankingBeenSeen(windowStart) {
    if (!windowStart) return false;
    return loadRankingSeenList().indexOf(windowStart) !== -1;
  }

  function markRankingSeen(windowStart) {
    if (!windowStart) return;
    var arr = loadRankingSeenList();
    if (arr.indexOf(windowStart) !== -1) return;
    arr.push(windowStart);
    try {
      localStorage.setItem(RANKING_SEEN_KEY, JSON.stringify(arr));
    } catch (e) { /* ignore */ }
  }

  function formatModesPhrase(modes) {
    var labels = (modes || ['car']).map(function (m) {
      return MODE_LABELS[m] || m;
    });
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return labels[0] + ' & ' + labels[1];
    return labels.slice(0, -1).join(', ') + ' & ' + labels[labels.length - 1];
  }

  function formatSegmentsPhrase(segments, short) {
    if (!segments || !segments.length) return '';
    var map = short ? SEGMENT_SHORT : SEGMENT_LABELS;
    return segments.map(function (s) {
      return map[s] || s;
    }).join(', ');
  }

  function buildFamilyBullet(prefs) {
    if (prefs.hasKidsUnder10) {
      return 'Keeping <strong>young kids</strong> in mind — easier, family-friendly places first.';
    }
    var party = prefs.travelParty || 'solo';
    if (party === 'couple') return 'Planning for a <strong>couple</strong> getaway.';
    if (party === 'family') return 'Planning for a <strong>family</strong> trip.';
    if (party === 'group') return 'Suited for <strong>group</strong> travel.';
    return 'Tailored for <strong>solo</strong> travel.';
  }

  function buildRankingBullets(win, prefs) {
    var monthName = '';
    if (win && win.start) {
      var parts = win.start.split('-');
      var mi = parseInt(parts[1], 10);
      if (mi >= 1 && mi <= 12) monthName = MONTHS_FULL[mi - 1];
    }
    if (!monthName) monthName = MONTHS_FULL[new Date().getMonth()];

    var days = win ? (win.days || 2) : getAvailableDays();
    var dayLabel = days === 1 ? '1-day' : (days + '-day');

    var bullets = [];
    bullets.push('Considering the <strong>' + monthName + '</strong> break.');
    bullets.push('For a <strong>' + dayLabel + '</strong> break.');
    bullets.push('Better for <strong>' + formatModesPhrase(prefs.travelModes) + '</strong> travel.');

    var segPhrase = formatSegmentsPhrase(prefs.destinationSegments, true);
    if (segPhrase) {
      bullets.push('As per your preferred destinations like <strong>' + segPhrase + '</strong>.');
    } else {
      bullets.push('Showing a <strong>balanced mix</strong> until you add place preferences in Profile.');
    }

    bullets.push(buildFamilyBullet(prefs));
    return bullets;
  }

  function hideRankingBullets() {
    var el = document.getElementById('planRankingBullets');
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
  }

  function startRankingBulletCarousel(bullets, onFinish) {
    var el = document.getElementById('planRankingBullets');
    if (!el || !bullets.length) {
      if (onFinish) onFinish();
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<p class="plan-ranking-lead">Personalising for you…</p>' +
      '<div class="plan-ranking-slot">' +
        '<p class="plan-ranking-line" id="planRankingLine"></p>' +
      '</div>';
    var line = document.getElementById('planRankingLine');
    if (!line) {
      if (onFinish) onFinish();
      return;
    }

    cancelRankingCarousel();

    var index = 0;
    function showStep() {
      if (index >= bullets.length) {
        if (onFinish) onFinish();
        return;
      }
      line.innerHTML = bullets[index];
      line.classList.remove('plan-ranking-line--visible');
      index++;
      requestAnimationFrame(function () {
        line.classList.add('plan-ranking-line--visible');
        _rankingCycleTimer = setTimeout(function () {
          line.classList.remove('plan-ranking-line--visible');
          _rankingCycleTimer = setTimeout(showStep, RANKING_BULLET_FADE_MS);
        }, RANKING_BULLET_CYCLE_MS);
      });
    }
    showStep();
  }

  function showRankingPlaceholderGrid() {
    var grid = document.getElementById('planDestGrid');
    if (!grid) return;
    var showHometown = !!(currentUser && hasDistinctHometown(currentUser));
    var homeParsed = showHometown ? parseHomeLocation(currentUser) : null;
    if (showHometown && !homeParsed) showHometown = false;
    var hometownHtml = (showHometown && homeParsed && !(destSearchQuery || '').trim() && !isPlanDestFilterActive())
      ? renderHometownCard(homeParsed, false)
      : '';
    grid.innerHTML = hometownHtml +
      '<div class="plan-dest-loading plan-dest-loading--ranking" id="planDestLoading">Finding matches…</div>';
  }

  function scheduleDestinationsReveal() {
    var win = getSelectedWindow();
    var sel = win ? win.start : null;
    if (!sel) {
      cancelRankingReveal();
      hideRankingBullets();
      renderDestinations();
      return;
    }

    var prefs = getTravelPrefs();
    var bullets = buildRankingBullets(win, prefs);
    var animate = !hasRankingBeenSeen(sel);

    if (!animate) {
      cancelRankingReveal();
      hideRankingBullets();
      renderDestinations();
      return;
    }

    markRankingSeen(sel);
    cancelRankingReveal();
    showRankingPlaceholderGrid();
    _rankingEarlyRevealTimer = setTimeout(function () {
      _rankingEarlyRevealTimer = null;
      renderDestinations();
    }, RANKING_RESULTS_REVEAL_MS);
    startRankingBulletCarousel(bullets, hideRankingBullets);
  }

  function renderPlanDestNoResultsHtml() {
    var searchActive = !!(destSearchQuery || '').trim();
    var filterActive = isPlanDestFilterActive();
    if (!searchActive && !filterActive) {
      return '<div class="plan-dest-empty">' +
        '<span class="material-symbols-outlined plan-dest-empty-icon" aria-hidden="true">explore_off</span>' +
        '<p class="plan-dest-empty-title">No destinations to show</p>' +
        '<p class="plan-dest-empty-body">Everything here may be visited or saved on another window. Pick another break or check Trips.</p>' +
        '</div>';
    }
    var title = 'No destinations match';
    var body = 'Remove or relax some filters, then try again.';
    if (searchActive && !filterActive) {
      body = 'Try a different search term, or clear the search box and browse again.';
    } else if (filterActive && !searchActive) {
      body = 'Open Filter and remove category, state, or distance choices, then try again.';
    } else if (searchActive && filterActive) {
      body = 'Clear your search and remove one or more filters, then try again.';
    }
    var actions = '';
    if (searchActive || filterActive) {
      actions = '<button type="button" class="plan-dest-empty-btn" id="planDestClearSearchFilters">Clear search &amp; filters</button>';
    }
    return '<div class="plan-dest-empty">' +
      '<span class="material-symbols-outlined plan-dest-empty-icon" aria-hidden="true">travel_explore</span>' +
      '<p class="plan-dest-empty-title">' + title + '</p>' +
      '<p class="plan-dest-empty-body">' + body + '</p>' +
      actions +
      '</div>';
  }

  function renderDestinations() {
    cancelRankingEarlyReveal();

    var grid = document.getElementById('planDestGrid');
    var loading = document.getElementById('planDestLoading');
    var destSection = document.querySelector('.plan-destinations');
    if (!grid) return;

    var sel = getPlanSelected();
    var hasSelectedWindow = sel && allWindows.some(function (w) { return w.start === sel; });

    if (!hasSelectedWindow || allWindows.length === 0) {
      hideRankingBullets();
      if (destSection) destSection.style.display = 'none';
      updatePlanDestFilterDestinationCount(0);
      updatePlanDestFilterTriggerUI();
      return;
    }

    if (destSection) destSection.style.display = '';

    var showHometown = !!(currentUser && hasDistinctHometown(currentUser));
    var homeParsed = showHometown ? parseHomeLocation(currentUser) : null;
    if (showHometown && !homeParsed) showHometown = false;

    var confirmed = getConfirmedTrips();
    var confirmedForCurrent = confirmed.find(function (t) { return t.windowStart === sel; });
    var selectedSlug = confirmedForCurrent && confirmedForCurrent.destination ? confirmedForCurrent.destination.slug : null;

    var hometownHtml = (showHometown && homeParsed)
      ? renderHometownCard(homeParsed, selectedSlug === HOMETOWN_SLUG)
      : '';
    if ((destSearchQuery || '').trim() || isPlanDestFilterActive()) hometownHtml = '';

    if (scoredDestinations.length === 0) {
      updatePlanDestFilterDestinationCount(0);
      if (!showHometown || !homeParsed) {
        grid.innerHTML = '<div class="plan-dest-loading" id="planDestLoading">Loading destinations…</div>';
        return;
      }
      grid.innerHTML = hometownHtml +
        '<div class="plan-dest-loading plan-dest-loading--inline" id="planDestLoading">Loading destinations…</div>';
      wirePlanDestCardClicks(sel);
      updatePlanDestFilterTriggerUI();
      return;
    }

    if (loading) loading.style.display = 'none';

    var confirmedSlugs = confirmed.map(function (t) { return t.destination && t.destination.slug; }).filter(Boolean);
    var filtered = scoredDestinations.filter(function (d) {
      if (d.visited) return false;
      return confirmedSlugs.indexOf(d.raw.slug) === -1 || d.raw.slug === selectedSlug;
    });
    if (destSearchQuery) {
      var dq = destSearchQuery.toLowerCase();
      filtered = filtered.filter(function (d) {
        var r = d.raw;
        var stateLine = formatStateDisplayName(r.state || '');
        var hayCats = collectDestinationCategoryStrings(r).join(' ');
        var hay = [r.name, stateLine, r._indiaRegion || '', hayCats, (r.alt_names || []).join(' '), destinationTravelFactsText(r)].join(' ').toLowerCase();
        return hay.indexOf(dq) !== -1;
      });
    }
    filtered = filtered.filter(destinationMatchesDestFilterForm);

    updatePlanDestFilterDestinationCount(filtered.length);

    if (filtered.length === 0) {
      grid.innerHTML = hometownHtml + renderPlanDestNoResultsHtml();
      updatePlanDestFilterTriggerUI();
      var clearBtn = document.getElementById('planDestClearSearchFilters');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          clearPlanDestSearchAndFilters();
        });
      }
      if (hometownHtml) wirePlanDestCardClicks(sel);
      return;
    }

    var toShow = filtered.slice(0, destVisibleCount);
    var moreCount = filtered.length - destVisibleCount;
    var html = hometownHtml + toShow.map(function (dest) {
      return renderDestCard(dest, selectedSlug === dest.raw.slug);
    }).join('');

    if (moreCount > 0) {
      html += '<button type="button" class="plan-explore-btn plan-explore-btn--card" id="planExploreMore" aria-label="Show more recommended destinations">' +
        '<span>Explore more</span>' +
        '<span class="material-symbols-outlined">arrow_forward</span></button>';
    }

    grid.innerHTML = html;
    updatePlanDestFilterTriggerUI();

    grid.querySelectorAll('.plan-dest-menu-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var card = btn.closest('.plan-dest-card');
        var menu = card && card.querySelector('.plan-dest-menu');
        if (!menu) return;
        var willOpen = !!menu.hidden;
        closeAllPlanMenus();
        menu.hidden = !willOpen;
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      });
    });

    grid.querySelectorAll('.plan-dest-menu-item[data-action="visit"]').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = item.getAttribute('data-slug');
        var dest = scoredDestinations.find(function (x) { return x.raw.slug === slug; });
        closeAllPlanMenus();
        if (!dest) return;
        setDestinationVisited(dest, true);
        refreshVisitedFlags();
        renderDestinations();
      });
    });

    grid.querySelectorAll('.plan-dest-fav').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = btn.getAttribute('data-slug');
        var dest = scoredDestinations.find(function (x) { return x.raw.slug === slug; });
        if (!dest) return;
        var favs = getPlanFavorites();
        var existIdx = favs.findIndex(function (f) { return f.destination && f.destination.slug === slug; });
        if (existIdx >= 0) {
          favs.splice(existIdx, 1);
          btn.classList.remove('plan-dest-fav--active');
          btn.querySelector('.material-symbols-outlined').textContent = 'favorite_border';
        } else {
          var w = allWindows.find(function (x) { return x.start === sel; });
          var imgUrl = resolveDestinationPhotoUrl(dest.raw);
          favs.push({
            windowStart: w ? w.start : '',
            windowEnd: w ? w.end : '',
            windowName: w ? w.name : '',
            windowType: w ? w.type : '',
            windowDays: w ? w.days : 0,
            leaves: w ? (w.leaves || 0) : 0,
            destination: {
              slug: dest.raw.slug,
              name: dest.raw.name,
              state: dest.raw.state,
              imageUrl: imgUrl,
              category: collectDestinationCategoryStrings(dest.raw).join(' · ') || (dest.raw.category || '')
            }
          });
          btn.classList.add('plan-dest-fav--active');
          btn.querySelector('.material-symbols-outlined').textContent = 'favorite';
        }
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
      });
    });

    wirePlanDestCardClicks(sel);

    var exploreBtn = document.getElementById('planExploreMore');
    if (exploreBtn) {
      exploreBtn.addEventListener('click', function () {
        destVisibleCount = filtered.length;
        renderDestinations();
      });
    }
  }

  function loadAndScoreDestinations(user) {
    var prefs = getTravelPrefs();
    var userCoords = getUserCoords(user);
    var availableDays = getAvailableDays();
    var sel = getPlanSelected();
    var tripMonth = null;
    if (sel) {
      var w = allWindows.find(function (x) { return x.start === sel; });
      if (w && w.start) {
        var parts = w.start.split('-');
        if (parts[0] && parts[1]) tripMonth = parseInt(parts[1], 10);
      }
    }
    if (!tripMonth) tripMonth = new Date().getMonth() + 1;

    var visitedList = getVisitedPlaces();
    scoredDestinations = allDestinations.filter(function (d) {
      return !isUserHomeCity(d, user) && destinationMatchesTravelModes(d, prefs.travelModes);
    }).map(function (d) {
      var result = scoreDestination(d, userCoords, prefs, availableDays, tripMonth, user);
      var tags = deriveTags(d, prefs.hasKidsUnder10, tripMonth);
      var richness = (d.ranking_signals && d.ranking_signals.content_richness_score) != null
        ? d.ranking_signals.content_richness_score
        : 0.3;
      return {
        raw: d,
        score: result.score,
        distance_km: result.distance_km,
        min_days: result.min_days,
        tags: tags,
        hasKids: prefs.hasKidsUnder10,
        isCouple: !prefs.hasKidsUnder10,
        content_richness: richness,
        visited: isDestinationVisited(d, visitedList)
      };
    }).filter(function (x) { return x.raw.name; }).sort(function (a, b) {
      if (a.visited !== b.visited) return a.visited ? 1 : -1;
      var diff = (b.score || 0) - (a.score || 0);
      if (diff !== 0) return diff;
      return (b.content_richness || 0) - (a.content_richness || 0);
    });

    destVisibleCount = INITIAL_DEST_COUNT;
    scheduleDestinationsReveal();
  }

  function fetchRecommendationData(user) {
    var configUrl = '../database/recommendation/config.json?t=' + Date.now();
    var scUrl = '../database/state-city/data.json';
    var registryUrl = '../database/india-states-uts.json';

    Promise.all([
      fetch(configUrl, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
      fetch(scUrl).then(function (r) { return r.ok ? r.json() : { states: [] }; }).catch(function () { return { states: [] }; }),
      fetch(registryUrl).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (pack) {
      recConfig = pack[0] || {};
      stateCityData = pack[1] || { states: [] };
      invalidateStateCentroidCache();
      var registry = pack[2];
      var jurisdictions = (registry && registry.jurisdictions) || [];
      setPlanDestFilterJurisdictions(jurisdictions);
      var metaByState = {};
      jurisdictions.forEach(function (j) {
        if (j && j.name) metaByState[j.name.toLowerCase()] = { region: j.region, stateCode: j.stateCode, holidayJsonSlug: j.holidayJsonSlug };
      });
      var destUrls = jurisdictions.map(function (j) {
        return '../database/destinations/in/' + String(j.name).replace(/ /g, '_') + '.json';
      });
      return Promise.all(destUrls.map(function (u) {
        return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      })).then(function (destResults) {
        allDestinations = [];
        destResults.forEach(function (data) {
          if (!data || !data.destinations || !Array.isArray(data.destinations)) return;
          data.destinations.forEach(function (d) {
            if (!d.name || !d.slug) return;
            var meta = metaByState[stateMetaLookupKey(d.state)];
            if (meta) {
              d._indiaRegion = meta.region;
              d._stateCode = meta.stateCode;
            }
            allDestinations.push(d);
          });
        });
        loadAndScoreDestinations(user);
      });
    }).catch(function () {
      var loading = document.getElementById('planDestLoading');
      if (loading) loading.textContent = 'Could not load destinations. Try opening via a local server (e.g. npx serve).';
    });
  }

  function init() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { window.location.href = '../index.html'; return; }
    var user = JSON.parse(raw);
    if (!user.name && !user.workLocation) { window.location.href = '../index.html'; return; }
    currentUser = user;
    allWindows = buildAllWindows();
    syncConfirmedTripsToWindows();
    var sel = getPlanSelected();
    if (!sel && allWindows.length) {
      setPlanSelected(allWindows[0].start);
    }
    if (sel && !allWindows.some(function (w) { return w.start === sel; })) {
      localStorage.removeItem(PLAN_SELECTED_KEY);
    }
    updateUI();
    wireFilterPills();
    wireProgressHint();
    wireDestSearch();
    wirePlanDestFilter();
    if (allWindows.length) {
      fetchRecommendationData(user);
    } else {
      renderDestinations();
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest('.plan-dest-menu') || e.target.closest('.plan-dest-menu-btn')) return;
      closeAllPlanMenus();
    });

    var toastClose = document.getElementById('planToastClose');
    if (toastClose) toastClose.addEventListener('click', hidePlanToast);
    var toastCta = document.getElementById('planToastCta');
    if (toastCta) toastCta.addEventListener('click', hidePlanToast);

    window.addEventListener('planPrefsDone', function () {
      if (currentUser && allDestinations.length) loadAndScoreDestinations(currentUser);
    });

    window.addEventListener('storage', function (e) {
      if ((e.key === TRAVEL_PREFS_KEY || e.key === VISITED_PLACES_KEY) && currentUser && allDestinations.length) {
        loadAndScoreDestinations(currentUser);
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        allWindows = buildAllWindows();
        syncConfirmedTripsToWindows();
        updateUI();
        if (currentUser && allDestinations.length) loadAndScoreDestinations(currentUser);
      }
    });
  }

  init();
})();
