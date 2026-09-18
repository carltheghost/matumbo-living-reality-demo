/** Camera/mic owner. No capture until explicit consent; never uploads or records. */
export function createMediaPreview({documentRoot=document,mediaDevices=navigator.mediaDevices}={}) {
  const root=documentRoot.createElement('details');root.id='media-preview';root.style.cssText='position:fixed;right:12px;bottom:52px;z-index:110;max-width:calc(100vw - 24px);width:290px;background:#0a1928;color:#e0f1ff;border:1px solid #567888;border-radius:10px;padding:10px;font:13px system-ui';
  const title=documentRoot.createElement('summary');title.textContent='Camera + audio · device preview';root.append(title);
  const video=documentRoot.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.style.cssText='width:100%;max-height:200px;object-fit:contain';root.append(video);
  const status=documentRoot.createElement('p');status.setAttribute('role','status');status.textContent='Camera and microphone off. Not connected to a call.';root.append(status);
  let stream=null,revision=0,starting=false;
  function stop(){revision++;starting=false;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;status.textContent='Camera and microphone off. No recording or upload.';}
  async function start(withVideo){
    stop();const request=revision;starting=true;
    try{
      if(!mediaDevices?.getUserMedia)throw Error('Camera/microphone unavailable; use a supported HTTPS browser');
      const result=await mediaDevices.getUserMedia({video:withVideo?{facingMode:'user',width:{ideal:640},height:{ideal:480}}:false,audio:{echoCancellation:true,noiseSuppression:true}});
      if(request!==revision){result.getTracks().forEach(t=>t.stop());return false;}
      stream=result;video.srcObject=stream;starting=false;status.textContent=withVideo?'Local camera + mic preview. Not in a call.':'Local mic active; audio monitoring is muted to prevent feedback. Not in a call.';return true;
    }catch(e){if(request===revision){starting=false;status.textContent=`Media not started: ${e.name||e.message}`;}return false;}
  }
  function button(text,fn){const b=documentRoot.createElement('button');b.type='button';b.textContent=text;b.style.margin='3px';b.onclick=fn;root.append(b);}
  button('Preview video + audio',()=>start(true));button('Audio only',()=>start(false));
  button('Mute / unmute mic',()=>{const tracks=stream?.getAudioTracks()??[];if(!tracks.length)return;const enabled=!tracks[0].enabled;tracks.forEach(t=>{t.enabled=enabled;});status.textContent=enabled?'Microphone active · local preview only':'Microphone muted';});
  button('Stop camera + mic',stop);
  const boundary=documentRoot.createElement('p');boundary.textContent='One-to-one and group calls are not connected yet: signaling, room access and TURN/media relay still need deployment and multi-device testing.';root.append(boundary);
  documentRoot.body.append(root);
  return {start,stop,getSnapshot:()=>({active:Boolean(stream),starting,video:stream?.getVideoTracks().length>0,audio:stream?.getAudioTracks().some(t=>t.enabled)??false,calling:false,recording:false}),destroy:()=>{stop();root.remove();}};
}
