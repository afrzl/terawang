"""TERAWANG K3a · Uji fitur dari kajian harga beras Indonesia di atas model gabungan + Bapanas (kejadian KAPAN).

Fitur: deviasi marjin eceran-penggilingan dari rerata 180 hari, perubahan harga penggilingan 28 hari dipisah naik/turun
(asimetri), dummy Idulfitri H-30 s.d. H+7, momentum eceran positif. Hasil 26 Nov 2026: tidak menambah (PR-AUC turun 0,007-0,021).

  python scripts/k3/uji_k3_fitur_literatur.py
"""
import sys, os
sys.path.insert(0, "scripts/k3")
import numpy as np, pandas as pd
import uji_k3_peringatan as U, uji_k3_fitur_bapanas as B
from sklearn.metrics import average_precision_score
P,P2,H,pas=U.muat(); X,_=U.fitur(P,P2,H,pas); X=X.join(B.fitur_bapanas(P,H))
pg=B.seri("beras_medium_penggilingan",P); pgf=np.log(pg.ffill(limit=7)); pgf=pgf.apply(lambda c:c.fillna(np.log(pg.median(axis=1).ffill(limit=7))))
L=np.log(P); marg=L-pgf; mdev=marg-marg.rolling(180,min_periods=60).mean()
pm=pgf.diff(28)
idul=pd.to_datetime(["2024-04-10","2025-03-31","2026-03-20","2027-03-10"])
dd=np.array([min([(t-x).days for x in idul if (t-x).days>=-30] or [999]) for t in P.index])  # hari relatif ke Idulfitri berikut (-30..)
leb=pd.Series(((dd>=-30)&(dd<=7)).astype(float),index=P.index)
kons=lambda v: pd.DataFrame(np.repeat(np.asarray(v)[:,None],P.shape[1],1),index=P.index,columns=P.columns)
F={"marg_dev":mdev,"pg_naik":pm.clip(lower=0),"pg_turun":pm.clip(upper=0),"lebaran":kons(leb),"m28_naik":L.diff(28).clip(lower=0)}
X=X.join(pd.concat({k:U.tumpuk(v) for k,v in F.items()},axis=1))
LIT=list(F)
run=U.panjang_rangkaian(P.gt(H,axis=0).astype(float).where(P.notna()))
bulan=pd.date_range(U.MULAI_UJI.replace(day=1),P.index.max(),freq="MS"); ev="KAPAN"
for h in (7,14,28):
    D=X.join(U.label(P,H,h,run)); D["tgt"]=D.index.get_level_values("tgl")+pd.Timedelta(days=h)
    D=D[(D.index.get_level_values("tgl")>=B.MULAI_LATIH)&(D.d>=0)].dropna(subset=[ev])
    G=pd.DataFrame({"max":U.tumpuk(U.maju_maks(L,h)-L)}).dropna(); G["tgt"]=G.index.get_level_values("tgl")+pd.Timedelta(days=h)
    buf={}
    for bm in bulan:
        tg=D.index.get_level_values("tgl"); te=D[(tg>=max(bm,U.MULAI_UJI))&(tg<bm+pd.offsets.MonthBegin(1))]
        if te.empty: continue
        tr=D[D.tgt<bm]
        res={"EW60":U.p_ew60(G,"max",te)}
        for nm,cs in (("bapanas",B.KECIL+B.BARU),("bapanas+literatur",B.KECIL+B.BARU+LIT)):
            res[nm]=U.latih("LOGIT",tr,cs,ev)(te[cs].to_numpy())
        for k,v in res.items(): buf.setdefault(k,[]).append(pd.Series(v,index=te.index))
    y=D.loc[D.index.get_level_values("tgl")>=U.MULAI_UJI,ev].astype(int)
    S={k:pd.concat(v).reindex(y.index) for k,v in buf.items()}
    for nm in ("bapanas","bapanas+literatur"):
        s=(S["EW60"].rank(pct=True)+S[nm].rank(pct=True))/2
        best=0
        for q in np.linspace(0.8,0.999,60):
            al=s>=s.quantile(q); tp=(al&(y==1)).sum(); p_=tp/max(al.sum(),1); r_=tp/max(y.sum(),1); best=max(best,2*p_*r_/max(p_+r_,1e-9))
        print(f"h{h} EW60+{nm:18s} PR-AUC {average_precision_score(y,s):.3f} F1max {best:.3f}",flush=True)
