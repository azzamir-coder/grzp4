"use strict";
/*
  Server Grizlie Nusantara — tanpa dependensi (hanya modul bawaan Node 22.13+).
  - Menyajikan isi folder public/ (index.html, style.css, script.js, admin.html, halaman hukum)
  - Akun: daftar, masuk, ganti kata sandi (hash scrypt + salt acak)
  - Toko (lihat shop.js): katalog, kupon, ongkir, pesanan, pembayaran Midtrans, retur/refund, ulasan, dasbor admin
  - Semua data di SQLite: data.db. Foto produk di folder uploads/ (atau UPLOAD_DIR)
*/
(function checkNode() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error("Node.js " + process.versions.node + " terlalu lama. Dibutuhkan Node 22.13 atau lebih baru (syarat I-04).");
    process.exit(1);
  }
})();
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_FILE = process.env.DB_FILE || path.join(ROOT, "data.db");
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // sama dengan batas sesi di script.js
const MAX_BODY = 512 * 1024;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");
const STARTED = Date.now();
const PROD = process.env.NODE_ENV === "production";
const FORCE_HTTPS = process.env.FORCE_HTTPS === "1" || PROD;
const APP_URL = (process.env.APP_URL || "http://localhost:" + PORT).replace(/\/+$/, "");
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // tautan verifikasi email berlaku 24 jam
const RESET_TTL_MS = 30 * 60 * 1000;       // tautan reset sandi berlaku 30 menit
if (PROD && !/^https:\/\//.test(APP_URL)) { console.error("Di produksi, APP_URL wajib diawali https:// (contoh: https://tokoku.com)."); process.exit(1); }

/* ---------- Rahasia penanda token ---------- */
function loadSecret() {
  if (process.env.AUTH_SECRET) {
    if (process.env.AUTH_SECRET.length < 32) {
      console.error("AUTH_SECRET terlalu pendek (minimal 32 karakter). Buat dengan: openssl rand -hex 32");
      process.exit(1);
    }
    return process.env.AUTH_SECRET;
  }
  if (PROD) {
    console.error("Di produksi, AUTH_SECRET wajib diatur lewat environment (buat baru: openssl rand -hex 32). File .secret hanya untuk pengembangan.");
    process.exit(1);
  }
  const file = path.join(ROOT, ".secret");
  try {
    const s = fs.readFileSync(file, "utf8").trim();
    if (s) return s;
  } catch (e) { /* belum ada */ }
  const s = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

/* ---------- Database ---------- */
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    email         TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    salt          TEXT NOT NULL,
    hash          TEXT NOT NULL,
    joined        TEXT NOT NULL,
    pw_changed    TEXT,
    pw_changed_ms INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS email_tokens (
    hash    TEXT PRIMARY KEY,
    email   TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires INTEGER NOT NULL,
    FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS user_data (
    email   TEXT NOT NULL,
    name    TEXT NOT NULL,
    value   TEXT NOT NULL,
    updated TEXT NOT NULL,
    PRIMARY KEY (email, name),
    FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
  );
`);
try { db.exec("ALTER TABLE users ADD COLUMN consent_at TEXT"); } catch (e) { /* kolom sudah ada */ }
// Migrasi untuk database lama: akun yang sudah ada dianggap terverifikasi
try { db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1"); } catch (e) { /* kolom sudah ada */ }
db.exec("DELETE FROM email_tokens WHERE expires < " + Date.now());
const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  insertUser: db.prepare("INSERT INTO users (email, name, salt, hash, joined, email_verified, consent_at) VALUES (?, ?, ?, ?, ?, 0, ?)"),
  setVerified: db.prepare("UPDATE users SET email_verified = 1 WHERE email = ?"),
  addToken: db.prepare("INSERT INTO email_tokens (hash, email, purpose, expires) VALUES (?, ?, ?, ?)"),
  delTokens: db.prepare("DELETE FROM email_tokens WHERE email = ? AND purpose = ?"),
  takeToken: db.prepare("DELETE FROM email_tokens WHERE hash = ? AND purpose = ? RETURNING email, expires"),
  updatePw: db.prepare("UPDATE users SET salt = ?, hash = ?, pw_changed = ?, pw_changed_ms = ? WHERE email = ?"),
  allData: db.prepare("SELECT name, value FROM user_data WHERE email = ?"),
  upsertData: db.prepare(
    "INSERT INTO user_data (email, name, value, updated) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(email, name) DO UPDATE SET value = excluded.value, updated = excluded.updated"
  )
};

/* ---------- Kata sandi ---------- */
async function derive(password, salt) {
  return (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 })).toString("hex");
}
async function makeHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: await derive(password, salt) };
}
function sameHex(a, b) {
  const x = Buffer.from(String(a), "hex"), y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
async function checkPassword(user, password) {
  // Tetap menghitung hash walau akun tidak ada, supaya waktu respons tidak membocorkan email
  if (!user) { await derive(password, "0000000000000000"); return false; }
  return sameHex(await derive(password, user.salt), user.hash);
}

const COMMON_PW = ["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop", "admin123", "iloveyou", "katasandi", "katasandi1", "indonesia123", "grizlie123", "nusantara123"];
function pwIssue(pw, email) {
  const miss = [];
  if (pw.length < 8) miss.push("minimal 8 karakter");
  if (!/[a-z]/.test(pw)) miss.push("huruf kecil");
  if (!/[A-Z]/.test(pw)) miss.push("huruf besar");
  if (!/\d/.test(pw)) miss.push("angka");
  if (miss.length) return "Kata sandi harus memuat: " + miss.join(", ") + ".";
  if (pw.length > 128) return "Kata sandi maksimal 128 karakter.";
  if (COMMON_PW.includes(pw.toLowerCase())) return "Kata sandi terlalu umum. Pilih yang lebih unik.";
  const local = String(email || "").split("@")[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return "Jangan memakai nama email Anda di dalam kata sandi.";
  return "";
}
const isValidEmail = (v) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const cleanText = (v, max) =>
  String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/* ---------- Token sesi (ditandatangani HMAC-SHA256) ---------- */
function sign(body) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
}
function makeToken(user, iat = Date.now()) {
  const body = Buffer.from(JSON.stringify({ sub: user.email, iat, exp: iat + TOKEN_TTL_MS })).toString("base64url");
  return body + "." + sign(body);
}
function authUser(req) {
  const m = /^Bearer ([\w-]+\.[\w-]+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (e) { return null; }
  if (!p || typeof p.sub !== "string" || !(p.exp > Date.now())) return null;
  const user = q.userByEmail.get(p.sub);
  // Token yang dibuat sebelum kata sandi diganti tidak berlaku lagi
  if (!user || !user.email_verified || p.iat < user.pw_changed_ms) return null;
  return user;
}

/* ---------- Email & tautan sekali pakai ---------- */
// Pengiriman email lewat Resend (https://resend.com), tanpa dependensi. Atur RESEND_API_KEY dan MAIL_FROM.
// Tanpa pengaturan itu (mode pengembangan), isi email dicetak ke terminal.
async function sendMail(to, subject, text) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) {
    if (PROD) console.error("RESEND_API_KEY/MAIL_FROM belum diatur: email ke " + to + " TIDAK terkirim.");
    else console.log("\n[EMAIL → " + to + "] " + subject + "\n" + text + "\n");
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) console.error("Gagal kirim email (" + r.status + ")");
    return r.ok;
  } catch (e) { console.error("Gagal kirim email:", e.message); return false; }
}
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
// Token acak dikirim ke email; yang disimpan di database hanya hash-nya
function issueToken(email, purpose, ttl) {
  const raw = crypto.randomBytes(32).toString("base64url");
  q.delTokens.run(email, purpose);
  q.addToken.run(sha256(raw), email, purpose, Date.now() + ttl);
  return raw;
}
function consumeToken(raw, purpose) {
  if (!/^[\w-]{20,100}$/.test(String(raw || ""))) return null;
  const row = q.takeToken.get(sha256(raw), purpose); // dihapus saat dipakai: sekali pakai
  return row && row.expires > Date.now() ? row.email : null;
}
async function mailVerify(user) {
  const t = issueToken(user.email, "verify", VERIFY_TTL_MS);
  return sendMail(user.email, "Verifikasi email Grizlie Nusantara",
    "Halo " + user.name + ",\n\nBuka tautan ini untuk memverifikasi email Anda (berlaku 24 jam):\n" + APP_URL + "/#verify=" + t +
    "\n\nJika Anda tidak mendaftar, abaikan email ini.");
}
async function mailReset(user) {
  const t = issueToken(user.email, "reset", RESET_TTL_MS);
  return sendMail(user.email, "Atur ulang kata sandi Grizlie Nusantara",
    "Halo " + user.name + ",\n\nBuka tautan ini untuk membuat kata sandi baru (berlaku 30 menit, hanya sekali pakai):\n" + APP_URL + "/#reset=" + t +
    "\n\nJika Anda tidak memintanya, abaikan email ini; kata sandi Anda tidak berubah.");
}

/* ---------- Pembatas percobaan ---------- */
const LOCK = { max: 5, lockMs: 5 * 60 * 1000, windowMs: 15 * 60 * 1000 };
const fails = new Map(); // email -> { n, t, until }
function lockLeft(email) {
  const d = fails.get(email);
  return d && d.until > Date.now() ? d.until - Date.now() : 0;
}
function recordFail(email) {
  const now = Date.now();
  let d = fails.get(email) || { n: 0, t: now, until: 0 };
  if (now - d.t > LOCK.windowMs || (d.until && d.until <= now)) d = { n: 0, t: now, until: 0 };
  d.n += 1; d.t = now;
  let left = LOCK.max - d.n;
  if (left <= 0) { d.until = now + LOCK.lockMs; d.n = 0; left = 0; }
  fails.set(email, d);
  return left;
}
const buckets = new Map(); // "nama:ip" -> [timestamp]
function tooMany(bucket, ip, max, windowMs) {
  const key = bucket + ":" + ip, now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { buckets.set(key, list); return windowMs - (now - list[0]); }
  list.push(now); buckets.set(key, list);
  return 0;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of fails) if (v.until < now && now - v.t > LOCK.windowMs) fails.delete(k);
  for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600e3)) buckets.delete(k);
}, 10 * 60 * 1000).unref();
// TRUST_PROXY = jumlah proxy tepercaya di depan server (1 = satu proxy, mis. Nginx atau hosting).
// IP diambil dari kanan daftar X-Forwarded-For, karena bagian kiri bisa dipalsukan pengunjung.
const PROXY_HOPS = Math.max(0, parseInt(process.env.TRUST_PROXY, 10) || 0);
if (FORCE_HTTPS && PROXY_HOPS === 0) {
  console.error("FORCE_HTTPS/produksi aktif tetapi TRUST_PROXY belum diatur. Tanpa itu alihan HTTP->HTTPS dan pembatas IP tidak bekerja. Atur TRUST_PROXY=1 (satu proxy, mis. Nginx/hosting).");
  process.exit(1);
}
if (PROD && (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)) {
  console.error("Di produksi, RESEND_API_KEY dan MAIL_FROM wajib diatur; tanpa itu email verifikasi & reset sandi tidak terkirim dan tidak ada yang bisa mendaftar.");
  process.exit(1);
}
function clientIp(req) {
  if (PROXY_HOPS > 0) {
    const list = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
    const ip = list[list.length - PROXY_HOPS];
    if (ip) return ip;
  }
  return req.socket.remoteAddress || "?";
}
const fmtWait = (ms) => { const s = Math.ceil(ms / 1000); return s >= 60 ? Math.ceil(s / 60) + " menit" : s + " detik"; };

/* ---------- Validasi data per akun ---------- */
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
// Pesanan dan poin kini dikelola SERVER (shop.js) dan tidak bisa ditulis dari browser.
const DATA_RULES = {
  wishlist: (v) => Array.isArray(v) && v.length <= 500 && v.every((x) => Number.isInteger(x))
};

/* ---------- Helper HTTP ---------- */
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  ...(FORCE_HTTPS ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {})
};
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...SEC_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
const fail = (res, status, message) => send(res, status, { message });
function readJson(req, max) {
  const limit = max || MAX_BODY;
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false; const chunks = [];
    req.on("data", (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > limit) { tooBig = true; chunks.length = 0; reject({ status: 413, message: "Data terlalu besar." }); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        isObj(v) ? resolve(v) : reject({ status: 400, message: "Format data tidak valid." });
      } catch (e) { reject({ status: 400, message: "Format data tidak valid." }); }
    });
    req.on("error", () => reject({ status: 400, message: "Permintaan gagal dibaca." }));
  });
}
const publicUser = (u) => ({ name: u.name, email: u.email });

/* ---------- Log terstruktur & peringatan (I-05) ---------- */
// Satu baris JSON per kejadian supaya mudah dicari di log hosting. ALERT_WEBHOOK_URL (opsional) menerima
// {text, content}: cocok untuk Slack/Discord/relay Telegram. Peringatan dibatasi satu per 10 menit.
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || "";
let lastAlert = 0;
const recent5xx = [];
function sendAlert(text) {
  if (!ALERT_URL || Date.now() - lastAlert < 10 * 60 * 1000) return;
  lastAlert = Date.now();
  fetch(ALERT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "[Grizlie Nusantara] " + text, content: "[Grizlie Nusantara] " + text }), signal: AbortSignal.timeout(8000) }).catch(() => { });
}
function logEvent(level, tag, message) {
  console.error(JSON.stringify({ t: new Date().toISOString(), level, tag, message: String(message).slice(0, 500) }));
  if (level === "error") {
    const now = Date.now();
    recent5xx.push(now);
    while (recent5xx.length && now - recent5xx[0] > 5 * 60 * 1000) recent5xx.shift();
    if (recent5xx.length >= 5) sendAlert("Galat meningkat: " + recent5xx.length + " dalam 5 menit. Terakhir: " + tag + " — " + String(message).slice(0, 150));
  }
}
process.on("uncaughtException", (e) => { logEvent("fatal", "uncaught", e && e.stack || e); sendAlert("Server crash: " + (e && e.message)); setTimeout(() => process.exit(1), 500); });
process.on("unhandledRejection", (e) => { logEvent("error", "unhandledRejection", e && e.stack || e); });

const shop = require("./shop")({ db, send, fail, readJson, authUser, tooMany, fmtWait, sendMail, PROD, APP_URL, cleanText, isObj, UPLOAD_DIR, logEvent });
if (PROD && !shop.gateway) logEvent("error", "config", "MIDTRANS_SERVER_KEY belum diatur: di produksi HANYA metode COD yang tersedia (syarat F-03).");

/* ---------- Rute API ---------- */
async function handleApi(req, res, pathname) {
  const ip = clientIp(req), method = req.method;

  if (pathname === "/api/health" && method === "GET") {
    try {
      db.prepare("SELECT 1").get();
      return send(res, 200, { ok: true, uptime: Math.round((Date.now() - STARTED) / 1000), maintenance: shop.isMaintenance(), gateway: shop.gateway });
    } catch (e) { logEvent("error", "health", e.message); return fail(res, 503, "Database tidak dapat diakses."); }
  }

  if (pathname === "/api/register" && method === "POST") {
    const wait = tooMany("register", ip, 5, 10 * 60 * 1000);
    if (wait) return fail(res, 429, "Terlalu banyak pendaftaran dari perangkat ini. Coba lagi dalam " + fmtWait(wait) + ".");
    const b = await readJson(req);
    const name = cleanText(b.name, 60), email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
    if (name.length < 2) return fail(res, 400, "Nama lengkap wajib diisi (minimal 2 huruf).");
    if (b.consent !== true) return fail(res, 400, "Anda harus menyetujui Syarat & Ketentuan dan Kebijakan Privasi untuk mendaftar.");
    if (!isValidEmail(email)) return fail(res, 400, "Masukkan alamat email yang valid.");
    const issue = pwIssue(password, email);
    if (issue) return fail(res, 400, issue);
    if (q.userByEmail.get(email)) return fail(res, 409, "Email ini sudah terdaftar. Silakan masuk.");
    const { salt, hash } = await makeHash(password);
    try { q.insertUser.run(email, name, salt, hash, new Date().toISOString(), new Date().toISOString()); }
    catch (e) { return fail(res, 409, "Email ini sudah terdaftar. Silakan masuk."); }
    const user = q.userByEmail.get(email);
    await mailVerify(user);
    return send(res, 201, { needsVerification: true, email: user.email });
  }

  if (pathname === "/api/verify" && method === "POST") {
    const wait = tooMany("verify", ip, 20, 10 * 60 * 1000);
    if (wait) return fail(res, 429, "Terlalu banyak percobaan. Coba lagi dalam " + fmtWait(wait) + ".");
    const b = await readJson(req);
    const email = consumeToken(b.token, "verify");
    if (!email) return fail(res, 400, "Tautan verifikasi tidak valid atau sudah kedaluwarsa. Minta tautan baru lewat halaman Masuk.");
    q.setVerified.run(email);
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/resend-verification" && method === "POST") {
    const wait = tooMany("resend", ip, 5, 10 * 60 * 1000);
    if (wait) return fail(res, 429, "Terlalu banyak permintaan. Coba lagi dalam " + fmtWait(wait) + ".");
    const b = await readJson(req);
    const email = String(b.email || "").trim().toLowerCase();
    const u = isValidEmail(email) ? q.userByEmail.get(email) : null;
    if (u && !u.email_verified && !tooMany("resend-to", email, 3, 60 * 60 * 1000)) await mailVerify(u);
    return send(res, 200, { ok: true, message: "Jika email terdaftar dan belum diverifikasi, tautan baru sudah dikirim." });
  }

  if (pathname === "/api/forgot" && method === "POST") {
    const wait = tooMany("forgot", ip, 5, 10 * 60 * 1000);
    if (wait) return fail(res, 429, "Terlalu banyak permintaan. Coba lagi dalam " + fmtWait(wait) + ".");
    const b = await readJson(req);
    const email = String(b.email || "").trim().toLowerCase();
    const u = isValidEmail(email) ? q.userByEmail.get(email) : null;
    if (u && !tooMany("forgot-to", email, 3, 60 * 60 * 1000)) await mailReset(u);
    // Jawaban selalu sama supaya orang lain tidak bisa mengecek email mana yang terdaftar
    return send(res, 200, { ok: true, message: "Jika email terdaftar, tautan untuk membuat kata sandi baru sudah dikirim. Periksa kotak masuk Anda." });
  }

  if (pathname === "/api/reset" && method === "POST") {
    const wait = tooMany("reset", ip, 10, 10 * 60 * 1000);
    if (wait) return fail(res, 429, "Terlalu banyak percobaan. Coba lagi dalam " + fmtWait(wait) + ".");
    const b = await readJson(req);
    const password = String(b.password || "");
    const row = String(b.token || "") && /^[\w-]{20,100}$/.test(String(b.token)) ? q.takeToken.get(sha256(String(b.token)), "reset") : null;
    if (!row || row.expires <= Date.now()) return fail(res, 400, "Tautan reset tidak valid, sudah dipakai, atau sudah kedaluwarsa. Minta tautan baru.");
    const issue = pwIssue(password, row.email);
    if (issue) {
      // Kembalikan token supaya pengguna bisa mencoba kata sandi lain pada tautan yang sama
      q.addToken.run(sha256(String(b.token)), row.email, "reset", row.expires);
      return fail(res, 400, issue);
    }
    const { salt, hash } = await makeHash(password);
    const now = Date.now();
    q.updatePw.run(salt, hash, new Date(now).toISOString(), now, row.email); // semua sesi lama ikut tidak berlaku
    q.setVerified.run(row.email); // menerima email ini membuktikan kepemilikan alamat
    q.delTokens.run(row.email, "reset");
    fails.delete(row.email);
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/login" && method === "POST") {
    const wait = tooMany("login", ip, 30, 10 * 60 * 1000);
    if (wait) return fail(res, 429, "Terlalu banyak percobaan. Coba lagi dalam " + fmtWait(wait) + ".");
    const b = await readJson(req);
    const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
    if (!email || !password || password.length > 128) return fail(res, 400, "Email dan kata sandi wajib diisi.");
    const locked = lockLeft(email);
    if (locked) return fail(res, 429, "Terlalu banyak percobaan gagal. Coba lagi dalam " + fmtWait(locked) + ".");
    const user = q.userByEmail.get(email);
    if (!(await checkPassword(user, password))) {
      const left = recordFail(email);
      if (left <= 0) return fail(res, 429, "Terlalu banyak percobaan gagal. Akun dikunci selama " + fmtWait(LOCK.lockMs) + ".");
      return fail(res, 401, "Email atau kata sandi salah." + (left <= 2 ? " Sisa percobaan: " + left + "." : ""));
    }
    if (!user.email_verified) return send(res, 403, { code: "unverified", message: "Email Anda belum diverifikasi. Buka tautan di email pendaftaran, atau minta tautan baru." });
    fails.delete(email);
    return send(res, 200, { token: makeToken(user), user: publicUser(user) });
  }

  // Rute toko (katalog, pesanan, pembayaran, admin, ulasan, penjual)
  if (await shop.handle(req, res, pathname, ip)) return;

  // Semua rute di bawah ini wajib login
  const user = authUser(req);
  if (!user) return fail(res, 401, "Sesi tidak valid. Silakan masuk lagi.");

  if (pathname === "/api/account/export" && method === "GET") return send(res, 200, shop.exportAccount(user));
  if (pathname === "/api/account" && method === "DELETE") {
    const wait = lockLeft(user.email);
    if (wait) return fail(res, 429, "Terlalu banyak percobaan. Coba lagi dalam " + fmtWait(wait) + ".");
    const b = await readJson(req);
    if (!(await checkPassword(user, String(b.password || "")))) {
      const left = recordFail(user.email);
      return fail(res, left > 0 ? 403 : 429, left > 0 ? "Kata sandi salah." : "Terlalu banyak percobaan gagal.");
    }
    if (shop.isAdmin(user)) return fail(res, 403, "Akun admin tidak bisa dihapus dari sini. Hapus dulu dari ADMIN_EMAILS.");
    const open = db.prepare("SELECT COUNT(*) n FROM orders WHERE email = ? AND status IN ('menunggu_pembayaran','diproses','dikemas','dikirim','retur_diajukan','retur_disetujui')").get(user.email).n;
    const refund = db.prepare("SELECT COUNT(*) n FROM orders WHERE email = ? AND refund_status = 'perlu_refund'").get(user.email).n;
    if (open || refund) return fail(res, 409, "Masih ada pesanan atau refund yang berjalan. Selesaikan atau batalkan dulu sebelum menghapus akun.");
    shop.eraseAccountData(user.email);
    db.prepare("DELETE FROM users WHERE email = ?").run(user.email); // user_data & email_tokens ikut terhapus (CASCADE)
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/data" && method === "GET") {
    const out = { profile: { ...publicUser(user), pwChanged: user.pw_changed || null, admin: shop.isAdmin(user) }, orders: shop.ordersFor(user.email), points: shop.pointsOf(user.email), wishlist: null };
    for (const row of q.allData.all(user.email)) {
      if (row.name in DATA_RULES) { try { out[row.name] = JSON.parse(row.value); } catch (e) { /* abaikan data rusak */ } }
    }
    return send(res, 200, out);
  }

  const m = /^\/api\/data\/([a-z]+)$/.exec(pathname);
  if (m && method === "PUT") {
    const rule = DATA_RULES[m[1]];
    if (!rule) return fail(res, 404, "Jenis data tidak dikenal.");
    const b = await readJson(req);
    if (!rule(b.value)) return fail(res, 400, "Isi data tidak valid.");
    q.upsertData.run(user.email, m[1], JSON.stringify(b.value), new Date().toISOString());
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/password" && method === "POST") {
    const wait = lockLeft(user.email);
    if (wait) return fail(res, 429, "Terlalu banyak percobaan. Coba lagi dalam " + fmtWait(wait) + ".");
    const b = await readJson(req);
    const current = String(b.current || ""), next = String(b.next || "");
    if (!(await checkPassword(user, current))) {
      const left = recordFail(user.email);
      return fail(res, left > 0 ? 403 : 429, left > 0 ? "Kata sandi saat ini salah." : "Terlalu banyak percobaan gagal. Dikunci selama " + fmtWait(LOCK.lockMs) + ".");
    }
    fails.delete(user.email);
    const issue = pwIssue(next, user.email);
    if (issue) return fail(res, 400, issue);
    if (next === current) return fail(res, 400, "Kata sandi baru harus berbeda dari yang lama.");
    const { salt, hash } = await makeHash(next);
    const now = Date.now();
    q.updatePw.run(salt, hash, new Date(now).toISOString(), now, user.email);
    const fresh = q.userByEmail.get(user.email);
    return send(res, 200, { token: makeToken(fresh, now), pwChanged: fresh.pw_changed });
  }

  return fail(res, 404, "Rute tidak ditemukan.");
}

/* ---------- File statis ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"
};
function serveStatic(req, res, pathname, opts) {
  opts = opts || {};
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel.includes("\0")) { res.writeHead(400); return res.end(); }
  let base = PUBLIC_DIR, cache = "no-cache";
  if (rel.startsWith("/media/")) { // foto produk yang diunggah admin (nama file unik, aman di-cache lama)
    base = path.resolve(UPLOAD_DIR); rel = rel.slice(6); cache = "public, max-age=31536000, immutable";
    if (!/^\/[\w.-]+$/.test(rel)) { res.writeHead(404); return res.end("Tidak ditemukan"); }
  }
  if (rel.endsWith("/")) rel += "index.html";
  if (rel === "/admin") rel = "/admin.html";
  if (opts.file) rel = opts.file;
  const file = path.normalize(path.join(base, rel));
  const inside = file === base || file.startsWith(base + path.sep);
  const hidden = path.relative(base, file).split(path.sep).some((p) => p.startsWith("."));
  if (!inside || hidden) { res.writeHead(404); return res.end("Tidak ditemukan"); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Tidak ditemukan"); }
    res.writeHead(opts.status || 200, {
      ...SEC_HEADERS,
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": opts.status ? "no-store" : cache,
      ...(opts.status === 503 ? { "Retry-After": "600" } : {}),
      ...(rel.startsWith("/admin") ? { "X-Robots-Tag": "noindex, nofollow" } : {})
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
// Rute yang tetap hidup saat mode pemeliharaan: kesehatan, masuk, admin, dan webhook pembayaran yang sedang berjalan
const MAINT_OPEN = /^\/(api\/(health|login|admin\/|payments\/)|admin(\.html|\.js)?$)/;

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  try {
    if (FORCE_HTTPS && pathname !== "/api/health" && PROXY_HOPS > 0) {
      const xf = String(req.headers["x-forwarded-proto"] || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (xf[xf.length - PROXY_HOPS] === "http") {
        res.writeHead(301, { Location: APP_URL + req.url });
        return res.end();
      }
    }
    if (shop.isMaintenance() && !MAINT_OPEN.test(pathname)) {
      if (pathname.startsWith("/api/")) return send(res, 503, { maintenance: true, message: "Toko sedang dalam pemeliharaan. Coba lagi beberapa saat lagi." });
      return serveStatic(req, res, "/", { file: "/maintenance.html", status: 503 });
    }
    if (pathname === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: " + APP_URL + "/sitemap.xml\n");
    }
    if (pathname === "/sitemap.xml") {
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
      return res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + shop.sitemapPaths().map((u) => "<url><loc>" + APP_URL + u + "</loc></url>").join("\n") + "\n</urlset>\n");
    }
    if (pathname.startsWith("/api/")) await handleApi(req, res, pathname);
    else serveStatic(req, res, pathname);
  } catch (e) {
    if (e && e.status) {
      if (e.status === 413) res.setHeader("Connection", "close");
      return fail(res, e.status, e.message);
    }
    logEvent("error", "request", pathname + " — " + (e && e.stack || e));
    if (!res.headersSent) fail(res, 500, "Terjadi kesalahan di server.");
  }
});
server.listen(PORT, () => console.log("Grizlie Nusantara berjalan di http://localhost:" + PORT));