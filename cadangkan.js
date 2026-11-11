"use strict";
/*
  Cadangan basis data + foto produk (syarat I-03).
  Pakai:   node cadangkan.js [--ke=backup] [--simpan=14]
  - Aman dijalankan SAAT server hidup: memakai VACUUM INTO, hasilnya satu file data.db utuh
    (isi -wal sudah tergabung, jadi TIDAK perlu menyalin -shm/-wal terpisah).
  - Cadangan langsung diperiksa (PRAGMA integrity_check) sebelum dianggap berhasil.
  - Menyimpan N cadangan terbaru, sisanya dihapus.
  Jadwalkan lewat cron (lihat RUNBOOK.md), misalnya setiap 6 jam.
  Salin folder backup/ ke tempat LAIN (bucket/komputer lain). Cadangan di disk yang sama tidak menolong bila disk rusak.
*/
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : d; };
const file = process.env.DB_FILE || path.join(__dirname, "data.db");
const uploads = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const root = path.resolve(arg("ke", path.join(__dirname, "backup")));
const keep = Math.max(1, Number(arg("simpan", "14")) || 14);

if (!fs.existsSync(file)) { console.error("File database tidak ditemukan: " + file); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(root, stamp);
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, "data.db");

const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 10000");
db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
db.close();

const chk = new DatabaseSync(target, { readOnly: true });
const ok = chk.prepare("PRAGMA integrity_check").get().integrity_check === "ok";
const n = (t) => { try { return chk.prepare("SELECT COUNT(*) n FROM " + t).get().n; } catch (e) { return "-"; } };
const counts = { users: n("users"), orders: n("orders"), products: n("products") };
chk.close();
if (!ok) { console.error("GAGAL: cadangan tidak lolos integrity_check. Folder dibiarkan untuk diperiksa: " + dir); process.exit(2); }

let photos = 0;
if (fs.existsSync(uploads)) { fs.cpSync(uploads, path.join(dir, "uploads"), { recursive: true }); photos = fs.readdirSync(path.join(dir, "uploads")).length; }
fs.chmodSync(target, 0o600);

const all = fs.readdirSync(root).filter((d) => /^\d{4}-\d\d-\d\dT/.test(d)).sort();
for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(root, old), { recursive: true, force: true });

console.log("Cadangan berhasil: " + dir);
console.log("  akun " + counts.users + ", pesanan " + counts.orders + ", produk " + counts.products + ", foto " + photos + " | integrity_check: ok");
console.log("  Cadangan tersimpan: " + Math.min(all.length, keep) + " (maks " + keep + "). Jangan lupa menyalinnya ke tempat lain; berisi data pribadi.");
