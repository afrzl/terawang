"""TERAWANG K3b · Perbandingan strategi penyaluran dan sensitivitas (jalankan: python scripts/k3/uji_k3b_strategi.py)."""
import sys, time; sys.path.insert(0,'scripts/k3')
import numpy as np, pandas as pd
import k3b_sphp as K
pd.set_option("display.width",250)
M=K.muat(); base=dict(K.PARAM); n=len(M['kab']); T=3; C=M['C']; D=M['D']
ix={k:i for i,k in enumerate(M['kab'])}; sl=[ix[k] for k in M['nodes']]; nb=len(sl)

def tes(p): return K.instans(M,{**p,'S':400},777)[2]
def run(p,seed=1):
    A,ph,nz=K.instans(M,p,seed); x,sloc,nbb=K.solusi(M,p,A,ph,nz); return x,sloc,nbb
def ev(p,x,sloc,nbb,eval_p=None):
    ep=eval_p or p; A,ph,_=K.instans(M,ep,0); return K.evaluasi(M,ep,A,ph,tes(ep),x,sloc,nbb)

def greedy(p,bobot=True,proporsi_konsumsi=False):
    A,ph,_=K.instans(M,p,0); tgt=(1+p['beta']*ph)*C[:,None]; w=(1+p['gamma']*ph) if bobot else np.ones_like(ph)
    Rtot=p['Rtot']*M['S0']*1e3; Rb=p['Rbln']*M['S0']*1e3
    cab=M['share']*Rtot; tot=Rtot; x=np.zeros((nb,n,T)); cum=np.zeros(n)
    for t in range(T):
        mon=Rb*p['frac'][t]
        if proporsi_konsumsi:
            need=C/C.sum()*min(mon,tot)
        else:
            need=np.maximum(tgt[:,t]-A[:,t]-cum,0)
        order=np.argsort(-(w[:,t]*need))
        for j in order:
            q=need[j]
            for i in np.argsort(D[np.ix_(sl,[j])][:,0]):
                g=min(q,cab[i],mon,tot)
                if g<=0: continue
                x[i,j,t]+=g; cab[i]-=g; mon-=g; tot-=g; q-=g; cum[j]+=g
                if q<=1e-9: break
    return x,sl,nb

rows=[]
def add(nm,p,x,sloc,nbb,ep=None):
    r=ev(p,x,sloc,nbb,ep); r['strategi']=nm; rows.append(r)
p=dict(K.PARAM)
add("A. terdekat, kekurangan berbobot harga",p,*greedy(p))
add("B. terdekat, tanpa bobot harga",p,*greedy(p,bobot=False))
add("C. rata per konsumsi (tidak ditarget)",p,*greedy(p,proporsi_konsumsi=True))
add("D. LP deterministik (rerata)",p,*run({**p,'deterministik':True}))
xa=greedy(p); ton_a=xa[0].sum()/(M["S0"]*1e3)
for S in (10,40,100): add(f"E. LP stokastik S={S}",p,*run({**p,'S':S}))
add("E2. LP stokastik, tonase sama dengan A",p,*run({**p,'Rtot':ton_a}))
add("F. LP stokastik + sumber kab surplus",p,*run({**p,'kab_surplus':True}))
R=pd.DataFrame(rows).set_index('strategi').round(2); print(R.to_string())
R.to_csv("data/satelit/k3b_perbandingan_strategi.csv")
print("\nSENSITIVITAS anggaran (LP stokastik S=40):")
rr=[]
for Rt in (0.03,0.08,0.15,0.30,0.60):
    q={**p,'Rtot':Rt,'Rbln':Rt/2+0.01}; r=ev(q,*run(q)); r['Rtot_%stok']=Rt*100; r['ton_stok_rb']=Rt*M['S0']; rr.append(r)
print(pd.DataFrame(rr).set_index('Rtot_%stok').round(2).to_string())
print("\nSENSITIVITAS parameter harga/penalti (anggaran dasar):")
rr=[]
for nm,q in (("beta0,gamma0",{'beta':0,'gamma':0}),("beta.25,gamma1",{}),("beta.5,gamma1",{'beta':.5}),("beta.25,gamma3",{'gamma':3}),("h=.1",{'h':.1}),("h=1",{'h':1.0}),("lam x4",{'lam':4/2000}),("lam=0",{'lam':0})):
    pp={**p,**q}; r=ev(pp,*run(pp)); r['varian']=nm; rr.append(r)
print(pd.DataFrame(rr).set_index('varian').round(2).to_string())
