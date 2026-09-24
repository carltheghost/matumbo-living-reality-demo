const DEFAULT_IDS=Object.freeze({left:'contract-atelier',right:'agent',center:'arena',lowerLeft:'rooms',lowerRight:'youtube'});
const SLOTS=Object.freeze([
  Object.freeze({role:'left',position:Object.freeze([-3.6,1.85,-5.7]),size:.92}),
  Object.freeze({role:'right',position:Object.freeze([3.6,1.85,-5.7]),size:.92}),
  Object.freeze({role:'center',position:Object.freeze([0,0,-5]),size:1.42}),
  Object.freeze({role:'lowerLeft',position:Object.freeze([-3.6,-1.85,-5.7]),size:.92}),
  Object.freeze({role:'lowerRight',position:Object.freeze([3.6,-1.85,-5.7]),size:.92}),
]);

function normalizedId(value){return String(value??'').trim().toLowerCase();}

/**
 * Resolve the lightweight, five-object Living Reality composition. Every lens
 * is an ordinary feature object in the existing Three.js scene; there are no
 * per-lens canvases, render targets, DOM panels, or independent clocks.
 */
export function resolveUniversalLensLayout(features=[],search=''){
  const params=new URLSearchParams(String(search??''));
  const requested=Object.fromEntries(Object.keys(DEFAULT_IDS).map(role=>[
    role,params.get(role)??params.get(role.toLowerCase())??DEFAULT_IDS[role],
  ]));
  const explicitlyRequested=params.get('model')==='one-universe-v1'
    ||params.get('feature')==='arena'
    ||SLOTS.some(({role})=>params.has(role)||params.has(role.toLowerCase()));
  if(!explicitlyRequested)return Object.freeze({active:false,model:null,centerId:null,ids:Object.freeze([]),lenses:Object.freeze([])});

  const byId=new Map((features??[]).filter(feature=>feature?.id).map(feature=>[normalizedId(feature.id),feature]));
  const used=new Set(),lenses=[];
  for(const slot of SLOTS){
    let feature=byId.get(normalizedId(requested[slot.role]));
    if(!feature||used.has(feature.id)){
      feature=[...byId.values()].find(candidate=>!used.has(candidate.id)&&candidate.id!=='block-world');
    }
    if(!feature)continue;
    used.add(feature.id);
    lenses.push(Object.freeze({role:slot.role,id:feature.id,label:feature.label??feature.id,
      position:Object.freeze([...slot.position]),shape:'sphere',size:slot.size}));
  }
  const center=lenses.find(lens=>lens.role==='center')??lenses[0]??null;
  return Object.freeze({active:lenses.length===5,model:'one-universe-v1',centerId:center?.id??null,
    ids:Object.freeze(lenses.map(lens=>lens.id)),lenses:Object.freeze(lenses)});
}
