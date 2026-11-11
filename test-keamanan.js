"use strict";
/*
  Uji keamanan otomatis (K-02, K-03, K-04, K-05, K-06, K-07).
  Jalankan:  node test-keamanan.js
  Memakai database sementara & port acak; tidak menyentuh data.db Anda.
*/
const { spawn } = require("node:child_process");
const os = require("node:os"), fs = require("node:fs"), path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uji-"));
let pass = 0, bad = 0;
const ok = (cond, name) => { cond ? pass++ : bad++; console.log((cond ? "  LULUS  " : "  GAGAL  ") + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function start(port, env) {
  const p = spawn(process.execPath, ["--no-warnings", path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(port), DB_FILE: path.join(tmp, "db" + port + ".db"), ...env }, stdio: ["ignore", "pipe", "pipe"]
  });
  p.out = "";
  p.stdout.on("data", (d) => (p.out += d));
  p.stderr.on("data", (d) => (p.out += d));
  return p;
}
const call = (port, p, opts = {}) => fetch("http://127.0.0.1:" + port + p, opts).then(async (r) => ({ s: r.status, h: r.headers, t: await r.text() }));
const post = (port, p, body, headers = {}) => call(port, p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const linkFrom = (srv, kind) => { const m = [...srv.out.matchAll(new RegExp("#" + kind + "=([\\w-]+)", "g"))]; return m.length ? m[m.length - 1][1] : null; };

(async () => {
  const A = 4101, B = 4102;
  const a = start(A, { AUTH_SECRET: "a".repeat(64), TRUST_PROXY: "1" });
  const b = start(B, { AUTH_SECRET: "b".repeat(64) });
  await wait(1200);
  const PW = "Sandi-Uji-2026x";

  console.log("\nK-02  Berkas rahasia tidak bisa diakses lewat web");
  for (const f of ["/.secret", "/.admin-key", "/data.db", "/server.js", "/.gitignore", "/%2e%2e/server.js", "/..%2fdata.db"])
    ok([403, 404].includes((await call(A, f)).s), "GET " + f + " ditolak");
  const gi = fs.existsSync(path.join(__dirname, ".gitignore")) ? fs.readFileSync(path.join(__dirname, ".gitignore"), "utf8") : "";
  ok([".secret", ".admin-key", "data.db"].every((x) => gi.includes(x)), ".gitignore memuat .secret, .admin-key, data.db");

  console.log("\nK-06  Verifikasi email & reset sandi");
  let r = await post(A, "/api/register", { name: "Penguji Satu", email: "uji1@contoh.id", password: PW, consent: true });
  ok(r.s === 201 && !JSON.parse(r.t).token, "daftar tidak langsung memberi sesi (butuh verifikasi)");
  r = await post(A, "/api/login", { email: "uji1@contoh.id", password: PW });
  ok(r.s === 403 && JSON.parse(r.t).code === "unverified", "login sebelum verifikasi ditolak");
  await wait(200);
  const vt = linkFrom(a, "verify");
  ok(!!vt, "tautan verifikasi dibuat");
  r = await post(A, "/api/verify", { token: vt });
  ok(r.s === 200, "verifikasi dengan tautan benar berhasil");
  r = await post(A, "/api/verify", { token: vt });
  ok(r.s === 400, "tautan verifikasi tidak bisa dipakai dua kali");
  r = await post(A, "/api/login", { email: "uji1@contoh.id", password: PW });
  ok(r.s === 200, "login setelah verifikasi berhasil");
  const tokenA = JSON.parse(r.t).token;

  r = await post(A, "/api/forgot", { email: "uji1@contoh.id" });
  const r2 = await post(A, "/api/forgot", { email: "tidakada@contoh.id" });
  ok(r.s === 200 && r2.s === 200 && JSON.parse(r.t).message === JSON.parse(r2.t).message, "jawaban lupa-sandi sama untuk email terdaftar & tidak terdaftar");
  await wait(200);
  const rt = linkFrom(a, "reset");
  ok(!!rt, "tautan reset dibuat");
  r = await post(A, "/api/reset", { token: rt, password: "lemah" });
  ok(r.s === 400, "reset dengan sandi lemah ditolak");
  const NEW = "Sandi-Baru-2026y";
  r = await post(A, "/api/reset", { token: rt, password: NEW });
  ok(r.s === 200, "reset dengan tautan benar berhasil");
  r = await post(A, "/api/reset", { token: rt, password: "Sandi-Lain-2026z" });
  ok(r.s === 400, "tautan reset tidak bisa dipakai dua kali");
  r = await call(A, "/api/data", { headers: { Authorization: "Bearer " + tokenA } });
  ok(r.s === 401, "sesi lama tidak berlaku setelah reset");
  r = await post(A, "/api/login", { email: "uji1@contoh.id", password: NEW });
  ok(r.s === 200, "login dengan sandi baru berhasil");
  const goodToken = JSON.parse(r.t).token;
  r = await post(A, "/api/reset", { token: "x".repeat(43), password: NEW });
  ok(r.s === 400, "token reset asal-asalan ditolak");

  console.log("\nK-03  Token dari lingkungan lain ditolak");
  await post(B, "/api/register", { name: "Penguji Satu", email: "uji1@contoh.id", password: PW, consent: true });
  await wait(200);
  await post(B, "/api/verify", { token: linkFrom(b, "verify") });
  r = await call(B, "/api/data", { headers: { Authorization: "Bearer " + goodToken } });
  ok(r.s === 401, "token dari server ber-AUTH_SECRET lain ditolak (akun sama persis)");

  console.log("\nK-07  Pengujian keamanan dasar");
  r = await call(A, "/api/data");
  ok(r.s === 401, "/api/data tanpa login ditolak");
  r = await call(A, "/api/data", { headers: { Authorization: "Bearer abc.def" } });
  ok(r.s === 401, "token palsu ditolak");
  const [body] = goodToken.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "uji1@contoh.id", iat: 1, exp: Date.now() + 1e9 })).toString("base64url") + "." + goodToken.split(".")[1];
  r = await call(A, "/api/data", { headers: { Authorization: "Bearer " + forged } });
  ok(r.s === 401, "token yang isinya diubah ditolak");
  const expBody = Buffer.from(JSON.stringify({ sub: "uji1@contoh.id", iat: 1, exp: 2 })).toString("base64url");
  r = await call(A, "/api/data", { headers: { Authorization: "Bearer " + expBody + ".zzzz" } });
  ok(r.s === 401, "token kedaluwarsa ditolak");
  r = await call(A, "/api/data", { headers: { Authorization: "Bearer " + goodToken } });
  ok(r.s === 200 && !/hash|salt|scrypt|secret/i.test(r.t), "respons /api/data tidak memuat hash/salt/rahasia");
  r = await post(A, "/api/register", { name: "<script>alert(1)</script>Budi", email: "xss@contoh.id", password: PW, consent: true });
  await wait(200);
  await post(A, "/api/verify", { token: linkFrom(a, "verify") });
  r = await post(A, "/api/login", { email: "xss@contoh.id", password: PW });
  ok(r.s === 200 && !/[<>]/.test(JSON.parse(r.t).user.name), "nama berisi <script> disaring: " + JSON.parse(r.t).user.name);
  r = await call(A, "/");
  ok(/frame-ancestors 'none'/.test(r.h.get("content-security-policy") || "") && /script-src 'self'/.test(r.h.get("content-security-policy") || ""), "header CSP terpasang (script hanya dari server sendiri)");

  console.log("\nK-05  Pembatas laju membaca IP asli (TRUST_PROXY=1)");
  let blocked = 0;
  for (let i = 0; i < 6; i++) { const x = await post(A, "/api/forgot", { email: "a@b.id" }, { "X-Forwarded-For": "203.0.113.7" }); if (x.s === 429) blocked++; }
  ok(blocked >= 1, "pengunjung 203.0.113.7 kena batas setelah terlalu banyak permintaan");
  r = await post(A, "/api/forgot", { email: "a@b.id" }, { "X-Forwarded-For": "198.51.100.9" });
  ok(r.s === 200, "pengunjung lain (198.51.100.9) tidak ikut terblokir");
  r = await post(A, "/api/forgot", { email: "a@b.id" }, { "X-Forwarded-For": "6.6.6.6, 203.0.113.7" });
  ok(r.s === 429, "IP palsu di kiri X-Forwarded-For tidak bisa dipakai menghindari batas");
  let lock = 0;
  for (let i = 0; i < 7; i++) { const x = await post(A, "/api/login", { email: "uji1@contoh.id", password: "Salah-Terus-1" }); if (x.s === 429) lock++; }
  ok(lock >= 1, "login salah berulang membuat akun terkunci sementara");

  console.log("\nK-04  HTTPS");
  const c = start(4103, { AUTH_SECRET: "c".repeat(64), TRUST_PROXY: "1", FORCE_HTTPS: "1", NODE_ENV: "production", APP_URL: "https://contoh.id", RESEND_API_KEY: "uji", MAIL_FROM: "uji@contoh.id" });
  await wait(1200);
  r = await call(4103, "/", { headers: { "X-Forwarded-Proto": "http" }, redirect: "manual" });
  ok(r.s === 301 && (r.h.get("location") || "").startsWith("https://contoh.id"), "HTTP dialihkan (301) ke HTTPS");
  r = await call(4103, "/", { headers: { "X-Forwarded-Proto": "https" } });
  ok(r.s === 200 && /max-age=/.test(r.h.get("strict-transport-security") || ""), "HTTPS dilayani dengan header HSTS");
  const d = start(4104, { AUTH_SECRET: "pendek", TRUST_PROXY: "1" });
  await wait(800);
  ok(/terlalu pendek/.test(d.out), "AUTH_SECRET pendek ditolak saat server start");

  const e = start(4105, { AUTH_SECRET: "e".repeat(64), NODE_ENV: "production", APP_URL: "https://contoh.id", RESEND_API_KEY: "uji", MAIL_FROM: "uji@contoh.id" });
  await wait(800);
  ok(/TRUST_PROXY/.test(e.out), "produksi tanpa TRUST_PROXY ditolak saat start");
  const f = start(4106, { NODE_ENV: "production", APP_URL: "https://contoh.id", TRUST_PROXY: "1", RESEND_API_KEY: "uji", MAIL_FROM: "uji@contoh.id", AUTH_SECRET: "" });
  await wait(800);
  ok(/AUTH_SECRET wajib/.test(f.out), "produksi tanpa AUTH_SECRET (memakai .secret) ditolak");

  [a, b, c, d, e, f].forEach((p) => p.kill());
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\nHasil: " + pass + " lulus, " + bad + " gagal");
  process.exit(bad ? 1 : 0);
})();