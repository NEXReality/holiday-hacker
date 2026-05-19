package in.holidayhacker.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Tiny SharedPreferences-backed persistence for scheduled alarm metadata.
 * Survives app kill and device reboot; BootReceiver reads from here to re-arm.
 */
public class AlarmStorage {

    private static final String PREFS = "holiday_alarms";
    private static final String KEY = "alarms";

    public static class AlarmEntry {
        public String id;
        public long timestamp;
        public String title;
        public String body;

        /* Optional trip context for richer alarm screen rendering. All nullable to keep
         * backward compatibility with alarms persisted before this field existed. */
        public String destName;
        public String destState;
        public String windowName;
        public String windowStart;
        public String windowEnd;
        public int windowDays;
        public String mode;
        public String imageUrl;
        public String imagePath;

        public AlarmEntry(String id, long timestamp, String title, String body) {
            this.id = id;
            this.timestamp = timestamp;
            this.title = title;
            this.body = body;
        }

        JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("timestamp", timestamp);
            o.put("title", title);
            o.put("body", body);
            if (destName != null) o.put("destName", destName);
            if (destState != null) o.put("destState", destState);
            if (windowName != null) o.put("windowName", windowName);
            if (windowStart != null) o.put("windowStart", windowStart);
            if (windowEnd != null) o.put("windowEnd", windowEnd);
            if (windowDays > 0) o.put("windowDays", windowDays);
            if (mode != null) o.put("mode", mode);
            if (imageUrl != null) o.put("imageUrl", imageUrl);
            if (imagePath != null) o.put("imagePath", imagePath);
            return o;
        }

        static AlarmEntry fromJson(JSONObject o) throws JSONException {
            AlarmEntry e = new AlarmEntry(
                o.optString("id"),
                o.optLong("timestamp"),
                o.optString("title"),
                o.optString("body")
            );
            e.destName    = o.optString("destName", null);
            e.destState   = o.optString("destState", null);
            e.windowName  = o.optString("windowName", null);
            e.windowStart = o.optString("windowStart", null);
            e.windowEnd   = o.optString("windowEnd", null);
            e.windowDays  = o.optInt("windowDays", 0);
            e.mode        = o.optString("mode", null);
            e.imageUrl    = o.optString("imageUrl", null);
            e.imagePath   = o.optString("imagePath", null);
            return e;
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        Context base = ctx;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try { base = ctx.createDeviceProtectedStorageContext(); } catch (Throwable ignored) { }
        }
        return base.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static List<AlarmEntry> readAll(Context ctx) {
        List<AlarmEntry> out = new ArrayList<>();
        String raw = prefs(ctx).getString(KEY, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                out.add(AlarmEntry.fromJson(arr.getJSONObject(i)));
            }
        } catch (JSONException ignored) { }
        return out;
    }

    public static void writeAll(Context ctx, List<AlarmEntry> entries) {
        JSONArray arr = new JSONArray();
        for (AlarmEntry e : entries) {
            try {
                arr.put(e.toJson());
            } catch (JSONException ignored) { }
        }
        prefs(ctx).edit().putString(KEY, arr.toString()).apply();
    }

    public static void upsert(Context ctx, AlarmEntry entry) {
        List<AlarmEntry> entries = readAll(ctx);
        boolean replaced = false;
        for (int i = 0; i < entries.size(); i++) {
            if (entries.get(i).id.equals(entry.id)) {
                entries.set(i, entry);
                replaced = true;
                break;
            }
        }
        if (!replaced) entries.add(entry);
        writeAll(ctx, entries);
    }

    public static AlarmEntry remove(Context ctx, String id) {
        List<AlarmEntry> entries = readAll(ctx);
        for (int i = 0; i < entries.size(); i++) {
            if (entries.get(i).id.equals(id)) {
                AlarmEntry removed = entries.remove(i);
                writeAll(ctx, entries);
                return removed;
            }
        }
        return null;
    }

    public static void clear(Context ctx) {
        prefs(ctx).edit().remove(KEY).apply();
    }

    public static int requestCodeFor(String id) {
        return id == null ? 0 : id.hashCode();
    }
}
