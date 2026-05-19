package in.holidayhacker.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor bridge for scheduling true OS-grade loud alarms.
 *
 * JS surface (mounted at window.HolidayAlarm by Capacitor):
 *   schedule({ id, timestamp, title, body }) -> { ok }
 *   cancel({ id })                            -> { ok }
 *   cancelAll()                                -> { ok }
 *   listScheduled()                            -> { alarms: [...] }
 *   hasPermissions()                           -> { notifications, exactAlarms }
 *   requestPermissions()                       -> opens system dialogs
 */
@CapacitorPlugin(name = "HolidayAlarm")
public class HolidayAlarmPlugin extends Plugin {

    private static final ExecutorService IMAGE_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final String IMAGE_CACHE_DIR = "alarm-hero";

    @PluginMethod
    public void schedule(PluginCall call) {
        String id = call.getString("id");
        Long timestamp = call.getLong("timestamp");
        String title = call.getString("title", "Holiday Hacker");
        String body = call.getString("body", "");

        if (id == null || id.isEmpty()) {
            call.reject("Missing id");
            return;
        }
        if (timestamp == null || timestamp <= 0) {
            call.reject("Missing or invalid timestamp");
            return;
        }
        if (timestamp <= System.currentTimeMillis()) {
            call.reject("timestamp must be in the future");
            return;
        }

        Context ctx = getContext();
        AlarmStorage.AlarmEntry entry = new AlarmStorage.AlarmEntry(id, timestamp, title, body);
        entry.destName    = call.getString("destName");
        entry.destState   = call.getString("destState");
        entry.windowName  = call.getString("windowName");
        entry.windowStart = call.getString("windowStart");
        entry.windowEnd   = call.getString("windowEnd");
        Integer wd        = call.getInt("windowDays");
        entry.windowDays  = wd == null ? 0 : wd;
        entry.mode        = call.getString("mode");
        entry.imageUrl    = call.getString("imageUrl");

        cancelByIdInternal(ctx, id);
        AlarmStorage.upsert(ctx, entry);

        boolean armed = armAlarm(ctx, entry);

        if (entry.imageUrl != null && !entry.imageUrl.isEmpty()) {
            final String fId = id;
            final String fUrl = entry.imageUrl;
            IMAGE_EXECUTOR.submit(() -> cacheHeroImage(ctx, fId, fUrl));
        }

        JSObject ret = new JSObject();
        ret.put("ok", armed);
        ret.put("id", id);
        ret.put("timestamp", timestamp);
        if (!armed) {
            ret.put("reason", "Exact alarm permission may be denied");
        }
        call.resolve(ret);
    }

    /* Best-effort background download of the destination image into the app's cache
     * directory. The path is written back into AlarmStorage so AlarmRingActivity can
     * load it instantly without any network when the alarm fires. */
    private static void cacheHeroImage(Context ctx, String id, String urlStr) {
        try {
            File dir = new File(ctx.getCacheDir(), IMAGE_CACHE_DIR);
            if (!dir.exists() && !dir.mkdirs()) return;
            File outFile = new File(dir, AlarmStorage.requestCodeFor(id) + ".img");
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(8000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "HolidayHacker-Alarm/1.0");
            try (InputStream in = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(outFile)) {
                byte[] buf = new byte[8192];
                int n;
                long total = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    total += n;
                    if (total > 4 * 1024 * 1024) break;
                }
            }
            List<AlarmStorage.AlarmEntry> all = AlarmStorage.readAll(ctx);
            for (AlarmStorage.AlarmEntry e : all) {
                if (id.equals(e.id)) {
                    e.imagePath = outFile.getAbsolutePath();
                    AlarmStorage.upsert(ctx, e);
                    break;
                }
            }
        } catch (Throwable ignored) {
            /* Network or write error — alarm will fall back to gradient background. */
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("Missing id");
            return;
        }
        Context ctx = getContext();
        cancelByIdInternal(ctx, id);
        AlarmStorage.remove(ctx, id);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("id", id);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        Context ctx = getContext();
        List<AlarmStorage.AlarmEntry> all = AlarmStorage.readAll(ctx);
        for (AlarmStorage.AlarmEntry e : all) {
            cancelByIdInternal(ctx, e.id);
        }
        AlarmStorage.clear(ctx);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("cancelled", all.size());
        call.resolve(ret);
    }

    @PluginMethod
    public void listScheduled(PluginCall call) {
        List<AlarmStorage.AlarmEntry> all = AlarmStorage.readAll(getContext());
        JSArray arr = new JSArray();
        long now = System.currentTimeMillis();
        for (AlarmStorage.AlarmEntry e : all) {
            if (e.timestamp <= now) continue;
            JSObject o = new JSObject();
            o.put("id", e.id);
            o.put("timestamp", e.timestamp);
            o.put("title", e.title);
            o.put("body", e.body);
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("alarms", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void hasPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("notifications", hasNotificationsPermission());
        ret.put("exactAlarms", canScheduleExactAlarms());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        Context ctx = getContext();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && !hasNotificationsPermission()) {
            try {
                getActivity().requestPermissions(
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    1001
                );
            } catch (Throwable ignored) { }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && !canScheduleExactAlarms()) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Throwable ignored) { }
        }

        JSObject ret = new JSObject();
        ret.put("notifications", hasNotificationsPermission());
        ret.put("exactAlarms", canScheduleExactAlarms());
        call.resolve(ret);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("Could not open battery settings: " + t.getMessage());
        }
    }

    /* ---------- internal helpers ---------- */

    private boolean hasNotificationsPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(
            getContext(),
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean canScheduleExactAlarms() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        return am.canScheduleExactAlarms();
    }

    static boolean armAlarm(Context ctx, AlarmStorage.AlarmEntry entry) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;

        Intent intent = new Intent(ctx, AlarmReceiver.class);
        intent.setAction(AlarmReceiver.ACTION_FIRE);
        intent.putExtra(AlarmReceiver.EXTRA_ID, entry.id);
        intent.putExtra(AlarmReceiver.EXTRA_TITLE, entry.title);
        intent.putExtra(AlarmReceiver.EXTRA_BODY, entry.body);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(
            ctx,
            AlarmStorage.requestCodeFor(entry.id),
            intent,
            flags
        );

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.timestamp, pi);
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.timestamp, pi);
                    return false;
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.timestamp, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, entry.timestamp, pi);
            }
            return true;
        } catch (SecurityException se) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.timestamp, pi);
            return false;
        }
    }

    static void cancelByIdInternal(Context ctx, String id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent intent = new Intent(ctx, AlarmReceiver.class);
        intent.setAction(AlarmReceiver.ACTION_FIRE);

        int flags = PendingIntent.FLAG_NO_CREATE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(
            ctx,
            AlarmStorage.requestCodeFor(id),
            intent,
            flags
        );
        if (pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }
}
