"""Chart-aware 3–11D movement. No projection is used by the integrator.

Built-ins: Euclidean, S² x R^(D-2) (two stereographic charts),
T² x R^(D-2), and a bounded Möbius strip x R^(D-2).
Custom smooth SPD metrics are supported in one finite chart. A general atlas
can subclass Geometry; arbitrary topology is not inferred from a picture.
"""
from __future__ import annotations
import ast
import math
from dataclasses import dataclass
from typing import Callable
import numpy as np


def vec(q, d):
    a = np.asarray(q, dtype=float)
    if a.shape != (d,) or not np.isfinite(a).all() or np.max(np.abs(a)) > 1000:
        raise ValueError('Expected a bounded finite coordinate vector')
    return a.copy()


class Expression:
    """Small arithmetic interpreter, NOT Python eval. Bounded AST and exponents."""
    functions = {'sin': math.sin, 'cos': math.cos, 'tanh': math.tanh,
                 'sqrt': math.sqrt, 'exp': lambda x: math.exp(max(-30, min(30, x)))}
    def __init__(self, text, d):
        if not isinstance(text, (str, int, float)) or len(str(text)) > 400:
            raise ValueError('Metric expression is too long')
        self.root = ast.parse(str(text), mode='eval').body
        self.d = d
        if len(list(ast.walk(self.root))) > 100:
            raise ValueError('Metric expression too complex')
        self._check(self.root)
    def _check(self, n):
        if isinstance(n, ast.Constant) and type(n.value) in (int, float):
            if not math.isfinite(n.value) or abs(n.value) > 1000: raise ValueError('Invalid constant')
        elif isinstance(n, ast.Name) and n.id in ['q'+str(i) for i in range(self.d)]: pass
        elif isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)): self._check(n.operand)
        elif isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)):
            if isinstance(n.op, ast.Pow) and not (isinstance(n.right, ast.Constant) and type(n.right.value) is int and 0 <= n.right.value <= 6):
                raise ValueError('Powers must be constant integers 0–6')
            self._check(n.left); self._check(n.right)
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in self.functions and len(n.args)==1 and not n.keywords:
            self._check(n.args[0])
        else: raise ValueError('Unsupported metric expression')
    def __call__(self, q):
        def run(n):
            if isinstance(n, ast.Constant): return float(n.value)
            if isinstance(n, ast.Name): return float(q[int(n.id[1:])])
            if isinstance(n, ast.UnaryOp): return (-1 if isinstance(n.op, ast.USub) else 1)*run(n.operand)
            if isinstance(n, ast.Call): return self.functions[n.func.id](run(n.args[0]))
            a,b=run(n.left),run(n.right)
            if isinstance(n.op, ast.Add): return a+b
            if isinstance(n.op, ast.Sub): return a-b
            if isinstance(n.op, ast.Mult): return a*b
            if isinstance(n.op, ast.Div): return a/b
            return a**b
        v=run(self.root)
        if not math.isfinite(v) or abs(v)>1e8: raise ValueError('Metric overflow')
        return v


@dataclass
class Position:
    q: np.ndarray
    chart: str = 'a'


class Geometry:
    kinds=('flat','sphere','torus','mobius','custom')
    def __init__(self, kind='flat', d=4, metric=None):
        if type(d) is not int or not 3 <= d <= 11: raise ValueError('Dimension must be 3–11')
        if kind not in self.kinds: raise ValueError('Unknown manifold')
        self.kind,self.d,self.R,self.r=kind,d,2.4,.8
        self.metric_source=metric
        self.expr=None
        if kind=='custom':
            if not isinstance(metric,list) or len(metric)!=d or any(not isinstance(row,list) or len(row)!=d for row in metric):
                raise ValueError('Custom metric must be D by D')
            self.expr=[[Expression(x,d) for x in row] for row in metric]
            # Initial validation; all subsequent evaluations also validate SPD.
            for p in [np.zeros(d),np.ones(d)*.2,np.ones(d)*-.4]: self.metric(p)
    def describe(self):
        return {'kind':self.kind,'dimension':self.d,'R':self.R,'r':self.r,
                'metric':self.metric_source,'clock':'separate',
                'scope':'smooth SPD finite chart' if self.kind=='custom' else 'built-in atlas/product metric'}
    def metric(self,q,chart='a'):
        q=vec(q,self.d);g=np.eye(self.d)
        if self.kind=='sphere':
            g[0,0]=g[1,1]=4*self.R**4/(self.R*self.R+q[0]**2+q[1]**2)**2
        elif self.kind=='torus':
            g[0,0]=(self.R+self.r*math.cos(q[1]))**2;g[1,1]=self.r**2
        elif self.kind=='mobius':
            g[0,0]=(self.R+q[1]*math.cos(q[0]/2))**2+q[1]**2/4
        elif self.expr:
            g=np.array([[e(q) for e in row] for row in self.expr])
        if not np.allclose(g,g.T,atol=1e-9): raise ValueError('Metric must be symmetric')
        eig=np.linalg.eigvalsh(g)
        if eig[0]<1e-7 or eig[-1]>1e7: raise ValueError('Metric is singular, indefinite or poorly conditioned here')
        return g
    def christoffel(self,q,chart='a'):
        q=vec(q,self.d);g=self.metric(q,chart)
        if self.kind=='flat': return np.zeros((self.d,self.d,self.d))
        deriv=np.zeros((self.d,self.d,self.d))
        active=range(self.d) if self.kind=='custom' else range(2)
        for k in active:
            h=1e-5*max(1,abs(q[k]));p=q.copy();m=q.copy();p[k]+=h;m[k]-=h
            deriv[k]=(self.metric(p,chart)-self.metric(m,chart))/(2*h)
        # Γ^k_ij = .5 g^kl (∂i g_lj + ∂j g_li - ∂l g_ij)
        C=deriv.transpose(1,0,2)+deriv.transpose(1,2,0)-deriv
        return .5*np.einsum('kl,lij->kij',np.linalg.inv(g),C)
    def canonical(self,q,v=None,chart='a'):
        q=vec(q,self.d);v=np.zeros(self.d) if v is None else vec(v,self.d)
        if chart not in ('a','b'):raise ValueError('Unknown chart')
        if self.kind=='sphere':
            s=q[0]**2+q[1]**2
            if s>(self.R*2)**2:
                J=self.R**2*(np.eye(2)/s-2*np.outer(q[:2],q[:2])/s**2)
                v[:2]=J@v[:2];q[:2]*=self.R**2/s;chart='b' if chart=='a' else 'a'
        elif self.kind=='torus': q[:2]=(q[:2]+math.pi)%(2*math.pi)-math.pi
        elif self.kind=='mobius':
            turns=math.floor((q[0]+math.pi)/(2*math.pi));q[0]-=turns*2*math.pi
            if turns%2:q[1]*=-1;v[1]*=-1
            if abs(q[1])>.8:q[1]=float(np.clip(q[1],-.8,.8));v[1]=0
        else:
            if np.max(np.abs(q[:2]))>12: raise ValueError('Outside this finite chart; move back or use another registered chart')
        if np.max(np.abs(q[2:]))>30:raise ValueError('Outside region extent')
        return Position(q,chart),v
    def geodesic(self,q,v,dt=.05,chart='a',steps=None):
        q=vec(q,self.d);v=vec(v,self.d)
        if not math.isfinite(dt) or abs(dt)>2:raise ValueError('Invalid integration interval')
        count=steps or max(1,math.ceil(abs(dt)/.025));h=dt/count
        def f(z):
            a,b=z[:self.d],z[self.d:]
            return np.r_[b,-np.einsum('kij,i,j->k',self.christoffel(a,chart),b,b)]
        for _ in range(count):
            z=np.r_[q,v];k1=f(z);k2=f(z+h*k1/2);k3=f(z+h*k2/2);k4=f(z+h*k3)
            z+=h*(k1+2*k2+2*k3+k4)/6
            p,v=self.canonical(z[:self.d],z[self.d:],chart);q,chart=p.q,p.chart
        return Position(q,chart),v
    def move(self,q,direction,distance,chart='a'):
        direction=vec(direction,self.d)
        if not math.isfinite(distance) or abs(distance)>.5:raise ValueError('Movement step exceeds .5 model units')
        norm=math.sqrt(float(direction@self.metric(q,chart)@direction))
        if norm<1e-12:return Position(vec(q,self.d),chart)
        if self.kind=='flat':return self.canonical(vec(q,self.d)+direction/norm*distance,chart=chart)[0]
        p,_=self.geodesic(q,direction/norm,dt=distance,chart=chart)
        return p
    def display(self,q,chart='a'):
        """3D display embedding only; additional coordinates remain in world state."""
        q=vec(q,self.d);u,v=q[:2];h=q[2]
        if self.kind=='sphere':
            s=u*u+v*v;den=self.R*self.R+s
            n=np.array([2*self.R*u/den,(s-self.R*self.R)/den,2*self.R*v/den])
            if chart=='b':n[1]*=-1
            return (self.R+h)*n
        if self.kind=='torus':
            return np.array([(self.R+(self.r+h)*math.cos(v))*math.cos(u),(self.r+h)*math.sin(v),(self.R+(self.r+h)*math.cos(v))*math.sin(u)])
        if self.kind=='mobius':
            return np.array([(self.R+v*math.cos(u/2))*math.cos(u),v*math.sin(u/2)+h,(self.R+v*math.cos(u/2))*math.sin(u)])
        return np.array([u,h,v])
    def distance_flat(self,a,b):
        if self.kind!='flat':raise ValueError('Euclidean distance is not an intrinsic distance on this manifold')
        return float(np.linalg.norm(vec(a,self.d)-vec(b,self.d)))
    def sample_grid(self,nu=20,nv=14):
        if self.kind=='sphere':
            # Longitude/latitude converted to stereographic charts; poles omitted.
            coords=[];charts=[]
            for j in range(nv):
                lat=-1.42+2.84*j/(nv-1)
                for i in range(nu):
                    lon=2*math.pi*i/nu;x=self.R*math.cos(lat)*math.cos(lon);y=self.R*math.sin(lat);z=self.R*math.cos(lat)*math.sin(lon)
                    q=np.zeros(self.d);q[:2]=self.R*np.array([x,z])/(self.R-y)
                    p,_=self.canonical(q);coords.append(p.q);charts.append(p.chart)
        else:
            coords=[];charts=[]
            for j in range(nv):
                for i in range(nu):
                    q=np.zeros(self.d)
                    if self.kind=='torus':q[:2]=[-math.pi+2*math.pi*i/nu,-math.pi+2*math.pi*j/nv]
                    elif self.kind=='mobius':q[:2]=[-math.pi+2*math.pi*i/nu,-.75+1.5*j/(nv-1)]
                    else:q[:2]=[-3.6+7.2*i/(nu-1),-2.6+5.2*j/(nv-1)]
                    coords.append(q);charts.append('a')
        edges=set()
        for j in range(nv):
            for i in range(nu):
                a=j*nu+i
                if i+1<nu:edges.add(tuple(sorted((a,a+1))))
                elif self.kind in ('sphere','torus'):edges.add(tuple(sorted((a,j*nu))))
                elif self.kind=='mobius':edges.add(tuple(sorted((a,(nv-1-j)*nu))))
                if j+1<nv:edges.add((a,a+nu))
                elif self.kind=='torus':edges.add(tuple(sorted((a,i))))
        faces=[]
        for j in range(nv if self.kind=='torus' else nv-1):
            for i in range(nu if self.kind in ('sphere','torus','mobius') else nu-1):
                j1=(j+1)%nv;a=j*nu+i;c=j1*nu+i
                if i+1<nu:b=a+1;d=c+1
                elif self.kind=='mobius':b=(nv-1-j)*nu;d=(nv-1-j1)*nu
                else:b=j*nu;d=j1*nu
                faces.extend([[a,b,c],[b,d,c]])
        return {'coords':[q.tolist() for q in coords],'charts':charts,'edges':[list(e) for e in sorted(edges)],'shape':[nu,nv],
                'faces':faces,'positions':[self.display(q,c).tolist() for q,c in zip(coords,charts)]}

    def edge_length(self,a,b,ca='a',cb='a'):
        """Analytic on the sphere product; quadrature along a short chart path otherwise.
        Not a general globally shortest-geodesic oracle.
        """
        a=vec(a,self.d);b=vec(b,self.d)
        if self.kind=='sphere':
            aa=a.copy();bb=b.copy();aa[2:]=0;bb[2:]=0
            c=np.dot(self.display(aa,ca),self.display(bb,cb))/(self.R**2)
            s=self.R*math.acos(float(np.clip(c,-1,1)))
            return math.sqrt(s*s+float(np.sum((a[2:]-b[2:])**2)))
        delta=b-a
        if self.kind=='torus':delta[:2]=(delta[:2]+math.pi)%(2*math.pi)-math.pi
        if self.kind=='mobius' and abs(delta[0])>math.pi:
            b[0]+= -2*math.pi if delta[0]>0 else 2*math.pi;b[1]*=-1;delta=b-a
        total=0
        for t in (np.arange(8)+.5)/8:
            total+=math.sqrt(float(delta@self.metric(a+delta*t,ca)@delta))/8
        return total
