/** Pure application adapters. No renderer projection is an accepted material edit. */
export function eventTime(event, now=performance.now(), origin=performance.timeOrigin) {
  let time=event.timeStamp;
  if(time>1e12)time-=origin;
  return Number.isFinite(time)&&time>=0&&time<=now+2?time:NaN;
}
export function frameOf(entity){return{spaceId:entity.spaceId,dimension:entity.dimension,chart:entity.chart,q:[...entity.q]};}
export function screenTarget(renderer,entity,anchor,point) {
  const q=[...entity.q],g={kind:'flat',dimension:entity.dimension};
  // Original renderer's flat embedding is [x1,x3,x2]. Calibrate the explicit
  // x1/x2 chart basis; preserve every unprojected coordinate in the full-D frame.
  const project=p=>renderer.project([p[0],p[2],p[1]]),p=project(q),epsilon=.01;
  const a=[...q],b=[...q];a[0]+=epsilon;b[1]+=epsilon;
  const u=project(a),v=project(b),A=(u.x-p.x)/epsilon,B=(v.x-p.x)/epsilon;
  const C=(u.y-p.y)/epsilon,D=(v.y-p.y)/epsilon,det=A*D-B*C;
  if(!Number.isFinite(det)||Math.abs(det)<.5)throw Error('View is edge-on; use an explicit axis control');
  const dx=point[0]-anchor[0],dy=point[1]-anchor[1];
  q[0]+=(D*dx-B*dy)/det;q[1]+=(-C*dx+A*dy)/det;
  return{...frameOf(entity),q};
}
export function viewBasis(d,yaw,pitch){
  const c=Math.cos(yaw),s=Math.sin(yaw),a=Math.cos(pitch),b=Math.sin(pitch);
  const basis=Array.from({length:d},(_,i)=>Array.from({length:d},(_,j)=>+(i===j)));
  basis[0].splice(0,3,c,0,-s);basis[1].splice(0,3,-b*s,a,-b*c);basis[2].splice(0,3,a*s,b,a*c);
  return basis;
}
export function viewAngles(basis){return{yaw:Math.atan2(-basis[0][2],basis[0][0]),pitch:Math.atan2(basis[2][1],basis[1][1])};}
export function projectAccepted(state,grid){
  const{snapshot,eye}=state,space=snapshot.spaces[eye.spaceId];
  return{schema:'viva-local-render/1',name:eye.spaceId==='root'?'Local workshop':'Inside the relic · 11 spatial axes',
    geometry:{kind:'flat',dimension:space.dimension},entities:structuredClone(space.entities),
    participants:[],guide:{activity:grid.coords.map(()=>0),blocked:[],goal:-1}};
}
/** Camera base is the unmodified imported worker client. Capture time comes from
 * its frame message, not inference completion. Loss never becomes a final sample. */
export function timestampedCameraClass(Camera){return class extends Camera{
  constructor(video,onState,onGesture,onHands){
    let self;
    super(video,onState,event=>{
      if(self?.losing&&event.type==='release')return;
      if(event.point)self.lastPoint=[...event.point];
      onGesture({...event,...(self.lastPoint?{point:[...self.lastPoint]}:{}),observedAt:self.capturedAt,epoch:self.epoch});
    },onHands);
    self=this;this.capturedAt=NaN;this.lastPoint=null;this.losing=false;
  }
  consume(message){this.capturedAt=message.time;return super.consume(message);}
  lost(message){this.losing=true;try{return super.lost(message);}finally{this.losing=false;this.lastPoint=null;this.capturedAt=NaN;}}
};}
