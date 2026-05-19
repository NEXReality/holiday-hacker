package in.holidayhacker.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Full-screen alarm UI. Launched when the AlarmReceiver fires its notification's
 * fullScreenIntent. Wakes the device, shows over the lock screen, presents a
 * trip-card hero (destination image + holiday window + dates) plus Dismiss /
 * Snooze buttons. Tapping either stops AlarmAudioService via AlarmReceiver actions.
 */
public class AlarmRingActivity extends AppCompatActivity {

    private static final String[] MONTH_SHORT = {
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) {
                km.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_alarm_ring);

        Intent in = getIntent();
        final String id = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_ID) : null;
        String title = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_TITLE) : null;
        String body  = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_BODY)  : null;
        if (title == null || title.isEmpty()) title = getString(R.string.alarm_now_ringing);
        if (body == null) body = "";

        String destName    = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_DEST_NAME)    : null;
        String destState   = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_DEST_STATE)   : null;
        String windowName  = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_WINDOW_NAME)  : null;
        String windowStart = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_WINDOW_START) : null;
        String windowEnd   = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_WINDOW_END)   : null;
        int windowDays     = in != null ? in.getIntExtra(AlarmReceiver.EXTRA_WINDOW_DAYS, 0)  : 0;
        String imagePath   = in != null ? in.getStringExtra(AlarmReceiver.EXTRA_IMAGE_PATH)   : null;

        TextView tvTitle      = findViewById(R.id.alarmTitle);
        TextView tvBody       = findViewById(R.id.alarmBody);
        TextView tvDestName   = findViewById(R.id.alarmDestName);
        TextView tvDestState  = findViewById(R.id.alarmDestState);
        TextView tvDateRange  = findViewById(R.id.alarmDateRange);
        TextView tvCountdown  = findViewById(R.id.alarmCountdown);
        TextView tvWindowPill = findViewById(R.id.alarmWindowPill);
        ImageView ivHero      = findViewById(R.id.alarmHeroImage);
        Button btnDismiss     = findViewById(R.id.btnDismiss);
        Button btnSnooze      = findViewById(R.id.btnSnooze);

        tvTitle.setText(title);
        tvBody.setText(body);

        if (!TextUtils.isEmpty(destName)) {
            tvDestName.setText(destName);
            tvDestName.setVisibility(View.VISIBLE);
        }
        if (!TextUtils.isEmpty(destState)) {
            tvDestState.setText(destState);
            tvDestState.setVisibility(View.VISIBLE);
        }
        String dateRange = buildDateRange(windowStart, windowEnd, windowDays);
        if (!TextUtils.isEmpty(dateRange)) {
            tvDateRange.setText(dateRange);
            tvDateRange.setVisibility(View.VISIBLE);
        }
        String countdown = buildCountdown(windowStart);
        if (!TextUtils.isEmpty(countdown)) {
            tvCountdown.setText(countdown);
            tvCountdown.setVisibility(View.VISIBLE);
        }
        if (!TextUtils.isEmpty(windowName)) {
            tvWindowPill.setText(windowName.toUpperCase(Locale.US));
            tvWindowPill.setVisibility(View.VISIBLE);
        }

        loadHeroImage(ivHero, imagePath);

        final String fTitle = title;
        final String fBody = body;
        final Context ctx = getApplicationContext();

        btnDismiss.setOnClickListener(v -> {
            sendDismiss(ctx, id);
            finishAndRemoveTask();
        });

        btnSnooze.setOnClickListener(v -> {
            sendSnooze(ctx, id, fTitle, fBody);
            finishAndRemoveTask();
        });
    }

    private void loadHeroImage(ImageView iv, String path) {
        if (TextUtils.isEmpty(path)) return;
        try {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap bm = BitmapFactory.decodeFile(path, opts);
            if (bm != null) iv.setImageBitmap(bm);
        } catch (Throwable ignored) {
            /* keep fallback gradient set in XML */
        }
    }

    /** "23 – 26 Oct 2026 · 4 days" — or single-date variant when start==end. */
    private String buildDateRange(String start, String end, int days) {
        if (TextUtils.isEmpty(start)) return null;
        Calendar a = parseIsoDate(start);
        Calendar b = !TextUtils.isEmpty(end) ? parseIsoDate(end) : a;
        if (a == null) return null;
        if (b == null) b = a;

        int yA = a.get(Calendar.YEAR);
        int mA = a.get(Calendar.MONTH);
        int dA = a.get(Calendar.DAY_OF_MONTH);
        int yB = b.get(Calendar.YEAR);
        int mB = b.get(Calendar.MONTH);
        int dB = b.get(Calendar.DAY_OF_MONTH);

        StringBuilder sb = new StringBuilder();
        if (yA == yB && mA == mB && dA == dB) {
            sb.append(dA).append(' ').append(MONTH_SHORT[mA]).append(' ').append(yA);
        } else if (yA == yB && mA == mB) {
            sb.append(dA).append(" – ").append(dB).append(' ').append(MONTH_SHORT[mA]).append(' ').append(yA);
        } else if (yA == yB) {
            sb.append(dA).append(' ').append(MONTH_SHORT[mA]).append(" – ").append(dB).append(' ').append(MONTH_SHORT[mB]).append(' ').append(yA);
        } else {
            sb.append(dA).append(' ').append(MONTH_SHORT[mA]).append(' ').append(yA)
              .append(" – ")
              .append(dB).append(' ').append(MONTH_SHORT[mB]).append(' ').append(yB);
        }
        if (days > 0) {
            sb.append(" · ").append(days).append(days == 1 ? " day" : " days");
        }
        return sb.toString();
    }

    /** "Trip starts in 60 days" / "Tomorrow" / "Today". */
    private String buildCountdown(String start) {
        Calendar a = parseIsoDate(start);
        if (a == null) return null;
        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0);
        today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0);
        today.set(Calendar.MILLISECOND, 0);
        long msPerDay = 24L * 60L * 60L * 1000L;
        long diffDays = Math.round((a.getTimeInMillis() - today.getTimeInMillis()) / (double) msPerDay);
        if (diffDays < 0) return null;
        if (diffDays == 0) return getString(R.string.alarm_today_label);
        if (diffDays == 1) return getString(R.string.alarm_tomorrow_label);
        return "Trip starts in " + diffDays + " days";
    }

    private Calendar parseIsoDate(String iso) {
        if (TextUtils.isEmpty(iso)) return null;
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            sdf.setTimeZone(TimeZone.getDefault());
            Date d = sdf.parse(iso);
            if (d == null) return null;
            Calendar c = Calendar.getInstance();
            c.setTime(d);
            return c;
        } catch (ParseException e) {
            return null;
        }
    }

    private void sendDismiss(Context ctx, String id) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(AlarmReceiver.ACTION_DISMISS);
        i.putExtra(AlarmReceiver.EXTRA_ID, id == null ? "" : id);
        ctx.sendBroadcast(i);
    }

    private void sendSnooze(Context ctx, String id, String title, String body) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(AlarmReceiver.ACTION_SNOOZE);
        i.putExtra(AlarmReceiver.EXTRA_ID, id == null ? "" : id);
        i.putExtra(AlarmReceiver.EXTRA_TITLE, title);
        i.putExtra(AlarmReceiver.EXTRA_BODY, body);
        ctx.sendBroadcast(i);
    }

    @Override
    public void onBackPressed() {
        // Disable back; user must explicitly Dismiss or Snooze.
    }
}
