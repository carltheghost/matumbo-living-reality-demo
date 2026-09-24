import {createRealityTimeline} from './reality-timeline.js?v=20260924-wrapper-profiles1';
import {createRealityGraph} from './side-living-reality.js';

/**
 * Keep each navigable reality on its own local layout timeline while the graph
 * tracks parentage and explicit travel edges between those realities.
 */
export function createRealityWorkspace({objects,selectedId,rootId='reality:root',rootLabel='Living Reality',clock,now,shapeProfiles}={}){
  const timelineOptions={...(clock?{clock}:{}),...(shapeProfiles?{shapeProfiles:structuredClone(shapeProfiles)}:{})};
  const rootTimeline=createRealityTimeline({objects,selectedId,...timelineOptions});
  const rootSnapshot=rootTimeline.getSnapshot();
  const initialState={objects:rootSnapshot.objects,selectedId:rootSnapshot.selectedId,layoutMode:rootSnapshot.mode};
  const graph=createRealityGraph({rootId,rootLabel,rootState:initialState,...(now?{now}:{})});
  const timelines=new Map([[rootId,rootTimeline]]);
  const metadataByReality=new Map([[rootId,{}]]);
  const lastSynced=new Map([[rootId,JSON.stringify(initialState)]]);
  let activeId=rootId,activeTimeline=rootTimeline;

  function stateFor(id,timeline){
    const snapshot=timeline.getSnapshot();
    return {...metadataByReality.get(id),objects:snapshot.objects,selectedId:snapshot.selectedId,layoutMode:snapshot.mode};
  }

  function sync(){
    const state=stateFor(activeId,activeTimeline),serialized=JSON.stringify(state);
    if(lastSynced.get(activeId)!==serialized){
      graph.updateState(activeId,state);
      lastSynced.set(activeId,serialized);
    }
    return state;
  }

  function fork({label,metadata={},selectedId}={}){
    const parentState=sync(),parentId=activeId;
    const childSelection=selectedId??parentState.selectedId;
    if(!parentState.objects.some(object=>object.id===childSelection))throw Error('Unknown selected object');
    const nextMetadata={...metadata};
    const node=graph.fork(parentId,{label,bidirectional:true,state:{...nextMetadata,...parentState,selectedId:childSelection}});
    const timeline=createRealityTimeline({objects:parentState.objects,selectedId:childSelection,...timelineOptions});
    timelines.set(node.id,timeline);
    metadataByReality.set(node.id,nextMetadata);
    graph.travel(node.id);
    activeId=node.id;
    activeTimeline=timeline;
    const childState=stateFor(activeId,activeTimeline);
    graph.updateState(activeId,childState);
    lastSynced.set(activeId,JSON.stringify(childState));
    return graph.getNode(activeId);
  }

  function travel(id){
    if(!timelines.has(id))throw Error('Reality has no local state: '+id);
    sync();
    graph.travel(id);
    activeId=id;
    activeTimeline=timelines.get(id);
    return graph.getNode(activeId);
  }

  function returnToParent(){
    const current=graph.getNode(activeId);
    if(!current.parentId)return false;
    travel(current.parentId);
    return true;
  }

  function connect(fromId,toId,{type='portal',bidirectional=true}={}){
    return graph.connect(fromId,toId,{type,bidirectional});
  }

  function getSnapshot(){
    sync();
    return graph.getSnapshot();
  }

  return Object.freeze({
    rootId,
    get activeId(){return activeId;},
    get timeline(){return activeTimeline;},
    getCurrentNode(){sync();return graph.getNode(activeId);},
    getNode(id){return graph.getNode(id);},
    getSnapshot,
    fork,
    travel,
    returnToParent,
    connect,
    sync,
  });
}
