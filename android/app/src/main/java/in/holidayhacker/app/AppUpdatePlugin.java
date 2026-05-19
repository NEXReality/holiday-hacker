package in.holidayhacker.app;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Bridge for Google Play's In-App Updates API.
 *
 * Mounted at window.AppUpdater by Capacitor. JS surface:
 *
 *   check()                  → {
 *       updateAvailability,        // 0=UNKNOWN, 1=NOT_AVAILABLE, 2=AVAILABLE, 3=IN_PROGRESS
 *       availableVersionCode,
 *       updatePriority,            // 0..5, set per-release in Play Console
 *       clientVersionStalenessDays,// days since the update was published, or -1
 *       installStatus,             // see InstallStatus constants
 *       immediateUpdateAllowed,
 *       flexibleUpdateAllowed
 *   }
 *
 *   startImmediate()         → kicks off the blocking full-screen Google Play
 *                              update UI. The user must update or quit.
 *
 *   startFlexible()          → starts a background download. JS receives
 *                              installStateChange events as it progresses.
 *
 *   completeFlexibleUpdate() → after a flexible download finishes, restart
 *                              the app to apply the installed update.
 *
 * The plugin always re-fetches a fresh AppUpdateInfo before launching a flow,
 * because Play's library refuses to act on a stale info object.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdatePlugin extends Plugin {

    private static final int REQUEST_CODE_UPDATE = 7891;

    private AppUpdateManager manager;
    private InstallStateUpdatedListener listener;

    @Override
    public void load() {
        super.load();
        try {
            manager = AppUpdateManagerFactory.create(getContext());
            listener = state -> {
                JSObject obj = new JSObject();
                obj.put("installStatus", state.installStatus());
                obj.put("bytesDownloaded", state.bytesDownloaded());
                obj.put("totalBytesToDownload", state.totalBytesToDownload());
                obj.put("packageName", state.packageName());
                notifyListeners("installStateChange", obj);
            };
            manager.registerListener(listener);
        } catch (Throwable t) {
            /* Device without Play services or a stub environment. The plugin
               will still exist on the JS side, but every call will resolve
               with no update available. */
        }
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (manager != null && listener != null) {
                manager.unregisterListener(listener);
            }
        } catch (Throwable ignored) {}
        super.handleOnDestroy();
    }

    @PluginMethod
    public void check(PluginCall call) {
        if (manager == null) {
            call.resolve(noUpdatePayload());
            return;
        }
        try {
            manager.getAppUpdateInfo()
                .addOnSuccessListener(info -> {
                    JSObject ret = new JSObject();
                    ret.put("updateAvailability", info.updateAvailability());
                    ret.put("availableVersionCode", info.availableVersionCode());
                    ret.put("updatePriority", info.updatePriority());
                    Integer staleness = info.clientVersionStalenessDays();
                    ret.put("clientVersionStalenessDays", staleness != null ? staleness : -1);
                    ret.put("installStatus", info.installStatus());
                    ret.put("immediateUpdateAllowed", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE));
                    ret.put("flexibleUpdateAllowed", info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE));
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> call.resolve(noUpdatePayload()));
        } catch (Throwable t) {
            call.resolve(noUpdatePayload());
        }
    }

    @PluginMethod
    public void startImmediate(PluginCall call) {
        launchUpdateFlow(call, AppUpdateType.IMMEDIATE);
    }

    @PluginMethod
    public void startFlexible(PluginCall call) {
        launchUpdateFlow(call, AppUpdateType.FLEXIBLE);
    }

    @PluginMethod
    public void completeFlexibleUpdate(PluginCall call) {
        if (manager == null) {
            call.reject("Play update manager unavailable");
            return;
        }
        try {
            manager.completeUpdate();
            call.resolve();
        } catch (Throwable t) {
            call.reject(t.getMessage());
        }
    }

    private void launchUpdateFlow(PluginCall call, int type) {
        if (manager == null) {
            call.reject("Play update manager unavailable");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No host activity");
            return;
        }
        try {
            manager.getAppUpdateInfo()
                .addOnSuccessListener(info -> {
                    boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                                     || info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
                    if (!available || !info.isUpdateTypeAllowed(type)) {
                        JSObject ret = new JSObject();
                        ret.put("started", false);
                        call.resolve(ret);
                        return;
                    }
                    try {
                        AppUpdateOptions opts = AppUpdateOptions.newBuilder(type).build();
                        boolean started = manager.startUpdateFlowForResult(info, activity, opts, REQUEST_CODE_UPDATE);
                        JSObject ret = new JSObject();
                        ret.put("started", started);
                        call.resolve(ret);
                    } catch (Throwable t) {
                        call.reject(t.getMessage());
                    }
                })
                .addOnFailureListener(e -> call.reject(e.getMessage() != null ? e.getMessage() : "Play update lookup failed"));
        } catch (Throwable t) {
            call.reject(t.getMessage());
        }
    }

    /**
     * After the activity returns from the immediate-update UI the Capacitor
     * BridgeActivity routes the result here. We only forward to JS as an
     * event so the page can choose what to do (e.g. re-arm a forced flow).
     */
    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CODE_UPDATE) return;
        JSObject obj = new JSObject();
        obj.put("resultCode", resultCode);
        notifyListeners("updateFlowResult", obj);
    }

    private static JSObject noUpdatePayload() {
        JSObject ret = new JSObject();
        ret.put("updateAvailability", UpdateAvailability.UPDATE_NOT_AVAILABLE);
        ret.put("availableVersionCode", 0);
        ret.put("updatePriority", 0);
        ret.put("clientVersionStalenessDays", -1);
        ret.put("installStatus", InstallStatus.UNKNOWN);
        ret.put("immediateUpdateAllowed", false);
        ret.put("flexibleUpdateAllowed", false);
        return ret;
    }
}
