import fs from 'node:fs';

const base = 'android/app/src/main';
const pkg = 'com.aracademy.app';
const dir = base + '/java/' + pkg.replace(/\./g, '/');
if (!fs.existsSync(base + '/AndroidManifest.xml')) throw new Error('Android project was not created. Run "npx cap add android" first.');
fs.mkdirSync(dir, { recursive: true });

/* MainActivity: blocks screenshots (FLAG_SECURE), registers the UPI plugin, and lets Google sign in finish */
fs.writeFileSync(dir + '/MainActivity.java', `package ${pkg};

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    registerPlugin(UpiPlugin.class);
    registerPlugin(AppLockPlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
      PluginHandle handle = getBridge().getPlugin("SocialLogin");
      if (handle == null) { Log.i("AR", "SocialLogin handle is null"); return; }
      Plugin plugin = handle.getInstance();
      if (!(plugin instanceof SocialLoginPlugin)) return;
      ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
    }
  }

  @Override
  public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
`);

/* UpiPlugin: lists the UPI apps installed on the phone and opens the one the student picks */
fs.writeFileSync(dir + '/UpiPlugin.java', `package ${pkg};

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.security.MessageDigest;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "Upi")
public class UpiPlugin extends Plugin {
  @PluginMethod
  public void apps(PluginCall call) {
    PackageManager pm = getContext().getPackageManager();
    Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("upi://pay?pa=test@upi&pn=Test&cu=INR"));
    List<ResolveInfo> list = pm.queryIntentActivities(probe, 0);
    JSArray out = new JSArray();
    Set<String> seen = new HashSet<>();
    for (ResolveInfo r : list) {
      String p = r.activityInfo.packageName;
      if (!seen.add(p)) continue;
      JSObject o = new JSObject();
      o.put("package", p);
      o.put("name", String.valueOf(r.loadLabel(pm)));
      out.put(o);
    }
    JSObject ret = new JSObject();
    ret.put("apps", out);
    call.resolve(ret);
  }

  @PluginMethod
  public void sig(PluginCall call) {
    try {
      PackageManager pm = getContext().getPackageManager();
      String name = getContext().getPackageName();
      Signature[] sigs;
      if (Build.VERSION.SDK_INT >= 28) {
        PackageInfo pi = pm.getPackageInfo(name, PackageManager.GET_SIGNING_CERTIFICATES);
        sigs = pi.signingInfo.getApkContentsSigners();
      } else {
        PackageInfo pi = pm.getPackageInfo(name, PackageManager.GET_SIGNATURES);
        sigs = pi.signatures;
      }
      byte[] d = MessageDigest.getInstance("SHA-1").digest(sigs[0].toByteArray());
      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < d.length; i++) { if (i > 0) sb.append(':'); sb.append(String.format("%02X", d[i])); }
      JSObject ret = new JSObject();
      ret.put("pkg", name);
      ret.put("sha", sb.toString());
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("No signature");
    }
  }

  @PluginMethod
  public void pay(PluginCall call) {
    String url = call.getString("url");
    String pkg = call.getString("package");
    if (url == null || !url.startsWith("upi://")) { call.reject("Bad payment link"); return; }
    try {
      Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
      if (pkg != null && !pkg.isEmpty()) i.setPackage(pkg);
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
      call.resolve();
    } catch (Exception e) {
      call.reject("Could not open the UPI app");
    }
  }
}
`);


/* Focus lock: while a timer is running, chosen apps are sent away (needs the accessibility switch turned on once) */
fs.writeFileSync(dir + '/AppLockService.java', `package ${pkg};

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.accessibility.AccessibilityEvent;
import android.widget.Toast;
import java.util.HashSet;
import java.util.Set;

public class AppLockService extends AccessibilityService {
  static final String PREFS = "ar_lock";
  private long lastToast = 0;

  @Override
  public void onAccessibilityEvent(AccessibilityEvent e) {
    if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || e.getPackageName() == null) return;
    SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    long end = p.getLong("end", 0);
    long now = System.currentTimeMillis();
    if (now >= end) return;
    String pkg = e.getPackageName().toString();
    if (pkg.equals(getPackageName())) return;
    String cls = e.getClassName() == null ? "" : e.getClassName().toString();
    Set<String> blocked = p.getStringSet("pkgs", new HashSet<String>());
    boolean stopSwitch = (pkg.contains("settings") && cls.toLowerCase().contains("accessibility")) || pkg.contains("packageinstaller");
    if (!blocked.contains(pkg) && !stopSwitch) return;
    performGlobalAction(GLOBAL_ACTION_HOME);
    try {
      Intent back = getPackageManager().getLaunchIntentForPackage(getPackageName());
      if (back != null) { back.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP); startActivity(back); }
    } catch (Exception ex) {}
    if (now - lastToast > 2500) {
      lastToast = now;
      long mins = (end - now) / 60000 + 1;
      Toast.makeText(this, "Focus mode is on. " + mins + " min left.", Toast.LENGTH_SHORT).show();
    }
  }

  @Override
  public void onInterrupt() {}
}
`);

fs.writeFileSync(dir + '/AppLockPlugin.java', `package ${pkg};

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.provider.Settings;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {
  private SharedPreferences prefs() { return getContext().getSharedPreferences(AppLockService.PREFS, Context.MODE_PRIVATE); }

  private boolean enabled() {
    try {
      String s = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
      return s != null && s.contains(getContext().getPackageName() + "/") && s.contains("AppLockService");
    } catch (Exception e) { return false; }
  }

  private String icon(PackageManager pm, String pkg) {
    try {
      Drawable d = pm.getApplicationIcon(pkg);
      Bitmap b = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
      Canvas c = new Canvas(b);
      d.setBounds(0, 0, 64, 64);
      d.draw(c);
      ByteArrayOutputStream o = new ByteArrayOutputStream();
      b.compress(Bitmap.CompressFormat.PNG, 90, o);
      return Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP);
    } catch (Exception e) { return ""; }
  }

  @PluginMethod
  public void apps(PluginCall call) {
    PackageManager pm = getContext().getPackageManager();
    Intent main = new Intent(Intent.ACTION_MAIN);
    main.addCategory(Intent.CATEGORY_LAUNCHER);
    List<ResolveInfo> list = pm.queryIntentActivities(main, 0);
    Intent home = new Intent(Intent.ACTION_MAIN);
    home.addCategory(Intent.CATEGORY_HOME);
    Set<String> skip = new HashSet<>();
    for (ResolveInfo r : pm.queryIntentActivities(home, 0)) skip.add(r.activityInfo.packageName);
    JSArray out = new JSArray();
    Set<String> seen = new HashSet<>();
    for (ResolveInfo r : list) {
      String p = r.activityInfo.packageName;
      String low = p.toLowerCase();
      if (p.equals(getContext().getPackageName()) || skip.contains(p) || !seen.add(p)) continue;
      if (low.contains("dialer") || low.contains("telecom") || low.contains("emergency") || low.equals("com.android.settings") || low.contains("systemui")) continue;
      JSObject o = new JSObject();
      o.put("package", p);
      o.put("name", String.valueOf(r.loadLabel(pm)));
      o.put("icon", icon(pm, p));
      out.put(o);
    }
    JSObject ret = new JSObject();
    ret.put("apps", out);
    call.resolve(ret);
  }

  @PluginMethod
  public void status(PluginCall call) {
    long end = prefs().getLong("end", 0);
    long left = Math.max(0, end - System.currentTimeMillis());
    JSObject ret = new JSObject();
    ret.put("enabled", enabled());
    ret.put("active", left > 0);
    ret.put("remaining", left);
    ret.put("count", prefs().getStringSet("pkgs", new HashSet<String>()).size());
    call.resolve(ret);
  }

  @PluginMethod
  public void settings(PluginCall call) {
    try {
      Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
      call.resolve();
    } catch (Exception e) { call.reject("Could not open settings"); }
  }

  @PluginMethod
  public void start(PluginCall call) {
    if (!enabled()) { call.reject("Turn on the focus lock switch first"); return; }
    if (prefs().getLong("end", 0) > System.currentTimeMillis()) { call.reject("A lock is already running"); return; }
    Integer mins = call.getInt("minutes");
    JSArray arr = call.getArray("packages");
    if (mins == null || mins < 5 || mins > 480 || arr == null || arr.length() == 0) { call.reject("Choose apps and a time"); return; }
    Set<String> set = new HashSet<>();
    try { for (int i = 0; i < arr.length(); i++) set.add(arr.getString(i)); } catch (Exception e) { call.reject("Bad app list"); return; }
    long end = System.currentTimeMillis() + mins * 60000L;
    prefs().edit().putStringSet("pkgs", set).putLong("end", end).apply();
    JSObject ret = new JSObject();
    ret.put("end", end);
    call.resolve(ret);
  }
}
`);

fs.mkdirSync(base + '/res/xml', { recursive: true });
fs.writeFileSync(base + '/res/xml/accessibility_service_config.xml', `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagDefault"
    android:canRetrieveWindowContent="false"
    android:notificationTimeout="50"
    android:description="@string/lock_desc" />
`);
fs.mkdirSync(base + '/res/values', { recursive: true });
fs.writeFileSync(base + '/res/values/ar_strings.xml', '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="lock_desc">AR Academy Focus Lock sends the apps you choose back to AR Academy while your focus timer is running. It does not read your screen.</string>\n</resources>\n');

let m = fs.readFileSync(base + '/AndroidManifest.xml', 'utf8');
const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="aracademy" android:host="auth" />
            </intent-filter>
        `;
if (!m.includes('android:scheme="aracademy"')) {
  const i = m.indexOf('</activity>');
  if (i < 0) throw new Error('No activity found in AndroidManifest.xml');
  m = m.slice(0, i) + filter + m.slice(i);
}
/* Android 11+ needs this to see which UPI apps are installed */
if (!m.includes('android:scheme="upi"')) {
  m = m.replace('</manifest>', `    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="upi" android:host="pay" />
        </intent>
        <intent>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent>
        <intent>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.HOME" />
        </intent>
    </queries>
</manifest>`);
}
if (!m.includes('AppLockService')) {
  m = m.replace('</application>', `        <service android:name="${pkg}.AppLockService" android:exported="true" android:label="AR Academy Focus Lock" android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data android:name="android.accessibilityservice" android:resource="@xml/accessibility_service_config" />
        </service>
    </application>`);
}
m = m.replace('android:allowBackup="true"', 'android:allowBackup="false"');
fs.writeFileSync(base + '/AndroidManifest.xml', m);

/* AR Academy icons and splash */
const res = base + '/res';
if (fs.existsSync('res')) {
  for (const d of fs.readdirSync('res')) {
    const from = 'res/' + d;
    if (!fs.statSync(from).isDirectory()) continue;
    fs.mkdirSync(res + '/' + d, { recursive: true });
    for (const f of fs.readdirSync(from)) fs.copyFileSync(from + '/' + f, res + '/' + d + '/' + f);
  }
  /* splash: every splash.png the template made becomes the AR Academy splash */
  if (fs.existsSync('res/splash.png')) {
    const walk = p => fs.readdirSync(p, { withFileTypes: true }).forEach(e => {
      const q = p + '/' + e.name;
      if (e.isDirectory()) walk(q); else if (e.name === 'splash.png') fs.copyFileSync('res/splash.png', q);
    });
    walk(res);
  }
}
const bg = res + '/values/ic_launcher_background.xml';
fs.mkdirSync(res + '/values', { recursive: true });
fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#031A10</color>\n</resources>\n');
console.log('Android project patched');
