(function () {
  'use strict';

  var STORAGE_KEY = 'holidayHacker_user';
  var CAL_DONE_KEY = 'holidayHacker_calSetup';
  var TRAVEL_PREFS_KEY = 'holidayHacker_travelPreferences';
  var CONFIRMED_TRIPS_KEY = 'holidayHacker_confirmedTrips';
  var VISITED_PLACES_KEY = 'holidayHacker_visitedPlaces';
  var CUSTOM_DAYS_KEY = 'holidayHacker_custom';
  var CITY_JSON = '../database/state-city/data.json';

  /** Removes every localStorage key used by Holiday Hacker (prefix holidayHacker_). */
  function clearAllHolidayHackerLocalData() {
    var toRemove = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('holidayHacker_') === 0) toRemove.push(k);
      }
    } catch (e) { /* ignore */ }
    toRemove.forEach(function (key) {
      try { localStorage.removeItem(key); } catch (e2) { /* ignore */ }
    });
  }

  var raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    window.location.href = '../index.html';
    return;
  }
  var user = JSON.parse(raw);
  if (!user.name && !user.workLocation) {
    window.location.href = '../index.html';
    return;
  }
  if (!localStorage.getItem(CAL_DONE_KEY)) {
    window.location.href = '../calendar/index.html';
    return;
  }

  var cityData = [];
  var CITY_ALIAS_MAP = {};
  var cityDataReady = false;
  var editingCard = null;
  var cardDirty = false;
  var workPickConfirmed = '';
  var homePickConfirmed = '';

  function getCustomLeaveDaysUsed() {
    try {
      var list = JSON.parse(localStorage.getItem(CUSTOM_DAYS_KEY) || '[]');
      return list.reduce(function (s, c) {
        return s + (c && c.kind === 'leave' ? 1 : 0);
      }, 0);
    } catch (e) {
      return 0;
    }
  }

  function getLeavesUsedFromTrips() {
    try {
      var trips = JSON.parse(localStorage.getItem(CONFIRMED_TRIPS_KEY) || '[]');
      var tripUsed = trips.reduce(function (s, t) {
        return s + (parseInt(t.leaves, 10) || 0);
      }, 0);
      return tripUsed + getCustomLeaveDaysUsed();
    } catch (e) {
      return 0;
    }
  }

  function getAnnualLeavesQuota(u) {
    if (!u) return 12;
    if (u.annualLeaves != null && u.annualLeaves !== '') {
      var a = parseInt(u.annualLeaves, 10);
      if (!isNaN(a)) return a;
    }
    var p = parseInt(u.pendingLeaves, 10);
    return isNaN(p) ? 12 : p;
  }

  function migrateAnnualLeavesIfNeeded() {
    if (user.annualLeaves != null && user.annualLeaves !== '') return;
    var pl = parseInt(user.pendingLeaves, 10);
    if (isNaN(pl)) pl = 12;
    user.annualLeaves = pl;
    user.pendingLeaves = Math.max(0, pl - getLeavesUsedFromTrips());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  migrateAnnualLeavesIfNeeded();

  function normalizeText(str) {
    return (str || '').toLowerCase().replace(/[\s\-_.,']/g, '');
  }

  function aliasToCanonical(str) {
    var key = normalizeText(str);
    var v = CITY_ALIAS_MAP[key];
    if (v) return normalizeText(v);
    return key;
  }

  function aliasesForSlugNorm(slugNorm) {
    var target = slugNorm || '';
    if (!target) return [];
    var out = [];
    Object.keys(CITY_ALIAS_MAP).forEach(function (k) {
      if (normalizeText(CITY_ALIAS_MAP[k]) === target) out.push(normalizeText(k));
    });
    return out;
  }

  function cityDataMatches(item, query) {
    var qN = normalizeText(query);
    if (!qN) return true;
    var qSlug = aliasToCanonical(query);
    var slugN = item.slugNorm || '';
    var cityN = normalizeText(item.city || '');
    var stateN = normalizeText(item.state || '');
    var labelN = normalizeText(item.label || '');
    if (slugN && qSlug === slugN) return true;
    var tokens = [labelN, cityN, stateN, slugN];
    aliasesForSlugNorm(slugN).forEach(function (a) { tokens.push(a); });
    return tokens.some(function (t) {
      return t && t.indexOf(qN) !== -1;
    });
  }

  function rankLocItem(item, query) {
    var qN = normalizeText(query);
    if (!qN) return 0;
    var score = 0;
    var cityN = normalizeText(item.city || '');
    var slugN = item.slugNorm || '';
    var qSlug = aliasToCanonical(query);
    if (slugN && qSlug === slugN) score += 500;
    if (cityN.indexOf(qN) === 0) score += 200;
    else if (cityN.indexOf(qN) !== -1) score += 100;
    var aliasList = aliasesForSlugNorm(slugN);
    for (var i = 0; i < aliasList.length; i++) {
      var ak = aliasList[i];
      if (ak.indexOf(qN) === 0) score += 190;
      else if (ak.indexOf(qN) !== -1) score += 95;
    }
    if (normalizeText(item.label || '').indexOf(qN) === 0) score += 60;
    if (item.major) score += 45;
    score -= Math.min(35, (item.city || '').length);
    return score;
  }

  function resolveLocationInput(input) {
    var qN = normalizeText(input);
    var qSlug = aliasToCanonical(input);
    var exact = cityData.find(function (item) {
      if (item.slugNorm && item.slugNorm === qSlug) return true;
      var l = normalizeText(item.label || '');
      var c = normalizeText(item.city || '');
      var s = normalizeText(item.state || '');
      return l === qN || c === qN || s === qN;
    });
    return exact ? exact.label : '';
  }

  function capitalizeName(str) {
    return str.replace(/\S+/g, function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }

  function persistUser() {
    user.lastUpdated = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    updateLastUpdated();
  }

  function deriveFamilyFromPrefs(p) {
    if (typeof p.adults === 'number' && typeof p.children === 'number') {
      return { adults: Math.max(1, p.adults), children: Math.max(0, p.children) };
    }
    var party = p.travelParty || 'solo';
    if (party === 'group') party = 'couple';
    var hasKids = !!p.hasKidsUnder10;
    if (party === 'solo') return { adults: 1, children: 0 };
    if (party === 'couple') return { adults: 2, children: 0 };
    if (party === 'family') return { adults: 2, children: hasKids ? 1 : 0 };
    return { adults: 2, children: 0 };
  }

  function inferTravelParty(p) {
    var ex = p.travelParty;
    if (ex === 'group') ex = 'couple';
    if (ex === 'solo' || ex === 'couple' || ex === 'family') return ex;
    var fam = deriveFamilyFromPrefs(p);
    if (fam.adults === 1 && fam.children === 0) return 'solo';
    if (fam.children > 0) return 'family';
    if (fam.adults === 2 && fam.children === 0) return 'couple';
    return 'couple';
  }

  function deriveAdultsChildrenProfile(party, hasKids) {
    if (party === 'solo') return { adults: 1, children: 0 };
    if (party === 'couple') return { adults: 2, children: 0 };
    if (party === 'family') return { adults: 2, children: hasKids ? 1 : 0 };
    return { adults: 2, children: 0 };
  }

  function formatFamilyDisplay(adults, children) {
    if (children === 0) return adults + ' Adult' + (adults > 1 ? 's' : '');
    return adults + ' Adult' + (adults > 1 ? 's' : '') + ', ' + children + ' Child' + (children > 1 ? 'ren' : '');
  }

  var profileName = document.getElementById('profileName');
  var nameInput = document.getElementById('profile-name-input');
  var ageSelect = document.getElementById('profile-age');
  var genderSelect = document.getElementById('profile-gender');
  var workInput = document.getElementById('profile-work');
  var homeInput = document.getElementById('profile-home');
  var workList = document.getElementById('profileWorkList');
  var homeList = document.getElementById('profileHomeList');
  var sameAsWorkWrap = document.getElementById('profileSameAsWorkWrap');
  var sameAsWorkEl = document.getElementById('profileSameAsWork');
  var familyDisplay = document.getElementById('profileFamilyDisplay');
  var familyLeft = document.querySelector('.profile-family-left');
  var familyEdit = document.getElementById('profileFamilyEdit');
  var partySelect = document.getElementById('profile-party-select');
  var kidsSelect = document.getElementById('profile-kids-select');
  var kidsLabel = document.getElementById('profileKidsLabel');
  var lastUpdatedEl = document.getElementById('profileLastUpdated');

  var identityCardEl = document.getElementById('profileIdentityCard');
  var quotaCardEl = document.getElementById('profileQuotaCard');
  var identityToggleBtn = document.getElementById('profileIdentityToggle');
  var quotaToggleBtn = document.getElementById('profileQuotaToggle');

  var leavesSlider = document.getElementById('profile-leaves');
  var leavesPill = document.getElementById('profileQuotaPill') || document.querySelector('.profile-quota-pill');
  var leavesUsedEl = document.getElementById('profileLeavesUsed');
  var leavesRemainingEl = document.getElementById('profileLeavesRemaining');

  function getTravelPrefs() {
    try {
      return JSON.parse(localStorage.getItem(TRAVEL_PREFS_KEY) || '{}');
    } catch (e) { return {}; }
  }

  function saveTravelPrefs(prefs) {
    localStorage.setItem(TRAVEL_PREFS_KEY, JSON.stringify(prefs));
  }

  function migrateGroupTravelParty() {
    var p = getTravelPrefs();
    if (p.travelParty !== 'group') return;
    p.travelParty = 'couple';
    p.adults = 2;
    if (p.children == null) p.children = 0;
    p.hasKidsUnder10 = false;
    saveTravelPrefs(p);
  }

  function formatLastUpdated() {
    if (!user.lastUpdated) return '';
    var d = new Date(user.lastUpdated);
    var now = new Date();
    var isToday = d.getFullYear() === now.getFullYear() &&
                  d.getMonth() === now.getMonth() &&
                  d.getDate() === now.getDate();

    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    var timeStr = h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;

    if (isToday) {
      return 'Today, ' + timeStr;
    }
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function updateLastUpdated() {
    var text = formatLastUpdated();
    if (lastUpdatedEl) lastUpdatedEl.textContent = text ? 'Last updated: ' + text : '';
  }

  function updateLeaveQuotaLegend() {
    var used = getLeavesUsedFromTrips();
    var annual = parseInt(leavesSlider.value, 10) || 0;
    var remaining = Math.max(0, annual - used);
    if (leavesUsedEl) leavesUsedEl.textContent = String(used);
    if (leavesRemainingEl) leavesRemainingEl.textContent = String(remaining);
    if (leavesPill) leavesPill.textContent = annual + ' Days';
  }

  function loadFamilySize() {
    var p = getTravelPrefs();
    var fam = deriveFamilyFromPrefs(p);
    var party = inferTravelParty(p);
    if (familyDisplay) {
      var line = formatFamilyDisplay(fam.adults, fam.children);
      if (party === 'family') {
        line += ' · Under 10: ' + (p.hasKidsUnder10 ? 'Yes' : 'No');
      }
      familyDisplay.textContent = line;
    }
  }

  function syncPartyKidsVisibility() {
    var show = partySelect && partySelect.value === 'family';
    if (kidsSelect) kidsSelect.style.display = show ? '' : 'none';
    if (kidsLabel) kidsLabel.style.display = show ? '' : 'none';
  }

  function loadData() {
    try { user = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) { /* ignore */ }
    migrateAnnualLeavesIfNeeded();

    if (profileName) profileName.textContent = user.name || 'User';
    if (nameInput) nameInput.value = user.name || '';
    if (ageSelect && user.ageGroup) {
      ageSelect.value = user.ageGroup;
      if (ageSelect.value !== user.ageGroup) {
        ageSelect.value = '31-45';
      }
    }
    if (genderSelect && user.gender) {
      genderSelect.value = user.gender;
      if (genderSelect.value !== user.gender) {
        genderSelect.value = 'Other';
      }
    }
    if (workInput) workInput.value = user.workLocation || '';
    if (homeInput) homeInput.value = user.homeLocation || '';

    var annual = getAnnualLeavesQuota(user);
    if (leavesSlider) leavesSlider.value = String(annual);
    updateLeaveQuotaLegend();
    loadFamilySize();
    updateLastUpdated();
  }

  function refreshActionToggles() {
    if (identityToggleBtn) {
      var idIcon = identityToggleBtn.querySelector('.material-symbols-outlined');
      if (editingCard === 'identity') {
        if (idIcon) idIcon.textContent = 'check';
        identityToggleBtn.setAttribute('aria-label', 'Save changes');
        identityToggleBtn.classList.add('profile-card-action--active');
      } else {
        if (idIcon) idIcon.textContent = 'edit';
        identityToggleBtn.setAttribute('aria-label', 'Edit profile details');
        identityToggleBtn.classList.remove('profile-card-action--active');
      }
    }
    if (quotaToggleBtn) {
      var qIcon = quotaToggleBtn.querySelector('.material-symbols-outlined');
      if (editingCard === 'quota') {
        if (qIcon) qIcon.textContent = 'check';
        quotaToggleBtn.setAttribute('aria-label', 'Save annual leaves');
        quotaToggleBtn.classList.add('profile-card-action--active');
      } else {
        if (qIcon) qIcon.textContent = 'edit';
        quotaToggleBtn.setAttribute('aria-label', 'Edit annual leaves');
        quotaToggleBtn.classList.remove('profile-card-action--active');
      }
    }
  }

  function setCardEditingOutline() {
    if (identityCardEl) identityCardEl.classList.toggle('profile-card--editing', editingCard === 'identity');
    if (quotaCardEl) quotaCardEl.classList.toggle('profile-card--editing', editingCard === 'quota');
  }

  function applyIdentityViewState() {
    if (nameInput) nameInput.readOnly = true;
    if (ageSelect) ageSelect.disabled = true;
    if (genderSelect) genderSelect.disabled = true;
    if (workInput) workInput.readOnly = true;
    if (homeInput) homeInput.readOnly = true;
    if (sameAsWorkWrap) sameAsWorkWrap.hidden = true;
    if (familyLeft) familyLeft.style.display = '';
    if (familyEdit) familyEdit.style.display = 'none';
    if (workList) workList.hidden = true;
    if (homeList) homeList.hidden = true;
    if (ageSelect) ageSelect.blur();
    if (genderSelect) genderSelect.blur();
    if (partySelect) partySelect.blur();
    if (kidsSelect) kidsSelect.blur();
  }

  function applyQuotaViewState() {
    if (leavesSlider) leavesSlider.disabled = true;
  }

  function closeAllEditing() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    editingCard = null;
    cardDirty = false;
    applyIdentityViewState();
    applyQuotaViewState();
    loadData();
    refreshActionToggles();
    setCardEditingOutline();
  }

  function trySwitchCard(next) {
    if (editingCard && editingCard !== next && cardDirty) {
      if (!confirm('Discard unsaved changes?')) return false;
    }
    return true;
  }

  function openIdentityEdit() {
    if (!trySwitchCard('identity')) return;
    if (!cityDataReady) {
      alert('City list is still loading. Try again in a moment.');
      return;
    }
    closeAllEditing();
    editingCard = 'identity';
    cardDirty = false;

    if (nameInput) nameInput.readOnly = false;
    if (ageSelect) ageSelect.disabled = false;
    if (genderSelect) genderSelect.disabled = false;
    if (workInput) workInput.readOnly = false;
    if (homeInput) homeInput.readOnly = false;
    if (sameAsWorkWrap) sameAsWorkWrap.hidden = false;
    if (sameAsWorkEl) sameAsWorkEl.checked = false;
    if (familyLeft) familyLeft.style.display = 'none';
    if (familyEdit) familyEdit.style.display = 'flex';

    workPickConfirmed = user.workLocation || '';
    homePickConfirmed = user.homeLocation || '';
    if (workInput) workInput.value = user.workLocation || '';
    if (homeInput) homeInput.value = user.homeLocation || '';

    var p = getTravelPrefs();
    if (partySelect) partySelect.value = inferTravelParty(p);
    if (kidsSelect) kidsSelect.value = p.hasKidsUnder10 ? 'yes' : 'no';
    syncPartyKidsVisibility();

    applyQuotaViewState();
    refreshActionToggles();
    setCardEditingOutline();
  }

  function openQuotaEdit() {
    if (!trySwitchCard('quota')) return;
    closeAllEditing();
    editingCard = 'quota';
    cardDirty = false;
    if (leavesSlider) {
      leavesSlider.disabled = false;
      leavesSlider.value = String(getAnnualLeavesQuota(user));
      updateLeaveQuotaLegend();
    }
    applyIdentityViewState();
    refreshActionToggles();
    setCardEditingOutline();
  }

  function resolveOneLocation(raw, pickConfirmed, stored) {
    if (!raw) return '';
    if (raw === (stored || '')) return stored;
    if (pickConfirmed && raw === pickConfirmed) return pickConfirmed;
    return resolveLocationInput(raw);
  }

  function saveIdentity() {
    var v = nameInput ? nameInput.value.trim() : '';
    if (!v) {
      alert('Please enter a name.');
      return;
    }
    var rWork = (workInput && workInput.value.trim()) || '';
    var work = resolveOneLocation(rWork, workPickConfirmed, user.workLocation);
    var rHome = (homeInput && homeInput.value.trim()) || '';
    if (sameAsWorkEl && sameAsWorkEl.checked) rHome = rWork;
    var homePick = (sameAsWorkEl && sameAsWorkEl.checked) ? workPickConfirmed : homePickConfirmed;
    var home = resolveOneLocation(rHome, homePick, user.homeLocation);
    if (sameAsWorkEl && sameAsWorkEl.checked && work) home = work;

    if (!work || !home) {
      alert('Choose work and hometown from the suggestions list (type a few letters, then pick a row), same as onboarding.');
      return;
    }

    user.name = capitalizeName(v);
    user.ageGroup = ageSelect ? ageSelect.value : '';
    user.gender = genderSelect ? genderSelect.value : '';
    user.workLocation = work;
    user.homeLocation = home;

    var party = partySelect ? partySelect.value : 'solo';
    if (party === 'group') party = 'couple';
    var hasKids = party === 'family' ? (kidsSelect && kidsSelect.value === 'yes') : false;
    var fam = deriveAdultsChildrenProfile(party, hasKids);
    var p = getTravelPrefs();
    p.travelParty = party;
    p.hasKidsUnder10 = !!hasKids;
    p.adults = fam.adults;
    p.children = fam.children;
    saveTravelPrefs(p);

    persistUser();
    loadTravelPrefs();
    closeAllEditing();
  }

  function saveQuota() {
    user.annualLeaves = parseInt(leavesSlider.value, 10) || 0;
    var used = getLeavesUsedFromTrips();
    user.pendingLeaves = Math.max(0, user.annualLeaves - used);
    persistUser();
    closeAllEditing();
  }

  function markDirty() {
    cardDirty = true;
  }

  function renderLocList(listEl, query, onPick) {
    if (!listEl || !cityData.length) {
      if (listEl) listEl.hidden = true;
      return;
    }
    var q = query.trim();
    if (!q) {
      listEl.hidden = true;
      return;
    }
    var filtered = cityData.filter(function (item) { return cityDataMatches(item, q); });
    if (!filtered.length) {
      listEl.hidden = true;
      return;
    }
    filtered.sort(function (a, b) {
      var diff = rankLocItem(b, q) - rankLocItem(a, q);
      if (diff !== 0) return diff;
      return (a.label || '').localeCompare(b.label || '');
    });
    listEl.innerHTML = '';
    filtered.slice(0, 12).forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-dropdown-item';
      btn.textContent = item.label;
      btn.addEventListener('click', function () {
        onPick(item.label);
        listEl.hidden = true;
      });
      listEl.appendChild(btn);
    });
    listEl.hidden = false;
  }

  function syncSameAsWork() {
    if (!sameAsWorkEl || !homeInput || !workInput) return;
    var on = sameAsWorkEl.checked;
    homeInput.readOnly = on;
    if (on) {
      homeInput.value = workInput.value;
      homePickConfirmed = workPickConfirmed;
    }
  }

  function onIdentityToggleClick() {
    if (editingCard === 'identity') {
      saveIdentity();
      return;
    }
    openIdentityEdit();
  }

  function onQuotaToggleClick() {
    if (editingCard === 'quota') {
      saveQuota();
      return;
    }
    openQuotaEdit();
  }

  if (identityToggleBtn) identityToggleBtn.addEventListener('click', onIdentityToggleClick);
  if (quotaToggleBtn) quotaToggleBtn.addEventListener('click', onQuotaToggleClick);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!editingCard) return;
    if (cardDirty && !confirm('Discard changes?')) return;
    closeAllEditing();
  });

  if (nameInput) nameInput.addEventListener('input', markDirty);
  if (ageSelect) ageSelect.addEventListener('change', function () {
    ageSelect.blur();
    markDirty();
  });
  if (genderSelect) genderSelect.addEventListener('change', function () {
    genderSelect.blur();
    markDirty();
  });
  if (partySelect) {
    partySelect.addEventListener('change', function () {
      syncPartyKidsVisibility();
      partySelect.blur();
      markDirty();
    });
  }
  if (kidsSelect) kidsSelect.addEventListener('change', function () {
    kidsSelect.blur();
    markDirty();
  });

  if (workInput && workList) {
    workInput.addEventListener('input', function () {
      if (editingCard !== 'identity') return;
      workPickConfirmed = '';
      markDirty();
      if (sameAsWorkEl && sameAsWorkEl.checked && homeInput) {
        homeInput.value = workInput.value;
        homePickConfirmed = '';
      }
      renderLocList(workList, workInput.value, function (label) {
        workInput.value = label;
        workPickConfirmed = label;
        if (sameAsWorkEl && sameAsWorkEl.checked && homeInput) {
          homeInput.value = label;
          homePickConfirmed = label;
        }
        markDirty();
      });
    });
  }

  if (homeInput && homeList) {
    homeInput.addEventListener('input', function () {
      if (editingCard !== 'identity') return;
      if (sameAsWorkEl && sameAsWorkEl.checked) return;
      homePickConfirmed = '';
      markDirty();
      renderLocList(homeList, homeInput.value, function (label) {
        homeInput.value = label;
        homePickConfirmed = label;
        markDirty();
      });
    });
  }

  if (sameAsWorkEl) {
    sameAsWorkEl.addEventListener('change', function () {
      syncSameAsWork();
      markDirty();
    });
  }

  if (leavesSlider) {
    leavesSlider.addEventListener('input', function () {
      updateLeaveQuotaLegend();
      if (editingCard === 'quota') markDirty();
    });
  }

  document.addEventListener('click', function (e) {
    if (editingCard !== 'identity') return;
    if (!workList || !homeList) return;
    if (e.target.closest('#profile-work') || e.target.closest('#profileWorkList')) return;
    if (e.target.closest('#profile-home') || e.target.closest('#profileHomeList')) return;
    workList.hidden = true;
    homeList.hidden = true;
  });

  function confirmLeave() {
    return confirm('You have unsaved changes. Leave without saving?');
  }

  window.addEventListener('beforeunload', function (e) {
    if (editingCard && cardDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document.querySelectorAll('.glass-nav .nav-item').forEach(function (link) {
    link.addEventListener('click', function (e) {
      if (editingCard && cardDirty) {
        if (!confirmLeave()) e.preventDefault();
      }
    });
  });

  window.addEventListener('storage', function (e) {
    if (e.key === CONFIRMED_TRIPS_KEY || e.key === STORAGE_KEY) {
      if (e.key === STORAGE_KEY) {
        try { user = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (ex) { /* ignore */ }
      }
      if (!editingCard) loadData();
      else updateLeaveQuotaLegend();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    try { user = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (ex) { /* ignore */ }
    if (!editingCard) loadData();
    else updateLeaveQuotaLegend();
  });

  function loadTravelPrefs() {
    var p = getTravelPrefs();
    var modes = p.travelModes || (p.travelMode ? [p.travelMode] : ['car']);
    var primaryMode = modes.length ? modes[0] : 'car';
    document.querySelectorAll('#profileTravelModes .profile-mode-btn').forEach(function (btn) {
      var m = btn.getAttribute('data-mode');
      var active = modes.indexOf(m) !== -1;
      btn.classList.toggle('profile-mode-btn--active', active);
      btn.classList.toggle('profile-mode-btn--inactive', !active);
      var oldPill = btn.querySelector('.holiday-today-pill');
      if (oldPill) oldPill.remove();
      if (active && m === primaryMode) {
        var pill = document.createElement('span');
        pill.className = 'holiday-today-pill';
        pill.textContent = 'Primary';
        btn.appendChild(pill);
      }
    });
    var segs = p.destinationSegments || [];
    document.querySelectorAll('#profileDestinationSegments input[data-segment]').forEach(function (cb) {
      cb.checked = segs.indexOf(cb.getAttribute('data-segment')) !== -1;
    });
    var kidsEl = document.getElementById('profileHasKidsUnder10');
    if (kidsEl) kidsEl.checked = !!p.hasKidsUnder10;
  }

  document.querySelectorAll('#profileTravelModes .profile-mode-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = getTravelPrefs();
      var modes = p.travelModes || ['car'];
      var m = btn.getAttribute('data-mode');
      var idx = modes.indexOf(m);
      if (idx !== -1) {
        if (modes.length <= 1) return;
        modes.splice(idx, 1);
      } else {
        modes.push(m);
      }
      p.travelModes = modes;
      saveTravelPrefs(p);
      loadTravelPrefs();
    });
  });

  document.querySelectorAll('#profileDestinationSegments input[data-segment]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var p = getTravelPrefs();
      var segs = p.destinationSegments || [];
      var s = cb.getAttribute('data-segment');
      var idx = segs.indexOf(s);
      if (cb.checked) {
        if (idx === -1) segs.push(s);
      } else {
        if (idx !== -1) segs.splice(idx, 1);
      }
      p.destinationSegments = segs;
      saveTravelPrefs(p);
    });
  });

  var kidsCheck = document.getElementById('profileHasKidsUnder10');
  if (kidsCheck) kidsCheck.addEventListener('change', function () {
    var p = getTravelPrefs();
    p.hasKidsUnder10 = kidsCheck.checked;
    saveTravelPrefs(p);
    loadFamilySize();
  });

  /* ───────── Clear all data ─────────
   * Two-step confirmation: the danger button only opens a modal; the actual
   * wipe runs only after the user types the word "CLEAR" exactly and taps
   * the destructive button. Cancel button, backdrop tap, and Escape key
   * all dismiss without doing anything. */
  var btnClearAll      = document.getElementById('profileClearAllData');
  var clearModal       = document.getElementById('profileClearModal');
  var clearModalInput  = document.getElementById('profileClearConfirmInput');
  var clearModalBtn    = document.getElementById('profileClearConfirmBtn');
  var REQUIRED_PHRASE  = 'CLEAR';

  function setClearConfirmEnabled(enabled) {
    if (!clearModalBtn) return;
    if (enabled) {
      clearModalBtn.removeAttribute('disabled');
    } else {
      clearModalBtn.setAttribute('disabled', '');
    }
  }

  function openClearModal() {
    if (!clearModal) return;
    if (clearModalInput) clearModalInput.value = '';
    setClearConfirmEnabled(false);
    clearModal.removeAttribute('hidden');
    /* Lock background scroll while the modal is up. */
    document.body.style.overflow = 'hidden';
    if (clearModalInput) {
      setTimeout(function () { try { clearModalInput.focus(); } catch (_) {} }, 50);
    }
  }

  function closeClearModal() {
    if (!clearModal) return;
    clearModal.setAttribute('hidden', '');
    document.body.style.overflow = '';
    if (clearModalInput) clearModalInput.value = '';
    setClearConfirmEnabled(false);
  }

  function performWipeAndReset() {
    /* Prefer the boot-version wipe path so native alarms are cancelled too
       (it calls HolidayAlarm.cancelAll on top of clearing localStorage).
       Falls back to the local wipe if boot-version.js isn't loaded yet. */
    if (window.HolidayHackerBoot && typeof window.HolidayHackerBoot.wipeAllAppData === 'function') {
      window.HolidayHackerBoot.wipeAllAppData();
    } else {
      clearAllHolidayHackerLocalData();
    }
    window.location.href = '../index.html';
  }

  if (btnClearAll) {
    btnClearAll.addEventListener('click', function () { openClearModal(); });
  }

  if (clearModalInput) {
    clearModalInput.addEventListener('input', function () {
      var typed = (clearModalInput.value || '').trim().toUpperCase();
      setClearConfirmEnabled(typed === REQUIRED_PHRASE);
    });
    clearModalInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var typed = (clearModalInput.value || '').trim().toUpperCase();
        if (typed === REQUIRED_PHRASE) {
          e.preventDefault();
          performWipeAndReset();
        }
      }
    });
  }

  if (clearModalBtn) {
    clearModalBtn.addEventListener('click', function () {
      if (clearModalBtn.hasAttribute('disabled')) return;
      performWipeAndReset();
    });
  }

  if (clearModal) {
    clearModal.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-clear-cancel') === '1') {
        closeClearModal();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (clearModal.hasAttribute('hidden')) return;
      if (e.key === 'Escape') closeClearModal();
    });
  }

  /* ───────── Backup & restore ───────── */
  var btnExportBackup     = document.getElementById('profileExportBackup');
  var btnRestoreBackup    = document.getElementById('profileRestoreBackup');
  var restoreFileInput    = document.getElementById('profileRestoreFileInput');
  var restoreModal        = document.getElementById('profileRestoreModal');
  var restoreModalBody    = document.getElementById('profileRestoreModalBody');
  var restoreModalInput   = document.getElementById('profileRestoreConfirmInput');
  var restoreModalBtn     = document.getElementById('profileRestoreConfirmBtn');
  var pendingRestoreBackup = null;
  var RESTORE_PHRASE      = 'RESTORE';

  function showProfileToast(message, isError) {
    var existing = document.getElementById('profileBackupToast');
    if (existing) existing.remove();
    var el = document.createElement('p');
    el.id = 'profileBackupToast';
    el.className = 'profile-backup-toast' + (isError ? ' profile-backup-toast--error' : '');
    el.textContent = message;
    var card = document.querySelector('.profile-card--danger .profile-card-body');
    if (card) {
      card.appendChild(el);
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 5000);
    }
  }

  function backupApi() {
    return window.HolidayHackerBackup || null;
  }

  if (btnExportBackup) {
    btnExportBackup.addEventListener('click', function () {
      var api = backupApi();
      if (!api || typeof api.downloadBackupFile !== 'function') {
        showProfileToast('Backup is not available on this page.', true);
        return;
      }
      Promise.resolve(api.downloadBackupFile()).then(function (result) {
        if (!result.ok) {
          showProfileToast(result.error || 'Export failed.', true);
          return;
        }
        var msg = 'Saved ' + result.filename + ' (' + result.keyCount + ' items).';
        if (result.method === 'downloads') {
          msg += ' Find it in Files → Downloads.';
        } else if (result.method === 'saf') {
          msg += ' Open Files or Downloads to find it in the folder you chose.';
        } else {
          msg += ' Check your downloads folder.';
        }
        showProfileToast(msg);
      });
    });
  }

  function setRestoreConfirmEnabled(enabled) {
    if (!restoreModalBtn) return;
    if (enabled) restoreModalBtn.removeAttribute('disabled');
    else restoreModalBtn.setAttribute('disabled', '');
  }

  function closeRestoreModal() {
    if (!restoreModal) return;
    restoreModal.setAttribute('hidden', '');
    document.body.style.overflow = '';
    pendingRestoreBackup = null;
    if (restoreModalInput) restoreModalInput.value = '';
    setRestoreConfirmEnabled(false);
  }

  function openRestoreModal(backup) {
    if (!restoreModal || !backup) return;
    pendingRestoreBackup = backup;
    var when = backup.exportedAt;
    var whenLabel = when;
    try {
      whenLabel = new Date(when).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch (_) {}
    if (restoreModalBody) {
      restoreModalBody.textContent =
        'This will replace all app data on this device with the backup exported on ' +
        whenLabel + ' (' + (backup.keyCount || Object.keys(backup.keys || {}).length) + ' items).';
    }
    if (restoreModalInput) restoreModalInput.value = '';
    setRestoreConfirmEnabled(false);
    restoreModal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    if (restoreModalInput) {
      setTimeout(function () { try { restoreModalInput.focus(); } catch (_) {} }, 50);
    }
  }

  function performRestore() {
    var api = backupApi();
    if (!api || !pendingRestoreBackup || typeof api.applyBackup !== 'function') return;
    var result = api.applyBackup(pendingRestoreBackup);
    if (!result.ok) {
      showProfileToast(result.error || 'Restore failed.', true);
      closeRestoreModal();
      return;
    }
    closeRestoreModal();
    if (typeof api.finishRestoreNavigation === 'function') {
      api.finishRestoreNavigation();
    } else {
      window.location.href = '../trips/index.html';
    }
  }

  function handleBackupPickResult(result) {
    if (!result.ok) {
      showProfileToast(result.error || 'Could not read backup.', true);
      return;
    }
    openRestoreModal(result.backup);
  }

  if (btnRestoreBackup) {
    btnRestoreBackup.addEventListener('click', function () {
      var api = backupApi();
      if (!api) {
        showProfileToast('Restore is not available on this page.', true);
        return;
      }
      if (typeof api.pickBackupFile === 'function') {
        api.pickBackupFile().then(function (result) {
          if (result.error === 'native_pick_unavailable') {
            if (restoreFileInput) {
              restoreFileInput.value = '';
              restoreFileInput.click();
            }
            return;
          }
          handleBackupPickResult(result);
        });
        return;
      }
      if (restoreFileInput) {
        restoreFileInput.value = '';
        restoreFileInput.click();
      }
    });
  }

  if (restoreFileInput) {
    restoreFileInput.addEventListener('change', function () {
      var file = restoreFileInput.files && restoreFileInput.files[0];
      if (!file) return;
      var api = backupApi();
      if (!api || typeof api.readBackupFile !== 'function') {
        showProfileToast('Restore is not available on this page.', true);
        return;
      }
      api.readBackupFile(file).then(function (result) {
        handleBackupPickResult(result);
      });
    });
  }

  if (restoreModalInput) {
    restoreModalInput.addEventListener('input', function () {
      var typed = (restoreModalInput.value || '').trim().toUpperCase();
      setRestoreConfirmEnabled(typed === RESTORE_PHRASE);
    });
    restoreModalInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var typed = (restoreModalInput.value || '').trim().toUpperCase();
        if (typed === RESTORE_PHRASE) {
          e.preventDefault();
          performRestore();
        }
      }
    });
  }

  if (restoreModalBtn) {
    restoreModalBtn.addEventListener('click', function () {
      if (restoreModalBtn.hasAttribute('disabled')) return;
      performRestore();
    });
  }

  if (restoreModal) {
    restoreModal.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-restore-cancel') === '1') {
        closeRestoreModal();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (restoreModal.hasAttribute('hidden')) return;
      if (e.key === 'Escape') closeRestoreModal();
    });
  }

  /* ───────── Disclaimer & Contact card ─────────
   * Summary paragraph + Contact button are always visible. The detailed
   * disclaimer (Information accuracy, Reminders & alarms, Liability, etc.)
   * collapses behind a "Read full disclaimer" button so the profile screen
   * stays scannable. */
  var aboutFull     = document.getElementById('profileAboutFull');
  var readMoreBtn   = document.getElementById('profileAboutReadMore');
  var readMoreLabel = document.getElementById('profileAboutReadMoreLabel');
  var readMoreChev  = document.getElementById('profileAboutReadMoreChevron');
  function setFullDisclaimerExpanded(expanded) {
    if (!aboutFull || !readMoreBtn) return;
    if (expanded) {
      aboutFull.removeAttribute('hidden');
      readMoreBtn.setAttribute('aria-expanded', 'true');
      if (readMoreLabel) readMoreLabel.textContent = 'Hide full disclaimer';
      if (readMoreChev)  readMoreChev.textContent = 'expand_less';
    } else {
      aboutFull.setAttribute('hidden', '');
      readMoreBtn.setAttribute('aria-expanded', 'false');
      if (readMoreLabel) readMoreLabel.textContent = 'Read full disclaimer';
      if (readMoreChev)  readMoreChev.textContent = 'expand_more';
    }
  }
  if (readMoreBtn) {
    readMoreBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var expanded = readMoreBtn.getAttribute('aria-expanded') === 'true';
      setFullDisclaimerExpanded(!expanded);
    });
  }

  /* Contact email. In a Capacitor WebView a bare <a href="mailto:…"> can
     silently fail on Android because the WebView tries to navigate to the
     mailto URL itself. Opening via window.open(..., '_system') routes the
     intent through the OS so the user's default email app is launched. */
  var contactBtn = document.getElementById('profileContactEmailBtn');
  if (contactBtn) {
    contactBtn.addEventListener('click', function (e) {
      var href = contactBtn.getAttribute('href') || 'mailto:info@nexreality.io';
      e.preventDefault();
      try {
        var win = window.open(href, '_system');
        if (!win) window.location.href = href;
      } catch (_) {
        window.location.href = href;
      }
    });
  }

  var FAVORITES_KEY = 'holidayHacker_favorites';
  var HOMETOWN_IMAGE_URL = 'https://img.freepik.com/free-vector/suburban-house-illustration_33099-2357.jpg';
  var DEST_PLACEHOLDER_IMAGE_URL = 'https://img.magnific.com/premium-vector/summer-time-car-beach-with-few-suitcase-vacation-travel-huge-pile-things-holiday-flat-cartoon-style-illustration-landscape-concept-isolated_185796-16.jpg';
  var FAVORITES_PREVIEW_COUNT = 3;
  var favoritesExpanded = false;

  function loadFavorites() {
    var section = document.getElementById('profileFavoritesSection');
    var grid = document.getElementById('profileFavoritesGrid');
    if (!section || !grid) return;
    var favs;
    try { favs = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch (e) { favs = []; }
    if (!favs.length) { section.style.display = 'none'; return; }
    section.style.display = '';

    var overflow = favs.length - FAVORITES_PREVIEW_COUNT;
    var showAll = favoritesExpanded || overflow <= 0;
    var visible = showAll ? favs : favs.slice(0, FAVORITES_PREVIEW_COUNT);

    var html = '';
    visible.forEach(function (f, idx) {
      var d = f.destination || {};
      var imgUrl = (d.imageUrl || '').trim();
      if (!imgUrl && (d.slug === '__hometown__' || d.isHometown)) imgUrl = HOMETOWN_IMAGE_URL;
      if (!imgUrl) imgUrl = DEST_PLACEHOLDER_IMAGE_URL;
      imgUrl = imgUrl.replace(/'/g, "\\'");
      var imgStyle = 'background-image: url(\'' + imgUrl + '\')';
      var destName = (d.name || 'Unknown').replace(/</g, '&lt;');
      var stateName = (d.state || '').replace(/_/g, ' ').replace(/</g, '&lt;');
      html += '<div class="profile-fav-card" data-idx="' + idx + '">' +
        '<div class="profile-fav-img" style="' + imgStyle + '"></div>' +
        '<div class="profile-fav-body">' +
          '<h4 class="profile-fav-name">' + destName + '</h4>' +
          '<p class="profile-fav-region">' + stateName + '</p>' +
          '<p class="profile-fav-window">' + (f.windowName || '').replace(/</g, '&lt;') + '</p>' +
        '</div>' +
        '<button type="button" class="profile-fav-remove" data-idx="' + idx + '" aria-label="Remove favorite"><span class="material-symbols-outlined">close</span></button>' +
      '</div>';
    });

    if (!showAll) {
      html += '<button type="button" class="profile-fav-toggle" data-action="expand">+' + overflow + ' more</button>';
    } else if (favs.length > FAVORITES_PREVIEW_COUNT) {
      html += '<button type="button" class="profile-fav-toggle" data-action="collapse">Show less</button>';
    }

    grid.innerHTML = html;
    grid.querySelectorAll('.profile-fav-remove').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var i = parseInt(btn.getAttribute('data-idx'), 10);
        var arr;
        try { arr = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch (ex) { arr = []; }
        arr.splice(i, 1);
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
        loadFavorites();
      });
    });
    var toggleBtn = grid.querySelector('.profile-fav-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        favoritesExpanded = toggleBtn.getAttribute('data-action') === 'expand';
        loadFavorites();
      });
    }
  }

  var visitedInput = document.getElementById('profile-visited-input');
  var visitedList = document.getElementById('profileVisitedList');
  var visitedTagsEl = document.getElementById('profileVisitedTags');
  var VISITED_PREVIEW_COUNT = 3;
  var visitedExpanded = false;

  function getVisitedPlaces() {
    try {
      var arr = JSON.parse(localStorage.getItem(VISITED_PLACES_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveVisitedPlaces(arr) {
    localStorage.setItem(VISITED_PLACES_KEY, JSON.stringify(arr));
  }

  function buildVisitedTag(label, idx) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'profile-tag';
    btn.setAttribute('data-idx', String(idx));
    btn.setAttribute('aria-label', 'Remove ' + label);
    btn.appendChild(document.createTextNode(label + ' '));
    var ico = document.createElement('span');
    ico.className = 'material-symbols-outlined';
    ico.textContent = 'close';
    btn.appendChild(ico);
    btn.addEventListener('click', function () {
      var current = getVisitedPlaces();
      current.splice(idx, 1);
      saveVisitedPlaces(current);
      renderVisitedTags();
    });
    return btn;
  }

  function buildVisitedToggle(label, expand) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'profile-tag profile-tag--more';
    btn.textContent = label;
    btn.addEventListener('click', function () {
      visitedExpanded = expand;
      renderVisitedTags();
    });
    return btn;
  }

  function renderVisitedTags() {
    if (!visitedTagsEl) return;
    var arr = getVisitedPlaces();
    visitedTagsEl.innerHTML = '';
    if (!arr.length) return;

    var overflow = arr.length - VISITED_PREVIEW_COUNT;
    var showAll = visitedExpanded || overflow <= 0;
    var visible = showAll ? arr : arr.slice(0, VISITED_PREVIEW_COUNT);

    visible.forEach(function (label, idx) {
      visitedTagsEl.appendChild(buildVisitedTag(label, idx));
    });

    if (!showAll) {
      visitedTagsEl.appendChild(buildVisitedToggle('+' + overflow + ' more', true));
    } else if (arr.length > VISITED_PREVIEW_COUNT) {
      visitedTagsEl.appendChild(buildVisitedToggle('Show less', false));
    }
  }

  function addVisitedPlace(label) {
    if (!label) return;
    var arr = getVisitedPlaces();
    var key = aliasToCanonical(label);
    var exists = arr.some(function (p) { return aliasToCanonical(p) === key; });
    if (exists) return;
    arr.push(label);
    saveVisitedPlaces(arr);
    renderVisitedTags();
  }

  if (visitedInput && visitedList) {
    visitedInput.addEventListener('input', function () {
      renderLocList(visitedList, visitedInput.value, function (label) {
        addVisitedPlace(label);
        visitedInput.value = '';
        visitedList.hidden = true;
      });
    });
    visitedInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var resolved = resolveLocationInput(visitedInput.value);
        if (resolved) {
          addVisitedPlace(resolved);
          visitedInput.value = '';
          visitedList.hidden = true;
        }
      }
    });
  }

  document.addEventListener('click', function (e) {
    if (!visitedList || !visitedInput) return;
    if (e.target.closest('#profile-visited-input') || e.target.closest('#profileVisitedList')) return;
    visitedList.hidden = true;
  });

  function loadCityData() {
    fetch(CITY_JSON)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        CITY_ALIAS_MAP = data.aliases || {};
        (data.states || []).forEach(function (state) {
          cityData.push({ city: state.name, state: '', label: state.name, slugNorm: '', major: false });
          (state.cities || []).forEach(function (city) {
            var cityName = typeof city === 'string' ? city : (city && city.name) || '';
            var slug = (city && typeof city === 'object' && city.slug) ? city.slug : '';
            var slugNorm = slug ? normalizeText(slug) : '';
            var major = !!(city && typeof city === 'object' && city.is_major_city);
            cityData.push({
              city: cityName,
              state: state.name,
              label: cityName + ', ' + state.name,
              slugNorm: slugNorm,
              major: major
            });
          });
        });
        cityDataReady = true;
      })
      .catch(function () {
        cityDataReady = true;
      });
  }

  function initProfileReminderSettings() {
    var card = document.getElementById('profileReminderSettingsCard');
    var btn = document.getElementById('profileReminderSettingsBtn');
    if (!card || !btn) return;
    try {
      if (!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android')) return;
      if (!(window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayAlarm)) return;
    } catch (_) {
      return;
    }
    card.hidden = false;
    btn.addEventListener('click', function () {
      if (window.HH_alarmReliability && window.HH_alarmReliability.openSettings) {
        window.HH_alarmReliability.openSettings();
      }
    });
  }

  loadCityData();
  migrateGroupTravelParty();
  loadData();
  loadTravelPrefs();
  loadFavorites();
  renderVisitedTags();
  closeAllEditing();
  initProfileReminderSettings();
})();
