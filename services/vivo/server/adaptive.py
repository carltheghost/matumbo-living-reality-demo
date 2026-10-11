"""Learned room wayfinding field. Bounded local cost model + graph relaxation.

The neural network is trained on a declared synthetic comfort-cost task. Local
Bellman updates organize a reachable guidance field and repair routes after damage.
This is narrow adaptive behavior, not consciousness or autonomous room creation.
"""
from pathlib import Path
import hashlib, json, math
import numpy as np

MODEL=Path(__file__).resolve().parents[1]/'models'/'room-rule.json'

def teacher(x):
    x=np.asarray(x)
    return 1+.40*x[:,0]**2+1.8*x[:,1]+.35*x[:,2]**2+.25*x[:,3]

class RoomRule:
    def __init__(self,path=MODEL):
        b=Path(path).read_bytes();self.version=hashlib.sha256(b).hexdigest()[:16]
        data=json.loads(b);self.p={k:np.array(v,dtype=float) for k,v in data['weights'].items()}
        self.report=data['provenance']
    def predict(self,x):
        p=self.p;x=np.asarray(x,dtype=float)
        h=np.tanh(x@p['w1']+p['b1']);h=np.tanh(h@p['w2']+p['b2'])
        z=np.clip(h@p['w3']+p['b3'],-30,30)
        return (1+3/(1+np.exp(-z))).reshape(-1)

class Guidance:
    def __init__(self,geometry,grid,rule):
        self.geo,self.grid,self.rule=geometry,grid,rule
        n=len(grid['coords']);self.n=n;self.goal=n-12;self.blocked=set();self.mode='learned';self.tick=0
        self.features=np.zeros((n,4))
        for i,q in enumerate(grid['coords']):
            self.features[i]=[min(1,abs(math.sin(q[0]))*.7),0,.25+.2*math.cos(q[1]),.2]
        self.edges=grid['edges'];self.lengths=np.array([max(.03,geometry.edge_length(grid['coords'][a],grid['coords'][b],grid['charts'][a],grid['charts'][b])) for a,b in self.edges])
        self.adj=[[] for _ in range(n)]
        self.rebuild()
    def rebuild(self):
        if self.mode=='learned':p=self.rule.predict(self.features)
        elif self.mode=='analytic':p=teacher(self.features)
        else:p=np.ones(self.n)
        self.adj=[[] for _ in range(self.n)]
        for k,(a,b) in enumerate(self.edges):
            c=float(self.lengths[k]*(p[a]+p[b])*.5)
            if a not in self.blocked and b not in self.blocked:
                self.adj[a].append((b,c));self.adj[b].append((a,c))
        self.dist=np.full(self.n,np.inf);self.dist[self.goal]=0;self.tick=0;self.converged=False
    def step(self,count=3):
        if self.mode=='off' or self.converged:return False
        changed=False
        for _ in range(count):
            prev=self.dist;new=prev.copy()
            for a in range(self.n):
                if a in self.blocked:continue
                if self.adj[a]:new[a]=min(prev[a],min(prev[b]+c for b,c in self.adj[a]))
            new[self.goal]=0
            self.tick+=1
            if np.array_equal(new,prev):
                self.converged=True
                break
            self.dist=new;changed=True
        return changed
    def route(self,start):
        if type(start)is not int or not 0<=start<self.n:return []
        if not math.isfinite(self.dist[start]) or start in self.blocked:return []
        route=[start];seen={start}
        while route[-1]!=self.goal and len(route)<=self.n:
            a=route[-1]
            candidates=[(self.dist[b]+c,b) for b,c in self.adj[a] if b not in seen and self.dist[b]<self.dist[a]-1e-9]
            if not candidates:return []
            b=min(candidates)[1];route.append(b);seen.add(b)
        return route if route[-1]==self.goal else []
    def state(self):
        return {'mode':self.mode,'model':self.rule.version,'goal':self.goal,'blocked':sorted(self.blocked),'tick':self.tick,
                'potential':[None if not math.isfinite(x) else round(float(x),6) for x in self.dist],
                'activity':np.exp(-np.minimum(self.dist,100)/5).round(5).tolist(),
                'features':self.features.round(5).tolist(),'converged':self.converged}
    def restore(self,s):
        if s.get('model')!=self.rule.version:raise ValueError('Checkpoint requires a different neural model version')
        self.mode=s['mode'];self.goal=int(s['goal']);self.blocked=set(s['blocked']);self.features=np.array(s['features'])
        if self.features.shape!=(self.n,4) or not np.isfinite(self.features).all():raise ValueError('Invalid neural field')
        self.rebuild();self.dist=np.array([math.inf if x is None else x for x in s['potential']]);self.tick=s['tick'];self.converged=bool(s.get('converged',False))
