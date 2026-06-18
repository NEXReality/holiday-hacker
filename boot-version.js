/* ===========================================================================
 * Holiday Hacker — boot-time helpers
 *
 * 1. Play Store In-App Update gate (force / flexible update on new release).
 * 2. A shared `wipeAllAppData` helper used by the Profile › Clear Data flow.
 *
 * NOTE: there is no automatic data-reset / re-onboarding logic in here.
 *       Local data is preserved across Play Store updates by Android, and
 *       this file never touches localStorage unless the user explicitly
 *       triggers the Clear Data button in Profile.
 * =========================================================================== */

/* ───────── Shared wipe helper (Profile → Clear Data) ───────── */
(function () {
  'use strict';

  function wipeAllAppData() {
    var toRemove = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('holidayHacker_') === 0) toRemove.push(k);
      }
    } catch (_) {}
    toRemove.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    /* Best-effort: drop any persisted native alarms via the Capacitor
       bridge. We don't await this — the page is about to be redirected. */
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayAlarm) {
        window.Capacitor.Plugins.HolidayAlarm.cancelAll().catch(function () {});
      }
    } catch (_) {}
  }

  window.HolidayHackerBoot = {
    wipeAllAppData: wipeAllAppData
  };
})();

/* ─── Notification tap → Trips deep link ─────────────────── */
(function () {
  'use strict';

  function alarmPlugin() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayAlarm) {
        return window.Capacitor.Plugins.HolidayAlarm;
      }
    } catch (_) {}
    return null;
  }

  function currentPath() {
    try {
      return (window.location.pathname || '').replace(/\\/g, '/');
    } catch (_) {
      return '';
    }
  }

  function routeTargetPath(route) {
    if (!route) return '';
    var path = route.split('?')[0];
    if (path.indexOf('://') !== -1) {
      try { path = new URL(path).pathname; } catch (_) {}
    }
    return path.replace(/\\/g, '/');
  }

  function followPendingRoute() {
    var p = alarmPlugin();
    if (!p || !p.getPendingRoute) return Promise.resolve();
    return p.getPendingRoute().then(function (res) {
      var route = res && res.route;
      if (!route) return;
      var href = route.charAt(0) === '/' ? route : ('/' + route);
      var here = currentPath() + (window.location.search || '');
      var targetPath = routeTargetPath(route);
      var targetQs = route.indexOf('?') !== -1 ? route.slice(route.indexOf('?')) : '';
      var targetFull = targetPath + targetQs;
      if (here.endsWith(targetFull) || here === targetFull) return;
      window.location.href = href;
    }).catch(function () {});
  }

  function scheduleRouteFollow() {
    setTimeout(followPendingRoute, 300);
    setTimeout(followPendingRoute, 1200);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') scheduleRouteFollow();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRouteFollow);
  } else {
    scheduleRouteFollow();
  }

  window.HolidayHackerLaunch = { followPendingRoute: followPendingRoute };
})();

/* ===========================================================================
 * Holiday Hacker — Play Store In-App Update gate
 *
 * Asks Google Play Store whether a newer build of this app is available, and
 * if so either forces an immediate blocking update (for critical fixes) or
 * downloads the new build silently in the background and prompts the user
 * to restart when it's ready.
 *
 * NO BACKEND REQUIRED. Play Store is the source of truth — it compares the
 * versionCode shipped in the installed APK to the latest active release on
 * Play Console.
 *
 * "Forced immediate" is triggered by either of:
 *   1. The release was uploaded with inAppUpdatePriority ≥ 4 (set per-build
 *      in Play Developer API / bundletool).
 *   2. The user is more than STALENESS_FORCE_DAYS behind the latest release
 *      (default 14 days). This lets you ship a critical fix and have every
 *      existing install be forced to upgrade within two weeks even if you
 *      didn't set the priority.
 *
 * Everything else falls through to a flexible (background) download with an
 * in-page banner asking the user to restart when ready.
 *
 * Native install dependency:
 *   • android/app/build.gradle: com.google.android.play:app-update:2.1.0
 *   • android: AppUpdatePlugin (Capacitor) registered in MainActivity
 *
 * If either is missing (e.g. older build, web preview, side-loaded APK
 * without Play Store) this whole module silently no-ops.
 * =========================================================================== */
(function () {
  'use strict';

  /* Threshold knobs — tune per release if you want. */
  var STALENESS_FORCE_DAYS    = 14; /* days behind = mandatory immediate */
  var PRIORITY_FORCE_AT       = 4;  /* updatePriority ≥ this = mandatory immediate */
  var CHECK_AFTER_MS          = 1500; /* small delay so first paint isn't blocked */

  /* Play Core install-status constants (mirroring InstallStatus.java). */
  var STATUS_DOWNLOADED     = 11;

  /* Update-availability constants. */
  var AVAIL_AVAILABLE       = 2;
  var AVAIL_IN_PROGRESS     = 3;

  function getPlugin() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppUpdater) {
        return window.Capacitor.Plugins.AppUpdater;
      }
    } catch (_) {}
    return null;
  }

  /* Tiny in-page banner used for the flexible-update "Restart now" prompt.
     We inject it lazily so pages that never see an update never get the DOM
     node. Styled to match the app's pill-button aesthetic without needing a
     stylesheet edit. */
  function showRestartBanner(onRestart) {
    if (document.getElementById('hhAppUpdateBanner')) return;
    var banner = document.createElement('div');
    banner.id = 'hhAppUpdateBanner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:calc(env(safe-area-inset-bottom,0px) + 5.5rem)',
      'transform:translateX(-50%)',
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'gap:0.75rem',
      'padding:0.7rem 0.9rem 0.7rem 1rem',
      'background:#111827',
      'color:#fff',
      'border-radius:999px',
      'box-shadow:0 12px 28px rgba(15,23,42,0.35)',
      'font-family:"Plus Jakarta Sans",system-ui,-apple-system,sans-serif',
      'font-size:0.85rem',
      'max-width:calc(100vw - 2rem)'
    ].join(';');
    banner.innerHTML =
      '<span style="font-weight:600">App update ready</span>' +
      '<button id="hhAppUpdateRestart" type="button" style="' +
        'border:none;background:#4f46e5;color:#fff;font-weight:600;' +
        'padding:0.45rem 0.9rem;border-radius:999px;cursor:pointer;' +
        'font-family:inherit;font-size:inherit;">Restart</button>';
    document.body.appendChild(banner);
    var btn = document.getElementById('hhAppUpdateRestart');
    if (btn) btn.addEventListener('click', function () {
      try { onRestart(); } catch (_) {}
    });
  }

  function isForced(info) {
    var priority = (info && typeof info.updatePriority === 'number') ? info.updatePriority : 0;
    var staleness = (info && typeof info.clientVersionStalenessDays === 'number') ? info.clientVersionStalenessDays : -1;
    if (priority >= PRIORITY_FORCE_AT) return true;
    if (staleness >= 0 && staleness >= STALENESS_FORCE_DAYS) return true;
    return false;
  }

  function startImmediate(plugin) {
    plugin.startImmediate().catch(function () { /* user dismissed, will re-arm on next resume */ });
  }

  function startFlexible(plugin) {
    plugin.startFlexible().catch(function () {});
    try {
      plugin.addListener('installStateChange', function (state) {
        if (state && state.installStatus === STATUS_DOWNLOADED) {
          showRestartBanner(function () {
            plugin.completeFlexibleUpdate().catch(function () {});
          });
        }
      });
    } catch (_) {}
  }

  function runCheck() {
    var plugin = getPlugin();
    if (!plugin) return;
    plugin.check()
      .then(function (info) {
        if (!info) return;

        /* If a forced update was already mid-flight (e.g. user backgrounded
           the app during the immediate UI), Play tells us so — re-arm. */
        if (info.updateAvailability === AVAIL_IN_PROGRESS) {
          startImmediate(plugin);
          return;
        }
        if (info.updateAvailability !== AVAIL_AVAILABLE) {
          /* A previous flexible download might still be sitting at
             DOWNLOADED waiting for restart from an earlier session. */
          if (info.installStatus === STATUS_DOWNLOADED) {
            showRestartBanner(function () {
              plugin.completeFlexibleUpdate().catch(function () {});
            });
          }
          return;
        }

        if (isForced(info) && info.immediateUpdateAllowed) {
          startImmediate(plugin);
        } else if (info.flexibleUpdateAllowed) {
          startFlexible(plugin);
        } else if (info.immediateUpdateAllowed) {
          startImmediate(plugin);
        }
      })
      .catch(function () { /* swallow — never block the app */ });
  }

  function schedule() {
    setTimeout(runCheck, CHECK_AFTER_MS);
    /* Re-check whenever the app returns to the foreground so forced updates
       can re-arm if the user dismissed the Play Store UI. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') runCheck();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }

  window.HolidayHackerAppUpdate = {
    check: runCheck,
    STALENESS_FORCE_DAYS: STALENESS_FORCE_DAYS,
    PRIORITY_FORCE_AT: PRIORITY_FORCE_AT
  };
})();
