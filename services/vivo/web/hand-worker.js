/* Classic worker: the pinned MediaPipe WASM loader uses importScripts. */
let model=null;
self.onmessage=async({data:m})=>{
 if(m.type==='init'){
  try{
   const vision=await import(m.bundle),files=await vision.FilesetResolver.forVisionTasks(m.wasm);
   model=await vision.HandLandmarker.createFromOptions(files,{canvas:new OffscreenCanvas(256,256),baseOptions:{modelAssetPath:m.model,delegate:'CPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5});
   self.postMessage({type:'ready'});
  }catch(e){self.postMessage({type:'error',message:e.message});}
 }else if(m.type==='frame'){
  const begin=performance.now();
  try{if(!model)throw Error('Hand model is not initialized');const result=model.detectForVideo(m.image,m.time);self.postMessage({type:'result',sequence:m.sequence,time:m.time,inferenceMs:performance.now()-begin,landmarks:result.landmarks||[]});}
  catch(e){const noGL=/activeTexture|WebGL|OpenGL/.test(e.message);self.postMessage({type:'error',message:noGL?'Hand tracking needs working WebGL image processing, even with CPU inference. Touch remains available.':e.message});}
  finally{m.image?.close?.();}
 }
};
