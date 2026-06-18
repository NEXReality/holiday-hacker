package in.holidayhacker.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service that loops the alarm tone on AudioManager.STREAM_ALARM
 * (bypasses ringer volume; respected as alarm by Do Not Disturb), holds a
 * partial wake lock, vibrates, and runs until explicitly stopped by Dismiss
 * or Snooze actions, or after a 5-minute safety timeout.
 */
public class AlarmAudioService extends Service {

    public static final String CHANNEL_ID = "alarm_ringing";
    public static final int NOTIFICATION_ID = 700001;
    private static final long MAX_RING_MS = 5L * 60L * 1000L;

    private MediaPlayer player;
    private PowerManager.WakeLock wakeLock;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::stopSelfSafe;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel();
        startForegroundCompat(buildNotification(intent));
        acquireWakeLock();
        startVibration();
        startPlayback();
        handler.postDelayed(autoStop, MAX_RING_MS);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(autoStop);
        stopPlayback();
        stopVibration();
        releaseWakeLock();
        super.onDestroy();
    }

    private void stopSelfSafe() {
        try { stopForeground(true); } catch (Throwable ignored) { }
        stopSelf();
    }

    private Notification buildNotification(Intent intent) {
        String id = intent != null ? intent.getStringExtra(AlarmReceiver.EXTRA_ID) : null;
        String title = intent != null ? intent.getStringExtra(AlarmReceiver.EXTRA_TITLE) : null;
        String body = intent != null ? intent.getStringExtra(AlarmReceiver.EXTRA_BODY) : null;
        if (title == null || title.isEmpty()) title = getString(R.string.alarm_now_ringing);
        if (body == null) body = "";

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        Intent fullScreen = new Intent(this, AlarmRingActivity.class);
        if (intent != null) fullScreen.putExtras(intent);
        fullScreen.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_NO_HISTORY
            | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
        );
        PendingIntent fullScreenPi = PendingIntent.getActivity(
            this,
            id == null ? 0 : AlarmStorage.requestCodeFor(id) + 11,
            fullScreen,
            piFlags
        );

        Intent dismiss = new Intent(this, AlarmReceiver.class)
            .setAction(AlarmReceiver.ACTION_DISMISS)
            .putExtra(AlarmReceiver.EXTRA_ID, id == null ? "" : id);
        PendingIntent dismissPi = PendingIntent.getBroadcast(
            this,
            id == null ? 0 : AlarmStorage.requestCodeFor(id) + 12,
            dismiss,
            piFlags
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreenPi, true)
            .setContentIntent(fullScreenPi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel,
                getString(R.string.alarm_dismiss), dismissPi)
            .build();
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
                return;
            } catch (Throwable ignored) { }
        }
        startForeground(NOTIFICATION_ID, notification);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.alarm_service_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(getString(R.string.alarm_service_channel_description));
        channel.setShowBadge(false);
        channel.setSound(null, null);
        nm.createNotificationChannel(channel);
    }

    private Uri pickAlarmUri() {
        try {
            int rawId = getResources().getIdentifier("alarm_tone", "raw", getPackageName());
            if (rawId != 0) {
                return Uri.parse("android.resource://" + getPackageName() + "/" + rawId);
            }
        } catch (Throwable ignored) { }
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u != null) return u;
        u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (u != null) return u;
        return Settings.System.DEFAULT_ALARM_ALERT_URI;
    }

    private void startPlayback() {
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            player.setLooping(true);
            Uri sound = pickAlarmUri();
            player.setDataSource(this, sound);
            player.setOnPreparedListener(MediaPlayer::start);
            player.setOnErrorListener((mp, what, extra) -> false);
            player.prepareAsync();

            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                int target = (int) Math.round(max * 0.85);
                if (target < 1) target = max;
                am.setStreamVolume(AudioManager.STREAM_ALARM, target, 0);
            }
        } catch (Throwable t) {
            stopPlayback();
        }
    }

    private void stopPlayback() {
        try {
            if (player != null) {
                if (player.isPlaying()) player.stop();
                player.release();
            }
        } catch (Throwable ignored) { }
        player = null;
    }

    private void startVibration() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm != null ? vm.getDefaultVibrator() : null;
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null) return;

            long[] pattern = { 0, 800, 400, 800, 400 };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), attrs);
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Throwable ignored) { }
    }

    private void stopVibration() {
        try {
            if (vibrator != null) vibrator.cancel();
        } catch (Throwable ignored) { }
        vibrator = null;
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "HolidayHacker:AlarmAudio"
            );
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(MAX_RING_MS);
        } catch (Throwable ignored) { }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) { }
        wakeLock = null;
    }
}
