"use strict";
/*
  Modul toko Grizlie Nusantara (dipakai oleh server.js).
  Memindahkan ke SERVER: katalog, harga, stok, kupon, ongkir, pesanan, poin, ulasan, penjual,
  pembayaran (Midtrans Snap), pembatalan/retur/refund, dan API dasbor admin.
  Tanpa dependensi.
*/
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

module.exports = function createShop(ctx) {
  const { db, send, fail, readJson, authUser, tooMany, fmtWait, sendMail, PROD, APP_URL, cleanText, isObj, UPLOAD_DIR, logEvent } = ctx;

  /* ================= Konfigurasi ================= */
  const MT_KEY = process.env.MIDTRANS_SERVER_KEY || "";
  const MT_PROD = process.env.MIDTRANS_ENV === "production";
  const MT_SNAP = (process.env.MIDTRANS_SNAP_URL || (MT_PROD ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com")).replace(/\/+$/, "");
  const MT_API = (process.env.MIDTRANS_API_URL || (MT_PROD ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com")).replace(/\/+$/, "");
  const GATEWAY = !!MT_KEY;
  const SIMULATE_PAY = !PROD && !GATEWAY; // hanya pengembangan: tombol "simulasikan pembayaran"
  const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const MAX_QTY = 20;
  const ORDER_GAP_MS = Number(process.env.ORDER_GAP_MS) || 5000;
  const PAYMENTS = ["Transfer Bank", "E-Wallet", "COD"];
  const ACTIVE_STATUSES = ["diproses", "dikemas", "dikirim", "selesai"]; // dihitung sebagai "terjual"
  const nowIso = () => new Date().toISOString();

  const ZONES = {
    jawa: "Jawa", sumatera: "Sumatera", kalimantan: "Kalimantan", sulawesi: "Sulawesi", balinusra: "Bali & Nusa Tenggara", malukupapua: "Maluku & Papua"
  };
  const PROVINCES = [
    ["Aceh", "sumatera"], ["Sumatera Utara", "sumatera"], ["Sumatera Barat", "sumatera"], ["Riau", "sumatera"], ["Kepulauan Riau", "sumatera"],
    ["Jambi", "sumatera"], ["Sumatera Selatan", "sumatera"], ["Kepulauan Bangka Belitung", "sumatera"], ["Bengkulu", "sumatera"], ["Lampung", "sumatera"],
    ["Banten", "jawa"], ["DKI Jakarta", "jawa"], ["Jawa Barat", "jawa"], ["Jawa Tengah", "jawa"], ["DI Yogyakarta", "jawa"], ["Jawa Timur", "jawa"],
    ["Bali", "balinusra"], ["Nusa Tenggara Barat", "balinusra"], ["Nusa Tenggara Timur", "balinusra"],
    ["Kalimantan Barat", "kalimantan"], ["Kalimantan Tengah", "kalimantan"], ["Kalimantan Selatan", "kalimantan"], ["Kalimantan Timur", "kalimantan"], ["Kalimantan Utara", "kalimantan"],
    ["Sulawesi Utara", "sulawesi"], ["Gorontalo", "sulawesi"], ["Sulawesi Tengah", "sulawesi"], ["Sulawesi Barat", "sulawesi"], ["Sulawesi Selatan", "sulawesi"], ["Sulawesi Tenggara", "sulawesi"],
    ["Maluku", "malukupapua"], ["Maluku Utara", "malukupapua"], ["Papua", "malukupapua"], ["Papua Barat", "malukupapua"], ["Papua Barat Daya", "malukupapua"],
    ["Papua Selatan", "malukupapua"], ["Papua Tengah", "malukupapua"], ["Papua Pegunungan", "malukupapua"]
  ];
  const ZONE_OF = new Map(PROVINCES);

  /* ================= Skema ================= */
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, category TEXT NOT NULL, region TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0), old_price INTEGER,
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      weight_g INTEGER NOT NULL DEFAULT 0, badge TEXT, icon TEXT NOT NULL DEFAULT '📦',
      description TEXT NOT NULL DEFAULT '', image TEXT,
      active INTEGER NOT NULL DEFAULT 1, reviewed INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('pct','flat','ship')),
      value INTEGER NOT NULL DEFAULT 0, min_subtotal INTEGER NOT NULL DEFAULT 0, points_cost INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 0, expires TEXT, max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, email TEXT, created TEXT NOT NULL, updated TEXT NOT NULL,
      status TEXT NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL,
      recipient TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, province TEXT NOT NULL, postal TEXT NOT NULL,
      courier TEXT NOT NULL, weight_g INTEGER NOT NULL DEFAULT 0,
      subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, coupon TEXT, total INTEGER NOT NULL,
      pts_charged INTEGER NOT NULL DEFAULT 0, pts_earned INTEGER NOT NULL DEFAULT 0, pts_credited INTEGER NOT NULL DEFAULT 0,
      tracking_no TEXT, shipped_at TEXT, delivered_at TEXT, expires INTEGER, pay_url TEXT,
      stock_released INTEGER NOT NULL DEFAULT 0, refund_status TEXT NOT NULL DEFAULT 'tidak_perlu', refund_note TEXT,
      cancel_reason TEXT, return_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS orders_email ON orders(email);
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL, product_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL, weight_g INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, note TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, email TEXT, name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), text TEXT NOT NULL, created TEXT NOT NULL,
      UNIQUE (product_id, email)
    );
    CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_email TEXT NOT NULL, shop TEXT NOT NULL, category TEXT NOT NULL, city TEXT NOT NULL, wa TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_points (email TEXT PRIMARY KEY, bal INTEGER NOT NULL DEFAULT 0, life INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  /* ================= Data awal ================= */
  const DEFAULT_TARIFF = {
    // PLACEHOLDER: ganti dengan tarif kurir yang benar lewat dasbor admin > Pengaturan, lalu centang "tarif sudah ditinjau".
    couriers: [
      { id: "jne", name: "JNE Reguler", trackUrl: "", perKg: { jawa: 10000, sumatera: 18000, kalimantan: 24000, sulawesi: 26000, balinusra: 22000, malukupapua: 40000 } },
      { id: "jnt", name: "J&T Express", trackUrl: "", perKg: { jawa: 9000, sumatera: 17000, kalimantan: 23000, sulawesi: 25000, balinusra: 21000, malukupapua: 38000 } },
      { id: "sicepat", name: "SiCepat Reguler", trackUrl: "", perKg: { jawa: 9500, sumatera: 17500, kalimantan: 23500, sulawesi: 25500, balinusra: 21500, malukupapua: 39000 } }
    ]
  };
  const DEFAULT_SETTINGS = {
    free_ship_min: "300000", cod_max: "1000000", return_days: "7", pay_window_hours: "24",
    maintenance: "0", tariff: JSON.stringify(DEFAULT_TARIFF), tariff_reviewed: PROD ? "0" : "1"
  };
  const insSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  // [nama, kategori, daerah, harga, berat(g, perkiraan kemasan), ikon, deskripsi]
  const SEED = [
    ["Batik Tulis Mega Mendung", "batik", "Cirebon, Jawa Barat", 850000, 500, "🧵", "Batik tulis motif Mega Mendung khas Cirebon, dikerjakan tangan di atas kain katun primisima dengan pewarna alami."],
    ["Kain Tenun Ikat Sumba", "batik", "Sumba, NTT", 1250000, 700, "🧶", "Tenun ikat khas Sumba dengan motif kuda dan simbol leluhur, ditenun manual selama berminggu-minggu oleh perajin lokal."],
    ["Songket Silungkang", "batik", "Sumatra Barat", 1450000, 800, "🧵", "Songket benang emas Silungkang, cocok untuk acara adat maupun resepsi pernikahan."],
    ["Batik Cap Parang Solo", "batik", "Solo, Jawa Tengah", 400000, 400, "🧵", "Batik cap motif Parang klasik, nyaman dipakai harian dengan bahan katun adem."],
    ["Kopi Gayo Arabika 250g", "kopi", "Aceh", 118500, 350, "☕", "Kopi arabika Gayo dari dataran tinggi Aceh, sangrai medium dengan aroma floral dan rasa cokelat lembut."],
    ["Kopi Toraja Kalosi 200g", "kopi", "Toraja, Sulawesi Selatan", 110000, 300, "☕", "Kopi Toraja Kalosi dengan body tebal dan after-taste rempah, favorit pecinta kopi tubruk."],
    ["Kopi Luwak Bali Premium", "kopi", "Bali", 275000, 250, "☕", "Kopi luwak asli Bali, diproses higienis dari perkebunan mitra petani lokal."],
    ["Kopi Flores Bajawa", "kopi", "Flores, NTT", 88000, 300, "☕", "Kopi Bajawa dari lereng Gunung Inerie, karakter asam segar dengan sedikit rasa buah."],
    ["Ukiran Kayu Jepara Motif Bunga", "kerajinan", "Jepara, Jawa Tengah", 420000, 1500, "🪵", "Panel ukiran kayu jati motif bunga, dikerjakan pengrajin Jepara turun-temurun."],
    ["Anyaman Rotan Kalimantan", "kerajinan", "Kalimantan Barat", 175000, 500, "🧺", "Tas anyaman rotan alami, ringan dan kuat, cocok untuk kebutuhan harian maupun oleh-oleh."],
    ["Perak Ukir Kotagede", "kerajinan", "Yogyakarta", 690000, 100, "💍", "Perhiasan perak ukir khas Kotagede, dibuat dengan teknik filigree oleh perajin generasi ketiga."],
    ["Gerabah Kasongan", "kerajinan", "Bantul, Yogyakarta", 81500, 1200, "🏺", "Vas gerabah Kasongan finishing halus, cocok sebagai dekorasi rumah bergaya etnik."],
    ["Rendang Daging Kemasan", "kuliner", "Padang, Sumatra Barat", 85000, 300, "🍛", "Rendang daging sapi khas Padang, dimasak berjam-jam dengan santan dan rempah pilihan."],
    ["Keripik Tempe Malang", "kuliner", "Malang, Jawa Timur", 31500, 250, "🍘", "Keripik tempe renyah khas Malang, digoreng dengan bumbu tradisional."],
    ["Dodol Garut Original", "kuliner", "Garut, Jawa Barat", 30000, 300, "🍬", "Dodol Garut legit dengan resep asli, dibungkus kertas minyak tradisional."],
    ["Bakpia Pathok Yogyakarta", "kuliner", "Yogyakarta", 56500, 500, "🥮", "Bakpia Pathok isi kacang hijau, dipanggang setiap hari oleh mitra UMKM Jogja."],
    ["Jamu Instan Kunyit Asam", "rempah", "Yogyakarta", 40000, 150, "🌿", "Jamu instan kunyit asam, praktis diseduh kapan saja."],
    ["Rempah Bumbu Rendang Asli", "rempah", "Sumatra Barat", 43500, 200, "🌶️", "Racikan bumbu rendang siap pakai sesuai resep Minang, tinggal tumis dan masak."],
    ["Minyak Kayu Putih Buru", "rempah", "Pulau Buru, Maluku", 28000, 150, "🧴", "Minyak kayu putih hasil sulingan tradisional dari Pulau Buru, Maluku."],
    ["Kebaya Encim Modern", "fashion", "Jakarta", 550000, 400, "👘", "Kebaya encim dengan bordir tangan, dipotong mengikuti ukuran modern agar lebih nyaman dipakai."],
    ["Blangkon Jogja Klasik", "fashion", "Yogyakarta", 120000, 250, "🎩", "Blangkon motif batik klasik Yogyakarta, siap pakai untuk acara adat maupun formal."],
    ["Sarung Tenun Bugis", "fashion", "Sulawesi Selatan", 265000, 600, "👘", "Sarung tenun sutra Bugis dengan corak kotak warna cerah khas Sulawesi Selatan."]
  ];
  // Kupon contoh dari prototipe. Dibuat NONAKTIF: pemilik harus mengaktifkannya sendiri lewat dasbor (syarat D-03).
  const SEED_COUPONS = [
    ["NUSANTARA10", "pct", 10, 0, 0, "Diskon 10%"], ["HEMAT25", "flat", 25000, 0, 0, "Potongan Rp25.000"], ["GRATISONGKIR", "ship", 0, 0, 0, "Gratis ongkir"],
    ["KOPI20K", "flat", 20000, 150000, 0, "Potongan Rp20.000"], ["BATIK15", "pct", 15, 500000, 0, "Diskon 15%"], ["POIN100", "flat", 10000, 0, 100, "Tukar 100 poin"]
  ];
  if (db.prepare("SELECT COUNT(*) n FROM products").get().n === 0) {
    const ins = db.prepare("INSERT INTO products (name, category, region, price, stock, weight_g, icon, description, reviewed, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    db.exec("BEGIN");
    SEED.forEach((s, i) => ins.run(s[0], s[1], s[2], s[3], PROD ? 0 : 2 + (((i + 1) * 37) % 29), s[4], s[5], s[6], PROD ? 0 : 1, nowIso(), nowIso()));
    db.exec("COMMIT");
  }
  if (db.prepare("SELECT COUNT(*) n FROM coupons").get().n === 0) {
    const ins = db.prepare("INSERT INTO coupons (code, type, value, min_subtotal, points_cost, label, active) VALUES (?,?,?,?,?,?,0)");
    SEED_COUPONS.forEach((c) => ins.run(...c));
  }

  /* ================= Pengaturan ================= */
  const getSetting = (k) => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : DEFAULT_SETTINGS[k]; };
  const setSetting = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
  const numSetting = (k) => Number(getSetting(k)) || 0;
  function getTariff() {
    try { const t = JSON.parse(getSetting("tariff")); if (t && Array.isArray(t.couriers)) return t; } catch (e) { /* pakai bawaan */ }
    return DEFAULT_TARIFF;
  }
  const isMaintenance = () => process.env.MAINTENANCE === "1" || getSetting("maintenance") === "1";
  const isAdmin = (user) => !!user && ADMIN_EMAILS.includes(user.email);

  /* ================= Utilitas ================= */
  const rupiah = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function newOrderId() {
    const b = crypto.randomBytes(6);
    let s = ""; for (const x of b) s += ALPHA[x % ALPHA.length];
    const d = new Date(); const yy = String(d.getUTCFullYear()).slice(2), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), dd = String(d.getUTCDate()).padStart(2, "0");
    return "NM" + yy + mm + dd + s;
  }
  function tx(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const r = fn(); db.exec("COMMIT"); return r; }
    catch (e) { try { db.exec("ROLLBACK"); } catch (x) { /* abaikan */ } throw e; }
  }
  const httpErr = (status, message, extra) => Object.assign(new Error(message), { status, message, extra });
  const evt = (orderId, actor, event, note) => db.prepare("INSERT INTO order_events (order_id, at, actor, event, note) VALUES (?,?,?,?,?)").run(orderId, nowIso(), actor, event, note || null);
  const firstName = (n) => { const p = String(n || "").trim().split(/\s+/); return p.length > 1 ? p[0] + " " + p[1].charAt(0).toUpperCase() + "." : p[0] || "Pembeli"; };

  /* ================= Katalog ================= */
  function ratingMap() {
    const m = new Map();
    for (const r of db.prepare("SELECT product_id id, COUNT(*) n, AVG(rating) avg FROM reviews GROUP BY product_id").all()) m.set(r.id, { n: r.n, avg: r.avg });
    return m;
  }
  function soldMap() {
    const m = new Map();
    const marks = ACTIVE_STATUSES.map(() => "?").join(",");
    for (const r of db.prepare("SELECT i.product_id id, SUM(i.qty) n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status IN (" + marks + ") GROUP BY i.product_id").all(...ACTIVE_STATUSES)) m.set(r.id, r.n);
    return m;
  }
  function publicProduct(p, rm, sm) {
    const r = rm.get(p.id);
    return {
      id: p.id, name: p.name, category: p.category, region: p.region, price: p.price, oldPrice: p.old_price || null, stock: p.stock,
      weight: p.weight_g, badge: p.badge || null, icon: p.icon, desc: p.description, image: p.image ? "/media/" + p.image : null,
      rating: r ? Math.round(r.avg * 10) / 10 : 0, reviews: r ? r.n : 0, sold: sm.get(p.id) || 0
    };
  }
  function enabledPayments() { return GATEWAY || SIMULATE_PAY ? PAYMENTS : ["COD"]; }
  function catalog() {
    const rm = ratingMap(), sm = soldMap();
    const products = db.prepare("SELECT * FROM products WHERE active = 1 AND reviewed = 1 ORDER BY id").all().map((p) => publicProduct(p, rm, sm));
    const nowS = nowIso();
    const coupons = db.prepare("SELECT * FROM coupons WHERE active = 1 AND (expires IS NULL OR expires > ?)").all(nowS)
      .filter((c) => !c.max_uses || c.used < c.max_uses)
      .map((c) => ({ code: c.code, type: c.type, v: c.value, min: c.min_subtotal || 0, pts: c.points_cost || 0, label: c.label }));
    const tariff = getTariff();
    return {
      products, coupons,
      shipping: { freeMin: numSetting("free_ship_min"), couriers: tariff.couriers.map((c) => ({ id: c.id, name: c.name })), provinces: PROVINCES.map((p) => p[0]) },
      payments: enabledPayments(), codMax: numSetting("cod_max"), returnDays: numSetting("return_days"),
      simulatePay: SIMULATE_PAY, maintenance: isMaintenance()
    };
  }

  /* ================= Ongkir, kupon, poin ================= */
  function shippingFee(courierId, province, weightG, subtotal) {
    const zone = ZONE_OF.get(province);
    const courier = getTariff().couriers.find((c) => c.id === courierId);
    if (!zone) throw httpErr(400, "Pilih provinsi tujuan.");
    if (!courier) throw httpErr(400, "Pilih kurir yang tersedia.");
    const rate = Number(courier.perKg && courier.perKg[zone]);
    if (!(rate >= 0)) throw httpErr(400, "Tarif untuk tujuan ini belum diatur.");
    const kg = Math.max(1, Math.ceil(weightG / 1000));
    const full = kg * rate;
    const free = subtotal >= numSetting("free_ship_min");
    return { fee: free ? 0 : full, full, free, courier };
  }
  const pointsOf = (email) => db.prepare("SELECT bal, life FROM user_points WHERE email = ?").get(email) || { bal: 0, life: 0 };
  function addPoints(email, bal, life) {
    db.prepare("INSERT INTO user_points (email, bal, life) VALUES (?, MAX(0, ?), MAX(0, ?)) ON CONFLICT(email) DO UPDATE SET bal = MAX(0, bal + ?), life = MAX(0, life + ?)")
      .run(email, bal, life, bal, life);
  }
  function applyCoupon(code, subtotal, shipFee, email) {
    if (!code) return { discount: 0, shipFee, coupon: null, ptsCharged: 0 };
    const c = db.prepare("SELECT * FROM coupons WHERE code = ?").get(String(code).toUpperCase());
    if (!c || !c.active) throw httpErr(400, "Kode kupon tidak ditemukan atau tidak aktif.");
    if (c.expires && c.expires <= nowIso()) throw httpErr(400, "Kupon sudah kedaluwarsa.");
    if (c.max_uses && c.used >= c.max_uses) throw httpErr(400, "Kuota kupon sudah habis.");
    if (subtotal < c.min_subtotal) throw httpErr(400, "Belanja minimal " + rupiah(c.min_subtotal) + " untuk kupon ini.");
    if (c.points_cost && pointsOf(email).bal < c.points_cost) throw httpErr(400, "Poin tidak cukup (butuh " + c.points_cost + " poin).");
    let discount = 0, fee = shipFee;
    if (c.type === "pct") discount = Math.round((subtotal * c.value) / 100);
    if (c.type === "flat") discount = Math.min(c.value, subtotal);
    if (c.type === "ship") fee = 0;
    return { discount, shipFee: fee, coupon: c.code, ptsCharged: c.points_cost || 0 };
  }

  /* ================= Pesanan ================= */
  const orderItems = (id) => db.prepare("SELECT product_id id, name, price, qty FROM order_items WHERE order_id = ?").all(id);
  function canCancel(o) { return o.status === "menunggu_pembayaran" || o.status === "diproses"; }
  function canReturn(o) {
    if (o.status !== "selesai" || !o.delivered_at) return false;
    return Date.now() - new Date(o.delivered_at).getTime() <= numSetting("return_days") * 86400000;
  }
  function publicOrder(o) {
    const courier = getTariff().couriers.find((c) => c.id === o.courier);
    return {
      id: o.id, date: o.created, status: o.status, payment: o.payment_method, paymentStatus: o.payment_status,
      items: orderItems(o.id), recipient: o.recipient, phone: o.phone, address: o.address, city: o.city, province: o.province, postal: o.postal,
      courier: courier ? courier.name : o.courier, trackUrl: courier && courier.trackUrl ? courier.trackUrl : "", trackingNo: o.tracking_no || "",
      subtotal: o.subtotal, shipping: o.shipping, discount: o.discount, coupon: o.coupon, total: o.total,
      payUrl: o.status === "menunggu_pembayaran" && o.pay_url ? o.pay_url : "", expires: o.expires || null,
      refundStatus: o.refund_status, canCancel: canCancel(o), canReturn: canReturn(o), pointsEarned: o.pts_earned
    };
  }
  const ordersFor = (email) => db.prepare("SELECT * FROM orders WHERE email = ? ORDER BY created DESC LIMIT 200").all(email).map(publicOrder);

  /* Email notifikasi (F-07) */
  function notify(o, subject, body) {
    if (!o || !o.email) return;
    sendMail(o.email, subject + " — Grizlie Nusantara",
      "Halo " + o.recipient + ",\n\n" + body + "\n\nNomor pesanan: " + o.id + "\nLihat status: " + APP_URL + "/#pesanan\n\nTerima kasih telah berbelanja di Grizlie Nusantara.")
      .catch((e) => logEvent("error", "notify", e.message));
  }

  /* Melepas stok, poin, dan kupon. Idempotent lewat penanda stock_released. Dipanggil dalam transaksi. */
  function releaseOrder(o, status, actor, reason) {
    if (o.stock_released) return;
    for (const it of orderItems(o.id)) db.prepare("UPDATE products SET stock = stock + ?, updated = ? WHERE id = ?").run(it.qty, nowIso(), it.id);
    if (o.coupon) db.prepare("UPDATE coupons SET used = MAX(0, used - 1) WHERE code = ?").run(o.coupon);
    if (o.email && o.pts_charged) addPoints(o.email, o.pts_charged, 0);
    if (o.email && o.pts_credited) addPoints(o.email, -o.pts_earned, -o.pts_earned);
    const needRefund = o.payment_status === "paid" && o.payment_method !== "COD";
    db.prepare("UPDATE orders SET status = ?, stock_released = 1, cancel_reason = ?, refund_status = ?, updated = ?, pts_credited = 0 WHERE id = ?")
      .run(status, reason || null, needRefund ? "perlu_refund" : "tidak_perlu", nowIso(), o.id);
    evt(o.id, actor, status === "dibatalkan" ? "dibatalkan" : status, reason);
  }

  async function midtrans(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { Authorization: "Basic " + Buffer.from(MT_KEY + ":").toString("base64"), "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
    let data = {}; try { data = await r.json(); } catch (e) { /* kosong */ }
    return { ok: r.ok, status: r.status, data };
  }
  async function createPayment(o, user) {
    const items = orderItems(o.id).map((i) => ({ id: "P" + i.id, price: i.price, quantity: i.qty, name: String(i.name).slice(0, 50) }));
    if (o.shipping > 0) items.push({ id: "ONGKIR", price: o.shipping, quantity: 1, name: "Ongkos kirim" });
    if (o.discount > 0) items.push({ id: "DISKON", price: -o.discount, quantity: 1, name: "Diskon" });
    const groups = { "Transfer Bank": ["bca_va", "bni_va", "bri_va", "permata_va", "other_va"], "E-Wallet": ["gopay", "shopeepay"] };
    const r = await midtrans("POST", MT_SNAP + "/snap/v1/transactions", {
      transaction_details: { order_id: o.id, gross_amount: o.total },
      item_details: items,
      customer_details: { first_name: o.recipient.slice(0, 40), email: user.email, phone: o.phone },
      enabled_payments: groups[o.payment_method],
      expiry: { unit: "hours", duration: numSetting("pay_window_hours") || 24 },
      callbacks: { finish: APP_URL + "/#pesanan" }
    });
    if (!r.ok || !r.data.redirect_url) throw new Error("Gateway menolak transaksi (" + r.status + ")");
    db.prepare("UPDATE orders SET pay_url = ?, updated = ? WHERE id = ?").run(r.data.redirect_url, nowIso(), o.id);
    return r.data.redirect_url;
  }

  async function createOrder(req, res, user, ip) {
    const b = await readJson(req);
    const recipient = cleanText(b.recipient, 60), address = cleanText(b.address, 200), city = cleanText(b.city, 50);
    const phone = String(b.phone || "").replace(/[\s-]/g, "").slice(0, 20), postal = String(b.postal || "").trim();
    const province = String(b.province || ""), courierId = String(b.courier || ""), method = String(b.payment || "");
    if (!recipient || !address || !city) return fail(res, 400, "Lengkapi semua data pengiriman terlebih dahulu.");
    if (!/^(\+62|62|0)8[0-9]{7,12}$/.test(phone)) return fail(res, 400, "Nomor telepon tidak valid. Contoh: 081234567890.");
    if (!/^[0-9]{5}$/.test(postal)) return fail(res, 400, "Kode pos harus 5 digit angka.");
    if (!enabledPayments().includes(method)) return fail(res, 400, "Metode pembayaran tidak tersedia.");
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return fail(res, 400, "Keranjang kosong.");

    // Pembatas laju dicek setelah validasi dasar, supaya salah ketik tidak memakai jatah
    if (tooMany("order", user.email, 1, ORDER_GAP_MS)) return fail(res, 429, "Mohon tunggu beberapa detik sebelum membuat pesanan lagi.");
    if (tooMany("order-hour", user.email, 30, 3600 * 1000)) return fail(res, 429, "Terlalu banyak pesanan dalam satu jam. Coba lagi nanti.");
    // Gabungkan baris yang sama; hanya id & qty dari klien yang dipakai. Harga, diskon, total SELALU dihitung server.
    const want = new Map();
    for (const it of b.items) {
      const id = Number(it && it.id), qty = Number(it && it.qty);
      if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return fail(res, 400, "Jumlah produk tidak valid (1 sampai " + MAX_QTY + ").");
      want.set(id, (want.get(id) || 0) + qty);
    }
    let order;
    try {
      order = tx(() => {
        const lines = [];
        for (const [id, qty] of want) {
          if (qty > MAX_QTY) throw httpErr(400, "Maksimal " + MAX_QTY + " buah per produk.");
          const p = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1 AND reviewed = 1").get(id);
          if (!p) throw httpErr(400, "Ada produk yang sudah tidak tersedia. Muat ulang halaman.");
          lines.push({ p, qty });
        }
        // Pengurangan stok atomik: gagal bila stok tidak cukup (F-05)
        for (const { p, qty } of lines) {
          const r = db.prepare("UPDATE products SET stock = stock - ?, updated = ? WHERE id = ? AND stock >= ?").run(qty, nowIso(), p.id, qty);
          if (!r.changes) throw httpErr(409, p.stock > 0 ? "Stok " + p.name + " tinggal " + p.stock + ". Kurangi jumlahnya." : p.name + " sudah habis.");
        }
        const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
        const weight = lines.reduce((s, l) => s + l.p.weight_g * l.qty, 0);
        const ship = shippingFee(courierId, province, weight, subtotal);
        const cp = applyCoupon(b.coupon, subtotal, ship.fee, user.email);
        const total = subtotal - cp.discount + cp.shipFee;
        if (total <= 0) throw httpErr(400, "Total pesanan tidak valid.");
        if (method === "COD" && total > numSetting("cod_max")) throw httpErr(400, "COD hanya untuk pesanan sampai " + rupiah(numSetting("cod_max")) + ". Pilih metode lain.");
        if (cp.coupon) {
          const r = db.prepare("UPDATE coupons SET used = used + 1 WHERE code = ? AND (max_uses IS NULL OR used < max_uses)").run(cp.coupon);
          if (!r.changes) throw httpErr(400, "Kuota kupon sudah habis.");
        }
        if (cp.ptsCharged) addPoints(user.email, -cp.ptsCharged, 0);
        const id = newOrderId(), cod = method === "COD";
        const expires = cod ? null : Date.now() + (numSetting("pay_window_hours") || 24) * 3600 * 1000;
        db.prepare(`INSERT INTO orders (id, email, created, updated, status, payment_method, payment_status, recipient, phone, address, city, province, postal, courier,
            weight_g, subtotal, shipping, discount, coupon, total, pts_charged, pts_earned, expires) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, user.email, nowIso(), nowIso(), cod ? "diproses" : "menunggu_pembayaran", method, cod ? "cod" : "unpaid", recipient, phone, address, city, province, postal, courierId,
            weight, subtotal, cp.shipFee, cp.discount, cp.coupon, total, cp.ptsCharged, Math.floor(total / 10000), expires);
        for (const { p, qty } of lines) db.prepare("INSERT INTO order_items (order_id, product_id, name, price, qty, weight_g) VALUES (?,?,?,?,?,?)").run(id, p.id, p.name, p.price, qty, p.weight_g);
        evt(id, user.email, "dibuat", method);
        return db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
      });
    } catch (e) {
      if (e.status) return fail(res, e.status, e.message);
      throw e;
    }
    let payUrl = "";
    if (order.payment_method !== "COD" && GATEWAY) {
      try { payUrl = await createPayment(order, user); }
      catch (e) {
        logEvent("error", "payment", order.id + ": " + e.message);
        // Gagal membuat tagihan: batalkan pesanan supaya stok tidak tertahan
        tx(() => releaseOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id), "dibatalkan", "sistem", "Gagal membuat tagihan pembayaran"));
        return fail(res, 502, "Pembayaran belum bisa diproses saat ini. Pesanan dibatalkan, silakan coba lagi.");
      }
    }
    const fresh = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
    notify(fresh, "Pesanan diterima", order.payment_method === "COD"
      ? "Pesanan Anda kami terima dan sedang diproses. Total " + rupiah(fresh.total) + " dibayar di tempat saat barang tiba."
      : "Pesanan Anda kami terima. Total " + rupiah(fresh.total) + ". Selesaikan pembayaran dalam " + (numSetting("pay_window_hours") || 24) + " jam atau pesanan dibatalkan otomatis." + (payUrl ? "\nBayar di: " + payUrl : ""));
    return send(res, 201, { order: publicOrder(fresh), points: pointsOf(user.email) });
  }

  function markPaid(id, actor, note) {
    const done = tx(() => {
      const r = db.prepare("UPDATE orders SET payment_status = 'paid', status = 'diproses', expires = NULL, updated = ? WHERE id = ? AND status = 'menunggu_pembayaran'").run(nowIso(), id);
      if (r.changes) evt(id, actor, "dibayar", note);
      return r.changes > 0;
    });
    if (done) { const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(id); notify(o, "Pembayaran diterima", "Pembayaran Anda sudah kami terima dan pesanan sedang diproses."); }
    return done;
  }
  function cancelAwaiting(id, actor, reason) {
    return tx(() => {
      const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
      if (!o || o.status !== "menunggu_pembayaran") return false;
      releaseOrder(o, "dibatalkan", actor, reason);
      return true;
    });
  }
  // Pesanan yang tidak dibayar sampai batas waktu dibatalkan otomatis dan stoknya dikembalikan
  function expireUnpaid() {
    const rows = db.prepare("SELECT id FROM orders WHERE status = 'menunggu_pembayaran' AND expires IS NOT NULL AND expires < ?").all(Date.now());
    for (const r of rows) {
      if (cancelAwaiting(r.id, "sistem", "Batas waktu pembayaran habis")) {
        const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(r.id);
        notify(o, "Pesanan dibatalkan", "Pesanan dibatalkan karena pembayaran tidak diterima dalam batas waktu.");
      }
    }
    return rows.length;
  }
  setInterval(() => { try { expireUnpaid(); } catch (e) { logEvent("error", "expire", e.message); } }, Number(process.env.EXPIRE_CHECK_MS) || 5 * 60 * 1000).unref();

  /* Webhook Midtrans: tanda tangan diperiksa, lalu status dikonfirmasi langsung ke Midtrans (tidak percaya isi webhook) */
  async function midtransWebhook(req, res) {
    if (!GATEWAY) return fail(res, 404, "Tidak ditemukan.");
    const b = await readJson(req);
    const orderId = String(b.order_id || ""), code = String(b.status_code || ""), gross = String(b.gross_amount || ""), sig = String(b.signature_key || "");
    const expect = crypto.createHash("sha512").update(orderId + code + gross + MT_KEY).digest("hex");
    const a = Buffer.from(sig), e = Buffer.from(expect);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return fail(res, 403, "Tanda tangan tidak valid.");
    const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!o) return send(res, 200, { ok: true });
    const st = await midtrans("GET", MT_API + "/v2/" + encodeURIComponent(orderId) + "/status");
    if (!st.ok) { logEvent("error", "webhook", "gagal cek status " + orderId); return fail(res, 502, "Gagal memverifikasi status."); }
    const d = st.data, ts = d.transaction_status, fraud = d.fraud_status;
    if (Number(d.gross_amount) !== o.total) { logEvent("error", "webhook", "nominal tidak cocok " + orderId); return send(res, 200, { ok: true }); }
    if (ts === "settlement" || (ts === "capture" && (!fraud || fraud === "accept"))) markPaid(orderId, "midtrans", ts);
    else if (["deny", "cancel", "expire", "failure"].includes(ts)) {
      if (cancelAwaiting(orderId, "midtrans", "Pembayaran " + ts)) notify(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId), "Pembayaran gagal", "Pembayaran tidak berhasil (" + ts + "). Pesanan dibatalkan dan stok dikembalikan.");
    } else if (/refund|chargeback/.test(ts || "")) evt(orderId, "midtrans", "catatan_gateway", ts);
    return send(res, 200, { ok: true });
  }

  /* ================= Pesanan: tindakan pembeli ================= */
  function ownOrder(user, id) {
    const o = db.prepare("SELECT * FROM orders WHERE id = ? AND email = ?").get(String(id), user.email);
    if (!o) throw httpErr(404, "Pesanan tidak ditemukan.");
    return o;
  }
  async function buyerOrderAction(req, res, user, id, action) {
    const o = ownOrder(user, id);
    if (action === "cancel") {
      const b = await readJson(req);
      const ok = tx(() => {
        const cur = db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id);
        if (!canCancel(cur)) return false;
        releaseOrder(cur, "dibatalkan", user.email, cleanText(b.reason, 200) || "Dibatalkan pembeli");
        return true;
      });
      if (!ok) return fail(res, 409, "Pesanan ini sudah tidak bisa dibatalkan.");
      const fresh = db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id);
      if (GATEWAY && o.payment_method !== "COD" && o.payment_status === "unpaid") midtrans("POST", MT_API + "/v2/" + encodeURIComponent(o.id) + "/cancel").catch(() => { });
      notify(fresh, "Pesanan dibatalkan", fresh.refund_status === "perlu_refund" ? "Pesanan dibatalkan. Dana Anda akan dikembalikan oleh tim kami; kami akan mengabari setelah refund diproses." : "Pesanan Anda telah dibatalkan.");
      return send(res, 200, { order: publicOrder(fresh), points: pointsOf(user.email) });
    }
    if (action === "return") {
      const b = await readJson(req);
      const reason = cleanText(b.reason, 300);
      if (reason.length < 5) return fail(res, 400, "Tulis alasan retur (minimal 5 karakter).");
      const ok = tx(() => {
        const cur = db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id);
        if (!canReturn(cur)) return false;
        db.prepare("UPDATE orders SET status = 'retur_diajukan', return_reason = ?, updated = ? WHERE id = ?").run(reason, nowIso(), o.id);
        evt(o.id, user.email, "retur_diajukan", reason);
        return true;
      });
      if (!ok) return fail(res, 409, "Retur hanya bisa diajukan untuk pesanan selesai dalam " + numSetting("return_days") + " hari setelah diterima.");
      return send(res, 200, { order: publicOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id)) });
    }
    if (action === "pay") {
      if (o.status !== "menunggu_pembayaran") return fail(res, 409, "Pesanan ini tidak menunggu pembayaran.");
      if (!o.pay_url) return fail(res, 409, "Tautan pembayaran belum tersedia.");
      return send(res, 200, { payUrl: o.pay_url });
    }
    if (action === "simulate-pay") {
      if (!SIMULATE_PAY) return fail(res, 404, "Tidak ditemukan.");
      markPaid(o.id, user.email, "simulasi pengembangan");
      return send(res, 200, { order: publicOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id)) });
    }
    return fail(res, 404, "Tindakan tidak dikenal.");
  }

  /* Ulasan: hanya pembeli yang pesanannya selesai */
  function reviewsOf(productId) {
    return db.prepare("SELECT name, rating, text, created FROM reviews WHERE product_id = ? ORDER BY created DESC LIMIT 50").all(productId).map((r) => ({ name: r.name, rating: r.rating, text: r.text, date: r.created, verified: true }));
  }

  /* ================= Pesan email berdasarkan status ================= */
  const STATUS_MAIL = {
    dikemas: ["Pesanan sedang dikemas", "Pesanan Anda sedang dikemas oleh penjual."],
    selesai: ["Pesanan selesai", "Pesanan Anda telah diterima. Jika ada masalah, ajukan retur dari halaman pesanan sebelum batas waktu retur."]
  };

  /* ================= Admin ================= */
  function requireAdmin(req, res) {
    const user = authUser(req);
    if (!user) { fail(res, 401, "Sesi tidak valid. Silakan masuk lagi."); return null; }
    if (!isAdmin(user)) { fail(res, 403, "Akun ini bukan admin."); return null; }
    return user;
  }
  const adminOrderRow = (o) => Object.assign(publicOrder(o), { email: o.email || "(dihapus)", events: db.prepare("SELECT at, actor, event, note FROM order_events WHERE order_id = ? ORDER BY id").all(o.id), returnReason: o.return_reason || "", refundNote: o.refund_note || "", cancelReason: o.cancel_reason || "" });

  function validProduct(b, partial) {
    const out = {};
    const num = (k, min, max) => { const v = Number(b[k]); if (!Number.isInteger(v) || v < min || v > max) throw httpErr(400, "Isian '" + k + "' tidak valid."); return v; };
    const CATS = ["batik", "kopi", "kerajinan", "kuliner", "rempah", "fashion"];
    if (!partial || "name" in b) { out.name = cleanText(b.name, 100); if (out.name.length < 3) throw httpErr(400, "Nama produk minimal 3 karakter."); }
    if (!partial || "category" in b) { out.category = String(b.category); if (!CATS.includes(out.category)) throw httpErr(400, "Kategori tidak valid."); }
    if (!partial || "region" in b) { out.region = cleanText(b.region, 80); if (out.region.length < 2) throw httpErr(400, "Asal produk wajib diisi."); }
    if (!partial || "description" in b) { out.description = cleanText(b.description, 600); if (out.description.length < 10) throw httpErr(400, "Deskripsi minimal 10 karakter."); }
    if (!partial || "price" in b) out.price = num("price", 100, 1e9);
    if (!partial || "stock" in b) out.stock = num("stock", 0, 100000);
    if (!partial || "weight" in b) { out.weight_g = num("weight", 1, 100000); }
    if ("oldPrice" in b) { out.old_price = b.oldPrice === null || b.oldPrice === "" ? null : num("oldPrice", 100, 1e9); }
    if ("badge" in b) out.badge = cleanText(b.badge, 20) || null;
    if ("icon" in b) out.icon = String(b.icon || "📦").slice(0, 8);
    if ("active" in b) out.active = b.active ? 1 : 0;
    if ("reviewed" in b) out.reviewed = b.reviewed ? 1 : 0;
    if (out.old_price != null && out.price != null && out.old_price <= out.price) throw httpErr(400, "Harga coret harus lebih tinggi dari harga jual.");
    return out;
  }

  function saveImage(productId, b) {
    const raw = String(b.data || "");
    if (raw.length > 5.5e6) throw httpErr(413, "Foto terlalu besar (maksimal 4 MB).");
    const buf = Buffer.from(raw.replace(/^data:[^,]+,/, ""), "base64");
    if (buf.length < 200 || buf.length > 4 * 1024 * 1024) throw httpErr(400, "Ukuran foto harus 200 B sampai 4 MB.");
    let ext = null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = "jpg";
    else if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = "png";
    else if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") ext = "webp";
    if (!ext) throw httpErr(400, "Format foto harus JPG, PNG, atau WEBP.");
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = "p" + productId + "-" + crypto.randomBytes(5).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf, { mode: 0o644 });
    const old = db.prepare("SELECT image FROM products WHERE id = ?").get(productId);
    db.prepare("UPDATE products SET image = ?, updated = ? WHERE id = ?").run(name, nowIso(), productId);
    if (old && old.image) fs.rm(path.join(UPLOAD_DIR, path.basename(old.image)), () => { });
    return name;
  }

  async function adminAction(req, res, admin, id) {
    const b = await readJson(req);
    const act = String(b.action || "");
    const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    if (!o) return fail(res, 404, "Pesanan tidak ditemukan.");
    const actor = "admin:" + admin.email;
    const note = cleanText(b.note, 300);
    let mail = null;
    const result = tx(() => {
      const cur = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
      const set = (status, extra) => {
        const cols = Object.keys(extra || {});
        db.prepare("UPDATE orders SET status = ?, updated = ?" + cols.map((c) => ", " + c + " = ?").join("") + " WHERE id = ?").run(status, nowIso(), ...cols.map((c) => extra[c]), id);
        evt(id, actor, status, note);
      };
      switch (act) {
        case "mark_paid":
          if (cur.status !== "menunggu_pembayaran") throw httpErr(409, "Pesanan tidak sedang menunggu pembayaran.");
          if (!note) throw httpErr(400, "Isi catatan bukti pembayaran.");
          db.prepare("UPDATE orders SET payment_status = 'paid', expires = NULL WHERE id = ?").run(id);
          set("diproses");
          mail = ["Pembayaran diterima", "Pembayaran Anda sudah kami terima dan pesanan sedang diproses."];
          break;
        case "pack":
          if (cur.status !== "diproses") throw httpErr(409, "Hanya pesanan berstatus 'diproses' yang bisa dikemas.");
          set("dikemas"); mail = STATUS_MAIL.dikemas; break;
        case "ship": {
          if (!["diproses", "dikemas"].includes(cur.status)) throw httpErr(409, "Pesanan belum siap dikirim.");
          const resi = cleanText(b.trackingNo, 40);
          if (resi.length < 5) throw httpErr(400, "Nomor resi wajib diisi (minimal 5 karakter).");
          set("dikirim", { tracking_no: resi, shipped_at: nowIso() });
          mail = ["Pesanan dikirim", "Pesanan Anda sudah dikirim. Nomor resi: " + resi + "."]; break;
        }
        case "deliver":
          if (cur.status !== "dikirim") throw httpErr(409, "Hanya pesanan 'dikirim' yang bisa diselesaikan.");
          set("selesai", { delivered_at: nowIso() });
          if (cur.email && !cur.pts_credited) {
            addPoints(cur.email, cur.pts_earned, cur.pts_earned);
            db.prepare("UPDATE orders SET pts_credited = 1 WHERE id = ?").run(id);
          }
          if (cur.payment_method === "COD") db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(id);
          mail = STATUS_MAIL.selesai; break;
        case "cancel":
          if (!["menunggu_pembayaran", "diproses", "dikemas"].includes(cur.status)) throw httpErr(409, "Pesanan ini tidak bisa dibatalkan dari sini.");
          if (!note) throw httpErr(400, "Isi alasan pembatalan.");
          releaseOrder(cur, "dibatalkan", actor, note);
          mail = ["Pesanan dibatalkan", "Pesanan Anda dibatalkan oleh penjual. " + note + (cur.payment_status === "paid" && cur.payment_method !== "COD" ? " Dana akan dikembalikan." : "")];
          break;
        case "return_decision":
          if (cur.status !== "retur_diajukan") throw httpErr(409, "Tidak ada pengajuan retur.");
          if (b.approve) {
            db.prepare("UPDATE orders SET refund_status = ? WHERE id = ?").run(cur.payment_status === "paid" ? "perlu_refund" : "tidak_perlu", id);
            set("retur_disetujui");
            mail = ["Retur disetujui", "Pengajuan retur Anda disetujui. Kirim barang kembali sesuai arahan tim kami. Dana dikembalikan setelah barang kami terima."];
          } else {
            if (!note) throw httpErr(400, "Isi alasan penolakan.");
            set("selesai");
            mail = ["Retur ditolak", "Pengajuan retur Anda tidak dapat disetujui. " + note];
          }
          break;
        case "refund_done": {
          const needs = cur.refund_status === "perlu_refund" || cur.status === "retur_disetujui";
          if (!needs) throw httpErr(409, "Pesanan ini tidak menunggu refund.");
          if (!note) throw httpErr(400, "Isi referensi refund (mis. nomor transaksi refund di dasbor Midtrans).");
          if (cur.status === "retur_disetujui") {
            // Barang kembali: stok dan poin dikembalikan
            const restock = b.restock !== false;
            if (restock) for (const it of orderItems(id)) db.prepare("UPDATE products SET stock = stock + ?, updated = ? WHERE id = ?").run(it.qty, nowIso(), it.id);
            if (cur.email && cur.pts_credited) { addPoints(cur.email, -cur.pts_earned, -cur.pts_earned); db.prepare("UPDATE orders SET pts_credited = 0 WHERE id = ?").run(id); }
            db.prepare("UPDATE orders SET stock_released = 1 WHERE id = ?").run(id);
            set("dikembalikan", { refund_status: "selesai", refund_note: note });
          } else {
            db.prepare("UPDATE orders SET refund_status = 'selesai', refund_note = ?, updated = ? WHERE id = ?").run(note, nowIso(), id);
            evt(id, actor, "refund_selesai", note);
          }
          mail = ["Refund diproses", "Dana pesanan Anda sudah dikembalikan. Referensi: " + note + "."];
          break;
        }
        default: throw httpErr(400, "Tindakan tidak dikenal.");
      }
      return db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    });
    if (mail) notify(result, mail[0], mail[1]);
    return send(res, 200, { order: adminOrderRow(result) });
  }

  async function handleAdmin(req, res, pathname, method) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    let m;
    if (pathname === "/api/admin/summary" && method === "GET") {
      const one = (sql, ...a) => db.prepare(sql).get(...a).n;
      const marks = ACTIVE_STATUSES.map(() => "?").join(",");
      return send(res, 200, {
        gateway: GATEWAY, simulatePay: SIMULATE_PAY, maintenance: isMaintenance(), tariffReviewed: getSetting("tariff_reviewed") === "1",
        orders: { menunggu_pembayaran: one("SELECT COUNT(*) n FROM orders WHERE status = 'menunggu_pembayaran'"), perlu_diproses: one("SELECT COUNT(*) n FROM orders WHERE status IN ('diproses','dikemas')"), dikirim: one("SELECT COUNT(*) n FROM orders WHERE status = 'dikirim'"), retur: one("SELECT COUNT(*) n FROM orders WHERE status = 'retur_diajukan'"), perlu_refund: one("SELECT COUNT(*) n FROM orders WHERE refund_status = 'perlu_refund'") },
        revenue: one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status IN (" + marks + ")", ...ACTIVE_STATUSES),
        users: one("SELECT COUNT(*) n FROM users"), sellersPending: one("SELECT COUNT(*) n FROM sellers WHERE status = 'pending'"),
        products: { total: one("SELECT COUNT(*) n FROM products"), tampil: one("SELECT COUNT(*) n FROM products WHERE active = 1 AND reviewed = 1"), belumDitinjau: one("SELECT COUNT(*) n FROM products WHERE reviewed = 0"), tanpaFoto: one("SELECT COUNT(*) n FROM products WHERE active = 1 AND image IS NULL"), stokTipis: one("SELECT COUNT(*) n FROM products WHERE active = 1 AND stock <= 3") },
        couponsActive: one("SELECT COUNT(*) n FROM coupons WHERE active = 1")
      });
    }
    if (pathname === "/api/admin/products" && method === "GET") return send(res, 200, { products: db.prepare("SELECT * FROM products ORDER BY id").all().map((p) => Object.assign(publicProduct(p, new Map(), new Map()), { active: !!p.active, reviewed: !!p.reviewed, rating: undefined, reviews: undefined, sold: undefined })), provinces: [] });
    if (pathname === "/api/admin/products" && method === "POST") {
      try {
        const v = validProduct(await readJson(req), false);
        const r = db.prepare("INSERT INTO products (name, category, region, price, old_price, stock, weight_g, badge, icon, description, active, reviewed, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(v.name, v.category, v.region, v.price, v.old_price || null, v.stock, v.weight_g, v.badge || null, v.icon || "📦", v.description, v.active == null ? 1 : v.active, 0, nowIso(), nowIso());
        return send(res, 201, { id: Number(r.lastInsertRowid) });
      } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
    }
    if ((m = /^\/api\/admin\/products\/(\d+)$/.exec(pathname)) && method === "PUT") {
      try {
        const id = Number(m[1]);
        if (!db.prepare("SELECT 1 FROM products WHERE id = ?").get(id)) return fail(res, 404, "Produk tidak ditemukan.");
        const v = validProduct(await readJson(req), true);
        const cols = Object.keys(v);
        if (!cols.length) return fail(res, 400, "Tidak ada perubahan.");
        tx(() => {
          const cur = db.prepare("SELECT price, old_price FROM products WHERE id = ?").get(id);
          const price = v.price != null ? v.price : cur.price, old = "old_price" in v ? v.old_price : cur.old_price;
          if (old != null && old <= price) throw httpErr(400, "Harga coret harus lebih tinggi dari harga jual.");
          db.prepare("UPDATE products SET " + cols.map((c) => c + " = ?").join(", ") + ", updated = ? WHERE id = ?").run(...cols.map((c) => v[c]), nowIso(), id);
        });
        return send(res, 200, { ok: true });
      } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
    }
    if ((m = /^\/api\/admin\/products\/(\d+)\/image$/.exec(pathname)) && method === "POST") {
      try {
        const id = Number(m[1]);
        if (!db.prepare("SELECT 1 FROM products WHERE id = ?").get(id)) return fail(res, 404, "Produk tidak ditemukan.");
        const name = saveImage(id, await readJson(req, 6 * 1024 * 1024));
        return send(res, 200, { image: "/media/" + name });
      } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
    }
    if (pathname === "/api/admin/coupons" && method === "GET") return send(res, 200, { coupons: db.prepare("SELECT * FROM coupons ORDER BY code").all() });
    if (pathname === "/api/admin/coupons" && method === "POST") {
      const b = await readJson(req);
      const code = String(b.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{3,20}$/.test(code)) return fail(res, 400, "Kode kupon 3-20 huruf/angka.");
      if (!["pct", "flat", "ship"].includes(b.type)) return fail(res, 400, "Jenis kupon tidak valid.");
      const val = Number(b.value) || 0, min = Number(b.min) || 0, pts = Number(b.pts) || 0, mx = b.maxUses ? Number(b.maxUses) : null;
      if (b.type === "pct" && !(val >= 1 && val <= 90)) return fail(res, 400, "Persentase diskon 1-90.");
      if (b.type === "flat" && !(val >= 1000)) return fail(res, 400, "Potongan minimal Rp1.000.");
      if (b.expires && Number.isNaN(Date.parse(b.expires))) return fail(res, 400, "Tanggal kedaluwarsa tidak valid.");
      const label = cleanText(b.label, 60) || (b.type === "pct" ? "Diskon " + val + "%" : b.type === "flat" ? "Potongan " + rupiah(val) : "Gratis ongkir");
      db.prepare("INSERT INTO coupons (code, type, value, min_subtotal, points_cost, label, active, expires, max_uses) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET type = excluded.type, value = excluded.value, min_subtotal = excluded.min_subtotal, points_cost = excluded.points_cost, label = excluded.label, active = excluded.active, expires = excluded.expires, max_uses = excluded.max_uses")
        .run(code, b.type, val, min, pts, label, b.active ? 1 : 0, b.expires ? new Date(b.expires).toISOString() : null, mx);
      return send(res, 200, { ok: true });
    }
    if ((m = /^\/api\/admin\/coupons\/([A-Za-z0-9]+)$/.exec(pathname)) && method === "DELETE") {
      db.prepare("DELETE FROM coupons WHERE code = ?").run(m[1].toUpperCase());
      return send(res, 200, { ok: true });
    }
    if (pathname === "/api/admin/orders" && method === "GET") {
      const u = new URL(req.url, "http://x");
      const st = u.searchParams.get("status") || "", qq = (u.searchParams.get("q") || "").trim().toUpperCase().slice(0, 40);
      let sql = "SELECT * FROM orders WHERE 1=1"; const args = [];
      if (st === "perlu_refund") sql += " AND refund_status = 'perlu_refund'";
      else if (st) { sql += " AND status = ?"; args.push(st); }
      if (qq) { sql += " AND (UPPER(id) LIKE ? OR UPPER(email) LIKE ? OR UPPER(recipient) LIKE ?)"; args.push("%" + qq + "%", "%" + qq + "%", "%" + qq + "%"); }
      sql += " ORDER BY created DESC LIMIT 200";
      return send(res, 200, { orders: db.prepare(sql).all(...args).map(adminOrderRow) });
    }
    if ((m = /^\/api\/admin\/orders\/([A-Z0-9]+)\/action$/.exec(pathname)) && method === "POST") {
      try { return await adminAction(req, res, admin, m[1]); } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
    }
    if (pathname === "/api/admin/users" && method === "GET") {
      const rows = db.prepare("SELECT u.email, u.name, u.joined, u.email_verified v, (SELECT COUNT(*) FROM orders o WHERE o.email = u.email) orders FROM users u ORDER BY u.joined DESC LIMIT 500").all();
      return send(res, 200, { users: rows.map((r) => ({ email: r.email, name: r.name, joined: r.joined, verified: !!r.v, orders: r.orders, admin: ADMIN_EMAILS.includes(r.email) })) });
    }
    if (pathname === "/api/admin/sellers" && method === "GET") return send(res, 200, { sellers: db.prepare("SELECT * FROM sellers ORDER BY id DESC").all() });
    if ((m = /^\/api\/admin\/sellers\/(\d+)$/.exec(pathname)) && method === "POST") {
      const b = await readJson(req);
      if (!["verified", "rejected", "pending"].includes(b.status)) return fail(res, 400, "Status tidak valid.");
      db.prepare("UPDATE sellers SET status = ? WHERE id = ?").run(b.status, Number(m[1]));
      return send(res, 200, { ok: true });
    }
    if (pathname === "/api/admin/settings" && method === "GET") {
      return send(res, 200, { freeShipMin: numSetting("free_ship_min"), codMax: numSetting("cod_max"), returnDays: numSetting("return_days"), payWindowHours: numSetting("pay_window_hours"), maintenance: getSetting("maintenance") === "1", maintenanceEnv: process.env.MAINTENANCE === "1", tariff: getTariff(), tariffReviewed: getSetting("tariff_reviewed") === "1", zones: ZONES });
    }
    if (pathname === "/api/admin/settings" && method === "PUT") {
      const b = await readJson(req, 128 * 1024);
      const int = (v, lo, hi, name) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw httpErr(400, "Isian '" + name + "' tidak valid."); return n; };
      try {
        if ("freeShipMin" in b) setSetting("free_ship_min", int(b.freeShipMin, 0, 1e9, "gratis ongkir minimal"));
        if ("codMax" in b) setSetting("cod_max", int(b.codMax, 0, 1e9, "batas COD"));
        if ("returnDays" in b) setSetting("return_days", int(b.returnDays, 0, 60, "hari retur"));
        if ("payWindowHours" in b) setSetting("pay_window_hours", int(b.payWindowHours, 1, 72, "batas bayar (jam)"));
        if ("maintenance" in b) setSetting("maintenance", b.maintenance ? "1" : "0");
        if ("tariffReviewed" in b) setSetting("tariff_reviewed", b.tariffReviewed ? "1" : "0");
        if ("tariff" in b) {
          const t = b.tariff;
          if (!isObj(t) || !Array.isArray(t.couriers) || !t.couriers.length || t.couriers.length > 8) throw httpErr(400, "Format tarif tidak valid.");
          const clean = t.couriers.map((c) => {
            if (!isObj(c) || !/^[a-z0-9]{2,12}$/.test(String(c.id))) throw httpErr(400, "ID kurir 2-12 huruf kecil/angka.");
            const perKg = {};
            for (const z of Object.keys(ZONES)) perKg[z] = int(c.perKg && c.perKg[z], 0, 1e7, "tarif " + c.id + "/" + z);
            const trackUrl = String(c.trackUrl || "").trim();
            if (trackUrl && !/^https:\/\/[^\s]+$/.test(trackUrl)) throw httpErr(400, "Tautan lacak harus diawali https://");
            return { id: String(c.id), name: cleanText(c.name, 40) || String(c.id).toUpperCase(), trackUrl, perKg };
          });
          setSetting("tariff", JSON.stringify({ couriers: clean }));
        }
      } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
      return send(res, 200, { ok: true });
    }
    return fail(res, 404, "Rute admin tidak ditemukan.");
  }

  /* ================= Router ================= */
  async function handle(req, res, pathname, ip) {
    const method = req.method;
    try {
      if (pathname.startsWith("/api/admin/")) { await handleAdmin(req, res, pathname, method); return true; }

      if (pathname === "/api/catalog" && method === "GET") { send(res, 200, catalog()); return true; }

      if (pathname === "/api/shipping/quote" && method === "POST") {
        if (tooMany("quote", ip, 60, 10 * 60 * 1000)) { fail(res, 429, "Terlalu banyak permintaan."); return true; }
        const b = await readJson(req);
        if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) { fail(res, 400, "Keranjang kosong."); return true; }
        let subtotal = 0, weight = 0;
        for (const it of b.items) {
          const p = db.prepare("SELECT price, weight_g FROM products WHERE id = ? AND active = 1 AND reviewed = 1").get(Number(it && it.id));
          const qty = Number(it && it.qty);
          if (!p || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) { fail(res, 400, "Isi keranjang tidak valid."); return true; }
          subtotal += p.price * qty; weight += p.weight_g * qty;
        }
        const s = shippingFee(String(b.courier || ""), String(b.province || ""), weight, subtotal);
        send(res, 200, { shipping: s.fee, full: s.full, free: s.free, weight, subtotal });
        return true;
      }

      if (pathname === "/api/payments/midtrans" && method === "POST") { await midtransWebhook(req, res); return true; }

      let m;
      if ((m = /^\/api\/reviews\/(\d+)$/.exec(pathname)) && method === "GET") { send(res, 200, { reviews: reviewsOf(Number(m[1])) }); return true; }

      const needsAuth = pathname === "/api/orders" || pathname.startsWith("/api/orders/") || pathname === "/api/reviews" || pathname === "/api/sellers" || pathname === "/api/coupon/check";
      if (!needsAuth) return false;
      const user = authUser(req);
      if (!user) { fail(res, 401, "Sesi tidak valid. Silakan masuk lagi."); return true; }

      if (pathname === "/api/orders" && method === "GET") { send(res, 200, { orders: ordersFor(user.email), points: pointsOf(user.email) }); return true; }
      if (pathname === "/api/orders" && method === "POST") { await createOrder(req, res, user, ip); return true; }
      if ((m = /^\/api\/orders\/([A-Z0-9]+)\/(cancel|return|pay|simulate-pay)$/.exec(pathname)) && method === "POST") { await buyerOrderAction(req, res, user, m[1], m[2]); return true; }

      if (pathname === "/api/coupon/check" && method === "POST") {
        const b = await readJson(req);
        let subtotal = 0;
        for (const it of Array.isArray(b.items) ? b.items.slice(0, 50) : []) {
          const p = db.prepare("SELECT price FROM products WHERE id = ? AND active = 1 AND reviewed = 1").get(Number(it && it.id));
          const qty = Number(it && it.qty);
          if (p && Number.isInteger(qty) && qty > 0 && qty <= MAX_QTY) subtotal += p.price * qty;
        }
        const c = applyCoupon(b.code, subtotal, 0, user.email);
        send(res, 200, { ok: true, code: c.coupon, discount: c.discount, freeShipping: c.coupon ? db.prepare("SELECT type FROM coupons WHERE code = ?").get(c.coupon).type === "ship" : false });
        return true;
      }

      if (pathname === "/api/reviews" && method === "POST") {
        if (tooMany("review", user.email, 10, 3600 * 1000)) { fail(res, 429, "Terlalu banyak ulasan. Coba lagi nanti."); return true; }
        const b = await readJson(req);
        const pid = Number(b.productId), rating = Number(b.rating), text = cleanText(b.text, 300);
        if (!Number.isInteger(pid) || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 5) { fail(res, 400, "Pilih bintang dan tulis minimal 5 karakter."); return true; }
        const bought = db.prepare("SELECT 1 FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.email = ? AND i.product_id = ? AND o.status = 'selesai' LIMIT 1").get(user.email, pid);
        if (!bought) { fail(res, 403, "Ulasan hanya untuk pembeli yang pesanannya sudah selesai."); return true; }
        try { db.prepare("INSERT INTO reviews (product_id, email, name, rating, text, created) VALUES (?,?,?,?,?,?)").run(pid, user.email, firstName(user.name), rating, text, nowIso()); }
        catch (e) { fail(res, 409, "Anda sudah menulis ulasan untuk produk ini."); return true; }
        send(res, 201, { ok: true }); return true;
      }

      if (pathname === "/api/sellers" && method === "POST") {
        if (tooMany("seller", user.email, 5, 3600 * 1000)) { fail(res, 429, "Terlalu banyak percobaan."); return true; }
        const b = await readJson(req);
        const shop = cleanText(b.shop, 60), city = cleanText(b.city, 40), cat = String(b.cat || "");
        const wa = String(b.wa || "").replace(/[\s-]/g, "");
        if (shop.length < 3) { fail(res, 400, "Nama usaha minimal 3 karakter."); return true; }
        if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(city)) { fail(res, 400, "Nama kota hanya boleh berisi huruf."); return true; }
        if (!/^(\+62|62|0)8[0-9]{7,12}$/.test(wa)) { fail(res, 400, "Nomor WhatsApp tidak valid. Contoh: 081234567890."); return true; }
        if (!b.agree) { fail(res, 400, "Setujui kebijakan keamanan penjual untuk melanjutkan."); return true; }
        const norm = "62" + wa.replace(/^(\+62|62|0)/, "");
        if (db.prepare("SELECT 1 FROM sellers WHERE owner_email = ? AND status = 'pending'").get(user.email)) { fail(res, 409, "Anda sudah punya pendaftaran yang menunggu verifikasi."); return true; }
        if (db.prepare("SELECT 1 FROM sellers WHERE wa = ? OR LOWER(shop) = LOWER(?)").get(norm, shop)) { fail(res, 409, "Nama usaha atau nomor WhatsApp ini sudah terdaftar."); return true; }
        db.prepare("INSERT INTO sellers (owner_email, shop, category, city, wa, status, created) VALUES (?,?,?,?,?, 'pending', ?)").run(user.email, shop, cat.slice(0, 40), city, norm, nowIso());
        send(res, 201, { ok: true }); return true;
      }
      return false;
    } catch (e) {
      if (e && e.status) { fail(res, e.status, e.message); return true; }
      throw e;
    }
  }

  /* Data akun: ekspor (hak pengguna) dan penghapusan (H-05) */
  function exportAccount(user) {
    return {
      diekspor: nowIso(),
      akun: { nama: user.name, email: user.email, daftar: user.joined },
      pesanan: db.prepare("SELECT * FROM orders WHERE email = ?").all(user.email).map((o) => Object.assign(publicOrder(o), { alamat: o.address })),
      ulasan: db.prepare("SELECT product_id, rating, text, created FROM reviews WHERE email = ?").all(user.email),
      poin: pointsOf(user.email),
      penjual: db.prepare("SELECT shop, category, city, wa, status, created FROM sellers WHERE owner_email = ?").all(user.email)
    };
  }
  // Pesanan dipertahankan tanpa data pribadi (untuk pembukuan); data identitas dihapus/dianonimkan.
  function eraseAccountData(email) {
    tx(() => {
      db.prepare("UPDATE orders SET email = NULL, recipient = '(dihapus)', phone = '-', address = '(dihapus)', city = '-', postal = '00000' WHERE email = ?").run(email);
      db.prepare("UPDATE reviews SET email = NULL, name = 'Pengguna terhapus' WHERE email = ?").run(email);
      db.prepare("DELETE FROM sellers WHERE owner_email = ?").run(email);
      db.prepare("DELETE FROM user_points WHERE email = ?").run(email);
    });
  }

  return { handle, catalog, ordersFor, pointsOf, isAdmin, isMaintenance, exportAccount, eraseAccountData, expireUnpaid, gateway: GATEWAY, sitemapPaths: () => ["/", "/syarat-ketentuan.html", "/kebijakan-privasi.html", "/retur-refund.html"] };
};
