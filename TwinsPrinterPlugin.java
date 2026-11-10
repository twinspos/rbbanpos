package id.rbban.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Jembatan cetak untuk RB POS:
 *  - tcpSend : kirim data mentah ke printer LAN/WiFi (IP:port, biasanya 9100)
 *  - btList  : daftar printer Bluetooth klasik yang sudah dipasangkan
 *  - btSend  : kirim data mentah ke printer Bluetooth klasik (SPP)
 *  - systemPrint : dialog cetak sistem Android (pengganti window.print)
 *  - openBtSettings : buka pengaturan Bluetooth HP
 */
@CapacitorPlugin(
    name = "TwinsPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class TwinsPrinterPlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final ExecutorService POOL = Executors.newCachedThreadPool();
    private static final ConcurrentHashMap<String, Object> LOCKS = new ConcurrentHashMap<>();

    /** diisi MainActivity: true bila aktivitas dipulihkan Android (bukan start baru). */
    public static volatile boolean activityRestored = false;
    private static volatile boolean launchConsumed = false;

    private static Object lockFor(String key) {
        Object n = new Object();
        Object o = LOCKS.putIfAbsent(key, n);
        return o == null ? n : o;
    }

    private boolean needBtPermission() {
        return Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    /** restored = Android memulihkan aplikasi dari latar belakang (atau JS dimuat ulang di aktivitas yang sama). false = start baru (ditutup/HP restart). */
    @PluginMethod
    public void launchInfo(PluginCall call) {
        boolean restored = activityRestored || launchConsumed;
        launchConsumed = true;
        JSObject r = new JSObject();
        r.put("restored", restored);
        call.resolve(r);
    }

    /** versi aplikasi terpasang (untuk cek update) */
    @PluginMethod
    public void appInfo(PluginCall call) {
        try {
            android.content.pm.PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            JSObject r = new JSObject();
            r.put("code", code);
            r.put("name", pi.versionName == null ? "" : pi.versionName);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Info aplikasi tidak tersedia");
        }
    }

    /** buka alamat web di browser HP (halaman download update) */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) { call.reject("Alamat tidak valid"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Tidak bisa membuka alamat");
        }
    }

    /* ---------------- LAN ---------------- */

    @PluginMethod
    public void tcpSend(final PluginCall call) {
        final String ip = call.getString("ip");
        final int port = call.getInt("port", 9100);
        final String data = call.getString("data");
        if (ip == null || ip.trim().isEmpty()) { call.reject("IP printer belum diisi"); return; }
        if (data == null) { call.reject("Data kosong"); return; }
        final byte[] bytes;
        try { bytes = Base64.decode(data, Base64.DEFAULT); }
        catch (Exception e) { call.reject("Data tidak valid"); return; }

        POOL.execute(() -> {
            synchronized (lockFor("tcp:" + ip + ":" + port)) {
                Exception last = null;
                for (int attempt = 1; attempt <= 3; attempt++) {
                    Socket s = null;
                    try {
                        s = newWifiSocket();
                        s.connect(new InetSocketAddress(ip.trim(), port), 5000);
                        s.setSoTimeout(5000);
                        s.setTcpNoDelay(true);
                        OutputStream o = s.getOutputStream();
                        int off = 0;
                        while (off < bytes.length) {
                            int n = Math.min(1024, bytes.length - off);
                            o.write(bytes, off, n);
                            off += n;
                        }
                        o.flush();
                        Thread.sleep(300);
                        call.resolve();
                        return;
                    } catch (Exception e) {
                        last = e;
                        try { Thread.sleep(1200); } catch (InterruptedException ie) { }
                    } finally {
                        try { if (s != null) s.close(); } catch (Exception ignore) { }
                    }
                }
                call.reject("Printer " + ip + ":" + port + " tidak terjangkau setelah 3x coba. Pastikan printer tidak sedang dipakai aplikasi lain dan satu WiFi. (" + (last == null ? "-" : last.getMessage()) + ")");
            }
        });
    }

    /** Socket yang dipaksa lewat jaringan WiFi (bukan data seluler), seperti aplikasi kasir lain. */
    private Socket newWifiSocket() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                for (Network n : cm.getAllNetworks()) {
                    NetworkCapabilities c = cm.getNetworkCapabilities(n);
                    if (c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        return n.getSocketFactory().createSocket();
                    }
                }
            }
        } catch (Throwable ignore) { }
        return new Socket();
    }

    /* ---------------- Bluetooth klasik ---------------- */

    @PluginMethod
    public void btList(PluginCall call) {
        if (needBtPermission()) { requestPermissionForAlias("bluetooth", call, "btListPerm"); return; }
        doBtList(call);
    }

    @PermissionCallback
    private void btListPerm(PluginCall call) {
        if (needBtPermission()) call.reject("Izin Bluetooth ditolak. Izinkan 'Perangkat sekitar' di pengaturan aplikasi.");
        else doBtList(call);
    }

    @SuppressLint("MissingPermission")
    private void doBtList(PluginCall call) {
        try {
            BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
            if (ad == null) { call.reject("HP ini tidak punya Bluetooth"); return; }
            if (!ad.isEnabled()) { call.reject("Bluetooth belum menyala. Nyalakan Bluetooth dulu."); return; }
            Set<BluetoothDevice> bonded = ad.getBondedDevices();
            JSArray arr = new JSArray();
            for (BluetoothDevice d : bonded) {
                if (d.getType() == BluetoothDevice.DEVICE_TYPE_LE) continue; // BLE saja: belum didukung
                JSObject o = new JSObject();
                String n = d.getName();
                o.put("name", n == null ? d.getAddress() : n);
                o.put("address", d.getAddress());
                arr.put(o);
            }
            JSObject r = new JSObject();
            r.put("devices", arr);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Gagal membaca daftar printer: " + e.getMessage());
        }
    }

    @PluginMethod
    public void btSend(PluginCall call) {
        if (needBtPermission()) { requestPermissionForAlias("bluetooth", call, "btSendPerm"); return; }
        doBtSend(call);
    }

    @PermissionCallback
    private void btSendPerm(PluginCall call) {
        if (needBtPermission()) call.reject("Izin Bluetooth ditolak. Izinkan 'Perangkat sekitar' di pengaturan aplikasi.");
        else doBtSend(call);
    }

    @SuppressLint("MissingPermission")
    private void doBtSend(final PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null) { call.reject("Printer belum dipilih"); return; }
        if (data == null) { call.reject("Data kosong"); return; }
        final byte[] bytes;
        try { bytes = Base64.decode(data, Base64.DEFAULT); }
        catch (Exception e) { call.reject("Data tidak valid"); return; }

        POOL.execute(() -> {
            synchronized (lockFor("bt:" + address)) {
                BluetoothSocket sock = null;
                try {
                    BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
                    if (ad == null || !ad.isEnabled()) { call.reject("Bluetooth belum menyala"); return; }
                    // cancelDiscovery butuh izin BLUETOOTH_SCAN di Android 12+; tidak wajib, jadi jangan sampai membuat cetak gagal
                    try { ad.cancelDiscovery(); } catch (Throwable ignore) { }
                    BluetoothDevice dev = ad.getRemoteDevice(address);
                    sock = dev.createRfcommSocketToServiceRecord(SPP);
                    try {
                        sock.connect();
                    } catch (Exception first) {
                        try { sock.close(); } catch (Exception ignore) { }
                        // cadangan untuk printer yang menolak UUID standar
                        Method m = dev.getClass().getMethod("createRfcommSocket", int.class);
                        sock = (BluetoothSocket) m.invoke(dev, 1);
                        sock.connect();
                    }
                    OutputStream o = sock.getOutputStream();
                    int off = 0;
                    while (off < bytes.length) {
                        int n = Math.min(512, bytes.length - off);
                        o.write(bytes, off, n);
                        o.flush();
                        off += n;
                        Thread.sleep(20);
                    }
                    Thread.sleep(500 + Math.min(2500, bytes.length / 20));
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Gagal mencetak ke printer Bluetooth. Pastikan printer menyala dan dekat HP. (" + e.getMessage() + ")");
                } finally {
                    try { if (sock != null) sock.close(); } catch (Exception ignore) { }
                }
            }
        });
    }

    @PluginMethod
    public void openBtSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Tidak bisa membuka pengaturan Bluetooth");
        }
    }

    /* ---------------- Cetak sistem Android ---------------- */

    @PluginMethod
    public void systemPrint(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WebView wv = getBridge().getWebView();
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter("RB POS");
                pm.print("RB POS", adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                call.reject("Cetak sistem gagal: " + e.getMessage());
            }
        });
    }

    /* ---------------- Pesanan pelayan (Wi-Fi toko) ---------------- */

    private static final LanHub HUB = new LanHub();

    /** Kasir: mulai menerima pesanan pelayan di port tertentu. */
    @PluginMethod
    public void lanStart(final PluginCall call) {
        final int port = call.getInt("port", 9120);
        final String key = call.getString("key", "");
        POOL.execute(() -> {
            try {
                int p = HUB.start(port, key);
                JSObject r = new JSObject();
                r.put("port", p);
                r.put("ip", LanHub.localIp());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Tidak bisa membuka penerima pesanan: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void lanStop(PluginCall call) { HUB.stop(); call.resolve(); }

    /** Kasir: ambil pesanan yang masuk (tiap sekitar 0,6 detik). */
    @PluginMethod
    public void lanPop(PluginCall call) {
        try {
            JSObject r = new JSObject("{\"running\":" + HUB.running() + ",\"items\":" + HUB.pop() + "}");
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Gagal membaca antrean pesanan");
        }
    }

    /** Kasir: balas pesanan (json) setelah tersimpan. */
    @PluginMethod
    public void lanReply(PluginCall call) {
        boolean ok = HUB.reply(call.getString("rid", ""), call.getString("json", ""));
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }

    /** Kasir: simpan keadaan terbaru (meja terisi, siapa yang mencetak) untuk dibaca HP pelayan. */
    @PluginMethod
    public void lanSetState(PluginCall call) {
        HUB.setState(call.getString("json", ""));
        call.resolve();
    }

    @PluginMethod
    public void lanInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ip", LanHub.localIp());
        r.put("running", HUB.running());
        call.resolve(r);
    }

    /** Pelayan: kirim satu permintaan ke kasir. op = ping | state | order. */
    @PluginMethod
    public void lanRequest(final PluginCall call) {
        final String ip = call.getString("ip", "").trim();
        final int port = call.getInt("port", 9120);
        final String key = call.getString("key", "");
        final String op = call.getString("op", "ping");
        final String body = call.getString("body", "{}");
        final int timeout = call.getInt("timeout", 9000);
        if (ip.isEmpty()) { call.reject("Alamat kasir belum diisi"); return; }
        POOL.execute(() -> {
            try {
                String line = LanHub.request(() -> newWifiSocket(), ip, port, key, op, body, timeout);
                JSObject r = new JSObject();
                r.put("reply", line);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Kasir tidak terjangkau: " + e.getMessage());
            }
        });
    }

    /** Pelayan: cari kasir otomatis di Wi-Fi yang sama. */
    @PluginMethod
    public void lanScan(final PluginCall call) {
        final int port = call.getInt("port", 9120);
        final String key = call.getString("key", "");
        POOL.execute(() -> {
            try {
                String me = LanHub.localIp();
                int dot = me.lastIndexOf('.');
                if (dot < 0) { call.reject("Tidak tersambung ke Wi-Fi"); return; }
                java.util.List<String> hosts = LanHub.scan(() -> newWifiSocket(), me.substring(0, dot + 1), port, key, 350);
                JSArray arr = new JSArray();
                for (String h : hosts) arr.put(h);
                JSObject r = new JSObject();
                r.put("hosts", arr);
                r.put("me", me);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Pencarian gagal: " + e.getMessage());
            }
        });
    }
}
