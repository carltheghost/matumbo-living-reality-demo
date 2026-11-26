/**
 * Native reading anchors are expressed in layout pixels of the owning skin.
 * Screen rectangles in CSS3D are perspective transformed and must not be
 * used to calculate scroll offsets. This function never changes focus.
 */
export function centeredReadingScroll({controlTop,controlHeight,viewportHeight,contentHeight}){
  if(![controlTop,controlHeight,viewportHeight,contentHeight].every(Number.isFinite)||
    controlHeight<=0||viewportHeight<=0||contentHeight<0)return null;
  return Math.max(0,Math.min(Math.max(0,contentHeight-viewportHeight),
    controlTop+controlHeight/2-viewportHeight/2));
}

/** Resolve a control's logical position relative to its owning scroll skin.
 * Return null for a disconnected or independently positioned control.
 * The skin's own scrollTop is intentionally excluded; inner scrollers are
 * accounted for without scrolling the document or other surfaces.
 */
export function readingControlOffset(control,skin){
  if(!control||!skin||!skin.contains(control)||control===skin)return null;
  let node=control,top=0,steps=0;
  while(node!==skin){
    const parent=node.offsetParent;
    if(!parent||!Number.isFinite(node.offsetTop)||++steps>128)return null;
    top+=node.offsetTop;
    if(parent!==skin)top+=parent.clientTop||0;
    node=parent;
  }
  node=control.parentElement;steps=0;
  while(node&&node!==skin){
    if(++steps>128)return null;
    top-=node.scrollTop||0;node=node.parentElement;
  }
  if(node!==skin)return null;
  return Number.isFinite(top)?top:null;
}

export function readingAnchorTarget(control,skin){
  const controlTop=readingControlOffset(control,skin);
  if(controlTop===null)return null;
  return centeredReadingScroll({controlTop,controlHeight:control.offsetHeight,
    viewportHeight:skin.clientHeight,contentHeight:skin.scrollHeight});
}

/** Test the actual projected center, including shape clipping and occlusion. */
export function readingControlHit(control,skin,viewportWidth,viewportHeight,elementFromPoint){
  if(!control||!skin||typeof elementFromPoint!=="function")return false;
  const r=control.getBoundingClientRect(),s=skin.getBoundingClientRect();
  const x=r.x+r.width/2,y=r.y+r.height/2;
  if(!(r.width>0&&r.height>0&&x>=Math.max(0,s.left)&&x<Math.min(viewportWidth,s.right)&&
    y>=Math.max(0,s.top)&&y<Math.min(viewportHeight,s.bottom)))return false;
  const hit=elementFromPoint(x,y);
  return hit===control||Boolean(hit&&control.contains(hit));
}
