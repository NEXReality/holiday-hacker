/*
 * Uses icon/app-icon.png as-is (opaque squircle PNG is fine).
 * Android launcher uses a 16% XML inset so the system mask does not crop/zoom the art.
 * Fallback: icon/Holiday hacker_icon.jpg, then icon/Holiday hacker_icon.png
 *
 * Copies into www/icon/ and Android mipmap launcher PNGs (no resize, padding, or crop).
 * Run: npm run android:icon
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICON_APP = path.join(ROOT, 'icon', 'app-icon.png');
const ICON_JPG = path.join(ROOT, 'icon', 'Holiday hacker_icon.jpg');
const ICON_LEGACY = path.join(ROOT, 'icon', 'Holiday hacker_icon.png');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const WWW_ICON = path.join(ROOT, 'www', 'icon', 'app-icon.png');

const DENSITIES = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
const LAUNCHER_NAMES = ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'];

function resolveIconSource() {
  if (fs.existsSync(ICON_APP)) {
    return { src: ICON_APP, label: 'icon/app-icon.png' };
  }
  if (fs.existsSync(ICON_JPG)) {
    return { src: ICON_JPG, label: 'icon/Holiday hacker_icon.jpg' };
  }
  if (fs.existsSync(ICON_LEGACY)) {
    return { src: ICON_LEGACY, label: 'icon/Holiday hacker_icon.png' };
  }
  return null;
}

function copyIcon(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

var resolved = resolveIconSource();
if (!resolved) {
  console.error('[install-app-icon] missing: icon/app-icon.png (or .jpg / Holiday hacker_icon.png fallback)');
  process.exit(1);
}

var ICON_SRC = resolved.src;
console.log('[install-app-icon] source:', resolved.label, '(copied as-is)');

if (ICON_SRC !== ICON_APP) {
  copyIcon(ICON_SRC, ICON_APP);
  console.log('[install-app-icon] wrote icon/app-icon.png');
}

copyIcon(ICON_SRC, WWW_ICON);
console.log('[install-app-icon] www/icon/app-icon.png');

DENSITIES.forEach(function (density) {
  LAUNCHER_NAMES.forEach(function (name) {
    copyIcon(ICON_SRC, path.join(ANDROID_RES, density, name));
  });
});
console.log('[install-app-icon] Android mipmap PNGs updated (' + DENSITIES.length + ' densities)');
console.log('[install-app-icon] adaptive inset: drawable/ic_launcher_foreground_inset.xml (16%)');
console.log('[install-app-icon] notifications use drawable/ic_stat_notification.xml (white silhouette)');

const bgXml = path.join(ANDROID_RES, 'values', 'ic_launcher_background.xml');
fs.writeFileSync(
  bgXml,
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#9333EA</color>\n</resources>\n'
);
