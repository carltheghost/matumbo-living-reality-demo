import {embed} from '/render.js';

/* Application-owned visualization for the accepted material observation.
 * The imported renderer stays byte-identical; this canvas only consumes its
 * projection and the read-only observation returned by local authority.
 */
export class DensityOverlay{
  constructor(renderer,canvas){
    this.renderer=renderer;
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.observation=null;
  }
  setObservation(observation){
    const rows=observation?.density,shape=observation?.shape;
    if(!Array.isArray(rows)||!Array.isArray(shape)||shape.length!==2||shape.some(value=>!Number.isInteger(value)||value<1)||rows.length!==shape[0]||rows.some(row=>!Array.isArray(row)||row.length!==shape[1])){
      this.observation=null;
      return false;
    }
    const values=rows.map(row=>row.map(value=>Number(value)));
    if(values.some(row=>row.some(value=>!Number.isFinite(value)||value<0))){
      this.observation=null;
      return false;
    }
    this.observation={...structuredClone(observation),density:values};
    return true;
  }
  clear(){this.observation=null;this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);}
  resize(){
    const width=innerWidth,height=innerHeight;
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    return [width,height];
  }
  draw(){
    const [width,height]=this.resize(),ctx=this.ctx,observation=this.observation,renderer=this.renderer;
    ctx.clearRect(0,0,width,height);
    const geometry=renderer.state?.geometry;
    if(!observation||!geometry||geometry.dimension!==4||!renderer.w||!renderer.h)return;
    const axes=Array.isArray(observation.axes)&&observation.axes.length===2?observation.axes.map(Number):[0,1];
    if(new Set(axes).size!==2||axes.some(axis=>!Number.isInteger(axis)||axis<0||axis>3))return;
    const shape=observation.shape;
    const density=observation.density;
    const fixed=observation.fixedCoordinates||{};
    const lengths=[8,8,8,8];
    const point=(i,j)=>{
      const q=[0,0,0,0];
      q[axes[0]]=-lengths[axes[0]]/2+i*lengths[axes[0]]/shape[0];
      q[axes[1]]=-lengths[axes[1]]/2+j*lengths[axes[1]]/shape[1];
      for(const axis of[0,1,2,3])if(axis!==axes[0]&&axis!==axes[1])q[axis]=Number(fixed[String(axis)]??fixed[axis]??0);
      return renderer.project(embed(q,geometry,'flat'));
    };
    const values=density.flat(),minimum=Math.min(...values),maximum=Math.max(...values),span=Math.max(1e-12,maximum-minimum);
    ctx.save();
    ctx.globalCompositeOperation='screen';
    for(let i=0;i<shape[0];i++)for(let j=0;j<shape[1];j++){
      const corners=[point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)];
      if(corners.some(value=>!value.visible))continue;
      const level=Math.sqrt(Math.max(0,Math.min(1,(density[i][j]-minimum)/span)));
      ctx.fillStyle=`rgba(${Math.round(65+level*170)},${Math.round(120+level*110)},${Math.round(200-level*45)},${.18+level*.60})`;
      ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);for(const value of corners.slice(1))ctx.lineTo(value.x,value.y);ctx.closePath();ctx.fill();
      ctx.strokeStyle=`rgba(164,229,240,${.12+level*.22})`;ctx.lineWidth=.65;ctx.stroke();
    }
    ctx.restore();
  }
}
