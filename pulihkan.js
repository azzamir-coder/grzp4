"use strict";
/*
  Memulihkan dari cadangan (syarat I-03 dan I-07).
  Pakai:
    node pulihkan.js --dari=backup/2026-11-10T03-00-00-000Z            (simulasi: hanya memeriksa)
    node pulihkan.js --dari=backup/2026-11-10T03-00-00-000Z --ya       (benar-benar memulihkan)
  HENTIKAN SERVER lebih dulu. Skrip menolak jalan bila database sedang dipakai.
  Data saat ini TIDAK dihapus: disalin dulu ke "<nama>.sebelum-pulih-<waktu>".
*/
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const arg = (n) => { const a = process.argv.find((x) => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : ""; };
const from = arg("dari"), doIt = process.argv.includes("--ya");
const file = process.env.DB_FILE || path.join(__dirname, "data.db");
const uploads = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
if (!from) { console.log("Wajib: --dari=<folder cadangan>. Contoh: node pulihkan.js --dari=backup/2026-11-10T03-00-00-000Z"); process.exit(1); }
const src = path.resolve(from, "data.db");
if (!fs.existsSync(src)) { console.error("Tidak ada data.db di " + path.resolve(from)); process.exit(1); }

const b = new DatabaseSync(src, { readOnly: true });
if (b.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") { console.error("Cadangan RUSAK (integrity_check gagal). Pilih cadangan lain."); process.exit(2); }
const n = (t) => { try { return b.prepare("SELECT COUNT(*) n FROM " + t).get().n; } catch (e) { return 0; } };
console.log("Cadangan valid: akun " + n("users") + ", pesanan " + n("orders") + ", produk " + n("products"));
b.close();
if (!doIt) { console.log("Ini hanya simulasi. Tambahkan --ya untuk memulihkan (server harus mati)."); process.exit(0); }

// Kunci SQLite tidak andal mendeteksi server yang sedang diam, jadi periksa langsung: apakah server menjawab?
(async () => {
const port = process.env.PORT || 3000;
const alive = await fetch("http://127.0.0.1:" + port + "/api/health", { signal: AbortSignal.timeout(2000) }).then((r) => r.ok || r.status === 503).catch(() => false);
if (alive) { console.error("Server masih hidup di port " + port + ". HENTIKAN server dulu (mis. systemctl stop grizlie), lalu ulangi."); process.exit(3); }
if (fs.existsSync(file)) {
  try { const t = new DatabaseSync(file); t.exec("PRAGMA busy_timeout = 1000; BEGIN EXCLUSIVE; ROLLBACK"); t.close(); }
  catch (e) { console.error("Database sedang dipakai proses lain. Hentikan server dulu, lalu ulangi."); process.exit(3); }
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, file + ".sebelum-pulih-" + stamp + ext);
for (const ext of ["-wal", "-shm"]) fs.rmSync(file + ext, { force: true }); // sisa WAL lama tidak boleh ikut
fs.copyFileSync(src, file);
const srcUp = path.resolve(from, "uploads");
if (fs.existsSync(srcUp)) {
  if (fs.existsSync(uploads)) fs.renameSync(uploads, uploads + ".sebelum-pulih-" + stamp);
  fs.cpSync(srcUp, uploads, { recursive: true });
}
const t = new DatabaseSync(file, { readOnly: true });
const okv = t.prepare("PRAGMA integrity_check").get().integrity_check === "ok";
console.log("Pemulihan selesai. integrity_check: " + (okv ? "ok" : "GAGAL") + ". Data lama disimpan di *.sebelum-pulih-" + stamp + ".");
console.log("Nyalakan server dan periksa: node cek-produksi.js, lalu buka toko dan dasbor admin.");
t.close();
})();
