"""A bounded, immutable DAG of existing owner-assigned missions.
Dependencies are historical owner acceptances, never permission to act.
Uses the continuity journal; no scheduler, shared credentials, or new store.
"""
import json
from continuity import canonical, fields, require, sha, string

SCHEMA='matumbo.mission.organization/1'
MAX_NODES=8
TERMINAL=('closed','cancelled')


def link(c,m):
    row=c.db.execute("SELECT * FROM continuity_events WHERE mission=? AND kind='organization_joined' ORDER BY revision DESC LIMIT 1",(m['id'],)).fetchone()
    if row is None:return None
    require(row['revision']<=m['revision'] and c.db.execute("SELECT 1 FROM principals WHERE id=? AND role='owner'",(row['actor'],)).fetchone(),'organization link invalid')
    try:
        d=json.loads(row['data']);fields(d,'root graph revision');string(d['root'],64);string(d['graph'],64)
        require(type(d['revision']) is int and d['revision']>=1,'organization link invalid')
        return d
    except (ValueError,TypeError,KeyError,RecursionError):raise ValueError('organization link invalid') from None


def order_graph(root,nodes):
    """Require every node to be a prerequisite (direct or indirect) of root."""
    require(isinstance(nodes,list) and 2<=len(nodes)<=MAX_NODES,'select two to eight existing missions')
    graph={}
    for n in nodes:
        fields(n,'id requires expected_revision');mid=string(n['id'],64)
        require(mid not in graph and type(n['expected_revision']) is int and n['expected_revision']>=1,'invalid organization node')
        deps=n['requires'];require(isinstance(deps,list) and len(deps)<MAX_NODES,'invalid dependencies')
        deps=[string(i,64) for i in deps]
        require(len(set(deps))==len(deps) and mid not in deps,'duplicate or self dependency')
        graph[mid]=sorted(deps)
    require(root in graph and all(d in graph for deps in graph.values() for d in deps),'unknown organization dependency')
    visiting=set();done=set();ordered=[]
    def visit(mid):
        require(mid not in visiting,'dependency cycle')
        if mid in done:return
        visiting.add(mid)
        for dep in graph[mid]:visit(dep)
        visiting.remove(mid);done.add(mid);ordered.append(mid)
    visit(root)
    require(done==set(graph),'all members must contribute to the root')
    return graph,ordered


def definition(c,m):
    l=link(c,m)
    if l is None:return None
    root=c._mission(l['root'])
    row=c.db.execute("SELECT * FROM continuity_events WHERE mission=? AND revision=? AND kind='organization_set'",(root['id'],l['revision'])).fetchone()
    require(root['world']==m['world'] and row is not None and row['revision']<=root['revision'] and c.db.execute("SELECT 1 FROM principals WHERE id=? AND role='owner'",(row['actor'],)).fetchone(),'organization definition invalid')
    try:
        data=json.loads(row['data']);fields(data,'nodes digest')
        graph,ordered=order_graph(root['id'],data['nodes'])
        require(m['id'] in graph and data['digest']==l['graph']==sha(canonical([root['id'],root['world'],row['revision'],data['nodes']])),'organization digest changed')
        for mid in ordered:
            member=c._mission(mid)
            require(member['world']==root['world'] and link(c,member)==l,'organization membership changed')
        return {'root':root['id'],'world':root['world'],'digest':l['graph'],'revision':row['revision'],'graph':graph,'order':ordered}
    except (ValueError,TypeError,KeyError,RecursionError,PermissionError):raise ValueError('organization definition invalid') from None


def receipt(c,m):
    """Pin the exact existing observation, without making an old receipt fresh."""
    from collective import latest
    require(latest(c,m)==m['observation'],'organization observation superseded')
    row=c.db.execute('''SELECT a.*, o.assignment, o.epoch FROM actions a JOIN continuity_observations o ON o.action=a.id
        WHERE o.mission=? AND a.id=?''',(m['id'],m['observation'])).fetchone()
    require(row is not None and row['status']=='completed' and row['tool']=='vivo.world.read' and row['agent']==m['agent'] and row['world']==m['world'] and row['assignment']==m['assignment'] and row['epoch']==m['lease_epoch'] and isinstance(row['result'],str),'organization receipt invalid')
    doc=json.loads(row['result']);require(doc['snapshot']['worldId']==m['world'],'organization receipt world mismatch')
    return sha(canonical([row['id'],row['agent'],row['world'],row['assignment'],row['epoch'],row['created'],row['updated'],doc]))


def dependency_binding(d,deps,proofs):
    return {'graph':d['digest'],'prerequisite_count':len(deps),'prerequisites_sha256':sha(canonical([[dep,proofs[dep]] for dep in deps]))}

def latest_required(c,m,obs):
    from collective import latest
    require(obs is not None and latest(c,m)==obs and c._obs_ok(m,obs),'organization requires latest confirmed native observation')

def completion(c,m,binding):
    return {'dependency_binding':binding,'checkpoint_sha256':sha(m['checkpoint']),'receipt_sha256':receipt(c,m)}


def evaluate(c,m,d):
    """Evaluate a bounded topological prefix. Do not read peer memory/grants."""
    statuses={};proofs={}
    for mid in d['order']:
        row=c._mission(mid);deps=d['graph'][mid]
        if row['phase']=='cancelled':statuses[mid]='cancelled';continue
        if any(statuses[x] in ('cancelled','blocked') for x in deps):statuses[mid]='blocked';continue
        if any(statuses[x]!='accepted' for x in deps):statuses[mid]='waiting';continue
        if row['phase']!='closed':
            statuses[mid]='suspended' if row['phase']=='suspended' else 'ready_to_claim' if row['phase']=='assigned' else 'awaiting_owner' if row['phase']=='ready' else 'in_progress';continue
        try:
            event=c.db.execute("SELECT * FROM continuity_events WHERE mission=? AND revision=? AND assignment=? AND kind='accepted'",(mid,row['revision'],row['assignment'])).fetchone()
            task=c.db.execute('SELECT agent,status,answer FROM tasks WHERE id=?',(mid,)).fetchone()
            require(event and task and task['status']=='completed' and task['agent']==row['agent'] and c.db.execute("SELECT 1 FROM principals WHERE id=? AND role='owner'",(event['actor'],)).fetchone(),'organization acceptance missing')
            data=json.loads(event['data']);fields(data,'note organization');require(data['note']==task['answer'],'organization acceptance changed')
            binding=dependency_binding(d,deps,proofs)
            require(isinstance(row['checkpoint'],str) and json.loads(row['checkpoint']).get('organization')==binding,'organization checkpoint changed')
            require(data['organization']==completion(c,row,binding),'organization completion changed')
            proofs[mid]=sha(canonical([mid,row['assignment'],event['revision'],event['actor'],event['created'],data]))
            statuses[mid]='accepted'
        except (ValueError,TypeError,KeyError,RecursionError,IndexError):statuses[mid]='blocked'
    deps=d['graph'][m['id']]
    counts={k:sum(statuses[x]==k for x in deps) for k in ('accepted','cancelled','blocked','waiting','suspended','ready_to_claim','in_progress','awaiting_owner')}
    allowed=all(statuses[x]=='accepted' for x in deps)
    public={'schema':SCHEMA,'member':True,'role':'root' if m['id']==d['root'] else 'worker','status':statuses[m['id']],
            'prerequisites':len(deps),'counts':counts,'dependencies_satisfied':allowed,
            'authority':'historical owner acceptance only; no peer data or action authority'}
    binding=dependency_binding(d,deps,proofs) if allowed else None
    return public,binding,statuses


def status(c,m):
    d=definition(c,m)
    if d is None:return None,None
    public,binding,_=evaluate(c,m,d)
    return public,binding


def gate(c,m):
    public,binding=status(c,m)
    require(public is None or public['dependencies_satisfied'],'organization prerequisites not owner-accepted; inspect mission_workflow')
    return binding


def dispatchable(c,m):
    try:gate(c,m);return True
    except (ValueError,PermissionError,TypeError,KeyError):return False


def prohibit_reviewers(c,mids):
    # A collective reviewer must remain actively leased while its lead closes.
    # Requiring that reviewer to close as a predecessor would deadlock. Keep
    # graph members out of reviewer roles; allow external reviewers for a member.
    from collective import panel
    rows=c.db.execute("SELECT DISTINCT m.id FROM continuity_missions m JOIN continuity_events e ON e.mission=m.id WHERE m.phase NOT IN ('closed','cancelled') AND e.kind='collective_set' LIMIT 1025").fetchall()
    require(len(rows)<=1024,'too many active panel candidates; owner review required')
    for row in rows:
        spec=panel(c,c._mission(row['id']))
        require(spec is None or not any(r['id'] in mids for r in spec['reviewers']),'organization members cannot be active collective reviewers')


def route(c,p,path,b):
    m=c._mission(b.get('id'));owner=p['role']=='owner';agent=p['role']=='agent'
    if agent and path=='/v1/continuity/workflow':
        fields(b,'id');c._authorize(p,m)
        public,_=status(c,m)
        return public or {'schema':SCHEMA,'member':False,'dependencies_satisfied':True}
    if not owner:raise PermissionError('organization route unavailable to credential')
    if path.endswith('/get'):
        fields(b,'id');d=definition(c,m)
        if d is None:return {'schema':SCHEMA,'member':False}
        public,_,states=evaluate(c,m,d)
        return public|{'root':d['root'],'graph_sha256':d['digest'],'nodes':[{'id':mid,'requires':d['graph'][mid],'status':states[mid],'revision':c._mission(mid)['revision'],'agent':c._mission(mid)['agent']} for mid in d['order']]}
    if path.endswith('/set'):
        fields(b,'id request_id nodes');req=c._replay(p,b,'organization_set')
        if isinstance(req,dict):return req
        graph,ordered=order_graph(m['id'],b['nodes']);revs={n['id']:n['expected_revision'] for n in b['nodes']}
        for mid in ordered:
            row=c._mission(mid);c._rev(row,revs[mid]);require(row['world']==m['world'] and row['phase']=='assigned' and row['lease_hash'] is None and row['lease_epoch']==0 and link(c,row) is None,'organization requires unused, unleased same-world missions')
            require(c._evidence_ok(row),'organization member evidence unavailable')
        prohibit_reviewers(c,set(ordered))
        nodes=[{'id':mid,'requires':graph[mid],'expected_revision':revs[mid]} for mid in ordered]
        rev=m['revision']+1;digest=sha(canonical([m['id'],m['world'],rev,nodes]))
        root=c._event(m,'organization_set',p['id'],{'nodes':nodes,'digest':digest})
        for mid in ordered:
            row=c._mission(mid);current=c._event(row,'organization_joined',p['id'],{'root':m['id'],'graph':digest,'revision':rev})
            if mid==m['id']:root=current
        return c._record(p,root,req)
    raise PermissionError('organization route unavailable')
