package in.holidayhacker.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HolidayAlarmPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(BackupPlugin.class);
        super.onCreate(savedInstanceState);
        storeLaunchRoute(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        storeLaunchRoute(intent);
    }

    private void storeLaunchRoute(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra(LaunchRouter.EXTRA_ROUTE);
        if (route != null && !route.isEmpty()) {
            LaunchRouter.setPendingRoute(route);
        }
    }
}
