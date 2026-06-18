# Holiday Hacker

Offline-first Indian holiday and trip planner (HTML/CSS/JS + Capacitor Android).

- **Package:** `in.holidayhacker.app`
- **Contact:** info@nexreality.io

## Prerequisites

Node.js 18+, Android Studio (SDK API 35), JDK via Android Studio.

## Commands

```powershell
npm install
npm run serve              # browser preview at localhost:5173
npm run android:sync       # rebuild www/ and sync into android/
npm run android:open       # sync + open Android Studio
npm run android:release:bundle   # signed AAB for Play Store
```

Release AAB output: `android/app/build/outputs/bundle/release/app-release.aab`

Signing: copy `android/keystore.properties.example` to `android/keystore.properties` and point at your upload keystore (not in git).

## Project layout

| Path | Purpose |
|------|---------|
| `calendar/`, `plan/`, `trips/`, `profile/`, `holidays/` | App screens |
| `database/` | Bundled holiday & destination JSON |
| `android/` | Capacitor native shell (alarms, backup) |
| `scripts/` | Icon install, data enrichment |
| `sync-www.js` | Copies runtime assets into `www/` |
| `privacy.html` | Privacy policy (also host at HTTPS for Play Console) |
| `Feature graphic/`, `phone screenshots/` | Play Store assets |

Web source lives at the repo root; `www/` is generated — do not edit by hand.
