import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LocalLeaseWorld,MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';
import {studioCommitCommand} from '../../contracts/studio-binding.mjs';
import {phaseWorkshopSeed} from '../../server/application/seed.mjs';

const ROOT=fileURLToPath(new URL('../../../../',import.meta.url));
function initializePhase(snapshot) {
  const source="import json,sys\nfrom services.vivo.server.application.material_host import initialize_phase\nprint(json.dumps(initialize_phase(json.load(sys.stdin))))\n";
  const result=spawnSync('python',['-c',source],{cwd:ROOT,env:{...process.env,PYTHONPATH:ROOT},input:JSON.stringify(snapshot),encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}

test('material-covered Studio binding cannot bypass the phase authority',async()=>{
  const initialized=initializePhase(phaseWorkshopSeed()),store=new MemoryAuthorityStore();
  const world=await LocalLeaseWorld.create({snapshot:initialized.snapshot,store,materialProtocol:'vivo.lease-material/1',
    materialInitial:{spaceId:'root',checkpoint:initialized.checkpoint}});
  const actor=world.attach({actorId:'studio.material-boundary'});await actor.open();
  const snapshot=actor.getSnapshot(),binding=snapshot.studioBindings['studio.node.echo'],entity=snapshot.spaces.root.entities.relic,before=world.checkpoint();
  const receipt=await actor.submit(studioCommitCommand(snapshot,[0,0,0,0],{bindingId:binding.bindingId,metadata:binding.metadata,
    commandId:'studio.material.boundary.memory',expectedBindingRevision:binding.bindingRevision,expectedEntityRevision:entity.revision}));
  assert.equal(receipt.status,'rejected');assert.equal(receipt.code,'STUDIO_MATERIAL_BOUNDARY');
  assert.deepEqual(world.checkpoint(),before);
  await actor.close();
});
