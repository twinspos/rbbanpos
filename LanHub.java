package id.rbban.pos;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Jalur pesanan pelayan di Wi-Fi toko (murni JDK, tanpa HTTP).
 * Satu baris per permintaan:  KUNCI \t OP \t ISI-JSON \n   ->   balasan JSON satu baris.
 * OP: ping | state | order. "order" ditahan sampai aplikasi kasir membalas (lanReply) atau waktu habis,
 * sehingga pelayan baru melihat "Terkirim" kalau pesanan benar-benar sudah tersimpan di kasir.
 */
public class LanHub {
    static final int MAX_LINE = 2_000_000;
    static final long WAIT_MS = 6000;

    public interface SocketMaker { Socket make() throws IOException; }

    static class Req {
        final String rid; final String body;
        final CountDownLatch latch = new CountDownLatch(1);
        volatile String reply;
        Req(String rid, String body) { this.rid = rid; this.body = body; }
    }

    private final ExecutorService pool = Executors.newCachedThreadPool(r -> { Thread t = new Thread(r, "lanhub"); t.setDaemon(true); return t; });
    private final ConcurrentLinkedQueue<Req> queue = new ConcurrentLinkedQueue<>();
    private final ConcurrentHashMap<String, Req> pending = new ConcurrentHashMap<>();
    private final AtomicLong seq = new AtomicLong();
    private volatile ServerSocket server;
    private volatile String key = "";
    private volatile String state = "{\"ok\":true}";
    private volatile long lastPop = 0;

    public synchronized int start(int port, String key) throws IOException {
        stop();
        this.key = key == null ? "" : key;
        ServerSocket s = new ServerSocket();
        s.setReuseAddress(true);
        s.bind(new InetSocketAddress(port));
        server = s;
        pool.execute(() -> accept(s));
        return s.getLocalPort();
    }

    public synchronized void stop() {
        ServerSocket s = server; server = null;
        if (s != null) try { s.close(); } catch (IOException ignored) { }
        for (Req r : pending.values()) { r.reply = "{\"ok\":false,\"err\":\"kasir berhenti\"}"; r.latch.countDown(); }
        pending.clear(); queue.clear();
    }

    public boolean running() { return server != null; }

    private void accept(ServerSocket s) {
        while (server == s && !s.isClosed()) {
            try {
                final Socket c = s.accept();
                pool.execute(() -> handle(c));
            } catch (IOException e) { if (server != s) return; }
        }
    }

    private static String esc(String m) { return m.replace("\\", "\\\\").replace("\"", "\\\""); }
    private static String err(String m) { return "{\"ok\":false,\"err\":\"" + esc(m) + "\"}"; }

    private void handle(Socket c) {
        try (Socket sock = c) {
            sock.setSoTimeout(8000);
            BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8), 8192);
            String line = readLine(in);
            String out;
            if (line == null) out = err("kosong");
            else {
                int a = line.indexOf('\t'), b = a < 0 ? -1 : line.indexOf('\t', a + 1);
                if (a < 0 || b < 0) out = err("format salah");
                else {
                    String k = line.substring(0, a), op = line.substring(a + 1, b), body = line.substring(b + 1);
                    if (!key.isEmpty() && !key.equals(k)) out = err("kunci salah");
                    else if (op.equals("ping")) out = "{\"ok\":true,\"app\":\"twinspos\"}";
                    else if (op.equals("state")) out = state;
                    else if (op.equals("order")) out = order(body);
                    else out = err("perintah tidak dikenal");
                }
            }
            OutputStream os = sock.getOutputStream();
            os.write((out + "\n").getBytes(StandardCharsets.UTF_8));
            os.flush();
        } catch (IOException ignored) { }
    }

    private static String readLine(BufferedReader in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int ch;
        while ((ch = in.read()) != -1) {
            if (ch == '\n') break;
            if (ch != '\r') sb.append((char) ch);
            if (sb.length() > MAX_LINE) return null;
        }
        return sb.length() == 0 && ch == -1 ? null : sb.toString();
    }

    private String order(String body) {
        if (System.currentTimeMillis() - lastPop > 5000 && lastPop != 0) { /* aplikasi kasir tidak aktif memeriksa */ }
        Req r = new Req("r" + seq.incrementAndGet(), body);
        pending.put(r.rid, r);
        queue.add(r);
        try {
            if (!r.latch.await(WAIT_MS, TimeUnit.MILLISECONDS)) { pending.remove(r.rid); queue.remove(r); return err("kasir tidak merespons"); }
        } catch (InterruptedException e) { return err("terputus"); }
        return r.reply == null ? err("tanpa balasan") : r.reply;
    }

    /** Diambil aplikasi kasir: daftar JSON [{"rid":"r1","body":{...}}] (body sudah berupa JSON). */
    public String pop() {
        lastPop = System.currentTimeMillis();
        StringBuilder sb = new StringBuilder("[");
        Req r; boolean first = true;
        while ((r = queue.poll()) != null) {
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"rid\":\"").append(r.rid).append("\",\"body\":").append(r.body).append('}');
        }
        return sb.append(']').toString();
    }

    public boolean reply(String rid, String json) {
        Req r = pending.remove(rid);
        if (r == null) return false;
        r.reply = json == null ? "{\"ok\":true}" : json.replace("\n", " ").replace("\r", " ");
        r.latch.countDown();
        return true;
    }

    public void setState(String json) { if (json != null && !json.isEmpty()) state = json.replace("\n", " ").replace("\r", " "); }

    /* ---------- klien (HP pelayan) ---------- */

    public static String request(String host, int port, String key, String op, String body, int timeoutMs) throws IOException {
        return request(null, host, port, key, op, body, timeoutMs);
    }

    public static String request(SocketMaker mk, String host, int port, String key, String op, String body, int timeoutMs) throws IOException {
        try (Socket s = mk == null ? new Socket() : mk.make()) {
            s.connect(new InetSocketAddress(host, port), Math.min(timeoutMs, 4000));
            s.setSoTimeout(timeoutMs);
            OutputStream os = s.getOutputStream();
            os.write(((key == null ? "" : key) + "\t" + op + "\t" + (body == null ? "{}" : body.replace("\n", " ").replace("\r", " ")) + "\n").getBytes(StandardCharsets.UTF_8));
            os.flush();
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
            String l = in.readLine();
            if (l == null) throw new IOException("tanpa balasan");
            return l;
        }
    }

    /** Cari kasir di jaringan: coba awalan.1 sampai awalan.254 (mis. "192.168.1."). */
    public static List<String> scan(String prefix, int port, String key, int connectMs) {
        return scan(null, prefix, port, key, connectMs);
    }

    public static List<String> scan(final SocketMaker mk, String prefix, int port, String key, int connectMs) {
        final List<String> found = Collections.synchronizedList(new ArrayList<String>());
        ExecutorService ex = Executors.newFixedThreadPool(48);
        for (int i = 1; i <= 254; i++) {
            final String ip = prefix + i;
            ex.execute(() -> {
                try (Socket s = mk == null ? new Socket() : mk.make()) {
                    s.connect(new InetSocketAddress(ip, port), connectMs);
                    s.setSoTimeout(1200);
                    s.getOutputStream().write(((key == null ? "" : key) + "\tping\t{}\n").getBytes(StandardCharsets.UTF_8));
                    s.getOutputStream().flush();
                    String l = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8)).readLine();
                    if (l != null && l.contains("\"ok\":true")) found.add(ip);
                } catch (IOException ignored) { }
            });
        }
        ex.shutdown();
        try { ex.awaitTermination(20, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        ex.shutdownNow();
        List<String> r = new ArrayList<>(found);
        Collections.sort(r);
        return r;
    }

    /** Alamat IPv4 Wi-Fi/LAN perangkat ini (bukan loopback). */
    public static String localIp() {
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            String best = "";
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName() == null ? "" : ni.getName();
                if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("tun")) continue;
                Enumeration<InetAddress> as = ni.getInetAddresses();
                while (as.hasMoreElements()) {
                    InetAddress a = as.nextElement();
                    if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress()) {
                        String h = a.getHostAddress();
                        if (n.startsWith("wlan") || n.startsWith("eth")) return h;
                        if (best.isEmpty()) best = h;
                    }
                }
            }
            return best;
        } catch (Exception e) { return ""; }
    }
}
