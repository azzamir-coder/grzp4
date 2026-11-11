"use strict";
/*
  Menampilkan isi data.db (pengguna, pesanan, poin, wishlist) dengan rapi.
  Jalankan di folder ini:   node lihat-data.js
  Hanya membaca; tidak mengubah data apa pun. Kata sandi tidak ditampilkan.
*/
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const file = process.env.DB_FILE || path.join(__dirname, "data.db");
if (!fs.existsSync(file)) {
  console.log("File data.db belum ada. Jalankan server dulu (node server.js) dan daftar satu akun.");
  process.exit(0);
}
const db = new DatabaseSync(file, { readOnly: true });
const rupiah = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");
const tgl = (s) => (s ? String(s).slice(0, 10) : "-");

const users = db.prepare("SELECT name, email, joined FROM users ORDER BY joined").all();
console.log("\n=== PENGGUNA (" + users.length + " akun) ===");
if (users.length) console.table(users.map((u) => ({ Nama: u.name, Email: u.email, Daftar: tgl(u.joined) })));

let totalOrders = 0, totalRevenue = 0;
console.log("\n=== PESANAN ===");
const orders = db.prepare("SELECT * FROM orders ORDER BY created DESC").all();
for (const o of orders) {
  const items = db.prepare("SELECT qty, name FROM order_items WHERE order_id = ?").all(o.id).map((i) => i.qty + "x " + i.name).join(", ");
  console.log("\n" + o.id + "  " + tgl(o.created) + "  [" + o.status + "]  " + (o.email || "(dihapus)") + "  " + o.city + ", " + o.province + "  " + o.payment_method + "/" + o.payment_status + "  " + rupiah(o.total));
  console.log("     " + items + (o.tracking_no ? "   resi " + o.tracking_no : ""));
  if (["diproses", "dikemas", "dikirim", "selesai"].includes(o.status)) { totalOrders++; totalRevenue += Number(o.total) || 0; }
}
if (!orders.length) console.log("(belum ada pesanan)");
else console.log("\nTotal pesanan aktif: " + totalOrders + "  |  Nilai: " + rupiah(totalRevenue));

console.log("\n=== POIN & WISHLIST ===");
const extra = users.map((u) => {
  const p = db.prepare("SELECT bal FROM user_points WHERE email = ?").get(u.email);
  const w = db.prepare("SELECT value FROM user_data WHERE email = ? AND name = 'wishlist'").get(u.email);
  let n = 0; try { n = w ? JSON.parse(w.value).length : 0; } catch (e) { /* abaikan */ }
  return { Email: u.email, Poin: p ? p.bal : 0, "Jumlah wishlist": n };
});
if (extra.length) console.table(extra);
console.log("");
