# Play Store release — step-by-step (Holiday Hacker)

End-to-end checklist from a clean dev tree to a live Play Store listing.  
**Package:** `in.holidayhacker.app` · **App name:** Holiday Hacker

---

## What ships inside the APK (and what does not)

Capacitor only bundles the **`www/`** folder (built by `npm run sync:www`). The script copies **only**:

| Included | Excluded (stays on your PC) |
|----------|-----------------------------|
| `index.html`, `app.js`, `boot-version.js`, `holiday-shift.js`, `styles.css`, `privacy.html` | `scripts/`, `android/`, `node_modules/`, `www/` |
| `calendar/`, `plan/`, `trips/`, `profile/`, `holidays/` (JS + HTML only) | `BUILD.md`, `STORE_LISTING.md`, `Todo.txt`, CSVs, test folders |
| `database/` (holidays, destinations, `state-city/`, `recommendation/config.json`) | `*.md`, `*.map`, `*.log`, dev docs under `database/recommendation/` |

After sync, expect roughly **~130 files / ~8–9 MB** of web assets (mostly JSON).  
Root clutter does **not** get packed unless it lives inside one of the folders above.

---

## Phase A — One-time prerequisites

1. **Node.js 18+** — `node --version`
2. **Android Studio** — https://developer.android.com/studio  
   Open once, install SDK **API 35**, accept licenses.
3. **Google Play Console account** — https://play.google.com/console (one-time $25 registration).
4. **Privacy policy URL** — host `privacy.html` on a public HTTPS URL (e.g. `https://holidayhacker.in/privacy.html` or a GitHub Pages link). Play Console requires this before production.

---

## Phase B — Prepare the release build (every release)

### B1. Install dependencies

```powershell
cd "e:\Nex\Travel optimization planner\holiday-hacker"
npm install
```

### B2. Build a clean `www/` and sync into Android

```powershell
npm run android:sync
```

This runs `sync:www` (filtered copy) then `npx cap sync android`.

### B3. Bump version (required for every Play upload)

Edit `android/app/build.gradle`:

```gradle
versionCode 2        // integer, must increase every upload
versionName "1.0.1"  // user-visible version string
```

### B4. Create a signing keystore (one-time only)

```powershell
keytool -genkey -v -keystore holiday-hacker-release.jks -alias holidayhacker -keyalg RSA -keysize 2048 -validity 10000
```

Store the `.jks` file **outside git** (already in `.gitignore`).  
**If you lose this file, you cannot update the same Play listing.**

### B5. Configure signing

```powershell
copy android\keystore.properties.example android\keystore.properties
```

Edit `android/keystore.properties` with your passwords and path to the `.jks` file.

### B6. Build the release App Bundle (AAB)

Preferred for Play Store:

```powershell
npm run android:release:bundle
```

Output (typical path):

`android\app\build\outputs\bundle\release\app-release.aab`

Optional APK for sideload testing only:

```powershell
npm run android:release:apk
```

→ `android\app\build\outputs\apk\release\app-release.apk`

### B7. Smoke-test before upload

Install the release APK on a real phone (USB debugging) or use **Internal testing** in Play Console.

Minimum checks:

- [ ] Onboarding → Calendar → Plan → Trips → Profile all load offline
- [ ] Profile → **Reminder Test** → 30 s alarm rings (grant notifications + exact alarms)
- [ ] Confirm a trip → reminders toggle ON → `listScheduled()` shows alarms (Chrome `chrome://inspect` if needed)
- [ ] Play Store in-app update check does not crash (no update available is OK on first publish)

---

## Phase C — Play Console setup (first time)

Go to https://play.google.com/console → **Create app**.

| Field | Value |
|-------|--------|
| App name | Holiday Hacker |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |

Work through **Dashboard → Set up your app** until all required sections show complete.

### C1. App access

- **All functionality available without special access** (no login).

### C2. Ads

- **No**, the app does not contain ads.

### C3. Content rating

- Start questionnaire → **Utility, Productivity, Communication or Other** style app.  
- No UGC, no violence, no gambling. Expected: **Everyone / PEGI 3**.

### C4. Target audience

- **18 and over** (or 13+ if you prefer broader; no child-directed content).

### C5. News app / COVID tracing / Government / Financial / Health

- All **No** (unless you change product scope).

### C6. Data safety

Use answers consistent with the app (local-only data):

- **Collect or share user data?** → No (data stays on device).
- **Encrypted in transit** → N/A or Yes only for optional external links user opens.
- **Delete data** → Uninstall / Profile → Clear data.
- **Account required?** → No.

### C7. Privacy policy

- Paste your **public HTTPS URL** to `privacy.html`.

### C8. Store listing (Main store listing)

Copy text from **`STORE_LISTING.md`** in this repo:

- Short description (80 chars)
- Full description (4000 chars)
- **App icon** 512×512 PNG
- **Feature graphic** 1024×500 PNG/JPEG
- **Phone screenshots** 2–8 (1080×1920 recommended)

Suggested screenshot order:

1. Onboarding / home chat  
2. Calendar with bridge highlights  
3. Plan + destination cards  
4. Trips with reminders ON  
5. Full-screen alarm UI (30 s test)  
6. Profile (optional)

### C9. App category

- **Travel & Local** (primary)

### C10. Contact details

- Email: **info@nexreality.io** (matches Profile contact)

---

## Phase D — Sensitive permissions (declaration forms)

Play may ask why you use alarm-related permissions. Use the verbatim answers in **`STORE_LISTING.md`** → *Permission justifications* for:

- `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`
- `USE_FULL_SCREEN_INTENT`
- `FOREGROUND_SERVICE` (media playback)
- `RECEIVE_BOOT_COMPLETED`
- `POST_NOTIFICATIONS`

Your long description should mention **loud alarms for leave and booking reminders** so review aligns with manifest.

---

## Phase E — Upload and roll out

### E1. Internal testing (recommended first)

1. **Testing → Internal testing** → Create release  
2. Upload **`app-release.aab`**  
3. Add tester emails (your Gmail + one friend)  
4. Save → **Review release** → Start rollout to internal testers  
5. Open the opt-in link on a phone, install, run Phase B7 checks again  

### E2. Closed / Open testing (optional)

Use if you want a wider beta before production.

### E3. Production

1. **Production** → Create new release  
2. Upload the same (or newer) AAB with higher `versionCode`  
3. **Release notes** (example):  
   `Initial release: holiday bridge planner, trip reminders, and loud booking/leave alarms.`  
4. Submit for review  

**First review:** often 1–7 days. **Updates:** often ~24 hours.

---

## Phase F — Every future update

```powershell
# 1. Edit web or Java sources
# 2. Bump versionCode + versionName in android/app/build.gradle
npm run android:release:bundle
# 3. Play Console → Production (or testing track) → new release → upload AAB
```

Web-only changes do **not** require users to re-onboard; local data is kept.  
Play **In-App Updates** (in `boot-version.js`) can prompt users to install the new APK from Play Store.

---

## Quick reference — npm scripts

| Command | Purpose |
|---------|---------|
| `npm run sync:www` | Rebuild filtered `www/` only |
| `npm run android:sync` | `sync:www` + Capacitor sync to `android/` |
| `npm run android:open` | Sync + open Android Studio |
| `npm run android:release:bundle` | Sync + signed **AAB** for Play Store |
| `npm run android:release:apk` | Sync + signed **APK** for local install |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Gradle “SDK not found” | Open Android Studio → SDK Manager → install API 35 |
| Release build unsigned | Create `android/keystore.properties` from example |
| AAB upload rejected (version) | Increase `versionCode` |
| Alarms don’t fire on Xiaomi/Oppo/Vivo | Profile documents battery/autostart; user must allow |
| APK huge (>50 MB) | Run `npm run sync:www` and check log; ensure `scripts/` not inside `www/` |

---

## Files to keep safe (not in git)

- `holiday-hacker-release.jks` (or your `.keystore`)
- `android/keystore.properties`
- Play Console account + 2FA

---

## Related docs in this repo

- **`BUILD.md`** — debug builds, alarm testing, OEM battery notes  
- **`STORE_LISTING.md`** — copy-paste store text + permission answers  
