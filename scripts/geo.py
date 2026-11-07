import json, math, sys
d=json.load(open(sys.argv[1]))
feats=[x for x in d['features'] if x['properties']['NAME_1']=='Jawa Timur']
def area(r):
    a=0
    for i in range(len(r)-1): a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1]
    return abs(a)/2
def dp(pts,eps):
    if len(pts)<3: return pts
    (x1,y1),(x2,y2)=pts[0],pts[-1]
    dx,dy=x2-x1,y2-y1; L=math.hypot(dx,dy) or 1e-12
    md,mi=0,0
    for i in range(1,len(pts)-1):
        x,y=pts[i]; dd=abs(dy*x-dx*y+x2*y1-y2*x1)/L
        if dd>md: md,mi=dd,i
    if md>eps: return dp(pts[:mi+1],eps)[:-1]+dp(pts[mi:],eps)
    return [pts[0],pts[-1]]
lon0,lat0=110.85,-6.7; k=math.cos(math.radians(7.5)); S=230
def P(x,y): return ((x-lon0)*k*S,(lat0-y)*S)
out={}; allx=[];ally=[]
for f in feats:
    p=f['properties']; name=p['NAME_2']
    if p['TYPE_2']=='Kota' and not name.startswith('Kota'): name='Kota '+name
    g=f['geometry']; polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    rings=sorted([pl[0] for pl in polys],key=area,reverse=True)
    big=area(rings[0]); keep=[r for r in rings if area(r)>max(big*0.02,0.0004) and sum(q[1] for q in r)/len(r)<-6.6][:8] or rings[:1]
    ds=[];cx=cy=0
    for r in keep:
        s=dp(r,0.0035 if big>0.01 else 0.0008)
        if len(s)<4: s=r
        pts=[P(*q) for q in s]
        allx+= [q[0] for q in pts]; ally+=[q[1] for q in pts]
        ds.append('M'+'L'.join(f'{a:.1f},{b:.1f}' for a,b in pts)+'Z')
    r=rings[0]; cx=sum(q[0] for q in r)/len(r); cy=sum(q[1] for q in r)/len(r)
    out[name]={'d':''.join(ds),'c':[round(v,1) for v in P(cx,cy)]}
print(min(allx),max(allx),min(ally),max(ally),len(out),file=sys.stderr)
bx=P(112.168,-8.098); out['Kota Blitar']={'d':'','c':[round(bx[0],1),round(bx[1],1)]}
json.dump(out,open(sys.argv[2],'w'),separators=(',',':'))
