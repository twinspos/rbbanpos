// RB POS - dijalankan setelah `npx cap add android`: memasang plugin cetak, izin, nomor versi, dan ikon.
const fs = require('fs');
const path = require('path');

const root = __dirname;
const pkgDir = path.join(root, 'android/app/src/main/java/id/rbban/pos');
const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
const gradlePath = path.join(root, 'android/app/build.gradle');

function must(cond, msg) { if (!cond) { console.error('GAGAL: ' + msg); process.exit(1); } }

// 0. file pendamping POS (config.js, pelanggan.js) ikut dibundel ke dalam aplikasi
const wwwDir = path.join(root, 'www');
fs.mkdirSync(wwwDir, { recursive: true });
['config.js', 'pelanggan.js', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'].forEach(f => {
  const src = path.join(root, f);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(wwwDir, f)); console.log('Disalin ke www: ' + f); }
  else console.warn('PERINGATAN: ' + f + ' tidak ada di repositori, fitur yang memakainya tidak akan aktif');
});

// 1. plugin + MainActivity
must(fs.existsSync(path.join(root, 'android/app')), 'proyek Android belum dibuat (jalankan npx cap add android dulu)');
fs.mkdirSync(pkgDir, { recursive: true });
// plugin printer dari TWINS POS dipakai apa adanya; hanya nama package-nya disesuaikan ke id.rbban.pos
['TwinsPrinterPlugin.java', 'LanHub.java'].forEach(f => {
  const src = path.join(root, f);
  must(fs.existsSync(src), f + ' tidak ada di repositori (salin dari repositori TWINS POS)');
  const code = fs.readFileSync(src, 'utf8').replace(/id\.twinspos\.pos/g, 'id.rbban.pos').replace(/TWINS POS/g, 'RB POS');
  fs.writeFileSync(path.join(pkgDir, f), code);
});
fs.writeFileSync(path.join(pkgDir, 'MainActivity.java'),
`package id.rbban.pos;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.webkit.JavascriptInterface;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        TwinsPrinterPlugin.activityRestored = (savedInstanceState != null);
        registerPlugin(TwinsPrinterPlugin.class);
        super.onCreate(savedInstanceState);
        try {   // agar <meta viewport width=...> dipakai: layar HP landscape tampil seperti tablet
            android.webkit.WebSettings ws = getBridge().getWebView().getSettings();
            ws.setUseWideViewPort(true);
            ws.setLoadWithOverviewMode(true);
        } catch (Exception ignore) { }
        // warna status bar mengikuti header aplikasi (supaya header terlihat penuh sampai atas)
        try {
            setBar("#0d0d0d");
            getBridge().getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void set(final String hex) { runOnUiThread(new Runnable() { public void run() { setBar(hex); } }); }
            }, "TwinsBar");
        } catch (Exception ignore) { }
        // tombol back Android: tanya aplikasi (tutup popup / kembali ke Kasir) sebelum keluar
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                try {
                    getBridge().getWebView().evaluateJavascript(
                        "(function(){try{return window.twinsBack?window.twinsBack():0}catch(e){return 0}})()",
                        value -> { if (value == null || value.trim().equals("0") || value.trim().equals("null")) finish(); });
                } catch (Exception e) { finish(); }
            }
        });
    }

    private void setBar(String hex) {
        try {
            Window w = getWindow();
            w.setStatusBarColor(Color.parseColor(hex));
            android.view.View v = w.getDecorView();
            v.setSystemUiVisibility(v.getSystemUiVisibility() & ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        } catch (Exception ignore) { }
    }
}
`);

// 2. izin di AndroidManifest
let mf = fs.readFileSync(manifestPath, 'utf8');
const perms = [
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
  '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />'
];
perms.forEach(p => {
  const name = p.match(/android:name="([^"]+)"/)[1];
  if (!mf.includes('android:name="' + name + '"')) mf = mf.replace('</manifest>', '    ' + p + '\n</manifest>');
});
// layar tetap menyala saat kasir dipakai tidak diatur di sini; hanya izin yang ditambah
fs.writeFileSync(manifestPath, mf);

// 3. nomor versi naik otomatis supaya APK baru bisa menimpa yang lama
let g = fs.readFileSync(gradlePath, 'utf8');
const run = parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10) || 1;
if (!/versionCode\s+\d+/.test(g)) console.warn('PERINGATAN: versionCode tidak ditemukan, nomor versi tidak diubah');
g = g.replace(/versionCode\s+\d+/, 'versionCode ' + run).replace(/versionName\s+"[^"]*"/, 'versionName "1.' + run + '"');
fs.writeFileSync(gradlePath, g);

// 4. ikon aplikasi dari icon.png (dijalankan di sini supaya pasti ikut setiap build)
const { execSync } = require('child_process');
if (fs.existsSync(path.join(root, 'icon.png'))) {
  try {
    try { execSync('python3 -c "import PIL"', { stdio: 'ignore' }); }
    catch (e) { execSync('python3 -m pip install pillow', { stdio: 'inherit' }); }
    execSync('python3 make-icons.py', { stdio: 'inherit', cwd: root });
  } catch (e) {
    console.error('GAGAL membuat ikon aplikasi: ' + e.message);
    process.exit(1);
  }
} else {
  console.error('GAGAL: icon.png tidak ada di folder utama repositori');
  process.exit(1);
}

console.log('Patch selesai. versionCode=' + run);
