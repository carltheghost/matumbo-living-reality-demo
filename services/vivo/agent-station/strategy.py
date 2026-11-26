"""Owner-only strategic comparison over existing, unleased mission graphs.

This is a deterministic scheduling model, not a dispatcher or learned planner.
No planning event or grant is created; adoption uses existing organization/set.
Times and resource units are owner estimates, not observations or actual billing.
"""
from collections import defaultdict
from continuity import canonical, fields, require, sha, string
from organization import order_graph, link, prohibit_reviewers

SCHEMA = 'matumbo.mission.strategy/1'
SCENARIOS = ('optimistic', 'nominal', 'conservative')
MAX_MINUTES = 10080
MAX_UNITS = 10**9
MAX_PLANS = 4


def integer(x, low, high, label):
    require(type(x) is int and low <= x <= high, 'invalid '+label)
    return x


def earliest(start, duration, worker, slots, placed):
    """Earliest nonpreemptive placement; jump only past a proved conflict."""
    while True:
        end = start + duration
        intersect = [x for x in placed if x[0] < end and x[1] > start]
        same = [x for x in intersect if x[2] == worker]
        if same:
            start = min(x[1] for x in same)
            continue
        # Load can only increase at a start boundary, not an end boundary.
        for t in sorted({start} | {x[0] for x in intersect if x[0] >= start}):
            active = [x for x in intersect if x[0] <= t < x[1]]
            if len(active) >= slots:
                start = min(x[1] for x in active)
                break
        else:
            return start


def lower_bounds(graph, order, durations, workers, releases, slots):
    finish = {}
    loads = defaultdict(int)
    for mid in order:
        w = workers[mid]
        finish[mid] = max([releases[w]] + [finish[x] for x in graph[mid]]) + durations[mid]
        loads[w] += durations[mid]
    effort = sum(durations.values())
    return {'precedence_and_availability': max(finish.values()),
            'worker_capacity': max(releases[w] + d for w,d in loads.items()),
            'parallel_capacity': (effort+slots-1)//slots}


def solve(graph, order, durations, workers, releases, slots):
    """Exact makespan for <=8 tasks with fixed assignments and integer times.

    Enumerate topological priority orders using serial earliest-feasible placement.
    For any feasible schedule, order its jobs by start time (ties topological).
    In that order each job can be placed no later than its original start: all
    earlier jobs end no later than their original ends, so at/after that start
    their occupancy cannot exceed the original. Thus an optimum is represented.
    The bound is for this static model only, never real wall-clock execution.
    """
    bounds = lower_bounds(graph, order, durations, workers, releases, slots)
    lower = max(bounds.values())
    ids = sorted(graph)
    ends = {}; placed = []; best = None; best_finish = float('inf'); visited = 0

    def visit():
        nonlocal best, best_finish, visited
        visited += 1
        if best_finish == lower:
            return
        if len(ends) == len(ids):
            finish = max(ends.values())
            if finish < best_finish:
                best_finish = finish; best = list(placed)
            return
        for mid in ids:
            if mid in ends or not all(d in ends for d in graph[mid]):
                continue
            w = workers[mid]
            start = earliest(max([releases[w]]+[ends[d] for d in graph[mid]]), durations[mid], w, slots, placed)
            finish = start + durations[mid]
            if finish >= best_finish:
                continue
            ends[mid] = finish; placed.append((start,finish,w,mid))
            visit()
            placed.pop(); del ends[mid]
            if best_finish == lower:
                return
    visit()
    require(best is not None,'no feasible schedule')
    # Peak slots from the actual schedule, not from graph width.
    peak = max(sum(a<=t<b for a,b,_,_ in best) for t in {x[0] for x in best})
    return {'finish_minutes': best_finish, 'effort_minutes': sum(durations.values()),
            'peak_parallel':peak, 'lower_bounds_minutes':bounds,
            'schedule_minus_lower_bound_minutes':best_finish-lower,
            'priority_states_examined':visited,
            'schedule':[{'id':i,'agent':w,'start_minute':a,'finish_minute':b} for a,b,w,i in sorted(best)]}


def dominates(a,b):
    x = (a['scenarios']['conservative']['finish_minutes'],a['scenarios']['nominal']['finish_minutes'],a['estimated_units'])
    y = (b['scenarios']['conservative']['finish_minutes'],b['scenarios']['nominal']['finish_minutes'],b['estimated_units'])
    return all(i<=j for i,j in zip(x,y)) and x!=y


def compare(c,p,b):
    if p['role']!='owner':raise PermissionError('strategy requires owner credential')
    fields(b,'id tasks availability alternatives deadline_minutes budget_units')
    root=c._mission(string(b['id'],64))
    deadline=integer(b['deadline_minutes'],1,8*MAX_MINUTES+MAX_MINUTES,'deadline')
    budget=integer(b['budget_units'],0,9*MAX_UNITS,'resource budget')
    tasks=b['tasks'];require(isinstance(tasks,list) and 2<=len(tasks)<=8,'select two to eight required missions')
    estimates={};workers={};revs={}
    # Validate every member once and share the workload estimates across alternatives.
    for t in tasks:
        fields(t,'id expected_revision minutes units');mid=string(t['id'],64)
        require(mid not in estimates,'duplicate estimated mission')
        r=c._mission(mid);c._rev(r,t['expected_revision'])
        require(r['world']==root['world'] and r['phase']=='assigned' and r['lease_hash'] is None and r['lease_epoch']==0 and link(c,r) is None,'strategy requires unused, unleased same-world missions')
        c._agent(r['agent'],root['world']);require(c._evidence_ok(r),'strategy member evidence unavailable')
        d=t['minutes'];fields(d,'optimistic nominal conservative')
        values=[integer(d[k],1,MAX_MINUTES,'duration estimate') for k in SCENARIOS]
        require(values==sorted(values),'duration scenarios must be ordered')
        estimates[mid]={'minutes':dict(zip(SCENARIOS,values)),'units':integer(t['units'],0,MAX_UNITS,'resource units')}
        workers[mid]=r['agent'];revs[mid]=r['revision']
    require(root['id'] in estimates,'root must be a required mission')
    prohibit_reviewers(c,set(estimates))
    availability=b['availability'];require(isinstance(availability,list) and len(availability)<=8,'invalid worker availability')
    releases={}
    for a in availability:
        fields(a,'agent available_after_minutes');w=string(a['agent'],64)
        require(w in workers.values() and w not in releases,'unexpected or duplicate worker availability')
        releases[w]=integer(a['available_after_minutes'],0,MAX_MINUTES,'availability estimate')
    require(set(releases)==set(workers.values()),'availability required for every assigned worker')
    alternatives=b['alternatives'];require(isinstance(alternatives,list) and 1<=len(alternatives)<=MAX_PLANS,'select one to four alternatives')
    plans=[];seen=set();seen_structure=set();task_ids=set(estimates)
    total_units=sum(e['units'] for e in estimates.values())
    for a in alternatives:
        fields(a,'name nodes max_parallel overhead_units');name=string(a['name'],80)
        require(name not in seen,'duplicate alternative name');seen.add(name)
        slots=integer(a['max_parallel'],1,8,'parallel capacity')
        overhead=integer(a['overhead_units'],0,MAX_UNITS,'overhead units')
        ns=a['nodes'];require(isinstance(ns,list) and len(ns)==len(tasks),'every alternative must preserve all required missions')
        nodes=[]
        for n in ns:
            fields(n,'id requires');mid=string(n['id'],64);require(mid in task_ids,'unknown alternative mission')
            nodes.append({'id':mid,'requires':n['requires'],'expected_revision':revs[mid]})
        graph,order=order_graph(root['id'],nodes)
        require(set(graph)==task_ids,'every alternative must preserve all required missions')
        nodes=[{'id':mid,'requires':graph[mid],'expected_revision':revs[mid]} for mid in order]
        structure=sha(canonical([nodes,slots,overhead]));require(structure not in seen_structure,'duplicate alternative structure');seen_structure.add(structure)
        scenarios={k:solve(graph,order,{i:e['minutes'][k] for i,e in estimates.items()},workers,releases,slots) for k in SCENARIOS}
        units=total_units+overhead
        meets={k:units<=budget and scenarios[k]['finish_minutes']<=deadline for k in SCENARIOS}
        status='fits_all_scenarios' if all(meets.values()) else 'scenario_sensitive' if any(meets.values()) else 'outside_limits'
        plans.append({'name':name,'max_parallel_assumed':slots,'estimated_units':units,'overhead_units':overhead,
                      'scenarios':scenarios,'meets_limits':meets,'status':status,
                      'organization_setup':{'id':root['id'],'nodes':nodes},'structure_sha256':structure})
    # Recommendations prefer all-scenario fit; preserve non-dominated choices.
    feasible=[x for x in plans if x['status']=='fits_all_scenarios']
    frontier=[a for a in feasible if not any(dominates(x,a) for x in feasible)]
    choice=frontier[0]['name'] if len(frontier)==1 else None
    # The plan hash is a review snapshot, not a permission or reservation.
    digest=sha(canonical([SCHEMA,root['id'],root['world'],revs,workers,releases,estimates,deadline,budget,plans]))
    return {'schema':SCHEMA,'root':root['id'],'plan_sha256':digest,'deadline_minutes':deadline,'budget_units':budget,
            'estimated_task_units':total_units,'worker_availability_minutes':releases,'plans':plans,
            'recommended':choice,'robust_pareto_options':[x['name'] for x in frontier],
            'decision':'unique_nondominated' if choice is not None else 'owner_tradeoff_required' if frontier else 'no_robust_fit',
            'authority':'advisory only; owner must review dependencies and separately configure organization/set using returned revisions',
            'assumptions':['fixed assigned workers; one mission per worker; nonpreemptive work',
                           'estimates include any desired approval/review delay; external workload and live delays are not modeled',
                           'parallel cap and resource budget are planning assumptions, not dispatch or billing enforcement',
                           'all three duration scenarios are estimates, not probability or guaranteed deadlines',
                           'owner must verify that every alternative dependency structure is semantically valid',
                           'no task deletion, graph rewrite, provider calls, or automatic action']}
