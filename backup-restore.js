/* ===========================================================================
 * Holiday Hacker — local backup & restore (no backend)
 *
 * Exports every localStorage key prefixed holidayHacker_ to a JSON file.
 * On Android, uses Storage Access Framework (save/open) so files land in
 * Downloads or a folder the user picks. Restore accepts only files named
 * HolidayHacker-backup-YYYY-MM-DD_HH-MM-SS.json
 * =========================================================================== */
(function () {
  'use strict';

  var BACKUP_FORMAT = 'holiday-hacker-backup';
  var BACKUP_VERSION = 1;
  var KEY_PREFIX = 'holidayHacker_';
  var REARM_FLAG = 'holidayHacker_rearmAfterRestore';
  var BACKUP_NAME_PATTERN = /^HolidayHacker-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/i;
  var BACKUP_NAME_HINT = 'HolidayHacker-backup-YYYY-MM-DD_HH-MM-SS.json';

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** HolidayHacker-backup-2026-05-19_14-30-45.json */
  function backupFilename() {
    var d = new Date();
    var date = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    var time = pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds());
    return 'HolidayHacker-backup-' + date + '_' + time + '.json';
  }

  function isBackupFilename(name) {
    return BACKUP_NAME_PATTERN.test(String(name || '').trim());
  }

  function backupPlugin() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayBackup) {
        return window.Capacitor.Plugins.HolidayBackup;
      }
    } catch (_) {}
    return null;
  }

  function isNativeBackupAvailable() {
    var p = backupPlugin();
    return !!(p && p.saveBackup && p.pickBackup);
  }

  function collectAppDataKeys() {
    var keys = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) {
          keys[k] = localStorage.getItem(k);
        }
      }
    } catch (_) {}
    return keys;
  }

  function exportAppBackup() {
    var keys = collectAppDataKeys();
    var count = Object.keys(keys).length;
    if (!count) {
      return { ok: false, error: 'Nothing to back up yet — complete onboarding first.' };
    }
    return {
      ok: true,
      payload: {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        appName: 'Holiday Hacker',
        keyCount: count,
        keys: keys
      },
      filename: backupFilename()
    };
  }

  function cancelNativeAlarms() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HolidayAlarm) {
        window.Capacitor.Plugins.HolidayAlarm.cancelAll().catch(function () {});
      }
    } catch (_) {}
  }

  function clearAppDataKeys() {
    var toRemove = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) toRemove.push(k);
      }
    } catch (_) {}
    toRemove.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }

  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object') return 'Invalid backup file.';
    if (obj.format !== BACKUP_FORMAT) return 'Not a Holiday Hacker backup file.';
    if (obj.version !== BACKUP_VERSION) return 'Unsupported backup version.';
    if (!obj.keys || typeof obj.keys !== 'object') return 'Backup file is missing data.';
    var hasAny = false;
    for (var k in obj.keys) {
      if (!Object.prototype.hasOwnProperty.call(obj.keys, k)) continue;
      if (k.indexOf(KEY_PREFIX) !== 0) return 'Backup contains unexpected keys.';
      hasAny = true;
    }
    if (!hasAny) return 'Backup file is empty.';
    return null;
  }

  function wrongNameError(name) {
    var extra = name ? (' (“' + name + '”)') : '';
    return 'Please choose a Holiday Hacker backup (.json) named ' + BACKUP_NAME_HINT + extra + '.';
  }

  function notJsonError(name) {
    var extra = name ? (' (“' + name + '”)') : '';
    return 'Please choose a .json backup file' + extra + '.';
  }

  function parseBackupText(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) {
      return { ok: false, error: 'Could not read backup file (invalid JSON).' };
    }
    var err = validateBackup(obj);
    if (err) return { ok: false, error: err };
    return { ok: true, backup: obj };
  }

  function applyBackup(backup) {
    var err = validateBackup(backup);
    if (err) return { ok: false, error: err };

    cancelNativeAlarms();
    clearAppDataKeys();

    var written = 0;
    for (var k in backup.keys) {
      if (!Object.prototype.hasOwnProperty.call(backup.keys, k)) continue;
      try {
        localStorage.setItem(k, backup.keys[k]);
        written++;
      } catch (_) {}
    }

    try { sessionStorage.setItem(REARM_FLAG, '1'); } catch (_) {}

    return {
      ok: true,
      keyCount: written,
      exportedAt: backup.exportedAt || null
    };
  }

  function downloadBackupBlob(result) {
    var json = JSON.stringify(result.payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return {
      ok: true,
      filename: result.filename,
      keyCount: result.payload.keyCount,
      method: 'download'
    };
  }

  /** Returns a Promise<{ ok, filename?, keyCount?, error? }> */
  function downloadBackupFile() {
    var result = exportAppBackup();
    if (!result.ok) return Promise.resolve(result);

    var json = JSON.stringify(result.payload, null, 2);
    var p = backupPlugin();
    if (p && typeof p.saveBackup === 'function') {
      return p.saveBackup({ json: json, filename: result.filename }).then(function (res) {
        if (res && res.ok) {
          return {
            ok: true,
            filename: res.filename || result.filename,
            keyCount: result.payload.keyCount,
            method: res.location === 'Downloads' ? 'downloads' : 'saf'
          };
        }
        return {
          ok: false,
          error: (res && res.error) || 'Save cancelled.'
        };
      }).catch(function () {
        return { ok: false, error: 'Save failed.' };
      });
    }

    return Promise.resolve(downloadBackupBlob(result));
  }

  function readBackupFile(file) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve({ ok: false, error: 'No file selected.' });
        return;
      }
      if (!file.name || !/\.json$/i.test(file.name)) {
        resolve({ ok: false, error: notJsonError(file.name) });
        return;
      }
      if (!isBackupFilename(file.name)) {
        resolve({ ok: false, error: wrongNameError(file.name) });
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve(parseBackupText(String(reader.result || '')));
      };
      reader.onerror = function () {
        resolve({ ok: false, error: 'Could not read the selected file.' });
      };
      reader.readAsText(file);
    });
  }

  /** Native SAF picker on Android; rejects wrong filenames before parse. */
  function pickBackupFile() {
    var p = backupPlugin();
    if (p && typeof p.pickBackup === 'function') {
      return p.pickBackup().then(function (res) {
        if (!res || !res.ok) {
          if (res && res.error === 'not_json') {
            return { ok: false, error: notJsonError(res.filename) };
          }
          if (res && res.error === 'wrong_name') {
            return { ok: false, error: wrongNameError(res.filename) };
          }
          return { ok: false, error: (res && res.error) || 'No file selected.' };
        }
        return parseBackupText(res.json || '');
      }).catch(function () {
        return { ok: false, error: 'Could not open backup file.' };
      });
    }
    return Promise.resolve({ ok: false, error: 'native_pick_unavailable' });
  }

  function finishRestoreNavigation() {
    var base = appHref();
    try {
      var user = localStorage.getItem(KEY_PREFIX + 'user');
      if (!user) {
        window.location.href = base + 'index.html';
        return;
      }
      if (!localStorage.getItem(KEY_PREFIX + 'calSetup')) {
        window.location.href = base + 'calendar/index.html';
        return;
      }
    } catch (_) {}
    window.location.href = base + 'trips/index.html';
  }

  /** Paths from index.html (root) vs profile/calendar/… subfolders. */
  function appHref() {
    try {
      var path = (window.location.pathname || '').replace(/\\/g, '/');
      if (/\/(profile|calendar|plan|trips|holidays)\//.test(path)) return '../';
    } catch (_) {}
    return '';
  }

  function applyBackupAndNavigate(backup) {
    var applied = applyBackup(backup);
    if (!applied.ok) return { ok: false, error: applied.error };
    finishRestoreNavigation();
    return { ok: true, navigating: true, keyCount: applied.keyCount };
  }

  function restoreFromPickResult(pickResult) {
    if (!pickResult || !pickResult.ok) return pickResult || { ok: false, error: 'Restore failed.' };
    if (!pickResult.backup) return { ok: false, error: 'Backup file is missing data.' };
    return applyBackupAndNavigate(pickResult.backup);
  }

  function pickBackupForRestore() {
    return pickBackupFile().then(function (res) {
      if (res && res.error === 'native_pick_unavailable') {
        return { ok: false, needFileInput: true };
      }
      return res;
    });
  }

  window.HolidayHackerBackup = {
    backupFilename: backupFilename,
    isBackupFilename: isBackupFilename,
    isNativeBackupAvailable: isNativeBackupAvailable,
    exportAppBackup: exportAppBackup,
    downloadBackupFile: downloadBackupFile,
    pickBackupFile: pickBackupFile,
    pickBackupForRestore: pickBackupForRestore,
    readBackupFile: readBackupFile,
    applyBackup: applyBackup,
    applyBackupAndNavigate: applyBackupAndNavigate,
    restoreFromPickResult: restoreFromPickResult,
    finishRestoreNavigation: finishRestoreNavigation,
    BACKUP_NAME_HINT: BACKUP_NAME_HINT,
    REARM_FLAG: REARM_FLAG
  };
})();
