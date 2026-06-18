package in.holidayhacker.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
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
 *   hasPermissions()                           -> { notifications, exactAlarms, batteryOptimization, ready }
 *   requestPermissions()                       -> opens system dialogs
 *   requestBatteryOptimization()               -> app-specific don't-optimize prompt
 *   openNotificationSettings()               -> app notification settings
 *   openExactAlarmSettings()                   -> exact alarm permission screen
 *   openBatterySettings()                      -> battery optimization list (fallback)
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
    public void getPendingRoute(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("route", LaunchRouter.consumePendingRoute());
        call.resolve(ret);
    }

    @PluginMethod
    public void hasPermissions(PluginCall call) {
        call.resolve(buildPermissionsResult());
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
            openExactAlarmSettingsInternal(ctx);
        }

        if (!isBatteryOptimizationIgnored()) {
            requestBatteryOptimizationInternal(ctx);
        }

        JSObject ret = buildPermissionsResult();
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBatteryOptimization(PluginCall call) {
        Context ctx = getContext();
        boolean opened = openBatterySettingsForUser(ctx);
        JSObject ret = new JSObject();
        ret.put("ok", opened);
        ret.put("alreadyGranted", isBatteryOptimizationIgnored());
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context ctx = getContext();
        String pkg = ctx.getPackageName();
        boolean opened = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                opened = true;
            }
        } catch (Throwable ignored) { }
        if (!opened) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + pkg));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                opened = true;
            } catch (Throwable ignored) { }
        }
        JSObject ret = new JSObject();
        ret.put("ok", opened);
        call.resolve(ret);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Context ctx = getContext();
        boolean opened = openExactAlarmSettingsInternal(ctx);
        JSObject ret = new JSObject();
        ret.put("ok", opened);
        call.resolve(ret);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        boolean opened = openBatterySettingsForUser(ctx);
        JSObject ret = new JSObject();
        ret.put("ok", opened);
        call.resolve(ret);
    }

    /** Opens phone-specific battery screen (Smart mode / background activity). */
    @PluginMethod
    public void openOemBatterySettings(PluginCall call) {
        Context ctx = getContext();
        boolean opened = openOemBatterySettingsInternal(ctx);
        JSObject ret = new JSObject();
        ret.put("ok", opened);
        call.resolve(ret);
    }

    /* ---------- internal helpers ---------- */

    private boolean hasNotificationsPermission() {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                ctx,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && !nm.areNotificationsEnabled()) {
                return false;
            }
        }
        return true;
    }

    private boolean canScheduleExactAlarms() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        return am.canScheduleExactAlarms();
    }

    private boolean isBatteryOptimizationIgnored() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (pm == null) return true;
        return pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private JSObject buildPermissionsResult() {
        boolean notifications = hasNotificationsPermission();
        boolean exactAlarms = canScheduleExactAlarms();
        boolean batteryOptimization = isBatteryOptimizationIgnored();
        boolean oemBatteryGuidance = needsOemBatteryGuidance();
        JSObject ret = new JSObject();
        ret.put("notifications", notifications);
        ret.put("exactAlarms", exactAlarms);
        ret.put("batteryOptimization", batteryOptimization);
        ret.put("oemBatteryGuidance", oemBatteryGuidance);
        ret.put("ready", notifications && exactAlarms && batteryOptimization);
        return ret;
    }

    /**
     * Many OEMs (Samsung, Xiaomi, etc.) use a separate "Smart mode" battery screen that
     * is NOT reflected in PowerManager.isIgnoringBatteryOptimizations().
     */
    private static boolean needsOemBatteryGuidance() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String b = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();
        if (containsAny(m, b, "xiaomi", "redmi", "poco")) return true;
        if (containsAny(m, b, "samsung")) return true;
        if (containsAny(m, b, "oppo", "realme")) return true;
        if (containsAny(m, b, "vivo", "iqoo")) return true;
        if (containsAny(m, b, "huawei", "honor")) return true;
        if (containsAny(m, b, "oneplus")) return true;
        if (containsAny(m, b, "motorola")) return true;
        return false;
    }

    private static boolean containsAny(String m, String b, String... tokens) {
        for (String t : tokens) {
            if (m.contains(t) || b.contains(t)) return true;
        }
        return false;
    }

    private static String getAppLabel(Context ctx) {
        try {
            ApplicationInfo ai = ctx.getApplicationInfo();
            CharSequence label = ctx.getPackageManager().getApplicationLabel(ai);
            return label != null ? label.toString() : "Holiday Hacker";
        } catch (Throwable ignored) {
            return "Holiday Hacker";
        }
    }

    private static boolean tryStartActivity(Context ctx, Intent intent) {
        if (intent == null) return false;
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(ctx.getPackageManager()) != null) {
                ctx.startActivity(intent);
                return true;
            }
        } catch (Throwable ignored) { }
        return false;
    }

    private static boolean openAppDetailsSettings(Context ctx) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            return tryStartActivity(ctx, intent);
        } catch (Throwable ignored) {
            return false;
        }
    }

    /** Per-app battery / background screen on MIUI, One UI, ColorOS, etc. */
    private static boolean openOemBatterySettingsInternal(Context ctx) {
        String pkg = ctx.getPackageName();
        String label = getAppLabel(ctx);
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String b = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();

        if (containsAny(m, b, "xiaomi", "redmi", "poco")) {
            Intent i = new Intent("miui.intent.action.POWER_HIDE_MODE_APP_LIST");
            i.addCategory(Intent.CATEGORY_DEFAULT);
            i.putExtra("package_name", pkg);
            i.putExtra("package_label", label);
            if (tryStartActivity(ctx, i)) return true;

            i = new Intent("miui.intent.action.APP_PERM_EDITOR");
            i.setClassName("com.miui.securitycenter",
                "com.miui.permcenter.permissions.PermissionsEditorActivity");
            i.putExtra("extra_pkgname", pkg);
            if (tryStartActivity(ctx, i)) return true;

            i = new Intent();
            i.setClassName("com.miui.powerkeeper",
                "com.miui.powerkeeper.ui.HiddenAppsConfigActivity");
            if (tryStartActivity(ctx, i)) return true;
        }

        if (containsAny(m, b, "samsung")) {
            Intent i = new Intent();
            i.setComponent(new ComponentName("com.samsung.android.lool",
                "com.samsung.android.sm.ui.battery.BatteryActivity"));
            if (tryStartActivity(ctx, i)) return true;
            i.setComponent(new ComponentName("com.samsung.android.sm",
                "com.samsung.android.sm.ui.battery.BatteryActivity"));
            if (tryStartActivity(ctx, i)) return true;
        }

        if (containsAny(m, b, "oppo", "realme")) {
            Intent i = new Intent();
            i.setComponent(new ComponentName("com.coloros.safecenter",
                "com.coloros.powermanager.fuelgaue.PowerConsumptionOptimizationActivity"));
            if (tryStartActivity(ctx, i)) return true;
        }

        if (containsAny(m, b, "vivo", "iqoo")) {
            Intent i = new Intent();
            i.setComponent(new ComponentName("com.iqoo.secure",
                "com.iqoo.powermanager.fuelgaue.PowerConsumptionOptimizationActivity"));
            if (tryStartActivity(ctx, i)) return true;
            i.setComponent(new ComponentName("com.vivo.abe",
                "com.vivo.applicationbehaviorengine.ui.ExcessivePowerManagerActivity"));
            if (tryStartActivity(ctx, i)) return true;
        }

        if (containsAny(m, b, "huawei", "honor")) {
            Intent i = new Intent();
            i.setComponent(new ComponentName("com.huawei.systemmanager",
                "com.huawei.systemmanager.optimize.process.ProtectActivity"));
            if (tryStartActivity(ctx, i)) return true;
        }

        if (containsAny(m, b, "oneplus")) {
            Intent i = new Intent();
            i.setComponent(new ComponentName("com.oneplus.security",
                "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"));
            if (tryStartActivity(ctx, i)) return true;
        }

        return openAppDetailsSettings(ctx);
    }

    /**
     * Opens the screen where the user can allow background activity / unrestricted battery.
     * On Samsung/Xiaomi/etc. this is App info → Battery (not only the generic Don't optimize list).
     */
    private boolean openBatterySettingsForUser(Context ctx) {
        if (needsOemBatteryGuidance()) {
            if (openOemBatterySettingsInternal(ctx)) return true;
        }
        if (!isBatteryOptimizationIgnored()) {
            if (requestBatteryOptimizationInternal(ctx)) return true;
        }
        return openAppDetailsSettings(ctx);
    }

    private boolean openExactAlarmSettingsInternal(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            return true;
        } catch (Throwable ignored) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                return true;
            } catch (Throwable ignored2) {
                return false;
            }
        }
    }

    /** Opens the per-app "allow unrestricted / don't optimize" dialog when possible. */
    private boolean requestBatteryOptimizationInternal(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        if (isBatteryOptimizationIgnored()) return true;
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            return true;
        } catch (Throwable ignored) {
            try {
                Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                return true;
            } catch (Throwable ignored2) {
                return false;
            }
        }
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
