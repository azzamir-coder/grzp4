# Grizlie Nusantara, versi dengan server (v2)

Tanpa `npm install`. Hanya modul bawaan Node.js (butuh Node **22.13+**; server menolak start bila lebih lama).

## Menjalankan (pengembangan)
```
node server.js        # atau: npm start
```
Buka http://localhost:3000. Toko: `/`. Dasbor admin: `/admin` (isi `ADMIN_EMAILS=emailmu@...` dulu, daftar akun itu di situs, verifikasi email, lalu masuk di `/admin`).
Di mode pengembangan (tanpa Midtrans) pembayaran non-COD memakai tombol **Simulasikan pembayaran**; email dicetak di terminal.

## Struktur
```
server.js        server, akun, keamanan, pemantauan, mode pemeliharaan
shop.js          katalog, kupon, ongkir, pesanan, pembayaran Midtrans, retur/refund, ulasan, API admin
public/          index.html, script.js, style.css, admin.html, admin.js, halaman hukum, maintenance.html
cadangkan.js  pulihkan.js  uji-beban.js  cek-produksi.js  lihat-data.js  bersihkan-data-uji.js
test-keamanan.js  test-fitur.js
STATUS-SYARAT.md   status tiap butir syarat peluncuran (baca ini dulu)
RUNBOOK.md  DEPLOY.md  .env.example
```
Data: `data.db` (akun, katalog, stok, kupon, pesanan, poin, ulasan) dan `uploads/` (foto produk). Keduanya harus di penyimpanan permanen dan dicadangkan.

## Yang berubah dari v1
Katalog, harga, stok, kupon, poin, ongkir, dan pesanan kini **dikelola server**; browser hanya mengirim id produk dan jumlah, harga/diskon/total dihitung server. Status pesanan berasal dari tindakan admin atau pembayaran, bukan simulasi waktu. Testimoni, angka statistik, rating, ulasan, dan notifikasi "baru saja membeli" yang berupa data contoh **dihapus**. Ulasan hanya dari pembeli yang pesanannya selesai. Pendaftaran wajib persetujuan; pengguna bisa mengunduh dan menghapus datanya.

Pesanan/poin lama yang tersimpan di tabel `user_data` (v1) tidak dimigrasikan (tidak punya id produk dan semuanya data uji).

## Pengaturan (environment variable)
Lihat `.env.example`. Ringkas: `AUTH_SECRET`, `APP_URL`, `TRUST_PROXY`, `DB_FILE`, `UPLOAD_DIR`, `RESEND_API_KEY`, `MAIL_FROM`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_ENV`, `ADMIN_EMAILS`, `ALERT_WEBHOOK_URL`, `MAINTENANCE`. Di produksi server menolak start bila `AUTH_SECRET`, `TRUST_PROXY`, `RESEND_API_KEY`, `MAIL_FROM`, atau `APP_URL` https belum benar. Tanpa `MIDTRANS_SERVER_KEY`, produksi hanya menawarkan COD dan mencatat galat konfigurasi.

## Alat bantu
| Perintah | Fungsi |
|---|---|
| `npm test` | tes keamanan (39) + tes fitur toko (126), memakai database sementara dan Midtrans tiruan |
| `node cek-produksi.js --simpan=a@x.com --url=https://domain` | periksa kesiapan produksi (hanya membaca) |
| `node cadangkan.js` / `node pulihkan.js --dari=... [--ya]` | cadangan dan pemulihan (lihat RUNBOOK.md) |
| `node uji-beban.js --url=... --pengguna=50 --durasi=60` | uji beban baca |
| `node lihat-data.js` | lihat isi database |
| `node bersihkan-data-uji.js --simpan=... [--hapus]` | hapus akun/pesanan uji |
