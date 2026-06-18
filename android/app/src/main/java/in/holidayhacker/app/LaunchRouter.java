package in.holidayhacker.app;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Holds a one-shot in-app navigation path (e.g. from a reminder notification tap)
 * until the WebView reads it via HolidayAlarmPlugin.getPendingRoute().
 */
public final class LaunchRouter {

    public static final String EXTRA_ROUTE = "hh_launch_route";

    private static volatile String pendingRoute;

    private LaunchRouter() {}

    public static void setPendingRoute(String route) {
        if (route == null || route.isEmpty()) return;
        pendingRoute = route;
    }

    public static String consumePendingRoute() {
        String route = pendingRoute;
        pendingRoute = null;
        return route;
    }

    /** holiday-gift-2026-01-26 → /trips/index.html?start=2026-01-26 */
    static String routeForHolidayAlarm(String id, AlarmStorage.AlarmEntry entry) {
        if (id == null || !id.startsWith("holiday-")) return null;

        String start = null;

        Matcher m = Pattern.compile("^holiday-(gift|bridge|mega)-(\\d{4}-\\d{2}-\\d{2})$").matcher(id);
        if (m.matches()) {
            start = m.group(2);
        }

        if (entry != null && entry.windowStart != null && !entry.windowStart.isEmpty()) {
            start = entry.windowStart;
        }
        if (start == null || start.isEmpty()) return null;

        return "/trips/index.html?start=" + start;
    }
}
