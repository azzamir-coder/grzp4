# Status Syarat Kesiapan Peluncuran Umum v1.0

Legenda: **SELESAI** = kode dibuat dan diuji otomatis · **BUTUH ANDA** = kode siap tetapi butuh akun/data/keputusan/tindakan Anda · **BUKAN KODE** = tidak bisa diselesaikan lewat program.
`node cek-produksi.js` memeriksa sebagian besar butir ini di server produksi.

## F: Fungsional
| No | Status | Keterangan |
|---|---|---|
| F-01 | SELESAI | Katalog, harga, stok, kupon di server (`/api/catalog`); diubah hanya lewat dasbor admin. Perubahan di peramban tidak berpengaruh (diuji). |
| F-02 | SELESAI | Total dihitung server; harga/diskon/total kiriman klien diabaikan; kupon, qty, stok, COD dicek (diuji). |
| F-03 | BUTUH ANDA | Integrasi Midtrans Snap + webhook bertanda tangan + konfirmasi status langsung ke Midtrans + kedaluwarsa otomatis sudah dibuat dan diuji dengan **Midtrans tiruan**. Belum diuji ke Midtrans sungguhan: butuh akun dan Server Key Anda; uji sandbox (sukses/gagal/kedaluwarsa), lalu satu transaksi nyata dan refund-nya. Refund dikirim manual lewat dasbor Midtrans dan dicatat di sistem. |
| F-04 | SELESAI | Simulasi status berdasarkan waktu dihapus. Status berubah lewat admin atau pembayaran. |
| F-05 | SELESAI | Stok dikurangi atomik di transaksi database. Tiga pembeli berebut stok terakhir: satu berhasil (diuji). |
| F-06 | BUTUH ANDA | Ongkir per kurir/provinsi/berat, pilihan kurir, resi wajib saat kirim, pembeli melihat resi. **Tarif yang terisi hanyalah placeholder**: isi tarif kurir sebenarnya di dasbor > Pengaturan dan centang "sudah ditinjau". Tautan lacak per kurir opsional. |
| F-07 | BUTUH ANDA | Email pesanan diterima, dibayar, dikemas, dikirim (dengan resi), selesai, dibatalkan, refund, retur. Butuh Resend (`RESEND_API_KEY`, `MAIL_FROM`). WhatsApp tidak dibuat (kriteria menyebut "email atau WhatsApp"). |
| F-08 | SEBAGIAN (Bersyarat) | Pendaftaran penjual tersimpan di server, ada deteksi data ganda, admin memverifikasi. Belum ada dasbor mandiri penjual (tambah produk oleh penjual): admin menambah produk. Boleh ditunda bila awalnya hanya Anda yang berjualan. |
| F-09 | SELESAI | `/admin`: ringkasan, pesanan (status, resi, batal, retur, refund), produk (CRUD, stok, foto), kupon, penjual, pengguna, pengaturan. Akses hanya akun di `ADMIN_EMAILS` (diuji). "Terdokumentasi": lihat RUNBOOK.md; panduan pengguna admin singkat belum ditulis terpisah. |
| F-10 | BUTUH ANDA | Pembatalan (stok, kupon, poin kembali), retur, dan antrean refund berfungsi (diuji). Kriteria "dana dikembalikan" butuh satu uji nyata di Midtrans. |
| F-11 | BUTUH ANDA | Alur utama (muat katalog, login, keranjang, checkout, bayar, pesanan, batal) diuji di Chromium lebar 390 px tanpa galat. Belum diuji di perangkat dan peramban lain (Safari iOS, Firefox, Android); tim perlu menetapkan daftar perangkat dan mengujinya. |

## D: Data & konten
| No | Status | Keterangan |
|---|---|---|
| D-01 | BUTUH ANDA | Unggah foto asli ada di dasbor (JPG/PNG/WEBP, cek isi berkas). **Foto asli harus Anda sediakan.** `cek-produksi` GAGAL selama ada produk tampil tanpa foto. |
| D-02 | BUTUH ANDA | Produk baru/bawaan tidak tampil sebelum ditandai "sudah ditinjau". Data bawaan (nama, deskripsi, harga, asal) berasal dari prototipe; **berat paket saya perkirakan**, dan stok di produksi mulai 0. Tinjau semuanya. |
| D-03 | BUTUH ANDA | Enam kupon dari prototipe dibuat **nonaktif**. Aktifkan hanya yang disetujui pemilik, hapus yang uji. |
| D-04 | SELESAI | Testimoni, angka "2.400+ produk / 830+ penjual / 34 provinsi", rating dan ulasan rekaan, jumlah terjual rekaan, notifikasi "baru saja membeli", hitung mundur promo palsu, dan form newsletter yang tidak menyimpan apa pun dihapus. Angka kini dari data nyata; ulasan hanya dari pembeli yang pesanannya selesai. Klaim "dana ditahan hingga diterima" dihapus karena tidak benar. |
| D-05 | SELESAI | Judul, deskripsi, Open Graph, robots.txt, sitemap.xml, favicon. |

## H: Hukum & kepatuhan
| No | Status | Keterangan |
|---|---|---|
| H-01 | BUTUH ANDA | Halaman Syarat & Ketentuan ada sebagai **draf** yang mengikuti cara kerja sistem. Wajib ditelaah Penasihat Hukum dan semua `{{ISI: ...}}` diisi. `cek-produksi` GAGAL selama kotak DRAF atau isian kosong masih ada. |
| H-02 | BUTUH ANDA | Kebijakan Privasi draf (data yang dikumpulkan, tujuan, penyimpanan, hak pengguna). Sama seperti H-01. |
| H-03 | BUTUH ANDA | Kebijakan Retur & Refund draf, selaras dengan alur di sistem (batal, retur dalam N hari, refund). Kriteria menyebut "selaras dengan O-02" (prosedur layanan pelanggan), dokumen yang tidak saya miliki; cocokkan. |
| H-04 | BUKAN KODE | Kajian izin usaha dan pendaftaran PSE: hukum/pemilik. |
| H-05 | SEBAGIAN | Dibuat: persetujuan saat daftar (dicatat), unduh data, hapus akun (pesanan dianonimkan), prosedur kebocoran di RUNBOOK. Perlu: keputusan masa simpan data dan batas waktu pemberitahuan oleh Penasihat Hukum. |
| H-06 | BUKAN KODE | Perjanjian penjual/penyedia pembayaran/pengiriman. |
| H-07 | BUKAN KODE | Konsultasi pajak transaksi. |

## I: Infrastruktur
| No | Status | Keterangan |
|---|---|---|
| I-01 | BUTUH ANDA | `DEPLOY.md` + `DB_FILE`/`UPLOAD_DIR` ke volume permanen. Tes "data tetap ada setelah restart dan dipasang ulang" harus dijalankan di hosting pilihan Anda. |
| I-02 | BUKAN KODE | Domain/DNS: panduan di DEPLOY.md. |
| I-03 | BUTUH ANDA | `cadangkan.js` dan `pulihkan.js` dibuat dan dicoba (cadangan hidup, pemulihan, penolakan saat server hidup). Perlu cron, salinan di luar server, dan **uji pemulihan di server uji** yang dicatat. Catatan: kriteria menyebut cadangan `data.db` "beserta -shm dan -wal". Dengan `VACUUM INTO` hasilnya satu file utuh, jadi kedua file itu tidak perlu dan menyalinnya manual saat server hidup berisiko rusak. Sebaiknya kriterianya direvisi. |
| I-04 | SELESAI/BUTUH ANDA | Server menolak start di Node < 22.13; `cek-produksi` memeriksanya. Pastikan versi di server produksi. |
| I-05 | BUTUH ANDA | `/api/health` memeriksa database, log galat JSON, peringatan webhook saat crash atau galat meningkat. Perlu pemantau uptime eksternal dan `ALERT_WEBHOOK_URL`. |
| I-06 | BUTUH ANDA | `uji-beban.js` dibuat. Hasil lokal di sandbox (15 pengunjung, 5 detik, hanya baca): p95 46 ms, 0% galat. **Itu bukan hasil produksi.** Jalankan di server Anda sesuai target pengunjung yang tim tetapkan, dan catat. Uji menulis (pesanan) belum otomatis. |
| I-07 | BUTUH ANDA | Mode pemeliharaan (dasbor atau `MAINTENANCE=1`) dan RUNBOOK.md selesai dan diuji. Kriteria "dijalankan oleh lebih dari satu orang" butuh latihan tim. |
