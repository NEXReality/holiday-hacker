/* Android reminder reliability: notifications, exact alarms, don't-optimize battery. */
(function () {
  'use strict';

  var SNOOZE_KEY = 'holidayHacker_alarmReliabilitySnoozeUntil';
  var SNOOZE_DAYS = 3;
  var MODAL_ID = 'hhAlarmReliabilityModal';
  var manualSettingsOpen = false;

  function alarmPlugin() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayAlarm) {
        return window.Capacitor.Plugins.HolidayAlarm;
      }
    } catch (_) {}
    return null;
  }

  function isNativeAndroid() {
    try {
      return !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
    } catch (_) {
      return false;
    }
  }

  function isSnoozed() {
    try {
      var until = localStorage.getItem(SNOOZE_KEY);
      if (!until) return false;
      return Date.now() < new Date(until).getTime();
    } catch (_) {
      return false;
    }
  }

  function snoozePrompt() {
    var d = new Date();
    d.setDate(d.getDate() + SNOOZE_DAYS);
    try {
      localStorage.setItem(SNOOZE_KEY, d.toISOString());
    } catch (_) {}
  }

  function clearSnooze() {
    try { localStorage.removeItem(SNOOZE_KEY); } catch (_) {}
  }

  function isModalOpen() {
    var modal = document.getElementById(MODAL_ID);
    return !!(modal && !modal.hidden);
  }

  function mapPermissionResult(res) {
    var notifications = !!res.notifications;
    var exactAlarms = !!res.exactAlarms;
    var batteryOptimization = !!res.batteryOptimization;
    return {
      native: true,
      notifications: notifications,
      exactAlarms: exactAlarms,
      batteryOptimization: batteryOptimization,
      ready: notifications && exactAlarms && batteryOptimization
    };
  }

  function checkPermissions() {
    var p = alarmPlugin();
    if (!p || !p.hasPermissions) {
      return Promise.resolve({ ready: true, native: false });
    }
    return p.hasPermissions().then(function (res) {
      return mapPermissionResult(res);
    }).catch(function () {
      return { ready: true, native: false };
    });
  }

  function missingFromStatus(status) {
    if (!status || !status.native) return [];
    var out = [];
    if (!status.notifications) {
      out.push({
        id: 'notifications',
        title: 'Notifications',
        detail: 'Reminders are delivered as notifications. Turn notifications ON for Holiday Hacker.',
        actionLabel: 'Allow notifications'
      });
    }
    if (!status.exactAlarms) {
      out.push({
        id: 'exactAlarms',
        title: 'Alarms & reminders',
        detail: 'Allow exact alarms so trip reminders fire at the right minute.',
        actionLabel: 'Allow alarms & reminders'
      });
    }
    if (!status.batteryOptimization) {
      out.push({
        id: 'battery',
        title: 'Battery',
        detail: 'When Android asks, choose Don\u2019t optimize / Allow. On some phones you must also open App info \u2192 Battery and select Allow background activity (not Automatically optimizes or Smart mode).',
        actionLabel: 'Open battery settings'
      });
    }
    return out;
  }

  function appIconHref() {
    try {
      var path = window.location.pathname || '';
      if (/\/(calendar|plan|trips|profile|holidays)(\/|$)/.test(path)) {
        return '../icon/app-icon.png';
      }
    } catch (_) {}
    return 'icon/app-icon.png';
  }

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return document.getElementById(MODAL_ID);
    var modal = document.createElement('div');
    modal.className = 'hh-modal';
    modal.id = MODAL_ID;
    modal.hidden = true;
    modal.innerHTML =
      '<div class="hh-modal__backdrop" data-reliability-dismiss="1"></div>' +
      '<div class="hh-modal__dialog hh-modal__dialog--reliability" role="dialog" aria-modal="true" aria-labelledby="hhAlarmReliabilityTitle">' +
        '<img class="hh-app-icon hh-reliability-app-icon" src="' + appIconHref() + '" alt="" width="48" height="48"/>' +
        '<h3 class="hh-modal__title" id="hhAlarmReliabilityTitle">Set up reminders</h3>' +
        '<p class="hh-modal__body" id="hhAlarmReliabilityIntro">A few Android settings are required so leave and booking alarms ring on time.</p>' +
        '<ul class="hh-modal__list hh-reliability-missing" id="hhAlarmReliabilityList"></ul>' +
        '<p class="hh-modal__hint hh-modal__hint--info" id="hhAlarmReliabilityHint">After each setting, come back here \u2014 we\u2019ll detect changes automatically.</p>' +
        '<div class="hh-reliability-actions" id="hhAlarmReliabilityActions"></div>' +
        '<div class="hh-modal__actions">' +
          '<button type="button" class="hh-modal__btn hh-modal__btn--cancel" data-reliability-dismiss="1">Remind me later</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-reliability-dismiss') === '1') {
        closeModal(true);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (modal.hidden) return;
      if (e.key === 'Escape') closeModal(true);
    });

    return modal;
  }

  function closeModal(snooze) {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    manualSettingsOpen = false;
    if (snooze) snoozePrompt();
  }

  function setModalSetupCopy() {
    var title = document.getElementById('hhAlarmReliabilityTitle');
    var intro = document.getElementById('hhAlarmReliabilityIntro');
    var hint = document.getElementById('hhAlarmReliabilityHint');
    if (title) title.textContent = 'Set up reminders';
    if (intro) intro.textContent = 'A few Android settings are required so leave and booking alarms ring on time.';
    if (hint) hint.hidden = false;
  }

  function statusLabel(ok) {
    return ok ? 'On' : 'Needs attention';
  }

  function renderConfiguredModal(status) {
    ensureModal();
    setModalSetupCopy();
    var title = document.getElementById('hhAlarmReliabilityTitle');
    var intro = document.getElementById('hhAlarmReliabilityIntro');
    var hint = document.getElementById('hhAlarmReliabilityHint');
    var list = document.getElementById('hhAlarmReliabilityList');
    var actions = document.getElementById('hhAlarmReliabilityActions');
    var modal = document.getElementById(MODAL_ID);
    if (!list || !actions || !modal) return;

    if (title) title.textContent = 'Reminder settings';
    if (intro) intro.textContent = 'Required settings look good. Open any item below to review or change them on your phone.';
    if (hint) hint.hidden = true;

    list.innerHTML =
      '<li><strong>Notifications</strong> \u2014 ' + statusLabel(status.notifications) + '</li>' +
      '<li><strong>Alarms & reminders</strong> \u2014 ' + statusLabel(status.exactAlarms) + '</li>' +
      '<li><strong>Battery (Don\u2019t optimize)</strong> \u2014 ' + statusLabel(status.batteryOptimization) + '</li>';

    actions.innerHTML = '';
    [
      { id: 'notifications', label: 'Open notification settings' },
      { id: 'exactAlarms', label: 'Open alarms & reminders' },
      { id: 'battery', label: 'Open battery settings' }
    ].forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hh-reliability-fix-btn';
      btn.textContent = item.label;
      btn.addEventListener('click', function () { openSetting(item.id); });
      actions.appendChild(btn);
    });

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function openSettings() {
    if (!isNativeAndroid()) return Promise.resolve({ ready: true, native: false });
    manualSettingsOpen = true;
    return checkPermissions().then(function (status) {
      var missing = missingFromStatus(status);
      if (missing.length) {
        setModalSetupCopy();
        renderModal(missing);
      } else {
        renderConfiguredModal(status);
      }
      return status;
    });
  }

  function openSetting(itemId) {
    var p = alarmPlugin();
    if (!p) return;
    try {
      if (itemId === 'notifications') {
        if (p.openNotificationSettings) p.openNotificationSettings();
        else if (p.requestPermissions) p.requestPermissions();
      } else if (itemId === 'exactAlarms') {
        if (p.openExactAlarmSettings) p.openExactAlarmSettings();
        else if (p.requestPermissions) p.requestPermissions();
      } else if (itemId === 'battery') {
        if (p.openBatterySettings) p.openBatterySettings();
        else if (p.requestBatteryOptimization) p.requestBatteryOptimization();
      }
    } catch (_) {}
  }

  function renderModal(missing) {
    ensureModal();
    setModalSetupCopy();
    var modal = document.getElementById(MODAL_ID);
    var list = document.getElementById('hhAlarmReliabilityList');
    var actions = document.getElementById('hhAlarmReliabilityActions');
    if (!list || !actions) return;

    list.innerHTML = missing.map(function (item) {
      return '<li><strong>' + item.title + '</strong> \u2014 ' + item.detail + '</li>';
    }).join('');

    actions.innerHTML = '';
    var primary = missing[0];
    if (primary) {
      var mainBtn = document.createElement('button');
      mainBtn.type = 'button';
      mainBtn.className = 'hh-modal__btn hh-modal__btn--primary hh-reliability-fix-all';
      mainBtn.textContent = primary.actionLabel || ('Open ' + primary.title);
      mainBtn.addEventListener('click', function () { openSetting(primary.id); });
      actions.appendChild(mainBtn);
    }

    if (missing.length > 1) {
      missing.slice(1).forEach(function (item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hh-reliability-fix-btn';
        btn.textContent = item.actionLabel || ('Open ' + item.title);
        btn.addEventListener('click', function () { openSetting(item.id); });
        actions.appendChild(btn);
      });
    }

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function tryAutoFinishModal() {
    if (!isModalOpen()) return;
    checkPermissions().then(function (status) {
      var missing = missingFromStatus(status);
      if (status.ready && !missing.length) {
        clearSnooze();
        if (manualSettingsOpen) {
          renderConfiguredModal(status);
        } else {
          closeModal(false);
        }
        return;
      }
      if (missing.length) {
        setModalSetupCopy();
        renderModal(missing);
      }
    });
  }

  function maybeWarn(opts) {
    opts = opts || {};
    if (!isNativeAndroid()) return Promise.resolve({ ready: true, native: false });
    if (!opts.force && isSnoozed()) return Promise.resolve({ ready: true, snoozed: true });

    return checkPermissions().then(function (status) {
      var missing = missingFromStatus(status);
      if (status.ready && !missing.length) {
        clearSnooze();
        return status;
      }
      if (!missing.length) return status;
      if (!opts.silent) renderModal(missing);
      return status;
    });
  }

  function scheduleCheck() {
    setTimeout(function () { maybeWarn({ force: false }); }, 1800);
  }

  window.addEventListener('pageshow', function () {
    scheduleCheck();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    tryAutoFinishModal();
    if (!isModalOpen()) {
      maybeWarn({ force: false, silent: true }).then(function (status) {
        if (!status.ready && !isSnoozed()) {
          var missing = missingFromStatus(status);
          if (missing.length) renderModal(missing);
        }
      });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleCheck);
  } else {
    scheduleCheck();
  }

  window.HH_alarmReliability = {
    check: checkPermissions,
    maybeWarn: maybeWarn,
    openSettings: openSettings,
    openSetting: openSetting
  };
})();
