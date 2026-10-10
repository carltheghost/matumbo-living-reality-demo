import {REALITY_TAB_FORMS,normalizeRealityTabShape} from '../domains/reality-tab-layout.js?v=20261003-skin360';

/** Whole, closed feature bodies with explicit material/UV charts. Each triangle
 * belongs to exactly one chart; a mesh raycast identifies that chart through
 * face.materialIndex. Surfaces never depend on a camera-facing reading cap. */
export function createRealitySurfaceGeometry(THREE, shape) {
  normalizeRealityTabShape(shape);
  const form=REALITY_TAB_FORMS[shape],charts=[];
  const rect={x:.055,y:.17,width:.89,height:.67};
  const circle={x:.2,y:.2,width:.6,height:.6};
  // At y=.45 from the apex this triangle is .45 wide, so the .4-wide
  // content rectangle remains completely on its surface, including corners.
  const triangle={x:.3,y:.45,width:.4,height:.4};
  function chart(id,label,width,height,contentBounds=rect){
    const result=Object.freeze({id,label,index:charts.length,shape,width,height,
      aspect:width/height,contentBounds:Object.freeze({...contentBounds})});
    charts.push(result);return result;
  }
  function finish(geometry){
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    geometry.userData={...geometry.userData,realityShape:shape,surfaceCharts:charts};
    return {geometry,charts:Object.freeze(charts),shape};
  }

  if(shape==='cube'||shape==='sphere'){
    const sphere=shape==='sphere',segments=sphere?16:1;
    const source=new THREE.BoxGeometry(form.width,form.height,form.depth,segments,segments,segments);
    const geometry=source.toNonIndexed();source.dispose();
    const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
    if(sphere){
      const radius=Math.min(form.width,form.height,form.depth)/2;
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),length=Math.hypot(x,y,z);
        positions.setXYZ(i,x/length*radius,y/length*radius,z/length*radius);
        normals.setXYZ(i,x/length,y/length,z/length);
      }
      positions.needsUpdate=true;normals.needsUpdate=true;
    }
    for(const [id,label,width,height] of [
      ['right','Right',form.depth,form.height],['left','Left',form.depth,form.height],
      ['top','Top',form.width,form.depth],['bottom','Bottom',form.width,form.depth],
      ['front','Front',form.width,form.height],['back','Back',form.width,form.height],
    ])chart(id,label,width,height);
    return finish(geometry);
  }

  const positions=[],normals=[],uvs=[],groups=[];
  function emit(a,b,c,ua,ub,uc,normalAt=null){
    const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    const length=Math.hypot(...cross);
    if(length<1e-12)return;
    const flat=cross.map(v=>v/length);
    for(const [point,uv] of [[a,ua],[b,ub],[c,uc]]){
      positions.push(...point);uvs.push(...uv);normals.push(...(normalAt?normalAt(point,uv):flat));
    }
  }
  function group(descriptor,write){
    const start=positions.length/3;write();
    groups.push({start,count:positions.length/3-start,materialIndex:descriptor.index});
  }
  function patch(descriptor,pointAt,uCount,vCount,normalAt=null){
    group(descriptor,()=>{
      for(let y=0;y<vCount;y++)for(let x=0;x<uCount;x++){
        const a=[x/uCount,y/vCount],b=[(x+1)/uCount,y/vCount],c=[x/uCount,(y+1)/vCount],d=[(x+1)/uCount,(y+1)/vCount];
        emit(pointAt(...a),pointAt(...b),pointAt(...c),a,b,c,normalAt);
        emit(pointAt(...b),pointAt(...d),pointAt(...c),b,d,c,normalAt);
      }
    });
  }

  if(shape==='cylinder'){
    const radius=Math.min(form.width,form.depth)/2,half=form.height/2;
    for(let section=0;section<4;section++){
      patch(chart(`side-${section}`,`Wall ${section+1}`,Math.PI*radius/2,form.height),(u,v)=>{
        const angle=(section+u)*Math.PI/2;
        return [radius*Math.sin(angle),(v-.5)*form.height,radius*Math.cos(angle)];
      },16,4,point=>[point[0]/radius,0,point[2]/radius]);
    }
    for(const top of [true,false]){
      group(chart(top?'top':'bottom',top?'Top':'Bottom',radius*2,radius*2,circle),()=>{
        const y=top?half:-half;
        for(let i=0;i<64;i++){
          const a=i/64*Math.PI*2,b=(i+1)/64*Math.PI*2;
          const pa=[radius*Math.cos(a),y,radius*Math.sin(a)],pb=[radius*Math.cos(b),y,radius*Math.sin(b)];
          const ua=[.5+.5*Math.cos(a),.5+.5*Math.sin(a)],ub=[.5+.5*Math.cos(b),.5+.5*Math.sin(b)];
          if(top)emit([0,y,0],pb,pa,[.5,.5],ub,ua);
          else emit([0,y,0],pa,pb,[.5,.5],ua,ub);
        }
      });
    }
  }else if(shape==='octahedron'){
    // Four equator vertices join two points: eight real triangular facets,
    // each with its own readable chart and no rectangular picking shell.
    const rim=[[-form.width/2,0,form.depth/2],[form.width/2,0,form.depth/2],[form.width/2,0,-form.depth/2],[-form.width/2,0,-form.depth/2]];
    for(const upper of [true,false])for(let section=0;section<4;section++){
      const apex=[0,(upper?1:-1)*form.height/2,0],a=rim[section],b=rim[(section+1)%4];
      const width=Math.hypot(...a.map((value,axis)=>value-b[axis]));
      const height=Math.hypot(...apex.map((value,axis)=>value-(a[axis]+b[axis])/2));
      group(chart(`${upper?'upper':'lower'}-${section}`,`${upper?'Upper':'Lower'} facet ${section+1}`,width,height,triangle),()=>{
        if(upper)emit(apex,a,b,[.5,1],[0,0],[1,0]);
        else emit(apex,b,a,[.5,1],[1,0],[0,0]);
      });
    }
  }else if(shape==='torus'){
    const tube=form.depth/2,major=Math.min(form.width,form.height)/2-tube;
    for(let section=0;section<4;section++)for(let half=0;half<2;half++){
      patch(chart(`ring-${section}-tube-${half}`,`Ring ${section+1} · ${half?'rear':'front'}`,major*Math.PI/2,tube*Math.PI),(u,v)=>{
        const theta=(section+u)*Math.PI/2,phi=(half+v)*Math.PI,radius=major+tube*Math.cos(phi);
        return [radius*Math.cos(theta),radius*Math.sin(theta),tube*Math.sin(phi)];
      },16,16,point=>{
        const radial=Math.hypot(point[0],point[1]),x=point[0]/radial,y=point[1]/radial;
        return [(point[0]-x*major)/tube,(point[1]-y*major)/tube,point[2]/tube];
      });
    }
  }else{
    const width=form.width,height=form.height,depth=form.depth,half=depth/2;
    let outline=[];
    if(shape==='triangular-prism')outline=[[0,height/2],[-width/2,-height/2],[width/2,-height/2]];
    else if(shape==='wave'){
      // Preserve the full waving silhouette inside the declared body bounds.
      for(let i=0;i<=32;i++){const t=i/32;outline.push([(t-.5)*width,-height*(.43+.07*Math.sin(t*Math.PI*4))]);}
      for(let i=32;i>=0;i--){const t=i/32;outline.push([(t-.5)*width,height*(.43+.07*Math.sin(t*Math.PI*4))]);}
    }else{
      const r=Math.min(form.radius,width/4,height/4);
      for(const [cx,cy,start] of [[width/2-r,height/2-r,0],[-width/2+r,height/2-r,Math.PI/2],[-width/2+r,-height/2+r,Math.PI],[width/2-r,-height/2+r,Math.PI*1.5]]){
        for(let i=0;i<=8;i++){const angle=start+i/8*Math.PI/2;outline.push([cx+Math.cos(angle)*r,cy+Math.sin(angle)*r]);}
      }
    }
    const boundary=new THREE.Shape();outline.forEach(([x,y],i)=>i?boundary.lineTo(x,y):boundary.moveTo(x,y));boundary.closePath();
    const capGeometry=new THREE.ShapeGeometry(boundary),capPositions=capGeometry.getAttribute('position');
    const index=capGeometry.index,count=index?index.count:capPositions.count;
    const pointAt=i=>{const n=index?index.getX(i):i;return [capPositions.getX(n),capPositions.getY(n)];};
    for(const front of [true,false])group(chart(front?'front':'back',front?'Front':'Back',width,height,shape==='triangular-prism'?triangle:rect),()=>{
      for(let i=0;i<count;i+=3){
        let points=[pointAt(i),pointAt(i+1),pointAt(i+2)];
        if(!front)points.reverse();
        const mapped=points.map(([x,y])=>[x/width+.5,y/height+.5]);
        emit(...points.map(([x,y])=>[x,y,front?half:-half]),...mapped);
      }
    });
    capGeometry.dispose();
    const perimeter=outline.map((a,i)=>Math.hypot(...outline[(i+1)%outline.length].map((v,axis)=>v-a[axis])));
    const total=perimeter.reduce((sum,value)=>sum+value,0);
    let travelled=0;
    if(shape==='triangular-prism'){
      for(let i=0;i<3;i++){
        const a=outline[i],b=outline[(i+1)%3];
        patch(chart(`side-${i}`,`Side ${i+1}`,perimeter[i],depth),(u,v)=>[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,(v-.5)*depth],1,1);
      }
    }else group(chart('perimeter','Perimeter',total,depth),()=>{
      for(let i=0;i<outline.length;i++){
        const a=outline[i],b=outline[(i+1)%outline.length],u0=travelled/total,u1=(travelled+perimeter[i])/total;
        emit([...a,-half],[...b,-half],[...a,half],[u0,0],[u1,0],[u0,1]);
        emit([...b,-half],[...b,half],[...a,half],[u1,0],[u1,1],[u0,1]);travelled+=perimeter[i];
      }
    });
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  for(const {start,count,materialIndex} of groups)geometry.addGroup(start,count,materialIndex);
  return finish(geometry);
}
