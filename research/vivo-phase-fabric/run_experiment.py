"""Run real four-coordinate phase dynamics and export reproducible evidence."""
import json, math, os, platform, time
from pathlib import Path
import numpy as np
from viva_phase import Grid,PhaseField,winding,vortex_value

OUT=Path(__file__).parent/'reports'
OUT.mkdir(exist_ok=True)

def initial(g):
    x=g.coordinates();rho=np.ones(g.shape);phase=np.zeros(g.shape)
    for i,a in enumerate(x):
        k=2*np.pi/g.lengths[i];rho+=.05*np.cos(k*a);phase+=.14*np.sin(k*a)
    rho+=.07*np.cos(2*np.pi*x[0]/g.lengths[0])*np.cos(2*np.pi*x[-1]/g.lengths[-1])
    return np.sqrt(rho)*np.exp(1j*phase)

def run(dt,g,z,T=.24):
    f=PhaseField(g,z,coupling=2.0)
    for _ in range(round(T/dt)):f.step(dt)
    return f

def main():
    g=Grid((24,)*4,(2*np.pi,)*4);z=initial(g);f=PhaseField(g,z,2.0)
    n,e=f.norm(),f.energy();t0=time.perf_counter();energies=[e]
    for _ in range(24):f.step(.01);energies.append(f.energy())
    elapsed=time.perf_counter()-t0
    main_norm=f.norm()
    f.save(OUT/'phase-4d-checkpoint.npz')
    h=f.digest();near=f.observer_slice((0,1,2),{3:6});far=f.observer_slice((0,1,2),{3:18})
    view_unchanged=h==f.digest()
    # Compare temporal steps at fixed spatial resolution, NOT a continuum proof.
    ref=run(.005,g,z);medium=run(.02,g,z);coarse=run(.04,g,z)
    err1=float(np.linalg.norm(coarse.psi-ref.psi)/np.linalg.norm(ref.psi))
    err2=float(np.linalg.norm(medium.psi-ref.psi)/np.linalg.norm(ref.psi))
    # Local four-dimensional vortex sheet, with two independent free core axes.
    theta=np.arange(256)*2*np.pi/256;q=np.zeros((256,4));q[:,0]=np.cos(theta);q[:,1]=np.sin(theta);q[:,2:]=[.7,-1.4]
    topology=winding(vortex_value(q))
    # Explicit stirring phase kick: energy change is logged rather than concealed.
    kick=np.zeros(g.shape);kick+=.3*np.cos(g.coordinates()[-1])
    pre=f.norm();injected=f.phase_kick(kick)
    report={
        'name':'Viva native four-spatial-dimensional phase-field experiment',
        'status':'isolated numerical reference; not a website/app update',
        'equation':'i*dpsi/dt = (-0.5*Delta + V + g*abs(psi)^2)*psi; hbar=mass=1',
        'scope':'mean-field quantum-inspired model, not quantitative strongly interacting helium-4',
        'grid':g.description(),'complex_samples':g.cells,'full_state_complex_bytes':f.psi.nbytes,
        'coupling':2.0,'simulation_time_before_kick':.24,'time_step':.01,
        'norm_initial':n,'relative_norm_drift_before_kick':abs((main_norm-n)/n),
        'energy_initial':e,'max_relative_energy_drift_dt_001':max(abs(x-e) for x in energies)/abs(e),
        'temporal_refinement':{'fixed_shape':list(g.shape),'reference_dt':.005,'coarse_dt':.04,'medium_dt':.02,
                               'coarse_relative_L2':err1,'medium_relative_L2':err2,'error_ratio':err1/err2},
        'spatial_convergence':'not established; temporal refinement holds spatial grid fixed',
        'two_observer_slices_do_not_mutate_world':view_unchanged,
        'slice_phase_sensitive_difference_L2':float(np.linalg.norm(near-far)),
        'sampled_local_vortex_sheet':{'core_dimension':2,'free_core_axes':['x3','x4'],**topology,
                                      'equilibrium_stability':'not established; analytic local fixture'},
        'stirring':{**injected,'relative_norm_change':abs(f.norm()/pre-1),'energy_units':'dimensionless'},
        'timing':{'seconds_for_24_steps_including_energy_diagnostics':elapsed,'environment':platform.platform(),
                  'numpy':np.__version__,'physical_phone':False,'performance_claim':'not a phone or GPU benchmark'},
        'neural_training':'not run; reference solver can generate training targets. Existing trained guidance remains unchanged.',
        'not_implemented':['liquid-helium equation of state','normal-fluid/thermal component','Rollin film wetting',
                           'free-surface droplets/solid constitutive model','arbitrary curved manifold PDE',
                           'live room integration','learned material model','hand inference','new networking','emergent intelligent room'],
        'test_scope':'Tests exercise discrete numerical laws and local geometry; not empirical validation of nature.'}
    (OUT/'experiment.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
