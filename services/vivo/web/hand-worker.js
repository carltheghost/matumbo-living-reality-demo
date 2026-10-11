/* The pinned MediaPipe package and camera frames stay inside this local worker. */
let model=null;
let delegate='CPU';
self.onmessage=async({data:m})=>{
 if(m.type==='init'){
  try{
   const vision=await import(m.bundle),files=await vision.FilesetResolver.forVisionTasks(m.wasm);
   const options={canvas:new OffscreenCanvas(256,256),baseOptions:{modelAssetPath:m.model},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.48,minHandPresenceConfidence:.48,minTrackingConfidence:.5};
   try{model=await vision.HandLandmarker.createFromOptions(files,{...options,baseOptions:{...options.baseOptions,delegate:'GPU'}});delegate='GPU';}
   catch(_){model=await vision.HandLandmarker.createFromOptions(files,{...options,baseOptions:{...options.baseOptions,delegate:'CPU'}});delegate='CPU';}
   self.postMessage({type:'ready',delegate,maxHands:2,landmarksPerHand:21});
  }catch(e){self.postMessage({type:'error',message:e.message});}
 }else if(m.type==='frame'){
  const begin=performance.now();
  try{if(!model)throw Error('Hand model is not initialized');const result=model.detectForVideo(m.image,m.time);self.postMessage({type:'result',sequence:m.sequence,time:m.time,inferenceMs:performance.now()-begin,delegate,landmarks:result.landmarks||[],handedness:result.handedness||[],worldLandmarks:result.worldLandmarks||[]});}
  catch(e){const noGL=/activeTexture|WebGL|OpenGL/.test(e.message);self.postMessage({type:'error',message:noGL?'Hand tracking needs working WebGL image processing, even with CPU inference. Touch remains available.':e.message});}
  finally{m.image?.close?.();}
 }
};
