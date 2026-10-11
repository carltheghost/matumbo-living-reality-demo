/**
 * Compatibility seam around the byte-preserved camera client.
 *
 * Facing is a preference, not a requirement: linked-phone, USB and virtual
 * cameras often provide video without a facingMode setting. Permission and
 * security failures are never retried, and an unreported facing is surfaced
 * as unknown rather than relabeled as front or rear.
 */
const FALLBACK_ERRORS=new Set(['OverconstrainedError','NotFoundError','TypeError']);

export function cameraConstraintFallbackAllowed(error){return FALLBACK_ERRORS.has(error?.name);}

export function genericCameraConstraints(constraints){
  if(!constraints||typeof constraints!=='object'||!constraints.video||typeof constraints.video!=='object'||Array.isArray(constraints.video))return null;
  const video={...constraints.video};delete video.facingMode;
  return {...constraints,video};
}

export function installCameraConstraintFallback(mediaDevices=globalThis.navigator?.mediaDevices){
  if(!mediaDevices||typeof mediaDevices.getUserMedia!=='function')return false;
  if(mediaDevices.getUserMedia.__vivoCameraCompatibility)return true;
  const original=mediaDevices.getUserMedia.bind(mediaDevices);
  const compatible=async constraints=>{
    try{return await original(constraints);}
    catch(error){
      const fallback=genericCameraConstraints(constraints);
      if(!fallback||!cameraConstraintFallbackAllowed(error))throw error;
      return original(fallback);
    }
  };
  try{
    Object.defineProperty(compatible,'__vivoCameraCompatibility',{value:true});
    mediaDevices.getUserMedia=compatible;
    return mediaDevices.getUserMedia===compatible;
  }catch{return false;}
}

export function normalizeCameraFacing(camera){
  if(!camera||typeof camera.start!=='function'||camera.start.__vivoFacingCompatibility)return camera;
  const start=camera.start.bind(camera);
  const compatibleStart=async(...args)=>{
    camera.requestedFacing=args[0]||camera.requestedFacing||'user';
    const result=await start(...args);
    const track=camera.stream?.getVideoTracks?.()[0];
    const facing=track?.getSettings?.().facingMode;
    camera.facing=typeof facing==='string'&&facing.length?facing:null;
    if(camera.video)camera.video.style.transform=camera.facing==='user'?'scaleX(-1)':'none';
    return result;
  };
  Object.defineProperty(compatibleStart,'__vivoFacingCompatibility',{value:true});
  camera.start=compatibleStart;
  return camera;
}
