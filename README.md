# RB POS

Aplikasi kasir dan back office untuk **RB Ban** (toko ban), dengan data tersimpan di Google Sheet.

| File | Isi |
|---|---|
| `index.html` | Aplikasi kasir (tablet / HP) |
| `backoffice.html` | Back office: laporan, produk & stok, pembelian, akuntansi, karyawan, gaji |
| `status.html` | Halaman status servis untuk pelanggan (link dikirim lewat WhatsApp) |
| `config.js` | Pengaturan aplikasi |
| `pelanggan.js` | Modul pelanggan. **Salin dari folder TWINS POS** |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Supaya bisa dipasang di layar utama HP/tablet |
| `apps-script/Code.gs` | Kode server untuk Google Sheet. **Jangan dibuka lewat GitHub Pages**, tempel di Apps Script |

## 1. Upload ke GitHub

1. Buat repository baru, misalnya `rb-pos`.
2. Upload semua isi folder ini, termasuk file `pelanggan.js` dari folder TWINS POS.
3. Buka **Settings → Pages**, lalu pilih **Branch: main** dan folder **/(root)**. Klik **Save**.
4. Setelah 1–2 menit, aplikasi bisa dibuka di:
   - Kasir: `https://NAMAUSER.github.io/rb-pos/`
   - Back office: `https://NAMAUSER.github.io/rb-pos/backoffice.html`

> Kalau repository di-set **Private**, GitHub Pages hanya bisa jalan di akun berbayar. Pakai **Public** saja, karena data toko tersimpan di Google Sheet, bukan di GitHub.

## 2. Pasang Google Sheet (satu kali per cabang)

1. Buat Google Sheet baru, misalnya "RB Ban - Pusat".
2. Buka **Extensions → Apps Script**, hapus isinya, lalu tempel isi `apps-script/Code.gs`.
3. Kalau mau, ganti `TOKEN` di baris atas dengan kata acak milikmu sendiri.
4. Klik **Deploy → New deployment → Web app**. Isi **Execute as: Me** dan **Who has access: Anyone**, lalu Deploy dan salin URL `.../exec`.
5. Isi sheet **Staf** untuk login back office: kolom A nomor HP, B PIN, C nama, D peran.

## 3. Sambungkan aplikasi

- **Kasir:** buka **Lainnya → Pengaturan → Koneksi Online → Pengaturan manual**. Isi URL Web App dan Token.
- **Back office:** di kolom "Kode Toko", tempel URL Web App, lalu isi nomor HP dan PIN.
- **Status servis:** di kasir, buka **Pengaturan → Status Jasa**. Isi alamat `https://NAMAUSER.github.io/rb-pos/status.html`.

## Cabang

Tiap cabang memakai Google Sheet dan deploy Code.gs sendiri. Aplikasinya tetap satu, yaitu link GitHub yang sama. Bedakan nama cabang di **Pengaturan → Profil Outlet**, misalnya "RB Ban Karawang".

## Update aplikasi

Ganti file di GitHub, lalu buka ulang aplikasinya. Kalau tampilan belum berubah, tutup aplikasi lalu buka lagi.
