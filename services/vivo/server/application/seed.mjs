import {studioBindingRegistrySeed} from '../../contracts/studio-binding.mjs';

/** Fixed local workshop. Spatial coordinates are not a material simulation. */
export const WORLD_ID = 'vivo.local.workshop';
export const AUTHORITY_ID = 'vivo.local.authority';
export const LOCAL_SEATS = Object.freeze({one:'local.one', two:'local.two'});
export const ENTITY_COUNT = 4;

export function entryView(spaceId = 'root', dimension = 4) {
  const basis=Array.from({length:dimension}, (_,i)=>Array.from({length:dimension}, (_,j)=>Number(i===j)));
  if(dimension>=3) {
    const c=Math.cos(.55),s=Math.sin(.55),a=Math.cos(.68),b=Math.sin(.68);
    [[c,0,-s],[-b*s,a,-b*c],[a*s,b,a*c]].forEach((row,i)=>row.forEach((value,j)=>{basis[i][j]=value;}));
  }
  return {spaceId, chart:'flat', dimension, q:Array(dimension).fill(0),basis,
    slice:Object.fromEntries(Array.from({length:Math.max(0,dimension-3)}, (_,i)=>['x'+(i+4),0]))};
}

export function workshopSeed() {
  const entity = (id,spaceId,dimension,q,name,radius,innerSpaceId=null) => ({
    id,spaceId,dimension,chart:'flat',q:[...q],v:Array(dimension).fill(0),revision:0,
    name,radius,materialProfile:'unbound',fieldMembership:[],lineage:[],innerSpaceId
  });
  const space = (id,dimension,entities) => ({id,dimension,intrinsicDimension:dimension,
    atlasId:'flat',metricId:'euclidean',topologyId:'open',
    law:{id:'pending-material',version:'0'},modelHashes:[],
    field:{codec:'pending',handle:'pending.'+id,hash:'0'.repeat(64)},
    entryView:entryView(id,dimension),entities});
  return {schema:'vivo.snapshot/1',worldId:WORLD_ID,authorityId:AUTHORITY_ID,
    acceptedSequence:0,simulationTime:0,rootSpaceId:'root',stateHash:'0'.repeat(64),
    studioBindings:studioBindingRegistrySeed(),spaces:{
      root:space('root',4,{
        relic:entity('relic','root',4,[-1.2,-.15,.25,0],'Relic',.25),
        workpiece:entity('workpiece','root',4,[.15,.75,.25,0],'Workpiece',.3),
        portal:entity('portal','root',4,[1.35,-.15,.25,0],'Inner world',.35,'inner')
      }),
      inner:space('inner',11,{
        relic:entity('relic','inner',11,[0,0,.25,...Array(8).fill(0)],'Inner relic',.3)
      })
    }};
}

/** Explicit experimental phase mode; never migrate an unbound checkpoint. */
export function phaseWorkshopSeed(){
  const snapshot=workshopSeed(),space=snapshot.spaces.root;
  Object.assign(space,{atlasId:'atlas.periodic-cartesian.v1',metricId:'metric.flat-euclidean.v1',
    topologyId:'topology.periodic-torus.v1',law:{id:'vivo.phase.periodic-compliant',version:'1'}});
  space.field={codec:'vivo.material.phase/1',handle:'phase.root',hash:'0'.repeat(64)};
  for(const entity of Object.values(space.entities)){
    entity.materialProfile='phase';entity.fieldMembership=['field.'+entity.id];
  }
  return snapshot;
}


/** Learned graph material across the existing 4D root and 11D inner space. */
export function adaptiveWorkshopSeed(){
  const snapshot=workshopSeed(),model='9ab89f46361e397fe41845d86ecc23e38f75561032fd65ae9f8389e9780afdb0';
  for(const space of Object.values(snapshot.spaces)){
    space.law={id:'vivo.adaptive.graph',version:'1'};space.modelHashes=[model];
    space.field={codec:'vivo.material.adaptive-graph/1',handle:'adaptive.'+space.id,hash:'0'.repeat(64)};
    const ids=Object.keys(space.entities).sort();space.adaptiveEdges=ids.slice(0,-1).map((id,i)=>[id,ids[i+1]]);
    for(const entity of Object.values(space.entities)){entity.materialProfile='adaptive-graph';entity.fieldMembership=['field.'+space.id+'.'+entity.id];}
  }
  return snapshot;
}
