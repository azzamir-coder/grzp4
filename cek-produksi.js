"use strict";
/*
  Pemeriksa kesiapan produksi. HANYA MEMBACA, tidak mengubah apa pun.
  Pakai (di server produksi, dengan environment yang sama seperti server):
    node cek-produksi.js --simpan=akun1@x.com,akun2@x.com --url=https://domainmu.com
  Keluaran: LULUS / PERINGATAN / GAGAL per butir. Kode keluar 1 bila ada GAGAL.
  Butir yang butuh orang (hosting, hukum, uji perangkat) tidak bisa dicek mesin dan tercantum di akhir.
*/
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const arg = (n) => { const a = process.argv.find((x) => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const keep = arg("simpan").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const base = arg("url").replace(/\/+$/, "");
const dbFile = process.env.DB_FILE || path.join(__dirname, "data.db");
const pub = path.join(__dirname, "public");
const results = [];
const add = (level, id, text) => { results.push({ level, id, text }); };
const pass = (id, t) => add("LULUS", id, t), warn = (id, t) => add("PERINGATAN", id, t), bad = (id, t) => add("GAGAL", id, t);
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };

(async () => {
  /* ---- Lingkungan server ---- */
  const [maj, min] = process.versions.node.split(".").map(Number);
  (maj > 22 || (maj === 22 && min >= 13)) ? pass("I-04", "Node.js " + process.versions.node + " memenuhi syarat (>= 22.13).") : bad("I-04", "Node.js " + process.versions.node + " terlalu lama; butuh 22.13 atau lebih baru.");
  process.env.NODE_ENV === "production" ? pass("K-01", "NODE_ENV=production.") : bad("K-01", "NODE_ENV belum 'production' di lingkungan ini.");
  const sec = process.env.AUTH_SECRET || "";
  sec.length >= 32 ? pass("K-01", "AUTH_SECRET terisi (" + sec.length + " karakter).") : bad("K-01", "AUTH_SECRET kosong/pendek (minimal 32 karakter). Buat: openssl rand -hex 32");
  const devSecret = read(path.join(__dirname, ".secret")).trim();
  if (devSecret && sec && devSecret === sec) bad("K-03", "AUTH_SECRET sama dengan isi .secret dari komputer pengembangan. Buat yang baru.");
  else if (devSecret) warn("K-03", "File .secret ada di server. Pastikan bukan salinan dari komputer pengembangan dan hapus bila AUTH_SECRET sudah diatur.");
  else pass("K-03", "Tidak ada file .secret warisan.");
  process.env.TRUST_PROXY ? pass("K-05", "TRUST_PROXY=" + process.env.TRUST_PROXY + ".") : bad("K-05", "TRUST_PROXY belum diatur (batas login membaca IP proxy, bukan IP asli).");
  /^https:\/\//.test(process.env.APP_URL || "") ? pass("K-04", "APP_URL memakai https.") : bad("K-04", "APP_URL belum berupa alamat https publik.");
  process.env.RESEND_API_KEY && process.env.MAIL_FROM ? pass("K-06/F-07", "Email transaksi (RESEND_API_KEY, MAIL_FROM) terisi.") : bad("K-06/F-07", "RESEND_API_KEY / MAIL_FROM belum diatur: verifikasi akun dan notifikasi pesanan tidak terkirim.");
  if (process.env.MIDTRANS_SERVER_KEY) {
    process.env.MIDTRANS_ENV === "production" ? pass("F-03", "Midtrans mode production.") : bad("F-03", "MIDTRANS_SERVER_KEY ada tetapi MIDTRANS_ENV belum 'production' (masih sandbox).");
  } else bad("F-03", "MIDTRANS_SERVER_KEY belum diatur: hanya COD yang tersedia. Pembayaran nyata belum aktif.");
  process.env.ALERT_WEBHOOK_URL ? pass("I-05", "ALERT_WEBHOOK_URL terisi (peringatan galat dikirim ke tim).") : warn("I-05", "ALERT_WEBHOOK_URL belum diatur. Tanpa ini peringatan hanya lewat log; pasang juga pemantau uptime eksternal untuk /api/health.");
  const adminList = String(process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  adminList.length ? pass("F-09", "ADMIN_EMAILS: " + adminList.join(", ")) : bad("F-09", "ADMIN_EMAILS kosong: tidak ada yang bisa membuka dasbor admin.");

  /* ---- Berkas ---- */
  const gi = read(path.join(__dirname, ".gitignore"));
  [".secret", ".env", "data.db", "backup", "uploads"].every((x) => gi.includes(x)) ? pass("K-09", ".gitignore memuat .secret, .env, data.db, backup, uploads.") : bad("K-09", ".gitignore belum memuat semua: .secret, .env, data.db, backup, uploads.");
  const dbDir = path.dirname(path.resolve(dbFile));
  fs.existsSync(dbDir) ? pass("I-01", "Lokasi database: " + path.resolve(dbFile) + ". Pastikan folder ini ada di PENYIMPANAN PERMANEN (volume), bukan disk sementara.") : bad("I-01", "Folder database tidak ada: " + dbDir);

  /* ---- Database ---- */
  if (!fs.existsSync(dbFile)) { bad("K-08", "File database tidak ditemukan: " + dbFile); }
  else {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const all = (sql, ...a) => db.prepare(sql).all(...a), one = (sql, ...a) => db.prepare(sql).get(...a);
    try {
      const users = all("SELECT email FROM users").map((u) => u.email);
      if (!keep.length) warn("K-08", "Tidak ada --simpan. Akun terdaftar: " + (users.join(", ") || "(kosong)"));
      else {
        const extra = users.filter((u) => !keep.includes(u));
        extra.length ? bad("K-08", extra.length + " akun bukan milik tim (akun uji?): " + extra.slice(0, 8).join(", ") + (extra.length > 8 ? "…" : "") + ". Jalankan bersihkan-data-uji.js.") : pass("K-08", "Hanya akun resmi yang ada di database.");
      }
      const adm = adminList.filter((a) => !users.includes(a));
      if (adminList.length && adm.length) warn("F-09", "Admin belum terdaftar sebagai akun: " + adm.join(", ") + ". Daftar dan verifikasi dulu.");

      const prods = all("SELECT id, name, image, reviewed, active, weight_g, stock FROM products");
      const shown = prods.filter((p) => p.active && p.reviewed);
      shown.length ? pass("D-02", shown.length + " produk tampil di toko.") : bad("D-02", "Tidak ada produk yang tampil (aktif + sudah ditinjau).");
      const unrev = prods.filter((p) => p.active && !p.reviewed);
      unrev.length ? warn("D-02", unrev.length + " produk aktif belum ditinjau (tidak tampil): " + unrev.slice(0, 5).map((p) => p.name).join("; ") + (unrev.length > 5 ? "…" : "")) : pass("D-02", "Semua produk aktif sudah ditinjau.");
      const noImg = shown.filter((p) => !p.image);
      noImg.length ? bad("D-01", noImg.length + " produk tampil belum punya foto asli (masih ikon): " + noImg.slice(0, 5).map((p) => p.name).join("; ") + (noImg.length > 5 ? "…" : "")) : pass("D-01", "Semua produk tampil memakai foto asli.");
      const missingFiles = shown.filter((p) => p.image && !fs.existsSync(path.join(process.env.UPLOAD_DIR || path.join(__dirname, "uploads"), p.image)));
      missingFiles.length ? bad("D-01", missingFiles.length + " produk merujuk file foto yang tidak ada di folder uploads.") : null;
      const noWeight = shown.filter((p) => !(p.weight_g > 0));
      noWeight.length ? bad("D-02", noWeight.length + " produk tanpa berat.") : pass("D-02", "Semua produk punya berat.");
      const zero = shown.filter((p) => p.stock === 0);
      zero.length ? warn("D-02", zero.length + " produk tampil dengan stok 0. Isi stok sebelum peluncuran.") : pass("D-02", "Semua produk tampil punya stok.");

      const cps = all("SELECT code, label, used FROM coupons WHERE active = 1");
      cps.length ? warn("D-03", "Kupon aktif: " + cps.map((c) => c.code).join(", ") + ". Pastikan SEMUA disetujui pemilik; hapus kupon uji di dasbor.") : pass("D-03", "Tidak ada kupon aktif (aman). Aktifkan hanya yang disetujui pemilik.");
      const used = all("SELECT code FROM coupons WHERE used > 0");
      used.length ? warn("D-03", "Kupon sudah terpakai " + used.length + " kode: kemungkinan sisa uji. Periksa hitungan pakai.") : null;

      one("SELECT value v FROM settings WHERE key = 'tariff_reviewed'") && one("SELECT value v FROM settings WHERE key = 'tariff_reviewed'").v === "1" ? pass("F-06", "Tarif ongkir ditandai sudah ditinjau.") : bad("F-06", "Tarif ongkir masih nilai bawaan/belum ditinjau (dasbor > Pengaturan).");
      const m = one("SELECT value v FROM settings WHERE key = 'maintenance'");
      m && m.v === "1" ? warn("I-07", "Mode pemeliharaan sedang AKTIF.") : pass("I-07", "Mode pemeliharaan tidak aktif.");
      const testOrders = one("SELECT COUNT(*) n FROM orders").n;
      testOrders ? warn("F-xx", testOrders + " pesanan ada di database. Bila itu pesanan uji, bersihkan sebelum peluncuran (bersihkan-data-uji.js memakai --simpan untuk akun resmi).") : pass("F-xx", "Belum ada pesanan (bersih untuk peluncuran).");
      const fakeReviews = one("SELECT COUNT(*) n FROM reviews r WHERE NOT EXISTS (SELECT 1 FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.status = 'selesai' AND i.product_id = r.product_id AND (o.email = r.email))").n;
      fakeReviews ? warn("D-04", fakeReviews + " ulasan tidak terkait pembelian selesai (mungkin dari akun yang sudah dihapus atau data uji).") : pass("D-04", "Semua ulasan terkait pembelian nyata.");
    } catch (e) { bad("K-08", "Gagal membaca database: " + e.message); }
    db.close();
  }

  /* ---- Cadangan ---- */
  const bdir = path.join(__dirname, "backup");
  if (fs.existsSync(bdir)) {
    const dirs = fs.readdirSync(bdir).filter((d) => /^\d{4}-\d\d-\d\dT/.test(d)).sort();
    if (!dirs.length) bad("I-03", "Folder backup/ kosong. Jalankan: node cadangkan.js");
    else {
      const last = new Date(dirs[dirs.length - 1].replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, "T$1:$2:$3.$4Z"));
      const age = (Date.now() - last.getTime()) / 3600000;
      age <= 48 ? pass("I-03", "Cadangan terakhir " + age.toFixed(1) + " jam lalu (" + dirs.length + " tersimpan).") : bad("I-03", "Cadangan terakhir sudah " + Math.round(age) + " jam lalu. Periksa jadwal cron.");
    }
  } else bad("I-03", "Belum ada cadangan. Jalankan: node cadangkan.js dan jadwalkan lewat cron.");
  warn("I-03", "MANUAL: pemulihan harus diuji minimal sekali di server uji (node pulihkan.js --dari=... --ya) dan hasilnya dicatat.");

  /* ---- Isi halaman publik ---- */
  const html = read(path.join(pub, "index.html")), js = read(path.join(pub, "script.js"));
  const demo = ["Prototipe", "testi-grid", "generateReviews", "nm_stock_used", "BUYERS", "2.400+"].filter((k) => html.includes(k) || js.includes(k));
  demo.length ? bad("D-04", "Sisa konten contoh ditemukan di halaman: " + demo.join(", ")) : pass("D-04", "Tidak ada testimoni/angka/notifikasi contoh di halaman publik.");
  for (const f of ["index.html", "syarat-ketentuan.html", "kebijakan-privasi.html", "retur-refund.html"]) {
    const h = read(path.join(pub, f));
    if (!h) { bad("D-05", f + " tidak ada."); continue; }
    /<title>[^<]{8,}<\/title>/.test(h) && /<meta name="description" content="[^"]{30,}"/.test(h) ? pass("D-05", f + ": judul dan deskripsi terpasang.") : bad("D-05", f + ": judul/deskripsi kurang.");
  }
  const legal = { "H-01": "syarat-ketentuan.html", "H-02": "kebijakan-privasi.html", "H-03": "retur-refund.html" };
  for (const [id, f] of Object.entries(legal)) {
    const h = read(path.join(pub, f));
    if (!h) { bad(id, f + " tidak ada."); continue; }
    if (h.includes("DRAF-BELUM-DITELAAH")) bad(id, f + " masih berstatus DRAF (belum ditelaah Penasihat Hukum).");
    else if (/\{\{ISI/.test(h)) bad(id, f + " masih memuat isian {{ISI: ...}} yang belum diisi.");
    else pass(id, f + " siap terbit.");
  }

  /* ---- Pemeriksaan jaringan (opsional) ---- */
  if (base) {
    const get = (p, o) => fetch(base + p, Object.assign({ redirect: "manual", signal: AbortSignal.timeout(10000) }, o)).catch((e) => ({ status: 0, err: e.message, headers: new Headers() }));
    for (const f of ["/.secret", "/data.db", "/server.js", "/shop.js", "/.env", "/data.db-wal"]) {
      const r = await get(f);
      [403, 404].includes(r.status) ? pass("K-02", "GET " + f + " → " + r.status) : bad("K-02", "GET " + f + " → " + r.status + " (HARUS 403/404)");
    }
    if (/^https:/.test(base)) {
      const h = await get("/");
      h.status === 200 && /max-age=/.test(h.headers.get("strict-transport-security") || "") ? pass("K-04", "HTTPS aktif dengan HSTS.") : bad("K-04", "HTTPS/HSTS tidak sesuai (status " + h.status + ").");
      const r = await fetch(base.replace(/^https:/, "http:") + "/", { redirect: "manual", signal: AbortSignal.timeout(10000) }).catch(() => ({ status: 0, headers: new Headers() }));
      r.status === 301 && /^https:/.test(r.headers.get("location") || "") ? pass("K-04", "HTTP dialihkan ke HTTPS.") : bad("K-04", "HTTP tidak dialihkan ke HTTPS (status " + r.status + ").");
    } else bad("K-04", "--url bukan https.");
    const hl = await get("/api/health"); hl.status === 200 ? pass("I-05", "/api/health merespons 200 (daftarkan ke pemantau uptime).") : bad("I-05", "/api/health → " + hl.status);
    const cat = await get("/api/catalog");
    if (cat.status === 200) { try { const d = await cat.json(); d.simulatePay ? bad("F-03", "Server berjalan dalam mode SIMULASI pembayaran (tanpa gateway). Jangan dipakai di produksi.") : (d.payments || []).some((x) => x !== "COD") ? pass("F-03", "Metode pembayaran non-COD tersedia di katalog.") : bad("F-03", "Hanya COD yang tersedia."); (d.products || []).length ? pass("F-01", "Katalog dilayani server (" + d.products.length + " produk).") : bad("F-01", "Katalog kosong."); } catch (e) { bad("F-01", "Katalog tidak terbaca."); } }
    else bad("F-01", "/api/catalog → " + cat.status);
    const ad = await get("/api/admin/summary"); ad.status === 401 ? pass("F-09", "API admin menolak akses tanpa login.") : bad("F-09", "/api/admin/summary tanpa login → " + ad.status + " (harus 401).");
    const rb = await get("/robots.txt"); rb.status === 200 ? pass("D-05", "robots.txt & sitemap tersedia.") : warn("D-05", "robots.txt tidak ada.");
  } else warn("K-02", "Tanpa --url: pemeriksaan HTTPS/berkas rahasia/katalog dilewati. Tambahkan --url=https://domainmu.com");

  /* ---- Cetak ---- */
  const icon = { LULUS: "  LULUS      ", PERINGATAN: "  PERINGATAN ", GAGAL: "  GAGAL      " };
  console.log("\nPemeriksaan kesiapan produksi\n");
  for (const r of results) console.log(icon[r.level] + r.id.padEnd(12) + r.text);
  const c = (l) => results.filter((r) => r.level === l).length;
  console.log("\nRingkasan: " + c("LULUS") + " lulus, " + c("PERINGATAN") + " peringatan, " + c("GAGAL") + " gagal.");
  console.log("\nTidak bisa dicek mesin (butuh orang): I-02 domain/DNS terdokumentasi · I-06 hasil uji beban dicatat (uji-beban.js) · I-07 prosedur diuji oleh >1 orang ·");
  console.log("  F-03 uji bayar sukses/gagal/kedaluwarsa/refund di sandbox lalu produksi · F-10 satu pembatalan dan satu retur sampai dana dan stok kembali · F-11 uji ponsel/peramban ·");
  console.log("  H-01..H-07 telaah hukum, perizinan (PSE), perjanjian pihak ketiga, pajak · D-02 peninjauan isi produk oleh manusia.");
  process.exit(c("GAGAL") ? 1 : 0);
})();
