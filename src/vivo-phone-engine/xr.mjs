const fail=(code,message=code)=>{throw Object.assign(new Error(message),{code});};

/**
 * Optional browser XR surface. It owns only session capability and lifecycle;
 * world acceptance remains in the Vivo authority and XR frames stay local.
 */
export class VivoXRIntegration extends EventTarget{
  constructor({xr=globalThis.navigator?.xr}={}){
    super();
    this.xr=xr??null;
    this.session=null;
    this.mode=null;
  }
  capabilities(){
    return {
      schema:'vivo.xr-capabilities/1',
      modes:['immersive-ar','immersive-vr'],
      apiAvailable:!!this.xr,
      sessionActive:!!this.session,
      activeMode:this.mode,
      userGestureRequired:true,
      cameraFramesUploaded:false,
      physicalValidation:false
    };
  }
  async supports(mode){
    if(!['immersive-ar','immersive-vr'].includes(mode)||!this.xr?.isSessionSupported)return false;
    try{return await this.xr.isSessionSupported(mode);}catch{return false;}
  }
  async start(mode='immersive-ar',{domOverlayRoot=null}={}){
    if(this.session)fail('XR_ALREADY_ACTIVE');
    if(!(await this.supports(mode)))fail('XR_UNSUPPORTED');
    const optionalFeatures=['local-floor','bounded-floor','hand-tracking'];
    if(domOverlayRoot)optionalFeatures.push('dom-overlay');
    const init={optionalFeatures};
    if(domOverlayRoot)init.domOverlay={root:domOverlayRoot};
    const session=await this.xr.requestSession(mode,init);
    this.session=session;this.mode=mode;
    session.addEventListener?.('end',()=>this._ended(session));
    this.dispatchEvent(new CustomEvent('change',{detail:this.capabilities()}));
    return this.capabilities();
  }
  async end(){
    if(!this.session)return this.capabilities();
    const session=this.session;
    await session.end();
    this._ended(session);
    return this.capabilities();
  }
  _ended(session){
    if(this.session!==session)return;
    this.session=null;this.mode=null;
    this.dispatchEvent(new CustomEvent('change',{detail:this.capabilities()}));
  }
  close(){
    if(this.session){void this.session.end().catch(()=>{});this._ended(this.session);}
  }
}
