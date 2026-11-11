(function () {
  "use strict";
  // Anti-clickjacking: halaman tidak boleh dimuat di dalam iframe situs lain
  if (window.top !== window.self) {
    try { window.top.location.href = window.self.location.href; }
    catch (e) { document.documentElement.style.display = "none"; }
  }
  const CATEGORIES = [
    { id: "batik", name: "Batik & Tenun", icon: "🧵", desc: "Kain tulis, cap, dan tenun ikat daerah", bg: "#1F2C7A", fg: "#B7C1FF" },
    { id: "kopi", name: "Kopi Nusantara", icon: "☕", desc: "Biji dan bubuk kopi dari dataran tinggi", bg: "#4B3126", fg: "#E2BE9B" },
    { id: "kerajinan", name: "Kerajinan Tangan", icon: "🪵", desc: "Ukiran, anyaman, dan logam khas daerah", bg: "#C99A45", fg: "#FFF3D6" },
    { id: "kuliner", name: "Kuliner Khas", icon: "🍱", desc: "Camilan dan makanan olahan kampung halaman", bg: "#D8492B", fg: "#FFE0D3" },
    { id: "rempah", name: "Rempah & Herbal", icon: "🌿", desc: "Bumbu dapur dan jamu tradisional", bg: "#2E6A4C", fg: "#C4EBD3" },
    { id: "fashion", name: "Fashion Tradisional", icon: "👘", desc: "Busana adat bergaya modern sehari-hari", bg: "#8B2C5E", fg: "#F6CBE0" }
  ];
  // Katalog, harga, stok, kupon, dan tarif berasal dari SERVER (/api/catalog), bukan dari file ini.
  let PRODUCTS = [];
  let CFG = { freeMin: 300000, couriers: [], provinces: [], payments: ["COD"], codMax: 1000000, returnDays: 7, simulatePay: false };
  const COUPONS = {};
  let catalogError = "";
  let coupon = null;
  let shipQuote = null; // { fee } dari /shipping/quote saat checkout
  function calcTotals() {
    const subtotal = cartSubtotal();
    let discount = 0;
    if (coupon && !COUPONS[coupon]) coupon = null;
    const free = subtotal > 0 && subtotal >= CFG.freeMin;
    let shipping = subtotal === 0 ? 0 : free ? 0 : shipQuote ? shipQuote.fee : null;
    let c = coupon ? COUPONS[coupon] : null;
    if (c && ((c.min && subtotal < c.min) || (c.pts && getPts().bal < c.pts))) { coupon = null; c = null; }
    if (c && subtotal > 0) {
      if (c.type === "pct") discount = Math.round((subtotal * c.v) / 100);
      if (c.type === "flat") discount = Math.min(c.v, subtotal);
      if (c.type === "ship" && shipping != null) shipping = 0;
    }
    return { subtotal, shipping, shippingKnown: shipping != null, discount, total: subtotal - discount + (shipping || 0) };
  }
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  function formatRupiah(n) {
    return "Rp" + n.toLocaleString("id-ID");
  }
  function starString(rating) {
    const full = Math.round(rating);
    return "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
  }
  function mediaHTML(p) {
    return p.image ? `<img class="product-img" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async">` : `<span class="tile-icon" aria-hidden="true">${p.icon}</span>`;
  }
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function isValidEmail(value) {
    return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  function showToast(message, action) {
    const container = $("#toastContainer");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", () => { action.fn(); el.remove(); });
      el.appendChild(btn);
      el.style.animation = "toastIn 0.25s ease, toastOut 0.25s ease 5.95s forwards";
    }
    container.appendChild(el);
    setTimeout(() => el.remove(), action ? 6200 : 3200);
  }
  function showFormError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }
  function hideFormError(el) {
    if (el) el.hidden = true;
  }
  function categoryById(id) {
    return CATEGORIES.find((c) => c.id === id);
  }
  function motifSvg(id, fg) {
    const stroke = `stroke="${fg}" stroke-opacity=".55" stroke-width="1.5"`;
    const fill = `fill="${fg}" fill-opacity=".3"`;
    const motifs = {
      batik: `<g fill="none" ${stroke}><ellipse cx="20" cy="10" rx="6" ry="10"/><ellipse cx="20" cy="30" rx="6" ry="10"/><ellipse cx="10" cy="20" rx="10" ry="6"/><ellipse cx="30" cy="20" rx="10" ry="6"/></g>`,
      kopi: `<g fill="none" ${stroke} transform="rotate(-30 20 20)"><ellipse cx="20" cy="20" rx="7" ry="11"/><path d="M20 9C14 16 26 24 20 31"/></g>`,
      kerajinan: `<rect width="20" height="20" ${fill}/><rect x="20" y="20" width="20" height="20" ${fill}/><path d="M0 20H40M20 0V40" fill="none" ${stroke}/>`,
      kuliner: `<path d="M0 40L10 22L20 40Z M20 40L30 22L40 40Z" ${fill}/><circle cx="10" cy="9" r="2" fill="${fg}" fill-opacity=".5"/><circle cx="30" cy="9" r="2" fill="${fg}" fill-opacity=".5"/>`,
      rempah: `<path d="M20 35C9 29 9 13 20 6C31 13 31 29 20 35ZM20 35V14" fill="none" ${stroke}/>`,
      fashion: `<g fill="none" ${stroke}><path d="M0 12Q10 0 20 12T40 12"/><path d="M0 32Q10 20 20 32T40 32"/></g>`
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${motifs[id] || ""}</svg>`;
  }

  function injectTileStyles() {
    const css = CATEGORIES.map(
      (c) =>
        `.tile-${c.id}{background-color:${c.bg};background-image:url("data:image/svg+xml,${encodeURIComponent(motifSvg(c.id, c.fg))}");}`
    ).join("\n");
    const style = document.createElement("style");
    style.id = "tileStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }
  const STORE_KEYS = {
    currentUser: "nm_current_user",
    cart: "nm_cart",
    wishlist: "nm_wishlist",
    ordersPrefix: "nm_orders_"
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
    }
    syncUp(key, value);
  }

  /* ===== Server: akun & sinkronisasi data ke server (lihat server.js) ===== */
  const TOKEN_KEY = "nm_token";
  let authToken = null;
  try { authToken = localStorage.getItem(TOKEN_KEY); } catch (e) { }
  let serverProfile = null; // { name, email, pwChanged } dari server
  const pendingSync = {}, syncTimers = {};
  let lastSyncWarn = 0;

  // Semua panggilan ke server lewat sini. Selalu mengembalikan { ok, status, data }
  async function api(path, opts) {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = "Bearer " + authToken;
    try {
      const res = await fetch("/api" + path, Object.assign({}, opts, { headers }));
      let data = {};
      try { data = await res.json(); } catch (e) { }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { message: "Tidak bisa terhubung ke server. Pastikan server berjalan." } };
    }
  }
  // Data milik akun yang ikut disimpan di server: pesanan, poin, wishlist
  function syncName(key) {
    const email = state.currentUser && state.currentUser.email;
    if (!email) return null;
    if (key === STORE_KEYS.wishlist) return "wishlist";
    return null;
  }
  function syncUp(key, value) {
    if (!authToken) return;
    let name = null;
    try { name = syncName(key); } catch (e) { return; } // state belum siap
    if (!name) return;
    pendingSync[name] = { value };
    clearTimeout(syncTimers[name]);
    syncTimers[name] = setTimeout(() => sendSync(name, false), 400);
  }
  function sendSync(name, keep) {
    const item = pendingSync[name];
    if (!item || !authToken) return;
    delete pendingSync[name];
    clearTimeout(syncTimers[name]);
    api("/data/" + name, { method: "PUT", body: JSON.stringify({ value: item.value }), keepalive: !!keep }).then((r) => {
      if (r.status === 401) return handleExpiredToken();
      if (!r.ok && Date.now() - lastSyncWarn > 30000) {
        lastSyncWarn = Date.now();
        showToast("Perubahan belum tersimpan ke server. Periksa koneksi Anda.");
      }
    });
  }
  function flushSync() { Object.keys(pendingSync).forEach((n) => sendSync(n, true)); }
  window.addEventListener("pagehide", flushSync);
  function clearToken() {
    authToken = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { }
    Object.keys(pendingSync).forEach((n) => { delete pendingSync[n]; clearTimeout(syncTimers[n]); });
  }
  function handleExpiredToken() {
    if (!state.currentUser) return;
    clearToken();
    logout("Sesi berakhir. Silakan masuk lagi.");
  }
  function setSession(data) {
    authToken = data.token;
    try { localStorage.setItem(TOKEN_KEY, authToken); } catch (e) { }
    const now = Date.now();
    state.currentUser = { name: data.user.name, email: data.user.email, at: now, last: now };
    persistCurrentUser();
  }
  // Ambil data akun dari server ke localStorage. fresh=true: baru masuk (gabungkan wishlist lokal)
  async function pullUserData(fresh) {
    const email = state.currentUser && state.currentUser.email;
    if (!email || !authToken) return "none";
    const r = await api("/data");
    if (!r.ok) return r.status === 401 ? "expired" : "error";
    const d = r.data || {};
    serverProfile = d.profile || null;
    const put = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { } };
    const ptsK = ptsKey(email);
    // Pesanan & poin dikelola server: hanya dibaca di sini. Wishlist dua arah.
    ordersCache = Array.isArray(d.orders) ? d.orders : [];
    if (d.points && typeof d.points === "object") put(ptsK, d.points);
    const remote = Array.isArray(d.wishlist) ? d.wishlist : null;
    const base = remote ? (fresh ? remote.concat(state.wishlist) : remote) : state.wishlist;
    state.wishlist = Array.from(new Set(base)).filter((id) => Number.isInteger(id) && PRODUCTS.some((p) => p.id === id));
    persistWishlist();
    if (fresh) { updateWishlistBadge(); renderProducts(); renderWishlistDrawer(); }
    return "ok";
  }

  async function loadCatalog() {
    const r = await api("/catalog");
    if (!r.ok) { catalogError = r.data.message || "Katalog belum bisa dimuat. Muat ulang halaman."; return false; }
    catalogError = "";
    const d = r.data;
    PRODUCTS = (d.products || []).map((p) => Object.assign(p, { island: islandOf(p.region) }));
    CFG = Object.assign({}, CFG, d.shipping || {}, { payments: d.payments || ["COD"], codMax: d.codMax, returnDays: d.returnDays, simulatePay: !!d.simulatePay });
    Object.keys(COUPONS).forEach((k) => delete COUPONS[k]);
    (d.coupons || []).forEach((c) => { COUPONS[c.code] = { type: c.type, v: c.v, min: c.min, pts: c.pts, label: c.label }; });
    // Buang produk yang sudah tidak ada dari keranjang dan wishlist, dan batasi qty ke stok
    state.cart = state.cart.filter((i) => PRODUCTS.some((p) => p.id === i.id));
    state.cart.forEach((i) => { const p = PRODUCTS.find((x) => x.id === i.id); if (p && i.qty > p.stock) i.qty = Math.max(1, p.stock); });
    state.cart = state.cart.filter((i) => PRODUCTS.find((x) => x.id === i.id).stock > 0);
    state.wishlist = state.wishlist.filter((id) => PRODUCTS.some((p) => p.id === id));
    persistCart(); persistWishlist();
    return true;
  }
  // Data terstruktur agar Google bisa menampilkan harga dan rating produk
  function renderStructuredData() {
    if (!PRODUCTS.length) return;
    const abs = (u) => { try { return new URL(u, location.origin).href; } catch (e) { return undefined; } };
    const data = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: PRODUCTS.slice(0, 30).map((p, i) => ({
        "@type": "ListItem", position: i + 1,
        item: Object.assign({
          "@type": "Product", name: p.name, description: p.desc, image: p.image ? abs(p.image) : undefined,
          category: (categoryById(p.category) || {}).name,
          url: location.origin + location.pathname + "#produk-" + p.id,
          offers: { "@type": "Offer", price: p.price, priceCurrency: "IDR", availability: "https://schema.org/" + (p.stock > 0 ? "InStock" : "OutOfStock") }
        }, p.reviews ? { aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.reviews } } : {})
      }))
    };
    let el = $("#ldProducts");
    if (!el) { el = document.createElement("script"); el.type = "application/ld+json"; el.id = "ldProducts"; document.head.appendChild(el); }
    el.textContent = JSON.stringify(data);
  }
  function renderStoreFacts() {
    renderStructuredData();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
    set("#statProduk", PRODUCTS.length);
    set("#statKategori", new Set(PRODUCTS.map((p) => p.category)).size || 6);
    set("#statProvinsi", (CFG.provinces || []).length || 38);
    const bar = $("#announceBar");
    if (bar) {
      const cs = Object.entries(COUPONS).filter(([, v]) => !v.pts);
      bar.innerHTML = "Gratis ongkir untuk belanja di atas " + formatRupiah(CFG.freeMin) + "." +
        (cs.length ? " Pakai kode <strong>" + escapeHtml(cs[0][0]) + "</strong> (" + escapeHtml(cs[0][1].label) + ")." : "");
    }
  }
  function refreshCatalogUI() {
    renderStoreFacts();
    renderProducts(); renderFlash(); renderViewed(); updateCartBadge(); renderCartDrawer(); updateWishlistBadge();
  }
  // Dipanggil sekali sebelum halaman pertama kali digambar (DIPERBARUI)
  async function bootstrapServer() {
    if (!state.currentUser) { if (authToken) clearToken(); return; }
    if (!authToken) { state.currentUser = null; persistCurrentUser(); return; } // sesi lama tanpa server
    const res = await pullUserData(false);
    if (res === "expired") { clearToken(); state.currentUser = null; persistCurrentUser(); }
    else if (res === "ok") {
      updateWishlistBadge();
      renderProducts();
      renderWishlistDrawer();
    }
  }

  /* ===== Keamanan: konstanta & helper ===== */
  const SEC = {
    idleMs: 15 * 60 * 1000,
    warnMs: 60 * 1000,
    maxSessionMs: 8 * 60 * 60 * 1000,
    maxQty: 20
  };
  const COMMON_PW = ["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop", "admin123", "iloveyou", "katasandi", "katasandi1", "indonesia123", "grizlie123", "nusantara123"];
  const SUSPECT_SHOP = /(https?:|www\.|\.com\b|\.co\.id|\.id\b|wa\.me|t\.me|bit\.ly|@|\b(judi|slot|togel|casino|pinjol)\b)/i;
  let pendingSellerAfterLogin = 0;

  function cleanText(value, max) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function fmtWait(ms) {
    const sec = Math.ceil(ms / 1000);
    return sec >= 60 ? Math.ceil(sec / 60) + " menit" : sec + " detik";
  }
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
  function pwScore(pw, email) {
    if (!pw) return 0;
    if (pwIssue(pw, email)) return 1;
    let s = 2;
    if (pw.length >= 12) s++;
    if (pw.length >= 10 && /[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(4, s);
  }
  function throttleLeft(key, max, windowMs) {
    const now = Date.now(), list = loadJSON(key, []).filter((t) => now - t < windowMs);
    return list.length >= max ? windowMs - (now - list[0]) : 0;
  }
  function throttleHit(key, windowMs) {
    const now = Date.now(), list = loadJSON(key, []).filter((t) => now - t < windowMs);
    list.push(now);
    saveJSON(key, list);
  }
  function loadCart() {
    const raw = loadJSON(STORE_KEYS.cart, []), seen = new Set(), out = [];
    (Array.isArray(raw) ? raw : []).forEach((i) => {
      if (!i || !Number.isInteger(i.id) || seen.has(i.id)) return;
      seen.add(i.id);
      out.push({ id: i.id, qty: Math.min(SEC.maxQty, Math.max(1, Math.floor(Number(i.qty)) || 1)) });
    });
    return out;
  }
  function loadWishlist() {
    const raw = loadJSON(STORE_KEYS.wishlist, []);
    return Array.from(new Set((Array.isArray(raw) ? raw : []).filter((id) => Number.isInteger(id))));
  }
  function loadSession() {
    const u = loadJSON(STORE_KEYS.currentUser, null);
    if (!u || typeof u.email !== "string" || typeof u.name !== "string") return null;
    const now = Date.now();
    const s = { name: cleanText(u.name, 60), email: u.email, at: Number(u.at) || now, last: Number(u.last) || now };
    return now - s.last > SEC.idleMs || now - s.at > SEC.maxSessionMs ? null : s;
  }
  const state = {
    currentUser: loadSession(),
    cart: loadCart(),
    wishlist: loadWishlist(),
    activeCategory: "all",
    searchQuery: ""
  };
  saveJSON(STORE_KEYS.currentUser, state.currentUser);
  function persistCurrentUser() { saveJSON(STORE_KEYS.currentUser, state.currentUser); }
  function persistCart() { saveJSON(STORE_KEYS.cart, state.cart); }
  function persistWishlist() { saveJSON(STORE_KEYS.wishlist, state.wishlist); }
  let ordersCache = [];
  function getOrders() { return ordersCache; }
  const openLayers = [];
  let lastFocused = null;
  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (openLayers.length === 0) lastFocused = document.activeElement;
    if (!openLayers.includes(id)) openLayers.push(id);
    el.classList.add("active");
    el.setAttribute("aria-hidden", "false");
    $("#overlay")?.classList.add("active");
    document.body.classList.add("no-scroll");
    const focusTarget =
      el.querySelector("form:not([hidden]) input, form:not([hidden]) textarea") ||
      el.querySelector(".modal-close");
    setTimeout(() => focusTarget?.focus({ preventScroll: true }), 60);
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove("active");
      el.setAttribute("aria-hidden", "true");
    }
    const idx = openLayers.indexOf(id);
    if (idx >= 0) openLayers.splice(idx, 1);
    if (id === "productModal" && /^#produk-\d+$/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);

    if (openLayers.length === 0) {
      $("#overlay")?.classList.remove("active");
      document.body.classList.remove("no-scroll");
      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus({ preventScroll: true });
      }
      lastFocused = null;
    }
  }
  function closeAllModalsAndDrawers() {
    openLayers.slice().forEach(closeModal);
  }
  function trapFocus(event) {
    if (event.key !== "Tab" || openLayers.length === 0) return;
    const layer = document.getElementById(openLayers[openLayers.length - 1]);
    if (!layer) return;
    const focusables = $$(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      layer
    ).filter((node) => node.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function renderCategories() {
    const grid = $("#categoryGrid");
    if (grid) {
      grid.innerHTML = CATEGORIES.map((category, i) => {
        const count = PRODUCTS.filter((p) => p.category === category.id).length;
        return `
        <button class="category-card tile tile-${category.id}" data-category="${category.id}" style="--i:${i}" aria-label="${escapeHtml(category.name)}, ${count} produk">
          <span class="cat-icon" aria-hidden="true">${category.icon}</span>
          <span class="cat-label"><strong>${escapeHtml(category.name)}</strong><small>${count} produk</small></span>
        </button>`;
      }).join("");
    }
    const pillsWrap = $("#categoryPills");
    if (pillsWrap) {
      pillsWrap.innerHTML =
        `<button class="pill active" data-category="all">Semua</button>` +
        CATEGORIES.map(
          (category) => `<button class="pill" data-category="${category.id}">${escapeHtml(category.name)}</button>`
        ).join("");
    }
  }
  function scrollToProducts() {
    document.getElementById("produk")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function setActiveCategory(categoryId) {
    state.activeCategory = categoryId;
    $$("#categoryPills .pill").forEach((pill) =>
      pill.classList.toggle("active", pill.getAttribute("data-category") === categoryId)
    );
    renderProducts();
  }
  function resetFilters() {
    state.searchQuery = "";
    state.collection = null;
    const collTag = $("#collTag");
    if (collTag) collTag.hidden = true;
    const island = $("#islandSelect");
    if (island) island.value = "all";
    ["#ratingOnly", "#saleOnly"].forEach((sel) => { const c = $(sel); if (c) c.checked = false; });
    const searchInput = $("#globalSearchInput");
    if (searchInput) searchInput.value = "";
    const priceSelect = $("#priceSelect");
    if (priceSelect) priceSelect.value = "all";
    const sortSelect = $("#sortSelect");
    if (sortSelect) sortSelect.value = "rekomendasi";
    setActiveCategory("all");
  }
  function getFilteredSortedProducts() {
    let list = PRODUCTS.slice();

    if (state.activeCategory !== "all") {
      list = list.filter((p) => p.category === state.activeCategory);
    }
    if (state.collection) list = list.filter(state.collection.fn);
    if (state.searchQuery) {
      const q = state.searchQuery;
      list = list.filter((p) => {
        const cat = categoryById(p.category);
        return (
          p.name.toLowerCase().includes(q) ||
          p.region.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          (cat && cat.name.toLowerCase().includes(q))
        );
      });
    }
    const priceSelect = $("#priceSelect");
    if (priceSelect && priceSelect.value !== "all") {
      const [min, max] = priceSelect.value.split("-").map(Number);
      list = list.filter((p) => p.price >= min && p.price <= max);
    }
    const sortSelect = $("#sortSelect");
    if (sortSelect) {
      const sortVal = sortSelect.value;
      if (sortVal === "harga-asc") list.sort((a, b) => a.price - b.price);
      else if (sortVal === "harga-desc") list.sort((a, b) => b.price - a.price);
      else if (sortVal === "rating") list.sort((a, b) => b.rating - a.rating);
      else if (sortVal === "terlaris") list.sort((a, b) => b.sold - a.sold);
    }

    const isl = $("#islandSelect")?.value;
    if (isl && isl !== "all") list = list.filter((p) => p.island === isl);
    if ($("#ratingOnly")?.checked) list = list.filter((p) => p.rating >= 4.7);
    if ($("#saleOnly")?.checked) list = list.filter((p) => p.oldPrice);
    if ($("#sortSelect")?.value === "terbaru") list.sort((a, b) => (b.badge === "Baru") - (a.badge === "Baru") || b.id - a.id);
    return list;
  }
  function renderProducts() {
    const list = getFilteredSortedProducts();
    const grid = $("#productGrid");
    const empty = $("#emptyState");
    if (!grid) return;
    if (list.length === 0) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = list.map(cardHTML).join("");
  }
  function cardHTML(p) {
    const isWished = state.wishlist.includes(p.id);
    return `
        <article class="product-card" data-id="${p.id}">
          <div class="product-media tile tile-${p.category}">
            ${p.oldPrice ? `<span class="product-badge sale">Diskon ${Math.round((1 - p.price / p.oldPrice) * 100)}%</span>` : p.badge ? `<span class="product-badge">${escapeHtml(p.badge)}</span>` : ""}
            <button class="cmp-btn ${cmp.includes(p.id) ? "active" : ""}" data-cmp="${p.id}" aria-pressed="${cmp.includes(p.id)}">${cmp.includes(p.id) ? "✓ Dipilih" : "⇄ Bandingkan"}</button>
            <button class="wish-btn ${isWished ? "active" : ""}" data-wish="${p.id}" aria-pressed="${isWished}" aria-label="${isWished ? "Hapus dari wishlist" : "Simpan ke wishlist"}">${isWished ? "♥" : "♡"}</button>
            ${mediaHTML(p)}
          </div>
          <div class="product-info">
            <button class="product-name" data-open="${p.id}">${escapeHtml(p.name)}</button>
            <span class="product-region">${escapeHtml(p.region)}${stockTag(p)}</span>
            ${p.reviews ? `<span class="product-rating"><span class="stars" aria-hidden="true">${starString(p.rating)}</span> ${p.rating.toFixed(1)} (${p.reviews})</span>` : `<span class="product-rating muted">Belum ada ulasan</span>`}
            <div class="product-bottom">
              <span class="product-price">${p.oldPrice ? `<s>${formatRupiah(p.oldPrice)}</s>` : ""}${formatRupiah(p.price)}</span>
              <button class="add-cart-btn" data-add="${p.id}" ${p.stock === 0 ? "disabled" : ""} aria-label="Tambah ${escapeHtml(p.name)} ke keranjang">+</button>
            </div>
          </div>
        </article>`;
  }
  function onProductGridClick(event) {
    const cmpBtn = event.target.closest("[data-cmp]");
    if (cmpBtn) { event.stopPropagation(); toggleCompare(Number(cmpBtn.getAttribute("data-cmp"))); return; }
    const wishBtn = event.target.closest("[data-wish]");
    if (wishBtn) {
      event.stopPropagation();
      toggleWishlist(Number(wishBtn.getAttribute("data-wish")));
      return;
    }
    const addBtn = event.target.closest("[data-add]");
    if (addBtn) {
      event.stopPropagation();
      addToCart(Number(addBtn.getAttribute("data-add")), 1);
      return;
    }
    const card = event.target.closest(".product-card");
    if (card) openProductDetail(Number(card.getAttribute("data-id")));
  }
  function openProductDetail(id) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return;
    let qty = 1;
    const isWished = state.wishlist.includes(p.id);
    const category = categoryById(p.category);
    const body = $("#productModalBody");
    if (!body) return;
    body.innerHTML = `
      <div class="product-detail">
        <div class="product-detail-media tile tile-${p.category}">${mediaHTML(p)}</div>
        <div class="product-detail-info">
          <span class="product-region">${escapeHtml(p.region)}${category ? ` — ${escapeHtml(category.name)}` : ""}</span>
          <h2 id="productModalTitle">${escapeHtml(p.name)}</h2>
          <span class="product-rating">${p.reviews ? `<span class="stars" aria-hidden="true">${starString(p.rating)}</span> ${p.rating.toFixed(1)} dari ${p.reviews} ulasan` : "Belum ada ulasan"}${p.sold ? `, ${p.sold} terjual` : ""}</span>
          <p class="product-detail-desc">${escapeHtml(p.desc)}</p>
          <span class="product-price product-price-lg">${p.oldPrice ? `<s>${formatRupiah(p.oldPrice)}</s>` : ""}${formatRupiah(p.price)}</span>
          <div class="qty-stepper">
            <button type="button" id="qtyMinus" aria-label="Kurangi jumlah">−</button>
            <span id="qtyValue">1</span>
            <button type="button" id="qtyPlus" aria-label="Tambah jumlah">+</button>
          </div>
          <div class="product-detail-actions">
            <button class="btn btn-primary" id="detailAddCart">Tambah ke keranjang</button>
            <button class="btn btn-outline" id="detailWish">${isWished ? "♥ Tersimpan" : "♡ Simpan"}</button>
            <a class="btn btn-ghost" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent("Lihat " + p.name + " di Grizlie Nusantara")}">Bagikan</a>
          </div>
        </div>
      </div>
      <div class="reviews">
        <h3>Ulasan pembeli</h3>
        <div id="revList"><p class="muted">Memuat ulasan…</p></div>
      </div>
      <div class="related"><h3>Produk serupa</h3><div class="related-row">${PRODUCTS.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 3).map((r) => `<button class="related-item" data-rel="${r.id}"><span class="tile tile-${r.category}"><span class="tile-icon">${r.icon}</span></span><b>${escapeHtml(r.name)}</b><small>${formatRupiah(r.price)}</small></button>`).join("")}</div></div>
    `;
    $$("[data-rel]", body).forEach((b) => b.addEventListener("click", () => openProductDetail(Number(b.dataset.rel))));
    $("#qtyMinus")?.addEventListener("click", () => {
      qty = Math.max(1, qty - 1);
      $("#qtyValue").textContent = qty;
    });
    $("#qtyPlus")?.addEventListener("click", () => {
      qty = Math.min(20, qty + 1);
      $("#qtyValue").textContent = qty;
    });
    $("#detailAddCart")?.addEventListener("click", () => addToCart(p.id, qty));
    $("#detailWish")?.addEventListener("click", (e) => {
      toggleWishlist(p.id);
      e.currentTarget.textContent = state.wishlist.includes(p.id) ? "♥ Tersimpan" : "♡ Simpan";
    });
    trackViewed(p.id);
    history.replaceState(null, "", "#produk-" + id);
    $(".qty-stepper", body)?.insertAdjacentHTML("afterend", `<small class="stock-line ${p.stock <= 5 ? "low" : ""}">${p.stock === 0 ? "Stok habis" : p.stock <= 5 ? "Stok tinggal " + p.stock : "Stok tersedia " + p.stock}</small>`);
    if (!p.stock) $("#detailAddCart", body)?.setAttribute("disabled", "");
    bindShipCheck(body, p);
    $(".product-detail-actions", body)?.insertAdjacentHTML("beforeend", `<button class="btn btn-ghost" id="copyLink" type="button">Salin tautan</button>`);
    $("#copyLink", body)?.addEventListener("click", async () => {
      const url = location.href.split("#")[0] + "#produk-" + id;
      try {
        if (navigator.share) await navigator.share({ title: p.name, url });
        else { await navigator.clipboard.writeText(url); showToast("Tautan produk disalin."); }
      } catch (e) { }
    });
    renderUgc(p, body);
    openModal("productModal");
  }
  // Cek ongkir langsung dari halaman produk (memakai endpoint /shipping/quote yang sudah ada)
  const shipPref = { province: "", courier: "" };
  function bindShipCheck(body, p) {
    if (!p.stock || !(CFG.provinces || []).length || !(CFG.couriers || []).length) return;
    const opt = (v, label, sel) => `<option value="${escapeHtml(v)}"${sel ? " selected" : ""}>${escapeHtml(label)}</option>`;
    const box = document.createElement("div");
    box.className = "ship-check";
    box.innerHTML = `<b>Cek ongkir</b><div class="ship-check-row">
      <select aria-label="Provinsi tujuan"><option value="">Pilih provinsi</option>${CFG.provinces.map((v) => opt(v, v, v === shipPref.province)).join("")}</select>
      <select aria-label="Kurir">${CFG.couriers.map((c, i) => opt(c.id, c.name, shipPref.courier ? c.id === shipPref.courier : i === 0)).join("")}</select></div>
      <output class="ship-check-out" aria-live="polite"></output>`;
    $(".product-detail-actions", body)?.before(box);
    const [prov, cour] = $$("select", box), out = $("output", box);
    let seq = 0;
    const run = async () => {
      shipPref.province = prov.value; shipPref.courier = cour.value;
      if (!prov.value) { out.textContent = ""; return; }
      const mine = ++seq;
      out.textContent = "Menghitung…";
      const r = await api("/shipping/quote", { method: "POST", body: JSON.stringify({ items: [{ id: p.id, qty: 1 }], province: prov.value, courier: cour.value }) });
      if (mine !== seq) return;
      out.textContent = r.ok
        ? `Ongkir ke ${prov.value}: ${r.data.shipping ? formatRupiah(r.data.shipping) : "Gratis"} untuk 1 barang. Gratis ongkir untuk belanja di atas ${formatRupiah(CFG.freeMin)}.`
        : r.data.message || "Ongkir belum bisa dihitung.";
    };
    prov.addEventListener("change", run);
    cour.addEventListener("change", run);
    if (prov.value) run();
  }
  function toggleWishlist(id) {
    const idx = state.wishlist.indexOf(id);
    if (idx >= 0) {
      state.wishlist.splice(idx, 1);
      showToast("Dihapus dari wishlist.");
    } else {
      state.wishlist.push(id);
      showToast("Ditambahkan ke wishlist.");
    }
    persistWishlist();
    updateWishlistBadge();
    renderProducts();
    renderFlash();
    renderViewed();
    renderWishlistDrawer();
  }
  function updateWishlistBadge() {
    const badge = $("#wishlistBadge");
    if (!badge) return;
    if (state.wishlist.length > 0) {
      badge.textContent = state.wishlist.length;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
  function renderWishlistDrawer() {
    const body = $("#wishlistBody");
    if (!body) return;
    const items = state.wishlist.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
    if (items.length === 0) {
      body.innerHTML = `<p class="empty-state">Wishlist masih kosong. Ketuk ikon hati pada produk untuk menyimpannya.</p>`;
      return;
    }
    body.innerHTML = items
      .map(
        (p) => `
        <div class="wishlist-item">
          <div class="wishlist-item-media tile tile-${p.category}"><span class="tile-icon" aria-hidden="true">${p.icon}</span></div>
          <div class="wishlist-item-info">
            <h4>${escapeHtml(p.name)}</h4>
            <span class="product-price">${formatRupiah(p.price)}</span>
            <div class="wishlist-actions">
              <button class="btn btn-primary btn-sm" data-wish-add="${p.id}">+ Keranjang</button>
              <button class="btn btn-outline btn-sm" data-wish-remove="${p.id}">Hapus</button>
            </div>
          </div>
        </div>`
      )
      .join("");
  }
  function onWishlistBodyClick(event) {
    const addBtn = event.target.closest("[data-wish-add]");
    if (addBtn) {
      addToCart(Number(addBtn.getAttribute("data-wish-add")), 1);
      return;
    }
    const removeBtn = event.target.closest("[data-wish-remove]");
    if (removeBtn) toggleWishlist(Number(removeBtn.getAttribute("data-wish-remove")));
  }
  function openWishlist() {
    renderWishlistDrawer();
    openModal("wishlistDrawer");
  }
  function addToCart(id, qty) {
    qty = Math.floor(Number(qty));
    const sp = PRODUCTS.find((x) => x.id === id);
    if (!sp || !(qty >= 1 && qty <= SEC.maxQty)) return;
    const have = (state.cart.find((i) => i.id === id) || { qty: 0 }).qty;
    if (have + qty > SEC.maxQty) { showToast("Maksimal " + SEC.maxQty + " buah per produk."); return; }
    if (sp && have + qty > sp.stock) { showToast(sp.stock ? "Stok hanya tersisa " + sp.stock + "." : "Stok habis."); return; }
    const existing = state.cart.find((item) => item.id === id);
    if (existing) existing.qty += qty;
    else state.cart.push({ id, qty });
    persistCart();
    updateCartBadge();
    renderCartDrawer();
    showToast("Produk ditambahkan ke keranjang.");
  }
  function updateCartQty(id, qty) {
    const item = state.cart.find((i) => i.id === id);
    if (!item) return;
    const sp = PRODUCTS.find((x) => x.id === id);
    qty = Math.min(SEC.maxQty, Math.floor(Number(qty)) || 0);
    if (sp && qty > sp.stock) { showToast("Stok hanya tersisa " + sp.stock + "."); qty = sp.stock; }
    item.qty = qty;
    if (item.qty <= 0) state.cart = state.cart.filter((i) => i.id !== id);
    persistCart();
    updateCartBadge();
    renderCartDrawer();
  }
  function removeFromCart(id) {
    const at = state.cart.findIndex((i) => i.id === id);
    const gone = state.cart[at];
    if (gone) showToast("Produk dihapus dari keranjang.", {
      label: "Urungkan", fn: () => {
        if (state.cart.some((i) => i.id === id)) return;
        state.cart.splice(Math.min(at, state.cart.length), 0, gone);
        persistCart(); updateCartBadge(); renderCartDrawer();
      }
    });
    state.cart = state.cart.filter((i) => i.id !== id);
    persistCart();
    updateCartBadge();
    renderCartDrawer();
  }
  function cartTotalQty() {
    return state.cart.reduce((sum, i) => sum + i.qty, 0);
  }
  function cartSubtotal() {
    return state.cart.reduce((sum, i) => {
      const p = PRODUCTS.find((x) => x.id === i.id);
      return sum + (p ? p.price * i.qty : 0);
    }, 0);
  }
  function updateCartBadge() {
    const total = cartTotalQty();
    ["#cartBadge", "#bnBadge"].forEach((sel) => {
      const badge = $(sel);
      if (!badge) return;
      badge.textContent = total;
      badge.hidden = !total;
    });
  }
  function couponChips() {
    const chips = Object.entries(COUPONS)
      .filter(([, v]) => !v.pts || getPts().bal >= v.pts)
      .map(([code, v]) => {
        const note = v.min ? "Min. " + formatRupiah(v.min) : v.pts ? v.pts + " poin" : "Tanpa minimum";
        return `<button type="button" class="vchip ${coupon === code ? "on" : ""}" data-vc="${escapeHtml(code)}"><b>${escapeHtml(v.label)}</b><small>${escapeHtml(note)}</small></button>`;
      });
    return chips.length ? `<div class="vchips">${chips.join("")}</div>` : "";
  }
  function renderCartDrawer() {
    const body = $("#cartBody");
    const foot = $("#cartFoot");
    if (!body || !foot) return;

    if (state.cart.length === 0) {
      body.innerHTML = `<p class="empty-state">Keranjang masih kosong. Pilih produk favorit Anda dulu.</p>`;
      foot.innerHTML = "";
      return;
    }
    body.innerHTML = state.cart
      .map((item) => {
        const p = PRODUCTS.find((x) => x.id === item.id);
        if (!p) return "";
        return `
          <div class="cart-item">
            <div class="cart-item-media tile tile-${p.category}">${mediaHTML(p)}</div>
            <div class="cart-item-info">
              <h4>${escapeHtml(p.name)}</h4>
              <span class="cart-item-price">${formatRupiah(p.price)}</span>
              <div class="cart-item-row">
                <div class="qty-stepper">
                  <button type="button" data-dec="${p.id}" aria-label="Kurangi jumlah">−</button>
                  <span>${item.qty}</span>
                  <button type="button" data-inc="${p.id}" aria-label="Tambah jumlah">+</button>
                </div>
                <button class="cart-item-remove" data-remove="${p.id}">Hapus</button>
              </div>
            </div>
          </div>`;
      })
      .join("");
    const t = calcTotals();
    const left = Math.max(0, CFG.freeMin - t.subtotal);
    const pct = Math.min(100, Math.round((t.subtotal / CFG.freeMin) * 100));
    body.insertAdjacentHTML("afterbegin", `<div class="ship-bar"><p>${left ? `Belanja ${formatRupiah(left)} lagi untuk gratis ongkir` : "Selamat, ongkir Anda gratis!"}</p><div class="ship-track"><span style="width:${pct}%"></span></div></div>`);
    foot.innerHTML = `
      <form class="coupon" id="couponForm"><input id="couponInput" placeholder="Kode kupon" aria-label="Kode kupon" value="${coupon || ""}"><button class="btn btn-outline btn-sm" type="submit">Pakai</button></form>
      ${couponChips()}
      <div class="cart-summary-row"><span>Subtotal</span><span>${formatRupiah(t.subtotal)}</span></div>
      ${t.discount ? `<div class="cart-summary-row disc"><span>Diskon kupon</span><span>−${formatRupiah(t.discount)}</span></div>` : ""}
      <div class="cart-summary-row"><span>Ongkos kirim</span><span>${!t.shippingKnown ? "Dihitung saat checkout" : t.shipping ? formatRupiah(t.shipping) : "Gratis"}</span></div>
      <div class="cart-summary-row total"><span>Total</span><span>${formatRupiah(t.total)}</span></div>
      <button class="btn btn-primary btn-block" id="checkoutBtn">Lanjut ke pembayaran</button>
    `;
  }
  function onCartBodyClick(event) {
    const inc = event.target.closest("[data-inc]");
    const dec = event.target.closest("[data-dec]");
    const remove = event.target.closest("[data-remove]");

    if (inc) {
      const id = Number(inc.getAttribute("data-inc"));
      const item = state.cart.find((i) => i.id === id);
      if (item) updateCartQty(id, item.qty + 1);
    } else if (dec) {
      const id = Number(dec.getAttribute("data-dec"));
      const item = state.cart.find((i) => i.id === id);
      if (item) updateCartQty(id, item.qty - 1);
    } else if (remove) {
      removeFromCart(Number(remove.getAttribute("data-remove")));
    }
  }
  function openCart() {
    renderCartDrawer();
    openModal("cartDrawer");
  }
  function renderAuthArea() {
    const area = $("#authArea");
    if (!area) return;
    if (!state.currentUser) {
      area.innerHTML = `<button class="btn btn-outline btn-sm" id="loginOpenBtn">Masuk</button>`;
      $("#loginOpenBtn")?.addEventListener("click", () => {
        switchAuthTab("login");
        openModal("authModal");
      });
      return;
    }
    const initial = state.currentUser.name.trim().charAt(0).toUpperCase() || "?";
    const pts = getPts();
    area.innerHTML = `
      <div class="user-area">
        <button class="user-chip" id="userChip" aria-haspopup="true" aria-expanded="false">
          <span class="user-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
          <span>${escapeHtml(state.currentUser.name.split(" ")[0])}</span>
        </button>
        <div class="user-menu" id="userMenu">
          <div class="reward-chip"><b>${pts.bal} poin</b><span>Level ${tierOf(pts.life)[0]}</span></div>
          <button id="menuOrders">Pesanan saya</button>
          <button id="menuWishlist">Wishlist</button>
          <button id="menuSecurity">Keamanan akun</button>
          <button id="menuLogout">Keluar</button>
          ${serverProfile && serverProfile.admin ? `<a class="menu-link" href="/admin">Dasbor admin</a>` : ""}
        </div>
      </div>`;

    const chip = $("#userChip");
    const menu = $("#userMenu");
    chip?.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = menu?.classList.toggle("open");
      chip.setAttribute("aria-expanded", String(Boolean(open)));
    });
    $("#menuOrders")?.addEventListener("click", () => openOrders());
    $("#menuWishlist")?.addEventListener("click", openWishlist);
    $("#menuSecurity")?.addEventListener("click", openAccountSecurity);
    $("#menuLogout")?.addEventListener("click", logout);
  }
  async function login(email, password) {
    const r = await api("/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!r.ok) return { ok: false, unverified: r.data.code === "unverified", message: r.data.message || "Gagal masuk. Coba lagi." };
    setSession(r.data);
    await pullUserData(true);
    return { ok: true };
  }
  async function register(name, email, password) {
    const r = await api("/register", { method: "POST", body: JSON.stringify({ name, email, password, consent: true }) });
    if (!r.ok) return { ok: false, message: r.data.message || "Pendaftaran gagal. Coba lagi." };
    return { ok: true, needsVerification: true };
  }
  function logout(reason) {
    if (authToken) flushSync();
    clearToken();
    state.currentUser = null;
    if (coupon && COUPONS[coupon] && COUPONS[coupon].pts) coupon = null;
    ordersCache = [];
    persistCurrentUser();
    ["ordersModal", "checkoutModal", "accountSecModal"].forEach((id) => { if (openLayers.includes(id)) closeModal(id); });
    renderAuthArea();
    renderCartDrawer();
    showToast(typeof reason === "string" ? reason : "Anda telah keluar.");
  }
  function switchAuthTab(tab) {
    $$(".auth-tab").forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === tab));
    const loginForm = $("#loginForm");
    const regForm = $("#registerForm");
    if (loginForm) loginForm.hidden = tab !== "login";
    if (regForm) regForm.hidden = tab !== "register";
    const fg = $("#forgotForm"), rs = $("#resetForm");
    if (fg) fg.hidden = tab !== "forgot";
    if (rs) rs.hidden = tab !== "reset";
    const tabs = $(".auth-tabs");
    if (tabs) tabs.hidden = tab === "forgot" || tab === "reset";
    const rh = $("#resendHint"); if (rh) rh.hidden = true;
    ["#loginError", "#registerError", "#forgotError", "#resetError"].forEach((id) => hideFormError($(id)));
  }
  let pendingCheckoutAfterLogin = false;
  function afterAuthSuccess() {
    closeModal("authModal");
    renderAuthArea();
    if (pendingSellerAfterLogin && Date.now() - pendingSellerAfterLogin < 120000) openModal("sellerModal");
    pendingSellerAfterLogin = 0;
    if (pendingCheckoutAfterLogin) {
      pendingCheckoutAfterLogin = false;
      handleCheckoutStart();
    }
  }
  async function onLoginSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const errorEl = $("#loginError");

    if (!isValidEmail(email)) {
      showFormError(errorEl, "Masukkan alamat email yang valid.");
      return;
    }
    if (!password) {
      showFormError(errorEl, "Kata sandi wajib diisi.");
      return;
    }
    const result = await login(email, password);
    if (!result.ok) {
      showFormError(errorEl, result.message);
      const rh = $("#resendHint");
      if (rh) { rh.hidden = !result.unverified; rh.dataset.email = email; }
      return;
    }
    hideFormError(errorEl);
    form.reset();
    showToast("Berhasil masuk. Selamat berbelanja!");
    afterAuthSuccess();
  }
  async function onRegisterSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const name = cleanText(data.get("name"), 60);
    const email = String(data.get("email") || "").trim().toLowerCase();
    const password = String(data.get("password") || "");
    const confirm = String(data.get("confirm") || "");
    const errorEl = $("#registerError");
    if (data.get("website")) return;
    if (!data.get("consent")) { showFormError(errorEl, "Centang persetujuan Syarat & Ketentuan dan Kebijakan Privasi untuk mendaftar."); return; }
    const wait = throttleLeft("nm_reg_log", 3, 10 * 60 * 1000);
    if (wait > 0) {
      showFormError(errorEl, "Terlalu banyak pendaftaran dari perangkat ini. Coba lagi dalam " + fmtWait(wait) + ".");
      return;
    }
    if (name.length < 2) {
      showFormError(errorEl, "Nama lengkap wajib diisi (minimal 2 huruf).");
      return;
    }
    if (!isValidEmail(email)) {
      showFormError(errorEl, "Masukkan alamat email yang valid.");
      return;
    }
    const pwProblem = pwIssue(password, email);
    if (pwProblem) {
      showFormError(errorEl, pwProblem);
      return;
    }
    if (password !== confirm) {
      showFormError(errorEl, "Konfirmasi kata sandi tidak cocok.");
      return;
    }
    throttleHit("nm_reg_log", 10 * 60 * 1000);
    const result = await register(name, email, password);
    if (!result.ok) {
      showFormError(errorEl, result.message);
      return;
    }
    hideFormError(errorEl);
    form.reset();
    renderPwMeter($("#regPwMeter"), $("#regPwHint"), "");
    switchAuthTab("login");
    const li = $("#loginForm [name=email]"); if (li) li.value = email;
    showFormError($("#loginError"), "Pendaftaran berhasil. Kami mengirim tautan verifikasi ke " + email + ". Buka email itu dulu, lalu masuk di sini.");
    const rh = $("#resendHint"); if (rh) { rh.hidden = false; rh.dataset.email = email; }
    showToast("Cek email Anda untuk verifikasi.");
  }
  async function onForgotSubmit(e) {
    e.preventDefault();
    const errorEl = $("#forgotError");
    const email = String(new FormData(e.target).get("email") || "").trim();
    if (!isValidEmail(email)) return showFormError(errorEl, "Masukkan alamat email yang valid.");
    const r = await api("/forgot", { method: "POST", body: JSON.stringify({ email }) });
    if (!r.ok) return showFormError(errorEl, r.data.message || "Permintaan gagal. Coba lagi.");
    e.target.reset();
    showFormError(errorEl, r.data.message);
  }
  let resetToken = "";
  async function onResetSubmit(e) {
    e.preventDefault();
    const errorEl = $("#resetError"), d = new FormData(e.target);
    const pw = String(d.get("password") || ""), conf = String(d.get("confirm") || "");
    if (pw !== conf) return showFormError(errorEl, "Konfirmasi kata sandi tidak cocok.");
    const r = await api("/reset", { method: "POST", body: JSON.stringify({ token: resetToken, password: pw }) });
    if (!r.ok) return showFormError(errorEl, r.data.message || "Gagal mengatur ulang kata sandi.");
    resetToken = "";
    e.target.reset();
    switchAuthTab("login");
    showToast("Kata sandi berhasil diganti. Silakan masuk.");
  }
  async function handleEmailLink() {
    const m = /^#(verify|reset)=([\w-]{20,100})$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    if (m[1] === "verify") {
      const r = await api("/verify", { method: "POST", body: JSON.stringify({ token: m[2] }) });
      switchAuthTab("login");
      openModal("authModal");
      if (r.ok) showToast("Email terverifikasi. Silakan masuk.");
      else showFormError($("#loginError"), r.data.message || "Verifikasi gagal.");
    } else {
      resetToken = m[2];
      switchAuthTab("reset");
      openModal("authModal");
    }
  }
  function handleCheckoutStart() {
    if (state.cart.length === 0) {
      showToast("Keranjang masih kosong.");
      return;
    }
    if (!state.currentUser) {
      pendingCheckoutAfterLogin = true;
      switchAuthTab("login");
      openModal("authModal");
      closeModal("cartDrawer");
      showToast("Masuk dulu untuk melanjutkan checkout.");
      return;
    }
    renderCheckoutForm();
    openModal("checkoutModal");
    closeModal("cartDrawer");
  }

  function renderCheckoutForm() {
    shipQuote = null;
    const body = $("#checkoutModalBody");
    if (!body) return;
    const PAY_LABEL = { "Transfer Bank": "Transfer Bank / Virtual Account", "E-Wallet": "E-Wallet (GoPay / ShopeePay)", "COD": "Bayar di Tempat (COD)" };
    body.innerHTML = `
      <h2 id="checkoutModalTitle">Selesaikan pesanan</h2>
      <form id="checkoutForm" novalidate>
        <div class="checkout-grid">
          <label>Nama penerima
            <input type="text" name="recipient" required autocomplete="name" value="${escapeHtml(state.currentUser.name)}">
          </label>
          <label>No. telepon
            <input type="tel" name="phone" required autocomplete="tel" placeholder="08xxxxxxxxxx">
          </label>
        </div>
        <label>Alamat lengkap
          <textarea name="address" rows="2" required autocomplete="street-address" placeholder="Jalan, nomor rumah, RT/RW"></textarea>
        </label>
        <div class="checkout-grid">
          <label>Kota / Kabupaten
            <input type="text" name="city" required placeholder="Contoh: Surabaya">
          </label>
          <label>Kode pos
            <input type="text" name="postal" required inputmode="numeric" placeholder="Contoh: 60123">
          </label>
        </div>
        <label>Provinsi
          <select name="province" required>
            <option value="">Pilih provinsi</option>
            ${(CFG.provinces || []).map((pv) => `<option>${escapeHtml(pv)}</option>`).join("")}
          </select>
        </label>
        <fieldset class="payment-fieldset">
          <legend>Kurir</legend>
          <div class="payment-options">
            ${(CFG.couriers || []).map((c, i) => `<label class="payment-option"><input type="radio" name="courier" value="${escapeHtml(c.id)}" ${i === 0 ? "checked" : ""}> ${escapeHtml(c.name)}</label>`).join("")}
          </div>
        </fieldset>
        <fieldset class="payment-fieldset">
          <legend>Metode pembayaran</legend>
          <div class="payment-options">
            ${(CFG.payments || ["COD"]).map((m, i) => `<label class="payment-option"><input type="radio" name="payment" value="${escapeHtml(m)}" ${i === 0 ? "checked" : ""}> ${escapeHtml(PAY_LABEL[m] || m)}</label>`).join("")}
          </div>
        </fieldset>
        <div id="coSummary"></div>
        <p class="form-error" id="checkoutError" hidden></p>
        <button type="submit" class="btn btn-primary btn-block" id="checkoutSubmit">Buat pesanan</button>
      </form>
    `;
    const form = $("#checkoutForm");
    const renderSummary = () => {
      const t = calcTotals();
      $("#coSummary").innerHTML = `
        <div class="cart-summary-row"><span>Subtotal</span><span>${formatRupiah(t.subtotal)}</span></div>
        <div class="cart-summary-row"><span>Ongkos kirim</span><span>${t.shippingKnown ? (t.shipping ? formatRupiah(t.shipping) : "Gratis") : "Pilih provinsi"}</span></div>
        ${t.discount ? `<div class="cart-summary-row disc"><span>Diskon kupon</span><span>−${formatRupiah(t.discount)}</span></div>` : ""}
        <div class="cart-summary-row total"><span>Total bayar</span><span>${formatRupiah(t.total)}${t.shippingKnown ? "" : " + ongkir"}</span></div>`;
    };
    let quoteSeq = 0;
    const requote = async () => {
      const fd = new FormData(form), seq = ++quoteSeq;
      shipQuote = null; renderSummary();
      if (!fd.get("province") || !fd.get("courier")) return;
      const r = await api("/shipping/quote", { method: "POST", body: JSON.stringify({ items: state.cart.map((i) => ({ id: i.id, qty: i.qty })), province: fd.get("province"), courier: fd.get("courier") }) });
      if (seq !== quoteSeq) return;
      if (r.ok) shipQuote = { fee: r.data.shipping };
      else showFormError($("#checkoutError"), r.data.message || "Ongkos kirim belum bisa dihitung.");
      renderSummary();
    };
    form.addEventListener("change", (e) => { if (e.target.name === "province" || e.target.name === "courier") { hideFormError($("#checkoutError")); requote(); } });
    renderSummary();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const errorEl = $("#checkoutError"), btn = $("#checkoutSubmit");
      if (!state.currentUser) { closeModal("checkoutModal"); showToast("Sesi Anda berakhir. Silakan masuk lagi."); return; }
      const recipient = cleanText(data.get("recipient"), 60), address = cleanText(data.get("address"), 200), city = cleanText(data.get("city"), 50);
      const phone = String(data.get("phone") || "").trim().slice(0, 20), postal = String(data.get("postal") || "").trim().slice(0, 5);
      if (!recipient || !phone || !address || !city || !postal || !data.get("province")) return showFormError(errorEl, "Lengkapi semua data pengiriman terlebih dahulu, termasuk provinsi.");
      if (!/^(\+62|62|0)8[0-9]{7,12}$/.test(phone.replace(/[\s-]/g, ""))) return showFormError(errorEl, "Nomor telepon tidak valid. Contoh: 081234567890.");
      if (!/^[0-9]{5}$/.test(postal)) return showFormError(errorEl, "Kode pos harus 5 digit angka.");
      hideFormError(errorEl);
      btn.disabled = true; btn.textContent = "Memproses…";
      const r = await api("/orders", {
        method: "POST", body: JSON.stringify({
          items: state.cart.map((i) => ({ id: i.id, qty: i.qty })), coupon: coupon || undefined,
          recipient, phone, address, city, postal, province: data.get("province"), courier: data.get("courier"), payment: data.get("payment")
        })
      });
      btn.disabled = false; btn.textContent = "Buat pesanan";
      if (r.status === 401) return handleExpiredToken();
      if (!r.ok) {
        showFormError(errorEl, r.data.message || "Pesanan gagal dibuat. Coba lagi.");
        if (r.status === 409 || r.status === 400) { await loadCatalog(); refreshCatalogUI(); }
        return;
      }
      state.cart = []; coupon = null; shipQuote = null;
      persistCart(); updateCartBadge(); renderCartDrawer();
      if (r.data.points) saveJSON("nm_points_" + state.currentUser.email, r.data.points);
      await loadCatalog(); refreshCatalogUI(); renderAuthArea();
      renderOrderSuccess(r.data.order);
    });
  }
  const safeHttps = (u) => (/^https:\/\//i.test(String(u || "")) ? String(u) : "");
  const dateID = (iso) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  function renderOrderSuccess(order) {
    const body = $("#checkoutModalBody");
    if (!body) return;
    const pay = order.status === "menunggu_pembayaran";
    const url = safeHttps(order.payUrl);
    body.innerHTML = `
      <div class="order-success">
        <div class="check-circle" aria-hidden="true">✓</div>
        <h2 id="checkoutModalTitle">Pesanan dibuat</h2>
        <p>Nomor pesanan <strong>${escapeHtml(order.id)}</strong><br>Total ${formatRupiah(order.total)} · ${escapeHtml(order.payment)} · ${escapeHtml(order.courier)}</p>
        ${pay ? `<p>Selesaikan pembayaran dalam ${Math.round(((order.expires || Date.now()) - Date.now()) / 3600000)} jam, atau pesanan dibatalkan otomatis dan stok dikembalikan.</p>
          ${url ? `<a class="btn btn-primary btn-block" href="${escapeHtml(url)}" rel="noopener">Bayar sekarang</a>` : CFG.simulatePay ? `<button class="btn btn-primary btn-block" id="simPay" data-id="${escapeHtml(order.id)}">Simulasikan pembayaran (mode pengembangan)</button>` : `<p class="muted">Tautan pembayaran belum tersedia. Hubungi kami dengan nomor pesanan di atas.</p>`}`
        : `<p>Pesanan sedang diproses. Bayar di tempat saat barang tiba.</p>`}
        <p class="muted">Poin dikreditkan setelah pesanan selesai. Konfirmasi dikirim ke email Anda.</p>
        <button class="btn btn-ghost btn-block" id="viewOrdersBtn">Lihat pesanan saya</button>
      </div>`;
    $("#viewOrdersBtn")?.addEventListener("click", () => { closeModal("checkoutModal"); openOrders(); });
    $("#simPay")?.addEventListener("click", async (e) => {
      const r = await api("/orders/" + e.target.dataset.id + "/simulate-pay", { method: "POST", body: "{}" });
      if (!r.ok) return showToast(r.data.message || "Gagal.");
      closeModal("checkoutModal"); openOrders();
    });
    if (typeof confetti === "function") confetti();
  }

  /* ---------- Pesanan (dari server) ---------- */
  const STATUS_LABEL = { menunggu_pembayaran: "Menunggu pembayaran", diproses: "Diproses", dikemas: "Dikemas", dikirim: "Dikirim", selesai: "Selesai", dibatalkan: "Dibatalkan", retur_diajukan: "Retur diajukan", retur_disetujui: "Retur disetujui", dikembalikan: "Dikembalikan" };
  const TRACK_STEPS = ["diproses", "dikemas", "dikirim", "selesai"];
  async function loadOrders() {
    if (!state.currentUser) return;
    const r = await api("/orders");
    if (r.status === 401) return handleExpiredToken();
    if (r.ok) { ordersCache = r.data.orders || []; if (r.data.points) saveJSON("nm_points_" + state.currentUser.email, r.data.points); }
  }
  async function openOrders() {
    if (!state.currentUser) { switchAuthTab("login"); openModal("authModal"); return; }
    renderOrdersModal(true);
    openModal("ordersModal");
    await loadOrders();
    renderOrdersModal();
  }
  function invoiceHTML(o) {
    const rows = o.items.map((i) => `<tr><td>${escapeHtml(i.name)}</td><td>${i.qty}</td><td>${formatRupiah(i.price)}</td><td>${formatRupiah(i.price * i.qty)}</td></tr>`).join("");
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Invoice ${escapeHtml(o.id)}</title><style>body{font-family:Arial,sans-serif;max-width:720px;margin:32px auto;color:#222}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}.r{text-align:right}</style></head><body><h1>Grizlie Nusantara</h1><h2>Invoice ${escapeHtml(o.id)}</h2><p>Tanggal: ${dateID(o.date)}<br>Penerima: ${escapeHtml(o.recipient)} (${escapeHtml(o.phone)})<br>Alamat: ${escapeHtml(o.address)}, ${escapeHtml(o.city)}, ${escapeHtml(o.province)} ${escapeHtml(o.postal)}<br>Pembayaran: ${escapeHtml(o.payment)} · Kurir: ${escapeHtml(o.courier)}</p><table><tr><th>Produk</th><th>Qty</th><th>Harga</th><th>Subtotal</th></tr>${rows}</table><p class="r">Subtotal: ${formatRupiah(o.subtotal)}<br>Ongkir: ${formatRupiah(o.shipping)}<br>${o.discount ? "Diskon: −" + formatRupiah(o.discount) + "<br>" : ""}<b>Total: ${formatRupiah(o.total)}</b></p></body></html>`;
  }
  function renderOrdersModal(loading) {
    const body = $("#ordersModalBody");
    if (!body) return;
    const os = getOrders();
    if (loading && !os.length) { body.innerHTML = `<p class="muted">Memuat pesanan…</p>`; return; }
    body.innerHTML = (os.length ? os.map((o) => {
      const idx = TRACK_STEPS.indexOf(o.status), track = o.trackUrl && safeHttps(o.trackUrl);
      return `<article class="order-card" data-id="${escapeHtml(o.id)}">
        <header><b>${escapeHtml(o.id)}</b><span class="order-status st-${escapeHtml(o.status)}">${escapeHtml(STATUS_LABEL[o.status] || o.status)}</span></header>
        <p class="muted">${dateID(o.date)} · ${escapeHtml(o.city)}, ${escapeHtml(o.province)} · ${escapeHtml(o.payment)}</p>
        <ul>${o.items.map((i) => `<li>${i.qty}× ${escapeHtml(i.name)}</li>`).join("")}</ul>
        ${idx >= 0 ? `<ol class="track">${TRACK_STEPS.map((st, n) => `<li class="${n <= idx ? "on" : ""}">${STATUS_LABEL[st]}</li>`).join("")}</ol>` : ""}
        ${o.trackingNo ? `<p>Kurir ${escapeHtml(o.courier)} · Resi <b>${escapeHtml(o.trackingNo)}</b>${track ? ` · <a href="${escapeHtml(track)}" target="_blank" rel="noopener">Lacak paket</a>` : " (lacak di situs kurir)"}</p>` : ""}
        ${o.refundStatus === "perlu_refund" ? `<p class="notice">Refund sedang diproses tim kami.</p>` : ""}
        ${o.refundStatus === "selesai" ? `<p class="notice">Dana sudah dikembalikan.</p>` : ""}
        <p class="order-total">Total <b>${formatRupiah(o.total)}</b>${o.coupon ? ` · kupon ${escapeHtml(o.coupon)}` : ""}</p>
        <div class="order-actions">
          ${o.status === "menunggu_pembayaran" && safeHttps(o.payUrl) ? `<button class="btn btn-primary btn-sm" data-act="pay">Bayar</button>` : ""}
          ${o.status === "menunggu_pembayaran" && CFG.simulatePay ? `<button class="btn btn-ghost btn-sm" data-act="simpay">Simulasikan bayar</button>` : ""}
          ${o.canCancel ? `<button class="btn btn-ghost btn-sm" data-act="cancel">Batalkan</button>` : ""}
          ${o.canReturn ? `<button class="btn btn-ghost btn-sm" data-act="return">Ajukan retur</button>` : ""}
          <button class="btn btn-ghost btn-sm" data-act="reorder">Beli lagi</button>
          <button class="btn btn-ghost btn-sm" data-act="invoice">Invoice</button>
        </div></article>`;
    }).join("") : `<p class="muted">Belum ada pesanan.</p>`);
  }
  async function onOrdersClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const o = getOrders().find((x) => x.id === b.closest(".order-card")?.dataset.id);
    if (!o) return;
    const act = b.dataset.act;
    const call = async (path, payload) => {
      b.disabled = true;
      const r = await api("/orders/" + o.id + "/" + path, { method: "POST", body: JSON.stringify(payload || {}) });
      b.disabled = false;
      if (r.status === 401) { handleExpiredToken(); return null; }
      if (!r.ok) { showToast(r.data.message || "Gagal."); return null; }
      return r;
    };
    const refreshAll = async () => { await loadOrders(); await loadCatalog(); refreshCatalogUI(); renderAuthArea(); renderOrdersModal(); };
    if (act === "pay") { const r = await call("pay"); const u = r && safeHttps(r.data.payUrl); if (u) location.href = u; return; }
    if (act === "simpay") { if (await call("simulate-pay")) { showToast("Pembayaran disimulasikan."); await refreshAll(); } return; }
    if (act === "cancel") {
      if (!confirm("Batalkan pesanan " + o.id + "?")) return;
      if (await call("cancel", { reason: "Dibatalkan pembeli" })) { showToast("Pesanan dibatalkan."); await refreshAll(); }
      return;
    }
    if (act === "return") {
      const reason = prompt("Tulis alasan retur (minimal 5 karakter):");
      if (!reason) return;
      if (await call("return", { reason })) { showToast("Pengajuan retur terkirim."); await refreshAll(); }
      return;
    }
    if (act === "reorder") {
      let added = 0;
      o.items.forEach((i) => { const p = PRODUCTS.find((x) => x.id === i.id); if (p && p.stock > 0) { addToCart(p.id, Math.min(i.qty, p.stock)); added++; } });
      showToast(added ? "Produk ditambahkan ke keranjang." : "Produk pesanan ini sudah tidak tersedia.");
      if (added) { closeModal("ordersModal"); openCart(); }
      return;
    }
    if (act === "invoice") {
      const w = window.open("", "_blank");
      if (w) { w.document.write(invoiceHTML(o)); w.document.close(); }
    }
  }
  function setSearchOpen(open) {
    const panel = $("#searchPanel");
    const toggle = $("#searchToggle");
    if (!panel) return;
    panel.classList.toggle("open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    if (open) {
      setTimeout(() => $("#globalSearchInput")?.focus(), 120);
    } else if (state.searchQuery) {
      state.searchQuery = "";
      const input = $("#globalSearchInput");
      if (input) input.value = "";
      renderProducts();
    }
  }
  function setNavOpen(open) {
    $("#mainNav")?.classList.toggle("open", open);
    $("#navBurger")?.setAttribute("aria-expanded", String(open));
  }
  function bindEvents() {
    const header = $("#siteHeader");
    const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    $("#navBurger")?.addEventListener("click", () => setNavOpen(!$("#mainNav")?.classList.contains("open")));
    $$("#mainNav a").forEach((a) => a.addEventListener("click", () => setNavOpen(false)));
    $("#searchToggle")?.addEventListener("click", () => setSearchOpen(!$("#searchPanel")?.classList.contains("open")));
    $("#searchClose")?.addEventListener("click", () => setSearchOpen(false));
    const searchInput = $("#globalSearchInput");
    searchInput?.addEventListener("input", () => {
      state.searchQuery = searchInput.value.trim().toLowerCase();
      renderProducts();
    });
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        scrollToProducts();
      }
    });
    $("#categoryGrid")?.addEventListener("click", (e) => {
      const card = e.target.closest("[data-category]");
      if (!card) return;
      setActiveCategory(card.getAttribute("data-category"));
      scrollToProducts();
    });
    $("#categoryPills")?.addEventListener("click", (e) => {
      const pill = e.target.closest("[data-category]");
      if (pill) setActiveCategory(pill.getAttribute("data-category"));
    });
    $("#sortSelect")?.addEventListener("change", renderProducts);
    $("#priceSelect")?.addEventListener("change", renderProducts);
    $("#resetFilters")?.addEventListener("click", resetFilters);
    $("#productGrid")?.addEventListener("click", onProductGridClick);
    $("#cartBody")?.addEventListener("click", onCartBodyClick);
    $("#cartFoot")?.addEventListener("click", (e) => {
      if (e.target.closest("#checkoutBtn")) handleCheckoutStart();
    });
    $("#wishlistBody")?.addEventListener("click", onWishlistBodyClick);
    $("#cartToggle")?.addEventListener("click", openCart);

    // DIPERBARUI: Validasi Poin dan Kupon saat submit form kupon
    $("#cartFoot")?.addEventListener("submit", (e) => {
      if (e.target.id !== "couponForm") return;
      e.preventDefault();
      const code = $("#couponInput").value.trim().toUpperCase();
      if (!code) { coupon = null; renderCartDrawer(); return; }
      const v = COUPONS[code];
      if (!v) { showToast("Kode kupon tidak ditemukan."); return; }
      if (v.min && cartSubtotal() < v.min) { showToast("Belanja minimal " + formatRupiah(v.min) + " untuk kupon ini."); return; }
      if (v.pts && getPts().bal < v.pts) { showToast("Poin tidak cukup (butuh " + v.pts + " poin)."); return; }
      coupon = code;
      renderCartDrawer();
      showToast(v.label + " diterapkan.");
    });

    $("#flashGrid")?.addEventListener("click", onProductGridClick);
    $("#viewedGrid")?.addEventListener("click", onProductGridClick);
    $("#wishlistToggle")?.addEventListener("click", openWishlist);
    $("#footerWishlistLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      openWishlist();
    });
    $("#overlay")?.addEventListener("click", closeAllModalsAndDrawers);
    $$("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")))
    );
    $$(".modal").forEach((modal) =>
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal(modal.id);
      })
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (openLayers.length > 0) closeModal(openLayers[openLayers.length - 1]);
        else if ($("#searchPanel")?.classList.contains("open")) setSearchOpen(false);
        else setNavOpen(false);
      }
      trapFocus(e);
    });
    document.addEventListener("click", () => {
      $("#userMenu")?.classList.remove("open");
      $("#userChip")?.setAttribute("aria-expanded", "false");
    });
    $$(".auth-tab").forEach((tab) =>
      tab.addEventListener("click", () => switchAuthTab(tab.getAttribute("data-tab")))
    );
    $$("[data-tab-switch]").forEach((btn) =>
      btn.addEventListener("click", () => switchAuthTab(btn.getAttribute("data-tab-switch")))
    );
    $("#loginForm")?.addEventListener("submit", onLoginSubmit);
    $("#registerForm")?.addEventListener("submit", onRegisterSubmit);
    $("#forgotForm")?.addEventListener("submit", onForgotSubmit);
    $("#resetForm")?.addEventListener("submit", onResetSubmit);
    $("#resendVerifyBtn")?.addEventListener("click", async () => {
      const email = $("#resendHint")?.dataset.email || "";
      const r = await api("/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
      showToast(r.data.message || "Permintaan gagal. Coba lagi nanti.");
    });

    ["#heroSellBtn", "#ctaSellBtn"].forEach((s) => $(s)?.addEventListener("click", () => openModal("sellerModal")));
    $$("[data-help]").forEach((link) =>
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openModal("helpModal");
      })
    );
  }
  function trackViewed(id) {
    const list = loadJSON("nm_viewed", []).filter((x) => x !== id);
    list.unshift(id);
    saveJSON("nm_viewed", list.slice(0, 4));
    renderViewed();
  }
  function renderViewed() {
    const sec = $("#viewedSection"), grid = $("#viewedGrid");
    if (!sec || !grid) return;
    const items = loadJSON("nm_viewed", []).map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
    sec.hidden = items.length === 0;
    grid.innerHTML = items.map(cardHTML).join("");
  }
  function renderFlash() {
    const grid = $("#flashGrid");
    const promo = PRODUCTS.filter((p) => p.oldPrice).slice(0, 4);
    if (grid) grid.innerHTML = promo.map(cardHTML).join("");
    const sec = $("#promo");
    if (sec) sec.hidden = promo.length === 0;
    renderBest();
  }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $("meta[name=theme-color]")?.setAttribute("content", t === "dark" ? "#0e1020" : "#FFFFFF");
    try { localStorage.setItem("nm_theme", t); } catch (e) { }
  }
  function initExtras() {
    let saved = null;
    try { saved = localStorage.getItem("nm_theme"); } catch (e) { }
    applyTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    $("#themeToggle")?.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    renderFlash();
    renderViewed();
    const top = $("#toTop");
    window.addEventListener("scroll", () => top?.classList.toggle("show", window.scrollY > 600), { passive: true });
    top?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    $("#sellerForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#sellerError");
      const d = Object.fromEntries(new FormData(e.target));
      if (d.website) return;
      if (!state.currentUser) {
        pendingSellerAfterLogin = Date.now();
        closeModal("sellerModal");
        switchAuthTab("login");
        openModal("authModal");
        showToast("Masuk atau daftar akun dulu untuk mendaftar sebagai penjual.");
        return;
      }
      const shop = cleanText(d.shop, 60), city = cleanText(d.city, 40);
      const cats = Array.from(e.target.elements.cat.options, (o) => o.value);
      const wa = String(d.wa || "").replace(/[\s-]/g, "");
      if (shop.length < 3) return showFormError(err, "Nama usaha minimal 3 karakter.");
      if (SUSPECT_SHOP.test(shop) || shop.replace(/\D/g, "").length >= 8) return showFormError(err, "Nama usaha tidak boleh memuat tautan, email, nomor telepon, atau kata terlarang.");
      if (!cats.includes(d.cat)) return showFormError(err, "Pilih kategori yang tersedia.");
      if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(city)) return showFormError(err, "Nama kota hanya boleh berisi huruf.");
      if (!/^(\+62|62|0)8[0-9]{7,12}$/.test(wa)) return showFormError(err, "Nomor WhatsApp tidak valid. Contoh: 081234567890.");
      if (!d.agree) return showFormError(err, "Setujui kebijakan keamanan penjual untuk melanjutkan.");
      hideFormError(err);
      const sr = await api("/sellers", { method: "POST", body: JSON.stringify({ shop, cat: d.cat, city, wa, agree: true }) });
      if (sr.status === 401) return handleExpiredToken();
      if (!sr.ok) return showFormError(err, sr.data.message || "Pendaftaran gagal. Coba lagi.");
      e.target.reset();
      closeModal("sellerModal");
      showToast("Pendaftaran terkirim dan menunggu verifikasi. Kami hanya menghubungi lewat WhatsApp yang Anda daftarkan.");
    });
  }
  let cmp = [];
  function toggleCompare(id) {
    const i = cmp.indexOf(id);
    if (i >= 0) cmp.splice(i, 1);
    else if (cmp.length >= 3) { showToast("Maksimal 3 produk untuk dibandingkan."); return; }
    else cmp.push(id);
    renderProducts(); renderFlash(); renderViewed(); renderCompareBar();
  }
  function renderCompareBar() {
    const bar = $("#cmpBar");
    if (!bar) return;
    bar.hidden = cmp.length === 0;
    document.body.classList.toggle("has-cmp", cmp.length > 0);
    $("#cmpCount").textContent = cmp.length + " dari 3 produk dipilih";
    $("#cmpGo").disabled = cmp.length < 2;
  }
  function openCompare() {
    const items = cmp.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
    const minP = Math.min(...items.map((p) => p.price));
    const maxR = Math.max(...items.map((p) => p.rating));
    const maxS = Math.max(...items.map((p) => p.sold));
    const row = (label, fn, best) => `<tr><th scope="row">${label}</th>${items.map((p) => `<td class="${best && best(p) ? "best" : ""}">${fn(p)}</td>`).join("")}</tr>`;
    $("#compareBody").innerHTML = `<div class="cmp-scroll"><table class="cmp-table"><thead><tr><td></td>${items.map((p) => `<th scope="col"><span class="cmp-icon">${p.icon}</span>${escapeHtml(p.name)}</th>`).join("")}</tr></thead><tbody>
      ${row("Harga", (p) => formatRupiah(p.price), (p) => p.price === minP)}
      ${row("Rating", (p) => `${p.rating.toFixed(1)} ★ (${p.reviews})`, (p) => p.rating === maxR)}
      ${row("Terjual", (p) => p.sold, (p) => p.sold === maxS)}
      ${row("Asal", (p) => escapeHtml(p.region))}
      ${row("Kategori", (p) => escapeHtml(categoryById(p.category)?.name || ""))}
      ${row("", (p) => `<button class="btn btn-primary btn-sm" data-cmp-add="${p.id}">+ Keranjang</button>`)}
    </tbody></table></div><p class="cmp-note">Sorotan hijau menandai nilai terbaik di tiap baris.</p>`;
    openModal("compareModal");
  }
  function initMore() {
    document.body.insertAdjacentHTML("beforeend", `<div class="cmp-bar" id="cmpBar" hidden><span id="cmpCount"></span><button class="btn btn-primary btn-sm" id="cmpGo">Bandingkan</button><button class="btn btn-outline btn-sm" id="cmpClear">Kosongkan</button></div>
      <div class="modal" id="compareModal" role="dialog" aria-modal="true" aria-labelledby="cmpTitle" aria-hidden="true"><div class="modal-panel product-panel"><button class="modal-close" data-close="compareModal" aria-label="Tutup">✕</button><h2 id="cmpTitle">Bandingkan produk</h2><div id="compareBody"></div></div></div>`);
    $("#cmpGo")?.addEventListener("click", openCompare);
    $("#cmpClear")?.addEventListener("click", () => { cmp = []; renderProducts(); renderFlash(); renderViewed(); renderCompareBar(); });
    $("[data-close=compareModal]")?.addEventListener("click", () => closeModal("compareModal"));
    $("#compareModal")?.addEventListener("click", (e) => { if (e.target.id === "compareModal") closeModal("compareModal"); });
    $("#compareBody")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cmp-add]");
      if (b) addToCart(Number(b.dataset.cmpAdd), 1);
    });

    const inner = $(".search-panel-inner"), input = $("#globalSearchInput");
    const box = document.createElement("div");
    box.className = "suggest"; box.hidden = true; inner?.appendChild(box);
    input?.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      const hits = q ? PRODUCTS.filter((p) => (p.name + " " + p.region).toLowerCase().includes(q)).slice(0, 5) : [];
      box.hidden = hits.length === 0;
      box.innerHTML = hits.map((p) => `<button type="button" data-sg="${p.id}"><span aria-hidden="true">${p.icon}</span><b>${escapeHtml(p.name)}</b><small>${formatRupiah(p.price)}</small></button>`).join("");
    });
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sg]");
      if (b) { box.hidden = true; openProductDetail(Number(b.dataset.sg)); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search-panel")) box.hidden = true; });
    ["#searchToggle", "#searchClose"].forEach((s) => $(s)?.addEventListener("click", () => (box.hidden = true)));

    // Notifikasi "baru saja membeli" dihapus: sebelumnya berisi nama pembeli rekaan (syarat D-04).

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      }), { threshold: 0.12 });
      $$(".section-head, .flash-head, .trust-item, .testi, .seller-cta").forEach((el) => { el.classList.add("reveal"); io.observe(el); });
    }
  }
  const ISLANDS = ["Sumatra", "Jawa", "Kalimantan", "Sulawesi", "Bali & Nusa Tenggara", "Maluku & Papua"];
  function islandOf(region) {
    const r = region.toLowerCase();
    if (/aceh|sumatra|padang/.test(r)) return ISLANDS[0];
    if (/kalimantan/.test(r)) return ISLANDS[2];
    if (/sulawesi|toraja/.test(r)) return ISLANDS[3];
    if (/bali|ntt|sumba|flores/.test(r)) return ISLANDS[4];
    if (/maluku|papua|buru/.test(r)) return ISLANDS[5];
    return ISLANDS[1];
  }
  const TIERS = [["Perintis", 0], ["Perak", 300], ["Emas", 1000]];
  const ptsKey = (e) => "nm_points_" + e;
  const getPts = () => (state.currentUser ? loadJSON(ptsKey(state.currentUser.email), { bal: 0, life: 0 }) : { bal: 0, life: 0 });
  const tierOf = (life) => TIERS.filter((t) => life >= t[1]).pop();
  const stockTag = (p) => (p.stock === 0 ? `<span class="stock-low">Habis</span>` : p.stock <= 5 ? `<span class="stock-low">Sisa ${p.stock}</span>` : "");

  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cols = ["#1F2C7A", "#C99A45", "#D8492B", "#2E6A4C", "#8B2C5E"];
    const box = document.createElement("div");
    box.className = "confetti";
    box.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 48; i++) {
      const c = document.createElement("i");
      c.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-delay:${Math.random() * 0.4}s;--dx:${Math.round(Math.random() * 160 - 80)}px;--r:${Math.round(Math.random() * 720)}deg`;
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2600);
  }
  async function renderUgc(p, body) {
    const box = $(".reviews", body);
    if (!box) return;
    const r = await api("/reviews/" + p.id);
    const list = r.ok && Array.isArray(r.data.reviews) ? r.data.reviews : [];
    const holder = $("#revList", box);
    if (holder) holder.innerHTML = list.length
      ? list.map((x) => `<div class="review-item"><div class="review-head"><span>${escapeHtml(x.name)}<em class="vbadge">Pembeli terverifikasi</em></span><span class="stars" aria-label="${x.rating} dari 5 bintang">${starString(x.rating)}</span></div><p>${escapeHtml(x.text)}</p></div>`).join("")
      : `<p class="muted">Belum ada ulasan. Ulasan hanya bisa ditulis pembeli yang pesanannya sudah selesai.</p>`;
    box.querySelector("#ugc")?.remove();
    box.insertAdjacentHTML("beforeend", `<div id="ugc"><form class="rev-form" id="revForm"><h4>Tulis ulasan Anda</h4>
        <div class="rev-stars" id="revStars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-s="${n}" aria-label="${n} bintang">★</button>`).join("")}</div>
        <textarea name="text" rows="2" maxlength="300" placeholder="Ceritakan pengalaman Anda dengan produk ini" aria-label="Isi ulasan"></textarea>
        <button class="btn btn-primary btn-sm" type="submit">Kirim ulasan</button></form></div>`);
    let rating = 0;
    $("#revStars", box).addEventListener("click", (e) => {
      const b = e.target.closest("[data-s]");
      if (!b) return;
      rating = Number(b.dataset.s);
      $$("#revStars button", box).forEach((x) => x.classList.toggle("on", Number(x.dataset.s) <= rating));
    });
    $("#revForm", box).addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.currentUser) { showToast("Masuk dulu untuk menulis ulasan."); switchAuthTab("login"); openModal("authModal"); return; }
      const text = cleanText(new FormData(e.target).get("text"), 300);
      if (!rating || text.length < 5) { showToast("Pilih bintang dan tulis minimal 5 karakter."); return; }
      const res = await api("/reviews", { method: "POST", body: JSON.stringify({ productId: p.id, rating, text }) });
      if (res.status === 401) return handleExpiredToken();
      if (!res.ok) { showToast(res.data.message || "Ulasan gagal dikirim."); return; }
      showToast("Terima kasih atas ulasan Anda!");
      await loadCatalog();
      refreshCatalogUI();
      renderUgc(PRODUCTS.find((x) => x.id === p.id) || p, body);
    });
  }
  function initAssistant() {
    document.body.insertAdjacentHTML("beforeend", `<button class="ai-fab" id="aiFab" aria-label="Buka asisten belanja" aria-expanded="false">✦<span>Tanya Asisten</span></button>
    <section class="ai-panel" id="aiPanel" aria-label="Asisten belanja" hidden>
      <header><div><b>Asisten Grizlie</b><small>Rekomendasi dan bantuan belanja</small></div><button type="button" id="aiClose" aria-label="Tutup asisten">✕</button></header>
      <div class="ai-log" id="aiLog" aria-live="polite"></div>
      <div class="ai-quick" id="aiQuick"></div>
      <form class="ai-form" id="aiForm"><input id="aiInput" placeholder="Tanya produk, kupon, ongkir..." autocomplete="off" aria-label="Pesan Anda"><button class="btn btn-primary btn-sm">Kirim</button></form>
    </section>`);
    const log = $("#aiLog"), panel = $("#aiPanel"), fab = $("#aiFab");
    const say = (html, who) => { log.insertAdjacentHTML("beforeend", `<div class="ai-msg ${who}">${html}</div>`); log.scrollTop = log.scrollHeight; };
    const cards = (list) => `<div class="ai-cards">${list.map((p) => `<button type="button" data-ai-open="${p.id}"><span>${p.icon}</span><b>${escapeHtml(p.name)}</b><small>${formatRupiah(p.price)}</small></button>`).join("")}</div>`;
    const budget = (t) => {
      const m = t.match(/(\d+(?:,\d+)?)\s*(rb|ribu|k|jt|juta)?/);
      if (!m) return 0;
      let n = parseFloat(m[1].replace(",", "."));
      if (/rb|ribu|k/.test(m[2] || "")) n *= 1000; else if (/jt|juta/.test(m[2] || "")) n *= 1e6; else if (n < 1000) n *= 1000;
      return n;
    };
    const QUICK = ["Produk terlaris", "Oleh-oleh di bawah 100 ribu", "Kupon aktif", "Info ongkir", "Cara retur", "Poin rewards"];
    $("#aiQuick").innerHTML = QUICK.map((q) => `<button type="button">${q}</button>`).join("");
    const reply = (raw) => {
      const t = raw.toLowerCase().replace(/(\d)\.(\d{3})/g, "$1$2");
      if (/kupon|voucher|promo|diskon/.test(t)) { const cs = Object.entries(COUPONS); return say(cs.length ? "Kupon aktif: " + cs.map(([c, v]) => `<b>${escapeHtml(c)}</b> (${escapeHtml(v.label)}${v.min ? ", min. " + formatRupiah(v.min) : ""})`).join(", ") + ". Satu pesanan satu kupon." : "Saat ini belum ada kupon aktif.", "bot"); }
      if (/ongkir|kirim|ongkos/.test(t)) return say("Ongkos kirim dihitung dari berat paket, provinsi tujuan, dan kurir yang Anda pilih di checkout. Gratis ongkir untuk belanja di atas " + formatRupiah(CFG.freeMin) + ".", "bot");
      if (/retur|garansi/.test(t)) return say("Pesanan yang sudah selesai bisa diajukan retur dalam " + CFG.returnDays + " hari setelah diterima, dari menu Pesanan saya. Detail ada di halaman Kebijakan Retur & Refund.", "bot");
      if (/poin|reward|level/.test(t)) return say("Setiap Rp10.000 belanja memberi 1 poin, dikreditkan saat pesanan selesai. Poin bisa ditukar dengan kupon penukaran bila tersedia. Level: Perintis, Perak (300 poin), Emas (1.000 poin).", "bot");
      if (/pesanan|lacak|resi/.test(t)) {
        if (!state.currentUser) return say("Silakan masuk dulu untuk melihat pesanan Anda.", "bot");
        say("Saya buka riwayat pesanan Anda.", "bot"); panel.hidden = true; openOrders(); return;
      }
      if (/terlaris|populer/.test(t)) return say("Paling banyak dibeli:" + cards(PRODUCTS.slice().sort((a, b) => b.sold - a.sold).slice(0, 3)), "bot");
      const max = /\d/.test(t) ? budget(t) : 0;
      const words = t.split(/[^a-z]+/).filter((w) => w.length > 3 && !/bawah|ribu|juta|oleh|produk|cari|ingin|mau|rekomendasi|tolong|yang/.test(w));
      let list = PRODUCTS.filter((p) => !words.length || words.some((w) => (p.name + " " + p.region + " " + (categoryById(p.category)?.name || "")).toLowerCase().includes(w)));
      if (/oleh/.test(t)) list = PRODUCTS.filter((p) => ["kuliner", "kerajinan", "rempah"].includes(p.category));
      if (max) list = list.filter((p) => p.price <= max);
      list = list.sort((a, b) => b.rating - a.rating).slice(0, 3);
      if (!list.length) return say("Belum ketemu yang cocok. Coba sebut jenis produk atau anggaran, misalnya <b>kopi di bawah 100 ribu</b>.", "bot");
      say("Ini pilihan yang cocok" + (max ? ` dengan anggaran ${formatRupiah(max)}` : "") + ":" + cards(list), "bot");
    };
    const send = (txt) => { if (!txt.trim()) return; say(escapeHtml(txt), "me"); reply(txt); };
    say("Halo! Saya bisa bantu cari produk sesuai selera dan anggaran, serta jelaskan kupon, ongkir, retur, dan poin.", "bot");
    const toggle = (open) => { panel.hidden = !open; fab.setAttribute("aria-expanded", String(open)); if (open) setTimeout(() => $("#aiInput")?.focus(), 50); };
    fab.addEventListener("click", () => toggle(panel.hidden));
    $("#aiClose").addEventListener("click", () => toggle(false));
    $("#aiQuick").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) send(b.textContent); });
    $("#aiForm").addEventListener("submit", (e) => { e.preventDefault(); const i = $("#aiInput"); send(i.value); i.value = ""; });
    log.addEventListener("click", (e) => { const b = e.target.closest("[data-ai-open]"); if (b) { toggle(false); openProductDetail(Number(b.dataset.aiOpen)); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden && openLayers.length === 0) toggle(false); });
  }

  function initFeatures() {
    ["#islandSelect", "#ratingOnly", "#saleOnly"].forEach((s) => $(s)?.addEventListener("change", renderProducts));

    // DIPERBARUI: Validasi Poin dan Kupon saat klik tombol chip voucher
    $("#cartFoot")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-vc]");
      if (!b) return;
      const c = b.dataset.vc, v = COUPONS[c];
      if (coupon === c) coupon = null;
      else if (v.min && cartSubtotal() < v.min) { showToast("Belanja minimal " + formatRupiah(v.min) + " untuk kupon ini."); return; }
      else if (v.pts && getPts().bal < v.pts) { showToast("Poin tidak cukup (butuh " + v.pts + " poin)."); return; }
      else { coupon = c; showToast(v.label + " diterapkan."); }
      renderCartDrawer();
    });

    $("#ordersModalBody")?.addEventListener("click", onOrdersClick);
    initAssistant();

    document.body.insertAdjacentHTML("afterbegin", `<div class="progress" id="scrollProgress" aria-hidden="true"></div>`);
    const bar = $("#scrollProgress");
    window.addEventListener("scroll", () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
    }, { passive: true });
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
      if ((e.key === "/" && !typing) || (String(e.key || "").toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); setSearchOpen(true); }
    });
    $$(".hero-stats dt").forEach((el) => {
      const raw = el.textContent, n = parseInt(raw.replace(/\D/g, ""), 10), suf = raw.replace(/[\d.]/g, "");
      if (!n || !("IntersectionObserver" in window)) return;
      const run = () => {
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / 1100);
          el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))).toLocaleString("id-ID") + suf;
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
      new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { run(); io.disconnect(); } }).observe(el);
    });
    document.body.insertAdjacentHTML("beforeend", `<nav class="bottom-nav" aria-label="Navigasi cepat">
      <a href="#beranda"><i aria-hidden="true">⌂</i>Beranda</a>
      <a href="#produk"><i aria-hidden="true">▦</i>Produk</a>
      <button type="button" id="bnSearch"><i aria-hidden="true">⌕</i>Cari</button>
      <button type="button" id="bnCart"><i aria-hidden="true">🛒</i>Keranjang<span class="bn-badge" id="bnBadge" hidden>0</span></button>
      <button type="button" id="bnAccount"><i aria-hidden="true">☺</i>Akun</button></nav>`);
    $("#bnSearch").addEventListener("click", () => setSearchOpen(true));
    $("#bnCart").addEventListener("click", openCart);
    $("#bnAccount").addEventListener("click", () => {
      if (state.currentUser) { openOrders(); }
      else { switchAuthTab("login"); openModal("authModal"); }
    });
    updateCartBadge();

    const openFromHash = () => {
      const m = location.hash.match(/^#produk-(\d+)$/); if (m) openProductDetail(Number(m[1]));
      if (location.hash === "#pesanan" && state.currentUser) openOrders();
    };
    window.addEventListener("hashchange", openFromHash);
    openFromHash();
  }
  // Peta pulau: bentuk disederhanakan dengan tata letak mengikuti posisi geografis (viewBox 800x340).
  // Label di dalam SVG disembunyikan di layar kecil; navigasi diganti deretan chip agar tetap terbaca.
  const ISLAND_MAP = {
    "Sumatra": { label: [120, 132], d: ["M25 33 76 55 112 90 170 140 205 172 200 226 160 204 120 168 86 128 58 92 34 62Z"] },
    "Jawa": { label: [275, 292], d: ["M214 238 250 240 300 246 346 254 346 264 300 268 254 270 218 256Z"] },
    "Kalimantan": { label: [330, 134], d: ["M262 122 300 86 350 60 388 72 410 108 398 150 412 172 384 196 330 202 284 192 256 162Z"] },
    "Sulawesi": { label: [490, 252], d: ["M452 122 488 106 522 112 502 130 474 136 478 160 494 182 514 176 526 196 502 206 488 224 474 202 456 186 452 152Z"] },
    "Bali & Nusa Tenggara": { label: [462, 322], d: ["M352 266 366 264 368 276 354 278Z", "M378 270 394 268 394 282 380 282Z", "M404 276 436 272 440 284 408 286Z", "M452 278 496 280 494 290 456 290Z", "M440 298 470 296 472 306 444 308Z", "M506 296 548 292 556 304 512 308Z"] },
    "Maluku & Papua": { label: [700, 112], d: ["M612 150 650 138 682 152 702 168 742 176 778 196 776 240 740 262 700 252 670 250 650 232 640 200 620 190 626 170Z", "M556 104 574 100 576 124 560 126Z", "M572 176 604 172 608 186 576 190Z", "M540 184 560 182 562 196 544 198Z"] }
  };
  function initIslandMap() {
    const anchor = $("#produk");
    if (!anchor) return;
    const names = Object.keys(ISLAND_MAP);
    const byIsl = (n) => PRODUCTS.filter((p) => p.island === n).sort((a, b) => b.sold - a.sold);
    const counts = Object.fromEntries(names.map((n) => [n, byIsl(n).length]));
    const shapes = names.map((n) => {
      const { label, d } = ISLAND_MAP[n];
      return `<g class="isl" data-isl="${escapeHtml(n)}" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(n)}, ${counts[n]} produk">${d.map((p) => `<path d="${p}"/>`).join("")}<text x="${label[0]}" y="${label[1]}" text-anchor="middle">${escapeHtml(n)}<tspan x="${label[0]}" dy="16">${counts[n]} produk</tspan></text></g>`;
    }).join("");
    const chips = names.map((n) => `<button type="button" class="nmap-chip" data-isl="${escapeHtml(n)}" aria-pressed="false">${escapeHtml(n)} <small>${counts[n]}</small></button>`).join("");
    anchor.insertAdjacentHTML("beforebegin", `<section class="section nmap-sec" id="peta"><div class="wrap">
      <div class="section-head"><h2>Jelajahi lewat peta</h2><p>Pilih pulau, lihat karya yang lahir dari sana.</p></div>
      <div class="nmap"><div class="nmap-board"><svg class="nmap-svg" viewBox="0 0 800 340" role="group" aria-label="Peta kepulauan Indonesia">${shapes}</svg><div class="nmap-chips">${chips}</div></div><div class="nmap-panel" id="nmapPanel" aria-live="polite"></div></div></div></section>`);
    const root = $("#peta"), panel = $("#nmapPanel");
    let cur = counts["Jawa"] ? "Jawa" : names.find((n) => counts[n]) || names[0];
    const show = (n) => {
      cur = n;
      $$("[data-isl]", root).forEach((el) => {
        const on = el.dataset.isl === n;
        el.classList.toggle("on", on);
        el.setAttribute("aria-pressed", String(on));
      });
      const list = byIsl(n);
      panel.innerHTML = `<h3>${escapeHtml(n)}</h3><p>${list.length ? list.length + " produk dari wilayah ini" : "Belum ada produk dari wilayah ini"}</p>` +
        list.slice(0, 3).map((p) => `<button type="button" class="mp-item" data-id="${p.id}"><span>${p.icon}</span><b>${escapeHtml(p.name)}</b><small>${formatRupiah(p.price)}</small></button>`).join("") +
        (list.length ? `<button type="button" class="btn btn-primary btn-sm mp-go">Lihat semua dari ${escapeHtml(n)}</button>` : "");
    };
    root.addEventListener("click", (e) => {
      const g = e.target.closest("[data-isl]");
      if (g) return show(g.dataset.isl);
      const it = e.target.closest(".mp-item");
      if (it) return openProductDetail(Number(it.dataset.id));
      if (e.target.closest(".mp-go")) {
        const sel = $("#islandSelect");
        if (sel) { sel.value = cur; renderProducts(); }
        scrollToProducts();
      }
    });
    root.addEventListener("keydown", (e) => {
      const g = e.target.closest(".isl");
      if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); show(g.dataset.isl); }
    });
    show(cur);
  }
  function initWow() {
    const hero = $("#beranda");
    if (hero) {
      const ic = CATEGORIES.map((c, i) => `<span class="fl fl${i}">${c.icon}</span>`).join("");
      hero.insertAdjacentHTML("afterbegin", `<div class="hero-fx" aria-hidden="true"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>${ic}</div>`);
      hero.addEventListener("mousemove", (e) => {
        const r = hero.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        $$(".fl", hero).forEach((el, i) => { const d = (i % 3 + 1) * 16; el.style.translate = `${x * d}px ${y * d}px`; });
      });
      $("h1", hero)?.insertAdjacentHTML("beforebegin", `<p class="hero-rot">Temukan <b id="rotWord">batik tulis</b></p>`);
      const W = ["batik tulis", "kopi Gayo", "tenun ikat", "rendang Padang", "perak Kotagede", "jamu tradisional"], rw = $("#rotWord");
      let k = 0;
      setInterval(() => { if (document.hidden) return; rw.classList.add("out"); setTimeout(() => { k = (k + 1) % W.length; rw.textContent = W[k]; rw.classList.remove("out"); }, 300); }, 2400);
    }

    initIslandMap();

    if (matchMedia("(hover: hover)").matches) {
      let raf = 0;
      document.addEventListener("mousemove", (e) => {
        const c = e.target.closest?.(".product-card");
        if (!c || raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const r = c.getBoundingClientRect();
          c.style.setProperty("--mx", e.clientX - r.left + "px");
          c.style.setProperty("--my", e.clientY - r.top + "px");
        });
      }, { passive: true });
    }
  }
  const COLLECTIONS = [
    { name: "Oleh-oleh di bawah Rp50rb", icon: "🎁", cls: "kuliner", fn: (p) => p.price <= 50000 },
    { name: "Teman ngopi", icon: "☕", cls: "kopi", fn: (p) => p.category === "kopi" },
    { name: "Hadiah istimewa", icon: "💎", cls: "batik", fn: (p) => p.price >= 500000 },
    { name: "Baru datang", icon: "✨", cls: "rempah", fn: (p) => p.badge === "Baru" },
    { name: "Favorit pembeli", icon: "⭐", cls: "kerajinan", fn: (p) => p.rating >= 4.8 },
    { name: "Hemat hari ini", icon: "🏷️", cls: "fashion", fn: (p) => !!p.oldPrice }
  ];
  function setCollection(c) {
    state.collection = c;
    const tag = $("#collTag");
    if (tag) { tag.hidden = !c; $("span", tag).textContent = c ? "Koleksi: " + c.name : ""; }
    renderProducts();
  }
  function renderBest() {
    const row = $("#bestRow");
    if (row) row.innerHTML = PRODUCTS.slice().sort((a, b) => b.sold - a.sold).slice(0, 8).map(cardHTML).join("");
  }
  function applyQuery(raw) {
    const q = String(raw || "").trim();
    setCollection(null);
    state.searchQuery = q.toLowerCase();
    const gi = $("#globalSearchInput"); if (gi) gi.value = q;
    setActiveCategory("all");
    scrollToProducts();
    if (q && !getFilteredSortedProducts().length) showToast("Belum ada hasil untuk \"" + q + "\".");
  }
  function initHome() {
    const cg = $("#collGrid");
    if (cg) {
      cg.innerHTML = COLLECTIONS.map((c, i) => `<button type="button" class="category-card tile tile-${c.cls}" data-coll="${i}"><span class="cat-icon" aria-hidden="true">${c.icon}</span><span class="cat-label"><strong>${c.name}</strong><small>${PRODUCTS.filter(c.fn).length} produk</small></span></button>`).join("");
      cg.addEventListener("click", (e) => {
        const b = e.target.closest("[data-coll]");
        if (!b) return;
        state.searchQuery = "";
        const gi = $("#globalSearchInput"); if (gi) gi.value = "";
        setActiveCategory("all");
        setCollection(COLLECTIONS[Number(b.dataset.coll)]);
        scrollToProducts();
      });
    }
    $("#productGrid")?.insertAdjacentHTML("beforebegin", `<div class="coll-tag" id="collTag" hidden><span></span><button type="button" aria-label="Hapus koleksi">✕</button></div>`);
    $("#collTag button")?.addEventListener("click", () => setCollection(null));
    renderBest();
    $("#bestRow")?.addEventListener("click", onProductGridClick);
    $$("[data-best]").forEach((b) => b.addEventListener("click", () => $("#bestRow")?.scrollBy({ left: Number(b.dataset.best) * 260, behavior: "smooth" })));
    $("#heroSearch")?.addEventListener("submit", (e) => { e.preventDefault(); applyQuery($("#heroQ").value); });
    $("#heroChips")?.addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) applyQuery(b.dataset.q); });
  }
  const PW_HINT = "Gunakan 8+ karakter dengan huruf besar, huruf kecil, dan angka.";
  function renderPwMeter(meter, hint, pw, email) {
    if (!meter) return;
    const sc = pwScore(pw, email);
    meter.dataset.s = String(sc);
    if (hint) hint.textContent = !pw ? PW_HINT : pwIssue(pw, email) || ["", "", "Kekuatan: cukup.", "Kekuatan: kuat.", "Kekuatan: sangat kuat."][sc];
  }
  function openAccountSecurity() {
    if (!state.currentUser) return;
    const rec = serverProfile;
    const changed = rec && rec.pwChanged ? "Terakhir ganti kata sandi: " + new Date(rec.pwChanged).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) + "." : "Kata sandi belum pernah diganti.";
    $("#accountSecInfo").textContent = "Masuk sebagai " + state.currentUser.email + ". Sesi berakhir otomatis setelah " + SEC.idleMs / 60000 + " menit tanpa aktivitas. " + changed;
    $("#changePwForm")?.reset();
    hideFormError($("#changePwError"));
    renderPwMeter($("#newPwMeter"), $("#newPwHint"), "");
    openModal("accountSecModal");
  }
  let lastPersist = 0, warned = false;
  function sessionExpired(u) {
    const now = Date.now();
    return now - u.last > SEC.idleMs || now - u.at > SEC.maxSessionMs;
  }
  function expireSession() { logout("Sesi berakhir karena tidak ada aktivitas. Silakan masuk lagi."); }
  function touchSession() {
    const u = state.currentUser;
    if (!u) return;
    if (sessionExpired(u)) return expireSession();
    const now = Date.now();
    u.last = now; warned = false;
    if (now - lastPersist > 15000) { lastPersist = now; persistCurrentUser(); }
  }
  function checkSession() {
    const u = state.currentUser;
    if (!u) return;
    const stored = loadJSON(STORE_KEYS.currentUser, null);
    if (stored && stored.email === u.email && stored.last > u.last) u.last = stored.last;
    if (sessionExpired(u)) return expireSession();
    if (SEC.idleMs - (Date.now() - u.last) <= SEC.warnMs && !warned) {
      warned = true;
      showToast("Anda akan keluar otomatis dalam 1 menit.", { label: "Tetap masuk", fn: touchSession });
    }
  }
  function initSecurity() {
    const regPw = $("#regPassword"), newPw = $("#newPassword");
    regPw?.addEventListener("input", () => renderPwMeter($("#regPwMeter"), $("#regPwHint"), regPw.value, $("#registerForm [name=email]")?.value));
    newPw?.addEventListener("input", () => renderPwMeter($("#newPwMeter"), $("#newPwHint"), newPw.value, state.currentUser?.email));

    const setSecTab = (t) => {
      $$(".sec-tab").forEach((b) => { const on = b.dataset.secTab === t; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
      $$("[data-sec-panel]").forEach((pn) => (pn.hidden = pn.dataset.secPanel !== t));
    };
    $$(".sec-tab").forEach((b) => b.addEventListener("click", () => setSecTab(b.dataset.secTab)));
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-security]");
      if (!a) return;
      e.preventDefault();
      setSecTab(a.dataset.security === "penjual" ? "penjual" : "pembeli");
      openModal("securityModal");
    });

    $("#changePwForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#changePwError"), form = e.target;
      if (!state.currentUser || !authToken) return showFormError(err, "Sesi berakhir. Silakan masuk lagi.");
      const d = new FormData(form);
      const oldPw = String(d.get("old") || ""), next = String(d.get("next") || ""), conf = String(d.get("confirm") || "");
      const issue = pwIssue(next, state.currentUser.email);
      if (issue) return showFormError(err, issue);
      if (next === oldPw) return showFormError(err, "Kata sandi baru harus berbeda dari yang lama.");
      if (next !== conf) return showFormError(err, "Konfirmasi kata sandi tidak cocok.");
      const r = await api("/password", { method: "POST", body: JSON.stringify({ current: oldPw, next }) });
      if (r.status === 401) return handleExpiredToken();
      if (!r.ok) return showFormError(err, r.data.message || "Gagal mengganti kata sandi.");
      authToken = r.data.token;
      try { localStorage.setItem(TOKEN_KEY, authToken); } catch (e) { }
      serverProfile = Object.assign({}, serverProfile, { pwChanged: r.data.pwChanged });
      hideFormError(err);
      form.reset();
      closeModal("accountSecModal");
      showToast("Kata sandi berhasil diganti.");
    });

    $("#exportAccountBtn")?.addEventListener("click", async () => {
      const r = await api("/account/export");
      if (r.status === 401) return handleExpiredToken();
      if (!r.ok) return showToast(r.data.message || "Gagal mengekspor data.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "data-akun-grizlie.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
    $("#deleteAccountForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#deleteAccountError");
      const pw = String(new FormData(e.target).get("password") || "");
      if (!pw) return showFormError(err, "Masukkan kata sandi untuk konfirmasi.");
      if (!confirm("Hapus akun secara permanen? Tindakan ini tidak bisa dibatalkan.")) return;
      const r = await api("/account", { method: "DELETE", body: JSON.stringify({ password: pw }) });
      if (r.status === 401) return handleExpiredToken();
      if (!r.ok) return showFormError(err, r.data.message || "Gagal menghapus akun.");
      closeModal("accountSecModal");
      clearToken(); state.currentUser = null; persistCurrentUser(); ordersCache = [];
      renderAuthArea(); renderCartDrawer();
      showToast("Akun Anda sudah dihapus.");
    });
    ["click", "keydown", "touchstart", "scroll"].forEach((ev) => window.addEventListener(ev, touchSession, { passive: true }));
    setInterval(checkSession, 10000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkSession(); });
    window.addEventListener("storage", (e) => {
      if (e.key !== STORE_KEYS.currentUser) return;
      let next = null;
      try { next = e.newValue ? JSON.parse(e.newValue) : null; } catch (x) { }
      if (state.currentUser && !next) logout("Anda keluar dari tab lain.");
      else if (next && (!state.currentUser || next.email !== state.currentUser.email)) location.reload();
    });
    checkSession();
  }
  function init() {
    injectTileStyles();
    renderCategories();
    renderProducts();
    renderAuthArea();
    renderCartDrawer();
    renderWishlistDrawer();
    updateCartBadge();
    updateWishlistBadge();
    bindEvents();
    initExtras();
    initMore();
    initFeatures();
    initWow();
    initHome();
    initSecurity();
    handleEmailLink();
    renderStoreFacts();
    if (catalogError) showToast(catalogError);
  }
  // Muat katalog dari server lebih dulu, lalu sesi akun, baru gambar halaman
  const start = () => loadCatalog().catch(() => { }).then(bootstrapServer).catch(() => { }).then(init);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { }));
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();