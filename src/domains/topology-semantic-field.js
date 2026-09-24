/**
 * Topology-native semantic analysis for maTumbo SSF.
 *
 * Pure deterministic mesh analysis: welded adjacency, local neighborhoods,
 * connected components, boundary/seam edges, approximate signed curvature,
 * ridge/valley/cavity classification, shells and topology cells.
 *
 * No renderer dependency. The result is immutable JSON-friendly data that can
 * be shared across independent lenses while every lens keeps its own camera,
 * focus, LOD and material projection.
 */

const EPS = 1e-9;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const round6 = v => Math.round(v * 1e6) / 1e6;

const add3 = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub3 = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul3 = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
const dot3 = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross3 = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len3 = a => Math.hypot(a[0],a[1],a[2]);
const norm3 = a => { const l=len3(a); return l<EPS?[0,0,0]:[a[0]/l,a[1]/l,a[2]/l]; };
const mean3 = values => values.length ? mul3(values.reduce((a,b)=>add3(a,b),[0,0,0]),1/values.length) : [0,0,0];

function assertArray(name, value, stride) {
  if (!value || typeof value.length !== 'number' || value.length < stride || value.length % stride !== 0) {
    throw Error(`${name} must contain complete ${stride}-component tuples`);
  }
}

function q(value, tolerance) {
  return Math.round(Number(value) / tolerance);
}

function edgeKey(a,b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function readonly(value) {
  if (Array.isArray(value)) {
    for (const entry of value) readonly(entry);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) readonly(entry);
    return Object.freeze(value);
  }
  return value;
}

function normalizeUvRect(rect) {
  const x=clamp(Number(rect?.x??0)), y=clamp(Number(rect?.y??0));
  return {
    x:round6(x), y:round6(y),
    w:round6(clamp(Number(rect?.w??1),.001,1-x)),
    h:round6(clamp(Number(rect?.h??1),.001,1-y)),
  };
}

function uvBoundsForFaces(faces, uvs) {
  if (!uvs) return null;
  let minU=Infinity,minV=Infinity,maxU=-Infinity,maxV=-Infinity;
  const triangles=[];
  for (const face of faces) {
    const tri=[];
    for (const original of face.original) {
      const u=Number(uvs[original*2]), v=Number(uvs[original*2+1]);
      if (!Number.isFinite(u)||!Number.isFinite(v)) continue;
      const point=[u-Math.floor(u),v-Math.floor(v)];
      tri.push(point);
      minU=Math.min(minU,point[0]);maxU=Math.max(maxU,point[0]);
      minV=Math.min(minV,point[1]);maxV=Math.max(maxV,point[1]);
    }
    if (tri.length===3) triangles.push(tri);
  }
  if (!Number.isFinite(minU)) return null;
  return {
    rect:normalizeUvRect({x:minU,y:minV,w:Math.max(.001,maxU-minU),h:Math.max(.001,maxV-minV)}),
    trianglesUv:triangles,
  };
}

function connectedComponents(adjacency) {
  const seen=new Set(), components=[];
  for (let start=0;start<adjacency.length;start++) {
    if (seen.has(start)) continue;
    const queue=[start], vertices=[];seen.add(start);
    while(queue.length){
      const v=queue.shift();vertices.push(v);
      for(const n of adjacency[v])if(!seen.has(n)){seen.add(n);queue.push(n);}
    }
    components.push(vertices.sort((a,b)=>a-b));
  }
  return components;
}

function componentForVertex(components) {
  const result=[];
  components.forEach((vertices,id)=>vertices.forEach(v=>{result[v]=id;}));
  return result;
}

function classifyVertex(signed, magnitude, threshold) {
  if (magnitude < threshold) return 'smooth';
  if (signed > threshold*.35) return 'cavity';
  if (signed < -threshold*.35) return 'ridge';
  return 'crease';
}

function buildCells(faces, edges, seamKeys) {
  const faceAdj=Array.from({length:faces.length},()=>new Set());
  for(const [key,edge] of edges) {
    if(seamKeys.has(key)||edge.faces.length!==2)continue;
    const [a,b]=edge.faces;faceAdj[a].add(b);faceAdj[b].add(a);
  }
  const seen=new Set(), cells=[];
  for(let start=0;start<faces.length;start++){
    if(seen.has(start))continue;
    const queue=[start], ids=[];seen.add(start);
    while(queue.length){
      const f=queue.shift();ids.push(f);
      for(const n of faceAdj[f])if(!seen.has(n)){seen.add(n);queue.push(n);}
    }
    cells.push(ids.sort((a,b)=>a-b));
  }
  return cells;
}

function fallbackRect(index,count) {
  const cols=Math.max(1,Math.ceil(Math.sqrt(count)));
  const rows=Math.max(1,Math.ceil(count/cols));
  const col=index%cols,row=Math.floor(index/cols),g=.025;
  return normalizeUvRect({x:col/cols+g,y:row/rows+g,w:1/cols-g*2,h:1/rows-g*2});
}

export function topologyNeighborhood(topology, vertexId, hops=1) {
  const start=Number(vertexId);
  if(!Number.isInteger(start)||start<0||start>=topology.adjacency.length)return [];
  const depth=Math.max(0,Math.floor(hops));
  const seen=new Set([start]), frontier=[start];
  for(let step=0;step<depth;step++){
    const next=[];
    for(const v of frontier)for(const n of topology.adjacency[v]??[])if(!seen.has(n)){seen.add(n);next.push(n);}
    frontier.splice(0,frontier.length,...next);
    if(!frontier.length)break;
  }
  return [...seen].sort((a,b)=>a-b);
}

export function analyzeTopology({
  positions,
  index=null,
  uvs=null,
  weldTolerance=1e-5,
  seamAngle=Math.PI/5.5,
  curvatureThreshold=.035,
}={}) {
  assertArray('positions',positions,3);
  if(index&&index.length%3!==0)throw Error('index must contain triangle triples');
  if(uvs&&uvs.length!==(positions.length/3)*2)throw Error('uvs must match original vertex count');
  if(!(weldTolerance>0)||!(seamAngle>0&&seamAngle<Math.PI))throw Error('invalid topology thresholds');

  const originalCount=positions.length/3;
  const remap=new Array(originalCount), welded=[], weldMap=new Map();
  for(let i=0;i<originalCount;i++){
    const p=[Number(positions[i*3]),Number(positions[i*3+1]),Number(positions[i*3+2])];
    const key=`${q(p[0],weldTolerance)}:${q(p[1],weldTolerance)}:${q(p[2],weldTolerance)}`;
    let id=weldMap.get(key);
    if(id===undefined){id=welded.length;weldMap.set(key,id);welded.push(p);}
    remap[i]=id;
  }

  const source=index?Array.from(index,Number):Array.from({length:originalCount},(_,i)=>i);
  const faces=[];
  for(let i=0;i<source.length;i+=3){
    const original=[source[i],source[i+1],source[i+2]];
    const vertices=original.map(v=>remap[v]);
    if(new Set(vertices).size<3)continue;
    const a=welded[vertices[0]],b=welded[vertices[1]],c=welded[vertices[2]];
    const raw=cross3(sub3(b,a),sub3(c,a)), doubleArea=len3(raw);
    if(doubleArea<EPS)continue;
    faces.push({
      id:faces.length,
      vertices,
      original,
      normal:norm3(raw),
      area:doubleArea*.5,
      centroid:mul3(add3(add3(a,b),c),1/3),
    });
  }
  if(!faces.length)throw Error('mesh contains no non-degenerate triangles');

  const adjacency=Array.from({length:welded.length},()=>new Set());
  const vertexFaces=Array.from({length:welded.length},()=>[]);
  const edges=new Map();
  for(const face of faces){
    face.vertices.forEach(v=>vertexFaces[v].push(face.id));
    for(let i=0;i<3;i++){
      const a=face.vertices[i],b=face.vertices[(i+1)%3];
      adjacency[a].add(b);adjacency[b].add(a);
      const key=edgeKey(a,b);
      if(!edges.has(key))edges.set(key,{key,vertices:a<b?[a,b]:[b,a],faces:[]});
      edges.get(key).faces.push(face.id);
    }
  }

  const vertexNormals=welded.map((_,v)=>{
    let sum=[0,0,0];
    for(const f of vertexFaces[v])sum=add3(sum,mul3(faces[f].normal,faces[f].area));
    return norm3(sum);
  });

  const curvature=welded.map((p,v)=>{
    const neighbors=[...adjacency[v]];
    if(!neighbors.length)return {signed:0,magnitude:0,kind:'isolated'};
    let average=[0,0,0],edgeLength=0;
    for(const n of neighbors){average=add3(average,welded[n]);edgeLength+=len3(sub3(welded[n],p));}
    average=mul3(average,1/neighbors.length);
    edgeLength=Math.max(EPS,edgeLength/neighbors.length);
    const signed=dot3(sub3(average,p),vertexNormals[v])/edgeLength;
    const magnitude=Math.abs(signed);
    return {signed:round6(signed),magnitude:round6(magnitude),kind:classifyVertex(signed,magnitude,curvatureThreshold)};
  });

  const edgeRecords=[], seamKeys=new Set();
  for(const [key,edge] of edges){
    let angle=Math.PI,type='boundary',sign=0;
    if(edge.faces.length===2){
      const nA=faces[edge.faces[0]].normal,nB=faces[edge.faces[1]].normal;
      angle=Math.acos(clamp(dot3(nA,nB),-1,1));
      const e=norm3(sub3(welded[edge.vertices[1]],welded[edge.vertices[0]]));
      sign=dot3(cross3(nA,nB),e);
      type=angle>=seamAngle?(sign>=0?'ridge':'valley'):'smooth';
    }else if(edge.faces.length>2)type='nonmanifold';
    const seam=type!=='smooth';
    if(seam)seamKeys.add(key);
    edgeRecords.push({
      key,vertices:[...edge.vertices],faces:[...edge.faces],
      angle:round6(angle),sign:round6(sign),type,seam,
      length:round6(len3(sub3(welded[edge.vertices[1]],welded[edge.vertices[0]]))),
    });
  }

  const components=connectedComponents(adjacency);
  const componentOf=componentForVertex(components);
  const componentFaces=components.map(()=>new Set());
  faces.forEach(face=>face.vertices.forEach(v=>componentFaces[componentOf[v]].add(face.id)));
  const shells=components.map((vertices,id)=>{
    const vertexSet=new Set(vertices);
    const boundaryEdges=edgeRecords.filter(e=>e.type==='boundary'&&vertexSet.has(e.vertices[0])&&vertexSet.has(e.vertices[1]));
    return {
      id,
      vertices:[...vertices],
      faces:[...componentFaces[id]].sort((a,b)=>a-b),
      closed:boundaryEdges.length===0,
      boundaryEdgeCount:boundaryEdges.length,
    };
  });

  const cellFaceIds=buildCells(faces,edges,seamKeys);
  const totalArea=faces.reduce((s,f)=>s+f.area,0);
  const cells=cellFaceIds.map((ids,id)=>{
    const owned=ids.map(i=>faces[i]);
    const faceVertices=[...new Set(owned.flatMap(f=>f.vertices))].sort((a,b)=>a-b);
    const area=owned.reduce((s,f)=>s+f.area,0);
    const centroid=mul3(owned.reduce((sum,f)=>add3(sum,mul3(f.centroid,f.area)),[0,0,0]),1/Math.max(EPS,area));
    const signed=faceVertices.reduce((s,v)=>s+curvature[v].signed,0)/Math.max(1,faceVertices.length);
    const magnitude=faceVertices.reduce((s,v)=>s+curvature[v].magnitude,0)/Math.max(1,faceVertices.length);
    const featureEdges=edgeRecords.filter(e=>e.seam&&e.faces.some(f=>ids.includes(f)));
    const ridgeCount=featureEdges.filter(e=>e.type==='ridge').length;
    const valleyCount=featureEdges.filter(e=>e.type==='valley').length;
    const boundaryCount=featureEdges.filter(e=>e.type==='boundary'||e.type==='nonmanifold').length;
    const dominant=signed>curvatureThreshold*.35?'cavity':signed<-curvatureThreshold*.35?'ridge':boundaryCount?'open-cell':'surface-cell';
    const uv=uvBoundsForFaces(owned,uvs);
    return {
      id,
      faces:ids,
      vertices:faceVertices,
      area:round6(area),
      areaFraction:round6(area/Math.max(EPS,totalArea)),
      centroid:centroid.map(round6),
      signedCurvature:round6(signed),
      curvature:round6(magnitude),
      kind:dominant,
      ridgeEdgeCount:ridgeCount,
      valleyEdgeCount:valleyCount,
      boundaryEdgeCount:boundaryCount,
      rect:uv?.rect??fallbackRect(id,cellFaceIds.length),
      trianglesUv:uv?.trianglesUv??[],
    };
  });

  const ridgeEdges=edgeRecords.filter(e=>e.type==='ridge');
  const valleyEdges=edgeRecords.filter(e=>e.type==='valley');
  const boundaryEdges=edgeRecords.filter(e=>e.type==='boundary');
  const nonmanifoldEdges=edgeRecords.filter(e=>e.type==='nonmanifold');

  return readonly({
    schema:'matumbo.topology',
    version:1,
    vertexCount:welded.length,
    originalVertexCount:originalCount,
    faceCount:faces.length,
    positions:welded.map(p=>p.map(round6)),
    faces:faces.map(f=>({id:f.id,vertices:[...f.vertices],original:[...f.original],normal:f.normal.map(round6),area:round6(f.area),centroid:f.centroid.map(round6)})),
    adjacency:adjacency.map(set=>[...set].sort((a,b)=>a-b)),
    vertexFaces:vertexFaces.map(list=>[...list].sort((a,b)=>a-b)),
    vertexNormals:vertexNormals.map(n=>n.map(round6)),
    curvature,
    edges:edgeRecords,
    ridgeEdges,
    valleyEdges,
    boundaryEdges,
    nonmanifoldEdges,
    components:components.map((vertices,id)=>({id,vertices:[...vertices]})),
    shells,
    cells,
    thresholds:{weldTolerance,seamAngle,curvatureThreshold},
  });
}

function cellScore(cell) {
  const flatness=1-clamp(cell.curvature/.35);
  const usableArea=Math.sqrt(clamp(cell.areaFraction*4));
  const continuity=1-clamp((cell.boundaryEdgeCount+cell.ridgeEdgeCount+cell.valleyEdgeCount)/Math.max(4,cell.vertices.length));
  const cavityBonus=cell.kind==='cavity'?.08:0;
  return round6(clamp(usableArea*.48+flatness*.25+continuity*.19+cavityBonus));
}

function roleForCell(cell) {
  if(cell.kind==='cavity')return 'detail-chamber';
  if(cell.kind==='ridge')return 'signal-ridge';
  if(cell.kind==='open-cell')return 'boundary-tab';
  if(cell.ridgeEdgeCount+cell.valleyEdgeCount>2)return 'seam-cell';
  return 'surface-cell';
}

export function semanticPatchesFromTopology({topology,content=[]}={}) {
  if(!topology?.cells?.length)throw Error('topology cells are required');
  const items=content.length?content:[
    {id:'identity',label:'IDENTITY',value:'topology-native',priority:1},
    {id:'state',label:'STATE',value:'live',priority:.9},
    {id:'signal',label:'SIGNAL',value:'object-born',priority:.8},
  ];
  const rankedCells=topology.cells.map(cell=>({...cell,score:cellScore(cell)}))
    .sort((a,b)=>b.score-a.score||b.area-a.area||a.id-b.id);
  const sortedItems=items.map((item,index)=>({...item,__index:index}))
    .sort((a,b)=>(Number(b.priority??.5)-Number(a.priority??.5))||a.__index-b.__index);

  const assigned=new Array(items.length);
  sortedItems.forEach((item,rank)=>{
    const cell=rankedCells[rank%rankedCells.length];
    const rect=normalizeUvRect(cell.rect);
    assigned[item.__index]=readonly({
      id:String(item.id??`patch-${item.__index+1}`),
      label:String(item.label??item.title??`Patch ${item.__index+1}`),
      value:item.value??item.text??'',
      action:item.action??'inspect',
      priority:clamp(Number(item.priority??.5)),
      kind:item.kind??'data',
      state:item.state??'idle',
      interactive:item.interactive!==false,
      provenance:[...(item.provenance??[]),'topology-native',`cell:${cell.id}`],
      topologyCellId:cell.id,
      topologyRole:roleForCell(cell),
      topologyKind:cell.kind,
      topologyScore:cell.score,
      faceIndices:[...cell.faces],
      vertexIds:[...cell.vertices],
      rect,
      trianglesUv:cell.trianglesUv.map(tri=>tri.map(p=>[round6(p[0]),round6(p[1])])),
      surfaceSlot:0,
    });
  });
  return readonly(assigned);
}

export function resolvePatchByFace(patches,faceIndex) {
  const id=Number(faceIndex);
  if(!Number.isInteger(id)||id<0)return null;
  let best=null;
  for(const patch of patches??[]){
    if(!(patch.faceIndices??[]).includes(id))continue;
    if(!best||(patch.priority??0)>(best.priority??0))best=patch;
  }
  return best;
}

export function topologySummary(topology) {
  if(!topology)return null;
  return readonly({
    vertices:topology.vertexCount,
    faces:topology.faceCount,
    components:topology.components.length,
    shells:topology.shells.length,
    closedShells:topology.shells.filter(s=>s.closed).length,
    cells:topology.cells.length,
    ridges:topology.ridgeEdges.length,
    valleys:topology.valleyEdges.length,
    boundaries:topology.boundaryEdges.length,
    nonmanifold:topology.nonmanifoldEdges.length,
    cavities:topology.cells.filter(c=>c.kind==='cavity').length,
  });
}
