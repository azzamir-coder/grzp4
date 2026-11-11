"use strict";
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rp = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");
  const dt = (s) => (s ? new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-");
  const KEY = "nm_admin_token";
  let token = ""; try { token = sessionStorage.getItem(KEY) || ""; } catch (e) { }
  let tab = "ringkasan", me = null, flash = null;
  const app = $("#app");

  async function api(path, opts) {
    opts = opts || {};
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    try {
      const r = await fetch("/api" + path, Object.assign({}, opts, { headers }));
      let data = {}; try { data = await r.json(); } catch (e) { }
      return { ok: r.ok, status: r.status, data };
    } catch (e) { return { ok: false, status: 0, data: { message: "Tidak bisa terhubung ke server." } }; }
  }
  const say = (type, text) => { flash = { type, text }; };
  const banner = () => { const f = flash; flash = null; return f ? `<div class="msg ${f.type}">${esc(f.text)}</div>` : ""; };

  /* ---------- Masuk ---------- */
  function loginView(msg) {
    $("#logout").hidden = true; $("#who").textContent = "";
    app.innerHTML = `<form class="card login" id="lf"><h2>Masuk admin</h2>${msg ? `<div class="msg err">${esc(msg)}</div>` : ""}
      <label>Email<input name="email" type="email" required autocomplete="username"></label>
      <label>Kata sandi<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn p" style="width:100%">Masuk</button>
      <p class="small muted">Hanya akun yang terdaftar di ADMIN_EMAILS yang bisa membuka dasbor ini.</p></form>`;
    $("#lf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const r = await api("/login", { method: "POST", body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }) });
      if (!r.ok) return loginView(r.data.message || "Gagal masuk.");
      token = r.data.token; try { sessionStorage.setItem(KEY, token); } catch (x) { }
      boot();
    });
  }
  async function boot() {
    if (!token) return loginView();
    const r = await api("/data");
    if (!r.ok) { token = ""; try { sessionStorage.removeItem(KEY); } catch (e) { } return loginView(r.status === 401 ? "" : r.data.message); }
    if (!r.data.profile || !r.data.profile.admin) { token = ""; try { sessionStorage.removeItem(KEY); } catch (e) { } return loginView("Akun ini bukan admin."); }
    me = r.data.profile;
    $("#who").textContent = me.email; $("#logout").hidden = false;
    render();
  }
  $("#logout").addEventListener("click", () => { token = ""; try { sessionStorage.removeItem(KEY); } catch (e) { } loginView(); });

  const TABS = [["ringkasan", "Ringkasan"], ["pesanan", "Pesanan"], ["produk", "Produk"], ["kupon", "Kupon"], ["penjual", "Penjual"], ["pengguna", "Pengguna"], ["pengaturan", "Pengaturan"]];
  async function render() {
    app.innerHTML = `<nav>${TABS.map(([k, l]) => `<button data-t="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</nav><main id="main"><p class="muted">Memuat…</p></main>`;
    app.querySelector("nav").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { tab = b.dataset.t; render(); } });
    const views = { ringkasan: vSummary, pesanan: vOrders, produk: vProducts, kupon: vCoupons, penjual: vSellers, pengguna: vUsers, pengaturan: vSettings };
    await views[tab]($("#main"));
  }
  const guard = (r) => { if (r.status === 401 || r.status === 403) { token = ""; loginView("Sesi berakhir. Masuk lagi."); return false; } return true; };

  /* ---------- Ringkasan ---------- */
  async function vSummary(el) {
    const r = await api("/admin/summary"); if (!guard(r)) return;
    const d = r.data, o = d.orders, p = d.products;
    const st = (n, label, bad) => `<div class="stat ${bad && n ? "alert" : ""}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
    const warn = [];
    if (!d.gateway) warn.push(d.simulatePay ? "Gateway pembayaran belum diatur (mode pengembangan: pembayaran disimulasikan)." : "MIDTRANS_SERVER_KEY belum diatur: hanya COD yang tersedia.");
    if (!d.tariffReviewed) warn.push("Tarif ongkir masih nilai bawaan. Isi tarif kurir sebenarnya di Pengaturan lalu centang 'sudah ditinjau'.");
    if (p.belumDitinjau) warn.push(p.belumDitinjau + " produk belum ditinjau, jadi belum tampil di toko.");
    if (p.tanpaFoto) warn.push(p.tanpaFoto + " produk aktif belum punya foto asli.");
    if (d.maintenance) warn.push("MODE PEMELIHARAAN AKTIF: pembeli melihat halaman pemeliharaan.");
    el.innerHTML = banner() + (warn.length ? `<div class="card"><b>Perlu perhatian</b><ul>${warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : `<div class="msg ok">Tidak ada peringatan konfigurasi.</div>`) +
      `<div class="grid">${st(o.menunggu_pembayaran, "Menunggu pembayaran")}${st(o.perlu_diproses, "Perlu diproses/dikemas", 1)}${st(o.dikirim, "Sedang dikirim")}${st(o.retur, "Retur diajukan", 1)}${st(o.perlu_refund, "Perlu refund", 1)}${st(rp(d.revenue), "Omzet (pesanan aktif)")}${st(d.users, "Pengguna")}${st(d.sellersPending, "Penjual menunggu verifikasi", 1)}${st(p.tampil + " / " + p.total, "Produk tampil")}${st(p.stokTipis, "Stok ≤ 3", 1)}${st(d.couponsActive, "Kupon aktif")}</div>`;
  }

  /* ---------- Pesanan ---------- */
  let ofilter = "", oq = "";
  const STATUSES = ["", "menunggu_pembayaran", "diproses", "dikemas", "dikirim", "selesai", "dibatalkan", "retur_diajukan", "retur_disetujui", "dikembalikan", "perlu_refund"];
  async function vOrders(el) {
    const r = await api("/admin/orders?status=" + encodeURIComponent(ofilter) + "&q=" + encodeURIComponent(oq)); if (!guard(r)) return;
    const list = r.data.orders || [];
    el.innerHTML = banner() + `<div class="card"><div class="row"><label>Status<select id="of">${STATUSES.map((s) => `<option value="${s}" ${s === ofilter ? "selected" : ""}>${s || "Semua"}</option>`).join("")}</select></label>
      <label>Cari (no. pesanan / email / nama)<input id="oq" value="${esc(oq)}"></label></div></div>
      <div class="card scroll"><table><tr><th>Pesanan</th><th>Pembeli</th><th>Total</th><th>Status</th><th>Bayar</th><th></th></tr>
      ${list.map((o) => `<tr><td><b>${esc(o.id)}</b><br><span class="small muted">${dt(o.date)}</span></td><td>${esc(o.recipient)}<br><span class="small muted">${esc(o.email)}</span></td><td>${rp(o.total)}</td>
        <td><span class="tag ${o.status === "selesai" ? "ok" : /batal|kembali/.test(o.status) ? "bad" : "warn"}">${esc(o.status)}</span>${o.refundStatus === "perlu_refund" ? `<br><span class="tag bad">perlu refund</span>` : ""}</td>
        <td>${esc(o.payment)}<br><span class="small muted">${esc(o.paymentStatus)}</span></td><td><button class="btn" data-o="${esc(o.id)}">Buka</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Tidak ada pesanan.</td></tr>`}</table></div>`;
    $("#of").addEventListener("change", (e) => { ofilter = e.target.value; render(); });
    $("#oq").addEventListener("keydown", (e) => { if (e.key === "Enter") { oq = e.target.value; render(); } });
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-o]"); if (b) orderDialog(list.find((x) => x.id === b.dataset.o)); });
  }
  function orderDialog(o) {
    const dlg = document.createElement("dialog");
    const acts = [];
    if (o.status === "menunggu_pembayaran") acts.push(["mark_paid", "Tandai sudah dibayar", "p", "Catatan bukti pembayaran"]);
    if (o.status === "diproses") acts.push(["pack", "Tandai dikemas", "p"]);
    if (["diproses", "dikemas"].includes(o.status)) acts.push(["ship", "Kirim (isi resi)", "p", null, true]);
    if (o.status === "dikirim") acts.push(["deliver", "Tandai selesai/diterima", "p"]);
    if (["menunggu_pembayaran", "diproses", "dikemas"].includes(o.status)) acts.push(["cancel", "Batalkan pesanan", "d", "Alasan pembatalan"]);
    if (o.status === "retur_diajukan") { acts.push(["return_approve", "Setujui retur", "p"]); acts.push(["return_reject", "Tolak retur", "d", "Alasan penolakan"]); }
    if (o.refundStatus === "perlu_refund" || o.status === "retur_disetujui") acts.push(["refund_done", "Refund sudah dikirim", "p", "Referensi refund (mis. ID transaksi refund Midtrans)"]);
    dlg.innerHTML = `<h3>${esc(o.id)} <span class="tag">${esc(o.status)}</span></h3>
      <p class="small">${esc(o.recipient)} · ${esc(o.phone)}<br>${esc(o.address)}, ${esc(o.city)}, ${esc(o.province)} ${esc(o.postal)}<br>Email: ${esc(o.email)}</p>
      <table>${o.items.map((i) => `<tr><td>${i.qty}× ${esc(i.name)}</td><td>${rp(i.price * i.qty)}</td></tr>`).join("")}
      <tr><td>Ongkir (${esc(o.courier)})</td><td>${rp(o.shipping)}</td></tr>${o.discount ? `<tr><td>Diskon ${esc(o.coupon || "")}</td><td>−${rp(o.discount)}</td></tr>` : ""}<tr><th>Total</th><th>${rp(o.total)}</th></tr></table>
      ${o.trackingNo ? `<p>Resi: <b>${esc(o.trackingNo)}</b></p>` : ""}${o.returnReason ? `<p><b>Alasan retur:</b> ${esc(o.returnReason)}</p>` : ""}${o.cancelReason ? `<p><b>Alasan batal:</b> ${esc(o.cancelReason)}</p>` : ""}${o.refundNote ? `<p><b>Refund:</b> ${esc(o.refundNote)}</p>` : ""}
      <div id="dmsg"></div>
      ${acts.length ? `<label>Resi (untuk 'Kirim')<input id="dresi" placeholder="Nomor resi kurir"></label><label>Catatan / alasan<input id="dnote"></label><div class="actions">${acts.map(([a, l, c]) => `<button class="btn ${c}" data-a="${a}">${l}</button>`).join("")}</div>` : `<p class="muted">Tidak ada tindakan untuk status ini.</p>`}
      <h4>Riwayat</h4><ul class="small">${o.events.map((e) => `<li>${dt(e.at)} · ${esc(e.actor)} · ${esc(e.event)}${e.note ? " — " + esc(e.note) : ""}</li>`).join("")}</ul>
      <div class="actions"><button class="btn" id="dclose">Tutup</button></div>`;
    document.body.appendChild(dlg); dlg.showModal();
    $("#dclose", dlg).addEventListener("click", () => { dlg.close(); dlg.remove(); render(); });
    dlg.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      let a = b.dataset.a, body = { note: $("#dnote", dlg).value, trackingNo: $("#dresi", dlg).value };
      if (a === "return_approve") { a = "return_decision"; body.approve = true; }
      if (a === "return_reject") { a = "return_decision"; body.approve = false; }
      body.action = a;
      if (a === "cancel" && !confirm("Batalkan pesanan ini? Stok dikembalikan.")) return;
      b.disabled = true;
      const r = await api("/admin/orders/" + o.id + "/action", { method: "POST", body: JSON.stringify(body) });
      if (!guard(r)) return;
      if (!r.ok) { b.disabled = false; $("#dmsg", dlg).innerHTML = `<div class="msg err">${esc(r.data.message || "Gagal.")}</div>`; return; }
      dlg.close(); dlg.remove(); say("ok", "Pesanan " + o.id + " diperbarui."); render();
    });
  }

  /* ---------- Produk ---------- */
  const CATS = ["batik", "kopi", "kerajinan", "kuliner", "rempah", "fashion"];
  async function vProducts(el) {
    const r = await api("/admin/products"); if (!guard(r)) return;
    const list = r.data.products || [];
    el.innerHTML = banner() + `<div class="card"><button class="btn p" id="np">+ Produk baru</button> <span class="small muted">Produk tampil di toko hanya bila Aktif dan Sudah ditinjau.</span></div>
      <div class="card scroll"><table><tr><th>Foto</th><th>Produk</th><th>Harga</th><th>Stok</th><th>Berat</th><th>Status</th><th></th></tr>
      ${list.map((p) => `<tr><td>${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : `<span class="thumb" title="Belum ada foto">${esc(p.icon)}</span>`}</td>
        <td><b>${esc(p.name)}</b><br><span class="small muted">${esc(p.category)} · ${esc(p.region)}</span></td><td>${rp(p.price)}${p.oldPrice ? `<br><s class="small muted">${rp(p.oldPrice)}</s>` : ""}</td>
        <td>${p.stock}</td><td>${p.weight} g</td><td>${p.active ? `<span class="tag ok">aktif</span>` : `<span class="tag">nonaktif</span>`} ${p.reviewed ? "" : `<span class="tag warn">belum ditinjau</span>`} ${p.image ? "" : `<span class="tag bad">tanpa foto</span>`}</td>
        <td><button class="btn" data-e="${p.id}">Ubah</button></td></tr>`).join("")}</table></div>`;
    $("#np").addEventListener("click", () => productDialog(null));
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (b) productDialog(list.find((x) => x.id === Number(b.dataset.e))); });
  }
  function productDialog(p) {
    const n = !p; p = p || { name: "", category: "kerajinan", region: "", price: 0, stock: 0, weight: 0, icon: "📦", desc: "", active: true, reviewed: false, badge: "", oldPrice: null };
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `<h3>${n ? "Produk baru" : "Ubah produk"}</h3><div id="dmsg"></div><form id="pf">
      <label>Nama<input name="name" value="${esc(p.name)}" required></label>
      <div class="row"><label>Kategori<select name="category">${CATS.map((c) => `<option ${c === p.category ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>Asal (kota, provinsi)<input name="region" value="${esc(p.region)}"></label></div>
      <div class="row"><label>Harga (Rp)<input name="price" type="number" min="100" value="${p.price}"></label><label>Harga coret / sebelum promo (opsional)<input name="oldPrice" type="number" value="${p.oldPrice || ""}"></label></div>
      <div class="row"><label>Stok<input name="stock" type="number" min="0" value="${p.stock}"></label><label>Berat paket (gram)<input name="weight" type="number" min="1" value="${p.weight}"></label></div>
      <div class="row"><label>Label (opsional)<input name="badge" maxlength="20" value="${esc(p.badge || "")}"></label><label>Ikon cadangan<input name="icon" maxlength="4" value="${esc(p.icon)}"></label></div>
      <label>Deskripsi<textarea name="description" rows="3">${esc(p.desc)}</textarea></label>
      <label><input type="checkbox" name="active" ${p.active ? "checked" : ""} style="width:auto"> Aktif</label>
      <label><input type="checkbox" name="reviewed" ${p.reviewed ? "checked" : ""} style="width:auto"> Data sudah ditinjau (nama, deskripsi, harga, asal, berat benar)</label>
      ${n ? "" : `<label>Foto produk asli (JPG/PNG/WEBP, maks 4 MB)<input type="file" id="pimg" accept="image/jpeg,image/png,image/webp"></label>${p.image ? `<img class="thumb" style="width:90px;height:90px" src="${esc(p.image)}" alt="">` : ""}`}
      <div class="actions"><button class="btn p" type="submit">Simpan</button><button class="btn" type="button" id="dclose">Batal</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $("#dclose", dlg).addEventListener("click", () => { dlg.close(); dlg.remove(); });
    $("#pf", dlg).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), body = {};
      for (const k of ["name", "category", "region", "badge", "icon", "description"]) body[k] = fd.get(k);
      for (const k of ["price", "stock", "weight"]) body[k] = Number(fd.get(k));
      body.oldPrice = fd.get("oldPrice") ? Number(fd.get("oldPrice")) : null;
      body.active = !!fd.get("active");
      if (!n) body.reviewed = !!fd.get("reviewed");
      const r = await api(n ? "/admin/products" : "/admin/products/" + p.id, { method: n ? "POST" : "PUT", body: JSON.stringify(body) });
      if (!guard(r)) return;
      if (!r.ok) { $("#dmsg", dlg).innerHTML = `<div class="msg err">${esc(r.data.message || "Gagal.")}</div>`; return; }
      const f = $("#pimg", dlg) && $("#pimg", dlg).files[0];
      if (f) {
        const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(f); });
        const ir = await api("/admin/products/" + p.id + "/image", { method: "POST", body: JSON.stringify({ data: b64 }) });
        if (!ir.ok) { $("#dmsg", dlg).innerHTML = `<div class="msg err">Data tersimpan, tetapi foto gagal: ${esc(ir.data.message || "")}</div>`; return; }
      }
      dlg.close(); dlg.remove(); say("ok", "Produk disimpan." + (n ? " Buka lagi produknya untuk mengunggah foto." : "")); render();
    });
  }

  /* ---------- Kupon ---------- */
  async function vCoupons(el) {
    const r = await api("/admin/coupons"); if (!guard(r)) return;
    const list = r.data.coupons || [];
    el.innerHTML = banner() + `<div class="card"><p class="small muted">Hanya kupon yang Anda aktifkan yang berlaku. Kupon bawaan awalnya nonaktif; aktifkan yang disetujui pemilik dan hapus kupon uji.</p><button class="btn p" id="nc">+ Kupon</button></div>
      <div class="card scroll"><table><tr><th>Kode</th><th>Jenis</th><th>Nilai</th><th>Min. belanja</th><th>Poin</th><th>Dipakai</th><th>Kedaluwarsa</th><th>Status</th><th></th></tr>
      ${list.map((c) => `<tr><td><b>${esc(c.code)}</b><br><span class="small muted">${esc(c.label)}</span></td><td>${esc(c.type)}</td><td>${c.type === "pct" ? c.value + "%" : c.type === "flat" ? rp(c.value) : "-"}</td><td>${rp(c.min_subtotal)}</td><td>${c.points_cost || "-"}</td><td>${c.used}${c.max_uses ? " / " + c.max_uses : ""}</td><td>${c.expires ? dt(c.expires) : "-"}</td>
      <td>${c.active ? `<span class="tag ok">aktif</span>` : `<span class="tag">nonaktif</span>`}</td><td><button class="btn" data-e="${esc(c.code)}">Ubah</button> <button class="btn d" data-x="${esc(c.code)}">Hapus</button></td></tr>`).join("")}</table></div>`;
    $("#nc").addEventListener("click", () => couponDialog(null));
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-e]"), x = e.target.closest("[data-x]");
      if (b) couponDialog(list.find((c) => c.code === b.dataset.e));
      if (x && confirm("Hapus kupon " + x.dataset.x + "?")) { const r2 = await api("/admin/coupons/" + encodeURIComponent(x.dataset.x), { method: "DELETE" }); if (guard(r2)) { say("ok", "Kupon dihapus."); render(); } }
    });
  }
  function couponDialog(c) {
    const n = !c; c = c || { code: "", type: "pct", value: 10, min_subtotal: 0, points_cost: 0, label: "", active: 0, expires: null, max_uses: null };
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `<h3>${n ? "Kupon baru" : "Ubah kupon"}</h3><div id="dmsg"></div><form id="cf">
      <div class="row"><label>Kode<input name="code" value="${esc(c.code)}" ${n ? "" : "readonly"} maxlength="20"></label><label>Jenis<select name="type">${[["pct", "Persen"], ["flat", "Potongan Rp"], ["ship", "Gratis ongkir"]].map(([k, l]) => `<option value="${k}" ${k === c.type ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <div class="row"><label>Nilai (% atau Rp)<input name="value" type="number" value="${c.value}"></label><label>Min. belanja (Rp)<input name="min" type="number" value="${c.min_subtotal}"></label></div>
      <div class="row"><label>Biaya poin (0 = tidak pakai poin)<input name="pts" type="number" value="${c.points_cost}"></label><label>Maks. pemakaian (kosong = tanpa batas)<input name="maxUses" type="number" value="${c.max_uses || ""}"></label></div>
      <label>Kedaluwarsa (opsional)<input name="expires" type="datetime-local" value="${c.expires ? new Date(c.expires).toISOString().slice(0, 16) : ""}"></label>
      <label>Label tampil<input name="label" value="${esc(c.label)}" maxlength="60"></label>
      <label><input type="checkbox" name="active" ${c.active ? "checked" : ""} style="width:auto"> Aktif (berlaku untuk pembeli)</label>
      <div class="actions"><button class="btn p">Simpan</button><button class="btn" type="button" id="dclose">Batal</button></div></form>`;
    document.body.appendChild(dlg); dlg.showModal();
    $("#dclose", dlg).addEventListener("click", () => { dlg.close(); dlg.remove(); });
    $("#cf", dlg).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { code: fd.get("code"), type: fd.get("type"), value: Number(fd.get("value")), min: Number(fd.get("min")), pts: Number(fd.get("pts")), maxUses: fd.get("maxUses") ? Number(fd.get("maxUses")) : null, expires: fd.get("expires") || null, label: fd.get("label"), active: !!fd.get("active") };
      const r = await api("/admin/coupons", { method: "POST", body: JSON.stringify(body) });
      if (!guard(r)) return;
      if (!r.ok) { $("#dmsg", dlg).innerHTML = `<div class="msg err">${esc(r.data.message || "Gagal.")}</div>`; return; }
      dlg.close(); dlg.remove(); say("ok", "Kupon disimpan."); render();
    });
  }

  /* ---------- Penjual & pengguna ---------- */
  async function vSellers(el) {
    const r = await api("/admin/sellers"); if (!guard(r)) return;
    const list = r.data.sellers || [];
    el.innerHTML = banner() + `<div class="card scroll"><table><tr><th>Usaha</th><th>Pemilik</th><th>Kota</th><th>WhatsApp</th><th>Status</th><th></th></tr>
      ${list.map((s) => `<tr><td><b>${esc(s.shop)}</b><br><span class="small muted">${esc(s.category)} · ${dt(s.created)}</span></td><td>${esc(s.owner_email)}</td><td>${esc(s.city)}</td><td>${esc(s.wa)}</td><td><span class="tag ${s.status === "verified" ? "ok" : s.status === "rejected" ? "bad" : "warn"}">${esc(s.status)}</span></td>
      <td><button class="btn p" data-s="${s.id}" data-v="verified">Verifikasi</button> <button class="btn d" data-s="${s.id}" data-v="rejected">Tolak</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Belum ada pendaftar.</td></tr>`}</table>
      <p class="small muted">Catatan: penjual terverifikasi tercatat di sini. Produk baru ditambahkan lewat tab Produk oleh admin; dasbor mandiri penjual belum tersedia.</p></div>`;
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-s]"); if (!b) return;
      const r2 = await api("/admin/sellers/" + b.dataset.s, { method: "POST", body: JSON.stringify({ status: b.dataset.v }) });
      if (guard(r2)) { say("ok", "Status penjual diperbarui."); render(); }
    });
  }
  async function vUsers(el) {
    const r = await api("/admin/users"); if (!guard(r)) return;
    el.innerHTML = banner() + `<div class="card scroll"><table><tr><th>Nama</th><th>Email</th><th>Daftar</th><th>Verifikasi</th><th>Pesanan</th><th></th></tr>
      ${(r.data.users || []).map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${dt(u.joined)}</td><td>${u.verified ? "ya" : "belum"}</td><td>${u.orders}</td><td>${u.admin ? `<span class="tag">admin</span>` : ""}</td></tr>`).join("")}</table>
      <p class="small muted">Permintaan penghapusan data: pengguna bisa menghapus akunnya sendiri dari menu Keamanan akun. Untuk permintaan lewat email, hapus dengan skrip <code>bersihkan-data-uji.js</code> (lihat RUNBOOK.md).</p></div>`;
  }

  /* ---------- Pengaturan ---------- */
  async function vSettings(el) {
    const r = await api("/admin/settings"); if (!guard(r)) return;
    const s = r.data, zones = Object.keys(s.zones);
    el.innerHTML = banner() + `<form id="sf"><div class="card"><h3>Umum</h3><div class="row">
      <label>Gratis ongkir mulai (Rp)<input name="freeShipMin" type="number" value="${s.freeShipMin}"></label>
      <label>Batas COD (Rp)<input name="codMax" type="number" value="${s.codMax}"></label>
      <label>Batas retur (hari)<input name="returnDays" type="number" value="${s.returnDays}"></label>
      <label>Batas bayar (jam)<input name="payWindowHours" type="number" value="${s.payWindowHours}"></label></div></div>
      <div class="card"><h3>Mode pemeliharaan</h3><label><input type="checkbox" name="maintenance" ${s.maintenance ? "checked" : ""} style="width:auto"> Tutup toko sementara (pembeli melihat halaman pemeliharaan; dasbor ini tetap bisa dibuka)</label>${s.maintenanceEnv ? `<p class="small">MAINTENANCE=1 aktif di environment server dan menimpa pilihan ini.</p>` : ""}</div>
      <div class="card scroll"><h3>Tarif ongkir per kg (Rp)</h3><p class="small muted">Biaya = tarif zona × berat dibulatkan ke atas per kg (minimal 1 kg). Samakan dengan tarif kurir yang Anda pakai.</p>
      <table><tr><th>Kurir (id)</th><th>Nama</th>${zones.map((z) => `<th>${esc(s.zones[z])}</th>`).join("")}<th>Tautan lacak (https)</th></tr>
      ${s.tariff.couriers.map((c, i) => `<tr><td><input data-c="${i}" data-f="id" value="${esc(c.id)}" style="width:80px"></td><td><input data-c="${i}" data-f="name" value="${esc(c.name)}"></td>${zones.map((z) => `<td><input type="number" data-c="${i}" data-z="${z}" value="${c.perKg[z]}" style="width:90px"></td>`).join("")}<td><input data-c="${i}" data-f="trackUrl" value="${esc(c.trackUrl || "")}" placeholder="https://..."></td></tr>`).join("")}</table>
      <label style="margin-top:10px"><input type="checkbox" name="tariffReviewed" ${s.tariffReviewed ? "checked" : ""} style="width:auto"> Tarif di atas sudah ditinjau dan sesuai tarif kurir sebenarnya</label></div>
      <button class="btn p">Simpan pengaturan</button></form>`;
    $("#sf").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const couriers = s.tariff.couriers.map((c, i) => {
        const o = { id: $(`[data-c="${i}"][data-f="id"]`).value.trim(), name: $(`[data-c="${i}"][data-f="name"]`).value.trim(), trackUrl: $(`[data-c="${i}"][data-f="trackUrl"]`).value.trim(), perKg: {} };
        zones.forEach((z) => { o.perKg[z] = Number($(`[data-c="${i}"][data-z="${z}"]`).value); });
        return o;
      });
      const body = { freeShipMin: Number(fd.get("freeShipMin")), codMax: Number(fd.get("codMax")), returnDays: Number(fd.get("returnDays")), payWindowHours: Number(fd.get("payWindowHours")), maintenance: !!fd.get("maintenance"), tariffReviewed: !!fd.get("tariffReviewed"), tariff: { couriers } };
      const r2 = await api("/admin/settings", { method: "PUT", body: JSON.stringify(body) });
      if (!guard(r2)) return;
      say(r2.ok ? "ok" : "err", r2.ok ? "Pengaturan disimpan." : (r2.data.message || "Gagal menyimpan.")); render();
    });
  }

  boot();
})();