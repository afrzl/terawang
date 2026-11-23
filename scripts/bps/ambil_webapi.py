"""TERAWANG · Ambil data BPS lewat WebAPI (webapi.bps.go.id) dan tulis dalam format yang sama dengan CSV di data/bps.

Tabel dinamis yang diambil:
  var 578 (domain 3500)  Luas Panen Padi menurut Kab/Kota, bulanan (ha)
  var 580 (domain 3500)  Produksi Beras menurut Kab/Kota, bulanan (ton beras)
  var 2094 (domain 0000) Rata-rata Konsumsi per Kapita Seminggu, padi-padian per kab/kota (turvar 1735 = beras), Susenas Maret

Keluaran (struktur folder sama dengan data/, jadi bisa dipakai sebagai lapisan di atas repo lewat TERAWANG_DATA_DIR):
  <keluar>/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv
  <keluar>/bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_<tahun>.csv           (tahun >= 2025)
  <keluar>/bps/konsumsi_beras/kabkota/tahunan/bps_jatim_konsumsi_beras_kabkota_tahunan_<tahun>.csv (tahun >= 2025)
  <keluar>/bps/laporan_webapi.json   tahun tersedia, koreksi otomatis, selisih terhadap CSV repo

Pemeriksaan: jumlah 12 bulan = angka Tahunan per kab, dan jumlah 38 kab = Jawa Timur per bulan. Sel yang membuat KEDUANYA
meleset dengan selisih yang sama dianggap salah ketik di sumber dan dikoreksi (nilai = tahunan - bulan lain), dengan catatan
yang sama dengan CSV manual. Selisih yang tidak bisa dijelaskan: nilai CSV repo dipakai bila ada; kalau tidak ada, skrip gagal.

  BPS_WEBAPI_KEY=... python scripts/bps/ambil_webapi.py --keluar ~/.local/share/terawang/data
Key dibaca dari env BPS_WEBAPI_KEY (bukan argumen), supaya tidak tampil di daftar proses atau log Dagster.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import time
import urllib.parse
import urllib.request

import pandas as pd

API = "https://webapi.bps.go.id/v1/api/list/model"
JATIM = 35000
TAHUN_LUAS = range(2019, 2025)  # berkas riwayat luas panen 2019-2024
TOL_BARIS, TOL_KOLOM = 0.10, 0.30  # pembulatan BPS (2 desimal): 12 bulan dan 38 kab
REPO = pathlib.Path("data")


def panggil(path: str, key: str) -> dict:
    url = f"{API}/{path}/key/{key}/"
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terawang-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == 3:  # pesan galat tanpa URL (URL memuat key)
                raise RuntimeError(f"WebAPI BPS gagal: {path.split('/key/')[0]}: {e.__class__.__name__}: {str(e).replace(key, '***')[:200]}") from None
            time.sleep(5 * (i + 1))
    raise RuntimeError("tidak terjangkau")


def tahun_tersedia(domain: str, var: int, key: str) -> dict[int, int]:
    """{tahun: th_id}. Dari endpoint th; bila gagal, pakai th_id = tahun - 1900 untuk 2018..tahun ini."""
    try:
        j = panggil(f"th/lang/ind/domain/{domain}/var/{var}", key)
        daftar = next(x for x in j.get("data", []) if isinstance(x, list))
        return {int(x["th"]): int(x["th_id"]) for x in daftar}
    except Exception:
        return {y: y - 1900 for y in range(2018, dt.date.today().year + 1)}


def ambil(domain: str, var: int, tahun: list[int], th_id: dict[int, int], key: str) -> tuple[dict, dict]:
    """Gabungan datacontent dan label (vervar, turvar, turtahun, tahun) untuk tahun yang diminta, 3 tahun per panggilan."""
    isi, label = {}, {"vervar": {}, "turvar": {}, "turtahun": {}, "tahun": {}}
    for i in range(0, len(tahun), 3):
        ths = ";".join(str(th_id[y]) for y in tahun[i:i + 3])
        j = panggil(f"data/lang/ind/domain/{domain}/var/{var}/th/{urllib.parse.quote(ths, safe=';')}", key)
        if j.get("data-availability") != "available":
            continue
        isi.update({str(k): v for k, v in (j.get("datacontent") or {}).items()})
        for kel in label:
            for x in j.get(kel) or []:
                label[kel][int(x["val"])] = x["label"]
        time.sleep(1)
    return isi, label


def nilai(isi: dict, vervar: int, var: int, turvar: int, th: int, turtahun: int):
    v = isi.get(f"{vervar}{var}{turvar}{th}{turtahun}")
    return None if v in (None, "", "-") else float(v)


def peta_wilayah() -> pd.DataFrame:
    """Nama BPS -> wilayah, jenis, nama_repo (dari CSV repo, supaya nama sama persis)."""
    r = pd.read_csv(REPO / "bps/produksi_padi/kabkota/bulanan/bps_jatim_padi_kabkota_bulanan_2025.csv")
    return r[["wilayah", "jenis", "nama_repo"]].drop_duplicates().reset_index(drop=True)


def normal(label: str) -> str:
    s = " ".join(label.replace("Kab.", "Kabupaten").split())
    return s[len("Kabupaten "):] if s.startswith("Kabupaten ") else s


def kode_wilayah(vervar: dict[int, str]) -> dict[int, str]:
    """vervar 35xx -> nama `wilayah` di CSV repo (38 kab/kota). Gagal kalau ada yang tidak cocok."""
    peta = set(peta_wilayah().wilayah)
    out = {v: normal(lb) for v, lb in vervar.items() if 3500 < v < 3600}
    salah = sorted(n for n in out.values() if n not in peta)
    if salah or len(out) != 38:
        raise SystemExit(f"nama wilayah BPS tidak cocok dengan repo: {salah} (jumlah {len(out)})")
    return out


def matriks(isi, var, th, kode) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """(kab x bulan 1..12, tahunan per kab, Jawa Timur per bulan)."""
    m = pd.DataFrame({b: {n: nilai(isi, k, var, 0, th, b) for k, n in kode.items()} for b in range(1, 13)})
    tahunan = pd.Series({n: nilai(isi, k, var, 0, th, 13) for k, n in kode.items()})
    prov = pd.Series({b: nilai(isi, JATIM, var, 0, th, b) for b in range(1, 13)})
    return m, tahunan, prov


def periksa_koreksi(m, tahunan, prov, nama_kolom, tahun, repo_nilai, laporan) -> pd.DataFrame:
    """Kembalikan matriks terkoreksi dan matriks teks koreksi."""
    m = m.copy()
    catatan = pd.DataFrame("", index=m.index, columns=m.columns)
    if m.isna().any().any():
        kosong = [(k, b) for k in m.index for b in m.columns if pd.isna(m.loc[k, b])]
        raise SystemExit(f"{nama_kolom} {tahun}: sel kosong {kosong[:5]}")
    def selisih():
        db = (tahunan - m.sum(axis=1)) if tahunan.notna().all() else pd.Series(0.0, index=m.index)
        dk = (prov - m.sum(axis=0)) if prov.notna().all() else pd.Series(0.0, index=m.columns)
        return db[db.abs() > TOL_BARIS], dk[dk.abs() > TOL_KOLOM]

    def koreksi(k, b, delta):
        asli, baru = m.loc[k, b], round(m.loc[k, b] + delta, 2)
        m.loc[k, b] = baru
        catatan.loc[k, b] = (f"{nama_kolom} dikoreksi dari {asli:.2f} (salah ketik di sumber; dibuktikan oleh total tahunan baris "
                             f"dan total provinsi bulan itu)")
        laporan["koreksi"].append({"kolom": nama_kolom, "tahun": tahun, "wilayah": k, "bulan": int(b), "sumber": asli, "jadi": baru})

    # 1) satu sel salah di baris itu: selisih baris = selisih satu kolom
    d_baris, d_kolom = selisih()
    for k in d_baris.index:
        cocok = [b for b in d_kolom.index if abs(d_kolom[b] - d_baris[k]) <= TOL_KOLOM]
        if len(cocok) == 1:
            koreksi(k, cocok[0], d_baris[k])
    # 2) satu baris tersisa dengan beberapa sel salah: jumlah selisih kolom yang tersisa = selisih baris
    d_baris, d_kolom = selisih()
    if len(d_baris) == 1 and len(d_kolom) and abs(d_kolom.sum() - d_baris.iloc[0]) <= TOL_KOLOM:
        for b in d_kolom.index:
            koreksi(d_baris.index[0], b, d_kolom[b])
    d_baris, d_kolom = selisih()
    for k in d_baris.index:
        if True:
            laporan["tak_terjelaskan"].append({"kolom": nama_kolom, "tahun": tahun, "wilayah": k, "selisih_tahunan": round(float(d_baris[k]), 2)})
            if repo_nilai is None:
                raise SystemExit(f"{nama_kolom} {tahun} {k}: jumlah 12 bulan beda {d_baris[k]:.2f} dari tahunan, tidak bisa dikoreksi")
            for b in m.columns:  # pakai CSV repo untuk baris ini
                rv = repo_nilai.get((k, b))
                if rv is not None and abs(rv - m.loc[k, b]) > 0.005:
                    catatan.loc[k, b] = f"{nama_kolom} memakai CSV repo (WebAPI {m.loc[k, b]:.2f} tidak lolos pemeriksaan)"
                    m.loc[k, b] = rv
    return m, catatan


def repo_bulanan(path: pathlib.Path, kolom: str) -> dict | None:
    if not path.exists():
        return None
    r = pd.read_csv(path)
    return {(w, int(b), int(t)): float(v) for w, b, t, v in zip(r.wilayah, r.bulan, r.tahun, r[kolom])}


def bandingkan(df: pd.DataFrame, path: pathlib.Path, kolom: list[str], kunci: list[str]) -> dict:
    if not path.exists():
        return {"repo": "tidak ada"}
    r = pd.read_csv(path)
    g = df.merge(r, on=kunci, how="outer", suffixes=("_api", "_repo"), indicator=True)
    out = {"baris_api": int(len(df)), "baris_repo": int(len(r)), "hanya_satu_sisi": int((g._merge != "both").sum())}
    for c in kolom:
        beda = g[(g._merge == "both") & ((g[f"{c}_api"] - g[f"{c}_repo"]).abs() > 0.005)]
        out[f"beda_{c}"] = int(len(beda))
        if len(beda):
            out[f"contoh_beda_{c}"] = beda[kunci + [f"{c}_api", f"{c}_repo"]].head(5).to_dict("records")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keluar", required=True)
    a = ap.parse_args()
    a.key = os.environ.get("BPS_WEBAPI_KEY", "")
    if not a.key:
        raise SystemExit("BPS_WEBAPI_KEY belum diisi")
    keluar = pathlib.Path(a.keluar).expanduser()
    wil = peta_wilayah().set_index("wilayah")
    laporan = {"diambil": dt.datetime.now().isoformat(timespec="seconds"), "koreksi": [], "tak_terjelaskan": [], "berkas": {}}

    # ---- produksi padi bulanan per kab/kota (578 luas, 580 beras)
    th578, th580 = tahun_tersedia("3500", 578, a.key), tahun_tersedia("3500", 580, a.key)
    t_luas = sorted(y for y in th578 if y >= min(TAHUN_LUAS))
    isi578, lb578 = ambil("3500", 578, t_luas, th578, a.key)
    t_prod = sorted(y for y in th580 if y >= 2025 and y in th578)
    isi580, lb580 = ambil("3500", 580, t_prod, th580, a.key)
    kode = kode_wilayah(lb578["vervar"])

    def ada(isi, var, th):
        return any(nilai(isi, k, var, 0, th, b) is not None for k in kode for b in range(1, 13))

    tersedia_luas = sorted(y for y in t_luas if ada(isi578, 578, th578[y]))
    laporan["tahun_luas_panen"] = tersedia_luas
    d_bul = keluar / "bps/produksi_padi/kabkota/bulanan"
    d_bul.mkdir(parents=True, exist_ok=True)

    def baris_luas(tahun):
        m, th, pv = matriks(isi578, 578, th578[tahun], kode)
        path_repo = REPO / ("bps/produksi_padi/kabkota/bulanan/" + ("bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv" if tahun < 2025 else f"bps_jatim_padi_kabkota_bulanan_{tahun}.csv"))
        rv = repo_bulanan(path_repo, "luas_panen_ha")
        rv = None if rv is None else {(w, b): v for (w, b, t), v in rv.items() if t == tahun}
        return periksa_koreksi(m, th, pv, "luas_panen", tahun, rv or None, laporan)

    def panjang(m, cat, tahun, kolom):
        rows = [(k, tahun, b, round(float(m.loc[k, b]), 2), cat.loc[k, b]) for k in m.index for b in m.columns]
        return pd.DataFrame(rows, columns=["wilayah", "tahun", "bulan", kolom, f"koreksi_{kolom}"])

    # riwayat 2019-2024 (format sama dengan CSV repo)
    riw = []
    for y in [t for t in tersedia_luas if t in TAHUN_LUAS]:
        m, cat = baris_luas(y)
        riw.append(panjang(m, cat, y, "luas_panen_ha"))
    if riw:
        df = pd.concat(riw).merge(wil.reset_index(), on="wilayah")
        df["koreksi"] = df.pop("koreksi_luas_panen_ha")
        df = df[["wilayah", "jenis", "nama_repo", "tahun", "bulan", "luas_panen_ha", "koreksi"]]
        nama = "bps_jatim_padi_kabkota_bulanan_luas_panen_2019_2024.csv"
        df.to_csv(d_bul / nama, index=False)
        laporan["berkas"][nama] = bandingkan(df, REPO / "bps/produksi_padi/kabkota/bulanan" / nama, ["luas_panen_ha"], ["nama_repo", "tahun", "bulan"])

    # tahun >= 2025: luas + produksi beras, satu berkas per tahun
    tersedia_prod = sorted(y for y in t_prod if ada(isi580, 580, th580[y]))
    laporan["tahun_produksi_beras"] = tersedia_prod
    for y in [t for t in tersedia_prod if t in tersedia_luas]:
        ml, cl = baris_luas(y)
        mp, tp, pp = matriks(isi580, 580, th580[y], kode)
        nama = f"bps_jatim_padi_kabkota_bulanan_{y}.csv"
        rv = repo_bulanan(REPO / "bps/produksi_padi/kabkota/bulanan" / nama, "produksi_beras_ton")
        rv = None if rv is None else {(w, b): v for (w, b, t), v in rv.items()}
        mp, cp = periksa_koreksi(mp, tp, pp, "produksi_beras", y, rv, laporan)
        df = panjang(ml, cl, y, "luas_panen_ha").merge(panjang(mp, cp, y, "produksi_beras_ton"), on=["wilayah", "tahun", "bulan"])
        df["koreksi"] = [("; ".join(x for x in (a1, b1) if x)) for a1, b1 in zip(df.pop("koreksi_luas_panen_ha"), df.pop("koreksi_produksi_beras_ton"))]
        df = df.merge(wil.reset_index(), on="wilayah")[["wilayah", "jenis", "nama_repo", "tahun", "bulan", "luas_panen_ha", "produksi_beras_ton", "koreksi"]]
        df.to_csv(d_bul / nama, index=False, float_format="%.2f")
        laporan["berkas"][nama] = bandingkan(df, REPO / "bps/produksi_padi/kabkota/bulanan" / nama, ["luas_panen_ha", "produksi_beras_ton"], ["nama_repo", "tahun", "bulan"])

    # ---- konsumsi beras per kapita seminggu (2094, domain 0000, turvar 1735)
    th2094 = tahun_tersedia("0000", 2094, a.key)
    t_kon = sorted(y for y in th2094 if y >= 2025)
    isi2094, lb2094 = ambil("0000", 2094, t_kon, th2094, a.key)
    kode_k = kode_wilayah({v: lb for v, lb in lb2094["vervar"].items() if 3500 < v < 3600})
    d_kon = keluar / "bps/konsumsi_beras/kabkota/tahunan"
    d_kon.mkdir(parents=True, exist_ok=True)
    laporan["tahun_konsumsi"] = []
    for y in t_kon:
        v = {n: nilai(isi2094, k, 2094, 1735, th2094[y], 0) for k, n in kode_k.items()}
        if all(x is None for x in v.values()):
            continue
        if any(x is None or not (0.5 <= x <= 3.0) for x in v.values()):
            raise SystemExit(f"konsumsi {y}: nilai kosong atau di luar 0,5-3 kg/minggu: {v}")
        laporan["tahun_konsumsi"].append(y)
        kol = f"konsumsi_beras_{y}_kg_kapita_minggu"
        df = pd.DataFrame({"wilayah": list(v), kol: list(v.values())}).merge(wil.reset_index(), on="wilayah")[["wilayah", "jenis", "nama_repo", kol]]
        urut = pd.read_csv(REPO / "bps/konsumsi_beras/kabkota/tahunan/bps_jatim_konsumsi_beras_kabkota_tahunan_2025.csv").nama_repo.tolist()
        df = df.set_index("nama_repo").loc[urut].reset_index()[["wilayah", "jenis", "nama_repo", kol]]
        nama = f"bps_jatim_konsumsi_beras_kabkota_tahunan_{y}.csv"
        df.to_csv(d_kon / nama, index=False)
        laporan["berkas"][nama] = bandingkan(df, REPO / "bps/konsumsi_beras/kabkota/tahunan" / nama, [kol], ["nama_repo"])

    (keluar / "bps/laporan_webapi.json").write_text(json.dumps(laporan, indent=1, ensure_ascii=False, default=str))
    print(json.dumps({k: laporan[k] for k in ("tahun_luas_panen", "tahun_produksi_beras", "tahun_konsumsi")}, ensure_ascii=False))
    print(f"koreksi otomatis {len(laporan['koreksi'])}, tak terjelaskan {len(laporan['tak_terjelaskan'])}")
    for nama, b in laporan["berkas"].items():
        print(" ", nama, json.dumps(b, ensure_ascii=False, default=str)[:400])


if __name__ == "__main__":
    main()
