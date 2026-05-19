package in.holidayhacker.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.ArrayList;
import java.util.List;

/**
 * Re-arms all persisted future alarms after device reboot or app upgrade.
 *
 * Listens for BOOT_COMPLETED, LOCKED_BOOT_COMPLETED (direct boot, before user
 * unlocks - AlarmStorage uses device-protected storage so it works pre-unlock),
 * and MY_PACKAGE_REPLACED so alarms persist across app updates.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;

        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
            && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }

        long now = System.currentTimeMillis();
        List<AlarmStorage.AlarmEntry> all = AlarmStorage.readAll(ctx);
        List<AlarmStorage.AlarmEntry> kept = new ArrayList<>();

        for (AlarmStorage.AlarmEntry entry : all) {
            if (entry.timestamp <= now) continue;
            HolidayAlarmPlugin.armAlarm(ctx, entry);
            kept.add(entry);
        }

        AlarmStorage.writeAll(ctx, kept);
    }
}
