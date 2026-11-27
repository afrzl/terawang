"use strict";
// Panel admin TERAWANG. Semua teks dari server dimasukkan lewat textContent (log pipeline bisa berisi apa saja).

const API = "/admin/api";
const $ = (s, r = document) => r.querySelector(s);

function el(tag, attr = {}, ...anak) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const a of anak.flat()) if (a != null && a !== false) e.append(a instanceof Node ? a : String(a));
  return e;
}

async function api(path, opsi = {}) {
  const r = await fetch(API + path, {
    credentials: "same-origin",
    ...opsi,
    headers: { "X-Terawang-Admin": "1", ...(opsi.json !== undefined ? { "Content-Type": "application/json" } : {}), ...(opsi.headers || {}) },
    body: opsi.json !== undefined ? JSON.stringify(opsi.json) : opsi.body,
  });
  let data = {};
  try { data = await r.json(); } catch { /* bukan JSON */ }
  if (r.status === 401 && path !== "/masuk") { tampilMasuk(); throw new Error(data.galat || "Sesi habis, silakan masuk lagi."); }
  if (!r.ok) throw new Error(data.galat || `Galat HTTP ${r.status}`);
  return data;
}

let toastTimer;
function toast(pesan, gagal = false) {
  const t = $("#toast");
  t.textContent = pesan;
  t.className = "toast" + (gagal ? " gagal" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), gagal ? 9000 : 5000);
}

async function sibuk(tombol, fn) {
  const teks = tombol.textContent;
  tombol.disabled = true;
  tombol.textContent = "Memproses…";
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { tombol.disabled = false; tombol.textContent = teks; }
}

// ---------- format ----------
const fmtWaktu = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const fmtJam = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });
const waktu = (dtk) => (dtk ? fmtWaktu.format(new Date(dtk * 1000)) + " WIB" : "–");
function relatif(dtk) {
  if (!dtk) return "belum pernah";
  const s = Date.now() / 1000 - dtk;
  if (s < 90) return "baru saja";
  if (s < 3600) return `${Math.round(s / 60)} menit lalu`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hari lalu`;
}
function durasi(a, b) {
  if (!a) return "–";
  const s = Math.max(0, (b || Date.now() / 1000) - a);
  if (s < 60) return `${Math.round(s)} dtk`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt ${Math.round(s % 60)} dtk`;
  return `${Math.floor(s / 3600)} j ${Math.round((s % 3600) / 60)} mnt`;
}
function ukuran(b) {
  if (b == null) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
const STATUS = {
  SUCCESS: ["Berhasil", "ok"], FAILURE: ["Gagal", "gagal"], CANCELED: ["Dibatalkan", "waspada"], CANCELING: ["Membatalkan", "waspada"],
  STARTED: ["Berjalan", "jalan"], STARTING: ["Memulai", "jalan"], IN_PROGRESS: ["Berjalan", "jalan"], QUEUED: ["Antre", "jalan"],
  NOT_STARTED: ["Belum mulai", ""], SKIPPED: ["Dilewati", "waspada"], MANAGED: ["Dikelola", ""],
};
const lencana = (st) => { const [t, k] = STATUS[st] || [st ? st.toLowerCase() : "Belum pernah", ""]; return el("span", { class: "pill" + (k ? " st-" + k : "") }, t); };

// ---------- navigasi & sesi ----------
let halAktif = "pipeline";
const pemuat = {};
const JUDUL_HAL = { pipeline: "Ringkasan pipeline", laporan: "Laporan harga warga", whatsapp: "Bot WhatsApp", konfigurasi: "Konfigurasi & secret", akun: "Akun & peran", jejak: "Jejak admin" };
const HAK_HAL = { pipeline: "pipeline", laporan: "laporan", whatsapp: "pipeline", konfigurasi: "konfigurasi", akun: "akun", jejak: "jejak" };

let sesi = null;
let daftarSumber = [];
const punya = (hak) => !!sesi?.hak?.includes(hak);

// Di layar sempit tabel tampil sebagai kartu; tiap sel diberi label dari kepala kolomnya.
function labeli(tabel) {
  const judul = [...tabel.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  for (const tr of tabel.tBodies[0]?.rows || []) {
    if (tr.cells.length === 1 && tr.cells[0].colSpan > 1) continue;
    [...tr.cells].forEach((td, i) => { if (judul[i]) td.dataset.label = judul[i]; });
  }
}

function laci(buka) {
  document.body.classList.toggle("laci-buka", buka);
  $("#tirai").hidden = !buka;
  $("#tombol-menu").setAttribute("aria-expanded", String(buka));
}

function tampilMasuk() {
  sesi = null;
  laci(false);
  $("#layar-tanpa-akses").hidden = true;
  $("#layar-masuk").hidden = false;
  $("#sisi").hidden = true;
  $("#bilah-atas").hidden = true;
  $("#kerangka").classList.add("tanpa-sisi");
  document.querySelectorAll(".bagian").forEach((b) => (b.hidden = true));
  clearInterval(intervalPipeline);
}

function halTersedia() {
  const hal = Object.keys(HAK_HAL).filter((h) => punya(HAK_HAL[h]));
  if (punya("pipeline")) hal.push(...daftarSumber.map((s) => "sumber-" + s.id));
  return hal;
}

function pilihHal(nama, sub) {
  const ada = halTersedia();
  if (nama === "riwayat" || nama === "unggah") { sub = nama; nama = daftarSumber[0] ? "sumber-" + daftarSumber[0].id : "pipeline"; }
  if (!ada.includes(nama)) nama = ada[0];
  if (!nama) return;
  halAktif = nama;
  const bagian = nama.startsWith("sumber-") ? "sumber" : nama;
  document.querySelectorAll("#menu a[data-hal]").forEach((a) => (a.getAttribute("data-hal") === nama ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.querySelectorAll(".bagian").forEach((b) => (b.hidden = b.id !== "bagian-" + bagian));
  const s = daftarSumber.find((x) => "sumber-" + x.id === nama);
  const judul = s ? s.label : JUDUL_HAL[nama] || "Admin";
  $("#judul-halaman").textContent = judul;
  document.title = judul + " · Admin TERAWANG";
  laci(false);
  try { history.replaceState(null, "", "#" + nama + (sub && sub !== "riwayat" ? "/" + sub : "")); } catch { /* abaikan */ }
  window.scrollTo(0, 0);
  if (s) muatHalamanSumber(s, sub || "riwayat"); else pemuat[nama]?.();
}

const KODE_SUMBER = { bps: "BPS", bulog: "BLG", harga: "HRG", jarak: "JRK", bapanas: "BPN", citra: "SAT", iklim: "IKL" };
function gambarMenuSumber() {
  const wadah = $("#menu-sumber");
  wadah.replaceChildren(...daftarSumber.map((s) => {
    const a = el("a", { href: "#sumber-" + s.id, "data-hal": "sumber-" + s.id },
      el("span", { class: "k" }, KODE_SUMBER[s.id] || s.id.slice(0, 3).toUpperCase()), el("span", { class: "lbl" }, s.label),
      el("i", { class: "titik", id: "titik-" + s.id, "aria-hidden": "true" }));
    a.addEventListener("click", (e) => { e.preventDefault(); pilihHal("sumber-" + s.id); });
    return a;
  }));
  perbaruiTitik();
}

// titik status di menu: kondisi terburuk dari aset sumber itu
function statusSumber(s) {
  if (!dataPipeline) return "";
  const aset = dataPipeline.aset.filter((a) => s.aset.includes(a.nama));
  if (aset.some((a) => a.status === "FAILURE")) return "gagal";
  if (aset.some((a) => a.cek.some((c) => c.status === "FAILED" || c.status === "EXECUTION_FAILED"))) return "waspada";
  if (aset.some((a) => a.status === "IN_PROGRESS" || a.antre)) return "jalan";
  if (aset.length && aset.every((a) => a.status === "SUCCESS")) return "ok";
  return "";
}
function perbaruiTitik() {
  for (const s of daftarSumber) {
    const t = document.getElementById("titik-" + s.id);
    if (!t) continue;
    const st = statusSumber(s);
    t.className = "titik " + st;
    t.title = { gagal: "Ada aset gagal", waspada: "Cek konektor tidak lolos", jalan: "Sedang berjalan", ok: "Berhasil" }[st] || "";
  }
}

function tujuanKembali() {
  // ?kembali=/harga dari dasbor; hanya path relatif di situs ini
  const k = new URLSearchParams(location.search).get("kembali");
  return k && k.startsWith("/") && !k.startsWith("//") && !k.startsWith("/\\") ? k : null;
}

async function masukBerhasil(d, baruMasuk = false) {
  sesi = d;
  const kembali = tujuanKembali();
  if (baruMasuk && kembali) { location.href = kembali; return; }
  $("#layar-masuk").hidden = true;
  $("#nama-pengguna").textContent = d.pengguna;
  $("#peran-pengguna").textContent = d.labelPeran;
  $("#inisial-pengguna").textContent = (d.pengguna || "?").trim().charAt(0);
  document.querySelectorAll("[data-hak]").forEach((e) => (e.hidden = !punya(e.dataset.hak)));
  if (!Object.values(HAK_HAL).some(punya)) {
    $("#nama-tanpa-akses").textContent = d.pengguna;
    $("#peran-tanpa-akses").textContent = d.labelPeran;
    $("#layar-tanpa-akses").hidden = false;
    return;
  }
  $("#kerangka").classList.remove("tanpa-sisi");
  $("#sisi").hidden = false;
  $("#bilah-atas").hidden = false;
  if (punya("pipeline")) {
    try { daftarSumber = (await api("/sumber-data")).sumber; } catch (e) { daftarSumber = []; toast(e.message, true); }
    gambarMenuSumber();
    if (!dataPipeline) api("/pipeline").then((x) => { dataPipeline = x; perbaruiTitik(); }).catch(() => {});
  }
  if (punya("laporan")) api("/laporan?status=MENUNGGU").then((x) => tandaiJumlahLaporan(x.jumlah.MENUNGGU)).catch(() => {});
  const [awal, sub] = location.hash.slice(1).split("/");
  pilihHal(awal || "pipeline", sub);
  clearInterval(intervalPipeline);
  intervalPipeline = setInterval(() => { if (halAktif === "pipeline" && !document.hidden) muatPipeline(true); }, 30000);
}

// ---------- pipeline ----------
let intervalPipeline;
let runTerbuka = null;
let dataPipeline = null;

async function muatPipeline(diam = false) {
  try {
    dataPipeline = await api("/pipeline");
    gambarPipeline(dataPipeline);
    perbaruiTitik();
    $("#info-perbarui").textContent = "Diperbarui " + fmtJam.format(new Date()) + " WIB · otomatis tiap 30 detik";
  } catch (e) {
    $("#info-perbarui").textContent = "Gagal memuat";
    const p = $("#peringatan-pipeline");
    p.replaceChildren(el("p", { class: "alert" }, e.message));
    if (!diam) toast(e.message, true);
  }
}

const cekGagalDari = (a) => (a.cek || []).filter((c) => c.status === "FAILED" || c.status === "EXECUTION_FAILED");
function tautanUnggah(idSumber) {
  return el("a", { class: "tautan", href: "#sumber-" + idSumber + "/unggah", onclick: (e) => { e.preventDefault(); e.stopPropagation(); pilihHal("sumber-" + idSumber, "unggah"); } }, "Unggah manual");
}
function tautanLog(runId) {
  return el("a", { class: "tautan", href: "#", onclick: (e) => { e.preventDefault(); e.stopPropagation(); bukaLog(runId); } }, "Lihat log");
}

function gambarPipeline(d) {
  const pilih = $("#pilih-job");
  if (!pilih.options.length) for (const [j, ket] of Object.entries(d.job)) pilih.append(el("option", { value: j }, j));

  const gagal = d.aset.filter((a) => a.status === "FAILURE");
  const jalan = d.aset.filter((a) => a.status === "IN_PROGRESS" || a.antre);
  const ok = d.aset.filter((a) => a.status === "SUCCESS");
  const cekGagal = d.aset.filter((a) => cekGagalDari(a).length);
  const runGagal24 = d.run.filter((r) => r.status === "FAILURE" && r.mulai > Date.now() / 1000 - 86400);
  const daemonSakit = d.daemon.filter((x) => !x.sehat);
  const kpi = (v, k, t, kelas = "") => el("div", { class: "kpi " + kelas }, el("div", { class: "v" }, v), el("div", { class: "k" }, k), t ? el("div", { class: "t" }, t) : null);
  $("#ringkas-aset").replaceChildren(
    kpi([String(ok.length), el("small", {}, ` / ${d.aset.length}`)], "aset berhasil di run terakhirnya", jalan.length ? `${jalan.length} sedang berjalan atau antre` : "tidak ada yang antre"),
    kpi(String(gagal.length), "aset gagal", gagal.length ? gagal.map((a) => a.nama).join(", ") : "semua langkah lolos", gagal.length ? "crit" : ""),
    kpi(String(cekGagal.length), "cek konektor tidak lolos", cekGagal.length ? "sumber otomatis bermasalah, data cadangan dipakai" : "konektor sehat", cekGagal.length ? "warn" : ""),
    kpi(String(runGagal24.length), "run gagal 24 jam", d.run[0] ? `run terakhir ${relatif(d.run[0].mulai)}` : "", runGagal24.length ? "crit" : ""),
    kpi(daemonSakit.length ? "Mati" : "Sehat", "daemon jadwal & sensor", daemonSakit.length ? daemonSakit.map((x) => x.jenis.toLowerCase()).join(", ") : "jadwal berjalan", daemonSakit.length ? "crit" : ""),
  );

  const peringatan = [];
  if (daemonSakit.length) peringatan.push(el("p", { class: "alert" }, `Daemon Dagster tidak sehat, jadi jadwal dan sensor tidak berjalan. ${punya("konfigurasi") ? 'Coba "Muat ulang Dagster" di halaman Konfigurasi.' : "Hubungi superadmin."}`));
  for (const a of gagal) {
    const p = el("p", { class: "alert" }, el("b", {}, a.nama), ` gagal ${relatif(a.selesai)}. `, a.runId ? tautanLog(a.runId) : null);
    if (a.sumberManual && punya("unggah")) p.append(" · ", tautanUnggah(a.sumberManual));
    peringatan.push(p);
  }
  for (const a of d.aset) for (const c of cekGagalDari(a)) {
    const p = el("p", { class: "alert" + (c.keparahan === "ERROR" ? "" : " warn") }, el("b", {}, a.nama), ` cek ${c.nama}: ${c.pesan || c.ket || "tidak lolos"} (${relatif(c.waktu)}). `);
    if (c.runId) p.append(tautanLog(c.runId));
    if (a.sumberManual && punya("unggah")) p.append(" · ", tautanUnggah(a.sumberManual));
    peringatan.push(p);
  }
  $("#peringatan-pipeline").replaceChildren(...peringatan);

  const urutGrup = ["bronze", "silver", "model", "status"];
  const urut = (g) => (urutGrup.includes(g) ? urutGrup.indexOf(g) : 99);
  const grup = [...new Set(d.aset.map((a) => a.grup))].sort((a, b) => urut(a) - urut(b));
  const baris = [];
  for (const g of grup) {
    baris.push(el("div", { class: "br-grup" }, g));
    for (const a of d.aset.filter((x) => x.grup === g)) {
      const cg = cekGagalDari(a);
      const hal = daftarSumber.find((x) => x.aset.includes(a.nama));
      baris.push(el("div", { class: "br" + (a.status === "FAILURE" ? " gagal" : cg.length ? " waspada" : "") + (a.runId ? " klik" : ""), onclick: a.runId ? () => bukaLog(a.runId) : null },
        el("div", { class: "nm" },
          el("div", { class: "id" }, a.nama, hal ? el("a", { href: "#sumber-" + hal.id, onclick: (e) => { e.preventDefault(); e.stopPropagation(); pilihHal("sumber-" + hal.id); } }, "riwayat") : null),
          ...cg.map((c) => el("div", { class: "wr" }, "Cek " + c.nama + ": " + (c.pesan || "tidak lolos"))),
          a.status === "FAILURE" && a.sumberManual && punya("unggah") ? el("div", { class: "er" }, "Gagal. ", tautanUnggah(a.sumberManual)) : null),
        el("div", { class: "st" }, lencana(a.antre && a.status !== "IN_PROGRESS" ? a.status : a.status)),
        el("div", { class: "wkt", title: "Terakhir jalan " + waktu(a.selesai || a.mulai) + "\nData terakhir " + waktu(a.materialisasi) },
          relatif(a.selesai || a.mulai), el("span", {}, a.antre ? "+ run antre" : "data " + relatif(a.materialisasi)))));
    }
  }
  $("#daftar-aset").replaceChildren(...baris);

  $("#daftar-run").replaceChildren(...d.run.map((r) => el("div", {
    class: "br klik" + (r.status === "FAILURE" ? " gagal" : "") + (r.runId === runTerbuka ? " dipilih" : ""), onclick: () => bukaLog(r.runId), title: r.runId, dataset: { run: r.runId },
  },
    el("div", { class: "nm" }, el("div", { class: "id" }, r.job), el("div", { class: "ds" }, r.pemicu),
      r.langkahGagal.length ? el("div", { class: "er" }, "Gagal di " + r.langkahGagal.join(", ")) : null),
    el("div", { class: "st" }, lencana(r.status)),
    el("div", { class: "wkt" }, waktu(r.mulai).replace(" WIB", ""), el("span", {}, durasi(r.mulai, r.selesai))))));
}

let logData = null;
async function bukaLog(runId) {
  runTerbuka = runId;
  const panel = $("#panel-log");
  panel.hidden = false;
  $("#judul-log").textContent = "Log run " + runId.slice(0, 8);
  $("#info-log").textContent = "Memuat…";
  $("#isi-log").replaceChildren();
  document.querySelectorAll("#daftar-run .br").forEach((b) => b.classList.toggle("dipilih", b.dataset.run === runId));
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    logData = await api(`/run/${encodeURIComponent(runId)}/log`);
    const r = logData.run;
    $("#info-log").replaceChildren(`${r.jobName} · `, lencana(r.status), ` · mulai ${waktu(r.startTime)} · durasi ${durasi(r.startTime, r.endTime)} · ${logData.event.length} event`);
    const adaGalat = logData.event.some((e) => e.level === "ERROR" || e.galat);
    $("#hanya-galat").checked = adaGalat && r.status === "FAILURE";
    gambarLog();
  } catch (e) {
    $("#info-log").textContent = e.message;
  }
}

function gambarLog() {
  if (!logData) return;
  const hanya = $("#hanya-galat").checked;
  const ev = logData.event.filter((e) => !hanya || e.galat || e.level === "ERROR" || e.level === "WARNING" || e.level === "CRITICAL");
  const isi = ev.map((e) => {
    const lvl = e.galat ? "ERROR" : e.level || "INFO";
    const b = el("div", { class: "log-baris " + lvl },
      el("span", { class: "wkt" }, e.waktu ? fmtJam.format(new Date(e.waktu * 1000)) : ""),
      el("span", { class: "lvl" }, lvl),
      el("span", { class: "lgk" }, e.langkah || ""),
      el("span", { class: "psn" }, e.pesan || e.jenis));
    if (e.galat) {
      b.append(el("details", { open: true }, el("summary", {}, "Rincian galat"),
        el("pre", {}, (e.galat.sebab?.length ? "Penyebab: " + e.galat.sebab.join("\n") + "\n\n" : "") + e.galat.pesan),
        e.galat.jejak ? el("details", {}, el("summary", {}, "Stack trace"), el("pre", {}, e.galat.jejak)) : null));
    }
    return b;
  });
  $("#isi-log").replaceChildren(...(isi.length ? isi : [el("p", { class: "kosong" }, "Tidak ada event yang cocok.")]));
}

pemuat.pipeline = () => muatPipeline();

// ---------- riwayat data ----------
let riwayatData = null;
const JENIS = {
  baru: ["Data baru", "ok"], sama: ["Tidak berubah", ""], pertama: ["Data pertama", "ok"], gagal: ["Gagal", "gagal"],
  unggah: ["Unggah manual", "jalan"], tarik: ["Unggahan ditarik", "waspada"], konfigurasi: ["Ubah konfigurasi", "waspada"],
};
function teksMd(v) { return String(v ?? "").replace(/[`*]/g, "").replace(/^- /gm, "").trim(); }

let sumberAktif = null;

async function muatHalamanSumber(s, sub = "riwayat") {
  sumberAktif = s;
  $("#judul-sumber").textContent = s.label;
  $("#ket-sumber").replaceChildren(...(s.env ? [punya("konfigurasi")
    ? el("a", { class: "pill st-jalan", href: "#konfigurasi", title: s.env, onclick: (e) => { e.preventDefault(); pilihHal("konfigurasi"); } }, "mode " + (s.mode || "kosong"))
    : el("span", { class: "pill", title: s.env }, "mode " + (s.mode || "kosong"))] : []));
  const bisaUnggah = s.unggah && punya("unggah");
  $("#tab-unggah").hidden = !bisaUnggah;
  pilihSub(!bisaUnggah && sub === "unggah" ? "riwayat" : sub);
  pratinjauAktif = null;
  $("#judul-pratinjau").textContent = "Isi berkas";
  $("#info-pratinjau").textContent = "";
  $("#isi-pratinjau").replaceChildren(el("p", { class: "kosong" }, "Pilih berkas untuk melihat isinya."));
  $("#daftar-data").replaceChildren();
  gambarStatusSumber(s);
  if (!dataPipeline) api("/pipeline").then((x) => { dataPipeline = x; perbaruiTitik(); if (sumberAktif === s) gambarStatusSumber(s); }).catch(() => {});
  await Promise.all([muatRiwayat(s), muatData(s), bisaUnggah ? muatUnggahSumber(s) : null]);
}

function pilihSub(sub) {
  document.querySelectorAll("#sub-tab-sumber button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.sub === sub)));
  $("#sub-riwayat").hidden = sub !== "riwayat";
  $("#sub-unggah").hidden = sub !== "unggah";
  $("#sub-data").hidden = sub !== "data";
  if (sumberAktif) try { history.replaceState(null, "", "#sumber-" + sumberAktif.id + (sub !== "riwayat" ? "/" + sub : "")); } catch { /* abaikan */ }
}

function gambarStatusSumber(s) {
  const wadah = $("#status-sumber");
  wadah.classList.toggle("satu", s.aset.length === 1);
  if (!dataPipeline) { wadah.replaceChildren(el("div", { class: "kpi" }, el("div", { class: "k" }, "Memuat status…"))); return; }
  wadah.replaceChildren(...s.aset.flatMap((nama) => {
    const a = dataPipeline.aset.find((x) => x.nama === nama);
    if (!a) return [el("div", { class: "kpi" }, el("div", { class: "nama" }, nama), el("div", { class: "k" }, "Aset belum terdaftar di Dagster."))];
    const cg = cekGagalDari(a);
    const [teks] = STATUS[a.status] || ["Belum pernah"];
    return [
      el("div", { class: "kpi" + (a.status === "FAILURE" ? " crit" : "") },
        el("div", { class: "nama" }, a.nama), el("div", { class: "v" }, teks), el("div", { class: "k" }, "langkah terakhir, " + relatif(a.selesai || a.mulai)),
        a.runId ? el("div", { class: "aksi" }, el("button", { class: "tombol kecil", type: "button", onclick: () => { pilihHal("pipeline"); setTimeout(() => bukaLog(a.runId), 200); } }, "Log run"),
          a.status === "FAILURE" && s.unggah && punya("unggah") ? el("button", { class: "tombol kecil bahaya", type: "button", onclick: () => pilihSub("unggah") }, "Unggah manual") : null) : null),
      el("div", { class: "kpi" }, el("div", { class: "nama" }, "data terakhir"), el("div", { class: "v" }, relatif(a.materialisasi)), el("div", { class: "k" }, waktu(a.materialisasi))),
      el("div", { class: "kpi" + (cg.length ? " warn" : "") }, el("div", { class: "nama" }, "konektor otomatis"),
        el("div", { class: "v" }, cg.length ? "Gagal" : a.cek?.length ? "Lolos" : "–"),
        el("div", { class: "k" }, cg.length ? cg.map((c) => c.pesan || c.nama).join("; ") : a.cek?.length ? "cek terakhir lolos" : "tidak ada cek konektor")),
    ];
  }));
}

async function muatRiwayat(s = sumberAktif) {
  if (!s) return;
  const wadah = $("#daftar-riwayat");
  wadah.replaceChildren(el("p", { class: "kosong" }, "Memuat…"));
  try {
    const d = await api("/riwayat?sumber=" + encodeURIComponent(s.id));
    if (sumberAktif !== s) return;
    riwayatData = d;
    gambarRiwayat();
  } catch (e) {
    wadah.replaceChildren(el("p", { class: "kosong pesan-galat" }, e.message));
  }
}

const KELAS_JENIS = { baru: "k-ok", pertama: "k-ok", sama: "k-sama", gagal: "k-gagal", unggah: "k-unggah", tarik: "k-warn", konfigurasi: "k-warn" };
const fmtHari = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
const fmtJamMenit = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

function gambarRiwayat() {
  if (!riwayatData) return;
  const hanya = $("#hanya-berubah").checked;
  const banyakAset = (sumberAktif?.aset.length || 0) > 1;
  const isi = [];
  let hariLalu = null;
  const terbaru = new Set();
  for (const k of riwayatData.kejadian) if (k.jenis === "materialisasi" && !terbaru.has(k.aset)) { terbaru.add(k.aset); k._terbaru = true; }
  for (const k of riwayatData.kejadian) {
    let jenis = k.jenis;
    if (jenis === "materialisasi") jenis = k.berubah === null ? "pertama" : k.berubah ? "baru" : "sama";
    if (hanya && jenis === "sama") continue;
    const tgl = k.waktu ? new Date(k.waktu * 1000) : null;
    const hari = tgl ? fmtHari.format(tgl) : "Tanpa waktu";
    if (hari !== hariLalu) { isi.push(el("div", { class: "hari" }, hari)); hariLalu = hari; }
    const [label] = JENIS[jenis] || [jenis];
    const rinci = el("div", { class: "rinci" });
    const cg = (k.cek || []).filter((c) => c.status === "FAILED" || c.status === "EXECUTION_FAILED");
    if (k.jenis === "materialisasi") {
      const m = k.meta || {};
      const bagian = [];
      if (m.mode) bagian.push(`mode ${m.mode}`);
      if (m.otomatis && m.otomatis !== "tidak dipakai") bagian.push(`otomatis: ${m.otomatis}`);
      const manual = teksMd(m.unggahan_manual_dipakai);
      if (manual && manual !== "tidak ada") bagian.push(`unggahan manual dipakai: ${manual.replace(/\n/g, ", ")}`);
      if (m.jumlah_berkas != null) bagian.push(`${m.jumlah_berkas} berkas`);
      if (m.ukuran_mb != null) bagian.push(`${m.ukuran_mb} MB`);
      if (m.jendela_terakhir) bagian.push(`jendela terakhir ${m.jendela_terakhir}`);
      if (!bagian.length && m.sumber) bagian.push(`sumber ${m.sumber}`);
      rinci.append(bagian.join(" · "));
      if (k.versi) rinci.append(bagian.length ? " · versi " : "versi ", el("code", { title: "checksum data" }, k.versi.slice(0, 10)));
    } else if (k.jenis === "unggah") {
      rinci.append(el("code", {}, k.nama), ` · ${k.baris ?? "?"} baris, ${ukuran(k.ukuran)}`, k.catatan ? ` · “${k.catatan}”` : "");
    } else if (k.jenis === "tarik") {
      rinci.append(el("code", {}, k.nama), " dipindah ke arsip");
    } else if (k.jenis === "konfigurasi") {
      rinci.append(el("code", {}, k.kunci), k.hapus ? " dihapus" : k.nilai != null ? ` = ${k.nilai}` : " diganti (secret)");
    } else if (k.jenis === "gagal") {
      rinci.append(el("span", { class: "er" }, `Langkah gagal di ${k.job}. Buka log untuk penyebabnya.`));
    }
    for (const c of cg) rinci.append(el("div", { class: c.keparahan === "ERROR" ? "er" : "wr" }, `Cek ${c.nama}: ${c.pesan || "tidak lolos"}`));
    isi.push(el("div", { class: "entri " + (KELAS_JENIS[jenis] || "") },
      el("div", { class: "jam", title: waktu(k.waktu) }, tgl ? fmtJamMenit.format(tgl) : "–"),
      el("div", { class: "garis" }),
      el("div", {}, el("div", { class: "jenis" }, label, banyakAset ? el("span", { class: "aset" }, k.aset) : null), rinci.childNodes.length ? rinci : null),
      el("div", { class: "oleh" }, el("span", {}, k.pemicu ? (["unggah", "tarik", "konfigurasi"].includes(k.jenis) ? "oleh " : "dipicu ") + k.pemicu : ""),
        el("span", { class: "aksi" }, k._terbaru ? el("button", { class: "tombol kecil", type: "button", onclick: () => pilihSub("data") }, "Lihat data") : null,
          k.runId ? el("button", { class: "tombol kecil", type: "button", onclick: () => { pilihHal("pipeline"); setTimeout(() => bukaLog(k.runId), 200); } }, "Log") : null))));
  }
  $("#daftar-riwayat").replaceChildren(...(isi.length ? isi : [el("p", { class: "kosong" }, "Belum ada riwayat.")]));
}

// ---------- data terkini ----------
let dataTerkini = null;
let pratinjauAktif = null;
const ASAL = (a) => (!a ? ["–", ""] : a.startsWith("otomatis") ? [a, "st-jalan"] : a.startsWith("manual") ? [a, "st-waspada"] : [a, ""]);

async function muatData(s = sumberAktif) {
  const wadah = $("#daftar-data");
  wadah.replaceChildren(el("p", { class: "kosong" }, "Memuat…"));
  try {
    const d = await api("/data?sumber=" + encodeURIComponent(s.id));
    if (sumberAktif !== s) return;
    dataTerkini = d;
    const m = d.materialisasi;
    $("#info-data").textContent = m.length ? m.map((x) => `${m.length > 1 ? x.aset + ": " : ""}pembaruan ${waktu(x.waktu)}${x.versi ? " · versi " + x.versi.slice(0, 10) : ""}`).join(" | ") : "";
    if (!d.berkas.length) {
      wadah.replaceChildren(el("p", { class: "kosong" }, m.length ? "Pembaruan terakhir tidak mencatat daftar berkas. Jalankan ulang job supaya tercatat." : "Aset sumber ini belum pernah diperbarui."));
      return;
    }
    const baris = [];
    let asetLalu = null;
    for (const b of d.berkas) {
      if (s.aset.length > 1 && b.aset !== asetLalu) { baris.push(el("div", { class: "br-grup" }, b.aset)); asetLalu = b.aset; }
      const [teks, kelas] = ASAL(b.asal);
      baris.push(el("div", { class: "br" + (b.ada ? " klik" : " gagal") + (pratinjauAktif === b.i ? " dipilih" : ""), dataset: { i: b.i }, onclick: b.ada ? () => bukaPratinjau(b.i) : null },
        el("div", { class: "nm" }, el("div", { class: "id" }, b.nama), el("div", { class: "ds" }, b.lokasi), b.ada ? null : el("div", { class: "er" }, "Berkas tidak ada di server")),
        el("div", { class: "st" }, el("span", { class: "pill " + kelas }, teks)),
        el("div", { class: "wkt" }, b.ada ? ukuran(b.ukuran) : "–", el("span", {}, b.waktu ? relatif(b.waktu) : ""))));
    }
    wadah.replaceChildren(...baris);
    const pertama = d.berkas.find((b) => b.ada);
    if (pratinjauAktif == null && pertama) bukaPratinjau(pertama.i, false);
  } catch (e) {
    wadah.replaceChildren(el("p", { class: "kosong pesan-galat" }, e.message));
  }
}

const ANGKA = /^-?\d+([.,]\d+)?$/;
const fmtTglData = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtBlnData = new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" });
function tglData(v) {
  if (!v) return "–";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtTglData.format(new Date(v + "T00:00:00Z"));
  if (/^\d{4}-\d{2}$/.test(v)) return fmtBlnData.format(new Date(v + "-01T00:00:00Z"));
  return v;
}
async function bukaPratinjau(i, gulir = true) {
  const s = sumberAktif;
  pratinjauAktif = i;
  document.querySelectorAll("#daftar-data .br").forEach((b) => b.classList.toggle("dipilih", b.dataset.i === String(i)));
  const panel = $("#panel-pratinjau");
  const info = dataTerkini?.berkas.find((b) => b.i === i);
  $("#judul-pratinjau").textContent = info?.nama || "Berkas";
  $("#info-pratinjau").textContent = "Memuat…";
  $("#unduh-data").href = `${API}/data/unduh?sumber=${encodeURIComponent(s.id)}&i=${i}`;
  $("#isi-pratinjau").replaceChildren();
  if (gulir && matchMedia("(max-width:1080px)").matches) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const d = await api(`/data/pratinjau?sumber=${encodeURIComponent(s.id)}&i=${i}&n=${$("#jumlah-baris").value}&urut=${$("#urut-baris").value}`);
    if (pratinjauAktif !== i || sumberAktif !== s) return;
    const [asal] = ASAL(d.asal);
    if (d.jenis === "json") {
      $("#jumlah-baris").hidden = true;
      $("#urut-baris").hidden = true;
      $("#info-pratinjau").textContent = `JSON · ${ukuran(d.ukuran)} · asal ${asal}${d.terpotong ? " · ditampilkan 200 KB pertama" : ""}`;
      $("#isi-pratinjau").replaceChildren(el("pre", { class: "teks-data" }, d.teks));
      return;
    }
    $("#jumlah-baris").hidden = false;
    $("#urut-baris").hidden = false;
    const URUT = { terbaru: "terbaru", akhir: "terakhir di berkas", awal: "pertama di berkas" };
    const rentang = d.rentang ? `data ${tglData(d.rentang.min)} s.d. ${tglData(d.rentang.max)} · ` : "";
    $("#info-pratinjau").replaceChildren(
      rentang ? el("b", {}, rentang) : "",
      `${d.total != null ? d.total.toLocaleString("id-ID") + " baris" : "baris tidak dihitung (berkas besar)"} · ${d.kolom.length} kolom · ${ukuran(d.ukuran)}${d.asal ? " · asal " + asal : ""} · menampilkan ${d.baris.length} baris ${URUT[d.urut] || ""}`,
      $("#urut-baris").value === "terbaru" && d.urut === "awal" ? " (berkas terlalu besar untuk diurutkan)" : "");
    const kanan = d.kolom.map((_, c) => d.baris.length > 0 && d.baris.every((r) => r[c] === "" || r[c] === undefined || ANGKA.test(r[c])));
    $("#isi-pratinjau").replaceChildren(el("div", { class: "tabel-data-wrap" }, el("table", { class: "tabel-data" },
      el("thead", {}, el("tr", {}, el("th", { class: "no" }, "#"), ...d.kolom.map((k, c) => el("th", { class: kanan[c] ? "r" : "" }, k)))),
      el("tbody", {}, ...d.baris.map((r, n) => el("tr", {}, el("td", { class: "no" }, (d.nomor?.[n] ?? n + 1).toLocaleString("id-ID")), ...d.kolom.map((_, c) => el("td", { class: kanan[c] ? "r" : "" }, r[c] ?? ""))))))));
  } catch (e) {
    $("#info-pratinjau").textContent = e.message;
  }
}

// ---------- unggah manual ----------
async function muatUnggahSumber(hal = sumberAktif) {
  const wadah = $("#unggah-sumber");
  wadah.replaceChildren(el("p", { class: "kosong" }, "Memuat…"));
  try {
    const d = await api("/sumber");
    if (sumberAktif !== hal) return;
    $("#folder-manual").textContent = d.folder + "/" + hal.id + "/";
    const s = d.sumber.find((x) => x.id === hal.id);
    const status = dataPipeline ? Object.fromEntries(dataPipeline.aset.map((a) => [a.nama, a])) : {};
    wadah.replaceChildren(s ? gambarSumber(s, status) : el("p", { class: "kosong" }, "Sumber ini tidak punya unggah manual."));
  } catch (e) {
    wadah.replaceChildren(el("p", { class: "alert" }, e.message));
  }
}

function gambarSumber(s, status) {
  const asetGagal = s.aset.filter((a) => status[a]?.status === "FAILURE");
  const bagian = [];
  const info = [];
  if (asetGagal.length) info.push(el("p", { class: "alert" }, "Aset gagal: ", el("b", {}, asetGagal.join(", ")), ". Unggahan di bawah akan dipakai pada run berikutnya."));
  if (s.env && s.mode && s.mode !== "manual") info.push(el("p", { class: "alert info" }, `Unggahan dipakai bila ${s.mode} gagal.`));
  if (s.lain.length) info.push(el("p", { class: "alert warn" }, "Berkas di folder manual yang tidak dikenali aset (diabaikan): " + s.lain.map((x) => x.nama).join(", ")));
  if (info.length) bagian.push(el("div", { class: "pb-alert peringatan" }, ...info));
  bagian.push(...s.acuan.map((b) => gambarBerkas(s, b)));
  if (s.riwayat.length) bagian.push(el("details", { class: "riwayat-unggah" }, el("summary", {}, `Unggahan sebelumnya (${s.riwayat.length})`),
    el("ul", {}, ...s.riwayat.map((r) => el("li", {}, `${waktu(r.waktu)} · ${r.tindakan === "tarik" ? "ditarik" : "diunggah"} `, el("code", {}, r.nama),
      r.baris != null ? ` · ${r.baris} baris, ${ukuran(r.ukuran)}` : "", ` · oleh ${r.pengguna}`, r.catatan ? ` · “${r.catatan}”` : "")))));
  return el("div", { id: "sumber-" + s.id }, ...bagian);
}

function gambarBerkas(s, b) {
  const masukan = el("input", { type: "file", accept: b.nama.endsWith(".gz") ? ".gz,.csv.gz" : ".csv,text/csv", hidden: true });
  const kartu = el("div", { class: "berkas" + (b.unggahan ? " terisi" : "") });
  const kirim = async (file) => {
    if (!file) return;
    if (file.name !== b.nama && !confirm(`Nama berkas "${file.name}" berbeda. Simpan sebagai ${b.nama}?`)) return;
    const catatan = prompt("Catatan singkat (opsional), mis. alasan unggah manual:", "") ?? "";
    await sibuk(tombolUnggah, async () => {
      const d = await api(`/sumber/${s.id}/${encodeURIComponent(b.nama)}?catatan=${encodeURIComponent(catatan)}`, { method: "PUT", body: file, headers: { "Content-Type": "application/octet-stream" } });
      toast(d.pesan + " Jalankan ulang job di Ringkasan pipeline bila perlu.");
      muatUnggahSumber(); muatRiwayat();
    });
  };
  masukan.addEventListener("change", () => kirim(masukan.files[0]));
  const tombolUnggah = el("button", { class: "tombol kecil utama", type: "button", onclick: () => masukan.click() }, b.unggahan ? "Ganti" : "Unggah");
  const aksi = el("div", { class: "aksi" },
    el("a", { class: "tombol kecil", href: `${API}/sumber/${s.id}/${encodeURIComponent(b.nama)}/contoh`, title: "Header dan 3 baris pertama berkas acuan" }, "Contoh"),
    tombolUnggah, masukan);
  if (b.unggahan) aksi.append(el("button", { class: "tombol kecil bahaya", type: "button", onclick: async (e) => {
    if (!confirm(`Tarik ${b.nama} dari pemakaian? Berkas dipindah ke arsip, aset kembali ke sumber otomatis/berkas repo.`)) return;
    await sibuk(e.currentTarget, async () => { const d = await api(`/sumber/${s.id}/${encodeURIComponent(b.nama)}`, { method: "DELETE" }); toast(d.pesan); muatUnggahSumber(); muatRiwayat(); });
  } }, "Tarik"));
  kartu.append(
    el("div", {}, el("div", { class: "id" }, b.nama), el("div", { class: "kol", title: b.path }, b.kolom ? b.kolom.join(" · ") : "(header tidak terbaca)"),
      b.unggahan ? el("div", { class: "status-unggah" }, `Unggahan aktif: ${ukuran(b.unggahan.ukuran)}, ${waktu(b.unggahan.waktu)}`) : null),
    aksi);
  // seret & lepas
  kartu.addEventListener("dragover", (e) => { e.preventDefault(); kartu.classList.add("seret"); });
  kartu.addEventListener("dragleave", () => kartu.classList.remove("seret"));
  kartu.addEventListener("drop", (e) => { e.preventDefault(); kartu.classList.remove("seret"); kirim(e.dataTransfer.files[0]); });
  return kartu;
}


// ---------- konfigurasi ----------
const NAMA_BERKAS = { pipeline: ["Pipeline (Dagster)", "Muat ulang Dagster"], bot: ["Bot WhatsApp", "Nyalakan ulang bot"] };

async function muatKonfigurasi() {
  const wadah = $("#daftar-konfigurasi");
  try {
    const d = await api("/konfigurasi");
    wadah.replaceChildren(...d.berkas.map(gambarKelompok));
  } catch (e) {
    wadah.replaceChildren(el("p", { class: "alert" }, e.message));
  }
}

function gambarKelompok(k) {
  const [judul, teksMuat] = NAMA_BERKAS[k.berkas] || [k.berkas, "Muat ulang"];
  const tombolMuat = el("button", { class: "tombol", type: "button", onclick: async (e) => {
    if (!confirm(`${teksMuat} sekarang?`)) return;
    await sibuk(e.currentTarget, async () => toast((await api(`/muat-ulang/${k.berkas}`, { method: "POST" })).pesan));
  } }, teksMuat);
  tombolMuat.classList.add("kecil");
  const kepala = el("div", { class: "ph" }, el("div", {}, el("h3", {}, judul), el("div", { class: "note mono" }, k.path)), tombolMuat);
  if (!k.ada) return el("div", { class: "panel" }, kepala, el("p", { class: "kosong" }, "Berkas belum ada di server."));

  const kunciBaru = el("input", { placeholder: "NAMA_VARIABEL", pattern: "[A-Z][A-Z0-9_]*", "aria-label": "Nama variabel baru" });
  const nilaiBaru = el("input", { placeholder: "nilai", "aria-label": "Nilai variabel baru", autocomplete: "off" });
  const tambah = el("form", { class: "form-baris", onsubmit: async (e) => {
    e.preventDefault();
    await sibuk(e.submitter || tambah.querySelector("button"), async () => {
      const d = await api("/konfigurasi", { method: "PUT", json: { berkas: k.berkas, kunci: kunciBaru.value.trim(), nilai: nilaiBaru.value } });
      toast(d.pesan); muatKonfigurasi();
    });
  } }, kunciBaru, nilaiBaru, el("button", { class: "tombol", type: "submit" }, "Tambah variabel"));
  return el("div", { class: "panel" }, kepala, ...k.variabel.map((v) => gambarVar(k.berkas, v)), tambah);
}

function gambarVar(berkas, v) {
  let masukan;
  if (v.pilihan) {
    masukan = el("select", { "aria-label": v.kunci }, ...(v.ada ? [] : [el("option", { value: "" }, "(belum diisi)")]),
      ...v.pilihan.map((p) => el("option", { value: p, selected: p === v.nilai }, p)));
  } else {
    masukan = el("input", {
      type: v.secret ? "password" : "text", autocomplete: "new-password", spellcheck: "false", "aria-label": v.kunci,
      inputmode: v.angka ? "numeric" : null,
      placeholder: v.secret ? (v.terisi ? "Isi untuk mengganti (nilai lama tetap kalau kosong)" : "Belum diisi") : "",
    });
    if (!v.secret) masukan.value = v.nilai || "";
  }
  const hasilUji = el("div", { class: "hasil-uji" });
  const simpan = el("button", { class: "tombol utama", type: "button", onclick: async (e) => {
    const nilai = masukan.value;
    if (v.secret && !nilai) { toast("Isi nilai baru dulu.", true); return; }
    if (v.bahaya && !confirm(`${v.kunci} kritis; nilai salah bisa membuat layanan gagal. Lanjut simpan?`)) return;
    await sibuk(e.currentTarget, async () => {
      const d = await api("/konfigurasi", { method: "PUT", json: { berkas, kunci: v.kunci, nilai } });
      toast(d.pesan); muatKonfigurasi();
    });
  } }, "Simpan");
  const isian = el("div", { class: "isian" }, masukan, simpan);
  if (v.uji) isian.append(el("button", { class: "tombol", type: "button", onclick: async (e) => {
    await sibuk(e.currentTarget, async () => {
      const d = await api("/konfigurasi/uji", { method: "POST", json: { berkas, kunci: v.kunci, nilai: masukan.value || "" } });
      hasilUji.className = "hasil-uji " + (d.ok ? "ok" : "gagal");
      hasilUji.textContent = (d.ok ? "✓ " : "✗ ") + d.pesan + (masukan.value ? " (nilai yang diketik, belum disimpan)" : " (nilai tersimpan)");
    });
  } }, "Uji"));
  if (!v.label) isian.append(el("button", { class: "tombol bahaya", type: "button", title: "Hapus baris ini dari .env", onclick: async (e) => {
    if (!confirm(`Hapus ${v.kunci} dari .env?`)) return;
    await sibuk(e.currentTarget, async () => { const d = await api("/konfigurasi", { method: "PUT", json: { berkas, kunci: v.kunci, hapus: true } }); toast(d.pesan); muatKonfigurasi(); });
  } }, "Hapus"));
  isian.append(hasilUji);
  const kini = v.secret ? (v.terisi ? `tersimpan: ${v.nilai} (${v.panjang} karakter)` : (v.ada ? "kosong" : "belum ada di .env")) : (!v.ada ? "belum ada di .env" : "");
  return el("div", { class: "var" + (v.bahaya ? " bahaya" : "") },
    el("div", {}, el("div", { class: "label" }, v.label || v.kunci), el("div", { class: "nama" }, v.kunci),
      v.ket ? el("div", { class: "ket" }, v.ket) : null),
    el("div", {}, isian, kini ? el("div", { class: "nilai-kini" }, kini) : null));
}

pemuat.konfigurasi = muatKonfigurasi;


// ---------- bot WhatsApp ----------
let dataWa = null;
let intervalWa = null;
let qrSampai = 0;
const dtkMs = (ms) => (ms ? ms / 1000 : 0);
const pillSt = (teks, st) => el("span", { class: "pill" + (st ? " st-" + st : "") }, teks);
const STATE_WA = { logged_in: ["Tersambung", "ok"], connected: ["Belum login", "waspada"], connecting: ["Menyambung", "jalan"], disconnected: ["Terputus", "gagal"] };

async function muatWa(diam = false) {
  try {
    dataWa = await api("/wa");
    gambarWa();
  } catch (e) {
    if (!diam) $("#peringatan-wa").replaceChildren(el("p", { class: "alert" }, e.message));
  }
}

function devBot() { return dataWa?.perangkat.find((p) => p.bot) || null; }

function langkahWa() {
  const d = dataWa, b = d.bot || {}, dev = devBot();
  const wh = b.webhook || {}, bl = b.balasan || {}, llm = b.llm || {};
  const L = [];
  L.push({ jd: "Server GoWA", st: d.gowa.ok ? "ok" : "gagal", ds: d.gowa.ok ? `versi ${d.gowa.versi || "?"}` : null, er: d.gowa.ok ? null : d.gowa.galat });
  L.push({ jd: "Nomor bot login", st: !dev ? "gagal" : dev.login && dev.terhubung ? "ok" : dev.login ? "waspada" : "gagal",
    ds: dev ? `${dev.nama || dev.id}${dev.nomor ? " · " + dev.nomor : ""}` : null, er: !dev ? "Belum ada device bot." : !dev.login ? "Belum login, hubungkan lewat QR atau kode." : !dev.terhubung ? "Login tapi koneksi ke WhatsApp terputus." : null });
  const tg = wh.tandaTanganGagal || 0;
  L.push({ jd: "Webhook GoWA → bot", st: b.ok === false ? "gagal" : tg && wh.terakhirGagalTanda > (wh.terakhir || 0) ? "gagal" : wh.terakhir ? "ok" : "",
    ds: b.ok === false ? null : wh.terakhir ? `event terakhir ${relatif(dtkMs(wh.terakhir))}${wh.pesanTerakhir ? ` · pesan ${relatif(dtkMs(wh.pesanTerakhir))}` : ""}` : "belum ada event sejak bot menyala",
    er: b.ok === false ? b.galat : tg ? `${tg} webhook ditolak karena secret tidak cocok` : null });
  L.push({ jd: "Bot membalas", st: bl.terakhirGagal > (bl.terakhirOk || 0) ? "gagal" : bl.terakhirOk ? "ok" : "",
    ds: bl.terakhirOk ? `terakhir ${relatif(dtkMs(bl.terakhirOk))} · ${bl.jumlahOk} terkirim${bl.jumlahGagal ? `, ${bl.jumlahGagal} gagal` : ""}` : "belum ada balasan sejak bot menyala",
    er: bl.terakhirGagal > (bl.terakhirOk || 0) ? bl.galat : null });
  const t = llm.terakhir || {};
  L.push({ jd: "OpenAI", st: !llm.aktif ? "waspada" : t.terakhir && !t.ok ? "gagal" : t.terakhir ? "ok" : "",
    ds: llm.aktif ? `${llm.model} · ${Number(llm.token || 0).toLocaleString("id-ID")} / ${Number(llm.batas || 0).toLocaleString("id-ID")} token hari ini${t.terakhir ? ` · panggilan terakhir ${relatif(dtkMs(t.terakhir))}` : ""}` : null,
    er: !llm.aktif ? "API key kosong, bot hanya melayani perintah baku." : t.terakhir && !t.ok ? t.galat : null });
  return L;
}

function gambarWa() {
  const d = dataWa, b = d.bot || {}, dev = devBot();
  const kpi = (v, k, t, kelas = "") => el("div", { class: "kpi " + kelas }, el("div", { class: "v" }, v), el("div", { class: "k" }, k), t ? el("div", { class: "t" }, t) : null);
  const [stTeks, stK] = dev ? (dev.login && dev.terhubung ? STATE_WA.logged_in : STATE_WA[dev.state] || STATE_WA.disconnected) : ["Tidak ada", "gagal"];
  const wh = b.webhook || {}, bl = b.balasan || {}, llm = b.llm || {};
  $("#kpi-wa").replaceChildren(
    kpi(stTeks, "nomor bot", dev ? dev.nomor || "belum login" : "belum ada device", stK === "ok" ? "" : "crit"),
    kpi(wh.pesanTerakhir ? relatif(dtkMs(wh.pesanTerakhir)) : "–", "pesan masuk terakhir", b.mulai ? `sejak bot menyala ${relatif(dtkMs(b.mulai))}` : ""),
    kpi(String(bl.jumlahOk ?? "–"), "balasan terkirim", bl.jumlahGagal ? `${bl.jumlahGagal} gagal` : "tanpa gagal", bl.jumlahGagal ? "warn" : ""),
    kpi(llm.aktif ? Number(llm.token || 0).toLocaleString("id-ID") : "Mati", "token OpenAI hari ini", llm.aktif ? `batas ${Number(llm.batas).toLocaleString("id-ID")} · ${llm.model}` : "API key kosong", llm.aktif ? "" : "warn"),
  );
  const lebih = d.perangkat.filter((p) => !p.bot);
  const per = [];
  if (lebih.length) per.push(el("p", { class: "alert warn" }, `${lebih.length} device lain terdaftar di GoWA. Bot hanya memakai `, el("b", {}, d.idBot), "."));
  if (b.perangkat?.kejadian) per.push(el("p", { class: "alert" }, `GoWA melaporkan ${b.perangkat.kejadian} ${relatif(dtkMs(b.perangkat.waktu))}.`));
  $("#peringatan-wa").replaceChildren(...per);
  $("#info-wa").textContent = "diperbarui " + fmtJam.format(new Date());

  $("#alur-wa").replaceChildren(...langkahWa().map((x, i) => el("div", { class: "langkah " + (x.st || "") },
    el("span", { class: "no" }, x.st === "ok" ? "✓" : x.st === "gagal" ? "!" : String(i + 1)),
    el("div", {}, el("div", { class: "jd" }, x.jd), x.ds ? el("div", { class: "ds" }, x.ds) : null, x.er ? el("div", { class: "er" }, x.er) : null),
    pillSt(x.st === "ok" ? "OK" : x.st === "gagal" ? "Gagal" : x.st === "waspada" ? "Perlu dicek" : "Belum ada data", x.st))));

  const bisa = punya("konfigurasi");
  const tombol = (teks, fn, kelas = "") => el("button", { class: "tombol kecil " + kelas, type: "button", onclick: (e) => sibuk(e.currentTarget, fn) }, teks);
  const baris = d.perangkat.map((p) => {
    const [t, k] = p.bot ? (p.login && p.terhubung ? STATE_WA.logged_in : STATE_WA[p.state] || STATE_WA.disconnected) : STATE_WA[p.state] || STATE_WA.disconnected;
    const aksi = !bisa ? [] : p.bot
      ? (p.login ? [tombol("Sambung ulang", () => aksiWa("reconnect", p.id)), tombol("Keluar", () => confirm("Keluarkan nomor bot dari WhatsApp? Bot berhenti membalas sampai dihubungkan lagi.") && aksiWa("logout", p.id), "bahaya")]
        : [tombol("Hubungkan", () => tampilHubungkan(p.id), "utama")])
      : [tombol("Lepas", () => confirm(`Lepas device ${p.id} dari GoWA? Sesinya dihapus.`) && aksiWa("lepas", p.id), "bahaya")];
    return el("div", { class: "br" + (p.bot ? "" : " waspada") },
      el("div", { class: "nm" }, el("div", { class: "id" }, p.nama || p.id, p.bot ? el("span", { class: "pill st-jalan", style: "margin-left:6px" }, "bot") : null),
        el("div", { class: "ds" }, [p.id, p.nomor].filter(Boolean).join(" · ")), aksi.length ? el("div", { class: "aksi", style: "margin-top:6px;display:flex;gap:6px;flex-wrap:wrap" }, ...aksi) : null),
      el("div", { class: "st" }, pillSt(t, k)), el("div", { class: "wkt" }, p.dibuat ? fmtTglData.format(new Date(p.dibuat)) : ""));
  });
  if (!d.adaBot && bisa && d.gowa.ok) baris.push(el("div", { class: "pb" }, tombol("Buat device bot", async () => { const r = await api("/wa/buat", { method: "POST", json: {} }); toast(r.pesan); await muatWa(); tampilHubungkan(r.device); }, "utama")));
  $("#device-wa").replaceChildren(...(baris.length ? baris : [el("p", { class: "kosong" }, d.gowa.ok ? "Belum ada device." : "GoWA tidak terjangkau.")]));
  if (dev?.login && !$("#hubungkan-wa").hidden && qrSampai) { $("#hubungkan-wa").hidden = true; qrSampai = 0; toast("Nomor bot tersambung."); aturIntervalWa(); }

  const it = b.intent24j || [];
  const LABEL_INTENT = { harga: "HARGA", stok: "STOK", beras_murah: "SPHP", peringatan: "PERINGATAN", langganan: "LANGGANAN", berhenti: "BERHENTI", lapor: "LAPOR", bantuan: "BANTUAN",
    llm: "Pesan bebas (OpenAI)", llm_cache: "Pesan bebas (cache)", istilah: "Istilah", siaran: "Siaran peringatan" };
  $("#intent-wa").replaceChildren(...(it.length ? it.map((x) => el("div", { class: "br" + (/^(tolak|llm_gagal|galat)/.test(x.intent || "") ? " waspada" : "") },
    el("div", { class: "nm" }, el("div", { class: "id" }, LABEL_INTENT[x.intent] || x.intent || "–")), el("div", { class: "st" }, pillSt(String(x.jumlah), "")),
    // dibuat_pada disimpan sebagai jam WIB tanpa zona (zona DB Asia/Jakarta)
    el("div", { class: "wkt" }, relatif(Date.parse(x.terakhir.replace(" ", "T") + "+07:00") / 1000)))) : [el("p", { class: "kosong" }, "Belum ada balasan 24 jam terakhir.")]));
  $("#info-kontak-wa").textContent = b.kontak ? `${b.kontak.n} kontak · ${b.kontak.langganan} berlangganan` : "";
  const tw = $("#titik-wa");
  if (tw) { const bad = langkahWa().some((x) => x.st === "gagal"); tw.className = "titik " + (bad ? "gagal" : stK === "ok" ? "ok" : "waspada"); }
}

async function aksiWa(aksi, device) {
  const r = await api("/wa/" + aksi, { method: "POST", json: { device } });
  toast(r.pesan);
  await muatWa();
}

function tampilHubungkan(device) {
  const w = $("#hubungkan-wa");
  w.hidden = false;
  const nomor = el("input", { placeholder: "628xxxxxxxxxx", inputmode: "numeric", "aria-label": "Nomor WhatsApp bot", autocomplete: "off" });
  const isi = el("div", {}, el("p", { class: "kosong" }, "Memuat QR…"));
  const tutup = el("button", { class: "tombol kecil", type: "button", onclick: () => { w.hidden = true; qrSampai = 0; aturIntervalWa(); } }, "Tutup");
  w.replaceChildren(
    el("div", { class: "seg", role: "tablist" },
      el("button", { type: "button", "aria-selected": "true", onclick: (e) => { pilihSeg(e); muatQr(device, isi); } }, "QR"),
      el("button", { type: "button", "aria-selected": "false", onclick: (e) => { pilihSeg(e); qrSampai = 0; isi.replaceChildren(el("form", { class: "form-baris", style: "padding:12px 0 0;border:0", onsubmit: async (ev) => {
        ev.preventDefault();
        await sibuk(ev.submitter, async () => {
          const r = await api("/wa/kode", { method: "POST", json: { device, nomor: nomor.value } });
          isi.replaceChildren(el("div", { class: "kode-pair" }, r.kode), el("p", { class: "catatan" }, "WhatsApp → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon."));
          qrSampai = Date.now() + 120000; aturIntervalWa();
        });
      } }, nomor, el("button", { class: "tombol utama", type: "submit" }, "Minta kode"))); } }, "Kode pairing")),
    " ", tutup, isi);
  muatQr(device, isi);
}
function pilihSeg(e) { e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === e.currentTarget))); }

async function muatQr(device, wadah) {
  try {
    const r = await api("/wa/qr", { method: "POST", json: { device } });
    qrSampai = Date.now() + r.durasi * 1000;
    const hitung = el("div", { class: "hitung" });
    wadah.replaceChildren(el("div", { class: "qr-wa", style: "margin-top:12px" }, el("img", { src: r.qr, alt: "QR WhatsApp" }),
      el("div", {}, el("ol", {}, el("li", {}, "Buka WhatsApp di HP nomor bot"), el("li", {}, "Perangkat tertaut → Tautkan perangkat"), el("li", {}, "Pindai QR ini")), hitung,
        el("button", { class: "tombol kecil", type: "button", style: "margin-top:8px", onclick: () => muatQr(device, wadah) }, "QR baru"))));
    const jalan = () => { const s = Math.max(0, Math.round((qrSampai - Date.now()) / 1000)); hitung.textContent = s ? `berlaku ${s} dtk lagi` : "kedaluwarsa, minta QR baru"; if (s && wadah.isConnected) setTimeout(jalan, 1000); };
    jalan();
    aturIntervalWa();
  } catch (e) { wadah.replaceChildren(el("p", { class: "alert" }, e.message)); }
}

function aturIntervalWa() {
  clearInterval(intervalWa);
  const cepat = qrSampai && qrSampai > Date.now() - 5000;
  intervalWa = setInterval(() => { if (halAktif === "whatsapp" && !document.hidden) muatWa(true); }, cepat ? 3000 : 20000);
}

pemuat.whatsapp = () => { muatWa(); aturIntervalWa(); };

// ---------- laporan harga warga ----------
let statusLaporan = "MENUNGGU";
let peranLaporan = "";
const NAMA_PERAN = { PENJUAL: "Penjual", PEMBELI: "Pembeli" };
const NAMA_SARAN = { WAJAR: ["Wajar", "ok"], CEK: ["Perlu dicek", "waspada"], SALAH: ["Kemungkinan salah", "gagal"] };
const fmtRp = new Intl.NumberFormat("id-ID");
const ST_LAPORAN = { MENUNGGU: ["Menunggu", "waspada"], VALID: ["Diterima", "ok"], DITOLAK: ["Ditolak", "gagal"] };
function tandaiJumlahLaporan(n) {
  const t = $("#jumlah-laporan");
  if (!t) return;
  t.hidden = !n;
  t.textContent = n > 99 ? "99+" : String(n || "");
}
async function aksiLaporan(tombol, id, aksi) {
  await sibuk(tombol, async () => {
    toast((await api(`/laporan/${id}/${aksi}`, { method: "POST" })).pesan);
    await pemuat.laporan();
  });
}
pemuat.laporan = async () => {
  try {
    const qs = new URLSearchParams();
    if (statusLaporan) qs.set("status", statusLaporan);
    if (peranLaporan) qs.set("peran", peranLaporan);
    const d = await api("/laporan" + (qs.size ? "?" + qs : ""));
    const j = d.jumlah;
    tandaiJumlahLaporan(j.MENUNGGU);
    const kpi = (v, k, kelas = "") => el("div", { class: "kpi " + kelas }, el("div", { class: "v" }, v), el("div", { class: "k" }, k));
    $("#kpi-laporan").replaceChildren(
      kpi(String(j.MENUNGGU), "menunggu diperiksa", j.MENUNGGU ? "warn" : ""),
      kpi(String(j.VALID), "diterima"),
      kpi(String(j.DITOLAK), "ditolak"));
    // saran untuk laporan yang menunggu: 1-2 kalimat saja; cara hitungnya di tooltip. Keputusan tetap di petugas.
    const tunggu = d.laporan.filter((l) => l.status === "MENUNGGU");
    const rs = $("#ringkas-laporan");
    if (tunggu.length) {
      const sebut = (xs) => {
        const n = xs.map((l) => l.wilayah || l.pasar);
        const unik = [...new Set(n)];
        return unik.length <= 2 ? unik.join(" dan ") : `${unik.slice(0, 2).join(", ")} dan ${unik.length - 2} lainnya`;
      };
      const rentang = (xs) => {
        const v = xs.map((l) => l.selisih).filter((x) => x != null);
        if (!v.length) return "";
        const lo = Math.round(Math.min(...v)), hi = Math.round(Math.max(...v));
        const arah = lo >= 0 ? "di atas" : hi <= 0 ? "di bawah" : "berbeda dari";
        const a = Math.abs(lo), b = Math.abs(hi);
        return `, ${a === b ? a : Math.min(a, b) + "–" + Math.max(a, b)}% ${arah} panel`;
      };
      const kel = (s) => tunggu.filter((l) => l.saran === s);
      const salah = kel("SALAH"), cek = kel("CEK"), wajar = kel("WAJAR");
      const kalimat = [];
      if (salah.length) kalimat.push(`${salah.length} laporan kemungkinan salah (${sebut(salah)}${rentang(salah)}).`);
      if (cek.length) kalimat.push(`${cek.length} laporan perlu dicek (${sebut(cek)}${rentang(cek)}).`);
      if (wajar.length) kalimat.push(salah.length || cek.length ? `Sisanya ${wajar.length} wajar dan aman diterima.` : `Semua ${wajar.length} laporan wajar dan aman diterima.`);
      rs.title = "Dibandingkan dengan panel harga wilayah, laporan warga lain 30 hari terakhir, HET, dan riwayat pelapor. Wajar bila selisih di bawah 10%, kemungkinan salah bila 25% atau lebih. Hanya saran; keputusan tetap di petugas.";
      const aturan = kalimat.join(" ");
      const judulAturan = rs.title;
      const judulAI = "Disusun AI dari isi laporan yang menunggu dan laporan terakhir. Hanya saran; keputusan tetap di petugas.";
      // selama menunggu AI tampil placeholder; kalimat aturan hanya dipakai bila AI gagal atau tidak aktif
      const isiSaran = el("span", { class: "saran-isi" });
      const tampil = (teks, judul) => { isiSaran.className = "saran-isi"; isiSaran.textContent = teks; rs.title = judul; rs.removeAttribute("aria-busy"); };
      const kunci = JSON.stringify(tunggu.map((l) => [l.id, l.peran, l.harga]));
      const simpan = pemuat.laporan.saranAI;
      if (simpan && simpan.kunci === kunci) tampil(simpan.teks, judulAI);
      else {
        isiSaran.className = "saran-isi memuat";
        isiSaran.textContent = "Menyusun saran…";
        rs.setAttribute("aria-busy", "true");
        rs.title = "";
      }
      rs.replaceChildren(el("span", { class: "label" }, "Saran"), isiSaran);
      rs.hidden = false;
      const giliran = (pemuat.laporan.giliran = (pemuat.laporan.giliran || 0) + 1);
      api("/laporan/saran").then((x) => {
        if (giliran !== pemuat.laporan.giliran) return;
        if (!x.teks) return tampil(aturan, judulAturan);
        pemuat.laporan.saranAI = { kunci, teks: x.teks };
        tampil(x.teks, judulAI);
      }).catch(() => { if (giliran === pemuat.laporan.giliran) tampil(aturan, judulAturan); });
    } else rs.hidden = true;
    const kosong = { MENUNGGU: "Tidak ada laporan yang menunggu.", VALID: "Belum ada laporan yang diterima.", DITOLAK: "Belum ada laporan yang ditolak.", "": "Belum ada laporan." }[statusLaporan];
    const baris = d.laporan.map((l) => {
      const [stT, stK] = ST_LAPORAN[l.status] || [l.status, ""];
      const s = l.selisih;
      const selisih = s == null ? "–" : `${s > 0 ? "+" : ""}${String(s).replace(".", ",")}%`;
      const jauh = s != null && Math.abs(s) >= 25;
      const tombol = (teks, aksi, kelas = "") => el("button", { class: "tombol kecil " + kelas, type: "button", onclick: (e) => aksiLaporan(e.currentTarget, l.id, aksi) }, teks);
      const aksi = l.status === "MENUNGGU" ? [tombol("Terima", "terima", "utama"), tombol("Tolak", "tolak", "bahaya")] : [tombol("Batalkan", "kembalikan")];
      return el("tr", { class: jauh && l.status === "MENUNGGU" ? "waspada" : "" },
        el("td", { class: "waktu" }, waktu(l.waktu)), el("td", {}, l.wilayah || "–"), el("td", l.pesan ? { title: "Pesan warga: " + l.pesan } : {}, l.pasar),
        el("td", {}, (l.komoditas || "").replace(/^Beras\s*/i, "")), el("td", { class: "id" }, "Rp" + fmtRp.format(l.harga)),
        el("td", { class: "id", title: jauh ? "Selisih dari panel harga 25% atau lebih" : "" }, selisih),
        el("td", {}, l.peran ? el("span", { class: "pill peran-" + l.peran.toLowerCase() }, NAMA_PERAN[l.peran]) : el("span", { class: "ket", title: "Laporan sebelum ada pilihan penjual/pembeli" }, "–")),
        el("td", { class: "ket", title: `${l.laporanPelapor} laporan dari nomor ini` }, `${l.pelapor} · ${l.laporanPelapor} laporan`),
        el("td", {}, el("span", { class: "pill st-" + stK }, stT)), el("td", { class: "aksi" }, ...aksi));
    });
    $("#tabel-laporan tbody").replaceChildren(...(baris.length ? baris : [el("tr", {}, el("td", { colspan: "10", class: "ket" }, kosong))]));
    labeli($("#tabel-laporan"));
  } catch (e) { toast(e.message, true); }
};

// ---------- akun ----------
const NAMA_HAK = { dasbor_sphp: "Dasbor lengkap termasuk SPHP", pipeline: "Pantau pipeline", laporan: "Validasi laporan warga", jalankan: "Jalankan job",
  unggah: "Unggah data manual", konfigurasi: "Konfigurasi & secret", akun: "Kelola akun", jejak: "Jejak admin" };
pemuat.akun = async () => {
  try {
    const d = await api("/akun");
    $("#daftar-peran").replaceChildren(el("div", { class: "peran" },
      el("div", {}, el("b", {}, "Guest (tanpa login)"), el("ul", {}, el("li", {}, "Dasbor umum"))),
      ...d.peran.map((p) => el("div", {}, el("b", {}, p.label), el("ul", {}, el("li", {}, "Dasbor umum"), ...p.hak.map((h) => el("li", {}, NAMA_HAK[h] || h)))))));
    const pilih = $("#pilih-peran-baru");
    if (!pilih.options.length) pilih.append(...d.peran.map((p) => el("option", { value: p.id, selected: p.id === "dinas" }, p.label)));
    $("#tabel-akun tbody").replaceChildren(...d.akun.map((a) => {
      const diri = a.nama === sesi?.pengguna;
      const peran = el("select", { "aria-label": "Peran " + a.nama }, ...d.peran.map((p) => el("option", { value: p.id, selected: p.id === a.peran }, p.label)));
      peran.addEventListener("change", async () => {
        try { toast((await api(`/akun/${encodeURIComponent(a.nama)}`, { method: "PUT", json: { peran: peran.value } })).pesan); } catch (e) { toast(e.message, true); }
        pemuat.akun();
      });
      const aksi = el("td", { class: "aksi" },
        el("button", { class: "tombol kecil", type: "button", onclick: async (e) => {
          const baru = prompt(`Sandi baru untuk ${a.nama} (min. 10 karakter):`);
          if (!baru) return;
          await sibuk(e.currentTarget, async () => toast((await api(`/akun/${encodeURIComponent(a.nama)}`, { method: "PUT", json: { sandi: baru } })).pesan));
        } }, "Atur ulang sandi"),
        el("button", { class: "tombol kecil", type: "button", onclick: async (e) => {
          await sibuk(e.currentTarget, async () => toast((await api(`/akun/${encodeURIComponent(a.nama)}`, { method: "PUT", json: { aktif: !a.aktif } })).pesan));
          pemuat.akun();
        } }, a.aktif ? "Nonaktifkan" : "Aktifkan"),
        diri ? null : el("button", { class: "tombol kecil bahaya", type: "button", onclick: async (e) => {
          if (!confirm(`Hapus akun ${a.nama}?`)) return;
          await sibuk(e.currentTarget, async () => toast((await api(`/akun/${encodeURIComponent(a.nama)}`, { method: "DELETE" })).pesan));
          pemuat.akun();
        } }, "Hapus"));
      return el("tr", { class: a.aktif ? "" : "waspada" }, el("td", { class: "id" }, a.nama, diri ? " (kamu)" : ""), el("td", {}, peran),
        el("td", {}, a.aktif ? el("span", { class: "pill st-ok" }, "Aktif") : el("span", { class: "pill st-waspada" }, "Nonaktif")),
        el("td", { class: "waktu" }, relatif(a.terakhirMasuk)), aksi);
    }));
    labeli($("#tabel-akun"));
  } catch (e) { toast(e.message, true); }
};

// ---------- jejak ----------
const NAMA_TINDAKAN = { wa_buat_device: "Buat device WA", wa_login: "Hubungkan WA", wa_reconnect: "Sambung ulang WA", wa_logout: "Keluarkan WA", wa_lepas: "Lepas device WA", wa_uji_alur: "Uji bot", validasi_laporan: "Validasi laporan warga",
  buat_akun: "Buat akun", ubah_akun: "Ubah akun", hapus_akun: "Hapus akun", ganti_sandi: "Ganti sandi sendiri", login: "Masuk", login_gagal: "Gagal masuk", ubah_konfigurasi: "Ubah konfigurasi", uji_konfigurasi: "Uji key",
  muat_ulang: "Muat ulang layanan", unggah_manual: "Unggah manual", tarik_unggahan: "Tarik unggahan", jalankan_job: "Jalankan job" };
pemuat.jejak = async () => {
  try {
    const d = await api("/jejak");
    $("#tabel-jejak tbody").replaceChildren(...d.jejak.map((j) => {
      const { waktu: w, tindakan, pengguna, ip, ...rinci } = j;
      const teks = Object.entries(rinci).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");
      return el("tr", { class: tindakan === "login_gagal" ? "gagal" : "" }, el("td", { class: "waktu" }, waktu(w)), el("td", {}, NAMA_TINDAKAN[tindakan] || tindakan),
        el("td", {}, pengguna || "–"), el("td", { class: "ket" }, teks), el("td", { class: "waktu" }, ip || ""));
    }));
    labeli($("#tabel-jejak"));
  } catch (e) { toast(e.message, true); }
};

// ---------- awal ----------
document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("#menu a[data-hal]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); pilihHal(a.dataset.hal); }));
  document.querySelectorAll("#seg-laporan button").forEach((b) => b.addEventListener("click", (e) => { pilihSeg(e); statusLaporan = b.dataset.status; pemuat.laporan(); }));
  document.querySelectorAll("#seg-peran button").forEach((b) => b.addEventListener("click", (e) => { pilihSeg(e); peranLaporan = b.dataset.peran; pemuat.laporan(); }));
  $("#segarkan-laporan").addEventListener("click", () => pemuat.laporan());
  document.querySelectorAll("#sub-tab-sumber button").forEach((b) => b.addEventListener("click", () => pilihSub(b.dataset.sub)));
  for (const id of ["#jumlah-baris", "#urut-baris"]) $(id).addEventListener("change", () => { if (pratinjauAktif != null) bukaPratinjau(pratinjauAktif, false); });
  $("#tombol-menu").addEventListener("click", () => laci(!document.body.classList.contains("laci-buka")));
  $("#tirai").addEventListener("click", () => laci(false));
  window.addEventListener("hashchange", () => { if (sesi) { const [h, sub] = location.hash.slice(1).split("/"); pilihHal(h || "pipeline", sub); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") laci(false); });
  $("#segarkan-sumber").addEventListener("click", (e) => sibuk(e.currentTarget, async () => {
    try { dataPipeline = await api("/pipeline"); perbaruiTitik(); } catch { /* status opsional */ }
    const sub = $("#sub-tab-sumber button[aria-selected=true]")?.dataset.sub || "riwayat";
    if (sumberAktif) await muatHalamanSumber(sumberAktif, sub);
  }));
  $("#segarkan-wa").addEventListener("click", (e) => sibuk(e.currentTarget, () => muatWa()));
  $("#form-uji-wa").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, teks = f.teks.value.trim();
    if (!teks) return;
    await sibuk(f.querySelector("button"), async () => {
      const r = await api("/wa/uji", { method: "POST", json: { teks } });
      const h = $("#hasil-uji-wa");
      h.hidden = false;
      h.replaceChildren(el("span", { class: "meta" }, `intent ${r.intent} · ${r.detik} dtk`), r.teks.replace(/\*([^*\n]+)\*/g, "$1"));
      muatWa(true);
    });
  });
  $("#tombol-segarkan").addEventListener("click", (e) => sibuk(e.currentTarget, () => muatPipeline()));
  $("#tutup-log").addEventListener("click", () => { $("#panel-log").hidden = true; runTerbuka = null; });
  $("#hanya-galat").addEventListener("change", gambarLog);
  $("#hanya-berubah").addEventListener("change", gambarRiwayat);
  $("#tombol-jalankan").addEventListener("click", async (e) => {
    const job = $("#pilih-job").value;
    if (!job || !confirm(`Jalankan ${job} sekarang?`)) return;
    await sibuk(e.currentTarget, async () => { toast((await api("/jalankan", { method: "POST", json: { job } })).pesan); setTimeout(() => muatPipeline(true), 4000); });
  });
  // Menu akun di bawah menu samping: panah atas/bawah, Home/End, Esc menutup, klik di luar menutup.
  const akun = $("#akun"), tombolAkun = $("#tombol-akun"), menuAkun = $("#menu-akun");
  const itemAkun = () => [...menuAkun.querySelectorAll('[role="menuitem"]')];
  const menuAkunBuka = (buka, fokus) => {
    menuAkun.hidden = !buka;
    tombolAkun.setAttribute("aria-expanded", String(buka));
    if (buka) { const xs = itemAkun(); (fokus === "akhir" ? xs[xs.length - 1] : xs[0]).focus(); }
  };
  tombolAkun.addEventListener("click", () => menuAkunBuka(menuAkun.hidden));
  tombolAkun.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); menuAkunBuka(true, e.key === "ArrowDown" ? "akhir" : "awal"); }
  });
  menuAkun.addEventListener("keydown", (e) => {
    const xs = itemAkun(), i = xs.indexOf(document.activeElement);
    const ke = (n) => { e.preventDefault(); xs[(n + xs.length) % xs.length].focus(); };
    if (e.key === "ArrowDown") ke(i + 1);
    else if (e.key === "ArrowUp") ke(i - 1);
    else if (e.key === "Home") ke(0);
    else if (e.key === "End") ke(xs.length - 1);
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); menuAkunBuka(false); tombolAkun.focus(); }
    else if (e.key === "Tab") menuAkunBuka(false);
  });
  // Ganti tema membiarkan menu terbuka supaya labelnya terlihat berubah; item lain menutup menu.
  menuAkun.addEventListener("click", (e) => { const it = e.target.closest('[role="menuitem"]'); if (it && it.id !== "tombol-tema") menuAkunBuka(false); });
  document.addEventListener("pointerdown", (e) => { if (!menuAkun.hidden && !akun.contains(e.target)) menuAkunBuka(false); });
  $("#tombol-keluar").addEventListener("click", async () => { try { await api("/keluar", { method: "POST" }); } catch { /* abaikan */ } tampilMasuk(); });
  $("#form-masuk").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    $("#galat-masuk").textContent = "";
    const tombol = e.currentTarget.querySelector("button");
    tombol.disabled = true;
    try {
      const d = await api("/masuk", { method: "POST", json: { pengguna: f.get("pengguna"), sandi: f.get("sandi") } });
      e.target.reset();
      masukBerhasil(d, true);
    } catch (err) { $("#galat-masuk").textContent = err.message; } finally { tombol.disabled = false; }
  });
  // ganti sandi sendiri
  const dlg = $("#dialog-sandi");
  $("#tombol-sandi").addEventListener("click", () => { $("#form-sandi").reset(); $("#galat-sandi").textContent = ""; dlg.showModal(); });
  $("#batal-sandi").addEventListener("click", () => dlg.close());
  $("#form-sandi").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("baru") !== f.get("ulang")) { $("#galat-sandi").textContent = "Sandi baru tidak sama."; return; }
    try {
      const d = await api("/sandi", { method: "POST", json: { lama: f.get("lama"), baru: f.get("baru") } });
      dlg.close(); toast(d.pesan); tampilMasuk();
    } catch (err) { $("#galat-sandi").textContent = err.message; }
  });
  $("#form-akun").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    await sibuk(form.querySelector("button"), async () => {
      const d = await api("/akun", { method: "POST", json: { nama: f.get("nama"), peran: f.get("peran"), sandi: f.get("sandi") } });
      toast(d.pesan); form.reset(); pemuat.akun();
    });
  });
  try {
    const d = await api("/saya");
    if (d.pengguna) masukBerhasil(d); else tampilMasuk();
  } catch { tampilMasuk(); }
});
