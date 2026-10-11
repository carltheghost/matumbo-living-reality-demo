"""Generate synthetic 4D trajectories with split-before-simulation provenance.

This prepares data, not a trained model. Teacher: 16^4 periodic GP grid,
complex128, dt=.005. Saved sensor grid: 8^4, real/imag float32.
A coarse sensor is not the complete underlying world. Store that distinction.
The test split changes coupling range; it is not an empirical helium dataset.
"""
from pathlib import Path
import argparse,hashlib,json
import numpy as np
from viva_phase import Grid,PhaseField

def generate(output:Path):
    output.mkdir(parents=True,exist_ok=True);manifest=[]
    split_plan=[('train',1601+i) for i in range(8)]+[('validation',2601+i) for i in range(2)]+[('test',3601+i) for i in range(2)]
    grid=Grid((16,)*4,(2*np.pi,)*4);coords=grid.coordinates();sub=(slice(None,None,2),)*4
    for split,seed in split_plan:
        rng=np.random.default_rng(seed)
        coupling=float(rng.uniform(2.5,3.0) if split=='test' else rng.uniform(.5,2.0))
        rho=np.ones(grid.shape);phase=np.zeros(grid.shape)
        for a in coords:
            rho+=rng.uniform(.01,.08)*np.cos(a+rng.uniform(-np.pi,np.pi))
            phase+=rng.uniform(-.25,.25)*np.sin(a+rng.uniform(-np.pi,np.pi))
        z=np.sqrt(rho)*np.exp(1j*phase);f=PhaseField(grid,z,coupling)
        freq=rng.integers(1,3,size=4);shift=rng.uniform(-np.pi,np.pi,size=4)
        frames=[np.stack([f.psi[sub].real,f.psi[sub].imag],axis=-1).astype('float32')]
        potentials=[];norms=[f.norm()]
        for frame in range(8):
            # Hold external potential fixed for 4 substeps (explicit piecewise input).
            V=np.zeros(grid.shape)
            for a,k,s in zip(coords,freq,shift):V+=.15*np.cos(k*a+s+.2*frame)
            potentials.append(V[sub].astype('float32'))
            for _ in range(4):f.step(.005,V)
            frames.append(np.stack([f.psi[sub].real,f.psi[sub].imag],axis=-1).astype('float32'));norms.append(f.norm())
        name=f'{split}-{seed}.npz';path=output/name
        np.savez_compressed(path,psi=np.stack(frames),potential=np.stack(potentials),coupling=coupling,delta_t=.02)
        manifest.append({'file':name,'split':split,'seed':seed,'coupling':coupling,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                         'teacher_relative_norm_drift':max(abs(n/norms[0]-1) for n in norms)})
    description={'schema':'viva-phase-teacher/1','source':'synthetic declared mean-field equation, not experiments',
                 'teacher_shape':[16]*4,'observation_shape':[8]*4,'teacher_dt':.005,'observation_dt':.02,
                 'input':'psi[t], potential[t], coupling, dt; potential[t] held over the transition',
                 'target':'psi[t+1]; test losses should include complex state, density, current, rollout and invariants',
                 'sampling_warning':'coarse subsampling omits unresolved state; not a closed exact coarse dynamics guarantee',
                 'neural_training':'not performed','split_unit':'whole trajectory; no frame-level split',
                 'test_shift':'test coupling drawn from [2.5,3]; train/validation from [.5,2]',
                 'normalization':'fit on training split only; do not tune on final test',
                 'records':manifest}
    (output/'manifest.json').write_text(json.dumps(description,indent=2))
    print(json.dumps({'trajectories':len(manifest),'train':8,'validation':2,'test':2,'output':str(output)},indent=2))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=Path('training-data'));args=parser.parse_args();generate(args.output)
