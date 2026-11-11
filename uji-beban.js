"use strict";
/*
  Uji beban sederhana (syarat I-06). Hanya MEMBACA (beranda + katalog), tidak membuat pesanan.
  Pakai:  node uji-beban.js --url=https://domainmu.com --pengguna=50 --durasi=30 [--target-p95=800]
  Jalankan dari komputer LAIN (bukan dari server yang diuji) agar hasil realistis, lalu catat hasilnya
  di dokumen uji beban. Bandingkan dengan target pengunjung bersamaan yang ditetapkan tim.
  Jangan menguji situs orang lain. Hanya server milik sendiri.
*/
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : d; };
const url = arg("url", "http://127.0.0.1:3000").replace(/\/+$/, "");
const users = Math.min(500, Math.max(1, Number(arg("pengguna", "20"))));
const secs = Math.min(300, Math.max(3, Number(arg("durasi", "15"))));
const targetP95 = Number(arg("target-p95", "800"));
const paths = ["/", "/api/catalog", "/api/catalog", "/api/health", "/style.css"];
const lat = []; let errs = 0, total = 0; const codes = {};

async function worker(until) {
  while (Date.now() < until) {
    const p = paths[Math.floor(Math.random() * paths.length)];
    const t0 = performance.now();
    try {
      const r = await fetch(url + p, { signal: AbortSignal.timeout(15000) });
      await r.arrayBuffer();
      codes[r.status] = (codes[r.status] || 0) + 1;
      if (r.status >= 500 || r.status === 429) errs++;
    } catch (e) { errs++; codes.galat = (codes.galat || 0) + 1; }
    lat.push(performance.now() - t0); total++;
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 600)); // jeda "berpikir" pengunjung
  }
}
(async () => {
  console.log("Uji beban: " + users + " pengunjung bersamaan selama " + secs + " detik ke " + url);
  const t0 = Date.now(), until = t0 + secs * 1000;
  await Promise.all(Array.from({ length: users }, () => worker(until)));
  const el = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const q = (x) => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * x))] || 0);
  const errRate = total ? (errs / total) * 100 : 0;
  console.log("\nHasil");
  console.log("  Permintaan : " + total + " (" + (total / el).toFixed(1) + " req/detik)");
  console.log("  Latensi ms : p50 " + q(0.5) + " | p95 " + q(0.95) + " | p99 " + q(0.99) + " | maks " + Math.round(lat[lat.length - 1] || 0));
  console.log("  Kode       : " + JSON.stringify(codes));
  console.log("  Galat/429  : " + errs + " (" + errRate.toFixed(2) + "%)");
  const pass = errRate < 1 && q(0.95) <= targetP95;
  console.log("\n" + (pass ? "LULUS" : "BELUM LULUS") + " (syarat: galat < 1% dan p95 <= " + targetP95 + " ms). Catat hasil ini beserta tanggal, spesifikasi server, dan jumlah pengunjung.");
  console.log("Catatan: batas laju per-IP bisa memunculkan 429 bila semua pengunjung uji berasal dari satu IP; itu perilaku perlindungan, bukan kapasitas.");
  process.exit(pass ? 0 : 1);
})();
