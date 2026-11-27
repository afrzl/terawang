"""TERAWANG K3a · Uji prediksi harga beras spasio-temporal (27 Nov 2026). TIDAK dipakai operasional.

Membandingkan, pada asal (origin) harian yang sama dan horizon 7/14/21/28 hari:
  NAIF       harga hari terakhir (= titik tengah model K3a sekarang, karena median galat EW60 = 0)
  RIDGE      ridge pada fitur waktu kab sendiri + rata-rata provinsi (tanpa tetangga)
  RIDGE+SP   RIDGE + fitur lag spasial (rata-rata harga tetangga berbobot jarak jalan, selisih terhadap tetangga, momentum tetangga)
  GBM, GBM+SP  sama, HistGradientBoosting
  GNN        GCN kecil gaya Graph WaveNet (konvolusi waktu bertingkat + konvolusi graf jarak jalan + adjasensi adaptif)
  GNN-tanpa-graf  arsitektur sama, adjasensi = identitas (ablasi: apakah graf membantu)
Walk-forward: model dilatih ulang tiap awal bulan (GNN tiap 3 bulan) hanya dengan target yang sudah terjadi sebelum tanggal latih.
Periode uji: asal 1 Jan 2025 s.d. data terakhir. Metrik: MAPE, RMSE relatif naif, deteksi kenaikan >= 2% (AUC, PR-AUC).

  python scripts/k3/uji_spasio_temporal.py [--komoditas medium|premium] [--tanpa-gnn]
Butuh: numpy pandas scikit-learn torch. Hasil: data/satelit/uji_spasio_temporal_<kom>.csv (prediksi per asal) dan ringkasan di layar.
"""
import argparse
import os

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HOR = (7, 14, 21, 28)
MULAI = pd.Timestamp("2022-03-01")  # butuh 56 hari riwayat
MULAI_UJI = pd.Timestamp("2025-01-01")
LEBAR = 60.0  # km, lebar pita kernel jarak jalan
FOLDER = "data/siskaperbapo/harga_beras"
JARAK = "data/geografi/jarak_kabkota/jarak_jalan_km_kabkota.csv"


def nama(s):
    s = str(s).strip()
    return s[len("Kabupaten "):] if s.startswith("Kabupaten ") else s


def muat(kom):
    d = pd.read_csv(os.path.join(FOLDER, f"kabkota_harian_beras_{kom}.csv"), parse_dates=["tanggal"])
    d["kab"] = d.kabkota.map(nama)
    P = d.pivot_table(index="tanggal", columns="kab", values="harga_rata2_rp_kg").asfreq("D").ffill(limit=3)
    D = pd.read_csv(JARAK, index_col=0)
    D = (D + D.T) / 2  # rata-rata dua arah
    kol = [c for c in D.columns if c in P.columns]
    assert len(kol) == 38, set(P.columns) ^ set(D.columns)
    return P[kol], D.loc[kol, kol].to_numpy()


def bobot_spasial(D):
    W = np.exp(-D / LEBAR)
    np.fill_diagonal(W, 0)
    return W / W.sum(1, keepdims=True)


def fitur(L, W):
    prov = L.mean(axis=1)
    kons = lambda v: pd.DataFrame(np.repeat(np.asarray(v)[:, None], L.shape[1], 1), index=L.index, columns=L.columns)  # noqa: E731
    Lf = L.ffill()
    WL = pd.DataFrame(Lf.T.fillna(Lf.mean(axis=1)).T.to_numpy() @ W.T, index=L.index, columns=L.columns)
    flat = (L.diff().abs() < 1e-9).astype(int)
    run = pd.DataFrame({c: flat[c].groupby((flat[c] == 0).cumsum()).cumsum() for c in L.columns})
    F = {f"d{k}": L.diff(k) for k in (1, 7, 14, 28, 56)}
    F.update(dev=L.sub(prov, axis=0), vol28=L.diff().rolling(28).std(), datar=np.log1p(run), atas_max365=L - L.rolling(365, min_periods=90).max(),
             pd7=kons(prov.diff(7)), pd28=kons(prov.diff(28)), lebar7=kons((L.diff(7) > 0).mean(axis=1)))
    DASAR = list(F)
    F.update(sp_gap=WL - L, sp_gap_d7=(WL - L).diff(7), sp_d7=WL.diff(7), sp_d28=WL.diff(28), sp_lebar7=pd.DataFrame((L.diff(7) > 0).astype(float).to_numpy() @ W.T, index=L.index, columns=L.columns))
    SP = DASAR + [k for k in F if k.startswith("sp_")]
    X = pd.concat({k: v.rename_axis(columns="kab").stack(future_stack=True) for k, v in F.items()}, axis=1)
    X.index.names = ["tgl", "kab"]
    return X, DASAR, SP


def target(L, h):
    y = (L.shift(-h) - L).rename_axis(columns="kab").stack(future_stack=True)
    y.index.names = ["tgl", "kab"]
    return y


# ---------------------------------------------------------------- GNN
def gnn_kelas():
    import torch
    import torch.nn as nn

    class STGNN(nn.Module):
        """Konvolusi waktu bertingkat (dilasi 1,2,4,8) per simpul -> 2 lapis konvolusi graf (A tetap + A adaptif) -> 4 horizon."""

        def __init__(self, n, A, f_stat, pakai_graf=True, c=16, emb=6):
            super().__init__()
            self.pakai_graf = pakai_graf
            self.register_buffer("A", torch.tensor(A, dtype=torch.float32))
            self.tc = nn.ModuleList([nn.Conv1d(1 if i == 0 else c, c, 3, dilation=d) for i, d in enumerate((1, 2, 4, 8))])
            self.e1, self.e2 = nn.Parameter(torch.randn(n, emb) * 0.1), nn.Parameter(torch.randn(n, emb) * 0.1)
            self.inp = nn.Linear(c + f_stat, c)
            self.g = nn.ModuleList([nn.Linear(c * (3 if pakai_graf else 1), c) for _ in range(2)])
            self.out = nn.Linear(c, len(HOR))
            self.drop = nn.Dropout(0.2)

        def forward(self, seq, stat):  # seq: B x N x T, stat: B x N x F
            B, N, T = seq.shape
            z = seq.reshape(B * N, 1, T)
            for conv in self.tc:
                z = torch.relu(conv(z))
            z = z[:, :, -1].reshape(B, N, -1)
            h = torch.relu(self.inp(torch.cat([z, stat], -1)))
            if self.pakai_graf:
                Aad = torch.softmax(torch.relu(self.e1 @ self.e2.T), 1)
            for lin in self.g:
                hs = [h, torch.einsum("ij,bjc->bic", self.A, h), torch.einsum("ij,bjc->bic", Aad, h)] if self.pakai_graf else [h]
                h = h + self.drop(torch.relu(lin(torch.cat(hs, -1))))
            return self.out(h)

    return torch, STGNN


def gnn_tensor(L, Xs, stat_cols, Y):
    """Satu sampel = satu tanggal (38 simpul). seq = 32 selisih log harian terakhir (x100)."""
    dl = L.diff().fillna(0).to_numpy() * 100
    T = 32
    tgl = L.index
    S = Xs[stat_cols].unstack("kab").reindex(index=tgl)
    stat = np.stack([S[c].reindex(columns=L.columns).to_numpy() for c in stat_cols], -1)
    stat = np.nan_to_num(stat)
    seq = np.stack([dl[max(i - T + 1, 0):i + 1] if i >= T - 1 else np.vstack([np.zeros((T - 1 - i, dl.shape[1])), dl[:i + 1]]) for i in range(len(tgl))])
    seq = seq.transpose(0, 2, 1)  # tgl x N x T
    return seq.astype(np.float32), stat.astype(np.float32), (Y * 100).astype(np.float32)


def latih_gnn(torch, STGNN, A, seq, stat, Y, idx_latih, pakai_graf, seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    m = STGNN(A.shape[0], A, stat.shape[-1], pakai_graf)
    opt = torch.optim.AdamW(m.parameters(), lr=3e-3, weight_decay=1e-3)
    mu, sd = stat[idx_latih].reshape(-1, stat.shape[-1]).mean(0), stat[idx_latih].reshape(-1, stat.shape[-1]).std(0) + 1e-6
    st = (stat - mu) / sd
    Xq, Xs_, Yt = torch.tensor(seq), torch.tensor(st), torch.tensor(Y)
    msk = ~torch.isnan(Yt)
    Yt = torch.nan_to_num(Yt)
    for ep in range(25):
        m.train()
        for b in np.array_split(np.random.permutation(idx_latih), max(len(idx_latih) // 32, 1)):
            p = m(Xq[b], Xs_[b])
            l = torch.nn.functional.huber_loss(p[msk[b]], Yt[b][msk[b]], delta=1.0)
            opt.zero_grad()
            l.backward()
            opt.step()
    m.eval()
    return m, mu, sd


# ---------------------------------------------------------------- uji
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--komoditas", default="medium")
    ap.add_argument("--tanpa-gnn", action="store_true")
    a = ap.parse_args()
    P, Dm = muat(a.komoditas)
    P = P[P.index >= pd.Timestamp("2022-01-01")]
    L = np.log(P)
    W = bobot_spasial(Dm)
    X, DASAR, SP = fitur(L, W)
    Ys = {h: target(L, h) for h in HOR}
    X = X[X.index.get_level_values("tgl") >= MULAI]
    tg = X.index.get_level_values("tgl")
    akhir = P.index.max()
    bulan = pd.date_range(MULAI_UJI, akhir, freq="MS")
    pred = {}  # (model,h) -> Series
    for h in HOR:
        y = Ys[h].reindex(X.index)
        tgt = tg + pd.Timedelta(days=h)
        for nm, cols, kind in (("RIDGE", DASAR, "r"), ("RIDGE+SP", SP, "r"), ("GBM", DASAR, "g"), ("GBM+SP", SP, "g")):
            out = pd.Series(np.nan, index=X.index)
            for bm in bulan:
                tr = (tgt < bm) & y.notna().to_numpy()
                te = (tg >= bm) & (tg < bm + pd.offsets.MonthBegin(1))
                Xtr, ytr = X.loc[tr, cols], y[tr]
                if kind == "r":
                    mdl = make_pipeline(StandardScaler(), Ridge(alpha=30.0)).fit(np.nan_to_num(Xtr.to_numpy()), ytr.to_numpy())
                    out[te] = mdl.predict(np.nan_to_num(X.loc[te, cols].to_numpy()))
                else:
                    sub = np.arange(len(Xtr)) % 3 == 0
                    mdl = HistGradientBoostingRegressor(max_depth=4, learning_rate=0.05, max_iter=200, min_samples_leaf=200, l2_regularization=2.0, loss="absolute_error", random_state=0)
                    mdl.fit(Xtr[sub].to_numpy(), ytr[sub].to_numpy())
                    out[te] = mdl.predict(X.loc[te, cols].to_numpy())
            pred[(nm, h)] = out
            print(f"selesai {nm} h{h}", flush=True)
    if not a.tanpa_gnn:
        torch, STGNN = gnn_kelas()
        torch.set_num_threads(4)
        A = np.exp(-Dm / LEBAR)
        A = A / A.sum(1, keepdims=True)  # dengan simpul sendiri
        Y = np.stack([Ys[h].unstack("kab").reindex(index=L.index, columns=L.columns).to_numpy() for h in HOR], -1)
        stat_cols = ["dev", "vol28", "datar", "atas_max365", "pd28", "d28", "d56"]
        seq, stat, Yg = gnn_tensor(L, X, stat_cols, Y)
        tgl = L.index
        ok = np.asarray(tgl >= MULAI)
        for nm, graf in (("GNN", True), ("GNN-tanpa-graf", False)):
            out = {h: pd.Series(np.nan, index=X.index) for h in HOR}
            kw = pd.date_range(MULAI_UJI, akhir, freq="QS")
            for q in kw:
                Yl = Yg.copy()
                for j, h in enumerate(HOR):  # target yang belum terjadi pada q disembunyikan
                    Yl[np.asarray(tgl + pd.Timedelta(days=h) >= q), :, j] = np.nan
                idx_tr = np.where(ok & np.asarray(tgl + pd.Timedelta(days=min(HOR)) < q))[0]
                idx_te = np.where(np.asarray((tgl >= q) & (tgl < q + pd.offsets.QuarterBegin(1, startingMonth=1))))[0]
                if not len(idx_te):
                    continue
                ps = []
                for seed in range(3):
                    m, mu, sd = latih_gnn(torch, STGNN, A, seq, stat, Yl, idx_tr, graf, seed)
                    with torch.no_grad():
                        ps.append(m(torch.tensor(seq[idx_te]), torch.tensor((stat[idx_te] - mu) / sd)).numpy() / 100)
                p = np.mean(ps, 0)  # te x N x H
                for j, h in enumerate(HOR):
                    s = pd.DataFrame(p[:, :, j], index=tgl[idx_te], columns=L.columns).rename_axis(columns="kab").stack()
                    s.index.names = ["tgl", "kab"]
                    out[h].loc[s.index.intersection(out[h].index)] = s
                print(f"selesai {nm} kuartal {q.date()}", flush=True)
            for h in HOR:
                pred[(nm, h)] = out[h]
    # ---- evaluasi
    rows, simpan = [], []
    for h in HOR:
        y = Ys[h].reindex(X.index)
        uji = (tg >= MULAI_UJI) & y.notna().to_numpy() & (tg + pd.Timedelta(days=h) <= akhir)
        yt = y[uji].to_numpy()
        p0 = np.exp(L.stack(future_stack=True).reindex(X.index)[uji].to_numpy())
        ptrue = p0 * np.exp(yt)
        naik = (yt > 0.02).astype(int)
        base_rmse = np.sqrt(np.mean((ptrue - p0) ** 2))
        mods = ["NAIF"] + sorted({k[0] for k in pred}, key=["RIDGE", "RIDGE+SP", "GBM", "GBM+SP", "GNN", "GNN-tanpa-graf"].index)
        for nm in mods:
            yh = np.zeros(len(yt)) if nm == "NAIF" else np.nan_to_num(pred[(nm, h)][uji].to_numpy())
            ph = p0 * np.exp(yh)
            rmse = np.sqrt(np.mean((ptrue - ph) ** 2))
            r = dict(model=nm, h=h, n=len(yt), mape=100 * np.mean(np.abs(ph - ptrue) / ptrue), rmse_rel=rmse / base_rmse,
                     menang_naif=np.mean(np.abs(ph - ptrue) < np.abs(p0 - ptrue) - 1e-9), kalah_naif=np.mean(np.abs(ph - ptrue) > np.abs(p0 - ptrue) + 1e-9),
                     auc_naik2=np.nan if nm == "NAIF" else roc_auc_score(naik, yh), prauc_naik2=naik.mean() if nm == "NAIF" else average_precision_score(naik, yh))
            # periode HET Rp13.500 (asal sejak 22 Agu 2025)
            m2 = (tg[uji] >= pd.Timestamp("2025-08-22"))
            r["mape_het"] = 100 * np.mean(np.abs(ph[m2] - ptrue[m2]) / ptrue[m2])
            r["rmse_rel_het"] = np.sqrt(np.mean((ptrue[m2] - ph[m2]) ** 2)) / np.sqrt(np.mean((ptrue[m2] - p0[m2]) ** 2))
            rows.append(r)
            if nm != "NAIF":
                simpan.append(pd.DataFrame({"tgl": tg[uji], "kab": X.index.get_level_values("kab")[uji], "h": h, "model": nm, "y": yt, "yhat": yh}))
    R = pd.DataFrame(rows)
    pd.set_option("display.width", 200)
    print(f"\nBeras {a.komoditas}, asal uji {MULAI_UJI.date()} s.d. {akhir.date()} (latih ulang bulanan; GNN kuartalan)")
    print(R.round(3).to_string(index=False))
    R.to_csv(f"data/satelit/uji_spasio_temporal_ringkas_{a.komoditas}.csv", index=False)
    pd.concat(simpan).to_csv(f"data/satelit/uji_spasio_temporal_{a.komoditas}.csv.gz", index=False)


if __name__ == "__main__":
    main()
