import {REALITY_TAB_FORMS} from '../domains/reality-tab-layout.js';
import {createContractWorldContribution} from '../domains/contract-world-projection.js';

export const CONTRACT_MATERIALS = Object.freeze({pending_approval:'#b59b69',active:'#75bac0',paused:'#cbab69',disputed:'#cc8277',completed:'#80b5a0',cancelled:'#77828c',expired:'#8d859d'});

/** Geometry is a read-only anatomy of the selected canonical contract.
 * Side folds = conditions, clasps = approvals, lower facets = receipts.
 * It is attached to the owning body's coordinates and has no idle animation. */
export function createContractOrganism({three:THREE,getObject}) {
  const group = new THREE.Group(); group.name = 'Contract organism · conditions / approvals / receipts';
  const box = new THREE.BoxGeometry(1,1,1);
  const gem = new THREE.OctahedronGeometry(1,0);
  const materials = [];
  let threadGeometry=null;
  let revision = '', host = null;
  function material(color) {
    const value = new THREE.MeshStandardMaterial({color,roughness:.8,metalness:.16});
    materials.push(value); return value;
  }
  function solid(geometry,mat,position,size,rotation=0) {
    const mesh = new THREE.Mesh(geometry,mat);
    mesh.position.set(...position);mesh.scale.set(...size);mesh.rotation.z=rotation;
    group.add(mesh);return mesh;
  }
  function sync(snapshot,selectedId) {
    const target=getObject?.('contract-atelier');
    if(!target)return false;
    if(host!==target.root){group.removeFromParent();target.root.add(group);host=target.root;revision='';}
    const contract=snapshot?.contracts?.find(item=>item.id===selectedId)??snapshot?.contracts?.at(-1);
    const shape=target.shape??'rectangle';
    const next=JSON.stringify([shape,contract?.id,contract?.status,contract?.approvals,contract?.evidence,contract?.receipts,contract?.evaluation?.rules]);
    if(next===revision)return false;revision=next;
    group.clear();materials.splice(0).forEach(item=>item.dispose());
    threadGeometry?.dispose();threadGeometry=null;
    group.visible=Boolean(contract);
    if(!contract)return true;
    group.userData={contractId:contract.id,status:contract.status,simulation:true,ruleIds:contract.terms.rules.map(rule=>rule.id)};
    const form=REALITY_TAB_FORMS[shape]??REALITY_TAB_FORMS.rectangle;
    const halfW=form.width*.48,halfH=form.height*.45,z=Math.max(form.depth*.18,.06);
    const state=material(CONTRACT_MATERIALS[contract.status]??'#8a999b');
    const dormant=material('#3b474e'),complete=material('#80b5a0'),edge=material('#b99a69');
    const points=new Map([[contract.id,new THREE.Vector3(0,0,-form.depth*.2)]]);
    // Folded term leaves deliberately flank the reading facet, not its controls.
    contract.terms.rules.slice(0,16).forEach((rule,index)=>{
      const side=index%2===0?-1:1,row=Math.floor(index/2);
      const done=contract.evaluation?.rules?.find(item=>item.id===rule.id)?.state==='done';
      const rows=Math.ceil(Math.min(contract.terms.rules.length,16)/2);
      const spacing=Math.min(.32,halfH*1.4/Math.max(1,rows-1));
      const y=(rows-1)*spacing/2-row*spacing;
      const leaf=solid(box,done?complete:state,[side*halfW,y,z],[.15,.25,.12],side*.25);
      const entityId=`${contract.id}:rule:${rule.id}`;
      leaf.userData={entityId,contractId:contract.id,ruleId:rule.id,complete:done};points.set(entityId,leaf.position);
      solid(box,edge,[side*(halfW+.055),y-.11,z+.02],[.11,.055,.16],side*.25);
    });
    const approvals=contract.approvals??[];
    contract.parties.slice(0,16).forEach((party,index)=>{
      const approved=approvals.some(entry=>entry.actor===party);
      const x=(index-(contract.parties.length-1)/2)*Math.min(.24,form.width/(contract.parties.length+1));
      const clasp=solid(box,approved?complete:dormant,[x,halfH,z],[.15,.095,approved?.17:.09]);
      const entityId=`${contract.id}:party:${party}`;
      clasp.userData={entityId,party,approved};points.set(entityId,clasp.position);
    });
    // Evidence enters through upper shoulder ports, not flashing decorations.
    // Each socket is a declared source. Small faceted beads are observations.
    const sources=(contract.terms.sources??[]).slice(0,8);
    sources.forEach((source,index)=>{
      const x=(index-(sources.length-1)/2)*Math.min(.25,form.width/(sources.length+1));
      const entityId=`${contract.id}:source:${source.id}`;
      const socket=solid(gem,edge,[x,halfH+.16,z],[.085,.08,.07]);
      socket.userData={entityId,sourceId:source.id};points.set(entityId,socket.position);
    });
    (contract.evidence??[]).slice(-8).forEach((observation,index,list)=>{
      const x=(index-(list.length-1)/2)*Math.min(.22,form.width/(list.length+1));
      const entityId=`${contract.id}:evidence:${observation.id}`;
      const bead=solid(gem,state,[x,-halfH-.17,z],[.055,.06,.055]);
      bead.userData={entityId,evidenceId:observation.id};points.set(entityId,bead.position);
    });
    contract.receipts.slice(-12).forEach((receipt,index,list)=>{
      const x=(index-(list.length-1)/2)*Math.min(.22,form.width/(list.length+1));
      const relic=solid(gem,complete,[x,-halfH,z],[.095,.12,.06]);
      const entityId=`${contract.id}:receipt:${receipt.id}`;
      relic.userData={entityId,receiptId:receipt.id};points.set(entityId,relic.position);
    });
    const graph=createContractWorldContribution({contracts:[contract]});
    const visibleEdges=graph.relationships.filter(link=>points.has(link.from)&&points.has(link.to));
    if(visibleEdges.length){
      // Threads are recessed into the body. The text/controls stay unobstructed.
      const vertices=[];
      for(const link of visibleEdges){
        const a=points.get(link.from),b=points.get(link.to),back=-Math.max(.08,form.depth*.25);
        vertices.push(a.x,a.y,a.z,a.x,a.y,back,a.x,a.y,back,b.x,b.y,back,b.x,b.y,back,b.x,b.y,b.z);
      }
      threadGeometry=new THREE.BufferGeometry();threadGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      const threadMaterial=new THREE.LineBasicMaterial({color:'#81aaa6',transparent:true,opacity:.55,depthWrite:false});materials.push(threadMaterial);
      const threads=new THREE.LineSegments(threadGeometry,threadMaterial);threads.name='Stored contract relationships';
      threads.userData={relationshipIds:visibleEdges.map(link=>link.id),source:'contract-organism'};group.add(threads);
    }
    Object.assign(group.userData,{relationshipCount:visibleEdges.length,relationshipIds:visibleEdges.map(link=>link.id),hiddenRuleCount:Math.max(0,contract.terms.rules.length-16),hiddenSourceCount:Math.max(0,(contract.terms.sources?.length??0)-8)});
    return true;
  }
  return {sync,getSnapshot:()=>({...group.userData,meshCount:group.children.filter(child=>child.isMesh).length,attached:Boolean(host),idleAnimation:false}),destroy(){group.removeFromParent();box.dispose();gem.dispose();threadGeometry?.dispose();materials.forEach(item=>item.dispose());}};
}
