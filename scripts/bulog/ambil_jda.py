"""TERAWANG · Ambil data Bulog Kanwil Jatim dari PDF "Provinsi Jawa Timur Dalam Angka" (BPS Jatim), Tabel 10.1.3-10.1.7.

Bulog tidak menerbitkan API atau tabel terstruktur. Satu-satunya publikasi rutin yang memuat stok, pengadaan, dan harga Bulog
Kanwil Jatim adalah Jatim Dalam Angka (terbit tiap Februari). Skrip ini:
  1. mencari edisi terbaru lewat WebAPI BPS (list/model/publication, domain 3500), lalu mengunduh PDF-nya
     (tautan download.php selalu diminta segar karena tokennya berubah tiap permintaan; PDF disimpan di <keluar>/bulog/_jda);
  2. membuang watermark diagonal "https://jatim.bps.go.id" (karakter berotasi 45 derajat) lalu mengekstrak tabel dengan pdfplumber;
  3. memeriksa akuntansi tiap tabel (awal + masuk = dikuasai, dikuasai - keluar = akhir, akhir bulan n = awal bulan n+1,
     jumlah 13 cabang = baris total, jumlah kanwil = Indonesia). Gagal = tidak ada berkas yang ditulis;
  4. menulis CSV dengan nama dan kolom yang sama dengan data/bulog (tahun di nama berkas mengikuti edisi), plus laporan_jda.json
     yang membandingkan hasilnya dengan CSV repo.

Keluaran (lapisan di atas repo lewat TERAWANG_DATA_DIR):
  <keluar>/bulog/stok_beras/provinsi/bulanan/bulog_jatim_stok_beras_provinsi_bulanan_<Y>.csv                        Tabel 10.1.3
  <keluar>/bulog/harga_acuan/provinsi/tahunan/bulog_jatim_harga_pembelian_pemerintah_gabah_beras_provinsi_tahunan_<A>_<B>.csv  10.1.4
  <keluar>/bulog/harga_penggilingan/kantor_cabang/tahunan/bulog_jatim_harga_beras_penggilingan_kantorcabang_tahunan_<A>_<B>.csv 10.1.5
  <keluar>/bulog/pengadaan_beras/kantor_cabang/tahunan/bulog_jatim_pengadaan_beras_kantorcabang_tahunan_<A>_<B>.csv         10.1.6
  <keluar>/bulog/stok_beras/kanwil/tahunan/bulog_nasional_stok_beras_kanwil_tahunan_<A>_<B>.csv                             10.1.7
  <keluar>/bulog/laporan_jda.json

  BPS_WEBAPI_KEY=... python scripts/bulog/ambil_jda.py --keluar ~/.local/share/terawang/data
  python scripts/bulog/ambil_jda.py --pdf jda_2026.pdf --keluar /tmp/uji     (PDF yang sudah ada, tanpa WebAPI)
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import shutil
import tempfile
import time
import urllib.parse
import urllib.request

import pandas as pd

API = "https://webapi.bps.go.id/v1/api"
JUDUL_EDISI = re.compile(r"^Provinsi Jawa Timur Dalam Angka (\d{4})$", re.I)
REPO = pathlib.Path("data/bulog")
BULAN = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"]

# kunci tabel: (penanda judul di halaman, nomor tabel di edisi 2026: hanya untuk laporan, halaman dicari dari judul)
TABEL = {
    "stok_bulanan": ("persediaan dan pengeluaran beras bulanan", "10.1.3"),
    "hpp": ("harga dasar gabah dan pembelian gabah", "10.1.4"),
    "penggilingan": ("harga beras pada tingkat penggilingan", "10.1.5"),
    "pengadaan": ("pengadaan beras menurut", "10.1.6"),
    "stok_kanwil": ("persediaan beras nasional", "10.1.7"),
}


# ---------------------------------------------------------------- unduh
def panggil(path: str, key: str) -> dict:
    url = f"{API}/{path}/key/{key}/"
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terawang-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == 3:  # pesan galat tanpa URL (URL memuat key)
                raise RuntimeError(f"WebAPI BPS gagal: {path}: {e.__class__.__name__}: {str(e).replace(key, '***')[:200]}") from None
            time.sleep(5 * (i + 1))
    raise RuntimeError("tidak terjangkau")


def cari_edisi(key: str, tahun: int | None) -> dict:
    """Entri publikasi JDA (pub_id, title, rl_date, pdf, ...) edisi `tahun`, atau edisi terbaru."""
    kw = urllib.parse.quote("provinsi jawa timur dalam angka")
    edisi, hal, jml = {}, 1, 1
    while hal <= jml:
        j = panggil(f"list/model/publication/lang/ind/domain/3500/keyword/{kw}/page/{hal}", key)
        if j.get("data-availability") != "available":
            break
        info, isi = j["data"][0], j["data"][1]
        jml = int(info.get("pages", 1))
        for e in isi:
            m = JUDUL_EDISI.match(e.get("title", "").strip())
            if m:
                edisi[int(m.group(1))] = e
        hal += 1
    if not edisi:
        raise RuntimeError("publikasi 'Provinsi Jawa Timur Dalam Angka' tidak ditemukan di WebAPI")
    pilih = tahun or max(edisi)
    if pilih not in edisi:
        raise RuntimeError(f"edisi {pilih} tidak ada; tersedia {sorted(edisi)}")
    e = edisi[pilih]
    try:  # detail: tautan pdf segar + updt_date
        d = panggil(f"view/model/publication/lang/ind/domain/3500/id/{e['pub_id']}", key).get("data", {})
        e = {**e, **{k: v for k, v in d.items() if v}}
    except Exception:
        pass
    return {**e, "edisi": pilih}


def unduh_pdf(e: dict, folder: pathlib.Path, key: str) -> tuple[pathlib.Path, bool]:
    """Unduh PDF edisi `e` ke folder kecuali versi yang sama (pub_id + updt_date) sudah ada. Kembali (path, baru_diunduh)."""
    folder.mkdir(parents=True, exist_ok=True)
    pdf, meta = folder / f"jda_{e['edisi']}.pdf", folder / f"jda_{e['edisi']}.json"
    tanda = {"pub_id": e.get("pub_id"), "rl_date": e.get("rl_date"), "updt_date": e.get("updt_date")}
    if pdf.exists() and meta.exists() and all(json.loads(meta.read_text()).get(k) == v for k, v in tanda.items()):
        return pdf, False
    url = e.get("pdf")
    if not url or "download.php" not in url:
        raise RuntimeError(f"tautan PDF edisi {e['edisi']} tidak ada di WebAPI")
    tmp = pdf.with_suffix(".unduh")
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terawang-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            break
        except Exception:
            if i == 2:
                raise
            time.sleep(10 * (i + 1))
            url = cari_edisi(key, e["edisi"]).get("pdf", url)  # token download.php kedaluwarsa: minta yang baru
    with open(tmp, "rb") as f:
        if f.read(5) != b"%PDF-":
            raise RuntimeError("unduhan bukan PDF")
    tmp.replace(pdf)
    meta.write_text(json.dumps({**tanda, "title": e.get("title"), "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                                "diunduh": dt.datetime.now().isoformat(timespec="seconds")}, ensure_ascii=False, indent=1))
    return pdf, True


# ---------------------------------------------------------------- baca PDF
def bersih(page):
    """Buang watermark diagonal: karakter dengan matriks berotasi (komponen b atau c bukan nol)."""
    return page.filter(lambda o: not (o.get("object_type") == "char" and (abs(o["matrix"][1]) > 1e-6 or abs(o["matrix"][2]) > 1e-6)))


def angka(s) -> float:
    s = re.sub(r"\s+", "", s or "")
    if s in ("", "–", "-", "—"):
        return 0.0
    if not re.fullmatch(r"\d{1,3}(\.\d{3})*(,\d+)?", s):
        raise ValueError(f"bukan angka berformat Indonesia: {s!r}")
    return float(s.replace(".", "").replace(",", "."))


def sel(c) -> str:
    return (c or "").strip()


def baris_pertama(c) -> str:
    return sel(c).split("\n")[0].strip()


def ke_angka(cells) -> list[float]:
    return [angka(c) for c in cells if sel(c) != ""]


def tahun_header(rows, n) -> list[int]:
    """Baris header yang berisi n tahun (4 digit)."""
    for r in rows:
        th = [int(sel(c)) for c in r if re.fullmatch(r"(19|20)\d{2}", sel(c))]
        if len(th) == n:
            return th
    raise ValueError(f"baris header {n} tahun tidak ditemukan")


def olah(kunci: str, rows: list[list], teks: str) -> tuple[str, pd.DataFrame, dict]:
    """Tabel mentah (extract_tables, sudah bebas watermark) -> (nama berkas relatif, DataFrame format repo, catatan)."""
    cat = {}
    if kunci == "stok_bulanan":
        m = re.search(r"\(kg\),\s*((?:19|20)\d{2})", teks.replace("\n", " "))
        if not m:
            raise ValueError("tahun tabel stok bulanan tidak ditemukan di judul")
        y = int(m.group(1))
        data = []
        for r in rows:
            nama = baris_pertama(r[0]).lower()
            b = next((i + 1 for i, bl in enumerate(BULAN) if nama.startswith(bl)), None)
            if b:
                v = ke_angka(r[1:])
                if len(v) != 5:
                    raise ValueError(f"stok bulanan {nama}: {len(v)} nilai, diharapkan 5")
                data.append([y, b] + v)
        df = pd.DataFrame(data, columns=["tahun", "bulan", "persediaan_awal_kg", "pemasukan_kg", "persediaan_dikuasai_kg", "pengeluaran_kg", "persediaan_akhir_kg"])
        if df.bulan.tolist() != list(range(1, 13)):
            raise ValueError(f"stok bulanan: bulan {df.bulan.tolist()}, diharapkan 1-12")
        for i, x in df.iterrows():
            if abs(x.persediaan_awal_kg + x.pemasukan_kg - x.persediaan_dikuasai_kg) > 0.05 or abs(x.persediaan_dikuasai_kg - x.pengeluaran_kg - x.persediaan_akhir_kg) > 0.05:
                raise ValueError(f"stok bulanan {y}-{x.bulan}: awal + masuk = dikuasai atau dikuasai - keluar = akhir tidak terpenuhi")
            if i < 11 and abs(x.persediaan_akhir_kg - df.persediaan_awal_kg[i + 1]) > 0.05:
                raise ValueError(f"stok bulanan {y}-{x.bulan}: akhir bulan tidak sama dengan awal bulan berikutnya")
        return f"stok_beras/provinsi/bulanan/bulog_jatim_stok_beras_provinsi_bulanan_{y}.csv", df, cat

    if kunci == "hpp":
        data = []
        for r in rows:
            t = sel(r[0])
            if not re.fullmatch(r"(19|20)\d{2}", t):
                continue
            ket = next((sel(c) for c in r[1:3] if sel(c) and not re.match(r"^[\d.,–-]+$", sel(c))), "")
            v = ke_angka([c for c in r[1:] if sel(c) and sel(c) != ket])
            if len(v) != 5:
                raise ValueError(f"HPP {t}: {len(v)} nilai, diharapkan 5")
            data.append([int(t), ket] + [int(round(x)) for x in v])
        df = pd.DataFrame(data, columns=["tahun", "keterangan", "harga_dasar_gabah_rp_kg", "gabah_kud_rp_kg", "gabah_non_kud_rp_kg", "beras_kud_rp_kg", "beras_non_kud_rp_kg"])
        th = sorted(df.tahun.unique())
        if th != list(range(th[0], th[-1] + 1)) or (df.iloc[:, 2:] <= 0).any().any():
            raise ValueError("HPP: tahun tidak berurutan atau ada harga <= 0")
        return f"harga_acuan/provinsi/tahunan/bulog_jatim_harga_pembelian_pemerintah_gabah_beras_provinsi_tahunan_{th[0]}_{th[-1]}.csv", df, cat

    if kunci == "penggilingan":
        th = tahun_header(rows, 3)
        data, rata = [], None
        for r in rows:
            n = baris_pertama(r[0])
            m = re.match(r"^\d+\.\s*(.+)$", n)
            if m:
                data.append([m.group(1).strip()] + ke_angka(r[1:]))
            elif n.lower().startswith("rata-rata"):
                rata = ke_angka(r[1:])
        df = pd.DataFrame(data, columns=["kantor_cabang"] + [f"harga_{y}_rp_kg" for y in th])
        if len(df) != 13 or rata is None:
            raise ValueError(f"harga penggilingan: {len(df)} cabang (diharapkan 13) atau baris rata-rata tidak ada")
        for y, rv in zip(th, rata):  # catatan saja: rata-rata 2023 di edisi 2026 memang tidak cocok dengan barisnya (salah ketik sumber)
            hit = df[f"harga_{y}_rp_kg"].mean()
            if abs(hit - rv) > 0.05:
                cat[f"rata_{y}_tidak_cocok"] = {"publikasi": rv, "hitung": round(float(hit), 2)}
        return f"harga_penggilingan/kantor_cabang/tahunan/bulog_jatim_harga_beras_penggilingan_kantorcabang_tahunan_{th[0]}_{th[-1]}.csv", df, cat

    if kunci == "pengadaan":
        th = tahun_header(rows, 6)
        if th[0::2] != [th[0]] * 3 or th[1::2] != [th[1]] * 3:
            raise ValueError(f"pengadaan: header tahun tak terduga {th}")
        kol = [f"{s}_{y}_kg" for s in ("kud", "non_kud_ktna", "satgas_upgb_draying") for y in th[:2]]
        data, total = [], None
        for r in rows:
            n = baris_pertama(r[0])
            m = re.match(r"^\d+\.\s*(.+)$", n)
            if m:
                data.append([m.group(1).strip()] + ke_angka(r[1:]))
            elif n.lower().startswith(("rata-rata", "jumlah", "total")):
                total = ke_angka(r[1:])
        df = pd.DataFrame(data, columns=["kantor_cabang"] + kol)
        if len(df) != 13 or total is None:
            raise ValueError(f"pengadaan: {len(df)} cabang (diharapkan 13) atau baris total tidak ada")
        for k, t in zip(kol, total):
            if abs(df[k].sum() - t) > 0.5:
                raise ValueError(f"pengadaan {k}: jumlah 13 cabang {df[k].sum():.2f} != total {t:.2f}")
        return f"pengadaan_beras/kantor_cabang/tahunan/bulog_jatim_pengadaan_beras_kantorcabang_tahunan_{th[0]}_{th[1]}.csv", df, cat

    if kunci == "stok_kanwil":
        th = tahun_header(rows, 3)
        data = []
        for r in rows:
            n = baris_pertama(r[0])
            try:  # baris header ("2023", "(2)") bukan angka berformat Indonesia: dilewati
                v = ke_angka(r[1:])
            except ValueError:
                continue
            if n and len(v) == 3:
                data.append([n] + v)
        df = pd.DataFrame(data, columns=["kantor_wilayah"] + [f"stok_{y}_kg" for y in th])
        ind = df[df.kantor_wilayah == "Indonesia"]
        if len(ind) != 1:
            raise ValueError("stok kanwil: baris Indonesia tidak ada")
        lain = df[df.kantor_wilayah != "Indonesia"]
        if "Jawa Timur" not in set(lain.kantor_wilayah):
            raise ValueError("stok kanwil: baris Jawa Timur tidak ada")
        for y in th:
            if abs(lain[f"stok_{y}_kg"].sum() - ind[f"stok_{y}_kg"].iloc[0]) > 1:
                raise ValueError(f"stok kanwil {y}: jumlah {len(lain)} kanwil != Indonesia")
        cat["jumlah_kanwil"] = len(lain)
        return f"stok_beras/kanwil/tahunan/bulog_nasional_stok_beras_kanwil_tahunan_{th[0]}_{th[-1]}.csv", df, cat
    raise KeyError(kunci)


def ekstrak(pdf_path: pathlib.Path) -> dict:
    """{kunci: (nama_rel, df, catatan, halaman)} untuk kelima tabel. Halaman dicari dari judul, mulai dari rentang bab Harga."""
    import pdfplumber

    hasil, galat = {}, {}
    with pdfplumber.open(pdf_path) as pdf:
        n = len(pdf.pages)
        urutan = list(range(int(n * 0.6), int(n * 0.9))) + list(range(0, int(n * 0.6))) + list(range(int(n * 0.9), n))
        for i in urutan:
            if len(hasil) == len(TABEL):
                break
            p = bersih(pdf.pages[i])
            teks = p.extract_text() or ""
            datar = re.sub(r"\s+", " ", teks).lower()
            if "tabel" not in datar or "sumber" not in datar:
                continue
            for kunci, (judul, _) in TABEL.items():
                if kunci in hasil or judul not in datar:
                    continue
                try:
                    tabel = max(p.extract_tables(), key=len, default=None)
                    if not tabel:
                        raise ValueError("tidak ada tabel")
                    nama, df, cat = olah(kunci, tabel, teks)
                    hasil[kunci] = (nama, df, cat, i + 1)
                except Exception as e:  # mis. halaman daftar tabel: lanjut cari
                    galat.setdefault(kunci, []).append(f"hlm {i + 1}: {e}")
    hilang = [k for k in TABEL if k not in hasil]
    if hilang:
        raise RuntimeError(f"tabel tidak ditemukan atau gagal diperiksa: {hilang}; {json.dumps({k: galat.get(k, [])[:3] for k in hilang}, ensure_ascii=False)}")
    return hasil


# ---------------------------------------------------------------- tulis
def bandingkan(df: pd.DataFrame, path: pathlib.Path) -> dict:
    if not path.exists():
        return {"repo": "tidak ada (berkas baru)"}
    r = pd.read_csv(path)
    if list(r.columns) != list(df.columns) or len(r) != len(df):
        return {"repo": "beda struktur", "kolom_repo": list(r.columns), "baris_repo": len(r), "baris_pdf": len(df)}
    beda = []
    for c in df.columns:
        a, b = df[c].reset_index(drop=True), r[c].reset_index(drop=True)
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            idx = [i for i in range(len(a)) if abs(float(a[i]) - float(b[i])) > 0.005]
        else:
            idx = [i for i in range(len(a)) if (str(a[i]) if pd.notna(a[i]) else "") != (str(b[i]) if pd.notna(b[i]) else "")]
        beda += [{"baris": int(i), "kolom": c, "pdf": a[i], "repo": b[i]} for i in idx]
    return {"repo": "sama" if not beda else f"{len(beda)} sel beda", "beda": beda[:20]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keluar", required=True)
    ap.add_argument("--pdf", help="pakai PDF ini (tanpa WebAPI)")
    ap.add_argument("--edisi", type=int, help="tahun edisi (default: terbaru)")
    a = ap.parse_args()
    keluar = pathlib.Path(a.keluar).expanduser() / "bulog"
    lap = {"diambil": dt.datetime.now().isoformat(timespec="seconds")}
    if a.pdf:
        pdf, lap["sumber"] = pathlib.Path(a.pdf), {"pdf": str(a.pdf)}
    else:
        key = os.environ.get("BPS_WEBAPI_KEY", "")
        if not key:
            raise SystemExit("BPS_WEBAPI_KEY belum diisi (atau beri --pdf)")
        e = cari_edisi(key, a.edisi)
        pdf, baru = unduh_pdf(e, keluar / "_jda", key)
        lap["sumber"] = {"judul": e.get("title"), "edisi": e["edisi"], "pub_id": e.get("pub_id"), "rl_date": e.get("rl_date"),
                         "updt_date": e.get("updt_date"), "pdf_baru_diunduh": baru}
        print(f"edisi {e['edisi']} ({e.get('title')}, rilis {e.get('rl_date')}); PDF {'diunduh' if baru else 'sudah ada'}", flush=True)
        lama = keluar / "laporan_jda.json"
        if not baru and lama.exists():  # PDF sama dengan run lalu dan berkasnya masih ada: tidak perlu diekstrak ulang
            l = json.loads(lama.read_text())
            if l.get("sumber", {}).get("pub_id") == e.get("pub_id") and l.get("sumber", {}).get("updt_date") == e.get("updt_date") \
                    and l.get("berkas") and all((keluar / n).exists() for n in l["berkas"]):
                print(f"PDF tidak berubah sejak {l.get('diambil')}; {len(l['berkas'])} berkas Bulog tetap dipakai")
                return
    lap["sumber"]["sha256_pdf"] = hashlib.sha256(pdf.read_bytes()).hexdigest()

    hasil = ekstrak(pdf)
    lap["tabel"], lap["berkas"] = {}, {}
    with tempfile.TemporaryDirectory(dir=keluar.parent if keluar.parent.exists() else None) as tmp:
        for kunci, (nama, df, cat, hlm) in hasil.items():
            lap["tabel"][kunci] = {"nomor_2026": TABEL[kunci][1], "halaman_pdf": hlm, "baris": len(df), **cat}
            t = pathlib.Path(tmp) / nama
            t.parent.mkdir(parents=True, exist_ok=True)
            df.to_csv(t, index=False, float_format=None if kunci == "hpp" else "%.2f")
            lap["berkas"][nama] = bandingkan(pd.read_csv(t), REPO / nama)
        for nama in lap["berkas"]:  # semua tabel lolos: baru dipindah ke lapisan
            (keluar / nama).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(pathlib.Path(tmp) / nama, keluar / nama)
    (keluar / "laporan_jda.json").write_text(json.dumps(lap, ensure_ascii=False, indent=1, default=str))
    for nama, b in lap["berkas"].items():
        print(f"  {nama}: {b['repo']}")
    print(f"Tersimpan {len(lap['berkas'])} berkas Bulog di {keluar}")


if __name__ == "__main__":
    main()
