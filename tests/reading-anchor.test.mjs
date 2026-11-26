import test from "node:test";
import assert from "node:assert/strict";
import {centeredReadingScroll,readingControlOffset,readingAnchorTarget,readingControlHit} from "../src/render/reading-anchor.js";
function fixture(){
  const skin={offsetHeight:433,clientHeight:433,scrollHeight:7258,scrollTop:4155,
    getBoundingClientRect:()=>({left:24,right:366,top:201,bottom:639}),contains:()=>true};
  const group={offsetParent:skin,offsetTop:3600,clientTop:2,scrollTop:100,parentElement:skin};
  const control={offsetParent:group,offsetTop:900,offsetHeight:48,parentElement:group,
    getBoundingClientRect:()=>({x:80,y:380,width:200,height:48}),contains:()=>false};
  return {skin,group,control};
}
test("centered scroll uses logical pixels and clamps both content edges",()=>{
  assert.equal(centeredReadingScroll({controlTop:4500,controlHeight:48,viewportHeight:433,contentHeight:7258}),4307.5);
  assert.equal(centeredReadingScroll({controlTop:0,controlHeight:20,viewportHeight:433,contentHeight:7258}),0);
  assert.equal(centeredReadingScroll({controlTop:7250,controlHeight:20,viewportHeight:433,contentHeight:7258}),6825);
  assert.equal(centeredReadingScroll({controlTop:20,controlHeight:20,viewportHeight:0,contentHeight:200}),null);
  assert.equal(centeredReadingScroll({controlTop:NaN,controlHeight:20,viewportHeight:433,contentHeight:200}),null);
});
test("offset resolves nested offset parents and ignores the skin's existing scroll",()=>{
  const {skin,group,control}=fixture();
  assert.equal(readingControlOffset(control,skin),4402);
  assert.equal(readingAnchorTarget(control,skin),4209.5);
  skin.scrollTop=6000;assert.equal(readingAnchorTarget(control,skin),4209.5);
  group.scrollTop=0;assert.equal(readingAnchorTarget(control,skin),4309.5);
  control.offsetParent=null;assert.equal(readingAnchorTarget(control,skin),null);
});
test("hit test requires a real clipped and unoccluded projected control",()=>{
  const {skin,control}=fixture();
  assert.equal(readingControlHit(control,skin,390,844,()=>control),true);
  assert.equal(readingControlHit(control,skin,390,844,()=>skin),false);
  control.getBoundingClientRect=()=>({x:80,y:650,width:200,height:48});
  assert.equal(readingControlHit(control,skin,390,844,()=>control),false);
});
