package in.holidayhacker.app;

import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * Backup save / open for Profile export & restore.
 *
 * Export (Android 10+): writes a fixed filename straight to Downloads — no
 * rename dialog, no folder permission dance.
 * Export (older Android): system save dialog with filename pre-filled.
 *
 * Restore: JSON files only, validated as Holiday Hacker backups.
 */
@CapacitorPlugin(name = "HolidayBackup")
public class BackupPlugin extends Plugin {

    private static final Pattern BACKUP_NAME =
        Pattern.compile("^HolidayHacker-backup-\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.json$", Pattern.CASE_INSENSITIVE);

    @PluginMethod
    public void saveBackup(PluginCall call) {
        String json = call.getString("json");
        String filename = call.getString("filename", "HolidayHacker-backup.json");
        if (json == null || json.isEmpty()) {
            call.reject("Missing json");
            return;
        }
        if (!BACKUP_NAME.matcher(filename).matches()) {
            filename = "HolidayHacker-backup.json";
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                Uri uri = saveToDownloads(json, filename);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("filename", filename);
                ret.put("location", "Downloads");
                ret.put("uri", uri.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Save failed: " + e.getMessage());
            }
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);

        call.setKeepAlive(true);
        startActivityForResult(call, intent, "saveBackupResult");
    }

    private Uri saveToDownloads(String json, String filename) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/");
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = getContext().getContentResolver().insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            values
        );
        if (uri == null) {
            throw new Exception("Could not create file in Downloads");
        }

        OutputStream out = getContext().getContentResolver().openOutputStream(uri);
        if (out == null) {
            throw new Exception("Could not open Downloads file");
        }
        try {
            out.write(json.getBytes(StandardCharsets.UTF_8));
            out.flush();
        } finally {
            out.close();
        }

        ContentValues done = new ContentValues();
        done.put(MediaStore.Downloads.IS_PENDING, 0);
        getContext().getContentResolver().update(uri, done, null, null);
        return uri;
    }

    @ActivityCallback
    private void saveBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "Save cancelled");
            call.resolve(ret);
            return;
        }

        Uri uri = result.getData().getData();
        String json = call.getString("json");
        String filename = call.getString("filename");
        if (uri == null || json == null) {
            call.reject("Save failed");
            return;
        }

        try {
            OutputStream out = getContext().getContentResolver().openOutputStream(uri);
            if (out == null) {
                call.reject("Could not open save location");
                return;
            }
            out.write(json.getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.close();

            String name = queryDisplayName(uri);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("filename", name != null ? name : filename);
            ret.put("location", "Downloads");
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void pickBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, MediaStore.Downloads.EXTERNAL_CONTENT_URI);
        }

        call.setKeepAlive(true);
        startActivityForResult(call, intent, "pickBackupResult");
    }

    @ActivityCallback
    private void pickBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "No file selected");
            call.resolve(ret);
            return;
        }

        Uri uri = result.getData().getData();
        if (uri == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "No file selected");
            call.resolve(ret);
            return;
        }

        String name = queryDisplayName(uri);
        if (name == null || !name.toLowerCase().endsWith(".json")) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "not_json");
            ret.put("filename", name != null ? name : "");
            call.resolve(ret);
            return;
        }
        if (!BACKUP_NAME.matcher(name).matches()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "wrong_name");
            ret.put("filename", name);
            call.resolve(ret);
            return;
        }

        try {
            InputStream in = getContext().getContentResolver().openInputStream(uri);
            if (in == null) {
                call.reject("Could not read file");
                return;
            }
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buf.write(chunk, 0, n);
            }
            in.close();
            String json = buf.toString(StandardCharsets.UTF_8.name());

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("filename", name);
            ret.put("json", json);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Read failed: " + e.getMessage());
        }
    }

    private String queryDisplayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                uri,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
                null,
                null,
                null
            );
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                if (idx >= 0) return cursor.getString(idx);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return uri.getLastPathSegment();
    }
}
