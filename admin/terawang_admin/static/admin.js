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
const lencana = (st) => { const [t, k] = STATUS[st] || [st ? st.toLowerCase() : "Belum pernah", ""]; return el("span", { class: "lencana " + k }, t); };

// ---------- navigasi & sesi ----------
let tabAktif = "pipeline";
const pemuat = {};

let sesi = null;
const punya = (hak) => !!sesi?.hak?.includes(hak);

function tampilMasuk() {
  sesi = null;
  $("#layar-tanpa-akses").hidden = true;
  $("#layar-masuk").hidden = false;
  $("#tab").hidden = true;
  $("#kop-kanan").hidden = true;
  document.querySelectorAll(".bagian").forEach((b) => (b.hidden = true));
  clearInterval(intervalPipeline);
}

function pilihTab(nama) {
  tabAktif = nama;
  document.querySelectorAll("#tab button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === nama)));
  document.querySelectorAll(".bagian").forEach((b) => (b.hidden = b.id !== "bagian-" + nama));
  try { history.replaceState(null, "", "#" + nama); } catch { /* abaikan */ }
  pemuat[nama]?.();
}

function tujuanKembali() {
  // ?kembali=/harga dari dasbor; hanya path relatif di situs ini
  const k = new URLSearchParams(location.search).get("kembali");
  return k && k.startsWith("/") && !k.startsWith("//") && !k.startsWith("/\\") ? k : null;
}

function masukBerhasil(d, baruMasuk = false) {
  sesi = d;
  const kembali = tujuanKembali();
  if (baruMasuk && kembali) { location.href = kembali; return; }
  $("#layar-masuk").hidden = true;
  $("#kop-kanan").hidden = false;
  $("#nama-pengguna").textContent = d.pengguna;
  $("#peran-pengguna").textContent = d.labelPeran;
  document.querySelectorAll("[data-hak]").forEach((e) => (e.hidden = !punya(e.dataset.hak)));
  const tab = [...document.querySelectorAll("#tab button")].filter((b) => punya(b.dataset.hak)).map((b) => b.dataset.tab);
  if (!tab.length) {
    $("#tab").hidden = true;
    $("#nama-tanpa-akses").textContent = d.pengguna;
    $("#peran-tanpa-akses").textContent = d.labelPeran;
    $("#layar-tanpa-akses").hidden = false;
    return;
  }
  $("#tab").hidden = false;
  const awal = location.hash.slice(1);
  pilihTab(tab.includes(awal) ? awal : tab[0]);
  clearInterval(intervalPipeline);
  intervalPipeline = setInterval(() => { if (tabAktif === "pipeline" && !document.hidden) muatPipeline(true); }, 30000);
}

// ---------- pipeline ----------
let intervalPipeline;
let runTerbuka = null;
let dataPipeline = null;

async function muatPipeline(diam = false) {
  try {
    dataPipeline = await api("/pipeline");
    gambarPipeline(dataPipeline);
    $("#info-perbarui").textContent = "Diperbarui " + fmtJam.format(new Date()) + " WIB · otomatis tiap 30 detik";
  } catch (e) {
    $("#info-perbarui").textContent = "Gagal memuat";
    const p = $("#peringatan-pipeline");
    p.replaceChildren(el("p", { class: "pemberitahuan gagal" }, e.message));
    if (!diam) toast(e.message, true);
  }
}

function gambarPipeline(d) {
  const pilih = $("#pilih-job");
  if (!pilih.options.length) for (const [j, ket] of Object.entries(d.job)) pilih.append(el("option", { value: j, title: ket }, j));

  const gagal = d.aset.filter((a) => a.status === "FAILURE");
  const jalan = d.aset.filter((a) => a.status === "IN_PROGRESS" || a.antre);
  const ok = d.aset.filter((a) => a.status === "SUCCESS");
  const runGagal24 = d.run.filter((r) => r.status === "FAILURE" && r.mulai > Date.now() / 1000 - 86400);
  $("#ringkas-aset").replaceChildren(
    el("div", { class: "angka" + (gagal.length ? " gagal" : "") }, el("b", {}, gagal.length), el("span", {}, "aset gagal di run terakhirnya")),
    el("div", { class: "angka ok" }, el("b", {}, ok.length), el("span", {}, `dari ${d.aset.length} aset berhasil`)),
    el("div", { class: "angka" }, el("b", {}, jalan.length), el("span", {}, "aset sedang berjalan / antre")),
    el("div", { class: "angka" + (runGagal24.length ? " gagal" : "") }, el("b", {}, runGagal24.length), el("span", {}, "run gagal 24 jam terakhir")),
  );

  const peringatan = [];
  const daemonSakit = d.daemon.filter((x) => !x.sehat);
  if (daemonSakit.length) peringatan.push(el("p", { class: "pemberitahuan gagal" }, `Daemon Dagster tidak sehat (${daemonSakit.map((x) => x.jenis).join(", ")}): jadwal dan sensor tidak berjalan. ${punya("konfigurasi") ? 'Coba "Muat ulang Dagster" di tab Konfigurasi.' : "Hubungi superadmin."}`));
  for (const a of gagal) {
    const p = el("p", { class: "pemberitahuan gagal" }, el("b", {}, a.nama), ` gagal ${relatif(a.selesai)}. `,
      el("a", { href: "#", onclick: (e) => { e.preventDefault(); bukaLog(a.runId); } }, "Lihat log"));
    if (a.sumberManual && punya("unggah")) p.append(" · ", el("a", { href: "#unggah", onclick: (e) => { e.preventDefault(); pilihTab("unggah"); setTimeout(() => document.getElementById("sumber-" + a.sumberManual)?.scrollIntoView({ behavior: "smooth" }), 300); } }, "Unggah data manual"));
    peringatan.push(p);
  }
  for (const a of d.aset) for (const c of a.cek.filter((c) => c.status === "FAILED" || c.status === "EXECUTION_FAILED")) {
    const p = el("p", { class: "pemberitahuan " + (c.keparahan === "ERROR" ? "gagal" : "waspada") }, el("b", {}, a.nama), ` · cek ${c.nama}: `, c.pesan || c.ket || "tidak lolos", ` (${relatif(c.waktu)}). `);
    if (c.runId) p.append(el("a", { href: "#", onclick: (e) => { e.preventDefault(); bukaLog(c.runId); } }, "Lihat log"));
    if (a.sumberManual && punya("unggah")) p.append(" · ", el("a", { href: "#unggah", onclick: (e) => { e.preventDefault(); pilihTab("unggah"); } }, "Unggah data manual"));
    peringatan.push(p);
  }
  $("#peringatan-pipeline").replaceChildren(...peringatan);

  const urutGrup = ["bronze", "silver", "model", "status"];
  const grup = [...new Set(d.aset.map((a) => a.grup))].sort((a, b) => (urutGrup.indexOf(a) + 99 * (urutGrup.indexOf(a) < 0)) - (urutGrup.indexOf(b) + 99 * (urutGrup.indexOf(b) < 0)));
  const baris = [];
  for (const g of grup) {
    baris.push(el("tr", { class: "grup" }, el("td", { colspan: 5 }, g)));
    for (const a of d.aset.filter((x) => x.grup === g)) {
      const aksi = el("td", {});
      if (a.runId) aksi.append(el("button", { class: "tombol kecil", type: "button", onclick: (e) => { e.stopPropagation(); bukaLog(a.runId); } }, "Log"));
      if (a.status === "FAILURE" && a.sumberManual && punya("unggah")) aksi.append(" ", el("button", { class: "tombol kecil bahaya", type: "button", onclick: (e) => { e.stopPropagation(); pilihTab("unggah"); } }, "Unggah"));
      const cekGagal = a.cek.some((c) => c.status === "FAILED" || c.status === "EXECUTION_FAILED");
      baris.push(el("tr", { class: (a.status === "FAILURE" ? "gagal " : cekGagal ? "waspada " : "") + (a.runId ? "klik" : ""), onclick: a.runId ? () => bukaLog(a.runId) : null },
        el("td", {}, el("div", { class: "nama-aset" }, a.nama), a.ket ? el("div", { class: "ket" }, a.ket) : null,
          ...a.cek.filter((c) => c.status === "FAILED" || c.status === "EXECUTION_FAILED").map((c) => el("div", { class: "cek-gagal" }, "⚠ " + (c.pesan || c.nama)))),
        el("td", {}, lencana(a.status), a.antre && a.status !== "IN_PROGRESS" ? el("div", { class: "ket" }, "+ ada run antre") : null),
        el("td", { class: "waktu", title: waktu(a.selesai || a.mulai) }, relatif(a.selesai || a.mulai)),
        el("td", { class: "waktu", title: waktu(a.materialisasi) }, relatif(a.materialisasi)),
        aksi));
    }
  }
  $("#tabel-aset tbody").replaceChildren(...baris);

  $("#tabel-run tbody").replaceChildren(...d.run.map((r) => el("tr", {
    class: "klik" + (r.status === "FAILURE" ? " gagal" : "") + (r.runId === runTerbuka ? " dipilih" : ""), onclick: () => bukaLog(r.runId), title: r.runId,
  },
    el("td", {}, el("div", { class: "nama-aset" }, r.job), r.langkahGagal.length ? el("div", { class: "ket" }, "Gagal: " + r.langkahGagal.join(", ")) : null),
    el("td", {}, lencana(r.status)),
    el("td", { class: "waktu" }, waktu(r.mulai)),
    el("td", { class: "waktu" }, durasi(r.mulai, r.selesai)),
    el("td", { class: "ket" }, r.pemicu))));
}

let logData = null;
async function bukaLog(runId) {
  runTerbuka = runId;
  const panel = $("#panel-log");
  panel.hidden = false;
  $("#judul-log").textContent = "Log run " + runId.slice(0, 8);
  $("#info-log").textContent = "Memuat…";
  $("#isi-log").replaceChildren();
  document.querySelectorAll("#tabel-run tr").forEach((tr) => tr.classList.toggle("dipilih", tr.title === runId));
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
  $("#isi-log").replaceChildren(...(isi.length ? isi : [el("p", { class: "redup", style: "padding:10px" }, "Tidak ada event yang cocok.")]));
}

pemuat.pipeline = () => muatPipeline();

// ---------- riwayat data ----------
let riwayatData = null;
const JENIS = {
  baru: ["Data baru", "ok"], sama: ["Tidak berubah", ""], pertama: ["Data pertama", "ok"], gagal: ["Gagal", "gagal"],
  unggah: ["Unggah manual", "jalan"], tarik: ["Unggahan ditarik", "waspada"], konfigurasi: ["Ubah konfigurasi", "waspada"],
};
function teksMd(v) { return String(v ?? "").replace(/[`*]/g, "").replace(/^- /gm, "").trim(); }

async function muatRiwayat() {
  const pilih = $("#filter-riwayat");
  const q = pilih.value ? (pilih.value.startsWith("grup:") ? `?grup=${encodeURIComponent(pilih.value.slice(5))}` : `?aset=${encodeURIComponent(pilih.value)}`) : "";
  $("#tabel-riwayat tbody").replaceChildren(el("tr", {}, el("td", { colspan: 6, class: "redup" }, "Memuat…")));
  try {
    riwayatData = await api("/riwayat" + q);
    if (pilih.options.length <= 1) {
      const nilai = pilih.value;
      pilih.replaceChildren(el("option", { value: "" }, "Semua sumber (bronze)"), el("option", { value: "grup:semua" }, "Semua aset"),
        ...riwayatData.aset.map((a) => el("option", { value: a.nama }, `${a.grup} · ${a.nama}`)));
      pilih.value = nilai;
    }
    gambarRiwayat();
  } catch (e) {
    $("#tabel-riwayat tbody").replaceChildren(el("tr", {}, el("td", { colspan: 6, class: "pesan-galat" }, e.message)));
  }
}

function gambarRiwayat() {
  if (!riwayatData) return;
  const hanya = $("#hanya-berubah").checked;
  const baris = [];
  for (const k of riwayatData.kejadian) {
    let jenis = k.jenis;
    if (jenis === "materialisasi") jenis = k.berubah === null ? "pertama" : k.berubah ? "baru" : "sama";
    if (hanya && jenis === "sama") continue;
    const [label, kelas] = JENIS[jenis] || [jenis, ""];
    const rinci = el("div", { class: "rincian" });
    const cekGagal = (k.cek || []).filter((c) => c.status === "FAILED" || c.status === "EXECUTION_FAILED");
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
      rinci.append(bagian.join(" · ") || (m.sumber ? `sumber ${m.sumber}` : ""));
      if (k.versi) rinci.append(" · ", el("code", { title: "versi data (checksum)" }, k.versi.slice(0, 10)));
    } else if (k.jenis === "unggah") {
      rinci.append(el("code", {}, k.nama), ` · ${k.baris ?? "?"} baris, ${ukuran(k.ukuran)}`, k.catatan ? ` · "${k.catatan}"` : "");
    } else if (k.jenis === "tarik") {
      rinci.append(el("code", {}, k.nama), " dipindah ke arsip");
    } else if (k.jenis === "konfigurasi") {
      rinci.append(el("code", {}, k.kunci), k.hapus ? " dihapus" : k.nilai != null ? ` = ${k.nilai}` : " diganti (secret)");
    } else if (k.jenis === "gagal") {
      rinci.append(el("span", { class: "galat" }, `Langkah gagal di ${k.job}. Buka log untuk penyebabnya.`));
    }
    for (const c of cekGagal) rinci.append(el("div", { class: c.keparahan === "ERROR" ? "galat" : "waspada" }, `⚠ ${c.nama}: ${c.pesan || "tidak lolos"}`));
    baris.push(el("tr", { class: jenis === "gagal" ? "gagal" : cekGagal.length ? "waspada" : "" },
      el("td", { class: "waktu" }, waktu(k.waktu)),
      el("td", { class: "nama-aset" }, k.aset),
      el("td", {}, el("span", { class: "lencana " + kelas }, label)),
      el("td", {}, rinci),
      el("td", { class: "ket" }, k.pemicu || "–"),
      el("td", {}, k.runId ? el("button", { class: "tombol kecil", type: "button", onclick: () => { pilihTab("pipeline"); setTimeout(() => bukaLog(k.runId), 200); } }, "Log") : null)));
  }
  $("#tabel-riwayat tbody").replaceChildren(...(baris.length ? baris : [el("tr", {}, el("td", { colspan: 6, class: "redup" }, "Belum ada riwayat."))]));
}
pemuat.riwayat = muatRiwayat;

// ---------- unggah manual ----------
async function muatSumber() {
  const wadah = $("#daftar-sumber");
  try {
    const d = await api("/sumber");
    $("#folder-manual").textContent = d.folder;
    const status = dataPipeline ? Object.fromEntries(dataPipeline.aset.map((a) => [a.nama, a])) : {};
    wadah.replaceChildren(...d.sumber.map((s) => gambarSumber(s, status)));
  } catch (e) {
    wadah.replaceChildren(el("p", { class: "pemberitahuan gagal" }, e.message));
  }
}

function gambarSumber(s, status) {
  const asetGagal = s.aset.filter((a) => status[a]?.status === "FAILURE");
  const kepala = el("div", { class: "sumber-kepala" },
    el("div", {}, el("h3", {}, s.label), el("p", { class: "redup kecil" }, s.ket + " Aset: ", s.aset.join(", "),
      s.env ? ` · mode ${s.env} = ` : "", s.env ? el("code", {}, s.mode || "(kosong)") : null)),
    asetGagal.length ? el("span", { class: "lencana gagal" }, "Aset gagal: " + asetGagal.join(", ")) : null);

  const daftar = el("div", { class: "berkas-daftar" }, ...s.acuan.map((b) => gambarBerkas(s, b)));
  const bagian = [kepala];
  if (s.env && s.mode && s.mode !== "manual") bagian.push(el("p", { class: "pemberitahuan info kecil" }, `Unggahan dipakai otomatis bila pengambilan ${s.mode} gagal. Untuk memaksa selalu memakai unggahan, ${punya("konfigurasi") ? `ubah ${s.env} menjadi manual di tab Konfigurasi` : `minta superadmin mengubah ${s.env} menjadi manual`}.`));
  bagian.push(daftar);
  if (s.lain.length) bagian.push(el("p", { class: "pemberitahuan waspada kecil" }, "Berkas di folder manual yang tidak dikenali aset (diabaikan): " + s.lain.map((x) => x.nama).join(", ")));
  if (s.riwayat.length) bagian.push(el("details", { class: "riwayat" }, el("summary", {}, `Riwayat unggahan (${s.riwayat.length})`),
    el("ul", {}, ...s.riwayat.map((r) => el("li", {}, `${waktu(r.waktu)} · ${r.tindakan === "tarik" ? "ditarik" : "diunggah"} `, el("code", {}, r.nama),
      r.baris != null ? ` · ${r.baris} baris, ${ukuran(r.ukuran)}` : "", ` · oleh ${r.pengguna}`, r.catatan ? ` · "${r.catatan}"` : "")))));
  return el("div", { class: "panel sumber", id: "sumber-" + s.id }, ...bagian);
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
      toast(d.pesan + " Jalankan ulang job di tab Pipeline bila perlu.");
      muatSumber();
    });
  };
  masukan.addEventListener("change", () => kirim(masukan.files[0]));
  const tombolUnggah = el("button", { class: "tombol kecil utama", type: "button", onclick: () => masukan.click() }, b.unggahan ? "Ganti" : "Unggah");
  const aksi = el("div", { class: "aksi" },
    el("a", { class: "tombol kecil", href: `${API}/sumber/${s.id}/${encodeURIComponent(b.nama)}/contoh`, title: "Header dan 3 baris pertama berkas acuan" }, "Contoh format"),
    tombolUnggah, masukan);
  if (b.unggahan) aksi.append(el("button", { class: "tombol kecil bahaya", type: "button", onclick: async (e) => {
    if (!confirm(`Tarik ${b.nama} dari pemakaian? Berkas dipindah ke arsip, aset kembali ke sumber otomatis/berkas repo.`)) return;
    await sibuk(e.currentTarget, async () => { const d = await api(`/sumber/${s.id}/${encodeURIComponent(b.nama)}`, { method: "DELETE" }); toast(d.pesan); muatSumber(); });
  } }, "Tarik"));
  kartu.append(
    el("div", {}, el("div", { class: "nama-aset" }, b.nama), el("div", { class: "kol", title: b.path }, b.kolom ? b.kolom.join(", ") : "(header tidak terbaca)"),
      b.unggahan ? el("div", { class: "status-unggah" }, `Unggahan aktif: ${ukuran(b.unggahan.ukuran)}, ${waktu(b.unggahan.waktu)}`) : null),
    aksi);
  // seret & lepas
  kartu.addEventListener("dragover", (e) => { e.preventDefault(); kartu.classList.add("seret"); });
  kartu.addEventListener("dragleave", () => kartu.classList.remove("seret"));
  kartu.addEventListener("drop", (e) => { e.preventDefault(); kartu.classList.remove("seret"); kirim(e.dataTransfer.files[0]); });
  return kartu;
}

pemuat.unggah = async () => { if (!dataPipeline) { try { dataPipeline = await api("/pipeline"); } catch { /* status opsional */ } } muatSumber(); };

// ---------- konfigurasi ----------
const NAMA_BERKAS = { pipeline: ["Pipeline (Dagster)", "Muat ulang Dagster"], bot: ["Bot WhatsApp", "Nyalakan ulang bot"] };

async function muatKonfigurasi() {
  const wadah = $("#daftar-konfigurasi");
  try {
    const d = await api("/konfigurasi");
    wadah.replaceChildren(...d.berkas.map(gambarKelompok));
  } catch (e) {
    wadah.replaceChildren(el("p", { class: "pemberitahuan gagal" }, e.message));
  }
}

function gambarKelompok(k) {
  const [judul, teksMuat] = NAMA_BERKAS[k.berkas] || [k.berkas, "Muat ulang"];
  const tombolMuat = el("button", { class: "tombol", type: "button", onclick: async (e) => {
    if (!confirm(`${teksMuat} sekarang?`)) return;
    await sibuk(e.currentTarget, async () => toast((await api(`/muat-ulang/${k.berkas}`, { method: "POST" })).pesan));
  } }, teksMuat);
  const kepala = el("div", { class: "baris-judul" }, el("div", {}, el("h3", {}, judul), el("p", { class: "redup kecil" }, el("code", {}, k.path))), tombolMuat);
  if (!k.ada) return el("div", { class: "panel kelompok" }, kepala, el("p", { class: "pemberitahuan waspada" }, "Berkas belum ada di server."));

  const kunciBaru = el("input", { placeholder: "NAMA_VARIABEL", pattern: "[A-Z][A-Z0-9_]*", "aria-label": "Nama variabel baru" });
  const nilaiBaru = el("input", { placeholder: "nilai", "aria-label": "Nilai variabel baru", autocomplete: "off" });
  const tambah = el("form", { class: "tambah-var", onsubmit: async (e) => {
    e.preventDefault();
    await sibuk(e.submitter || tambah.querySelector("button"), async () => {
      const d = await api("/konfigurasi", { method: "PUT", json: { berkas: k.berkas, kunci: kunciBaru.value.trim(), nilai: nilaiBaru.value } });
      toast(d.pesan); muatKonfigurasi();
    });
  } }, kunciBaru, nilaiBaru, el("button", { class: "tombol", type: "submit" }, "Tambah variabel"));
  return el("div", { class: "panel kelompok" }, kepala, ...k.variabel.map((v) => gambarVar(k.berkas, v)), tambah);
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

// ---------- akun ----------
const NAMA_HAK = { dasbor_sphp: "Dasbor lengkap termasuk SPHP", pipeline: "Pantau pipeline", jalankan: "Jalankan job",
  unggah: "Unggah data manual", konfigurasi: "Konfigurasi & secret", akun: "Kelola akun", jejak: "Jejak admin" };
pemuat.akun = async () => {
  try {
    const d = await api("/akun");
    $("#daftar-peran").replaceChildren(el("h3", {}, "Hak tiap peran"), el("div", { class: "peran-kartu" },
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
      return el("tr", { class: a.aktif ? "" : "waspada" }, el("td", { class: "nama-aset" }, a.nama, diri ? " (kamu)" : ""), el("td", {}, peran),
        el("td", {}, a.aktif ? el("span", { class: "lencana ok" }, "Aktif") : el("span", { class: "lencana waspada" }, "Nonaktif")),
        el("td", { class: "waktu" }, relatif(a.terakhirMasuk)), aksi);
    }));
  } catch (e) { toast(e.message, true); }
};

// ---------- jejak ----------
const NAMA_TINDAKAN = { buat_akun: "Buat akun", ubah_akun: "Ubah akun", hapus_akun: "Hapus akun", ganti_sandi: "Ganti sandi sendiri", login: "Masuk", login_gagal: "Gagal masuk", ubah_konfigurasi: "Ubah konfigurasi", uji_konfigurasi: "Uji key",
  muat_ulang: "Muat ulang layanan", unggah_manual: "Unggah manual", tarik_unggahan: "Tarik unggahan", jalankan_job: "Jalankan job" };
pemuat.jejak = async () => {
  try {
    const d = await api("/jejak");
    $("#tabel-jejak tbody").replaceChildren(...d.jejak.map((j) => {
      const { waktu: w, tindakan, pengguna, ip, ...rinci } = j;
      const teks = Object.entries(rinci).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");
      return el("tr", { class: tindakan === "login_gagal" ? "gagal" : "" }, el("td", { class: "waktu" }, waktu(w)), el("td", {}, NAMA_TINDAKAN[tindakan] || tindakan),
        el("td", {}, pengguna || "–"), el("td", { class: "ket" }, teks), el("td", { class: "mono kecil" }, ip || ""));
    }));
  } catch (e) { toast(e.message, true); }
};

// ---------- awal ----------
document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("#tab button").forEach((b) => b.addEventListener("click", () => pilihTab(b.dataset.tab)));
  $("#tombol-segarkan").addEventListener("click", (e) => sibuk(e.currentTarget, () => muatPipeline()));
  $("#tutup-log").addEventListener("click", () => { $("#panel-log").hidden = true; runTerbuka = null; });
  $("#hanya-galat").addEventListener("change", gambarLog);
  $("#hanya-berubah").addEventListener("change", gambarRiwayat);
  $("#filter-riwayat").append(el("option", { value: "" }, "Semua sumber (bronze)"));
  $("#filter-riwayat").addEventListener("change", muatRiwayat);
  $("#segarkan-riwayat").addEventListener("click", (e) => sibuk(e.currentTarget, muatRiwayat));
  $("#tombol-jalankan").addEventListener("click", async (e) => {
    const job = $("#pilih-job").value;
    if (!job || !confirm(`Jalankan ${job} sekarang?\n${dataPipeline?.job[job] || ""}`)) return;
    await sibuk(e.currentTarget, async () => { toast((await api("/jalankan", { method: "POST", json: { job } })).pesan); setTimeout(() => muatPipeline(true), 4000); });
  });
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
