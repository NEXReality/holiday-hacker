# Google Play Store listing — Holiday Hacker

Copy-paste-ready content for the Play Console "Main store listing" section,
along with asset specs and the permission justifications that protect the
alarm-related permissions during review.

## App identity

- **App name**: Holiday Hacker
- **Package name** (set automatically): `in.holidayhacker.app`
- **Default language**: English (United States)
- **App or game**: App
- **Free or paid**: Free
- **Category** (primary): Travel & Local
- **Tags** (Play Console): travel, planner, calendar, alarm, reminders

## Short description (max 80 characters)

> Plan smarter trips. Get loud, on-time alarms for leave applications and bookings.

(78 chars — under the 80 limit. Edit freely; keep "alarm" / "reminder" in
text so reviewers see the alarm-app intent.)

## Long description (max 4000 characters)

```
Holiday Hacker turns your country's holiday calendar into smart trip plans
and rings real alarms for the things you must not forget — submitting your
leave application, and opening the booking window for your train, bus or
flight.

CORE FEATURES

Trip planner that maximises long weekends
- Detects "Bridge", "Mega-Bridge" and free holiday windows automatically.
- Picks the smallest number of leaves that unlocks the longest break.
- Suggests destinations matched to the length of each window.

Loud, OS-grade alarm reminders (the reason this is an app, not a website)
- Schedule a leave-application alarm 30 days before each trip (configurable).
- Schedule a transport-booking alarm at the right moment for train (60 days),
  bus (30 days) or flight (45 days) prior — both at the booking-portal-open
  hour.
- Alarms fire even with the phone locked and Do Not Disturb on, just like
  the system clock app. They use the alarm audio stream so they ring loud
  and the screen wakes with a Dismiss / Snooze 10-min action.
- Alarms survive reboot and app updates.

Offline-first, privacy-first
- All destination, holiday and city data ships inside the app — no internet
  needed to plan a trip.
- No account, no login, no analytics, no advertising.
- Your trips and reminders stay on your device. We do not run a server.

Calendar export
- Add any trip to Google Calendar in two taps, or export an .ics file your
  default Calendar app can import on its own.

WHY ALARMS, NOT NOTIFICATIONS

Most reminder apps send silent or near-silent notifications that get lost in
Do Not Disturb. Holiday Hacker is built around alarm-clock-style reminders
because the cost of missing a leave application or a booking window is real
— so the app uses the same OS APIs that real alarm clocks use.

PERMISSIONS

To deliver loud, on-time alarms the app uses Schedule Exact Alarms,
Full-Screen Intent and Notifications. None of these grant access to your
data; they only let the app act as an alarm clock for trip events.

Roadmap: support for more states and countries, and an iOS version with
Calendar-based alarms (iOS does not allow third-party loud alarms).

Made for travellers in India to start; expanding state by state.
```

(~1,950 chars — well under the 4,000 limit.)

## Permission justifications (for Play Console form)

Play Console asks why you use sensitive permissions. Use these answers
verbatim to give review the language they expect.

### `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`

> Holiday Hacker is a calendar / alarm app whose core user-facing
> functionality is to ring a loud alarm at a specific date and time chosen
> by the user (e.g., "leave application 30 days before my trip" or "open
> train booking at 8:00 AM 60 days before my trip"). The app has no other
> way to deliver these reminders on time, since silent or inexact
> notifications are throttled by Doze and would defeat the purpose.

### `USE_FULL_SCREEN_INTENT`

> The app falls in the alarm / calendar category. When a scheduled trip
> alarm fires, we present a full-screen Dismiss / Snooze UI just like the
> system Clock app. This is the standard UX for time-critical alarms and
> is essential to the app's value proposition. The intent is only used by
> alarms scheduled directly by the user.

### `FOREGROUND_SERVICE` (mediaPlayback type)

> A short foreground service plays the alarm tone and holds a wake lock
> while the alarm is ringing, and stops as soon as the user taps Dismiss
> or Snooze (or after a 5-minute safety timeout). Without this, Android
> can mute or kill the alarm sound mid-ring.

### `RECEIVE_BOOT_COMPLETED`

> Used to re-arm the user's pending trip alarms after a phone reboot or
> app update. Without this, alarms scheduled before reboot would silently
> disappear.

### `POST_NOTIFICATIONS`

> Required on Android 13+ to show the alarm notification (with the
> full-screen intent attached). The app does not send marketing or
> promotional notifications — only the alarm itself.

## Data Safety form answers

- **Does your app collect or share any of the required user data types?**
  No.
- **Is all of the user data collected by your app encrypted in transit?**
  Yes (the only network calls are external Google Calendar template URLs
  the user opens explicitly).
- **Do you provide a way for users to request that their data is deleted?**
  Yes — uninstalling the app removes all locally stored trip data.
- **Has your app been independently validated against a global security
  standard?** No.

## Content rating

Use Play Console's IARC questionnaire. Expected outcome: PEGI 3 / Everyone.
The app contains no user-generated content, no chat, no purchases, no
violence/sexual themes. Just trip planning and alarms.

## Required visual assets

Create these and upload via Play Console -> Main store listing.

### App icon
- **Size**: 512 x 512 px
- **Format**: PNG (32-bit, no alpha for the master)
- **Notes**: Should match the in-app launcher icon (`android/app/src/main/res/mipmap-*/ic_launcher.png`).
  If you replace these, regenerate via Image Asset Studio in Android Studio
  (Right-click `res` -> New -> Image Asset).

### Feature graphic
- **Size**: 1024 x 500 px
- **Format**: PNG or JPEG (no transparency)
- **Notes**: This is the wide banner shown at the top of the listing on
  most devices. Recommended content: a sample trip card + the words
  "Loud alarms for trips you'd hate to miss."

### Phone screenshots (2-8 required)
- **Size**: 1080 x 1920 px (or any 16:9 / 9:16 phone resolution)
- **Format**: PNG or JPEG
- **Notes**: Take real screenshots of these screens, in this order:
  1. Onboarding / Home with chat
  2. Plan page (calendar with bridge highlights)
  3. Trips card with the Reminders toggle and "Apply Leave" reminder block
  4. The full-screen alarm UI (run a 30-second test alarm and screenshot
     when it fires, with the phone locked over a wallpaper)
  5. Add to Calendar sheet showing Google Calendar / iCalendar export
  6. (Optional) Profile page

### Tablet screenshots
Optional. If you skip them, the listing only appears on phones.

## Steps in Play Console

1. Create app -> name "Holiday Hacker", default language English (US),
   App, Free.
2. Set up your app -> work through the policy declarations: Privacy policy
   URL (point to the hosted `privacy.html`), Ads (No), App access
   (No special access), Content rating (run questionnaire), Target
   audience (Adults), News app (No), COVID-19 contact tracing (No),         
   Data safety (use answers above), Government app (No), Financial
   features (No), Health (No).
3. Main store listing -> upload short/long description, app icon, feature
   graphic, screenshots.
4. Internal testing -> create release -> upload signed AAB ->
   add testers (1-2 emails, e.g. yourself + a friend).
5. Review and roll out to internal testers.
6. Once you're satisfied, promote to Production.

First production review: 1-7 days. Updates after that: ~24 hours.
