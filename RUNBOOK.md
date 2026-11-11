# Runbook operasional Grizlie Nusantara

Dokumen ini untuk syarat **I-03** (cadangan & pemulihan), **I-05** (pemantauan), **I-07** (prosedur pemulihan & mode pemeliharaan), dan **H-05** (penanganan kebocoran data).
Prosedur harus bisa dijalankan oleh **lebih dari satu orang**: DevOps dan Ketua. Latih keduanya, lalu catat tanggal latihan di bagian paling bawah.

## 1. Menutup toko sementara (mode pemeliharaan)
**Cara biasa (dasbor):** masuk `/admin` → Pengaturan → centang *Tutup toko sementara* → Simpan.
**Cara darurat (dasbor tidak bisa dibuka):** set `MAINTENANCE=1` di environment server, lalu restart service.

Efeknya: pembeli melihat halaman pemeliharaan (HTTP 503), pesanan baru ditolak. Tetap hidup: `/api/health`, login, dasbor admin, dan webhook pembayaran (supaya pembayaran yang sedang berjalan tetap tercatat).
Buka kembali: hapus centang / hapus `MAINTENANCE`.

## 2. Cadangan (I-03)
Yang dicadangkan: `data.db` (akun, pesanan, produk, kupon, ulasan) dan folder `uploads/` (foto produk).

```
node cadangkan.js                      # buat cadangan di backup/<waktu>/
node cadangkan.js --simpan=30          # simpan 30 cadangan terbaru
```
- Aman dijalankan saat server hidup. Memakai `VACUUM INTO`, jadi hasilnya **satu file `data.db` utuh**; **tidak perlu** menyalin `data.db-shm` dan `data.db-wal` secara terpisah. (Menyalin ketiga file manual saat server hidup justru bisa menghasilkan salinan rusak.)
- Setiap cadangan diperiksa otomatis (`integrity_check`).
- Jadwal (cron, tiap 6 jam): `0 */6 * * * cd /opt/grizlie && node --no-warnings cadangkan.js >> cadangan.log 2>&1`
- **Salin `backup/` ke tempat lain** (bucket penyimpanan / komputer lain) setiap hari. Cadangan yang hanya ada di disk yang sama tidak menolong bila disk rusak. Cadangan berisi data pribadi: batasi aksesnya.

## 3. Pemulihan (I-03, I-07)
1. Tutup toko (bagian 1, cara darurat bila perlu), lalu **hentikan server**: `systemctl stop grizlie`.
2. Simulasi: `node pulihkan.js --dari=backup/<folder>` (memeriksa cadangan, menampilkan jumlah akun/pesanan/produk).
3. Pulihkan: `node pulihkan.js --dari=backup/<folder> --ya`
   - Skrip menolak jalan bila server masih hidup.
   - Data saat ini tidak dihapus: disalin ke `*.sebelum-pulih-<waktu>`.
4. Nyalakan server: `systemctl start grizlie`, jalankan `node cek-produksi.js --url=https://domainmu.com`, buka toko, dasbor, dan satu pesanan lama.
5. Buka toko kembali. Catat: kapan, dari cadangan mana, dan berapa pesanan yang hilang (selisih antara cadangan dan saat kejadian). Periksa pesanan yang masuk setelah cadangan terakhir lewat dasbor Midtrans dan email, lalu catat ulang bila perlu.

**Uji pemulihan** minimal sekali di server uji sebelum peluncuran, dan ulangi tiap kuartal. Syarat I-03 baru terpenuhi setelah ada catatan uji yang berhasil.

## 4. Pemantauan & peringatan (I-05)
- **Uptime:** daftarkan `https://domainmu.com/api/health` ke pemantau eksternal (mis. UptimeRobot, Better Stack) dengan peringatan ke email/WhatsApp tim. Endpoint ini juga memeriksa database (503 bila database bermasalah).
- **Galat:** server menulis satu baris JSON per galat (`level`, `tag`, `message`) ke log. Pasang `ALERT_WEBHOOK_URL` (webhook Slack/Discord); server mengirim peringatan saat crash dan saat ≥5 galat dalam 5 menit (maks. satu peringatan per 10 menit).
- **Penjaga proses:** jalankan lewat systemd/Docker dengan *restart otomatis*; server sengaja keluar saat ada galat tak terduga supaya dimulai ulang bersih. Contoh unit systemd ada di `DEPLOY.md`.
- Tinjau log tiap hari pada minggu pertama: `journalctl -u grizlie --since today | grep '"level":"error"'`.

## 5. Pembayaran bermasalah
| Gejala | Tindakan |
|---|---|
| Pembeli sudah bayar tapi pesanan "menunggu pembayaran" | Cek dasbor Midtrans. Bila *settlement*, pastikan Notification URL benar (`https://domain/api/payments/midtrans`). Bila perlu: dasbor admin → Pesanan → *Tandai sudah dibayar* (wajib isi bukti). |
| Pesanan dibatalkan otomatis tapi uang terpotong | Refund lewat dasbor Midtrans, lalu catat di Pesanan → *Refund sudah dikirim*. |
| Gateway mati | Hanya COD yang aman; pertimbangkan mode pemeliharaan. Pesanan non-COD yang gagal dibuat dibatalkan otomatis dan stoknya kembali. |

## 6. Refund dan retur (F-10)
Antrean: dasbor → Pesanan → filter *perlu_refund*. Refund dikirim **lewat dasbor Midtrans** (bukan otomatis), lalu catat referensinya di sistem; baru status menjadi *selesai* dan email dikirim ke pembeli. Untuk retur: Setujui → barang tiba → *Refund sudah dikirim* (stok dan poin dikembalikan).

## 7. Penghapusan data & kebocoran data (H-05)
- **Permintaan hapus data:** pengguna bisa menghapus akun sendiri (menu Keamanan akun). Bila meminta lewat email: verifikasi identitas dari email akun, lalu hapus dengan `node bersihkan-data-uji.js --simpan=<akun yang dipertahankan, tanpa akun itu> --hapus`. Pesanan dipertahankan tanpa identitas untuk pembukuan.
- **Dugaan kebocoran data:** (1) aktifkan mode pemeliharaan; (2) ganti `AUTH_SECRET` (semua sesi login batal), `RESEND_API_KEY`, `MIDTRANS_SERVER_KEY`; (3) amankan log dan cadangan sebagai bukti; (4) tentukan data apa dan siapa yang terdampak; (5) beri tahu pengguna terdampak dan pihak berwenang sesuai batas waktu yang berlaku (**tanyakan Penasihat Hukum; jangan lewat dari batas waktu**); (6) catat kronologi dan perbaikan.

## 8. Catatan latihan (isi saat dilatih)
| Tanggal | Prosedur | Dijalankan oleh | Hasil / catatan |
|---|---|---|---|
| | Mode pemeliharaan | | |
| | Cadangan + pemulihan di server uji | | |
| | Refund + retur uji | | |
