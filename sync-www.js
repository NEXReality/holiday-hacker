/*
 * Build helper: copies ONLY runtime web assets into www/ for Capacitor (APK WebView).
 *
 * The project root has dev-only folders (scripts/, android/, node_modules/, …)
 * that are never copied. When copying allowed folders, dev artifacts (*.md,
 * logs, editor files, etc.) are skipped.
 *
 * Run: npm run sync:www
 */

const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const DST = path.join(__dirname, 'www');

/** Top-level folders that ship inside the app. Everything else stays out. */
const COPY_DIRS = [
  'calendar',
  'database',
  'holidays',
  'plan',
  'profile',
  'trips'
];

/** Root files copied as-is. */
const COPY_FILES = [
  'index.html',
  'app.js',
  'boot-version.js',
  'backup-restore.js',
  'alarm-reliability.js',
  'onboard-scroll.js',
  'holiday-shift.js',
  'styles.css',
  'privacy.html',
  'manifest.webmanifest'
];

/** Directory names skipped anywhere in the tree. */
const SKIP_DIR_NAMES = new Set([
  '.git', '.svn', '.cursor', 'node_modules', 'scripts', 'wikidata-test',
  'wikivoyage-test', 'destination-data', 'train', '__pycache__', '.idea'
]);

/** File names skipped anywhere. */
const SKIP_FILE_NAMES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep'
]);

/** Extensions skipped (dev docs, maps, logs — not used at runtime). */
const SKIP_EXTENSIONS = new Set([
  '.md', '.markdown', '.map', '.log', '.bak', '.tmp', '.temp',
  '.ts', '.tsx', '.jsx', '.vue', '.scss', '.less', '.sass',
  '.csv', '.xlsx', '.xls', '.psd', '.sketch', '.fig'
]);

/** Exact basenames to skip even if extension is allowed. */
const SKIP_BASENAMES = new Set([
  'Project plan.txt', 'Todo.txt', 'package.json', 'package-lock.json',
  'capacitor.config.json', 'sync-www.js', 'README.md'
]);

let stats = { files: 0, bytes: 0, skipped: 0 };

function shouldSkip(relPath, name, isDir) {
  if (isDir) return SKIP_DIR_NAMES.has(name);
  if (SKIP_FILE_NAMES.has(name)) return true;
  if (SKIP_BASENAMES.has(name)) return true;
  const ext = path.extname(name).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return true;
  /* Dev-only recommendation docs (config.json must ship). */
  const norm = relPath.replace(/\\/g, '/').toLowerCase();
  if (norm.indexOf('database/recommendation/') === 0 && ext === '.md') return true;
  return false;
}

function copyTree(srcDir, dstDir, relBase) {
  fs.mkdirSync(dstDir, { recursive: true });
  var entries = fs.readdirSync(srcDir, { withFileTypes: true });
  entries.forEach(function (ent) {
    var rel = relBase ? relBase + '/' + ent.name : ent.name;
    var src = path.join(srcDir, ent.name);
    var dst = path.join(dstDir, ent.name);
    if (ent.isDirectory()) {
      if (shouldSkip(rel, ent.name, true)) {
        stats.skipped++;
        return;
      }
      copyTree(src, dst, rel);
      return;
    }
    if (shouldSkip(rel, ent.name, false)) {
      stats.skipped++;
      return;
    }
    fs.copyFileSync(src, dst);
    stats.files++;
    stats.bytes += fs.statSync(src).size;
  });
}

function clean(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyOne(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  stats.files++;
  stats.bytes += fs.statSync(src).size;
}

clean(DST);
stats = { files: 0, bytes: 0, skipped: 0 };

var rootCount = 0;
COPY_FILES.forEach(function (file) {
  var src = path.join(SRC, file);
  if (fs.existsSync(src)) {
    copyOne(src, path.join(DST, file));
    rootCount++;
  } else {
    console.warn('[sync-www] missing root file:', file);
  }
});

var dirCount = 0;
COPY_DIRS.forEach(function (dir) {
  var srcDir = path.join(SRC, dir);
  if (fs.existsSync(srcDir)) {
    copyTree(srcDir, path.join(DST, dir), dir);
    dirCount++;
  } else {
    console.warn('[sync-www] missing directory:', dir);
  }
});

var iconDir = path.join(SRC, 'icon');
if (fs.existsSync(iconDir)) {
  copyTree(iconDir, path.join(DST, 'icon'), 'icon');
  dirCount++;
} else {
  console.warn('[sync-www] missing directory: icon (run npm run android:icon)');
}

var sizeMb = (stats.bytes / (1024 * 1024)).toFixed(2);
console.log('[sync-www] copied ' + rootCount + ' root file(s) + ' + dirCount + ' folder(s)');
console.log('[sync-www] runtime files: ' + stats.files + ' (' + sizeMb + ' MB), skipped: ' + stats.skipped);
