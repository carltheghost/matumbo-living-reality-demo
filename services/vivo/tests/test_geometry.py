import unittest, math
import numpy as np
from server.geometry import Geometry,Expression
from server.reference import HyperBall
class GeometryTests(unittest.TestCase):
 def test_full_d_axes(self):
  for d in range(3,12):
   g=Geometry('flat',d);q=np.zeros(d);v=np.zeros(d);v[-1]=1;p=g.move(q,v,.3);self.assertAlmostEqual(p.q[-1],.3)
 def test_full_d_collision(self):
  a=HyperBall('a',np.zeros(11),.3);q=np.zeros(11);q[-1]=2;b=HyperBall('b',q,.3);self.assertFalse(a.overlaps(b))
 def test_fourth_axis_ray(self):
  ball=HyperBall('a',np.array([0,0,0,2.]),.25);self.assertAlmostEqual(ball.ray_hit([0,0,0,0],[0,0,0,1]),1.75)
 def test_metrics_spd(self):
  for kind in ['flat','sphere','torus','mobius']:
   for d in (3,4,7,11):self.assertTrue((np.linalg.eigvalsh(Geometry(kind,d).metric(np.ones(d)*.1))>0).all())
 def test_sphere_chart_transition(self):
  g=Geometry('sphere',4);q=np.array([7.,1.,.1,.3]);v=np.array([.4,.2,.1,.7]);point=g.display(q);energy=v@g.metric(q)@v
  p,v2=g.canonical(q,v);self.assertEqual(p.chart,'b');np.testing.assert_allclose(g.display(p.q,p.chart),point,atol=1e-10);self.assertAlmostEqual(v2@g.metric(p.q,p.chart)@v2,energy,places=9)
 def test_sphere_geodesic_speed(self):
  g=Geometry('sphere',3);q=np.array([.3,.2,0]);v=np.array([.35,.15,0]);p,w=g.geodesic(q,v,1)
  self.assertAlmostEqual(v@g.metric(q)@v,w@g.metric(p.q,p.chart)@w,places=6)
 def test_torus_closed_seam(self):
  g=Geometry('torus',3);q=np.array([math.pi+.05,.2,.1]);p,v=g.canonical(q,[1,2,3]);np.testing.assert_allclose(g.display(q),g.display(p.q),atol=1e-12);np.testing.assert_allclose(v,[1,2,3])
 def test_mobius_twist(self):
  g=Geometry('mobius',4);q=np.array([math.pi+.02,.3,.1,.4]);p,v=g.canonical(q,[1,2,3,4]);self.assertAlmostEqual(p.q[1],-.3);self.assertEqual(v[1],-2);np.testing.assert_allclose(g.display(p.q),g.display(q),atol=1e-10)
 def test_mobius_double_circuit(self):
  g=Geometry('mobius',3);p,v=g.canonical([4*math.pi+.1,.4,0],[1,1,0]);self.assertAlmostEqual(p.q[1],.4);self.assertAlmostEqual(v[1],1)
 def test_mobius_bound(self):
  p,v=Geometry('mobius',3).canonical([0,1,0],[0,1,0]);self.assertEqual(p.q[1],.8);self.assertEqual(v[1],0)
 def test_custom_curvature(self):
  g=Geometry('custom',3,[['1+q0**2',0,0],[0,1,0],[0,0,1]])
  self.assertAlmostEqual(g.christoffel([.5,0,0])[0,0,0],.4,places=7)
  p,v=g.geodesic([.5,0,0],[1,0,0],.2);self.assertLess(v[0],1)
 def test_custom_negative(self):
  with self.assertRaises(ValueError):Geometry('custom',3,[[-1,0,0],[0,1,0],[0,0,1]])
 def test_custom_asymmetric(self):
  with self.assertRaises(ValueError):Geometry('custom',3,[[1,.3,0],[0,1,0],[0,0,1]])
 def test_no_expression_execution(self):
  for s in ['__import__("os")','q0.real','q0[0]','sin(q0,1)','q0**q1','1e999','(lambda:1)()','[x for x in []]']:
   with self.assertRaises((ValueError,SyntaxError)):Expression(s,3)
 def test_reject_wrong_dimension(self):
  for d in [2,12,True,3.1]:
   with self.assertRaises(ValueError):Geometry('flat',d)
 def test_reject_nonfinite(self):
  with self.assertRaises(ValueError):Geometry().move([0,0,0,0],[0,1,0,0],float('nan'))
 def test_curved_grid_not_screen_neighbors(self):
  g=Geometry('mobius',3);grid=g.sample_grid(10,6);self.assertIn([9,50],grid['edges']);self.assertNotIn([0,9],grid['edges'])
 def test_intrinsic_sphere_distance(self):
  g=Geometry('sphere',3);self.assertAlmostEqual(g.edge_length([0,0,0],[0,0,0],'a','b'),math.pi*g.R,places=6)
 def test_general_metric_fourth_axis(self):
  metric=[[1 if i==j else 0 for j in range(4)]for i in range(4)];metric[3][3]='4';g=Geometry('custom',4,metric);p=g.move([0]*4,[0,0,0,1],.2);self.assertAlmostEqual(p.q[3],.1)
 def test_preserve_hidden_coordinates_at_seam(self):
  g=Geometry('torus',11);q=np.arange(11)*.1;q[0]=7;p,v=g.canonical(q);np.testing.assert_equal(p.q[2:],q[2:])
 def test_torus_mesh_closed(self):
  from collections import Counter
  grid=Geometry('torus',5).sample_grid();edges=Counter()
  for a,b,c in grid['faces']:
   for edge in [(a,b),(b,c),(c,a)]:edges[tuple(sorted(edge))]+=1
  self.assertTrue(all(n==2 for n in edges.values()));self.assertEqual(len(grid['coords'])-len(edges)+len(grid['faces']),0)
 def test_mobius_mesh_single_boundary(self):
  from collections import Counter,defaultdict
  grid=Geometry('mobius',4).sample_grid();edges=Counter();adj=defaultdict(set)
  for a,b,c in grid['faces']:
   for edge in [(a,b),(b,c),(c,a)]:edges[tuple(sorted(edge))]+=1
  for (a,b),n in edges.items():
   if n==1:adj[a].add(b);adj[b].add(a)
  self.assertTrue(all(len(x)==2 for x in adj.values()));seen=set();todo=[next(iter(adj))]
  while todo:
   a=todo.pop()
   if a in seen:continue
   seen.add(a);todo.extend(adj[a]-seen)
  self.assertEqual(len(seen),len(adj));self.assertEqual(len(grid['coords'])-len(edges)+len(grid['faces']),0)
