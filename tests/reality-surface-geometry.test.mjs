import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {REALITY_TAB_FORMS,REALITY_TAB_FORM_IDS} from '../src/domains/reality-tab-layout.js';
import {createRealitySurfaceGeometry} from '../src/render/reality-surface-geometry.js';

const key=point=>point.map(value=>Math.round(value*1e6)).join(',');
function trianglePoints(geometry,i){const p=geometry.getAttribute('position');return [i,i+1,i+2].map(j=>[p.getX(j),p.getY(j),p.getZ(j)]);}
function hit(body,origin,direction){
  const materials=body.charts.map(()=>new THREE.MeshBasicMaterial({side:THREE.FrontSide}));
  const mesh=new THREE.Mesh(body.geometry,materials);mesh.updateMatrixWorld(true);
  const hits=new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize()).intersectObject(mesh,false);
  materials.forEach(material=>material.dispose());return hits;
}

test('every retained and new shape is a closed consistently-wound body with complete chart coverage',()=>{
  const counts={cube:6,sphere:6,cylinder:6,'triangular-prism':5,torus:8,phone:3,square:3,rectangle:3,wave:3};
  assert.equal(REALITY_TAB_FORM_IDS.length,9);
  for(const shape of REALITY_TAB_FORM_IDS){
    const {geometry,charts}=createRealitySurfaceGeometry(THREE,shape),p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),n=geometry.getAttribute('normal');
    assert.equal(charts.length,counts[shape]);assert.equal(geometry.groups.length,charts.length);
    let end=0;const edges=new Map();let volume=0;
    for(const [i,group] of geometry.groups.entries()){
      assert.equal(group.start,end);assert.ok(group.count>0);assert.equal(group.count%3,0);assert.equal(group.materialIndex,i);
      assert.equal(charts[i].index,i);assert.equal(charts[i].shape,shape);assert.ok(charts[i].aspect>0);end+=group.count;
    }
    assert.equal(end,p.count);assert.equal(p.count,uv.count);assert.equal(p.count,n.count);
    for(let i=0;i<p.count;i++){
      assert.ok(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)));
      assert.ok(uv.getX(i)>=-1e-6&&uv.getX(i)<=1.000001&&uv.getY(i)>=-1e-6&&uv.getY(i)<=1.000001,`${shape} normalized UV`);
      assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
    }
    for(let i=0;i<p.count;i+=3){
      const points=trianglePoints(geometry,i),[a,b,c]=points.map(point=>new THREE.Vector3(...point));
      const normal=b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(normal.length()>1e-10,`${shape} has no degenerate triangle`);
      assert.ok(normal.dot(new THREE.Vector3(n.getX(i),n.getY(i),n.getZ(i)))>0,`${shape} winding follows outward normals`);
      volume+=a.dot(b.clone().cross(c))/6;
      for(let edge=0;edge<3;edge++){
        const edgeKey=[key(points[edge]),key(points[(edge+1)%3])].sort().join('|');edges.set(edgeKey,(edges.get(edgeKey)??0)+1);
      }
    }
    assert.ok(volume>0,`${shape} has positive enclosed volume`);
    assert.ok([...edges.values()].every(count=>count===2),`${shape} has no boundary or nonmanifold edge after seam welding`);
    const bounds=geometry.boundingBox,form=REALITY_TAB_FORMS[shape];
    for(const [axis,dimension] of [['x','width'],['y','height'],['z','depth']]){
      assert.ok(bounds.max[axis]<=form[dimension]/2+1e-6&&bounds.min[axis]>=-form[dimension]/2-1e-6,`${shape} stays inside ${axis} bounds`);
    }
    geometry.dispose();
  }
});

test('sphere retains its complete radial surface and each of six charts is raycastable',()=>{
  const body=createRealitySurfaceGeometry(THREE,'sphere'),p=body.geometry.getAttribute('position'),radius=REALITY_TAB_FORMS.sphere.width/2;
  for(let i=0;i<p.count;i++)assert.ok(Math.abs(Math.hypot(p.getX(i),p.getY(i),p.getZ(i))-radius)<1e-6);
  for(const [index,axis] of [[0,[1,0,0]],[1,[-1,0,0]],[2,[0,1,0]],[3,[0,-1,0]],[4,[0,0,1]],[5,[0,0,-1]]]){
    const hits=hit(body,axis.map(value=>value*4),axis.map(value=>-value));assert.ok(hits.length);assert.equal(hits[0].face.materialIndex,index);
    assert.ok(hits[0].uv.x>=0&&hits[0].uv.x<=1&&hits[0].uv.y>=0&&hits[0].uv.y<=1);
  }
  body.geometry.dispose();
});

test('cylinder has four continuous wall charts plus two actual circular caps',()=>{
  const body=createRealitySurfaceGeometry(THREE,'cylinder'),radius=REALITY_TAB_FORMS.cylinder.width/2;
  for(let section=0;section<4;section++){
    const angle=(section+.5)*Math.PI/2,direction=[Math.sin(angle),0,Math.cos(angle)];
    const hits=hit(body,direction.map(v=>v*4),direction.map(v=>-v));assert.equal(hits[0].face.materialIndex,section);
    assert.ok(Math.abs(Math.hypot(hits[0].point.x,hits[0].point.z)-radius)<1e-5);
  }
  assert.equal(hit(body,[0,4,0],[0,-1,0])[0].face.materialIndex,4);
  assert.equal(hit(body,[0,-4,0],[0,1,0])[0].face.materialIndex,5);
  body.geometry.dispose();
});

test('torus retains its real empty center, tube equation and eight independently reachable charts',()=>{
  const body=createRealitySurfaceGeometry(THREE,'torus'),p=body.geometry.getAttribute('position'),tube=REALITY_TAB_FORMS.torus.depth/2,major=REALITY_TAB_FORMS.torus.width/2-tube;
  assert.equal(hit(body,[0,0,4],[0,0,-1]).length,0,'empty center cannot select a hidden panel');
  for(let i=0;i<p.count;i++)assert.ok(Math.abs(Math.hypot(Math.hypot(p.getX(i),p.getY(i))-major,p.getZ(i))-tube)<1e-6);
  for(let section=0;section<4;section++)for(let half=0;half<2;half++){
    const theta=(section+.5)*Math.PI/2,sign=half?-1:1;
    const hits=hit(body,[major*Math.cos(theta),major*Math.sin(theta),sign*4],[0,0,-sign]);
    assert.ok(hits.length);assert.equal(hits[0].face.materialIndex,section*2+half);
  }
  body.geometry.dispose();
});

test('triangular prism has two triangular ends, three side charts and no rectangular end hit target',()=>{
  const body=createRealitySurfaceGeometry(THREE,'triangular-prism'),form=REALITY_TAB_FORMS['triangular-prism'];
  assert.equal(hit(body,[form.width*.45,form.height*.4,4],[0,0,-1]).length,0);
  assert.equal(hit(body,[0,0,4],[0,0,-1])[0].face.materialIndex,0);
  assert.equal(hit(body,[0,0,-4],[0,0,1])[0].face.materialIndex,1);
  const vertices=[[0,form.height/2],[-form.width/2,-form.height/2],[form.width/2,-form.height/2]];
  for(let i=0;i<3;i++){
    const a=vertices[i],b=vertices[(i+1)%3],middle=[(a[0]+b[0])/2,(a[1]+b[1])/2,0],normal=new THREE.Vector3(b[1]-a[1],a[0]-b[0],0).normalize();
    const origin=middle.map((v,axis)=>v+normal.getComponent(axis)*4);
    assert.equal(hit(body,origin,normal.toArray().map(v=>-v))[0].face.materialIndex,i+2);
  }
  for(const chart of body.charts.slice(0,2)){
    const bounds=chart.contentBounds;
    for(const x of [bounds.x,bounds.x+bounds.width])for(const y of [bounds.y,bounds.y+bounds.height])assert.ok(Math.abs(x-.5)<=y/2);
  }
  body.geometry.dispose();
});

test('unsupported body geometry fails before silently selecting a fallback shape',()=>{
  assert.throws(()=>createRealitySurfaceGeometry(THREE,'unknown-shape'),/supported tab forms/);
});
