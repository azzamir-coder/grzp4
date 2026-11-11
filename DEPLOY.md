# Panduan pemasangan (I-01, I-02, I-04)

Server butuh **Node.js 22.13+** dan **penyimpanan permanen** untuk `data.db` dan `uploads/`. Server akan menolak start bila Node-nya terlalu lama.

## Pilih hosting
Syarat mutlak: disk yang **tidak hilang saat restart/deploy ulang** (VPS biasa, atau layanan PaaS dengan *persistent volume*). Hosting yang memakai disk sementara (banyak free tier serverless/PaaS) akan menghapus pesanan Anda. Sebelum memilih, pastikan: ada volume permanen, bisa set environment variable, bisa menjalankan proses Node terus-menerus, dan menyediakan HTTPS (atau Anda pasang Nginx + Let's Encrypt/Cloudflare).

## Contoh: VPS Ubuntu + systemd + Nginx
1. Pasang Node 22 (mis. dari nodejs.org atau `nvm`), salin folder proyek ke `/opt/grizlie`, buat user `grizlie`.
2. Folder data permanen: `sudo mkdir -p /data && sudo chown grizlie /data`.
3. `/etc/grizlie.env`: isi dari `.env.example` (`chmod 600`). Pakai `DB_FILE=/data/data.db`, `UPLOAD_DIR=/data/uploads`.
4. `/etc/systemd/system/grizlie.service`:
```
[Unit]
Description=Grizlie Nusantara
After=network.target

[Service]
User=grizlie
WorkingDirectory=/opt/grizlie
EnvironmentFile=/etc/grizlie.env
ExecStart=/usr/bin/node --no-warnings server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
`sudo systemctl enable --now grizlie`
5. Nginx sebagai proxy HTTPS ke `127.0.0.1:3000` dengan header `X-Forwarded-For` dan `X-Forwarded-Proto`. Set `TRUST_PROXY=1`. Terbitkan sertifikat: `sudo certbot --nginx -d domainmu.com`.
6. Batasi ukuran unggahan di Nginx: `client_max_body_size 8m;` (foto produk sampai 4 MB).

## Domain dan DNS (I-02)
Arahkan record `A` (dan `AAAA` bila ada) `domainmu.com` dan `www` ke IP server. Catat di dokumen: registrar, tanggal kedaluwarsa domain, nameserver, dan semua record DNS (screenshot dasbor DNS cukup). Aktifkan perpanjangan otomatis domain.

## Midtrans
1. Daftar dan lengkapi verifikasi bisnis di Midtrans. Ambil **Server Key** (Sandbox dulu, lalu Production).
2. Dasbor Midtrans → Settings → Payment → **Payment Notification URL**: `https://domainmu.com/api/payments/midtrans`.
3. Uji di Sandbox dengan `MIDTRANS_ENV` dikosongkan: bayar sukses, gagal, kedaluwarsa. Lalu ganti ke Server Key produksi dan `MIDTRANS_ENV=production`, uji satu transaksi nominal kecil dan refund-nya (F-03).

## Email (Resend)
Verifikasi domain pengirim di resend.com, isi `RESEND_API_KEY` dan `MAIL_FROM`. Uji: daftar akun baru, terima email verifikasi; buat pesanan uji, terima konfirmasi.

## Sebelum buka
1. `node test-keamanan.js && node test-fitur.js` (di komputer pengembangan).
2. Daftar akun pemilik di situs, verifikasi email. Isi `ADMIN_EMAILS` dengan email itu, restart.
3. Dasbor `/admin`: tinjau semua produk (centang *sudah ditinjau*), isi stok, unggah foto asli, isi **tarif ongkir sebenarnya** lalu centang *sudah ditinjau*, aktifkan hanya kupon yang disetujui pemilik, hapus kupon uji.
4. `node bersihkan-data-uji.js --simpan=<akun resmi>` bila ada akun/pesanan uji; periksa stok sesudahnya.
5. Telaah halaman hukum oleh Penasihat Hukum, isi semua `{{ISI: ...}}`, hapus kotak DRAF.
6. `node cadangkan.js`, jadwalkan cron, uji pemulihan di server uji.
7. Dari komputer lain: `node uji-beban.js --url=https://domainmu.com --pengguna=<target> --durasi=60`; simpan hasilnya.
8. `node cek-produksi.js --simpan=<akun resmi> --url=https://domainmu.com` sampai tidak ada **GAGAL**.
