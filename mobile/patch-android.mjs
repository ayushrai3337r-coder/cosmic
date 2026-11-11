import fs from 'node:fs';

const base = 'android/app/src/main';
const dir = base + '/java/com/cosmic/notes';
if (!fs.existsSync(base + '/AndroidManifest.xml')) throw new Error('Android project was not created. Run "npx cap add android" first.');
fs.mkdirSync(dir, { recursive: true });

/* FLAG_SECURE blocks screenshots, screen recording and the recent-apps preview */
fs.writeFileSync(dir + '/MainActivity.java', `package com.cosmic.notes;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    super.onCreate(savedInstanceState);
  }
}
`);

let m = fs.readFileSync(base + '/AndroidManifest.xml', 'utf8');
const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="cosmic" android:host="auth" />
            </intent-filter>
        `;
if (!m.includes('android:scheme="cosmic"')) {
  const i = m.indexOf('</activity>');
  if (i < 0) throw new Error('No activity found in AndroidManifest.xml');
  m = m.slice(0, i) + filter + m.slice(i);
}
m = m.replace('android:allowBackup="true"', 'android:allowBackup="false"');
fs.writeFileSync(base + '/AndroidManifest.xml', m);
console.log('Android project patched');
