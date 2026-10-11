"""Reproducible local scientific/CPU evidence. Not physical-device validation."""
from __future__ import annotations
import copy
import json
import platform
import sys
import time
import numpy as np
from services.vivo_material import PhaseMaterialDriver
from services.vivo_material.driver import unpack_array, REFERENCE_SHA256
from services.vivo_material.tests.test_material import space, grip, tick


def run(shape=(8,)*4, dt=.02, duration=.6, force=True):
    s=space();d=PhaseMaterialDriver.initialize(s,shape=shape)
    initial=d.checkpoint(); timings=[];mass_errors=[];residuals=[];work=[]
    for _ in range(round(duration/dt)):
        start=time.perf_counter()
        p=tick(d,s,[grip()] if force else [],dt)
        timings.append((time.perf_counter()-start)*1000)
        mass_errors.append(abs(p['diagnostics']['mass']-1))
        residuals.append(abs(p['diagnostics']['residual']))
        work.append(p['diagnostics']['suppliedWork'])
    result={'shape':list(shape),'dt':dt,'duration':duration,'steps':len(timings),
            'q':s['entities']['entity.0']['q'],'v':s['entities']['entity.0']['v'],
            'maxAbsoluteMassError':max(mass_errors),'summedAbsoluteEnergyResidual':sum(residuals),
            'suppliedWork':sum(work), 'stepMs':{'p50':float(np.percentile(timings,50)),
                'p95':float(np.percentile(timings,95)), 'max':max(timings)},
            'checkpointJsonBytes':len(json.dumps(d.checkpoint()).encode()),
            'checkpointDigest':d.checkpoint()['digest']}
    return result,d.checkpoint()


def main():
    forced, cp=run();free,control=run(force=False)
    rho=abs(unpack_array(cp['fields']['entity.0']['psi'],(8,)*4,'complex'))**2
    free_rho=abs(unpack_array(control['fields']['entity.0']['psi'],(8,)*4,'complex'))**2
    refinement={}
    arrays={}
    for dt in (.02,.01,.0025):
        _,c=run(dt=dt,duration=.24)
        arrays[dt]=unpack_array(c['fields']['entity.0']['psi'],(8,)*4,'complex')
    e1=float(np.linalg.norm(arrays[.02]-arrays[.0025]));e2=float(np.linalg.norm(arrays[.01]-arrays[.0025]))
    refinement={'coarseDt':.02,'halfDt':.01,'referenceDt':.0025,'coarseError':e1,'halfError':e2,'errorRatio':e1/e2}
    measurements=[forced]
    for n in (12,16):
        m,_=run(shape=(n,)*4,duration=.24);measurements.append(m)
    report={'schema':'vivo.material.local-evidence/1','evidenceClass':'headless local CPU numerical tests',
            'python':sys.version.split()[0],'numpy':np.__version__,'platform':platform.platform(),
            'referenceSha256':REFERENCE_SHA256,'capabilities':PhaseMaterialDriver.capabilities(),
            'fourthAxisResponse':{'driven':forced,'free':free,'densityL2Difference':float(np.linalg.norm(rho-free_rho))},
            'temporalRefinement':refinement,'boundedCpuMeasurements':measurements,
            'notEstablished':['spatial convergence','physical helium accuracy','physical-device latency',
                '11D material validation','elastic/viscous/surface/adaptive profiles','learned response',
                'authority atomic acceptance and browser integration']}
    print(json.dumps(report,indent=2,allow_nan=False))

if __name__=='__main__':main()
