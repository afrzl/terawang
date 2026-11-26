"""TERAWANG K3a · Lanjutan uji_k3_peringatan.py: kejadian KAPAN, sapuan ambang -> recall episode vs presisi harian.
Varian: EW60 (operasional), LOGIT fitur lengkap/kecil, LOGIT kecil latih sejak Jun 2024, gabungan peringkat EW60+LOGIT kecil.
  python scripts/k3/uji_k3_peringatan_episode.py   # ±10 menit
"""
import sys; sys.path.insert(0, 'scripts/k3')
import numpy as np, pandas as pd
import uji_k3_peringatan as U
from sklearn.metrics import average_precision_score
P,P2,H,pas=U.muat(); X,cols=U.fitur(P,P2,H,pas); L=np.log(P)
run=U.panjang_rangkaian(P.gt(H,axis=0).astype(float).where(P.notna()))
KECIL=["d","di_het","atas90","atas365","hari_sejak_atas","pasar_di_het","pasar_di_atas","pasar_maks","m28","prov_atas"]
bulan=pd.date_range(U.MULAI_UJI.replace(day=1),P.index.max(),freq="MS")
ev="KAPAN"; out=[]
for h in (7,14,28):
    D=X.join(U.label(P,H,h,run)); D["tgt"]=D.index.get_level_values("tgl")+pd.Timedelta(days=h)
    D=D[(D.index.get_level_values("tgl")>=U.MULAI_LATIH)&(D.d>=0)].dropna(subset=[ev])
    G=pd.DataFrame({"max":U.tumpuk(U.maju_maks(L,h)-L)}).dropna(); G["tgt"]=G.index.get_level_values("tgl")+pd.Timedelta(days=h)
    buf={}
    for bm in bulan:
        tg=D.index.get_level_values("tgl"); te=D[(tg>=max(bm,U.MULAI_UJI))&(tg<bm+pd.offsets.MonthBegin(1))]
        if te.empty: continue
        tr=D[D.tgt<bm]; tr24=tr[tr.index.get_level_values("tgl")>=pd.Timestamp("2024-06-01")]
        res={"EW60":U.p_ew60(G,"max",te)}
        res["LOGIT_semua"]=U.latih("LOGIT",tr,cols,ev)(te[cols].to_numpy())
        res["LOGIT_kecil"]=U.latih("LOGIT",tr,KECIL,ev)(te[KECIL].to_numpy())
        res["LOGIT_kecil_2024"]=U.latih("LOGIT",tr24,KECIL,ev)(te[KECIL].to_numpy())
        # gabungan: rerata peringkat EW60 dan LOGIT_kecil
        for k,v in res.items(): buf.setdefault(k,[]).append(pd.Series(v,index=te.index))
    y=D.loc[D.index.get_level_values("tgl")>=U.MULAI_UJI,ev].astype(int)
    S={k:pd.concat(v).reindex(y.index) for k,v in buf.items()}
    S["EW60+LOGIT"]=(S["EW60"].rank(pct=True)+S["LOGIT_kecil"].rank(pct=True))/2
    for k,s in S.items():
        pap=average_precision_score(y,s)
        # sapuan ambang: recall episode vs presisi harian
        for q in np.linspace(0.80,0.999,60):
            th=s.quantile(q); al=s>=th
            e=U.episode(al,P,H,h,ev,run)
            tp=(al&(y==1)).sum(); prec=tp/max(al.sum(),1); rec=tp/max(y.sum(),1)
            out.append(dict(h=h,model=k,pr_auc=pap,q=q,recall_ep=e["recall_episode"],hari_alarm_ep=e["hari_alarm_per_episode"],presisi=prec,recall=rec,f1=2*prec*rec/max(prec+rec,1e-9),episode=e["episode"]))
    print("h",h,"selesai",flush=True)
R=pd.DataFrame(out); R.to_csv("data/satelit/k3_uji_peringatan_episode.csv",index=False)
for (h,k),g in R.groupby(["h","model"]):
    best=g.loc[g.f1.idxmax()]
    def at(r):
        c=g[g.recall_ep>=r]; 
        if c.empty: return "-"
        b=c.loc[c.presisi.idxmax()]; return f"pres {b.presisi:.2f}, {b.hari_alarm_ep:.0f} hari/ep"
    print(f"h{h} {k:18s} PR-AUC {g.pr_auc.iloc[0]:.3f} | F1max {best.f1:.3f} (recall_ep {best.recall_ep:.2f}) | recall_ep>=0.5: {at(0.5)} | >=0.7: {at(0.7)} | >=0.85: {at(0.85)}")
