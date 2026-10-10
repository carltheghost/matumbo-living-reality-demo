import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {
  FEATURE_REAL_FEEDS,
  contractEntitiesFromRecords,
  entitiesForFeature,
  inferProjectionEntityKind,
  projectionEntitiesForFeature,
  resolveRealFeatureFeed,
} from '../src/render/universal-reality-bridge.js';
import { createUniversalObjectRenderer } from '../src/universal/universal-object-renderer.js';
import { FEATURE_DEFINITIONS } from '../src/render/feature-navigator.js';

test('every current Reality Lens feature has a declared real-data feed',()=>{
  const ids=FEATURE_DEFINITIONS.map(feature=>feature.id);
  const missing=ids.filter(id=>!FEATURE_REAL_FEEDS[id]?.length);
  assert.deepEqual(missing,[]);
});

test('real-domain snapshots are never frozen or adopted as renderer-owned state',()=>{
  const liveRecord={id:'live-1',label:'Mutable domain record',status:'ready'};
  const liveSnapshot={status:'ready',records:[liveRecord]};
  const scope={__TUMBO_ACADEMY__:{getSnapshot:()=>liveSnapshot}};
  const entities=entitiesForFeature({
    feature:{id:'academy',label:'Academy'},
    featureId:'academy',
    projection:{entities:[]},
    selected:true,
    scope,
  });
  assert.ok(entities.length>=1);
  assert.equal(Object.isFrozen(liveSnapshot),false);
  assert.equal(Object.isFrozen(liveRecord),false);
  liveRecord.status='updated';
  assert.equal(liveRecord.status,'updated');
});

test('real feature snapshots outrank catalog fallback data',()=>{
  const scope={
    __TUMBO_ACADEMY__:{
      getSnapshot:()=>({
        status:'learning',
        selectedRecord:{id:'lesson-7',kind:'artifact',label:'Orbital Energy',progress:72},
        lessons:[{id:'lesson-7',kind:'artifact',label:'Orbital Energy',progress:72}],
        completed:4,
      }),
    },
  };
  const feed=resolveRealFeatureFeed('academy',scope);
  assert.equal(feed.available,true);
  assert.equal(feed.sourceName,'__TUMBO_ACADEMY__');
  const entities=entitiesForFeature({
    feature:{id:'academy',label:'Academy',description:'Knowledge object'},
    featureId:'academy',
    projection:{entities:[]},
    selected:true,
    scope,
  });
  assert.equal(entities[0].id,'academy:live');
  assert.ok(entities[0].provenance.includes('real-data'));
  assert.equal(entities[0].status,'learning');
  assert.ok(entities.length>=2);
});

test('nested real feeds such as Bot Plaza console are resolved without renderer-specific code',()=>{
  const scope={
    __TUMBO_BOT_PLAZA__:{
      console:{getSnapshot:()=>({status:'advisory',agents:[{id:'bot-1',kind:'agent',label:'Builder'}]})},
    },
  };
  const feed=resolveRealFeatureFeed('bot-plaza',scope);
  assert.equal(feed.available,true);
  assert.equal(feed.sourceName,'__TUMBO_BOT_PLAZA__.console');
  const entities=entitiesForFeature({
    feature:{id:'bot-plaza',label:'Bot Plaza'},
    featureId:'bot-plaza',
    projection:{entities:[]},
    selected:true,
    scope,
  });
  assert.equal(entities[0].status,'advisory');
  assert.ok(entities.some(entity=>entity.kind==='bot'));
});

test('contract records become contract + Covenant Slip + contractor anatomy',()=>{
  const contract={
    id:'c-1',
    title:'Build the bridge',
    status:'active',
    parties:['Tumbo','Builder'],
    approvals:[{actor:'Tumbo'}],
    terms:{rules:[
      {id:'r1',label:'Deliver structure',when:{op:'all'}},
      {id:'r2',label:'Attach evidence',when:{op:'all'}},
    ]},
    evidence:[{id:'e1',source:'local'}],
    receipts:[{
      id:'receipt-1',
      evidenceIds:['e1'],
      effects:[{type:'record'}],
    }],
  };
  const entities=contractEntitiesFromRecords([contract],'c-1');
  assert.deepEqual(entities.map(entity=>entity.kind),['contract','slip','contractor']);
  assert.equal(entities[0].title,'Build the bridge');
  assert.equal(entities[1].title,'Covenant Slip');
  assert.equal(entities[1].metrics.evidence,1);
  assert.equal(entities[2].metrics.parties,2);
  assert.ok(entities[0].content.some(block=>block.id==='rule-r1'));
});

test('shared projection records map into semantic domain kinds',()=>{
  assert.equal(inferProjectionEntityKind({kind:'contract-receipt'}),'slip');
  assert.equal(inferProjectionEntityKind({type:'person-profile'}),'person');
  assert.equal(inferProjectionEntityKind({kind:'neural-relationship',label:'agent link'}),'bot');
  const projection={entities:[
    {id:'room:1',kind:'room',label:'Private room'},
    {id:'message:1',kind:'message',label:'Ciphertext message'},
    {id:'ledger:1',kind:'ledger-entry',label:'Journal entry'},
  ]};
  assert.deepEqual(
    projectionEntitiesForFeature('rooms',projection).map(record=>record.id),
    ['room:1','message:1'],
  );
  assert.deepEqual(
    projectionEntitiesForFeature('ledger',projection).map(record=>record.id),
    ['ledger:1'],
  );
});

test('all fallback feature objects still receive a universal entity',()=>{
  const entities=entitiesForFeature({
    feature:{id:'academy',label:'Academy',description:'Knowledge object'},
    featureId:'academy',
    projection:{entities:[]},
    selected:false,
    scope:{},
  });
  assert.equal(entities.length,1);
  assert.equal(entities[0].id,'assembly:academy:academy');
  assert.ok(entities[0].geometryFamily);
});

test('selected features can expand into multiple object-native companions',()=>{
  const entities=entitiesForFeature({
    feature:{id:'agent',label:'Agent',description:'Bounded assistant'},
    featureId:'agent',
    projection:{entities:[]},
    selected:true,
    scope:{},
  });
  assert.deepEqual(entities.map(entity=>entity.kind),['bot','slip','proof']);
});

test('universal renderer puts semantic information on the mesh, not a child card mesh',()=>{
  const renderer=createUniversalObjectRenderer({atlasSize:256,enableDisplacement:false});
  const rendered=renderer.create({
    id:'contract:test',
    kind:'contract',
    title:'Living Contract',
    status:'active',
    metrics:{conditions:4,approvals:'2/2',evidence:3},
  });
  assert.equal(rendered.mesh.children.length,0);
  assert.ok(rendered.surface.regions.length>=2);
  assert.ok(rendered.surface.topologySummary.cells>=1);
  assert.ok(rendered.mesh.material?.isMeshPhysicalMaterial||Array.isArray(rendered.mesh.material));
  rendered.mesh.updateMatrixWorld(true);
  renderer.tick({camera:new THREE.PerspectiveCamera(50,1,.1,100),viewportHeight:720,time:1000});
  renderer.dispose();
});

test('live index loads the universal bridge after main and the bridge is Reality-Lens scoped',async()=>{
  const [html,bridge]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('../src/render/universal-reality-bridge.js',import.meta.url),'utf8'),
  ]);
  const mainIndex=html.indexOf('./src/main.js?v=20260924-aspectus1');
  const bridgeIndex=html.indexOf('./src/render/universal-reality-bridge.js?v=20260924-universal-live1');
  assert.ok(mainIndex>=0);
  assert.ok(bridgeIndex>mainIndex);
  assert.match(bridge,/params\.get\('feature'\)!==ROUTE_FEATURE/);
  assert.match(bridge,/__TUMBO_REALITY_ASSEMBLY__/);
  assert.match(bridge,/__TUMBO_CONTRACT_LEDGER__/);
  assert.match(bridge,/__TUMBO_CONTRACT_ATELIER__/);
  assert.match(bridge,/simfabric:projection/);
  assert.match(bridge,/setFeatureEntities/);
  assert.match(bridge,/universal-organism/);
});

test('Block World remains preserved by the universal bridge',async()=>{
  const bridge=await readFile(new URL('../src/render/universal-reality-bridge.js',import.meta.url),'utf8');
  assert.match(bridge,/SPECIAL_PRESERVE=new Set\(\['block-world'\]\)/);
  assert.match(bridge,/if\(preserveFeature\(featureId\)\)/);
});
