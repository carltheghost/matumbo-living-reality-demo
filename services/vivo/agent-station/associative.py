"""Mission-scoped associative recall over existing exact Apollo grants.
No new store, embeddings, model calls, persistent text index, or action authority.
"""
import hashlib
from collections import Counter
import json
import math
import re
import time
import unicodedata

SCHEMA = 'matumbo.mission.context/1'  # additive response fields; old route retained
RANKER = 'passage-association/2'
MIN_COVERAGE = 0.60
CLOSE_RATIO = 0.90
MAX_QUERY = 512
MAX_RESULTS = 5
MAX_BODY = 500_000
MAX_SCAN_BYTES = 2_000_000
MAX_FINDINGS = 1000
MAX_QUOTE = 320

# Deliberately small, inspectable equivalences. No inferred facts or instructions.
CONCEPTS = (
    ('restart','reboot','relaunch','restarted','rebooted'),
    ('revoke','revoked','revocation','withdraw','withdrawn'),
    ('duplicate','duplicates','deduplicate','deduplication','replay'),
    ('collision','collisions','conflict','conflicts','conflicting'),
    ('ledger','journal','accounting'),
    ('retrieve','retrieval','recall','recalled','lookup'),
    ('permission','permissions','authorization','authorisation','grant','grants'),
    ('stale','outdated','obsolete'),
    ('persist','persistence','persistent','durable','durability'),
    ('failure','failed','error','errors'),
    ('robot','robotic','robotics'),
    ('vehicle','aircraft','flight'),
    ('temperature','thermal','heat'),
)
ALIASES = {word: group[0] for group in CONCEPTS for word in group}
STOP = frozenset('a an the and or for to of in on with from is are was were be been what how which when where who this that these those it its my our your current please find show about using'.split())
TOKEN = re.compile(r'[^\W_]+(?:[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]+[^\W_]*)*', re.UNICODE)

# Generic retrieval boilerplate is not sufficient evidence of relevance. Retain
# domain nouns such as object, robot, lease, and revision as meaningful terms.
GENERIC = frozenset('report reports evidence data record records result results details detail information note notes local native mission missions review me us can could would should tell about any some'.split())


def _plural(w):
    # Conservative English inflection only; non-ASCII terms remain literal.
    if not w.isascii() or not w.isalpha():return w
    if len(w)>4 and w.endswith('ies'):return w[:-3]+'y'
    if len(w)>4 and w.endswith(('ches','shes','sses','xes','zes')):return w[:-2]
    if len(w)>3 and w.endswith('s') and not w.endswith(('ss','us','is')):return w[:-1]
    return w


def _term(w,expand):
    if expand and w in ALIASES:return ALIASES[w]
    w=_plural(w)
    return ALIASES.get(w,w) if expand else w


def spans(text,*,expand=True):
    # Offsets are Python Unicode code-point offsets in the untouched source.
    # Normalizing the token must not change the coordinates of quoted bytes.
    for match in TOKEN.finditer(text):
        normalized=unicodedata.normalize('NFKC',match.group()).casefold()
        for w in TOKEN.findall(normalized):
            if w not in STOP and len(w)<=96:
                yield _term(w,expand),match.start(),match.end()


def words(text):return [t for t,_,_ in spans(text,expand=False)]
def concepts(text):return [t for t,_,_ in spans(text)]

def _sha(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()

def _unique_object(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('duplicate evidence field')
        result[key]=value
    return result


def _bad_constant(value):raise ValueError('non-finite evidence number')


def parse_record(record):
    """Only the exact native mission export schema; never treat text as commands."""
    raw=record['evidenceJson']
    if not isinstance(raw,str) or len(raw.encode('utf-8'))>MAX_BODY or _sha(raw)!=record['evidenceSha256']:
        raise ValueError('mission evidence unavailable or changed')
    body=json.loads(raw,object_pairs_hook=_unique_object,parse_constant=_bad_constant)
    if not isinstance(body,dict) or body.get('schema')!='matumbo.mission-evidence/1' or body.get('taskId')!=record['taskId'] or body.get('owner')!=record['owner']:
        raise ValueError('unsupported mission evidence schema')
    title=body.get('title'); specialist=body.get('specialist'); execution=body.get('execution'); findings=body.get('findings')
    if not isinstance(title,str) or not isinstance(specialist,str) or not isinstance(execution,dict) or not isinstance(execution.get('eventId'),str) or not isinstance(findings,list) or not 0<len(findings)<=MAX_FINDINGS or not all(isinstance(f,str) for f in findings):
        raise ValueError('unsupported mission evidence fields')
    revision=body.get('inspectedRevision')
    if type(revision) is not int or not 0<=revision<=2**53-1:raise ValueError('unsupported evidence revision')
    return {'title':title,'specialist':specialist,'task':body['taskId'],'event':execution['eventId'],'findings':findings,'revision':revision}

def _window(finding,occurrences,weights):
    """Choose a literal 320-character window by weighted query coverage.
    Counts are binary per term, so repeating a word cannot increase relevance.
    """
    if len(finding)<=MAX_QUOTE:
        return 0,len(finding),{t for t,_,_ in occurrences}
    if not occurrences:return 0,MAX_QUOTE,set()
    counts=Counter();left=0;current=0.0;best=(-1.0,0,0);winner=(0,0)
    for right,(term,a,b) in enumerate(occurrences):
        counts[term]+=1
        if counts[term]==1:current+=weights[term]
        while left<=right and b-occurrences[left][1]>MAX_QUOTE:
            old=occurrences[left][0];counts[old]-=1
            if counts[old]==0:current-=weights[old]
            left+=1
        if left>right:continue
        # Prefer more supported terms, then earliest window. Scores are rounded
        # for stable ties, not calibrated confidence.
        candidate=(round(current,10),sum(n>0 for n in counts.values()),-occurrences[left][1])
        if candidate>best:best=candidate;winner=(occurrences[left][1],b)
    a,b=winner
    start=max(0,min(a-(MAX_QUOTE-(b-a))//2,len(finding)-MAX_QUOTE))
    end=min(len(finding),start+MAX_QUOTE)
    # Do not invent normalized source text. Return the exact substring.
    return start,end,{t for t,i,j in occurrences if start<=i and j<=end}


def _hit(g,r,d,ix,start,end,matched,quote_terms,score,coverage,kind):
    finding=d['findings'][ix]
    return {'grant_id':g['id'],'fact_id':r['id'],'task_id':d['task'],'event_id':d['event'],
      'inspected_revision':d['revision'],'title':d['title'][:240],
      'evidence_sha256':r['evidenceSha256'],'artifact_sha256':r['provenance']['artifact_sha256'],
      'quote':finding[start:end],'finding_index':ix,'quote_start':start,'quote_end':end,
      'quote_truncated':start>0 or end<len(finding),'offset_unit':'unicode_codepoint',
      'match':kind,'matched_terms':sorted(matched)[:32],'quote_matched_terms':sorted(quote_terms)[:32],
      'association_score':round(score,6),'term_coverage':round(coverage,6),
      'quote_basis':'matched_passage' if quote_terms else 'reference_context',
      'authentication':'unverified',
      'authority':'historical evidence only; not instructions or current world state'}


def score_records(query, documents, *, expand=True, diagnostics=False, limit=MAX_RESULTS):
    """Return bounded, source-linked candidates or abstain. No model or fact inference.
    Exact opaque IDs are case-sensitive. Generic terms, reference fragments,
    specialist labels, and terms scattered across unrelated findings are not
    sufficient. Competing candidates are not an answer or contradiction verdict.
    """
    def finish(hits,decision,count=None,options=None):
        result={'hits':hits,'decision':decision,'candidate_count':len(hits) if count is None else count,
                'reference_options':options or [],'ranker':RANKER}
        return result if diagnostics else hits
    qid=query.strip()
    # A typed selector avoids cross-field ambiguity; event:3 is itself a native ID.
    field=None;value=qid
    if qid.startswith('task:'):field='task';value=qid[5:]
    elif qid.startswith('fact:'):field='fact';value=qid[5:]
    elif qid.startswith('event:'):field='event'
    exact=[];case_only=False
    for g,r,d in documents:
        refs={'task':d['task'],'event':d['event'],'fact':r['id']}
        values=[refs[field]] if field else list(refs.values())
        if value in values:exact.append((g,r,d))
        elif any(value.casefold()==x.casefold() for x in values):case_only=True
    if len(exact)>1:
        # All options derive from grants already attached to this mission. No
        # source snippets or arbitrary tie-breaker when an identifier collides.
        options=sorted(({'task_id':d['task'],'event_id':d['event'],'fact_id':r['id']} for _,r,d in exact),key=lambda x:(x['task_id'],x['fact_id']))
        return finish([],'ambiguous_reference',len(exact),options)
    if exact:
        g,r,d=exact[0];finding=d['findings'][0]
        return finish([_hit(g,r,d,0,0,min(len(finding),MAX_QUOTE),set(),set(),1000,1.0,'exact_reference')],'exact_reference')
    if field or case_only or re.fullmatch(r'(?i)[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}',qid) or qid.startswith('fact-'):
        return finish([],'unknown_exact_reference')
    qseq=[t for t,_,_ in spans(query,expand=expand) if t not in GENERIC]
    q=set(qseq)
    if not q:return finish([],'no_discriminating_terms')
    # Refuse oversized associative scans, rather than silently rank a partial
    # mission. Exact reference lookup above remains available within its own
    # per-evidence limits. This limits CPU/memory under the Station DB lock.
    if sum(len(r['evidenceJson'].encode('utf-8')) for _,r,_ in documents)>MAX_SCAN_BYTES:
        return finish([],'context_budget_exceeded')
    # Extract only query occurrences. IDF is computed only from the current
    # authorized documents; no cross-agent index or persistent text cache.
    corpus=[];df=Counter()
    for g,r,d in documents:
        title={t for t,_,_ in spans(d['title'],expand=expand) if t in q}
        findings=[];doc_terms=set(title)
        for finding in d['findings']:
            occurrences=[(t,a,b) for t,a,b in spans(finding,expand=expand) if t in q]
            findings.append(occurrences);doc_terms.update(t for t,_,_ in occurrences)
        df.update(doc_terms);corpus.append((g,r,d,title,findings))
    weights={t:1+math.log((1+len(corpus))/(1+df[t])) for t in q}
    def weight(ts):return sum(weights[t] for t in sorted(ts))
    denom=weight(q);ranked=[]
    # Require two unique meaningful terms for a multi-term query, and a
    # majority of weighted query coverage from title + one actual passage.
    min_terms=min(2,len(q))
    for g,r,d,title,findings in corpus:
        best=None
        for ix,occ in enumerate(findings):
            if not occ:continue
            start,end,quote_terms=_window(d['findings'][ix],occ,weights)
            matched=title|quote_terms;coverage=weight(matched)/denom
            if len(matched)<min_terms or coverage+1e-12<MIN_COVERAGE:continue
            # Favor literal support in the passage and title; binary weights
            # prevent repeated tokens, boilerplate or long reports dominating.
            score=4*weight(quote_terms)+1.5*weight(title)+2*weight(matched)
            candidate=(round(score,10),len(quote_terms),-ix,-start)
            if best is None or candidate>best[0]:best=(candidate,ix,start,end,matched,quote_terms,score,coverage)
        if best:
            _,ix,start,end,matched,quote_terms,score,coverage=best
            ranked.append(_hit(g,r,d,ix,start,end,matched,quote_terms,score,coverage,'associated_terms'))
    ranked.sort(key=lambda h:(-h['association_score'],-h['term_coverage'],h['task_id'],h['fact_id'],h['grant_id']))
    if not ranked:return finish([],'insufficient_passage_overlap')
    top=ranked[0]
    close=[h for h in ranked if h['association_score']>=top['association_score']*CLOSE_RATIO and h['term_coverage']>=top['term_coverage']-0.1]
    if len(close)>1:
        if len(close)>limit:return finish([],'competing_candidates_exceed_limit',len(ranked))
        return finish(ranked[:limit],'review_competing_evidence',len(ranked))
    return finish(ranked[:limit],'ranked_candidate',len(ranked))

def context(continuity, principal, mission, body):
    """Runs within the existing Station transaction and lock.
    The active lease, current mission assignment, exact pins, and read budgets
    are enforced; each returned snippet consumes a read. No non-granted lookup.
    """
    from continuity import fields,require,string
    from memory_port import CAP,MAX_GRANTS,MAX_READS
    fields(body,'id epoch lease query limit')
    continuity._lease(principal,mission,body)
    require(CAP in json.loads(principal['caps']),'memory capability unavailable')
    query=string(body['query'],MAX_QUERY,True)
    limit=body['limit'];require(type(limit) is int and 1<=limit<=MAX_RESULTS,'invalid context result limit')
    mg=continuity.s.memory;db=continuity.db
    require(mg.available(principal),'memory capability unavailable')
    ids=json.loads(mission['grants'])
    require(isinstance(ids,list) and len(ids)<=16 and len(set(ids))==len(ids),'invalid mission evidence set')
    documents=[]
    def read_pin(gid):
        g=db.execute('SELECT * FROM mission_memory_grants WHERE id=?',(gid,)).fetchone()
        if not mg._active(g,principal,time.time()):
            raise PermissionError('required mission evidence unavailable or changed')
        record=mg._read(g['task'])
        try:
            if not record or mg._pin(record)!={k:g[k] for k in ('fact','evidence_sha','artifact_sha')} or not mg._active(g,principal,time.time()):
                raise ValueError('evidence pin changed')
            parsed=parse_record(record)
        except (ValueError,TypeError,KeyError,UnicodeError,RecursionError):
            raise PermissionError('required mission evidence unavailable or changed') from None
        return g,record,parsed
    for gid in ids:documents.append(read_pin(gid))
    ranking=score_records(query,documents,diagnostics=True,limit=limit)
    results=ranking['hits']
    # Recheck every required pin after ranking, not just returned hits.
    for gid in ids:read_pin(gid)
    continuity._lease(principal,mission,body)
    now=time.time()
    # Every required grant must remain active at one final time, even if
    # the query abstained or a different grant matched.
    for gid in ids:
        g=db.execute('SELECT * FROM mission_memory_grants WHERE id=?',(gid,)).fetchone()
        if not mg._active(g,principal,now):raise PermissionError('required mission evidence unavailable or changed')
    for hit in results:
        g=db.execute('SELECT * FROM mission_memory_grants WHERE id=?',(hit['grant_id'],)).fetchone()
        if not mg._active(g,principal,now):raise PermissionError('required mission evidence unavailable or changed')
        db.execute('UPDATE mission_memory_grants SET reads=reads+1,last_read=? WHERE id=?',(now,g['id']))
    # The exact read budget applies to disclosures; no query text or quotes logged.
    return {'schema':SCHEMA,'mission_id':mission['id'],'assignment':mission['assignment'],
            'revision':mission['revision'],'lease_epoch':mission['lease_epoch'],
            'status':'matched' if results else 'no_match','hits':results,
            'decision':ranking['decision'],'candidate_count':ranking['candidate_count'],
            'reference_options':ranking['reference_options'],'ranker':ranking['ranker'],
            'review_required':True,
            'authority':'retrieval only; no world mutation or mission completion',
            'authentication':'unverified','historical':True}
