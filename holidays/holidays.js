(function () {
  'use strict';

  /* ─── Constants ─────────────────────────────────────── */
  var STORAGE_KEY = 'holidayHacker_user';
  var CAL_DONE_KEY = 'holidayHacker_calSetup';
  var DB_BASE     = '../database/holiday';   // relative to /holidays/
  var SC_JSON     = '../database/state-city/data.json';

  /* ─── DOM refs ───────────────────────────────────────── */
  var content       = document.getElementById('timelineContent');
  var scroll        = document.getElementById('timelineScroll');
  var btnLocation   = document.getElementById('btnLocation');
  var locationLabel = document.getElementById('locationLabel');
  var locationChevron = document.getElementById('locationChevron');
  var locationDropdown = document.getElementById('locationDropdown');
  var locOptWork    = document.getElementById('locOptWork');
  var locOptHome    = document.getElementById('locOptHome');
  var locOptMerge   = document.getElementById('locOptMerge');
  var locWorkVal    = document.getElementById('locWorkVal');
  var locHomeVal    = document.getElementById('locHomeVal');
  var locWorkCheck  = document.getElementById('locWorkCheck');
  var locHomeCheck  = document.getElementById('locHomeCheck');
  var locMergeCheck    = document.getElementById('locMergeCheck');
  var locOptPersonal   = document.getElementById('locOptPersonal');
  var locPersonalCheck = document.getElementById('locPersonalCheck');
  var progressFill  = document.getElementById('progressFill');
  var progressLabel = document.getElementById('progressLabel');

  var OVERRIDES_KEY = 'holidayHacker_overrides';
  var CUSTOM_KEY    = 'holidayHacker_custom';
  /* ─── DOM refs (edit) ──────────────────────────────────── */
  var btnFab         = document.getElementById('btnFab');
  var fabMenu        = document.getElementById('fabMenu');
  var fabEditExisting = document.getElementById('fabEditExisting');
  var editOverlay    = document.getElementById('editOverlay');
  var editPopup      = document.getElementById('editPopup');
  var editPopupClose = document.getElementById('editPopupClose');
  var editName       = document.getElementById('editName');
  var editDateBadge  = document.getElementById('editDateBadge');
  var editMonthCol   = document.getElementById('editMonthCol');
  var editDayCol     = document.getElementById('editDayCol');
  var editCategory   = document.getElementById('editCategory');
  var editCatIcon    = document.getElementById('editCatIcon');
  var editSaveBtn    = document.getElementById('editSaveBtn');
  var editCatSection = document.getElementById('editCatSection');
  var editCustomKindSection = document.getElementById('editCustomKindSection');
  var editCustomKind = document.getElementById('editCustomKind');
  var editCustomKindIcon = document.getElementById('editCustomKindIcon');
  var editPopupTitle = document.querySelector('.edit-popup-header h1');
  var editDeleteBtn  = document.getElementById('editDeleteBtn');
  var fabAddCustom   = document.getElementById('fabAddCustom');

  /* ─── State ──────────────────────────────────────────── */
  var user       = {};
  var stateData  = { states: [] };
  var activeCtx  = 'merged'; // 'work' | 'home' | 'merged'
  var editMode   = false;
  var popupMode  = 'edit'; // 'edit' | 'add'
  var editingHoliday = null; // { origDate, name, date, ctx }

  /* ─── Helpers ─────────────────────────────────────────── */

  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function fmtDate(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()].slice(0,3) + ' ' + d.getDate();
  }

  function monthKey(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function monthSortKey(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    return d.getFullYear() * 100 + d.getMonth();
  }

  function today() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function isPast(isoDate) {
    return new Date(isoDate + 'T00:00:00') < today();
  }

  function isToday(isoDate) {
    var t = today();
    var d = new Date(isoDate + 'T00:00:00');
    return d.getTime() === t.getTime();
  }

  /* ─── State code lookup ──────────────────────────────── */

  function stateCodeFromLocation(locationStr) {
    if (!locationStr) return null;
    // locationStr: "Bengaluru, Karnataka" or "Karnataka"
    var parts = locationStr.split(',');
    var stateName = parts[parts.length - 1].trim().toLowerCase();
    for (var i = 0; i < stateData.states.length; i++) {
      if (stateData.states[i].name.toLowerCase() === stateName) {
        return stateData.states[i].code; // e.g. "IN-KA"
      }
    }
    return null;
  }

  function stateNameFromLocation(locationStr) {
    if (!locationStr) return locationStr;
    var parts = locationStr.split(',');
    return parts[parts.length - 1].trim();
  }

  /* ─── Year range needed ──────────────────────────────── */

  function yearsNeeded() {
    var now   = new Date();
    var start = now.getFullYear();
    var end   = new Date(now.getFullYear(), now.getMonth() + 13, 1); // 13 months out
    var years = [];
    for (var y = start; y <= end.getFullYear(); y++) years.push(y);
    return years;
  }

  /* ─── Fetch one holiday file, graceful 404 ───────────── */

  function fetchHolidays(stateCode, year) {
    var url = DB_BASE + '/' + year + '/in/' + stateCode.toLowerCase() + '.json';
    return fetch(url).then(function (r) {
      if (!r.ok) return [];
      return r.json().then(function (d) { return d.holidays || []; });
    }).catch(function () { return []; });
  }

  /* ─── Merge two holiday lists, work-city wins on same date ── */

  function mergeHolidays(workList, homeList, workStateName, homeStateName) {
    var byDate = {};
    workList.filter(function (h) { return h.type === 'gazetted'; }).forEach(function (h) {
      byDate[h.date] = { name: h.name, date: h.date, type: h.type,
                         _ctx: 'work', _stateName: workStateName };
    });
    homeList.filter(function (h) { return h.type === 'gazetted'; }).forEach(function (h) {
      if (!byDate[h.date]) {
        byDate[h.date] = { name: h.name, date: h.date, type: h.type,
                           _ctx: 'home', _stateName: homeStateName };
      }
    });
    var result = [];
    Object.keys(byDate).forEach(function (d) { result.push(byDate[d]); });
    return result;
  }

  /* ─── Local overrides (per-holiday edits stored in browser) ── */

  function getOverrides() {
    try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function saveOverride(origDate, patch) {
    var ov = getOverrides();
    ov[origDate] = patch;
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(ov));
  }

  function applyOverrides(holidays) {
    var ov = getOverrides();
    if (!Object.keys(ov).length) return holidays;

    return holidays.map(function (h) {
      var origDate = h._origDate || h.date;
      var patch = ov[origDate];
      if (patch) {
        if (patch._hidden) return null;
        return {
          name: patch.name  || h.name,
          date: patch.date  || h.date,
          type: h.type,
          _ctx: patch.ctx   || h._ctx,
          _stateName: h._stateName,
          _origDate: origDate,
          _edited: true
        };
      }
      return h;
    }).filter(function (h) { return h !== null; });
  }

  /* ─── Custom (personal) holidays stored locally ─────── */

  function getCustomHolidays() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveCustomHoliday(entry) {
    var list = getCustomHolidays();
    entry.id = 'custom_' + Date.now();
    list.push(entry);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  }

  function updateCustomHoliday(origId, patch) {
    var list = getCustomHolidays();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === origId) {
        list[i].name = patch.name || list[i].name;
        list[i].date = patch.date || list[i].date;
        if (patch.kind === 'holiday' || patch.kind === 'leave') list[i].kind = patch.kind;
        break;
      }
    }
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  }

  function deleteCustomHoliday(id) {
    var list = getCustomHolidays();
    list = list.filter(function (c) { return c.id !== id; });
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  }

  function deleteOverride(origDate) {
    var ov = getOverrides();
    ov[origDate] = ov[origDate] || {};
    ov[origDate]._hidden = true;
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(ov));
  }

  function normalizeCustomKind(c) {
    return (c && c.kind === 'leave') ? 'leave' : 'holiday';
  }

  function injectCustomHolidays(holidays) {
    var customs = getCustomHolidays();
    customs.forEach(function (c) {
      var kind = normalizeCustomKind(c);
      holidays.push({
        name: c.name,
        date: c.date,
        type: 'gazetted',
        _ctx: 'personal',
        _stateName: kind === 'leave' ? 'Personal leave' : 'Personal',
        _customId: c.id,
        _customKind: kind
      });
    });
    return holidays;
  }

  function hasCustomHolidays() {
    return getCustomHolidays().length > 0;
  }

  /* ─── Load all holidays for a state across years ─────── */

  function loadAllHolidays(stateCode) {
    var years = yearsNeeded();
    var promises = years.map(function (y) { return fetchHolidays(stateCode, y); });
    return Promise.all(promises).then(function (results) {
      var all = [];
      results.forEach(function (arr) { all = all.concat(arr); });
      return all;
    });
  }

  /* ─── Render timeline ────────────────────────────────── */

  function buildCard(h, stateDisplayName, ctx) {
    /* In merged mode each holiday carries its own _ctx / _stateName */
    ctx             = h._ctx        || ctx;
    stateDisplayName = h._stateName || stateDisplayName;

    var isHome     = ctx === 'home';
    var isPersonal = ctx === 'personal';
    var past    = isPast(h.date);
    var today_  = isToday(h.date);
    var dateStr = fmtDate(h.date);
    var pastCls   = past    ? ' holiday-card-wrap--past'  : '';
    var todayCls  = today_  ? ' holiday-card-wrap--today' : '';
    var ctxCls    = isPersonal ? ' holiday-card-wrap--personal' :
                    isHome     ? ' holiday-card-wrap--home'     : ' holiday-card-wrap--work';
    var cardCls   = isPersonal ? 'holiday-card--orange' :
                    isHome     ? 'holiday-card--green'  : 'holiday-card--blue';
    var badgeCls  = isPersonal ? 'holiday-card-badge--orange' :
                    isHome     ? 'holiday-card-badge--green'  : 'holiday-card-badge--blue';
    var icon      = isPersonal ? 'person'  :
                    isHome     ? 'home'    : 'apartment';
    var personalSub = isPersonal
      ? (h._customKind === 'leave' ? 'Leave' : 'Holiday')
      : 'Public Holiday';
    var personalDesc = isPersonal
      ? (h._customKind === 'leave' ? 'Leave' : 'Holiday')
      : 'Public Holiday';

    var origDate = h._origDate || h.date;
    var customId = h._customId || '';
    return '<div class="holiday-card-wrap' + pastCls + ctxCls + todayCls + '" data-holiday-card' +
      ' data-h-orig="' + origDate + '" data-h-date="' + h.date + '" data-h-name="' + h.name.replace(/"/g, '&quot;') + '" data-h-ctx="' + ctx + '"' +
      (customId ? ' data-h-custom="' + customId + '"' : '') + '>' +
      '<div class="holiday-card-dot" aria-hidden="true"></div>' +
      '<article class="holiday-card ' + cardCls + '">' +

      /* Collapsed */
      '<div class="holiday-card-collapsed">' +
        '<div class="holiday-card-inner">' +
          '<div class="holiday-card-body">' +
            '<div class="holiday-card-headline">' +
              '<span class="material-symbols-outlined holiday-card-headline-icon">' + icon + '</span>' +
              '<span class="holiday-card-date-inline">' + dateStr + '</span>' +
              (today_ ? '<span class="holiday-today-pill">Today</span>' : '') +
            '</div>' +
            '<h2 class="holiday-card-title-sm">' + h.name + '</h2>' +
            '<p class="holiday-card-subtitle">' + (isPersonal ? personalSub : 'Public Holiday') + '</p>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* Expanded */
      '<div class="holiday-card-expanded">' +
        '<div class="holiday-card-inner">' +
          '<div class="holiday-card-body">' +
            '<div class="holiday-card-top">' +
              '<span class="holiday-card-badge ' + badgeCls + '">' + stateDisplayName + '</span>' +
              '<span class="holiday-card-date">' +
                '<span class="material-symbols-outlined">event</span>' +
                dateStr +
              '</span>' +
            '</div>' +
            '<h2>' + h.name + '</h2>' +
            '<p class="holiday-card-desc">' + (isPersonal ? personalDesc : 'Public Holiday') + '</p>' +
            '<div class="holiday-card-actions">' +
              '<a class="holiday-see-calendar" href="../calendar/index.html?date=' + h.date + '">See on Calendar</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '</article></div>';
  }

  function renderHolidays(holidays, stateDisplayName, ctx) {
    /* Filter to gazetted only (merged lists are pre-filtered but singles still need this) */
    var gazetted = (holidays || []).filter(function (h) { return h.type === 'gazetted'; });

    /* Apply any user overrides */
    gazetted = applyOverrides(gazetted);

    /* Personal holidays only in combined and personal views */
    if (activeCtx === 'merged' || activeCtx === 'personal') {
      gazetted = injectCustomHolidays(gazetted);
    }

    if (!gazetted.length) {
      content.innerHTML = '<p class="timeline-empty">' +
        (activeCtx === 'personal' ? 'No personal holidays yet. Tap the edit button to add one.' : 'No gazetted holidays found.') +
        '</p>';
      return;
    }

    /* Sort chronologically */
    gazetted.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    /* Group by month — all months in natural order */
    var groups = {};
    var order  = [];
    gazetted.forEach(function (h) {
      var key = monthKey(h.date);
      if (!groups[key]) {
        groups[key] = [];
        order.push({ key: key, sort: monthSortKey(h.date) });
      }
      groups[key].push(h);
    });

    /* Build HTML: all months chronologically, no past/future split */
    var html = '';
    var scrollTargetId = null;
    var nowSort = monthSortKey(new Date().toISOString().slice(0, 10));
    var todayDate = today();

    order.forEach(function (o, idx) {
      var monthId = 'month-' + o.sort;
      /* First month >= current month becomes the scroll target */
      if (!scrollTargetId && o.sort >= nowSort) scrollTargetId = monthId;

      /* Fade the label if every day in this month is in the past */
      var sampleDate = new Date(groups[o.key][0].date + 'T00:00:00');
      var isMonthPast = (todayDate.getFullYear() > sampleDate.getFullYear()) ||
                        (todayDate.getFullYear() === sampleDate.getFullYear() &&
                         todayDate.getMonth()    > sampleDate.getMonth());
      var pastMonthCls = isMonthPast ? ' timeline-month--past' : '';

      html += '<div class="timeline-month' +
              (idx > 0 ? ' timeline-month--spaced' : '') + pastMonthCls +
              '" id="' + monthId + '"><h3>' + o.key + '</h3></div>';

      groups[o.key].forEach(function (h) { html += buildCard(h, stateDisplayName, ctx); });
    });

    content.innerHTML = html;

    /* Wire expand / collapse — or open edit popup in edit mode */
    content.querySelectorAll('[data-holiday-card]').forEach(function (wrap) {
      wrap.addEventListener('click', function (e) {
        if (e.target.closest('.holiday-see-calendar')) {
          e.stopPropagation();
          return;
        }

        if (editMode) {
          if (wrap.classList.contains('holiday-card-wrap--past')) return;
          openEditPopup(
            wrap.getAttribute('data-h-orig'),
            wrap.getAttribute('data-h-date'),
            wrap.getAttribute('data-h-name'),
            wrap.getAttribute('data-h-ctx'),
            wrap.getAttribute('data-h-custom')
          );
          return;
        }

        var expanded = wrap.classList.contains('is-expanded');
        content.querySelectorAll('[data-holiday-card]').forEach(function (w) {
          w.classList.remove('is-expanded');
        });
        if (!expanded) wrap.classList.add('is-expanded');
      });
    });

    if (editMode) applyEditableClass();

    /* Scroll so the current month appears at the top */
    if (scrollTargetId) {
      var target = document.getElementById(scrollTargetId);
      if (target) {
        setTimeout(function () {
          scroll.scrollTop = target.offsetTop - 8;
        }, 50);
      }
    }

    updateProgress();
  }

  /* ─── Progress ring ──────────────────────────────────── */

  function updateProgress() {
    var now   = new Date();
    var start = new Date(now.getFullYear(), 0, 1);
    var end   = new Date(now.getFullYear() + 1, 0, 1);
    var pct   = Math.round(((now - start) / (end - start)) * 100);
    var dash  = pct + ' 100';
    if (progressFill) progressFill.setAttribute('stroke-dasharray', dash);
    if (progressLabel) progressLabel.textContent = pct + '%';
  }

  /* ─── Location dropdown ──────────────────────────────── */

  function setActiveLocation(ctx) {
    activeCtx = ctx;
    var isMerged   = ctx === 'merged';
    var isWork     = ctx === 'work';
    var isHome     = ctx === 'home';
    var isPersonal = ctx === 'personal';

    locWorkCheck.style.visibility     = isWork     ? 'visible' : 'hidden';
    locHomeCheck.style.visibility     = isHome     ? 'visible' : 'hidden';
    locMergeCheck.style.visibility    = isMerged   ? 'visible' : 'hidden';
    locPersonalCheck.style.visibility = isPersonal ? 'visible' : 'hidden';

    locationDropdown.hidden = true;
    locationChevron.textContent = 'expand_more';

    content.innerHTML = '<div class="timeline-loading"><span class="material-symbols-outlined">hourglass_top</span><p>Loading holidays…</p></div>';

    /* Personal-only view: just custom holidays, no fetching */
    if (isPersonal) {
      locationLabel.textContent = 'Personal';
      renderHolidays([], 'Personal', 'personal');
      return;
    }

    if (isMerged) {
      locationLabel.textContent = 'Combined';

      var workCode  = stateCodeFromLocation(user.workLocation);
      var homeCode  = stateCodeFromLocation(user.homeLocation || user.workLocation);
      var workSN    = stateNameFromLocation(user.workLocation)  || user.workLocation  || '–';
      var homeSN    = stateNameFromLocation(user.homeLocation)  || user.homeLocation  || workSN;

      /* If same state, treat as a single load to avoid duplicate fetches */
      var homePromise = (homeCode && homeCode !== workCode)
        ? loadAllHolidays(homeCode)
        : Promise.resolve([]);

      Promise.all([
        workCode ? loadAllHolidays(workCode) : Promise.resolve([]),
        homePromise
      ]).then(function (results) {
        var merged = mergeHolidays(results[0], results[1], workSN, homeSN);
        renderHolidays(merged, workSN, 'merged');
      });
    } else {
      var display   = isWork ? user.workLocation : user.homeLocation;
      var stateCode = stateCodeFromLocation(display);
      var stateName = stateNameFromLocation(display) || display;

      locationLabel.textContent = display ? display.split(',')[0] : '–';

      if (!stateCode) {
        content.innerHTML = '<p class="timeline-empty">Could not resolve state for "' + display + '". Check your profile.</p>';
        return;
      }

      loadAllHolidays(stateCode).then(function (holidays) {
        renderHolidays(holidays, stateName, ctx);
      });
    }
  }

  function setupLocationDropdown() {
    var sameLocation = user.workLocation && user.homeLocation &&
        user.workLocation.toLowerCase() === user.homeLocation.toLowerCase();

    if (sameLocation) {
      locationChevron.style.display = 'none';
      btnLocation.style.pointerEvents = 'none';
      locationDropdown.hidden = true;
      return;
    }

    btnLocation.addEventListener('click', function (e) {
      e.stopPropagation();
      var hidden = locationDropdown.hidden;
      locationDropdown.hidden = !hidden;
      locationChevron.textContent = hidden ? 'expand_less' : 'expand_more';
    });

    document.addEventListener('click', function () {
      locationDropdown.hidden = true;
      locationChevron.textContent = 'expand_more';
    });

    locOptWork.addEventListener('click', function (e) {
      e.stopPropagation();
      setActiveLocation('work');
    });

    locOptHome.addEventListener('click', function (e) {
      e.stopPropagation();
      setActiveLocation('home');
    });

    locOptMerge.addEventListener('click', function (e) {
      e.stopPropagation();
      setActiveLocation('merged');
    });

    locOptPersonal.addEventListener('click', function (e) {
      e.stopPropagation();
      setActiveLocation('personal');
    });

    /* Show personal option only if custom holidays exist */
    updatePersonalOptionVisibility();
  }

  function updatePersonalOptionVisibility() {
    locOptPersonal.style.display = hasCustomHolidays() ? '' : 'none';
  }

  /* ─── FAB menu ──────────────────────────────────────── */

  btnFab.addEventListener('click', function (e) {
    e.stopPropagation();
    if (editMode) {
      exitEditMode();
      return;
    }
    fabMenu.classList.toggle('is-open');
  });

  document.addEventListener('click', function () { fabMenu.classList.remove('is-open'); });

  fabEditExisting.addEventListener('click', function (e) {
    e.stopPropagation();
    fabMenu.classList.remove('is-open');
    enterEditMode();
  });

  fabAddCustom.addEventListener('click', function (e) {
    e.stopPropagation();
    fabMenu.classList.remove('is-open');
    openAddCustomPopup();
  });

  /* ─── Edit mode ─────────────────────────────────────── */

  function enterEditMode() {
    editMode = true;
    btnFab.querySelector('.material-symbols-outlined').textContent = 'close';
    btnFab.classList.add('btn-fab--active');
    applyEditableClass();
  }

  function exitEditMode() {
    editMode = false;
    btnFab.querySelector('.material-symbols-outlined').textContent = 'edit';
    btnFab.classList.remove('btn-fab--active');
    content.querySelectorAll('.holiday-card-wrap--editable').forEach(function (w) {
      w.classList.remove('holiday-card-wrap--editable');
    });
  }

  function applyEditableClass() {
    content.querySelectorAll('[data-holiday-card]').forEach(function (w) {
      if (!w.classList.contains('holiday-card-wrap--past')) {
        w.classList.add('holiday-card-wrap--editable');
      }
    });
  }

  /* ─── Edit popup ─────────────────────────────────────── */

  var pickerMonthIdx = 0;
  var pickerDay      = 1;
  var pickerYear     = new Date().getFullYear();
  var pickerMinDay   = 1;

  function syncCustomKindIcon() {
    if (!editCustomKindIcon || !editCustomKind) return;
    editCustomKindIcon.textContent = editCustomKind.value === 'leave' ? 'event_busy' : 'event';
  }

  function openEditPopup(origDate, date, name, ctx, customId) {
    popupMode = 'edit';
    editingHoliday = { origDate: origDate, name: name, ctx: ctx || 'work', customId: customId || null };

    var isPersonal = ctx === 'personal';
    editPopupTitle.textContent = isPersonal ? 'Edit personal day' : 'Edit Holiday';
    editName.value = name;
    editDeleteBtn.style.display = '';

    /* Hide category for personal holidays */
    editCatSection.style.display = isPersonal ? 'none' : '';
    if (!isPersonal) {
      editCategory.value = ctx === 'home' ? 'home' : 'work';
      updateCatIcon();
    }

    if (isPersonal && customId && editCustomKindSection && editCustomKind) {
      editCustomKindSection.style.display = '';
      var found = getCustomHolidays().find(function (x) { return x.id === customId; });
      editCustomKind.value = (found && found.kind === 'leave') ? 'leave' : 'holiday';
      syncCustomKindIcon();
    } else if (editCustomKindSection) {
      editCustomKindSection.style.display = 'none';
    }

    buildDatePicker(date);
    editOverlay.classList.add('is-open');
  }

  function openAddCustomPopup() {
    popupMode = 'add';
    editingHoliday = null;

    editPopupTitle.textContent = 'Add personal day';
    editName.value = '';
    editDeleteBtn.style.display = 'none';

    /* Hide category — always personal */
    editCatSection.style.display = 'none';
    if (editCustomKindSection && editCustomKind) {
      editCustomKindSection.style.display = '';
      editCustomKind.value = 'holiday';
      syncCustomKindIcon();
    }

    var todayISO = new Date().toISOString().slice(0, 10);
    buildDatePicker(todayISO);
    editOverlay.classList.add('is-open');
  }

  function closeEditPopup() {
    editOverlay.classList.remove('is-open');
    editingHoliday = null;
  }

  editPopupClose.addEventListener('click', closeEditPopup);
  editOverlay.addEventListener('click', function (e) {
    if (e.target === editOverlay) closeEditPopup();
  });

  editDeleteBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!editingHoliday) return;
    var name = editingHoliday.name || 'this holiday';
    if (!confirm('Delete "' + name + '"?\nThis action cannot be undone.')) return;

    if (editingHoliday.customId) {
      deleteCustomHoliday(editingHoliday.customId);
    } else {
      deleteOverride(editingHoliday.origDate);
    }

    closeEditPopup();
    updatePersonalOptionVisibility();
    setActiveLocation(activeCtx);
  });

  /* Category dropdown icon sync */
  function updateCatIcon() {
    var isHome = editCategory.value === 'home';
    editCatIcon.textContent = isHome ? 'home' : 'apartment';
    editCatIcon.classList.toggle('is-home', isHome);
  }
  editCategory.addEventListener('change', updateCatIcon);
  if (editCustomKind) editCustomKind.addEventListener('change', syncCustomKindIcon);

  /* ─── Scroll date picker ─────────────────────────────── */

  function makePadCell() {
    var p = document.createElement('div');
    p.className = 'edit-date-cell edit-date-cell--pad';
    p.innerHTML = '&nbsp;';
    return p;
  }

  function daysInMonth(month, year) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getMinDay(month, year) {
    if (popupMode !== 'add') return 1;
    var now = new Date();
    if (year === now.getFullYear() && month === now.getMonth()) {
      return now.getDate();
    }
    return 1;
  }

  function rebuildDayColumn(maxDay, minDay) {
    pickerMinDay = minDay || 1;
    var newDC = editDayCol.cloneNode(false);
    editDayCol.parentNode.replaceChild(newDC, editDayCol);
    editDayCol = newDC;

    newDC.appendChild(makePadCell());
    newDC.appendChild(makePadCell());
    for (var dn = pickerMinDay; dn <= maxDay; dn++) {
      var dayEl = document.createElement('div');
      dayEl.className = 'edit-date-cell';
      dayEl.textContent = dn;
      dayEl.setAttribute('data-day', dn);
      newDC.appendChild(dayEl);
    }
    newDC.appendChild(makePadCell());
    newDC.appendChild(makePadCell());

    newDC.addEventListener('scroll', onDayScroll);
    return newDC;
  }

  function buildDatePicker(isoDate) {
    var d   = new Date(isoDate + 'T00:00:00');
    var now = new Date();

    pickerMonthIdx = d.getMonth();
    pickerDay      = d.getDate();
    pickerYear     = d.getFullYear();

    /* Remove old listeners by replacing month column */
    var newMC = editMonthCol.cloneNode(false);
    editMonthCol.parentNode.replaceChild(newMC, editMonthCol);
    editMonthCol = newMC;

    /* Month column: from current month up to 12 months ahead */
    var startM = now.getMonth();
    var startY = now.getFullYear();

    newMC.appendChild(makePadCell());
    newMC.appendChild(makePadCell());
    for (var i = 0; i < 13; i++) {
      var mi = (startM + i) % 12;
      var yr = startY + Math.floor((startM + i) / 12);
      var el = document.createElement('div');
      el.className = 'edit-date-cell';
      el.textContent = MONTHS[mi].slice(0, 3) + ' ' + yr;
      el.setAttribute('data-mi', mi);
      el.setAttribute('data-yr', yr);
      newMC.appendChild(el);
    }
    newMC.appendChild(makePadCell());
    newMC.appendChild(makePadCell());

    /* Day column: only valid days for the initial month */
    var maxDay = daysInMonth(pickerMonthIdx, pickerYear);
    var minDay = getMinDay(pickerMonthIdx, pickerYear);
    if (pickerDay > maxDay) pickerDay = maxDay;
    if (pickerDay < minDay) pickerDay = minDay;
    rebuildDayColumn(maxDay, minDay);

    /* Scroll to initial values after DOM settles */
    setTimeout(function () {
      scrollToMonthIdx(pickerMonthIdx, pickerYear, false);
      scrollToDayIdx(pickerDay, false);
      updatePickerHighlights();
      updateDateBadge();
    }, 60);

    newMC.addEventListener('scroll', onMonthScroll);
  }

  function scrollToMonthIdx(m, y, smooth) {
    var cells = editMonthCol.querySelectorAll('[data-mi]');
    for (var i = 0; i < cells.length; i++) {
      if (parseInt(cells[i].getAttribute('data-mi')) === m &&
          parseInt(cells[i].getAttribute('data-yr')) === y) {
        editMonthCol.scrollTo({ top: cells[i].offsetTop - editMonthCol.offsetTop - (editMonthCol.clientHeight / 2) + 20, behavior: smooth ? 'smooth' : 'auto' });
        break;
      }
    }
  }

  function scrollToDayIdx(d, smooth) {
    var cells = editDayCol.querySelectorAll('[data-day]');
    for (var i = 0; i < cells.length; i++) {
      if (parseInt(cells[i].getAttribute('data-day')) === d) {
        editDayCol.scrollTo({ top: cells[i].offsetTop - editDayCol.offsetTop - (editDayCol.clientHeight / 2) + 20, behavior: smooth ? 'smooth' : 'auto' });
        break;
      }
    }
  }

  function getSnappedCell(col, attr) {
    var cells = col.querySelectorAll('[' + attr + ']');
    var center = col.scrollTop + col.clientHeight / 2;
    var best = null, bestDist = Infinity;
    for (var i = 0; i < cells.length; i++) {
      var mid = cells[i].offsetTop - col.offsetTop + cells[i].offsetHeight / 2;
      var dist = Math.abs(mid - center);
      if (dist < bestDist) { bestDist = dist; best = cells[i]; }
    }
    return best;
  }

  var monthScrollTimer = null;
  var prevMaxDay = 31;
  var prevMinDay = 1;
  function onMonthScroll() {
    clearTimeout(monthScrollTimer);
    monthScrollTimer = setTimeout(function () {
      var cell = getSnappedCell(editMonthCol, 'data-mi');
      if (cell) {
        pickerMonthIdx = parseInt(cell.getAttribute('data-mi'));
        pickerYear     = parseInt(cell.getAttribute('data-yr'));
        var maxDay = daysInMonth(pickerMonthIdx, pickerYear);
        var minDay = getMinDay(pickerMonthIdx, pickerYear);
        if (maxDay !== prevMaxDay || minDay !== prevMinDay) {
          if (pickerDay > maxDay) pickerDay = maxDay;
          if (pickerDay < minDay) pickerDay = minDay;
          rebuildDayColumn(maxDay, minDay);
          prevMaxDay = maxDay;
          prevMinDay = minDay;
          setTimeout(function () { scrollToDayIdx(pickerDay, false); }, 20);
        }
        updatePickerHighlights();
        updateDateBadge();
      }
    }, 80);
  }

  var dayScrollTimer = null;
  function onDayScroll() {
    clearTimeout(dayScrollTimer);
    dayScrollTimer = setTimeout(function () {
      var cell = getSnappedCell(editDayCol, 'data-day');
      if (cell) {
        pickerDay = parseInt(cell.getAttribute('data-day'));
        updatePickerHighlights();
        updateDateBadge();
      }
    }, 80);
  }

  function updatePickerHighlights() {
    editMonthCol.querySelectorAll('[data-mi]').forEach(function (c) {
      var isActive = parseInt(c.getAttribute('data-mi')) === pickerMonthIdx &&
                     parseInt(c.getAttribute('data-yr')) === pickerYear;
      c.classList.toggle('edit-date-cell--active', isActive);
    });
    editDayCol.querySelectorAll('[data-day]').forEach(function (c) {
      c.classList.toggle('edit-date-cell--active', parseInt(c.getAttribute('data-day')) === pickerDay);
    });
  }

  function updateDateBadge() {
    editDateBadge.textContent = MONTHS[pickerMonthIdx].slice(0, 3) + ' ' + pickerDay + ', ' + pickerYear;
  }

  function pickerISODate() {
    var m = String(pickerMonthIdx + 1).padStart(2, '0');
    var d = String(pickerDay).padStart(2, '0');
    return pickerYear + '-' + m + '-' + d;
  }

  /* ─── Save edit ─────────────────────────────────────── */

  /* ───────── Confirmation modal: "your edit overlaps a confirmed trip" ─────────
   * Wired against the markup at #holidayShiftModal in holidays/index.html. We
   * show it when the user changed a gazetted holiday's date AND at least one
   * confirmed trip's window covers that date. The shared helper in
   * /holiday-shift.js does the actual work — this is just the UI gate. */
  var shiftModal       = document.getElementById('holidayShiftModal');
  var shiftModalBody   = document.getElementById('holidayShiftBody');
  var shiftModalList   = document.getElementById('holidayShiftList');
  var shiftConfirmBtn  = document.getElementById('holidayShiftConfirmBtn');
  var pendingShiftCtx  = null;

  function fmtShortIso(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
  }

  function openShiftModal(ctx) {
    if (!shiftModal) return;
    pendingShiftCtx = ctx;
    var trips = ctx.affectedTrips || [];
    var delta = ctx.deltaDays;
    var deltaLabel = (delta > 0 ? '+' : '') + delta + ' day' + (Math.abs(delta) !== 1 ? 's' : '');
    if (shiftModalBody) {
      shiftModalBody.innerHTML =
        'You changed <strong>' + (ctx.holidayName || 'this holiday').replace(/</g, '&lt;') + '</strong> from ' +
        '<strong>' + fmtShortIso(ctx.origDate) + '</strong> to <strong>' + fmtShortIso(ctx.newDate) + '</strong> ' +
        '(' + deltaLabel + ').<br/>This overlaps ' + trips.length + ' confirmed trip' +
        (trips.length === 1 ? '' : 's') + '. Should we shift the trip dates and refresh the reminders to match?';
    }
    if (shiftModalList) {
      shiftModalList.innerHTML = trips.map(function (t) {
        var name = ((t.destination && t.destination.name) || 'Trip').replace(/</g, '&lt;');
        var oldRange = fmtShortIso(t.windowStart) + ' – ' + fmtShortIso(t.windowEnd || t.windowStart);
        return '<li><strong>' + name + '</strong> · ' + oldRange + '</li>';
      }).join('');
    }
    shiftModal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeShiftModal() {
    if (!shiftModal) return;
    shiftModal.setAttribute('hidden', '');
    document.body.style.overflow = '';
    pendingShiftCtx = null;
  }

  function applyOverrideFromCtx(ctx) {
    saveOverride(ctx.origDate, { name: ctx.newName, date: ctx.newDate, ctx: ctx.newCtx });
    closeEditPopup();
    updatePersonalOptionVisibility();
    setActiveLocation(activeCtx);
  }

  if (shiftModal) {
    shiftModal.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-shift-cancel') === '1') {
        /* "Keep trip dates" — apply the override but leave trips alone. */
        var ctx = pendingShiftCtx;
        closeShiftModal();
        if (ctx) applyOverrideFromCtx(ctx);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (shiftModal.hasAttribute('hidden')) return;
      if (e.key === 'Escape') {
        var ctx = pendingShiftCtx;
        closeShiftModal();
        if (ctx) applyOverrideFromCtx(ctx);
      }
    });
  }
  if (shiftConfirmBtn) {
    shiftConfirmBtn.addEventListener('click', function () {
      var ctx = pendingShiftCtx;
      if (!ctx) { closeShiftModal(); return; }
      var shifter = window.HolidayHacker && window.HolidayHacker.shiftConfirmedTripsByHolidayEdit;
      if (typeof shifter === 'function') {
        try { shifter(ctx.origDate, ctx.newDate); } catch (_) {}
      }
      closeShiftModal();
      applyOverrideFromCtx(ctx);
    });
  }

  editSaveBtn.addEventListener('click', function () {
    var newName = editName.value.trim();
    if (!newName) { editName.focus(); return; }

    var newDate = pickerISODate();

    if (popupMode === 'add') {
      var addKind = (editCustomKind && editCustomKind.value === 'leave') ? 'leave' : 'holiday';
      saveCustomHoliday({ name: newName, date: newDate, kind: addKind });
    } else {
      if (!editingHoliday) return;
      if (editingHoliday.customId) {
        var editKind = (editCustomKind && editCustomKind.value === 'leave') ? 'leave' : 'holiday';
        updateCustomHoliday(editingHoliday.customId, { name: newName, date: newDate, kind: editKind });
      } else {
        var origDate = editingHoliday.origDate;
        var dateChanged = origDate && newDate && origDate !== newDate;
        /* If the user actually moved a gazetted holiday's date AND any of
           their confirmed trips covers the old date, ask whether to slide
           the trip + reminders by the same delta. Otherwise just save the
           override straight away (the old flow). */
        var finder = window.HolidayHacker && window.HolidayHacker.findConfirmedTripsCoveringDate;
        var affected = dateChanged && typeof finder === 'function' ? finder(origDate) : [];
        if (affected && affected.length) {
          openShiftModal({
            origDate: origDate,
            newDate: newDate,
            newName: newName,
            newCtx: editCategory.value,
            holidayName: editingHoliday.name || newName,
            deltaDays: (function () {
              var a = new Date(origDate + 'T00:00:00').getTime();
              var b = new Date(newDate + 'T00:00:00').getTime();
              return Math.round((b - a) / 86400000);
            })(),
            affectedTrips: affected
          });
          return;
        }
        saveOverride(origDate, {
          name: newName,
          date: newDate,
          ctx:  editCategory.value
        });
      }
    }

    closeEditPopup();
    updatePersonalOptionVisibility();
    setActiveLocation(activeCtx);
  });

  /* ─── Bootstrap ──────────────────────────────────────── */

  function init() {
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

    var work = user.workLocation || '';
    var home = user.homeLocation || work;

    locWorkVal.textContent = work || '–';
    locHomeVal.textContent = home || '–';

    var sameLocation = work.toLowerCase() === home.toLowerCase();
    var defaultCtx = sameLocation ? 'work' : 'merged';

    /* Load state-city data for code mapping, then start */
    fetch(SC_JSON)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        stateData = d;
        setupLocationDropdown();
        setActiveLocation(defaultCtx);
      })
      .catch(function () {
        setupLocationDropdown();
        setActiveLocation(defaultCtx);
      });
  }

  init();
})();
