"""Strategic planner checks against actual broker and an independent small oracle."""
import itertools,json,random,secrets,tempfile,threading,unittest
from functools import lru_cache
from pathlib import Path
from unittest.mock import patch
from station import Station,serve
from client import call
from test_memory_port import FixturePort
from strategy import solve, earliest, SCENARIOS
from organization import order_graph


def brute(graph, durations, workers, releases, slots):
    # Independent minute-by-minute exhaustive schedule. Idle is always an option;
    # capacity checked directly, no priority-order or earliest-fit assumptions.
    ids=tuple(sorted(graph)); n=len(ids); done_mask=(1<<n)-1
    upper=max(releases.values())+sum(durations.values())
    dep=[sum(1<<ids.index(j) for j in graph[i]) for i in ids]
    @lru_cache(None)
    def search(t,done,running):
        if done==done_mask:return t
        if t>=upper:return upper+1
        active={i for i,_ in running}; busy={workers[ids[i]] for i in active}
        eligible=[i for i in range(n) if not (done>>i&1) and i not in active and dep[i]&done==dep[i] and workers[ids[i]] not in busy and releases[workers[ids[i]]]<=t]
        best=upper+1
        for k in range(min(slots-len(running),len(eligible))+1):
            for new in itertools.combinations(eligible,k):
                if len({workers[ids[i]] for i in new})!=len(new):continue
                next_running=[];next_done=done
                for i,d in list(running)+[(i,durations[ids[i]]) for i in new]:
                    if d==1:next_done|=1<<i
                    else:next_running.append((i,d-1))
                best=min(best,search(t+1,next_done,tuple(sorted(next_running))))
        return best
    return search(0,0,())


def topo(graph,root):
    return order_graph(root,[{'id':i,'requires':d,'expected_revision':1} for i,d in graph.items()])[1]


def assert_schedule(test, result, graph, durations, workers, releases, slots):
    rows={x['id']:x for x in result['schedule']};test.assertEqual(set(rows),set(graph))
    test.assertEqual(len(rows),len(result['schedule']))
    for i,row in rows.items():
        test.assertEqual(row['finish_minute']-row['start_minute'],durations[i]);test.assertEqual(row['agent'],workers[i]);test.assertGreaterEqual(row['start_minute'],releases[workers[i]])
        for d in graph[i]:test.assertGreaterEqual(row['start_minute'],rows[d]['finish_minute'])
    for t in {r['start_minute'] for r in rows.values()}:
        active=[r for r in rows.values() if r['start_minute']<=t<r['finish_minute']]
        test.assertLessEqual(len(active),slots);test.assertEqual(len(active),len({r['agent'] for r in active}))
    test.assertEqual(result['finish_minutes'],max(r['finish_minute'] for r in rows.values()))
    test.assertEqual(result['effort_minutes'],sum(durations.values()))
    test.assertGreaterEqual(result['finish_minutes'],max(result['lower_bounds_minutes'].values()))

class SolverTests(unittest.TestCase):
    def test_diamond(self):
        g={'a':[],'b':[],'c':['a','b'],'root':['c']};d={'a':5,'b':7,'c':3,'root':2};w={i:i for i in g};r={i:0 for i in g}
        s=solve(g,topo(g,'root'),d,w,r,2);self.assertEqual(s['finish_minutes'],12);assert_schedule(self,s,g,d,w,r,2)
    def test_shared_worker_serializes(self):
        g={'a':[],'b':[],'root':['a','b']};d={'a':5,'b':7,'root':2};w={'a':'x','b':'x','root':'y'};r={'x':0,'y':0}
        s=solve(g,topo(g,'root'),d,w,r,3);self.assertEqual(s['finish_minutes'],14);assert_schedule(self,s,g,d,w,r,3)
    def test_global_slot_limit(self):
        g={'a':[],'b':[],'root':['a','b']};d={i:3 for i in g};w={i:i for i in g};r={i:0 for i in g}
        s=solve(g,topo(g,'root'),d,w,r,1);self.assertEqual(s['finish_minutes'],9);assert_schedule(self,s,g,d,w,r,1)
    def test_worker_availability(self):
        g={'a':[],'b':[],'root':['a','b']};d={'a':2,'b':3,'root':1};w={i:i for i in g};r={'a':8,'b':0,'root':0}
        s=solve(g,topo(g,'root'),d,w,r,2);self.assertEqual(s['finish_minutes'],11);assert_schedule(self,s,g,d,w,r,2)
    def test_earliest_fits_gap_without_unnecessary_delay(self):
        self.assertEqual(earliest(0,2,'a',1,[(3,9,'b','x')]),0)
        self.assertEqual(earliest(2,2,'a',1,[(3,9,'b','x')]),9)
    def test_independent_oracle_seeded_40_small_graphs(self):
        rng=random.Random(20261126)
        for case in range(40):
            n=rng.randint(2,5);ids=[str(i) for i in range(n)];g={i:[j for j in ids[:k] if rng.random()<.35] for k,i in enumerate(ids)}
            # Last node must depend on every earlier sink, ensuring one final root.
            missing=set(ids[:-1])-{x for deps in g.values() for x in deps};g[ids[-1]]=sorted(set(g[ids[-1]])|missing)
            w={i:str(rng.randrange(3)) for i in ids};r={a:rng.randrange(3) for a in set(w.values())};d={i:rng.randint(1,3) for i in ids};slots=rng.randint(1,3)
            with self.subTest(case=case):
                s=solve(g,topo(g,ids[-1]),d,w,r,slots);assert_schedule(self,s,g,d,w,r,slots)
                self.assertEqual(s['finish_minutes'],brute(g,d,w,r,slots))
    def test_eight_node_capacity_bound(self):
        g={str(i):[] for i in range(7)};g['root']=list(g);d={i:10 for i in g};w={i:i for i in g};r={i:0 for i in g}
        s=solve(g,topo(g,'root'),d,w,r,3);self.assertEqual(s['finish_minutes'],40);assert_schedule(self,s,g,d,w,r,3)
        self.assertLess(s['priority_states_examined'],20000)

class StrategyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.src=FixturePort();self.s=Station(Path(self.tmp.name)/'db.sqlite',memory=self.src)
        self.owner=self.s.enroll('owner','Owner');self.host=self.s.enroll('host','Host','w');self.req=0
        self.agents=[self.enroll(str(i)) for i in range(5)]
        self.ids=[self.create(a) for a in self.agents[:4]];self.a,self.b,self.join,self.root=self.ids
    def tearDown(self):self.s.db.close()
    def rid(self):self.req+=1;return 'strategy-'+str(self.req)
    def enroll(self,name,world='w'):return self.s.enroll('agent',name,world,['world.read','mission.continue','memory.mission.read'])
    def own(self,path,b):return self.s.route(self.owner['token'],'POST','/v1/owner/continuity/'+path,b)
    def create(self,a):return self.own('create',{'agent':a['id'],'objective':'Private fixture objective','grants':[],'request_id':self.rid()})['id']
    def row(self,mid):return self.s.continuity._mission(mid)
    def body(self):
        tasks=[{'id':i,'expected_revision':self.row(i)['revision'],'minutes':dict(zip(SCENARIOS,d)),'units':5} for i,d in zip(self.ids,[(3,5,8),(4,6,9),(2,3,4),(1,2,3)])]
        def nodes(graph):return [{'id':i,'requires':graph[i]} for i in self.ids]
        diamond={self.a:[],self.b:[],self.join:[self.a,self.b],self.root:[self.join]}
        chain={self.a:[],self.b:[self.a],self.join:[self.b],self.root:[self.join]}
        return {'id':self.root,'tasks':tasks,'availability':[{'agent':a['id'],'available_after_minutes':0} for a in self.agents[:4]],'alternatives':[{'name':'parallel','nodes':nodes(diamond),'max_parallel':2,'overhead_units':0},{'name':'serial','nodes':nodes(chain),'max_parallel':1,'overhead_units':0}],'deadline_minutes':30,'budget_units':20}
    def compare(self,b=None):return self.own('strategy/compare',self.body() if b is None else b)
    def deny(self,fn,*a):
        with self.assertRaises((PermissionError,ValueError)):fn(*a)
    def test_compare_selects_dominating_plan(self):
        r=self.compare();self.assertEqual(r['recommended'],'parallel');self.assertEqual(r['decision'],'unique_nondominated');self.assertEqual([p['scenarios']['nominal']['finish_minutes'] for p in r['plans']],[11,16]);self.assertEqual([p['scenarios']['conservative']['finish_minutes'] for p in r['plans']],[16,24])
    def test_pareto_tradeoff_and_budget(self):
        b=self.body();b['budget_units']=30;b['alternatives'][0]['overhead_units']=8
        r=self.compare(b);self.assertIsNone(r['recommended']);self.assertEqual(set(r['robust_pareto_options']),{'parallel','serial'})
        b['budget_units']=20;self.assertEqual(self.compare(b)['recommended'],'serial')
    def test_no_robust_fit(self):
        b=self.body();b['deadline_minutes']=12;r=self.compare(b);self.assertEqual(r['decision'],'no_robust_fit');self.assertIsNone(r['recommended']);self.assertEqual(r['plans'][0]['status'],'scenario_sensitive')
    def test_equal_metrics_no_arbitrary_winner(self):
        b=self.body();b['alternatives'][0]['max_parallel']=1;r=self.compare(b);self.assertIsNone(r['recommended']);self.assertEqual(len(r['robust_pareto_options']),2)
    def test_read_only_exact_snapshot(self):
        before='\n'.join(self.s.db.iterdump());r=self.compare();self.assertEqual(before,'\n'.join(self.s.db.iterdump()));self.assertNotIn('Private fixture objective',json.dumps(r));self.assertEqual(r['plan_sha256'],self.compare()['plan_sha256'])
    def test_all_estimates_and_schedules(self):
        b=self.body();r=self.compare(b);w={i:self.row(i)['agent'] for i in self.ids};rel={a['agent']:a['available_after_minutes'] for a in b['availability']}
        for p in r['plans']:
            graph={n['id']:n['requires'] for n in p['organization_setup']['nodes']}
            for k in SCENARIOS:assert_schedule(self,p['scenarios'][k],graph,{t['id']:t['minutes'][k] for t in b['tasks']},w,rel,p['max_parallel_assumed'])
    def test_graph_setup_requires_separate_owner_action(self):
        r=self.compare();setup=r['plans'][0]['organization_setup'];self.assertIsNone(self.row(self.root)['lease_hash']);self.assertFalse(self.own('organization/get',{'id':self.root})['member'])
        self.own('organization/set',setup|{'request_id':self.rid()});self.assertTrue(self.own('organization/get',{'id':self.root})['member']);self.assertTrue(self.own('organization/get',{'id':self.join})['counts']['ready_to_claim']>=1)
    def test_stale_setup_refused(self):
        r=self.compare();self.s.db.execute('UPDATE continuity_missions SET revision=revision+1 WHERE id=?',(self.a,));self.deny(self.own,'organization/set',r['plans'][0]['organization_setup']|{'request_id':self.rid()})
    def test_agents_and_host_denied(self):
        for p in [self.host,*self.agents]:self.deny(self.s.route,p['token'],'POST','/v1/owner/continuity/strategy/compare',self.body())
    def test_get_rejected(self):self.deny(self.s.route,self.owner['token'],'GET','/v1/owner/continuity/strategy/compare',self.body())
    def test_drop_task_rejected(self):
        b=self.body();b['alternatives'][0]['nodes'].pop(0);self.deny(self.compare,b)
    def test_disconnected_and_cycle_rejected(self):
        b=self.body();b['alternatives'][0]['nodes'][0]['requires']=[self.root];self.deny(self.compare,b)
        b=self.body();b['alternatives'][0]['nodes'][2]['requires']=[self.a];self.deny(self.compare,b)
    def test_invalid_numeric_types(self):
        for field,val in [('deadline_minutes',True),('budget_units',-1),('deadline_minutes',float('nan'))]:
            b=self.body();b[field]=val;self.deny(self.compare,b)
        b=self.body();b['tasks'][0]['minutes']['optimistic']=50;self.deny(self.compare,b)
        b=self.body();b['alternatives'][0]['max_parallel']=False;self.deny(self.compare,b)
    def test_availability_must_cover_exact_workers(self):
        b=self.body();b['availability'].pop();self.deny(self.compare,b)
        b=self.body();b['availability'].append(b['availability'][0]);self.deny(self.compare,b)
    def test_used_or_linked_mission_rejected(self):
        b=self.body();self.own('organization/set',self.compare(b)['plans'][0]['organization_setup']|{'request_id':self.rid()});self.deny(self.compare,self.body())
    def test_wrong_world_member_rejected(self):
        other=self.create(self.enroll('other','different'));b=self.body();b['tasks'][0]['id']=other;self.deny(self.compare,b)
    def test_credential_revocation_rejected(self):
        self.s.route(self.owner['token'],'POST','/v1/owner/stop',{'id':self.agents[0]['id']});self.deny(self.compare,self.body())
    def test_expired_memory_rejected(self):
        v=self.s.route(self.owner['token'],'POST','/v1/owner/memory/preview',{'agent':self.agents[0]['id'],'task':'mission-1'});g=self.s.route(self.owner['token'],'POST','/v1/owner/memory/grant',{k:v[k] for k in ('agent','task','fact','evidence_sha','artifact_sha')}|{'ttl_seconds':60})
        self.s.db.execute('UPDATE continuity_missions SET grants=? WHERE id=?',(json.dumps([g['id']]),self.a));self.s.db.execute('UPDATE mission_memory_grants SET expires=0 WHERE id=?',(g['id'],));self.deny(self.compare,self.body())
    def test_unknown_keys_and_duplicate_alternatives(self):
        b=self.body();b['alternatives'][0]['automatic_execution']=True;self.deny(self.compare,b)
        b=self.body();b['alternatives'][1]=dict(b['alternatives'][0],name='clone');self.deny(self.compare,b)
    def test_real_loopback_owner_route(self):
        api=serve(self.s,0,[]);thread=threading.Thread(target=api.serve_forever,daemon=True);thread.start();url='http://127.0.0.1:'+str(api.server_port)
        try:
            r=call('/v1/owner/continuity/strategy/compare',self.body(),self.owner['token'],url);self.assertEqual(r['recommended'],'parallel')
            with self.assertRaises(RuntimeError):call('/v1/owner/continuity/strategy/compare',self.body(),self.agents[0]['token'],url)
        finally:api.shutdown();api.server_close();thread.join()

if __name__=='__main__':unittest.main(verbosity=2)
