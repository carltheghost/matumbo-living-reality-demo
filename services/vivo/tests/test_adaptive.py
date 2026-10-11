import unittest,numpy as np,heapq
from server.geometry import Geometry
from server.adaptive import Guidance,RoomRule,teacher
class AdaptiveTests(unittest.TestCase):
 def setUp(self):
  self.rule=RoomRule();self.g=Geometry('flat',4);self.grid=self.g.sample_grid(10,8);self.a=Guidance(self.g,self.grid,self.rule)
 def test_trained_not_random(self):
  x=np.random.default_rng(555).uniform(0,1,(300,4));pred=self.rule.predict(x);target=teacher(x);self.assertLess(np.mean((pred-target)**2),.003)
 def test_bounded_cost(self):
  y=self.rule.predict(np.random.default_rng(777).normal(0,20,(500,4)));self.assertTrue(np.isfinite(y).all());self.assertTrue((y>=1).all()and(y<=4).all())
 def test_propagation_reaches_goal(self):
  self.a.step(100);p=self.a.route(0);self.assertTrue(p);self.assertEqual(p[-1],self.a.goal)
 def test_route_repairs_after_obstacle(self):
  self.a.step(100);p=self.a.route(0);blocked=p[len(p)//2];self.a.blocked.add(blocked);self.a.rebuild();self.a.step(100);new=self.a.route(0);self.assertTrue(new);self.assertNotIn(blocked,new);self.assertNotEqual(p,new)
 def test_blocked_goal_rejected_by_server_contract(self):
  self.a.step(100);self.a.blocked.add(0);self.a.rebuild();self.a.step(100);self.assertEqual(self.a.route(0),[])
 def test_matches_dijkstra_for_learned_costs(self):
  self.a.step(100);dist=[float('inf')]*self.a.n;dist[self.a.goal]=0;q=[(0,self.a.goal)]
  while q:
   d,a=heapq.heappop(q)
   if d!=dist[a]:continue
   for b,c in self.a.adj[a]:
    if d+c<dist[b]:dist[b]=d+c;heapq.heappush(q,(d+c,b))
  np.testing.assert_allclose(self.a.dist,dist,atol=1e-10)
 def test_turn_off_stops_growth(self):
  self.a.mode='off';self.a.rebuild();self.a.step(100);self.assertEqual(np.isfinite(self.a.dist).sum(),1)
 def test_model_changes_actual_cost(self):
  original=self.a.adj[0][0][1];self.a.mode='analytic';self.a.rebuild();self.assertNotEqual(original,self.a.adj[0][0][1])
 def test_crowd_response(self):
  original=self.a.adj[0][0][1];self.a.features[0,1]=1;self.a.rebuild();self.assertGreater(self.a.adj[0][0][1],original)
 def test_snapshot_restoration(self):
  self.a.step(30);s=self.a.state();b=Guidance(self.g,self.grid,self.rule);b.restore(s);np.testing.assert_allclose(b.dist,self.a.dist,atol=1e-6)
 def test_neural_version_gate(self):
  s=self.a.state();s['model']='wrong';
  with self.assertRaises(ValueError):self.a.restore(s)
 def test_curved_guide(self):
  for kind in ['sphere','torus','mobius']:
   g=Geometry(kind,7);a=Guidance(g,g.sample_grid(10,8),self.rule);a.step(100);self.assertTrue(a.route(0))
