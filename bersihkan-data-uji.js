"use strict";
/*
  Membersihkan akun & data uji dari database (K-08).
  Aman secara bawaan: tanpa --hapus hanya MENAMPILKAN apa yang akan dihapus.

  Contoh:
    node bersihkan-data-uji.js --simpan=tim@tokoku.com,pemilik@tokoku.com            (simulasi)
    node bersihkan-data-uji.js --simpan=tim@tokoku.com,pemilik@tokoku.com --hapus    (benar-benar hapus)

  Sebelum menghapus, salinan cadangan dibuat otomatis di folder backup/.
  Server sebaiknya dihentikan dulu.
*/
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const arg = (n) => { const a = process.argv.find((x) => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const file = process.env.DB_FILE || path.join(__dirname, "data.db");
const keep = arg("simpan").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const doDelete = process.argv.includes("--hapus");

if (!fs.existsSync(file)) { console.log("File database tidak ditemukan: " + file); process.exit(1); }
if (!keep.length) {
  console.log("Wajib menyebut akun resmi yang DIPERTAHANKAN, contoh:\n  node bersihkan-data-uji.js --simpan=tim@tokoku.com");
  process.exit(1);
}
const db = new DatabaseSync(file);
const users = db.prepare("SELECT email, name, joined FROM users ORDER BY joined").all();
const missing = keep.filter((k) => !users.some((u) => u.email === k));
if (missing.length) { console.log("Email ini ada di --simpan tapi tidak ada di database (periksa ejaan): " + missing.join(", ")); process.exit(1); }

const remove = users.filter((u) => !keep.includes(u.email));
console.log("\nDipertahankan (" + (users.length - remove.length) + "):");
users.filter((u) => keep.includes(u.email)).forEach((u) => console.log("  + " + u.email + "  (" + u.name + ")"));
console.log("\nAkan dihapus (" + remove.length + "):");
remove.forEach((u) => console.log("  - " + u.email + "  (" + u.name + ", daftar " + String(u.joined).slice(0, 10) + ")"));

if (!remove.length) { console.log("\nTidak ada yang perlu dihapus."); process.exit(0); }
if (!doDelete) { console.log("\nIni hanya simulasi. Tambahkan --hapus untuk menjalankan."); process.exit(0); }

fs.mkdirSync(path.join(__dirname, "backup"), { recursive: true });
const backup = path.join(__dirname, "backup", "data-" + new Date().toISOString().replace(/[:.]/g, "-") + ".db");
db.exec("VACUUM INTO '" + backup.replace(/'/g, "''") + "'");
console.log("\nCadangan dibuat: " + backup);

db.exec("PRAGMA foreign_keys = ON; BEGIN");
const del = db.prepare("DELETE FROM users WHERE email = ?"); // user_data & email_tokens ikut terhapus (ON DELETE CASCADE)
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
for (const u of remove) {
  // Data toko milik akun uji (pesanan, ulasan, poin, pendaftaran penjual) ikut dibersihkan
  if (hasTable("orders")) {
    const ids = db.prepare("SELECT id FROM orders WHERE email = ?").all(u.email).map((r) => r.id);
    for (const id of ids) { db.prepare("DELETE FROM order_events WHERE order_id = ?").run(id); db.prepare("DELETE FROM order_items WHERE order_id = ?").run(id); db.prepare("DELETE FROM orders WHERE id = ?").run(id); }
    db.prepare("DELETE FROM reviews WHERE email = ?").run(u.email);
    db.prepare("DELETE FROM user_points WHERE email = ?").run(u.email);
    db.prepare("DELETE FROM sellers WHERE owner_email = ?").run(u.email);
  }
  del.run(u.email);
}
db.exec("COMMIT");
const left = db.prepare("SELECT COUNT(*) n FROM users").get().n;
const orphan = db.prepare("SELECT COUNT(*) n FROM user_data WHERE email NOT IN (SELECT email FROM users)").get().n;
console.log("Selesai. Sisa akun: " + left + ". Data yatim di user_data: " + orphan + ".");
if (hasTable("orders")) {
  const stray = db.prepare("SELECT COUNT(*) n FROM orders WHERE email IS NOT NULL AND email NOT IN (SELECT email FROM users)").get().n;
  console.log("Pesanan yatim: " + stray + ". Catatan: stok produk & hitungan kupon dari pesanan uji TIDAK dikembalikan otomatis; periksa stok dan kupon di dasbor admin.");
}
console.log("Folder backup/ berisi data pribadi: simpan di tempat aman dan jangan di-commit (sudah di .gitignore).");
