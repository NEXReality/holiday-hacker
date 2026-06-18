package in.holidayhacker.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Fires when AlarmManager triggers a scheduled trip alarm.
 *
 * Responsibilities:
 *  - Start the AlarmAudioService so sound plays immediately.
 *  - Post a high-importance CATEGORY_ALARM notification with setFullScreenIntent
 *    pointing to AlarmRingActivity. On modern Android this brings up the
 *    full-screen activity even from a locked / Do Not Disturb device.
 *  - Remove the entry from persisted storage (it has fired).
 */
public class AlarmReceiver extends BroadcastReceiver {

    public static final String ACTION_FIRE = "in.holidayhacker.app.ALARM_FIRE";
    public static final String ACTION_SNOOZE = "in.holidayhacker.app.ALARM_SNOOZE";
    public static final String ACTION_DISMISS = "in.holidayhacker.app.ALARM_DISMISS";

    public static final String EXTRA_ID = "alarm_id";
    public static final String EXTRA_TITLE = "alarm_title";
    public static final String EXTRA_BODY = "alarm_body";
    public static final String EXTRA_DEST_NAME = "alarm_dest_name";
    public static final String EXTRA_DEST_STATE = "alarm_dest_state";
    public static final String EXTRA_WINDOW_NAME = "alarm_window_name";
    public static final String EXTRA_WINDOW_START = "alarm_window_start";
    public static final String EXTRA_WINDOW_END = "alarm_window_end";
    public static final String EXTRA_WINDOW_DAYS = "alarm_window_days";
    public static final String EXTRA_MODE = "alarm_mode";
    public static final String EXTRA_IMAGE_PATH = "alarm_image_path";

    public static final String CHANNEL_ID = "trip_alarms";
    public static final String NOTIFY_CHANNEL_ID = "trip_reminders";
    public static final int NOTIFICATION_ID_BASE = 700000;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        String id = intent.getStringExtra(EXTRA_ID);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        if (id == null) id = "";
        if (title == null) title = ctx.getString(R.string.alarm_now_ringing);
        if (body == null) body = "";

        if (ACTION_DISMISS.equals(action)) {
            stopAlarm(ctx, id);
            return;
        }

        if (ACTION_SNOOZE.equals(action)) {
            stopAlarm(ctx, id);
            long snoozeAt = System.currentTimeMillis() + 10L * 60L * 1000L;
            String snoozeId = id.isEmpty() ? ("snooze-" + System.currentTimeMillis()) : id;
            AlarmStorage.AlarmEntry entry = new AlarmStorage.AlarmEntry(snoozeId, snoozeAt, title, body);
            AlarmStorage.AlarmEntry prior = findEntry(ctx, id);
            if (prior != null) {
                entry.destName    = prior.destName;
                entry.destState   = prior.destState;
                entry.windowName  = prior.windowName;
                entry.windowStart = prior.windowStart;
                entry.windowEnd   = prior.windowEnd;
                entry.windowDays  = prior.windowDays;
                entry.mode        = prior.mode;
                entry.imageUrl    = prior.imageUrl;
                entry.imagePath   = prior.imagePath;
            }
            AlarmStorage.upsert(ctx, entry);
            HolidayAlarmPlugin.armAlarm(ctx, entry);
            return;
        }

        ensureChannel(ctx);
        boolean isLeaveReminder = id.startsWith("leave-");
        boolean isBookingPreReminder = id.startsWith("book-pre-") || id.startsWith("book-return-pre-");
        boolean isHolidayPlanReminder = id.startsWith("holiday-");
        boolean notificationOnly = isLeaveReminder || isBookingPreReminder || isHolidayPlanReminder;

        // Pull persisted trip context (image path, dates, window name) for richer rendering.
        AlarmStorage.AlarmEntry persisted = findEntry(ctx, id);

        if (notificationOnly) {
            notifyOnly(ctx, id, title, body, persisted);
            AlarmStorage.remove(ctx, id);
            return;
        }

        Intent svc = new Intent(ctx, AlarmAudioService.class);
        svc.putExtra(EXTRA_ID, id);
        svc.putExtra(EXTRA_TITLE, title);
        svc.putExtra(EXTRA_BODY, body);
        ContextCompat.startForegroundService(ctx, svc);

        Intent activityIntent = new Intent(ctx, AlarmRingActivity.class);
        activityIntent.putExtra(EXTRA_ID, id);
        activityIntent.putExtra(EXTRA_TITLE, title);
        activityIntent.putExtra(EXTRA_BODY, body);
        if (persisted != null) {
            if (persisted.destName    != null) activityIntent.putExtra(EXTRA_DEST_NAME, persisted.destName);
            if (persisted.destState   != null) activityIntent.putExtra(EXTRA_DEST_STATE, persisted.destState);
            if (persisted.windowName  != null) activityIntent.putExtra(EXTRA_WINDOW_NAME, persisted.windowName);
            if (persisted.windowStart != null) activityIntent.putExtra(EXTRA_WINDOW_START, persisted.windowStart);
            if (persisted.windowEnd   != null) activityIntent.putExtra(EXTRA_WINDOW_END, persisted.windowEnd);
            if (persisted.windowDays  >  0)    activityIntent.putExtra(EXTRA_WINDOW_DAYS, persisted.windowDays);
            if (persisted.mode        != null) activityIntent.putExtra(EXTRA_MODE, persisted.mode);
            if (persisted.imagePath   != null) activityIntent.putExtra(EXTRA_IMAGE_PATH, persisted.imagePath);
        }
        activityIntent.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_NO_HISTORY
            | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
        );

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent fullScreenPi = PendingIntent.getActivity(
            ctx,
            AlarmStorage.requestCodeFor(id) + 1,
            activityIntent,
            piFlags
        );

        PendingIntent dismissPi = PendingIntent.getBroadcast(
            ctx,
            AlarmStorage.requestCodeFor(id) + 2,
            new Intent(ctx, AlarmReceiver.class)
                .setAction(ACTION_DISMISS)
                .putExtra(EXTRA_ID, id),
            piFlags
        );

        PendingIntent snoozePi = PendingIntent.getBroadcast(
            ctx,
            AlarmStorage.requestCodeFor(id) + 3,
            new Intent(ctx, AlarmReceiver.class)
                .setAction(ACTION_SNOOZE)
                .putExtra(EXTRA_ID, id)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_BODY, body),
            piFlags
        );

        NotificationCompat.Builder nb = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(false)
            .setOngoing(true)
            .setFullScreenIntent(fullScreenPi, true)
            .setContentIntent(fullScreenPi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel,
                ctx.getString(R.string.alarm_dismiss), dismissPi)
            .addAction(android.R.drawable.ic_lock_idle_alarm,
                ctx.getString(R.string.alarm_snooze), snoozePi);

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID_BASE + AlarmStorage.requestCodeFor(id), nb.build());
        }

        AlarmStorage.remove(ctx, id);
    }

    private void notifyOnly(Context ctx, String id, String title, String body, AlarmStorage.AlarmEntry persisted) {
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        String route = LaunchRouter.routeForHolidayAlarm(id, persisted);

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (route != null) {
            openIntent.putExtra(LaunchRouter.EXTRA_ROUTE, route);
        }
        PendingIntent contentPi = PendingIntent.getActivity(
            ctx,
            AlarmStorage.requestCodeFor(id) + 20,
            openIntent,
            piFlags
        );

        ensureReminderChannel(ctx);
        NotificationCompat.Builder nb = new NotificationCompat.Builder(ctx, NOTIFY_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setOngoing(false)
            .setContentIntent(contentPi);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID_BASE + AlarmStorage.requestCodeFor(id), nb.build());
        }
    }

    private static AlarmStorage.AlarmEntry findEntry(Context ctx, String id) {
        if (id == null || id.isEmpty()) return null;
        for (AlarmStorage.AlarmEntry e : AlarmStorage.readAll(ctx)) {
            if (id.equals(e.id)) return e;
        }
        return null;
    }

    static void stopAlarm(Context ctx, String id) {
        Intent stop = new Intent(ctx, AlarmAudioService.class);
        ctx.stopService(stop);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && id != null) {
            nm.cancel(NOTIFICATION_ID_BASE + AlarmStorage.requestCodeFor(id));
        }
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            ctx.getString(R.string.alarm_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(ctx.getString(R.string.alarm_channel_description));
        channel.setBypassDnd(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        channel.enableLights(true);

        AudioAttributes audioAttrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(Settings.System.DEFAULT_ALARM_ALERT_URI, audioAttrs);

        nm.createNotificationChannel(channel);
    }

    static void ensureReminderChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(NOTIFY_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            NOTIFY_CHANNEL_ID,
            "Trip reminders",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("General reminder notifications");
        channel.setBypassDnd(false);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        channel.enableVibration(false);
        channel.enableLights(false);
        channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, null);
        nm.createNotificationChannel(channel);
    }
}
