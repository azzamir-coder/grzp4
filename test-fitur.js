"use strict";
/*
  Uji otomatis fitur toko (F-01..F-10, D-04, H-05, I-05, I-07).
  Jalankan:  node test-fitur.js   (atau: npm run test:fitur)
  Memakai database sementara, port acak, dan Midtrans TIRUAN lokal. Tidak menyentuh data.db Anda dan tidak memakai jaringan luar.
  Yang TIDAK bisa diuji di sini: Midtrans sungguhan (sandbox/produksi) dan pengiriman email sungguhan.
*/
const { spawn } = require("node:child_process");
const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os"), fs = require("node:fs"), path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fitur-"));
let pass = 0, bad = 0;
const ok = (cond, name) => { cond ? pass++ : bad++; console.log((cond ? "  LULUS  " : "  GAGAL  ") + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 4301, MT_PORT = 4390, KEY = "SB-Mid-server-uji";
const PW = "Sandi-Uji-2026x";

/* ---- Midtrans tiruan ---- */
const mt = { status: {}, created: {}, canceled: [] };
const mtServer = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = req.headers.authorization || "";
    const okAuth = auth === "Basic " + Buffer.from(KEY + ":").toString("base64");
    const j = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (!okAuth) return j(401, { status_message: "unauthorized" });
    let m;
    if (req.method === "POST" && req.url === "/snap/v1/transactions") {
      const b = JSON.parse(body);
      mt.created[b.transaction_details.order_id] = b;
      const sum = b.item_details.reduce((s, i) => s + i.price * i.quantity, 0);
      if (sum !== b.transaction_details.gross_amount) return j(400, { error_messages: ["item_details tidak sama dengan gross_amount"] });
      return j(201, { token: "tok", redirect_url: "https://pay.contoh.test/" + b.transaction_details.order_id });
    }
    if (req.method === "GET" && (m = /^\/v2\/([A-Z0-9]+)\/status$/.exec(req.url))) {
      const c = mt.created[m[1]];
      if (!c) return j(404, { status_code: "404" });
      return j(200, { order_id: m[1], transaction_status: mt.status[m[1]] || "pending", fraud_status: "accept", gross_amount: c.transaction_details.gross_amount.toFixed(2) });
    }
    if (req.method === "POST" && (m = /^\/v2\/([A-Z0-9]+)\/cancel$/.exec(req.url))) { mt.canceled.push(m[1]); return j(200, {}); }
    j(404, {});
  });
}).listen(MT_PORT);

let out = "";
const srv = spawn(process.execPath, ["--no-warnings", path.join(__dirname, "server.js")], {
  env: {
    ...process.env, PORT: String(PORT), DB_FILE: path.join(tmp, "uji.db"), UPLOAD_DIR: path.join(tmp, "up"), AUTH_SECRET: "u".repeat(64),
    ADMIN_EMAILS: "admin@uji.id", MIDTRANS_SERVER_KEY: KEY, MIDTRANS_SNAP_URL: "http://127.0.0.1:" + MT_PORT, MIDTRANS_API_URL: "http://127.0.0.1:" + MT_PORT,
    ORDER_GAP_MS: "1", EXPIRE_CHECK_MS: "400", NODE_ENV: "", APP_URL: "http://127.0.0.1:" + PORT, RESEND_API_KEY: "", MAIL_FROM: ""
  }, stdio: ["ignore", "pipe", "pipe"]
});
srv.stdout.on("data", (d) => (out += d));
srv.stderr.on("data", (d) => (out += d));

const call = (p, opts = {}, tok) => fetch("http://127.0.0.1:" + PORT + p, { ...opts, headers: { ...(opts.headers || {}), ...(tok ? { Authorization: "Bearer " + tok } : {}) }, redirect: "manual" })
  .then(async (r) => { const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) { /* bukan JSON */ } return { s: r.status, h: r.headers, t, j }; });
const send = (method, p, body, tok) => call(p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, tok);
const linkFrom = (kind, email) => { const re = new RegExp("\\[EMAIL → " + email.replace(/[.]/g, "\\.") + "\\][^\\n]*\\n[\\s\\S]*?#" + kind + "=([\\w-]+)", "g"); const m = [...out.matchAll(re)]; return m.length ? m[m.length - 1][1] : null; };
const mailSeen = (email, subj) => out.includes("[EMAIL → " + email + "] " + subj);
async function makeUser(name, email) {
  await send("POST", "/api/register", { name, email, password: PW, consent: true });
  await wait(150);
  await send("POST", "/api/verify", { token: linkFrom("verify", email) });
  const r = await send("POST", "/api/login", { email, password: PW });
  return r.j.token;
}
const sign = (id, code, gross) => crypto.createHash("sha512").update(id + code + gross + KEY).digest("hex");
const webhook = (id, gross, signature) => send("POST", "/api/payments/midtrans", { order_id: id, status_code: "200", gross_amount: gross, signature_key: signature || sign(id, "200", gross) });
const ship = (o) => ({ recipient: "Penguji", phone: "081234567890", address: "Jl. Uji No. 1", city: "Surabaya", postal: "60123", province: "Jawa Timur", courier: "jne", payment: "COD", ...o });

(async () => {
  await wait(1500);
  const adm = await makeUser("Admin Uji", "admin@uji.id");
  const b1 = await makeUser("Pembeli Satu", "b1@uji.id");
  const b2 = await makeUser("Pembeli Dua", "b2@uji.id");
  const b3 = await makeUser("Pembeli Tiga", "b3@uji.id");
  const A = (m, p, b) => send(m, "/api/admin" + p, b, adm);

  console.log("\nF-01  Katalog, harga, stok, kupon dikelola server");
  let cat = (await call("/api/catalog")).j;
  ok(Array.isArray(cat.products) && cat.products.length >= 20, "katalog dilayani server (" + (cat.products || []).length + " produk)");
  ok(cat.products.every((p) => p.weight > 0 && p.price > 0), "setiap produk punya harga dan berat dari server");
  ok(cat.products.every((p) => p.rating === 0 && p.reviews === 0 && p.sold === 0), "rating, ulasan, dan terjual mulai dari nol (tidak ada angka contoh)");
  ok((cat.coupons || []).length === 0, "kupon bawaan tidak aktif sebelum disetujui pemilik");
  const P = cat.products.find((p) => p.price < 300000 && p.stock >= 5);
  const BIG = cat.products.find((p) => p.price >= 400000 && p.stock >= 3);
  let r = await send("PUT", "/api/admin/products/" + P.id, { price: P.price + 5000 }, b1);
  ok(r.s === 403, "pembeli biasa tidak bisa mengubah harga lewat API admin");
  r = await send("PUT", "/api/admin/products/" + P.id, { price: P.price + 5000 });
  ok(r.s === 401, "tanpa login tidak bisa mengubah harga");
  r = await A("PUT", "/products/" + P.id, { price: P.price + 5000 });
  cat = (await call("/api/catalog")).j;
  const P2 = cat.products.find((p) => p.id === P.id);
  ok(r.s === 200 && P2.price === P.price + 5000, "perubahan harga lewat dasbor admin langsung berlaku");

  console.log("\nF-02  Total pesanan dihitung dan divalidasi server");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 2, price: 1, name: "x" }], total: 1, discount: 99999, shipping: 0, subtotal: 1 }), b1);
  const o1 = r.j.order;
  const sub = 2 * P2.price;
  ok(r.s === 201 && o1.subtotal === sub && o1.discount === 0 && o1.total === sub + o1.shipping && o1.shipping > 0, "harga/diskon/total kiriman klien diabaikan; total = harga server + ongkir (" + (o1 && o1.total) + ")");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], coupon: "NUSANTARA10" }), b1);
  ok(r.s === 400, "kupon yang belum diaktifkan ditolak");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], coupon: "ASALASALAN" }), b1);
  ok(r.s === 400, "kupon tidak dikenal ditolak");
  for (const [qty, nm] of [[0, "qty 0"], [-3, "qty negatif"], [1000, "qty 1000"], [1.5, "qty desimal"]]) {
    r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty }] }), b1);
    ok(r.s === 400, "jumlah tidak valid ditolak: " + nm);
  }
  r = await send("POST", "/api/orders", ship({ items: [{ id: 999999, qty: 1 }] }), b1);
  ok(r.s === 400, "produk yang tidak ada ditolak");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], province: "" }), b1);
  ok(r.s === 400, "tanpa provinsi ditolak");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], courier: "kurirgaib" }), b1);
  ok(r.s === 400, "kurir tidak dikenal ditolak");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], payment: "Bitcoin" }), b1);
  ok(r.s === 400, "metode pembayaran tidak dikenal ditolak");
  await A("PUT", "/settings", { codMax: 50000 });
  r = await send("POST", "/api/orders", ship({ items: [{ id: BIG.id, qty: 1 }] }), b1);
  ok(r.s === 400 && /COD/.test(r.j.message || ""), "COD di atas batas ditolak");
  await A("PUT", "/settings", { codMax: 1000000 });
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], phone: "123" }), b1);
  ok(r.s === 400, "telepon tidak valid ditolak");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }] }));
  ok(r.s === 401, "pesan tanpa login ditolak");

  console.log("\nKupon (D-03): hanya yang diaktifkan pemilik");
  await A("POST", "/coupons", { code: "UJI10", type: "pct", value: 10, active: true, label: "Diskon 10%" });
  await A("POST", "/coupons", { code: "SATUKALI", type: "flat", value: 5000, active: true, maxUses: 1 });
  await A("POST", "/coupons", { code: "LAMA", type: "flat", value: 5000, active: true, expires: "2020-01-01T00:00:00Z" });
  await A("POST", "/coupons", { code: "MINBESAR", type: "flat", value: 5000, active: true, min: 99999999 });
  cat = (await call("/api/catalog")).j;
  ok(cat.coupons.some((c) => c.code === "UJI10") && !cat.coupons.some((c) => c.code === "LAMA"), "katalog hanya memuat kupon aktif dan belum kedaluwarsa");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], coupon: "uji10" }), b1);
  ok(r.s === 201 && r.j.order.discount === Math.round(P2.price * 0.1) && r.j.order.total === P2.price - r.j.order.discount + r.j.order.shipping, "kupon persen dihitung server (huruf kecil diterima)");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], coupon: "LAMA" }), b1);
  ok(r.s === 400, "kupon kedaluwarsa ditolak");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], coupon: "MINBESAR" }), b1);
  ok(r.s === 400, "kupon di bawah minimal belanja ditolak");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], coupon: "SATUKALI" }), b1);
  const first = r.s;
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], coupon: "SATUKALI" }), b2);
  ok(first === 201 && r.s === 400, "kupon dengan kuota 1 hanya bisa dipakai sekali");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], coupon: "POIN100" }), b2);
  ok(r.s === 400, "kupon tukar poin ditolak bila belum aktif/poin kurang");

  console.log("\nF-05  Stok terpusat, aman terhadap pesanan bersamaan");
  const Q = cat.products.find((p) => p.id !== P.id && p.id !== BIG.id && p.price < 300000);
  await A("PUT", "/products/" + Q.id, { stock: 1 });
  const race = await Promise.all([send("POST", "/api/orders", ship({ items: [{ id: Q.id, qty: 1 }] }), b1), send("POST", "/api/orders", ship({ items: [{ id: Q.id, qty: 1 }] }), b2), send("POST", "/api/orders", ship({ items: [{ id: Q.id, qty: 1 }] }), b3)]);
  const wins = race.filter((x) => x.s === 201).length, losses = race.filter((x) => x.s === 409).length;
  ok(wins === 1 && losses === 2, "3 pembeli berebut stok terakhir: 1 berhasil, 2 ditolak (menang=" + wins + ", ditolak=" + losses + ")");
  cat = (await call("/api/catalog")).j;
  ok(cat.products.find((p) => p.id === Q.id).stock === 0, "stok tepat 0, tidak minus");
  r = await send("POST", "/api/orders", ship({ items: [{ id: Q.id, qty: 1 }] }), b1);
  ok(r.s === 409, "produk habis tidak bisa dipesan");
  const winner = race.find((x) => x.s === 201).j.order;
  const winnerTok = [b1, b2, b3][race.findIndex((x) => x.s === 201)];

  console.log("\nF-10  Pembatalan mengembalikan stok");
  r = await send("POST", "/api/orders/" + winner.id + "/cancel", { reason: "uji" }, [b1, b2, b3].find((t) => t !== winnerTok));
  ok(r.s === 404, "pembeli lain tidak bisa membatalkan pesanan orang lain");
  r = await send("POST", "/api/orders/" + winner.id + "/cancel", { reason: "uji batal" }, winnerTok);
  ok(r.s === 200 && r.j.order.status === "dibatalkan", "pembeli membatalkan pesanan COD berstatus diproses");
  cat = (await call("/api/catalog")).j;
  ok(cat.products.find((p) => p.id === Q.id).stock === 1, "stok kembali setelah pembatalan");
  r = await send("POST", "/api/orders/" + winner.id + "/cancel", {}, winnerTok);
  ok(r.s === 409, "pembatalan dua kali ditolak (stok tidak dobel)");
  cat = (await call("/api/catalog")).j;
  ok(cat.products.find((p) => p.id === Q.id).stock === 1, "stok tetap 1 setelah percobaan batal kedua");

  console.log("\nF-03  Pembayaran: berhasil, gagal, kedaluwarsa");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], payment: "Transfer Bank" }), b2);
  const pay = r.j.order;
  ok(r.s === 201 && pay.status === "menunggu_pembayaran" && /^https:\/\/pay\.contoh\.test\//.test(pay.payUrl), "pesanan non-COD menunggu pembayaran dengan tautan dari gateway");
  const sent = mt.created[pay.id];
  ok(sent && sent.transaction_details.gross_amount === pay.total && sent.enabled_payments.includes("bca_va"), "nominal dan metode dikirim ke gateway sesuai pesanan server");
  let g = await webhook(pay.id, pay.total.toFixed(2), "0".repeat(128));
  ok(g.s === 403, "webhook dengan tanda tangan palsu ditolak");
  g = await webhook(pay.id, pay.total.toFixed(2));
  let cur = (await send("GET", "/api/orders", undefined, b2)).j.orders.find((o) => o.id === pay.id);
  ok(g.s === 200 && cur.status === "menunggu_pembayaran", "webhook sah tetapi status gateway masih pending: pesanan tetap menunggu");
  mt.status[pay.id] = "settlement";
  g = await webhook(pay.id, pay.total.toFixed(2));
  cur = (await send("GET", "/api/orders", undefined, b2)).j.orders.find((o) => o.id === pay.id);
  ok(cur.status === "diproses" && cur.paymentStatus === "paid", "setelah gateway mengonfirmasi lunas, pesanan diproses");
  await webhook(pay.id, pay.total.toFixed(2));
  cur = (await send("GET", "/api/orders", undefined, b2)).j.orders.find((o) => o.id === pay.id);
  ok(cur.status === "diproses", "webhook ulang tidak merusak status (idempoten)");
  ok(mailSeen("b2@uji.id", "Pembayaran diterima — Grizlie Nusantara"), "email 'pembayaran diterima' dikirim (F-07)");

  const before = (await call("/api/catalog")).j.products.find((p) => p.id === P.id).stock;
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 2 }], payment: "E-Wallet" }), b3);
  const fail1 = r.j.order;
  mt.status[fail1.id] = "expire";
  await webhook(fail1.id, fail1.total.toFixed(2));
  cur = (await send("GET", "/api/orders", undefined, b3)).j.orders.find((o) => o.id === fail1.id);
  const after = (await call("/api/catalog")).j.products.find((p) => p.id === P.id).stock;
  ok(cur.status === "dibatalkan" && after === before, "pembayaran kedaluwarsa di gateway: pesanan batal dan stok kembali");

  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], payment: "Transfer Bank" }), b3);
  const exp = r.j.order;
  const { DatabaseSync } = require("node:sqlite");
  const dbx = new DatabaseSync(path.join(tmp, "uji.db"));
  dbx.exec("PRAGMA busy_timeout = 3000"); dbx.prepare("UPDATE orders SET expires = 1 WHERE id = ?").run(exp.id); dbx.close();
  await wait(1500);
  cur = (await send("GET", "/api/orders", undefined, b3)).j.orders.find((o) => o.id === exp.id);
  ok(cur.status === "dibatalkan", "pesanan yang melewati batas waktu bayar dibatalkan otomatis");
  ok(mailSeen("b3@uji.id", "Pesanan dibatalkan — Grizlie Nusantara"), "email pembatalan dikirim");
  r = await send("POST", "/api/orders/" + pay.id + "/simulate-pay", {}, b2);
  ok(r.s === 404, "simulasi pembayaran tidak tersedia saat gateway aktif");

  console.log("\nF-04/F-06/F-07  Status dari proses nyata, resi, notifikasi");
  const stBefore = (await send("GET", "/api/orders", undefined, b2)).j.orders.find((o) => o.id === pay.id).status;
  await wait(800);
  const stAfter = (await send("GET", "/api/orders", undefined, b2)).j.orders.find((o) => o.id === pay.id).status;
  ok(stBefore === stAfter && stAfter === "diproses", "status tidak berubah sendiri mengikuti waktu");
  const act = (id, body) => A("POST", "/orders/" + id + "/action", body);
  r = await act(pay.id, { action: "ship", trackingNo: "" });
  ok(r.s === 400, "kirim tanpa nomor resi ditolak");
  r = await act(pay.id, { action: "deliver" });
  ok(r.s === 409, "tidak bisa melompat ke selesai sebelum dikirim");
  r = await send("POST", "/api/admin/orders/" + pay.id + "/action", { action: "pack" }, b2);
  ok(r.s === 403, "pembeli tidak bisa mengubah status pesanan");
  r = await act(pay.id, { action: "pack" });
  ok(r.s === 200 && r.j.order.status === "dikemas", "admin: diproses → dikemas");
  r = await act(pay.id, { action: "ship", trackingNo: "JNE1234567890" });
  ok(r.s === 200 && r.j.order.status === "dikirim" && r.j.order.trackingNo === "JNE1234567890", "admin: kirim dengan nomor resi");
  cur = (await send("GET", "/api/orders", undefined, b2)).j.orders.find((o) => o.id === pay.id);
  ok(cur.trackingNo === "JNE1234567890" && /JNE/i.test(cur.courier), "pembeli melihat kurir dan nomor resi");
  await wait(200);
  ok(out.includes("JNE1234567890") && mailSeen("b2@uji.id", "Pesanan dikirim — Grizlie Nusantara"), "email 'pesanan dikirim' memuat nomor resi");
  r = await send("POST", "/api/orders/" + pay.id + "/cancel", {}, b2);
  ok(r.s === 409, "pesanan yang sudah dikirim tidak bisa dibatalkan pembeli");
  r = await send("POST", "/api/orders/" + pay.id + "/return", { reason: "uji retur awal" }, b2);
  ok(r.s === 409, "retur belum bisa diajukan sebelum pesanan selesai");
  const ptsBefore = (await send("GET", "/api/orders", undefined, b2)).j.points.bal;
  r = await act(pay.id, { action: "deliver" });
  ok(r.s === 200 && r.j.order.status === "selesai", "admin: dikirim → selesai");
  const pts = (await send("GET", "/api/orders", undefined, b2)).j.points;
  ok(pts.bal === ptsBefore + Math.floor(pay.total / 10000), "poin dikreditkan server saat selesai (" + pts.bal + ")");
  r = await send("PUT", "/api/data/points", { value: { bal: 999999, life: 999999 } }, b2);
  ok(r.s === 404, "klien tidak bisa menulis poin sendiri");
  r = await send("PUT", "/api/data/orders", { value: [] }, b2);
  ok(r.s === 404, "klien tidak bisa menulis riwayat pesanan sendiri");
  const sold = (await call("/api/catalog")).j.products.find((p) => p.id === P.id).sold;
  ok(sold >= 1, "jumlah terjual dihitung dari pesanan nyata (" + sold + ")");

  console.log("\nF-10  Retur sampai dana dan stok kembali");
  const stockBeforeReturn = (await call("/api/catalog")).j.products.find((p) => p.id === P.id).stock;
  r = await send("POST", "/api/orders/" + pay.id + "/return", { reason: "x" }, b2);
  ok(r.s === 400, "alasan retur terlalu pendek ditolak");
  r = await send("POST", "/api/orders/" + pay.id + "/return", { reason: "Barang rusak saat diterima" }, b2);
  ok(r.s === 200 && r.j.order.status === "retur_diajukan", "pembeli mengajukan retur");
  r = await act(pay.id, { action: "return_decision", approve: true });
  ok(r.s === 200 && r.j.order.status === "retur_disetujui" && r.j.order.refundStatus === "perlu_refund", "admin menyetujui retur, refund menunggu");
  r = await act(pay.id, { action: "refund_done", note: "" });
  ok(r.s === 400, "refund selesai wajib disertai referensi");
  r = await act(pay.id, { action: "refund_done", note: "RF-UJI-001" });
  const stockAfterReturn = (await call("/api/catalog")).j.products.find((p) => p.id === P.id).stock;
  const pts2 = (await send("GET", "/api/orders", undefined, b2)).j.points;
  ok(r.s === 200 && r.j.order.status === "dikembalikan" && r.j.order.refundStatus === "selesai", "refund dicatat selesai");
  ok(stockAfterReturn === stockBeforeReturn + 1, "stok barang retur kembali");
  ok(pts2.bal === ptsBefore, "poin dari pesanan yang diretur dikurangi lagi");
  r = await act(pay.id, { action: "refund_done", note: "dobel" });
  ok(r.s === 409, "refund tidak bisa dicatat dua kali");

  console.log("\nF-10  Batalkan pesanan yang sudah dibayar → perlu refund");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }], payment: "Transfer Bank" }), b1);
  const pd = r.j.order; mt.status[pd.id] = "settlement"; await webhook(pd.id, pd.total.toFixed(2));
  const s0 = (await call("/api/catalog")).j.products.find((p) => p.id === P.id).stock;
  r = await send("POST", "/api/orders/" + pd.id + "/cancel", { reason: "ganti rencana" }, b1);
  const s1 = (await call("/api/catalog")).j.products.find((p) => p.id === P.id).stock;
  ok(r.s === 200 && r.j.order.refundStatus === "perlu_refund" && s1 === s0 + 1, "batal setelah bayar: stok kembali dan refund ditandai perlu diproses");
  r = await A("GET", "/orders?status=perlu_refund");
  ok(r.j.orders.some((o) => o.id === pd.id), "admin melihat antrean refund");
  r = await act(pd.id, { action: "refund_done", note: "RF-UJI-002" });
  ok(r.s === 200 && r.j.order.refundStatus === "selesai", "admin menutup refund");

  console.log("\nD-04  Ulasan hanya dari pembeli nyata");
  r = await send("POST", "/api/reviews", { productId: P.id, rating: 5, text: "Bagus sekali produknya" }, b3);
  ok(r.s === 403, "ulasan dari non-pembeli ditolak");
  const done2 = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }] }), b3);
  await act(done2.j.order.id, { action: "ship", trackingNo: "JNT0000111" }); await act(done2.j.order.id, { action: "deliver" });
  r = await send("POST", "/api/reviews", { productId: P.id, rating: 4, text: "Bagus, sesuai deskripsi" }, b3);
  ok(r.s === 201, "pembeli dengan pesanan selesai bisa mengulas");
  r = await send("POST", "/api/reviews", { productId: P.id, rating: 5, text: "Ulasan kedua" }, b3);
  ok(r.s === 409, "satu ulasan per pembeli per produk");
  r = await send("POST", "/api/reviews", { productId: P.id, rating: 9, text: "Bintang terlalu besar" }, b3);
  ok(r.s === 400, "bintang di luar 1-5 ditolak");
  const rv = (await call("/api/reviews/" + P.id)).j.reviews;
  const p3 = (await call("/api/catalog")).j.products.find((p) => p.id === P.id);
  ok(rv.length === 1 && p3.reviews === 1 && p3.rating === 4, "rating produk dihitung dari ulasan nyata");
  ok(!rv.some((x) => /@/.test(JSON.stringify(x))), "ulasan publik tidak membocorkan email");

  console.log("\nF-06  Ongkir sesuai tarif");
  r = await send("POST", "/api/shipping/quote", { items: [{ id: P.id, qty: 1 }], province: "Jawa Timur", courier: "jne" });
  const q1 = r.j;
  r = await send("POST", "/api/shipping/quote", { items: [{ id: P.id, qty: 1 }], province: "Papua", courier: "jne" });
  ok(q1.shipping > 0 && r.j.shipping > q1.shipping, "ongkir Papua lebih mahal dari Jawa Timur (" + q1.shipping + " vs " + r.j.shipping + ")");
  r = await send("POST", "/api/shipping/quote", { items: [{ id: BIG.id, qty: 1 }, { id: BIG.id, qty: 1 }], province: "Papua", courier: "jne" });
  ok(r.j.free === true && r.j.shipping === 0, "gratis ongkir saat belanja melewati batas");
  r = await send("POST", "/api/shipping/quote", { items: [{ id: P.id, qty: 1 }], province: "Atlantis", courier: "jne" });
  ok(r.s === 400, "provinsi tidak dikenal ditolak");

  console.log("\nF-08  Pendaftaran penjual di server");
  r = await send("POST", "/api/sellers", { shop: "Gerabah Uji", cat: "Kerajinan", city: "Bantul", wa: "081298765432", agree: true }, b1);
  ok(r.s === 201, "pendaftaran penjual tersimpan di server");
  r = await send("POST", "/api/sellers", { shop: "Gerabah Dua", cat: "Kerajinan", city: "Bantul", wa: "081298765433", agree: true }, b1);
  ok(r.s === 409, "satu pendaftaran menunggu per akun");
  r = await send("POST", "/api/sellers", { shop: "gerabah uji", cat: "Kerajinan", city: "Bantul", wa: "081200000001", agree: true }, b2);
  ok(r.s === 409, "nama usaha ganda ditolak");
  r = await A("GET", "/sellers");
  ok(r.s === 200 && r.j.sellers.length === 1 && r.j.sellers[0].status === "pending", "admin melihat pendaftar berstatus pending");
  r = await A("POST", "/sellers/" + r.j.sellers[0].id, { status: "verified" });
  ok(r.s === 200, "admin memverifikasi penjual");

  console.log("\nF-09  Dasbor admin");
  r = await A("GET", "/summary");
  ok(r.s === 200 && r.j.products.total >= 20 && r.j.gateway === true, "ringkasan admin berjalan");
  r = await call("/admin.html");
  ok(r.s === 200 && /noindex/.test(r.h.get("x-robots-tag") || ""), "halaman admin tersedia dan tidak diindeks mesin pencari");
  r = await A("POST", "/products", { name: "Produk Uji Baru", category: "kopi", region: "Aceh", description: "Deskripsi uji produk baru", price: 50000, stock: 5, weight: 300 });
  const newId = r.j.id;
  ok(r.s === 201, "admin membuat produk baru");
  cat = (await call("/api/catalog")).j;
  ok(!cat.products.some((p) => p.id === newId), "produk baru belum tampil sebelum ditinjau (D-02)");
  await A("PUT", "/products/" + newId, { reviewed: true });
  cat = (await call("/api/catalog")).j;
  ok(cat.products.some((p) => p.id === newId), "produk tampil setelah ditandai sudah ditinjau");
  r = await A("POST", "/products", { name: "x", category: "kopi", region: "A", description: "pendek", price: -5, stock: 1, weight: 1 });
  ok(r.s === 400, "data produk tidak valid ditolak");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const bigPng = Buffer.concat([png, Buffer.alloc(400)]);
  r = await A("POST", "/products/" + newId + "/image", { data: bigPng.toString("base64") });
  ok(r.s === 200 && /^\/media\/p\d+-/.test(r.j.image), "admin mengunggah foto produk");
  const img = await call(r.j.image);
  ok(img.s === 200 && /image\/png/.test(img.h.get("content-type") || ""), "foto dilayani dari /media");
  r = await A("POST", "/products/" + newId + "/image", { data: Buffer.from("<?php echo 1; ?>" + "x".repeat(300)).toString("base64") });
  ok(r.s === 400, "berkas non-gambar ditolak (cek isi, bukan ekstensi)");
  r = await send("POST", "/api/admin/products/" + newId + "/image", { data: bigPng.toString("base64") }, b1);
  ok(r.s === 403, "pembeli tidak bisa mengunggah foto");
  r = await call("/media/..%2f..%2fserver.js");
  ok([400, 404].includes(r.s), "path traversal lewat /media ditolak");
  r = await call("/media/");
  ok(r.s === 404, "daftar folder media tidak terbuka");

  console.log("\nH-05  Persetujuan, ekspor, dan penghapusan data");
  r = await send("POST", "/api/register", { name: "Tanpa Setuju", email: "ts@uji.id", password: PW });
  ok(r.s === 400, "daftar tanpa persetujuan ditolak");
  r = await send("GET", "/api/account/export", undefined, b3);
  ok(r.s === 200 && r.j.akun.email === "b3@uji.id" && r.j.pesanan.length >= 2, "pengguna bisa mengunduh datanya");
  ok(!/hash|salt|scrypt/i.test(r.t), "ekspor tidak memuat hash/salt");
  const open = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }] }), b3);
  r = await send("DELETE", "/api/account", { password: PW }, b3);
  ok(r.s === 409, "hapus akun ditolak selama ada pesanan berjalan");
  await send("POST", "/api/orders/" + open.j.order.id + "/cancel", {}, b3);
  r = await send("DELETE", "/api/account", { password: "SalahSalah-1" }, b3);
  ok(r.s === 403, "hapus akun dengan sandi salah ditolak");
  r = await send("DELETE", "/api/account", { password: PW }, b3);
  ok(r.s === 200, "akun dihapus dengan sandi benar");
  r = await send("POST", "/api/login", { email: "b3@uji.id", password: PW });
  ok(r.s !== 200, "akun yang dihapus tidak bisa masuk");
  r = await A("GET", "/orders?q=Penguji");
  const anon = (await A("GET", "/orders")).j.orders.filter((o) => o.email === "(dihapus)");
  ok(anon.length >= 2 && anon.every((o) => o.recipient === "(dihapus)" && o.address === "(dihapus)"), "pesanan akun terhapus dianonimkan, bukan hilang (" + anon.length + ")");
  const rv2 = (await call("/api/reviews/" + P.id)).j.reviews;
  ok(rv2.length === 1 && rv2[0].name === "Pengguna terhapus", "nama pada ulasan dianonimkan");
  r = await send("DELETE", "/api/account", { password: PW }, adm);
  ok(r.s === 403, "akun admin tidak bisa dihapus lewat jalur biasa");

  console.log("\nI-05  Kesehatan dan I-07  Mode pemeliharaan");
  r = await call("/api/health");
  ok(r.s === 200 && r.j.ok === true && typeof r.j.uptime === "number", "/api/health sehat dan memeriksa database");
  r = await call("/robots.txt"); const sm = await call("/sitemap.xml");
  ok(r.s === 200 && /Disallow: \/admin/.test(r.t) && sm.s === 200 && /<loc>.*syarat-ketentuan/.test(sm.t), "robots.txt dan sitemap.xml tersedia");
  r = await A("PUT", "/settings", { maintenance: true });
  ok(r.s === 200, "admin menyalakan mode pemeliharaan");
  r = await call("/");
  ok(r.s === 503 && /pemeliharaan/i.test(r.t) && r.h.get("retry-after"), "pembeli melihat halaman pemeliharaan (503 + Retry-After)");
  r = await call("/api/catalog");
  ok(r.s === 503 && r.j.maintenance === true, "API toko 503 saat pemeliharaan");
  r = await send("POST", "/api/orders", ship({ items: [{ id: P.id, qty: 1 }] }), b1);
  ok(r.s === 503, "pesanan baru ditolak saat pemeliharaan");
  r = await call("/api/health");
  ok(r.s === 200 && r.j.maintenance === true, "health tetap hidup dan melaporkan pemeliharaan");
  r = await A("GET", "/summary");
  ok(r.s === 200, "dasbor admin tetap bisa dipakai saat pemeliharaan");
  mt.status[pay.id] = "settlement";
  g = await webhook(pay.id, pay.total.toFixed(2));
  ok(g.s === 200, "webhook pembayaran tetap diterima saat pemeliharaan");
  r = await A("PUT", "/settings", { maintenance: false });
  r = await call("/");
  ok(r.s === 200, "toko normal kembali setelah pemeliharaan dimatikan");

  console.log("\nPengaturan admin");
  r = await A("PUT", "/settings", { freeShipMin: -5 });
  ok(r.s === 400, "pengaturan tidak valid ditolak");
  r = await A("PUT", "/settings", { tariff: { couriers: [{ id: "x", name: "X", trackUrl: "http://tidak-aman", perKg: {} }] } });
  ok(r.s === 400, "tarif tidak lengkap/tautan non-https ditolak");

  console.log("\nHalaman publik");
  const idx = (await call("/")).t;
  ok(!/testi-grid|Prototipe|2\.400\+|generateReviews/.test(idx), "beranda tanpa testimoni/angka contoh");
  const js = (await call("/script.js")).t;
  ok(!/generateReviews|nm_stock_used|BUYERS/.test(js), "script.js tanpa data ulasan/stok/pembeli rekaan");
  for (const f of ["/syarat-ketentuan.html", "/kebijakan-privasi.html", "/retur-refund.html"]) ok((await call(f)).s === 200, "halaman hukum tersedia: " + f);
  ok(/DRAF-BELUM-DITELAAH/.test((await call("/syarat-ketentuan.html")).t), "halaman hukum masih bertanda DRAF (cek-produksi akan menggagalkan sampai ditelaah)");

  srv.kill(); mtServer.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\nHasil: " + pass + " lulus, " + bad + " gagal");
  if (bad) console.log("\nLog server (ujung):\n" + out.split("\n").slice(-25).join("\n"));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("Tes berhenti karena galat:", e); try { srv.kill(); mtServer.close(); } catch (x) { /* abaikan */ } console.log(out.split("\n").slice(-30).join("\n")); process.exit(2); });
