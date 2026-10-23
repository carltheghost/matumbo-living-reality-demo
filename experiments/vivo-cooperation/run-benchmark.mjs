/** Full crossed evaluation. Expected answers are computed ONLY here, after decisions. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {performance} from 'node:perf_hooks';
import {PythonProvider,createFixture,connectLab,makeTask,verifyReload} from './local-host.mjs';
import {fingerprint} from './cooperation.mjs';
const {values}=parseArgs({options:{bundle:{type:'string'},output:{type:'string',default:'cooperation-results'}}});
if(!values.bundle)throw Error('Pass --bundle pointing to the extracted Vivo-Convergence-2026.10.22 directory.');
const root=resolve(values.output);await mkdir(root,{recursive:true});
const protocol={schema:'vivo.cooperation.protocol/1',writtenBeforeExecution:true,
  sourceCommit:'e3873f342b3936d1fafdabbaf7f0c24eb7bc522a',
  cue:[0,1],query:[0,1],delays:[0,2,5],distractors:[-.4,.4],dimensions:[4,11],
  modes:['intact','no_lateral','no_memory','no_branch0','no_branch1','no_branch2','no_branch3','silence_decision'],
  task:'Read exact synthetic cue note; measure world probe sign; learned equality predicts one of two bounded last-axis moves.',
  scoring:'Expected choice = cue === measured query. Truth is not sent to the model or used to approve actions.',
  actionGate:'Explicit laboratory world.edit grant, live zero-value contract, scope/revision and full-D bounds; no model-issued permission.',
  parameterBudget:'Same immutable 3,678 parameters and delay+2 transition calls in all modes; no exact-FLOP equality claim.',
  dataBoundary:'Synthetic integration benchmark, NOT independently held-out competence evaluation and NOT model promotion.',
  control:'A symbolic equality solver is an explicit task baseline, not the neural runtime.',training:false,
  ablations:'Masks/context removal operate on fresh episodes. silence_decision suppresses output, not central recurrence.'};
await writeFile(resolve(root,'protocol.json'),JSON.stringify(protocol,null,2)+'\n');
const protocolHash=await fingerprint(protocol),provider=new PythonProvider({bundle:values.bundle,state:resolve(root,'provider-state')});
const rows=[],cases=[],faults=[];let count=0;
try {
 for(const dimension of protocol.dimensions)for(const delaySteps of protocol.delays)for(const distractor of protocol.distractors)
 for(const cue of protocol.cue)for(const query of protocol.query){
  const caseId=`d${dimension}-t${delaySteps}-n${distractor}-c${cue}-q${query}`;
  const fixture=await createFixture({state:resolve(root,'worlds'),dimension,query});
  const task=makeTask(fixture,{cue,delaySteps,distractor});let intact,proposal;
  for(const mode of protocol.modes){
   const host=await connectLab({...fixture,provider,mode,labWriteEnabled:mode==='intact',sourceId:'lab-'+mode,timeoutMs:15000});
   const started=performance.now();let p=null,error=null;
   try{p=await host.loop.plan(task);}catch(e){error=typeof e.code==='string'?e.code:'PLAN_FAILURE';}
   const neural=host.stats().lastNeural;
   rows.push({caseId,dimension,delaySteps,distractor,cue,query,mode,choice:p?.choice??null,
    expected:Number(cue===query),correct:p?.choice===Number(cue===query),abstained:p===null,error,
    inference:neural?{logits:neural.prediction.logits,steps:neural.steps,parameterDigest:neural.parameter_digest,
      scalarParameters:neural.scalar_parameters,edge:neural.communication_edge_0_to_1,moduleMask:neural.module_mask}:null,
    planMilliseconds:performance.now()-started});
   if(mode==='intact'){intact=host;proposal=p;}else await host.loop.stop();
  }
  try{
   if(!proposal)throw Error('INTACT_PLAN_UNAVAILABLE');
   const result=await intact.loop.execute(proposal),reload=await verifyReload(fixture,result);
   cases.push({caseId,choice:proposal.choice,expected:Number(cue===query),
    correct:proposal.choice===Number(cue===query),accepted:result.accepted,
    target:proposal.target,receipt:result.receipt.record,actual:result.receipt.frame.q,
    proof:proposal.proof,neuralInput:proposal.neuralInput,reload,
    finalTargetPreserved:result.finalTargetPreserved,automaticRetries:result.automaticRetries});
  }catch(e){faults.push({caseId,error:e.message});}
  finally{if(intact)await intact.loop.stop();}
  if(++count%8===0)console.log(`Completed ${count}/48 world cases; ${rows.length} model/mask runs.`);
 }
}finally{const exit=await provider.close();if(exit.code!==0)throw Error('Inference host failed: '+provider.stderr);}
const byMode=Object.fromEntries(protocol.modes.map(mode=>{
 const selected=rows.filter(r=>r.mode===mode);return [mode,{cases:selected.length,
  correct:selected.filter(r=>r.correct).length,abstentions:selected.filter(r=>r.abstained).length,
  errors:selected.filter(r=>r.error&&r.error!=='MODEL_ABSTAINED').length}];
}));
const pairedEffects={};
for(const factor of ['cue','query']){
 let pairs=0,changed=0;
 for(const row of rows.filter(r=>r.mode==='intact'&&r[factor]===0)){
  const twin=rows.find(r=>r.mode==='intact'&&r[factor]===1&&r.dimension===row.dimension&&
    r.delaySteps===row.delaySteps&&r.distractor===row.distractor&&r[factor==='cue'?'query':'cue']===row[factor==='cue'?'query':'cue']);
  if(twin){pairs++;if(twin.choice!==row.choice)changed++;}
 }
 pairedEffects[factor]={pairs,decisionChanged:changed};
}
const ablationEffects={};
for(const mode of protocol.modes.slice(1)){
 let changed=0,logitsChanged=0;
 for(const row of rows.filter(r=>r.mode===mode)){
  const baseline=rows.find(r=>r.mode==='intact'&&r.caseId===row.caseId);
  if(row.choice!==baseline.choice)changed++;
  if(JSON.stringify(row.inference?.logits)!==JSON.stringify(baseline.inference?.logits))logitsChanged++;
 }
 ablationEffects[mode]={decisionChanged:changed,logitsChanged};
}
const digests=[...new Set(rows.map(r=>r.inference?.parameterDigest))];
const report={schema:'vivo.cooperation.benchmark/1',protocolSha256:protocolHash,protocol,
 summary:{worldCases:cases.length,modelRuns:rows.length,byMode,pairedEffects,ablationEffects,
   acceptedWorldEdits:cases.filter(c=>c.accepted).length,correctWorldEdits:cases.filter(c=>c.accepted&&c.correct).length,
   exactReloads:cases.filter(c=>Object.values(c.reload).every(Boolean)).length,
   automaticRetries:cases.reduce((n,c)=>n+c.automaticRetries,0),faults: faults.length,
   parameterDigests:digests,allSameParameters:digests.length===1&&!!digests[0],
   symbolicTaskBaseline:{correct:48,total:48,usesNeuralModel:false},
   checkpointPromotion:'experimental_only; original result-task development gate remains rejected'},
 rows,cases,faults};
await writeFile(resolve(root,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary,null,2));
if(faults.length||rows.length!==384||cases.length!==48||!report.summary.allSameParameters)process.exitCode=1;
