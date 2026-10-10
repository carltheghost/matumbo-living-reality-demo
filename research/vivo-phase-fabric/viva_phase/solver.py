"""Finite-resolution N-dimensional Gross-Pitaevskii reference.

Equation in dimensionless units (hbar = mass = 1):
    i dpsi/dt = [-1/2 Delta + V + coupling * |psi|^2] psi

Strang splitting: nonlinear/potential half-step, spectral kinetic full-step,
nonlinear/potential half-step. Real local potentials and unitary spectral steps
preserve the discrete L2 norm to roundoff. Energy is NOT exactly conserved by
splitting; refine dt and spatial resolution independently.

Domain: a flat rectangular PERIODIC N-torus, NOT an arbitrary curved manifold.
A mathematical weakly interacting mean-field model, not quantitative liquid He-4.
Density is |psi|^2, not a separately duplicated population of material particles.
No learned parameters or camera/network control are hidden in this solver.
"""
from __future__ import annotations
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import zipfile
import numpy as np

MAX_CELLS = 1_048_576

@dataclass(frozen=True)
class Grid:
    shape: tuple[int, ...]
    lengths: tuple[float, ...]

    def __post_init__(self):
        shape = tuple(self.shape)
        lengths = tuple(float(x) for x in self.lengths)
        if not 2 <= len(shape) <= 11 or len(lengths) != len(shape):
            raise ValueError('Specify 2–11 spatial axes and one length for each')
        if any(type(n) is not int or n < 2 for n in shape):
            raise ValueError('Every grid count must be an integer at least two')
        if math.prod(shape) > MAX_CELLS:
            raise ValueError('Dense allocation exceeds the explicit cell budget; use a sparse/domain-specific backend')
        if any(not math.isfinite(x) or not 0 < x <= 1000 for x in lengths):
            raise ValueError('Lengths must be positive finite model units at most 1000')
        object.__setattr__(self, 'shape', shape)
        object.__setattr__(self, 'lengths', lengths)

    @property
    def d(self): return len(self.shape)
    @property
    def cells(self): return math.prod(self.shape)
    @property
    def dv(self): return math.prod(L/n for L,n in zip(self.lengths,self.shape))

    def coordinates(self):
        return np.meshgrid(*[np.arange(n,dtype=float)*L/n-L/2 for n,L in zip(self.shape,self.lengths)], indexing='ij', sparse=True)

    def frequencies(self):
        return np.meshgrid(*[2*np.pi*np.fft.fftfreq(n,d=L/n) for n,L in zip(self.shape,self.lengths)], indexing='ij', sparse=True)

    def description(self):
        return {'shape':list(self.shape),'lengths':list(self.lengths),'spatial_dimension':self.d,
                'boundary':'periodic','metric':'Euclidean / flat torus','clock':'separate'}

class PhaseField:
    def __init__(self, grid: Grid, psi, coupling: float=1.0):
        if not isinstance(grid,Grid): raise TypeError('Expected Grid')
        if not math.isfinite(coupling) or abs(coupling)>100:
            raise ValueError('Invalid coupling')
        state=np.asarray(psi,dtype=np.complex128)
        if state.shape != grid.shape or not np.isfinite(state).all():
            raise ValueError('Field must be finite and fill every configured coordinate')
        if np.max(np.abs(state))>100: raise ValueError('Field magnitude outside reference budget')
        self.grid,self.psi,self.coupling=grid,state.copy(),float(coupling)
        self.time=0.0;self.steps=0
        self._k=grid.frequencies()
        self._k2=np.zeros(grid.shape)
        for k in self._k:self._k2+=k*k
        self._cached_dt=None;self._kinetic=None

    def _potential(self, potential):
        if np.iscomplexobj(potential):raise ValueError('This closed-system reference requires a real potential')
        v=np.asarray(potential,dtype=float)
        if v.shape not in ((),self.grid.shape):raise ValueError('Potential must be scalar or full-grid')
        if not np.isfinite(v).all() or np.max(np.abs(v))>1e4:raise ValueError('Potential must be finite and bounded')
        return v

    @property
    def density(self):return np.abs(self.psi)**2
    def norm(self):return float(np.sum(self.density)*self.grid.dv)

    def energy(self,potential=0.0):
        v=self._potential(potential)
        fk=np.fft.fftn(self.psi,norm='ortho')
        kinetic=.5*np.sum(self._k2*np.abs(fk)**2)
        rho=self.density
        return float((kinetic+np.sum(v*rho+.5*self.coupling*rho*rho))*self.grid.dv)

    def step(self,dt:float,potential=0.0):
        """Potential is fixed over this step. For time dependence pass midpoint V.

        A negative dt permits numerical reversibility tests of a closed system;
        it is not traversal into the real past. No norm renormalization is used.
        """
        if not math.isfinite(dt) or abs(dt)>.1:raise ValueError('Use finite |dt| <= .1; convergence still must be checked')
        v=self._potential(potential)
        if dt==0:return
        if self._cached_dt!=dt:
            self._kinetic=np.exp(-.5j*dt*self._k2);self._cached_dt=dt
        z=self.psi*np.exp(-.5j*dt*(v+self.coupling*self.density))
        z=np.fft.ifftn(np.fft.fftn(z,norm='ortho')*self._kinetic,norm='ortho')
        z*=np.exp(-.5j*dt*(v+self.coupling*np.abs(z)**2))
        if not np.isfinite(z).all() or np.max(np.abs(z))>100:
            raise FloatingPointError('Divergent/out-of-budget step rejected')
        self.psi=z;self.time+=dt;self.steps+=1

    def phase_kick(self, phase):
        """Explicit impulse to phase. Norm preserved; energy CAN change."""
        theta=self._potential(phase)
        before=self.energy();self.psi*=np.exp(1j*theta)
        return {'norm':self.norm(),'supplied_energy':self.energy()-before}

    def current(self,axis:int):
        """j_axis = Im(conj(psi) * d_axis psi), hbar/m = 1."""
        if type(axis)is not int or not 0<=axis<self.grid.d:raise ValueError('Invalid axis')
        grad=np.fft.ifftn(1j*self._k[axis]*np.fft.fftn(self.psi,norm='ortho'),norm='ortho')
        return np.imag(np.conjugate(self.psi)*grad)

    def marginal(self,axis:int):
        if type(axis)is not int or not 0<=axis<self.grid.d:raise ValueError('Invalid axis')
        sums=tuple(i for i in range(self.grid.d) if i!=axis)
        factor=self.grid.dv/(self.grid.lengths[axis]/self.grid.shape[axis])
        return self.density.sum(axis=sums)*factor

    def observer_slice(self,axes:tuple[int,...],fixed:dict[int,int]):
        """Read-only discrete slice; does NOT update world state or discard axes."""
        if not axes or len(set(axes))!=len(axes) or any(type(a)is not int or not 0<=a<self.grid.d for a in axes):raise ValueError('Invalid view axes')
        remaining=set(range(self.grid.d))-set(axes)
        if set(fixed)!=remaining:raise ValueError('Specify every hidden coordinate index')
        if any(type(i)is not int or not 0<=i<self.grid.shape[a] for a,i in fixed.items()):raise ValueError('Invalid hidden coordinate index')
        selection=tuple(slice(None) if a in axes else fixed[a] for a in range(self.grid.d))
        native=[a for a in range(self.grid.d) if a in axes]
        return self.psi[selection].transpose([native.index(a) for a in axes]).copy()

    def digest(self):
        h=hashlib.sha256(json.dumps({'grid':self.grid.description(),'g':self.coupling,'time':self.time,'steps':self.steps},sort_keys=True).encode())
        h.update(np.asarray(self.psi,dtype='<c16').tobytes());return h.hexdigest()

    def save(self,path):
        meta={'schema':'viva-phase-reference/1','grid':self.grid.description(),'coupling':self.coupling,'time':self.time,'steps':self.steps,'hash':self.digest()}
        np.savez_compressed(Path(path),psi=self.psi,metadata=json.dumps(meta))

    @classmethod
    def load(cls,path):
        path=Path(path)
        if path.stat().st_size>40*1024*1024:raise ValueError('Checkpoint too large')
        with zipfile.ZipFile(path) as z:
            members=z.infolist()
            if sorted(i.filename for i in members)!=['metadata.npy','psi.npy']:raise ValueError('Unknown checkpoint members')
            if sum(i.file_size for i in members)>32*1024*1024:raise ValueError('Expanded checkpoint too large')
        with np.load(path,allow_pickle=False) as f:
            meta=json.loads(str(f['metadata']))
            if meta.get('schema')!='viva-phase-reference/1':raise ValueError('Wrong schema')
            b=meta['grid'];grid=Grid(tuple(b['shape']),tuple(b['lengths']))
            if b['boundary']!='periodic' or b['metric']!='Euclidean / flat torus':raise ValueError('Unsupported boundary/metric')
            obj=cls(grid,f['psi'],meta['coupling'])
        t=meta['time'];steps=meta['steps']
        if not isinstance(t,(int,float)) or not math.isfinite(t) or type(steps)is not int or steps<0:raise ValueError('Invalid clock')
        obj.time=float(t);obj.steps=steps
        if obj.digest()!=meta['hash']:raise ValueError('Checkpoint digest mismatch')
        return obj

def winding(values, minimum_amplitude=1e-8):
    """Loop winding. Sampled, not a certified continuum topological invariant.

    Assumes consecutive samples resolve the phase (< pi per edge). Near-zero
    values and nearly ambiguous pi jumps are rejected, not given a fake charge.
    """
    v=np.asarray(values,dtype=complex)
    if v.ndim!=1 or len(v)<8 or not np.isfinite(v).all() or np.min(np.abs(v))<=minimum_amplitude:raise ValueError('Loop is invalid or crosses a core')
    jumps=np.angle(np.roll(v,-1)*np.conjugate(v))
    if np.any(np.abs(jumps)>np.pi-.03):raise ValueError('Phase underresolved; refine loop sampling')
    total=float(jumps.sum()/(2*np.pi));charge=int(round(total))
    return {'winding':charge,'residual':abs(total-charge),'minimum_amplitude':float(np.min(np.abs(v)))}

def vortex_value(points,plane=(0,1),charge=1,healing=1.0):
    """Kinematic isolated-vortex sheet fixture, not a converged equilibrium.

    Extra coordinates are free: the zero core has dimension D-2. This fixture is
    not periodic globally; use it for local loop/geometry tests, not as a proof
    of a stable isolated vortex on a periodic domain.
    """
    q=np.asarray(points,dtype=float)
    if q.ndim!=2 or not 2<=q.shape[1]<=11 or not np.isfinite(q).all():raise ValueError('Expected N by D points')
    a,b=plane
    if a==b or not 0<=a<q.shape[1] or not 0<=b<q.shape[1] or type(charge)is not int or not 1<=abs(charge)<=4 or not math.isfinite(healing) or healing<=0:raise ValueError('Invalid vortex parameters')
    x,y=q[:,a],q[:,b];r=np.hypot(x,y)
    return np.tanh(r/healing)**abs(charge)*np.exp(1j*charge*np.arctan2(y,x))
