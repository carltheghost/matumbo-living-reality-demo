import copy
import json
import math
from pathlib import Path
import tempfile
import time
import unittest
import numpy as np

from services.vivo_material import PhaseMaterialDriver, AcceptedMaterialAdapter, MaterialError
from services.vivo_material.driver import digest, reference, unpack_array, pack_array


def space(count=1):
    return {'id':'space.phase', 'dimension':4, 'intrinsicDimension':4,
            'atlasId':'atlas.periodic-cartesian.v1', 'metricId':'metric.flat-euclidean.v1',
            'topologyId':'topology.periodic-torus.v1',
            'law':{'id':'vivo.phase.periodic-compliant','version':'1'}, 'modelHashes':[],
            'field':{'codec':'vivo.material.phase/1','handle':'phase.fields','hash':'0'*64},
            'entities': {f'entity.{i}': {'id':f'entity.{i}','spaceId':'space.phase',
                'chart':'chart.periodic', 'dimension':4, 'q':[0.,0.,0.,0.], 'v':[0.,0.,0.,0.],
                'revision':0, 'materialProfile':'phase', 'fieldMembership':[f'field.{i}'],
                'innerSpaceId':None,'lineage':[]} for i in range(count)}}


def grip(q=(0.,0.,0.,1.), eid='entity.0'):
    return {'entityId':eid, 'leaseId':'lease.a', 'source':'touch',
            'target':{'spaceId':'space.phase','chart':'chart.periodic','dimension':4,'q':[float(v) for v in q]},
            'maxForce':2., 'stiffness':2., 'damping':0}


def tick(driver, s, grips=(), dt=.02):
    cp = driver.checkpoint()
    result = driver.step({'space':s,'fieldState':cp,'grips':list(grips),'dt':dt,
                          'tick':cp['tick']+1,'randomState':'deterministic:none','mode':'analytic'})
    # Test authority acceptance simulation. Production owner performs atomic CAS.
    for update in result['entityUpdates']:
        s['entities'][update['id']].update({k:copy.deepcopy(update[k]) for k in ('q','v','chart')})
        s['entities'][update['id']]['revision'] += 1
    return result


def captured(s, cp):
    return {'snapshot':{'schema':'vivo.snapshot/1','worldId':'world.1','authorityId':'authority.1',
            'acceptedSequence':3,'simulationTime':cp['simulationTime'],'rootSpaceId':s['id'],
            'spaces':{s['id']:copy.deepcopy(s)},'stateHash':'a'*64}, 'constraints':[], 'authorityTimeMs':1000.}


def accepted(q=(0.,0.,0.,1.)):
    return {'id':'lease.a','session':'session.secret','actorId':'actor.owner','spaceId':'space.phase',
            'entityId':'entity.0','source':'touch','inputEpoch':1,'targetSeq':1,'expiresAt':2000.,
            'target':grip(q)['target']}


class MaterialTests(unittest.TestCase):
    def setUp(self):
        self.space = space()
        self.driver = PhaseMaterialDriver.initialize(self.space)

    def assert_rejected(self, code, call):
        before = self.driver.checkpoint()
        with self.assertRaises(MaterialError) as context:
            call()
        self.assertEqual(context.exception.code, code)
        self.assertEqual(before, self.driver.checkpoint())

    def test_supported_bounds_and_unsupported_profiles(self):
        self.assertEqual(self.driver.capabilities()['spatialDimensions'], [4])
        self.assertEqual(self.driver.capabilities()['profiles'], ['phase'])
        for profile in ('stable','elastic','viscous','surface','adaptive','intelligent'):
            s = space(); s['entities']['entity.0']['materialProfile'] = profile
            with self.assertRaisesRegex(MaterialError, 'UNSUPPORTED_PROFILE'):
                PhaseMaterialDriver.initialize(s)
        for dimension in (2,3,5,11):
            s=space(); s['dimension']=dimension
            with self.assertRaisesRegex(MaterialError, 'UNSUPPORTED_DIMENSION'):
                PhaseMaterialDriver.initialize(s)

    def test_resolution_domain_and_allocation_bounds(self):
        for shape in ((2,)*4, (32,)*4, (9,)*4, (16,)*11):
            with self.assertRaises(MaterialError):
                PhaseMaterialDriver.initialize(space(), shape=shape)
        with self.assertRaisesRegex(MaterialError,'FIELD_BUDGET'):
            PhaseMaterialDriver.initialize(space(5))
        with self.assertRaisesRegex(MaterialError,'UNSUPPORTED_DOMAIN'):
            PhaseMaterialDriver.initialize(space(), lengths=(float('nan'),)*4)
        d=PhaseMaterialDriver.initialize(space(4),shape=(16,)*4)
        self.assertEqual(len(d.checkpoint()['fields']), 4)

    def test_exact_initial_mass_and_persistent_identity(self):
        out=tick(self.driver,self.space)
        self.assertAlmostEqual(out['diagnostics']['mass'],1.,places=12)
        self.assertEqual(out['entityUpdates'][0]['id'],'entity.0')
        self.assertEqual(out['fieldState']['fields']['entity.0']['membership'],['field.0'])
        self.assertEqual(out['modelHashes'],[])

    def test_initial_centroid_arbitrary_full_dimensional_location(self):
        s=space(); s['entities']['entity.0']['q']=[.123,-.62,1.2,-1.234]
        d=PhaseMaterialDriver.initialize(s)
        np.testing.assert_allclose(d.checkpoint()['fields']['entity.0']['q'],[.123,-.62,1.2,-1.234],atol=1e-12)

    def test_fourth_axis_target_changes_actual_density_and_current(self):
        free=PhaseMaterialDriver(self.driver.checkpoint()); fs=copy.deepcopy(self.space)
        before=unpack_array(self.driver.checkpoint()['fields']['entity.0']['psi'],(8,)*4,'complex')
        for _ in range(30):
            out=tick(self.driver,self.space,[grip()]); tick(free,fs)
        after=unpack_array(out['fieldState']['fields']['entity.0']['psi'],(8,)*4,'complex')
        control=unpack_array(free.checkpoint()['fields']['entity.0']['psi'],(8,)*4,'complex')
        self.assertGreater(np.linalg.norm(abs(after)**2-abs(control)**2),.001)
        self.assertGreater(self.space['entities']['entity.0']['q'][3],.02)
        self.assertGreater(self.space['entities']['entity.0']['v'][3],.02)
        self.assertLess(abs(self.space['entities']['entity.0']['q'][0]),1e-12)
        self.assertLess(self.space['entities']['entity.0']['q'][3],.3)
        self.assertGreater(np.linalg.norm(after-before),.1)

    def test_axis_permutation_and_centroid_velocity_tangent(self):
        results=[]
        for axis in range(4):
            s=space();d=PhaseMaterialDriver.initialize(s);q=[0,0,0,0];q[axis]=1
            for _ in range(10):tick(d,s,[grip(q)])
            results.append((s['entities']['entity.0']['q'][axis],s['entities']['entity.0']['v'][axis]))
        np.testing.assert_allclose(results,[results[0]]*4,atol=1e-12)
        field=d._field(d.checkpoint()['fields']['entity.0'])
        from services.vivo_material.driver import summary
        observed=summary(field);epsilon=1e-5
        plus=reference().PhaseField(field.grid,field.psi,field.coupling);plus.step(epsilon)
        minus=reference().PhaseField(field.grid,field.psi,field.coupling);minus.step(-epsilon)
        velocity=(np.array(summary(plus)['q'])-np.array(summary(minus)['q']))/(2*epsilon)
        np.testing.assert_allclose(observed['v'],velocity,atol=1e-8)

    def test_anisotropic_grid_and_periodic_seam_continue_and_restore(self):
        s=space();s['entities']['entity.0']['q']=[.3,-.4,.7,-1.]
        d=PhaseMaterialDriver.initialize(s,shape=(8,10,12,14),lengths=(4,8,12,16))
        tick(d,s,[grip()]);self.assertEqual(d.checkpoint(),PhaseMaterialDriver(d.checkpoint()).checkpoint())
        s=space();s['entities']['entity.0']['q'][3]=-4
        d=PhaseMaterialDriver.initialize(s);out=tick(d,s,[grip([0,0,0,3.5])])
        # Crossing the periodic seam is continuous in the torus metric.
        shift=(out['entityUpdates'][0]['q'][3]+4+4)%8-4
        self.assertLess(abs(shift),.001)
        self.assertEqual(d.checkpoint(),PhaseMaterialDriver(d.checkpoint()).checkpoint())

    def test_target_acceptance_never_teleports(self):
        out=tick(self.driver,self.space,[grip()])
        self.assertLess(abs(out['entityUpdates'][0]['q'][3]),.001)
        self.assertNotEqual(out['entityUpdates'][0]['q'],grip()['target']['q'])
        self.assertGreater(out['diagnostics']['suppliedWork'],0.)
        self.assertLess(out['fieldDiagnostics'][0]['forceBoundPerUnitMass'],2.0000001)

    def test_teacher_step_exact_equality_for_independent_potential_fixture(self):
        cp=self.driver.checkpoint(); f=self.driver._field(cp['fields']['entity.0'])
        ks=[2*np.pi/L for L in f.grid.lengths]
        scale=2/math.sqrt(sum((2/k)**2 for k in ks))
        v=np.zeros(f.grid.shape)
        for x,k,q in zip(f.grid.coordinates(),ks,[0,0,0,1]):
            v+=scale*2/(k*k)*(1-np.cos(k*(x-q)))
        f.step(.02,v)
        out=tick(self.driver,self.space,[grip()])
        actual=unpack_array(out['fieldState']['fields']['entity.0']['psi'],(8,)*4,'complex')
        np.testing.assert_array_equal(actual,f.psi)

    def test_four_axis_plane_wave_analytic_teacher_fixture(self):
        r=reference(); g=r.Grid((8,)*4,(2*np.pi,)*4)
        modes=[1,-1,1,2]; psi=np.exp(1j*sum(k*x for k,x in zip(modes,g.coordinates())))
        f=r.PhaseField(g,psi,.4)
        for _ in range(10): f.step(.01)
        expected=psi*np.exp(-1j*(.5*sum(k*k for k in modes)+.4)*.1)
        np.testing.assert_allclose(f.psi,expected,rtol=0,atol=2e-13)
        self.assertGreater(np.mean(f.current(3)),1.99)

    def test_norm_and_energy_under_bounded_driving(self):
        maximum_error=0.; residual_sum=0.; work_sum=0.
        for i in range(150):
            out=tick(self.driver,self.space,[grip((0,0,0,.3*np.sin(i*.03)))])
            maximum_error=max(maximum_error,abs(out['diagnostics']['mass']-1))
            residual_sum+=abs(out['diagnostics']['residual'])
            work_sum+=out['diagnostics']['suppliedWork']
        self.assertLess(maximum_error,1e-11)
        self.assertLess(residual_sum,.001)
        self.assertTrue(math.isfinite(work_sum))

    def test_timestep_refinement_for_driven_nonlinear_field(self):
        def run(dt):
            s=space(); d=PhaseMaterialDriver.initialize(s,coupling=10.)
            for _ in range(round(.24/dt)):tick(d,s,[grip()],dt)
            return unpack_array(d.checkpoint()['fields']['entity.0']['psi'],(8,)*4,'complex')
        fine=run(.0025)
        ratio=np.linalg.norm(run(.02)-fine)/np.linalg.norm(run(.01)-fine)
        self.assertGreater(ratio,3.5);self.assertLess(ratio,4.8)

    def test_release_removes_potential_without_removing_matter(self):
        for _ in range(10):tick(self.driver,self.space,[grip()])
        before=self.space['entities']['entity.0']['q'][3]
        out=tick(self.driver,self.space)
        p=unpack_array(out['fieldState']['fields']['entity.0']['potential'],(8,)*4,'real')
        np.testing.assert_array_equal(p,np.zeros((8,)*4))
        self.assertAlmostEqual(out['diagnostics']['mass'],1.,places=12)
        self.assertLess(out['diagnostics']['suppliedWork'],0)
        self.assertGreater(self.space['entities']['entity.0']['q'][3],before)
        self.assertGreater(self.space['entities']['entity.0']['v'][3],0.)

    def test_observer_slices_are_detached_and_do_not_evolve_field(self):
        before=self.driver.checkpoint()
        a=self.driver.observe('entity.0',(0,1,2),{3:2})
        b=self.driver.observe('entity.0',(3,1),{0:4,2:4})
        a['density'][0][0][0]=999; b['phase'][0][0]=999
        self.assertEqual(before,self.driver.checkpoint())
        with self.assertRaises(ValueError):self.driver.observe('entity.0',(0,1),{3:2})
        self.assertEqual(before,self.driver.checkpoint())

    def test_restart_json_and_whole_trajectory_replay_exact(self):
        initial=self.driver.checkpoint(); original_space=copy.deepcopy(self.space)
        events=[[grip((.2*np.sin(i),0,0,.4))] if i<8 else [] for i in range(20)]
        for g in events[:10]:tick(self.driver,self.space,g)
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'checkpoint.json';p.write_text(json.dumps(self.driver.checkpoint()))
            restored=PhaseMaterialDriver(json.loads(p.read_text()))
        restored_space=copy.deepcopy(self.space)
        for g in events[10:]:
            tick(self.driver,self.space,g);tick(restored,restored_space,g)
        self.assertEqual(self.driver.checkpoint(),restored.checkpoint())
        replay=PhaseMaterialDriver(initial)
        for g in events:tick(replay,original_space,g)
        self.assertEqual(self.driver.checkpoint(),replay.checkpoint())
        self.assertEqual(self.space,restored_space)

    def test_multiple_populations_conserve_total_mass_without_duplicate_tracers(self):
        s=space(2);d=PhaseMaterialDriver.initialize(s)
        out=tick(d,s,[grip()])
        self.assertAlmostEqual(out['diagnostics']['mass'],2.,places=12)
        self.assertEqual(len(out['entityUpdates']),2)
        self.assertGreater(s['entities']['entity.0']['q'][3],0)
        self.assertLess(abs(s['entities']['entity.1']['q'][3]),1e-12)

    def test_duplicate_field_membership_rejected(self):
        s=space(2);s['entities']['entity.1']['fieldMembership']=['field.0']
        with self.assertRaisesRegex(MaterialError,'DUPLICATE_MASS_MEMBERSHIP'):
            PhaseMaterialDriver.initialize(s)

    def test_invalid_step_is_atomic(self):
        for dt in (float('nan'),float('inf'),-.01,0,.021,True):
            self.assert_rejected('TIMESTEP_BOUNDS',lambda:tick(self.driver,self.space,dt=dt))
        bad=grip();bad['damping']=.1
        self.assert_rejected('DAMPING_UNSUPPORTED',lambda:tick(self.driver,self.space,[bad]))
        bad=grip();bad['target']['q'][3]=1000
        self.assert_rejected('TARGET_FRAME',lambda:tick(self.driver,self.space,[bad]))

    def test_checkpoint_hash_and_corruption_rejected(self):
        cp=self.driver.checkpoint();cp['simulationTime']+=1
        self.assert_rejected('CHECKPOINT_HASH',lambda:self.driver.restore(cp))
        cp=self.driver.checkpoint();cp['fields']['entity.0']['psi']='bad'
        cp.pop('digest');cp['digest']=digest(cp)
        self.assert_rejected('FIELD_BYTES',lambda:self.driver.restore(cp))

    def test_returned_updates_are_detached_from_driver_state(self):
        proposal=tick(self.driver,self.space,[grip()]);before=self.driver.checkpoint()
        proposal['entityUpdates'][0]['q'][3]=123
        proposal['entityUpdates'][0]['v'][3]=123
        proposal['fieldState']['fields']['entity.0']['q'][3]=123
        self.assertEqual(before,self.driver.checkpoint())
        PhaseMaterialDriver(self.driver.checkpoint())

    def test_exhausted_clock_and_revision_rejected_before_mutation(self):
        s=space();d=PhaseMaterialDriver.initialize(s,simulation_time=1e9);before=d.checkpoint()
        with self.assertRaisesRegex(MaterialError,'CLOCK_EXHAUSTED'):tick(d,s)
        self.assertEqual(before,d.checkpoint());PhaseMaterialDriver(d.checkpoint())
        s=space();s['entities']['entity.0']['revision']=2**53-2
        d=PhaseMaterialDriver.initialize(s);before=d.checkpoint()
        with self.assertRaisesRegex(MaterialError,'REVISION_EXHAUSTED'):tick(d,s)
        self.assertEqual(before,d.checkpoint());PhaseMaterialDriver(d.checkpoint())

    def test_malformed_field_records_and_extreme_integers_have_typed_errors(self):
        for value in (None,[],3,'invalid'):
            cp=self.driver.checkpoint();cp['fields']['entity.0']=value
            cp.pop('digest');cp['digest']=digest(cp)
            with self.assertRaisesRegex(MaterialError,'INVALID_FIELD_RECORD'):
                self.driver.restore(cp)
        with self.assertRaisesRegex(MaterialError,'INVALID_PARAMETERS'):
            PhaseMaterialDriver.initialize(space(),mass=10**1000)
        with self.assertRaisesRegex(MaterialError,'HASH_NUMBER'):digest({'value':10**1000})

    def test_hash_codec_is_typed_and_bounded(self):
        self.assertNotEqual(digest(1),digest({'$f64':'000000000000f03f'}))
        with self.assertRaisesRegex(MaterialError,'HASH_KEY'):digest({'\U00010000':1,'\ue000':2})
        with self.assertRaisesRegex(MaterialError,'HASH_NUMBER'):digest(1e16)
        cycle=[];cycle.append(cycle)
        with self.assertRaisesRegex(MaterialError,'HASH_CYCLE'):digest(cycle)
        nested=1
        for _ in range(34):nested=[nested]
        with self.assertRaisesRegex(MaterialError,'HASH_BUDGET'):digest(nested)
        cp=self.driver.checkpoint();cp['unknown']=cycle
        with self.assertRaisesRegex(MaterialError,'CHECKPOINT_FIELDS'):self.driver.restore(cp)
        g=grip();g['entityId']=[]
        with self.assertRaisesRegex(MaterialError,'GRIP_ENTITY'):tick(self.driver,self.space,[g])

    def test_checkpoint_cannot_forge_centroid_even_with_rehashed_payload(self):
        cp=self.driver.checkpoint();cp['fields']['entity.0']['q'][3]=1.
        cp.pop('digest');cp['digest']=digest(cp)
        self.assert_rejected('CHECKPOINT_OBSERVABLE_MISMATCH',lambda:self.driver.restore(cp))

    def test_curved_geometry_and_learned_mode_rejected(self):
        s=space();s['metricId']='metric.curved'
        with self.assertRaisesRegex(MaterialError,'UNSUPPORTED_GEOMETRY'):
            PhaseMaterialDriver.initialize(s)
        cp=self.driver.checkpoint()
        with self.assertRaisesRegex(MaterialError,'UNSUPPORTED_MODE'):
            self.driver.step({'space':self.space,'fieldState':cp,'grips':[], 'dt':.02,
                              'tick':1,'randomState':'deterministic:none','mode':'learned'})
        self.assertEqual(cp,self.driver.checkpoint())

    def test_zero_force_matches_released_field(self):
        a=PhaseMaterialDriver(self.driver.checkpoint());s=copy.deepcopy(self.space)
        g=grip();g['maxForce']=0.
        actual=tick(self.driver,self.space,[g]);control=tick(a,s)
        self.assertEqual(actual,control)

    def test_failed_second_entity_does_not_commit_first_entity(self):
        s=space(2);d=PhaseMaterialDriver.initialize(s);before=d.checkpoint()
        s['entities']['entity.1']['revision']=1
        with self.assertRaisesRegex(MaterialError,'STALE_ENTITY_REVISION'):
            tick(d,s,[grip()])
        self.assertEqual(before,d.checkpoint())

    def test_stale_entity_revision_or_transform_rejected(self):
        self.space['entities']['entity.0']['revision']=1
        self.assert_rejected('STALE_ENTITY_REVISION',lambda:tick(self.driver,self.space))
        self.space['entities']['entity.0']['revision']=0
        self.space['entities']['entity.0']['q'][3]=1
        self.assert_rejected('ENTITY_FIELD_MISMATCH',lambda:tick(self.driver,self.space))

    def test_entity_removal_requires_explicit_mass_disposition(self):
        s=space(2);d=PhaseMaterialDriver.initialize(s)
        before=d.checkpoint();del s['entities']['entity.1']
        with self.assertRaisesRegex(MaterialError,'MATERIAL_MEMBERSHIP_CHANGED'):tick(d,s)
        self.assertEqual(before,d.checkpoint())


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.space=space();self.cp=PhaseMaterialDriver.initialize(self.space).checkpoint()
        self.space['field']['hash']=self.cp['digest']
        self.context=captured(self.space,self.cp)
        self.adapter=AcceptedMaterialAdapter(lambda:self.context,world_id='world.1',authority_id='authority.1',space_id='space.phase')

    def propose(self, **kwargs):
        return self.adapter.propose(self.cp,expected_sequence=kwargs.pop('expected_sequence',3),
                                    expected_state_hash=kwargs.pop('expected_state_hash','a'*64),dt=.02,tick=1,**kwargs)

    def test_only_actual_accepted_lease_supplies_forcing(self):
        free=self.propose()
        self.context['constraints']=[accepted()]
        forced=self.propose()
        self.assertEqual(forced['baseSequence'],3)
        self.assertEqual(forced['baseEntityRevisions'],{'entity.0':0})
        self.assertEqual(forced['baseFieldDigest'],self.cp['digest'])
        self.assertEqual(forced['acceptedLeaseProofs'][0]['targetSeq'],1)
        self.assertNotIn('session',forced['acceptedLeaseProofs'][0])
        self.assertGreater(forced['entityUpdates'][0]['q'][3],free['entityUpdates'][0]['q'][3])
        self.assertEqual(self.cp,PhaseMaterialDriver.initialize(self.space).checkpoint())
        self.assertEqual(self.context['snapshot']['spaces']['space.phase'],self.space)

    def test_untrusted_target_or_snapshot_injection_not_an_api(self):
        with self.assertRaises(TypeError):self.propose(grips=[grip()])
        with self.assertRaises(TypeError):self.propose(snapshot=self.context['snapshot'])
        with self.assertRaises(TypeError):self.propose(receipt={'status':'accepted'})

    def test_malformed_authority_spaces_and_oversized_clock_reject_cleanly(self):
        self.context['snapshot']['spaces']['space.phase']=None
        with self.assertRaisesRegex(MaterialError,'INVALID_SPACE'):self.propose()
        self.context['snapshot']['spaces']['space.phase']=copy.deepcopy(self.space)
        self.context['snapshot']['spaces']['space.phase']['entities']=None
        self.context['constraints']=[accepted()]
        with self.assertRaisesRegex(MaterialError,'FIELD_BUDGET'):self.propose()
        self.context=captured(self.space,self.cp);self.context['authorityTimeMs']=1e16
        with self.assertRaisesRegex(MaterialError,'HASH_NUMBER'):self.propose()

    def test_valid_but_unaccepted_checkpoint_rejected(self):
        other=copy.deepcopy(self.cp);other['coupling']=2.
        other.pop('digest');other['digest']=digest(other)
        with self.assertRaisesRegex(MaterialError,'STALE_MATERIAL_FIELD'):
            self.adapter.propose(other,expected_sequence=3,expected_state_hash='a'*64,dt=.02,tick=1)

    def test_stale_authority_sequence_hash_world_and_time_rejected(self):
        with self.assertRaisesRegex(MaterialError,'STALE_AUTHORITY_SEQUENCE'):self.propose(expected_sequence=2)
        with self.assertRaisesRegex(MaterialError,'STALE_AUTHORITY_HASH'):self.propose(expected_state_hash='b'*64)
        self.context['snapshot']['worldId']='world.other'
        with self.assertRaisesRegex(MaterialError,'AUTHORITY_MISMATCH'):self.propose()
        self.context['snapshot']['worldId']='world.1';self.context['snapshot']['simulationTime']=.1
        with self.assertRaisesRegex(MaterialError,'STALE_MATERIAL_TIME'):self.propose()

    def test_expired_or_removed_lease_has_no_force(self):
        free=self.propose();lease=accepted();lease['expiresAt']=1000.
        self.context['constraints']=[lease]
        expired=self.propose()
        self.assertEqual(free,expired)
        self.context['constraints']=[]
        self.assertEqual(free,self.propose())

    def test_cross_space_target_rejected(self):
        lease=accepted();lease['target']['spaceId']='space.other';self.context['constraints']=[lease]
        with self.assertRaisesRegex(MaterialError,'TARGET_FRAME'):self.propose()

    def test_stale_epoch_and_target_sequence_rejected(self):
        for name,value in [('inputEpoch',-1),('inputEpoch',True),('targetSeq',0),('targetSeq',1.5)]:
            lease=accepted();lease[name]=value;self.context['constraints']=[lease]
            with self.assertRaisesRegex(MaterialError,'STALE_ACCEPTED_TARGET'):self.propose()

    def test_duplicate_lease_unknown_entity_and_source_rejected(self):
        self.context['constraints']=[accepted(),accepted()]
        with self.assertRaisesRegex(MaterialError,'DUPLICATE_ACCEPTED_LEASE'):self.propose()
        lease=accepted();lease['entityId']='entity.other';self.context['constraints']=[lease]
        with self.assertRaisesRegex(MaterialError,'LEASE_ENTITY'):self.propose()
        lease=accepted();lease['source']='injected';self.context['constraints']=[lease]
        with self.assertRaisesRegex(MaterialError,'INPUT_SOURCE'):self.propose()
        lease=accepted();del lease['source'];self.context['constraints']=[lease]
        with self.assertRaisesRegex(MaterialError,'INPUT_SOURCE'):self.propose()

    def test_detached_proposal_changes_neither_authority_nor_checkpoint(self):
        self.context['constraints']=[accepted()]
        before=copy.deepcopy(self.context);cp=copy.deepcopy(self.cp)
        out=self.propose();out['entityUpdates'][0]['q'][3]=123
        out['fieldState']['fields']['entity.0']['q'][0]=123
        self.assertEqual(before,self.context);self.assertEqual(cp,self.cp)


if __name__=='__main__':unittest.main(verbosity=2)
