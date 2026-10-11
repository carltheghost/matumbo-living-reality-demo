"""Executable checks for the isolated Viva mathematical/neural reference."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from viva_reference import (HyperBall, RigidPortal, SharedWorld, NeuralEdgeLaw,
                            NeuralWaveField, dimension_contract, graph_forces,
                            plane_rotation, vector)
ROOT = Path(__file__).parent


class VivaReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = NeuralEdgeLaw.load(ROOT / 'results/neural-edge-law.npz')

    def test_01_tesseract_counts(self):
        x = dimension_contract(4)
        self.assertEqual((x['hypercube_vertices'], x['hypercube_edges'],
                          x['hypercube_boundary_cells'], x['rotation_parameters']), (16,32,8,6))

    def test_02_every_dimension_is_spatial_plus_clock(self):
        for d in range(3,12):
            with self.subTest(d=d):
                c = dimension_contract(d)
                self.assertEqual(c['clock_dimension'],1)
                self.assertEqual(c['hypercube_boundary_cells'],2*d)
                self.assertEqual(c['ray_direction_manifold_dimension'],d-1)
        self.assertEqual(dimension_contract(11)['rotation_parameters'],55)

    def test_03_dimension_validation(self):
        for bad in (2,12,4.0,True,'4'):
            with self.assertRaises(ValueError): dimension_contract(bad)

    def test_04_all_rotations_preserve_distance(self):
        rng=np.random.default_rng(91)
        for d in range(3,12):
            with self.subTest(d=d):
                r=plane_rotation(d,0,d-1,.73)
                np.testing.assert_allclose(r.T@r,np.eye(d),atol=1e-12)
                self.assertAlmostEqual(np.linalg.det(r),1.)
                q=rng.normal(size=(8,d))
                np.testing.assert_allclose(np.linalg.norm(q-q[0],axis=1),np.linalg.norm(q@r.T-q[0]@r.T,axis=1),atol=1e-12)

    def test_05_fourth_axis_rotation_changes_real_coordinates(self):
        r=plane_rotation(4,0,3,np.pi/2)
        np.testing.assert_allclose(r@np.array([1,0,0,0.]),[0,0,0,1],atol=1e-12)

    def test_06_false_overlap_in_projection_is_not_collision(self):
        a=HyperBall('a',[0,0,0,0],.4)
        b=HyperBall('b',[0,0,0,2],.4)
        np.testing.assert_equal(a.center[:3],b.center[:3])
        self.assertFalse(a.overlaps(b))

    def test_07_exact_ball_slice_changes_and_disappears(self):
        a=HyperBall('a',[0,0,0,.6],1)
        self.assertAlmostEqual(a.slice3_radius([0]),.8)
        a.center[3]=1.1
        self.assertIsNone(a.slice3_radius([0]))
        self.assertAlmostEqual(a.slice3_radius([1.1]),1.)

    def test_08_ray_uses_fourth_direction(self):
        a=HyperBall('a',[0,0,0,2],.5)
        self.assertAlmostEqual(a.ray_hit([0,0,0,0],[0,0,0,1]),1.5)
        self.assertIsNone(a.ray_hit([0,0,0,0],[1,0,0,0]))

    def test_09_opaque_objects_still_occlude_in_four_dimensions(self):
        a=HyperBall('front',[0,0,0,2],.5)
        b=HyperBall('behind',[0,0,0,4],.5)
        candidates=[(obj.ray_hit([0]*4,[0,0,0,1]),obj.entity_id) for obj in (b,a)]
        self.assertEqual(min(candidates)[1],'front')

    def test_10_portal_roundtrip_all_dimensions(self):
        rng=np.random.default_rng(41)
        for d in range(3,12):
            with self.subTest(d=d):
                r=plane_rotation(d,1,d-1,.55)
                portal=RigidPortal(r,rng.normal(size=d))
                q,v=rng.normal(size=(2,d))
                a,b=portal.transport(q,v)
                qa,va=portal.inverse().transport(a,b)
                np.testing.assert_allclose(qa,q,atol=1e-12)
                np.testing.assert_allclose(va,v,atol=1e-12)
                self.assertAlmostEqual(float(v@v),float(b@b))

    def test_11_portals_do_not_silently_drop_dimensions(self):
        with self.assertRaises(ValueError): RigidPortal(np.eye(3),np.zeros(4))
        p=RigidPortal(np.eye(4),np.zeros(4))
        with self.assertRaises(ValueError): p.transport([0,0,0],[0,0,0])
        with self.assertRaises(ValueError): RigidPortal(2*np.eye(4),np.zeros(4))

    def world(self):
        w=SharedWorld(4)
        w.entities['relic']=HyperBall('relic',[0,0,0,0],.3)
        w.editors={'alice','bob'}
        return w

    def test_12_two_observers_share_one_entity(self):
        w=self.world()
        w.move('alice','relic',[1,2,3,4],0)
        alice_snapshot=w.snapshot(); bob_snapshot=w.snapshot()
        self.assertEqual(alice_snapshot,bob_snapshot)
        self.assertEqual(len(w.entities),1)
        self.assertEqual(w.entities['relic'].entity_id,'relic')

    def test_13_stale_edit_rejected_without_mutation(self):
        w=self.world();w.move('alice','relic',[0,0,0,1],0)
        digest=w.digest()
        with self.assertRaises(ValueError): w.move('bob','relic',[1,1,1,1],0)
        self.assertEqual(w.digest(),digest)

    def test_14_permission_failure_does_not_mutate(self):
        w=self.world();digest=w.digest()
        with self.assertRaises(PermissionError):w.move('guest','relic',[1,0,0,0],0)
        self.assertEqual(w.digest(),digest)

    def test_15_snapshot_roundtrip_retains_identity_and_history(self):
        w=self.world();w.move('bob','relic',[.1,.2,.3,.4],0)
        restored=SharedWorld.restore(json.loads(json.dumps(w.snapshot())))
        self.assertEqual(restored.digest(),w.digest())
        self.assertEqual(len(restored.events),1)
        self.assertEqual(restored.events[0]['actor'],'bob')

    def test_16_snapshot_is_not_a_mutable_view(self):
        w=self.world();s=w.snapshot();s['entities']['relic']['center'][0]=10
        self.assertEqual(w.entities['relic'].center[0],0)

    def test_17_neural_gradient_matches_finite_difference(self):
        model=NeuralEdgeLaw(); x=np.array([-.4,-.1,.2,.7])
        _,grad=model.loss_and_grads(x)
        for key,index in [('w1',(0,3)),('w2',(2,4)),('w3',(8,0)),('b3',(0,0))]:
            old=model.p[key][index];eps=1e-5
            model.p[key][index]=old+eps;plus=model.loss_and_grads(x)[0]
            model.p[key][index]=old-eps;minus=model.loss_and_grads(x)[0]
            model.p[key][index]=old
            self.assertAlmostEqual(grad[key][index],(plus-minus)/(2*eps),places=7)

    def test_18_neural_fit_and_stronger_baseline_reported(self):
        report=json.loads((ROOT/'results/neural-training-report.json').read_text())
        self.assertLess(report['test_neural_mse'],report['test_hooke_mse'])
        self.assertLess(report['test_fitted_cubic_mse'],report['test_neural_mse'])
        self.assertLess(report['test_neural_mse'],1e-4)

    def test_19_neural_weights_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'law.npz';self.model.save(path)
            b=NeuralEdgeLaw.load(path)
            np.testing.assert_array_equal(self.model.forward([-.2,.3]),b.forward([-.2,.3]))

    def test_20_neural_coefficients_are_bounded(self):
        k=self.model.forward(np.linspace(-100,100,101))
        self.assertTrue(np.all((k>=.5)&(k<=2)))

    def test_21_equal_opposite_forces_conserve_total_internal_force(self):
        rng=np.random.default_rng(87)
        for d in range(3,12):
            with self.subTest(d=d):
                q=rng.normal(size=(6,d))*.25
                edges=[(i,j) for i in range(6) for j in range(i+1,6)]
                np.testing.assert_allclose(graph_forces(q,edges,self.model).sum(0),np.zeros(d),atol=1e-12)

    def test_22_neural_forces_are_rotation_translation_equivariant(self):
        rng=np.random.default_rng(92)
        for d in range(3,12):
            with self.subTest(d=d):
                q=rng.normal(size=(6,d))*.25
                edges=[(i,j) for i in range(6) for j in range(i+1,6)]
                r=plane_rotation(d,0,d-1,.41); shift=rng.normal(size=d)
                f=graph_forces(q,edges,self.model)
                changed=graph_forces(q@r.T+shift,edges,self.model)
                np.testing.assert_allclose(changed,f@r.T,atol=1e-11)

    def test_23_coincident_positions_do_not_generate_nan(self):
        np.testing.assert_array_equal(graph_forces(np.zeros((2,11)),[(0,1)],self.model),np.zeros((2,11)))

    def test_24_eleventh_coordinate_changes_forces(self):
        q=np.zeros((2,11));q[1,10]=1.5
        f=graph_forces(q,[(0,1)],self.model)
        self.assertGreater(f[0,10],0)
        np.testing.assert_array_equal(f[:,:10],np.zeros((2,10)))

    def test_25_field_runs_and_transmits_wave_in_every_dimension(self):
        for d in range(3,12):
            with self.subTest(d=d):
                q=np.zeros((3,d));q[1,d-1]=1.1;q[2,d-1]=2.2
                field=NeuralWaveField(q,[(0,1),(1,2)],self.model);field.u[0]=1
                for _ in range(100):field.step()
                self.assertTrue(np.isfinite(field.q).all())
                self.assertGreater(field.u[1],0)
                self.assertGreater(field.memory[1],0)
                self.assertNotEqual(field.q[0,d-1],0)

    def test_26_bad_input_rejected(self):
        for x in ([0,0,float('nan')],[0,0,float('inf')],[1,2]):
            with self.assertRaises(ValueError):vector(x)
        with self.assertRaises(ValueError):plane_rotation(4,0,0,1)
        with self.assertRaises(ValueError):HyperBall('x',[0,0,0],-1)
        with self.assertRaises(ValueError):HyperBall('x',[0,0,0],1).ray_hit([0]*3,[0]*3)


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(VivaReferenceTests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    report={'suite':'isolated mathematical / neural reference',
            'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),
            'passed':result.wasSuccessful(),
            'dimensions_exercised':list(range(3,12)),
            'limits':['No display, camera, hands, eye tracking, phone, network, curved manifolds or deployed app tested.',
                      'Shared-world tests are in-process command semantics only.',
                      'Neural test learns a known synthetic law; polynomial reference is better.',
                      'A leaky memory channel is not demonstrated intelligence.',
                      'No long-horizon stability or total-energy theorem established.']}
    (ROOT/'results/reference-tests.json').write_text(json.dumps(report,indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)
