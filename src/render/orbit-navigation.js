/** An optional mouse/touch dial for the existing camera, with keyboard parity. */
const TAU = Math.PI * 2;
const finiteVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
export function orbitCamera({position, target, yaw = 0, pitch = 0, zoom = 1, minDistance = 3, maxDistance = 220} = {}) {
  if (!finiteVector(position) || !finiteVector(target) || ![yaw,pitch,zoom,minDistance,maxDistance].every(Number.isFinite) || zoom <= 0 || minDistance <= 0 || maxDistance < minDistance) throw new TypeError('Orbit requires a finite camera and valid travel limits');
  const offset = position.map((value,index) => value-target[index]), length = Math.hypot(...offset);
  if (length < 1e-8) throw new TypeError('Orbit camera cannot sit at its target');
  const radius = Math.min(maxDistance,Math.max(minDistance,length*zoom));
  const heading = Math.atan2(offset[0],offset[2])+yaw;
  const elevation = Math.min(Math.PI/2-.08,Math.max(-Math.PI/2+.08,Math.asin(offset[1]/length)+pitch));
  const horizontal = radius*Math.cos(elevation);
  return {position:[target[0]+horizontal*Math.sin(heading),target[1]+radius*Math.sin(elevation),target[2]+horizontal*Math.cos(heading)],target:[...target],heading:((heading%TAU)+TAU)%TAU,distance:radius};
}
export function orbitPointerDelta(previous,next) {
  if (![previous,next].every(Number.isFinite)) return 0;
  return Math.atan2(Math.sin(next-previous),Math.cos(next-previous));
}
export function mountOrbitNavigation({documentRoot=globalThis.document,host,readCamera,onChange}={}) {
  if (!host || typeof readCamera !== 'function' || typeof onChange !== 'function') throw new TypeError('Navigation dial needs its camera owner');
  const root=documentRoot.createElement('section');root.className='assembly-orbit-navigation';root.setAttribute('aria-label','Rotate and travel');
  const dial=documentRoot.createElement('div');dial.dataset.orbitDial='';dial.className='assembly-orbit-dial';dial.tabIndex=0;dial.setAttribute('role','slider');dial.setAttribute('aria-label','Rotate viewpoint');dial.setAttribute('aria-valuemin','0');dial.setAttribute('aria-valuemax','359');
  const arrow=documentRoot.createElement('span');arrow.textContent='↑';arrow.setAttribute('aria-hidden','true');dial.append(arrow);
  const copy=documentRoot.createElement('div'),title=documentRoot.createElement('strong'),hint=documentRoot.createElement('small'),actions=documentRoot.createElement('div');
  title.textContent='Rotate your view';hint.textContent='Turn the dial · wheel to travel · arrows to look';actions.className='assembly-orbit-actions';copy.append(title,hint,actions);root.append(dial,copy);host.append(root);
  let drag=null,lastHeading=null,destroyed=false;const listeners=[];
  function listen(element,type,handler,options){element.addEventListener(type,handler,options);listeners.push([element,type,handler,options]);}
  function update(){if(destroyed)return;const {position,target}=readCamera();const heading=((Math.atan2(position[0]-target[0],position[2]-target[2])*180/Math.PI)%360+360)%360;const rounded=Math.round(heading)%360;if(lastHeading===rounded)return;lastHeading=rounded;arrow.style.transform=`rotate(${rounded}deg)`;dial.setAttribute('aria-valuenow',String(rounded));dial.setAttribute('aria-valuetext',`${rounded} degrees around the current space`);}
  function change(delta){const current=readCamera();onChange(orbitCamera({...current,...delta}));update();}
  function action(text,label,delta){const button=documentRoot.createElement('button');button.type='button';button.textContent=text;button.setAttribute('aria-label',label);listen(button,'click',()=>change(delta));actions.append(button);}
  action('↶','Turn viewpoint left',{yaw:-Math.PI/12});action('↷','Turn viewpoint right',{yaw:Math.PI/12});action('+','Travel closer',{zoom:.85});action('−','Travel farther',{zoom:1/.85});
  const angle=event=>{const rect=dial.getBoundingClientRect(),x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2;return Math.hypot(x,y)<6?null:Math.atan2(y,x);};
  listen(dial,'pointerdown',event=>{if(event.button!==undefined&&event.button!==0)return;drag={id:event.pointerId,angle:angle(event)};dial.setPointerCapture?.(event.pointerId);dial.focus();event.preventDefault();event.stopPropagation();});
  listen(dial,'pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const next=angle(event);if(next!==null&&drag.angle!==null)change({yaw:orbitPointerDelta(drag.angle,next)});drag.angle=next;event.preventDefault();event.stopPropagation();});
  const end=event=>{if(drag?.id===event.pointerId){drag=null;if(dial.hasPointerCapture?.(event.pointerId))dial.releasePointerCapture?.(event.pointerId);}event.stopPropagation();};
  listen(dial,'pointerup',end);listen(dial,'pointercancel',end);listen(dial,'lostpointercapture',()=>{drag=null;});
  listen(dial,'wheel',event=>{if(!Number.isFinite(event.deltaY)||event.ctrlKey)return;change({zoom:Math.exp(Math.max(-100,Math.min(100,event.deltaY))*.002)});event.preventDefault();event.stopPropagation();},{passive:false});
  listen(dial,'keydown',event=>{const commands={ArrowLeft:{yaw:-Math.PI/24},ArrowRight:{yaw:Math.PI/24},ArrowUp:{pitch:Math.PI/36},ArrowDown:{pitch:-Math.PI/36},PageUp:{zoom:.85},PageDown:{zoom:1/.85}};const command=commands[event.key];if(command){change(command);event.preventDefault();event.stopPropagation();}});
  update();return {update,destroy(){destroyed=true;for(const [element,type,handler,options]of listeners)element.removeEventListener(type,handler,options);root.remove();}};
}
