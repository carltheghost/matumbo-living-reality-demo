/**
 * double-tap.js — shared double-tap / double-click disambiguation helper.
 *
 * Packet 240 (233b fidelity restoration): the travel law names both
 * double-click (desktop) and double-tap (touch). Native `dblclick` does not
 * fire reliably on touch, so surfaces that must work on both get this
 * detector instead of (or, on the assembly canvas, in addition to) a native
 * listener.
 *
 * Semantics mirror the block-world cube-dive path (`registerFieldTap`):
 * the FIRST tap selects immediately and never activates; a second tap on the
 * SAME target, with the SAME pointer type, within `windowMs` and
 * `distancePx`, activates (double-tap). Anything else is a fresh single.
 * No timers — the decision is made synchronously at each tap, exactly like
 * the dive path's last-tap comparison.
 *
 * Top level is node-safe: no DOM, no THREE. `now` is injectable per tap so
 * unit tests can drive deterministic timestamps.
 */
export function createDoubleTapDetector({windowMs=350,distancePx=28,onDoubleTap,onSingleTap}={}){
  let last=null;
  const nowOf=(value)=>{
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(typeof performance!=='undefined'&&typeof performance.now==='function')return performance.now();
    return Date.now();
  };
  const pointOf=(event)=>({x:Number(event?.clientX??0),y:Number(event?.clientY??0)});
  const typeOf=(event)=>(typeof event?.pointerType==='string'&&event.pointerType)?event.pointerType:'pointer';
  return {
    /**
     * Record one tap. `key` is the same-target identity (cube id, label id);
     * taps with different keys never combine into a double.
     * Returns 'single' or 'double'.
     */
    tap(key,event,now){
      const time=nowOf(now);
      const {x,y}=pointOf(event);
      const pointerType=typeOf(event);
      const targetKey=key??'';
      const previous=last;
      const elapsed=previous?time-previous.time:Infinity;
      if(
        previous
        &&previous.key===targetKey
        &&previous.pointerType===pointerType
        &&elapsed>=0
        &&elapsed<=windowMs
        &&Math.hypot(x-previous.x,y-previous.y)<=distancePx
      ){
        last=null;
        if(typeof onDoubleTap==='function')onDoubleTap(event);
        return 'double';
      }
      last={key:targetKey,time,x,y,pointerType};
      if(typeof onSingleTap==='function')onSingleTap(event);
      return 'single';
    },
    /** Forget any pending first tap (e.g. the pointer was captured away). */
    reset(){last=null;},
    /** True while a first tap is waiting for its pair. */
    get pending(){return last!==null;},
  };
}
