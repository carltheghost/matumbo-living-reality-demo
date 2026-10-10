import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from viva_phase import Grid,PhaseField,winding,vortex_value


def initial(grid):
    x=grid.coordinates()
    rho=np.ones(grid.shape)
    phase=np.zeros(grid.shape)
    for i,a in enumerate(x):
        rho+=.05*np.cos(2*np.pi*a/grid.lengths[i])
        phase+=.12*np.sin(2*np.pi*a/grid.lengths[i])
    rho+=.03*np.cos(2*np.pi*x[0]/grid.lengths[0])*np.cos(2*np.pi*x[-1]/grid.lengths[-1])
    return np.sqrt(rho)*np.exp(1j*phase)

class PhaseTests(unittest.TestCase):
    def test_budget_rejected_before_allocation(self):
        with self.assertRaises(ValueError):Grid((64,)*11,(8.,)*11)
    def test_non_spatial_feature_axis_rejected(self):
        with self.assertRaises(ValueError):Grid((8,), (8.,))
    def test_three_to_eleven_axes_have_real_kinetic_terms(self):
        for d in range(3,12):
            with self.subTest(d=d):
                grid=Grid((2,)*d,(8.,)*d)
                x=grid.coordinates()
                # Nyquist mode: wave has nonzero kinetic energy on final axis.
                psi=np.broadcast_to(np.exp(-1j*np.pi*2/8*x[-1]),grid.shape).copy()
                f=PhaseField(grid,psi,coupling=0)
                omega=.5*(2*np.pi/8)**2
                self.assertAlmostEqual(f.energy()/f.norm(),omega,places=12)
                f.step(.05)
                np.testing.assert_allclose(f.psi,psi*np.exp(-1j*omega*.05),atol=2e-14)
    def test_constant_stationary_density(self):
        grid=Grid((8,)*4,(8.,)*4);z=np.ones(grid.shape,dtype=complex)
        f=PhaseField(grid,z,coupling=1.3);f.step(.08)
        np.testing.assert_allclose(f.psi,np.exp(-1j*1.3*.08),atol=2e-14)
    def test_four_axis_plane_wave_exact(self):
        g=Grid((12,)*4,(2*np.pi,)*4);x=g.coordinates();m=[1,-1,2,1]
        phase=sum(a*b for a,b in zip(x,m));z=np.exp(1j*phase)
        f=PhaseField(g,z,coupling=.4)
        for _ in range(10):f.step(.01)
        target=z*np.exp(-1j*(.5*sum(a*a for a in m)+.4)*.1)
        np.testing.assert_allclose(f.psi,target,atol=2e-13)
    def test_norm_without_renormalizing(self):
        g=Grid((12,)*4,(8.,)*4);f=PhaseField(g,initial(g),coupling=2);n=f.norm()
        for _ in range(50):f.step(.01)
        self.assertLess(abs(f.norm()/n-1),1e-12)
    def test_forward_backward(self):
        g=Grid((8,)*4,(8.,)*4);z=initial(g);f=PhaseField(g,z)
        for _ in range(10):f.step(.02)
        for _ in range(10):f.step(-.02)
        np.testing.assert_allclose(f.psi,z,atol=3e-13)
    def test_fourth_axis_current(self):
        g=Grid((12,)*4,(2*np.pi,)*4);x=g.coordinates();z=np.broadcast_to(np.exp(1j*x[3]),g.shape)
        f=PhaseField(g,z,0)
        np.testing.assert_allclose(f.current(3),1,atol=1e-13)
        np.testing.assert_allclose(f.current(0),0,atol=1e-13)
    def test_fourth_axis_density_transport(self):
        g=Grid((12,)*4,(2*np.pi,)*4);x=g.coordinates()
        z=np.broadcast_to(1+.15*np.cos(x[3]),g.shape).astype(complex)
        f=PhaseField(g,z,0);before=f.marginal(3)
        for _ in range(20):f.step(.03)
        self.assertGreater(np.linalg.norm(f.marginal(3)-before),.1)
    def test_phase_kick_supplies_energy_not_mass(self):
        g=Grid((12,)*4,(2*np.pi,)*4);f=PhaseField(g,np.ones(g.shape));n=f.norm();x=g.coordinates()
        out=f.phase_kick(np.broadcast_to(.3*np.cos(x[-1]),g.shape))
        self.assertGreater(out['supplied_energy'],0)
        self.assertAlmostEqual(n,f.norm(),places=10)
    def test_potential_changes_flow(self):
        g=Grid((8,)*4,(8.,)*4);z=initial(g);a=PhaseField(g,z);b=PhaseField(g,z)
        v=np.zeros(g.shape);v+=np.cos(2*np.pi*g.coordinates()[-1]/8)
        for _ in range(8):a.step(.03);b.step(.03,v)
        self.assertGreater(np.linalg.norm(a.psi-b.psi),1.)
    def test_global_phase_symmetry(self):
        g=Grid((8,)*4,(8.,)*4);z=initial(g);a=PhaseField(g,z);b=PhaseField(g,z*np.exp(1.23j))
        for _ in range(8):a.step(.02);b.step(.02)
        np.testing.assert_allclose(b.psi,a.psi*np.exp(1.23j),atol=1e-13)
    def test_lattice_translation_symmetry(self):
        g=Grid((8,)*4,(8.,)*4);z=initial(g);a=PhaseField(g,z);b=PhaseField(g,np.roll(z,2,axis=3))
        for _ in range(8):a.step(.02);b.step(.02)
        np.testing.assert_allclose(b.psi,np.roll(a.psi,2,axis=3),atol=1e-13)
    def test_axis_permutation_symmetry(self):
        g=Grid((8,)*4,(8.,)*4);z=initial(g);order=(3,1,2,0);a=PhaseField(g,z);b=PhaseField(g,z.transpose(order))
        for _ in range(8):a.step(.02);b.step(.02)
        np.testing.assert_allclose(b.psi,a.psi.transpose(order),atol=1e-13)
    def test_view_independent(self):
        g=Grid((8,)*4,(8.,)*4);f=PhaseField(g,initial(g));h=f.digest()
        view=f.observer_slice((0,1,2),{3:4});view[:]=999
        self.assertEqual(f.digest(),h)
    def test_view_order(self):
        g=Grid((4,)*4,(8.,)*4);f=PhaseField(g,initial(g))
        a=f.observer_slice((1,0),{2:1,3:2})
        np.testing.assert_equal(a,f.psi[:,:,1,2].T)
    def test_unobserved_axes_must_be_explicit(self):
        g=Grid((4,)*4,(8.,)*4);f=PhaseField(g,initial(g))
        with self.assertRaises(ValueError):f.observer_slice((0,1),{3:1})
    def test_snapshot_continues_same_state(self):
        g=Grid((8,)*4,(8.,)*4);f=PhaseField(g,initial(g));f.step(.02)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'state.npz';f.save(p);r=PhaseField.load(p)
            self.assertEqual(f.digest(),r.digest());f.step(.02);r.step(.02)
            np.testing.assert_equal(f.psi,r.psi)
    def test_invalid_state_rejected(self):
        g=Grid((4,)*4,(8.,)*4)
        with self.assertRaises(ValueError):PhaseField(g,np.full(g.shape,np.nan))
    def test_complex_potential_rejected(self):
        g=Grid((4,)*4,(8.,)*4);f=PhaseField(g,initial(g))
        with self.assertRaises(ValueError):f.step(.01,1j)
    def test_timestep_rejection_is_atomic(self):
        g=Grid((4,)*4,(8.,)*4);f=PhaseField(g,initial(g));h=f.digest()
        with self.assertRaises(ValueError):f.step(float('nan'))
        self.assertEqual(h,f.digest())
    def test_vortex_winding_both_signs(self):
        theta=np.arange(128)*2*np.pi/128
        for k in [-2,-1,0,1,2]:self.assertEqual(winding(np.exp(1j*k*theta))['winding'],k)
    def test_vortex_sheet_core_is_two_dimensional(self):
        # Vary z and w freely while x=y=0: every point remains in the 4D core.
        pts=np.zeros((40,4));pts[:,2:]=np.random.default_rng(31).normal(size=(40,2))
        np.testing.assert_equal(vortex_value(pts),0)
    def test_four_d_loops_link_same_sheet_at_different_hidden_positions(self):
        theta=np.arange(128)*2*np.pi/128;pts=np.zeros((128,4));pts[:,0]=np.cos(theta);pts[:,1]=np.sin(theta)
        for z,w in [(0,0),(2,3),(-4,5)]:
            pts[:,2:]=[z,w]
            self.assertEqual(winding(vortex_value(pts))['winding'],1)
    def test_loop_crossing_core_rejected(self):
        a=np.ones(16,dtype=complex);a[2]=0
        with self.assertRaises(ValueError):winding(a)
    def test_temporal_refinement(self):
        g=Grid((8,)*4,(2*np.pi,)*4);z=initial(g)
        def run(dt):
            f=PhaseField(g,z,4)
            for _ in range(round(.24/dt)):f.step(dt)
            return f.psi
        ref=run(.0025);e1=np.linalg.norm(run(.04)-ref);e2=np.linalg.norm(run(.02)-ref)
        self.assertGreater(e1/e2,3.5)
        self.assertLess(e1/e2,5)

if __name__=='__main__':unittest.main(verbosity=2)
