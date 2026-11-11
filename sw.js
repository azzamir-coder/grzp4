/* Service worker Grizlie Nusantara: halaman dan aset tersimpan di perangkat agar buka berikutnya cepat.
   API (/api/*) dan dasbor admin TIDAK pernah disimpan. Naikkan VERSION setiap kali berkas statis berubah. */
const VERSION = "grizlie-v1";
const SHELL = ["/", "/style.css", "/script.min.js", "/manifest.json", "/icon-192.png"];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (e) => {
    const req = e.request, url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== location.origin) return;
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;

    // Halaman: ambil dari jaringan dulu (selalu terbaru), cadangan dari cache bila offline
    if (req.mode === "navigate") {
        e.respondWith(
            fetch(req).then((res) => {
                if (res.ok && url.pathname === "/") caches.open(VERSION).then((c) => c.put("/", res.clone()));
                return res;
            }).catch(() => caches.match("/").then((r) => r || Response.error()))
        );
        return;
    }

    // Aset statis: tampilkan cache lebih dulu, perbarui di latar belakang
    e.respondWith(
        caches.open(VERSION).then((c) =>
            c.match(req).then((hit) => {
                const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
                return hit || net;
            })
        )
    );
});