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
    </queries>
</manifest>`);
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
