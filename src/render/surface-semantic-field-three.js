import * as THREE from '../../vendor/three-r179.1/build/three.module.js';
import {
  contactStrength,
  createSemanticSkin,
  generatePlanarUv,
  resolveRegionAtUv,
  semanticLod,
} from '../domains/surface-semantic-field.js';

const DEFAULT_PALETTE = Object.freeze({
  base: '#04131d',
  base2: '#071d28',
  ink: '#dffbff',
  muted: '#7ab5c2',
  cyan: '#55e8ff',
  gold: '#d9ae60',
  grid: 'rgba(107,231,255,.12)',
});

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export function surfaceSlotCountForGeometry(geometry, shape = 'irregular') {
  if (!geometry) return 1;
  if (shape !== 'cube') return 1;
  let max = 0;
  for (const group of geometry.groups ?? []) max = Math.max(max, Number(group.materialIndex ?? 0));
  return Math.max(1, Math.min(6, max + 1));
}

/** Clone geometry and add a stable fallback UV chart only when needed. */
export function ensureSurfaceUv(geometry) {
  if (!geometry?.getAttribute) throw Error('SSF requires a BufferGeometry');
  const clone = geometry.clone();
  if (clone.getAttribute('uv')) return { geometry: clone, generated: false, fallback: null };
  const positions = clone.getAttribute('position');
  if (!positions) throw Error('SSF geometry requires positions');
  const chart = generatePlanarUv(positions.array);
  clone.setAttribute('uv', new THREE.BufferAttribute(chart.uv, 2));
  return { geometry: clone, generated: true, fallback: chart.fallback, projectionAxes: chart.projectionAxes };
}

function makeCanvas(size, canvasFactory = null) {
  if (canvasFactory) return canvasFactory(size, size);
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    return canvas;
  }
  return null;
}

function textureFromCanvas(canvas, colorSpace = THREE.SRGBColorSpace) {
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function wrapLines(ctx, text, width, maxLines = 3) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    } else line = next;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function canvasY(rect, size) {
  return (1 - rect.y - rect.h) * size;
}

function paintRegionShape(ctx, region, size, { fill = false, stroke = false } = {}) {
  const triangles = Array.isArray(region?.trianglesUv) ? region.trianglesUv : [];
  if (triangles.length) {
    for (const tri of triangles) {
      if (!Array.isArray(tri) || tri.length !== 3) continue;
      ctx.beginPath();
      ctx.moveTo(tri[0][0] * size, (1 - tri[0][1]) * size);
      ctx.lineTo(tri[1][0] * size, (1 - tri[1][1]) * size);
      ctx.lineTo(tri[2][0] * size, (1 - tri[2][1]) * size);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }
    return;
  }
  const r = region.rect;
  const x = r.x * size, y = canvasY(r, size), w = r.w * size, h = r.h * size;
  if (fill) ctx.fillRect(x, y, w, h);
  if (stroke) ctx.strokeRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
}

export function paintSemanticAtlas(canvas, regions, slot, { palette, focusedRegionId, contact = 0, lod = 2, time = 0 } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const p = { ...DEFAULT_PALETTE, ...palette };
  ctx.clearRect(0, 0, size, size);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, p.base2);
  bg.addColorStop(1, p.base);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1;
  const grid = 16;
  for (let i = 1; i < grid; i++) {
    const q = i / grid * size;
    ctx.beginPath(); ctx.moveTo(q, 0); ctx.lineTo(q, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, q); ctx.lineTo(size, q); ctx.stroke();
  }

  const pulse = 0.5 + 0.5 * Math.sin(time * 0.0026);
  for (const region of regions) {
    if ((region.surfaceSlot ?? 0) !== slot) continue;
    const r = region.rect;
    const x = r.x * size, y = canvasY(r, size), w = r.w * size, h = r.h * size;
    const focused = region.id === focusedRegionId;
    const accent = focused ? p.gold : p.cyan;
    const alpha = clamp(0.10 + region.priority * 0.11 + (focused ? 0.18 : 0) + contact * (0.08 + pulse * 0.06), 0.08, 0.46);
    ctx.fillStyle = accent.startsWith('#') ? hexToRgba(accent, alpha) : accent;
    paintRegionShape(ctx, region, size, { fill: true });
    ctx.strokeStyle = accent;
    ctx.globalAlpha = focused ? 0.98 : 0.52 + contact * 0.26;
    ctx.lineWidth = Math.max(1, size / 512 * (focused ? 2.4 : 1.1));
    paintRegionShape(ctx, region, size, { stroke: true });
    ctx.globalAlpha = 1;

    if (lod === 0) {
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(x + w * .5, y + h * .5, Math.max(2, Math.min(w, h) * .06), 0, Math.PI * 2); ctx.fill();
      continue;
    }

    const pad = Math.max(7, size * .008);
    ctx.textBaseline = 'top';
    ctx.fillStyle = p.muted;
    ctx.font = `700 ${Math.max(10, Math.round(size * .015))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillText(String(region.label).toUpperCase().slice(0, 28), x + pad, y + pad, Math.max(1, w - pad * 2));

    if (lod === 1) {
      ctx.fillStyle = p.ink;
      ctx.font = `650 ${Math.max(11, Math.round(size * .016))}px Inter, system-ui, sans-serif`;
      const compact = String(region.value ?? '').trim().slice(0, 36);
      if (compact) ctx.fillText(compact, x + pad, y + pad + size * .026, Math.max(1, w - pad * 2));
    } else if (lod >= 2) {
      ctx.fillStyle = p.ink;
      ctx.font = `650 ${Math.max(13, Math.round(size * (focused ? .026 : .022)))}px Inter, system-ui, sans-serif`;
      const lines = wrapLines(ctx, String(region.value ?? ''), Math.max(1, w - pad * 2), lod >= 3 ? 4 : 2);
      const lineH = Math.max(16, size * .030);
      let ty = y + pad + size * .028;
      for (const line of lines) { ctx.fillText(line, x + pad, ty, Math.max(1, w - pad * 2)); ty += lineH; }
    }
    if (lod >= 3 && region.action) {
      ctx.fillStyle = focused ? p.gold : p.cyan;
      ctx.font = `600 ${Math.max(9, Math.round(size * .012))}px ui-monospace, monospace`;
      ctx.fillText(`→ ${String(region.action).toUpperCase()}`, x + pad, y + h - pad - size * .015, Math.max(1, w - pad * 2));
    }
  }
}

function drawMasks(emissiveCanvas, roughnessCanvas, regions, slot, focusedRegionId, contact = 0) {
  const size = emissiveCanvas?.width ?? roughnessCanvas?.width ?? 0;
  if (!size) return;
  if (emissiveCanvas) {
    const ctx = emissiveCanvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    for (const region of regions) {
      if ((region.surfaceSlot ?? 0) !== slot) continue;
      const r = region.rect, focused = region.id === focusedRegionId;
      const value = Math.round(clamp((focused ? .92 : .12 + region.priority * .16) + contact * .42) * 255);
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      paintRegionShape(ctx, region, size, { fill: true });
    }
  }
  if (roughnessCanvas) {
    const ctx = roughnessCanvas.getContext('2d');
    ctx.fillStyle = 'rgb(190,190,190)'; ctx.fillRect(0, 0, size, size);
    for (const region of regions) {
      if ((region.surfaceSlot ?? 0) !== slot) continue;
      const r = region.rect, focused = region.id === focusedRegionId;
      const value = focused ? 78 : Math.round(145 - contact * 42);
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      paintRegionShape(ctx, region, size, { fill: true });
    }
  }
}

function hexToRgba(hex, alpha) {
  const text = hex.replace('#','');
  const value = text.length === 3 ? text.split('').map(c=>c+c).join('') : text.padEnd(6,'0').slice(0,6);
  const n = parseInt(value,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}

function makeMaterial({ map, emissiveMap, roughnessMap, accent = '#55e8ff', enableDisplacement = false }) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: map ?? null,
    emissive: new THREE.Color(accent),
    emissiveMap: emissiveMap ?? null,
    emissiveIntensity: 0.56,
    roughness: 0.5,
    roughnessMap: roughnessMap ?? null,
    metalness: 0.16,
    clearcoat: 0.38,
    clearcoatRoughness: 0.28,
    bumpMap: roughnessMap ?? null,
    bumpScale: 0.008,
    side: THREE.DoubleSide,
  });
  if (enableDisplacement && emissiveMap) {
    material.displacementMap = emissiveMap;
    material.displacementScale = 0.018;
    material.displacementBias = 0;
  }
  return material;
}

function geometryCanDisplace(geometry) {
  return (geometry?.getAttribute?.('position')?.count ?? 0) >= 96;
}

export class SurfaceObject {
  constructor({
    id,
    mesh,
    shape = 'irregular',
    content = [],
    authored = null,
    traits = {},
    palette = DEFAULT_PALETTE,
    atlasSize = 1024,
    canvasFactory = null,
    enableDisplacement = true,
  } = {}) {
    if (!mesh?.isMesh) throw Error('SurfaceObject requires a THREE.Mesh');
    this.id = String(id ?? mesh.name ?? mesh.uuid);
    this.mesh = mesh;
    this.shape = shape;
    this.palette = { ...DEFAULT_PALETTE,...palette };
    this.atlasSize = Math.max(256,Math.min(2048,Math.round(atlasSize)));
    const uv = ensureSurfaceUv(mesh.geometry);
    this.mesh.geometry = uv.geometry;
    this.uvFallback = uv.generated ? uv.fallback : null;
    this.surfaceSlots = surfaceSlotCountForGeometry(this.mesh.geometry,shape);
    this.skin = createSemanticSkin({id:this.id,shape,content,authored,surfaceSlots:this.surfaceSlots,traits});
    this.regions = [...this.skin.regions];
    this.focusedRegionId = null;
    this.contact = 0;
    this.lod = 2;
    this.time = 0;
    this.canvases = [];
    this.materials = [];
    this._regionListeners = new Set();
    this._baseEmissive = .46;
    this._lastRenderKey = '';
    this._ownedGeometry = this.mesh.geometry;

    for (let slot = 0; slot < this.surfaceSlots; slot++) {
      const colorCanvas = makeCanvas(this.atlasSize,canvasFactory);
      const emissiveCanvas = makeCanvas(this.atlasSize,canvasFactory);
      const roughnessCanvas = makeCanvas(this.atlasSize,canvasFactory);
      const map = textureFromCanvas(colorCanvas, THREE.SRGBColorSpace);
      const emissiveMap = textureFromCanvas(emissiveCanvas, THREE.SRGBColorSpace);
      const roughnessMap = textureFromCanvas(roughnessCanvas, THREE.NoColorSpace);
      const material = makeMaterial({map,emissiveMap,roughnessMap,accent:slot % 2 ? this.palette.gold : this.palette.cyan,enableDisplacement:enableDisplacement && geometryCanDisplace(this.mesh.geometry)});
      this.canvases.push({colorCanvas,emissiveCanvas,roughnessCanvas,map,emissiveMap,roughnessMap});
      this.materials.push(material);
    }
    this.mesh.material = this.materials.length === 1 ? this.materials[0] : this.materials;
    this.mesh.userData.ssf = this;
    this._syncSkin();
    this.renderSkin(true);
  }

  _syncSkin() {
    this.skin = Object.freeze({
      ...this.skin,
      regions: Object.freeze([...this.regions]),
      state: Object.freeze({
        focusedRegionId: this.focusedRegionId,
        contact: this.contact,
        lod: this.lod,
      }),
    });
  }

  _notifyRegionsChanged() {
    for (const listener of this._regionListeners) listener(this);
  }

  subscribeRegions(listener) {
    if (typeof listener !== 'function') return () => {};
    this._regionListeners.add(listener);
    return () => this._regionListeners.delete(listener);
  }

  renderSkin(force = false) {
    const key = `${this.focusedRegionId}|${this.contact.toFixed(2)}|${this.lod}|${Math.floor(this.time/180)}`;
    if (!force && key === this._lastRenderKey) return;
    this._lastRenderKey = key;
    for (let slot = 0; slot < this.surfaceSlots; slot++) {
      const c = this.canvases[slot];
      paintSemanticAtlas(c.colorCanvas, this.regions, slot, {palette:this.palette,focusedRegionId:this.focusedRegionId,contact:this.contact,lod:this.lod,time:this.time});
      drawMasks(c.emissiveCanvas,c.roughnessCanvas,this.regions,slot,this.focusedRegionId,this.contact);
      if (c.map) c.map.needsUpdate = true;
      if (c.emissiveMap) c.emissiveMap.needsUpdate = true;
      if (c.roughnessMap) c.roughnessMap.needsUpdate = true;
      const material = this.materials[slot];
      material.emissiveIntensity = this._baseEmissive + this.contact * .75 + (this.focusedRegionId ? .16 : 0);
      material.clearcoat = .32 + this.contact * .42;
      material.bumpScale = .007 + this.contact * .007;
      if (material.displacementMap) material.displacementScale = .009 + (this.focusedRegionId ? .018 : .006) + this.contact * .012;
      material.needsUpdate = false;
    }
  }

  hitTest(intersection) {
    if (!intersection || intersection.object !== this.mesh || !intersection.uv) return null;
    const surfaceSlot = clamp(Number(intersection.face?.materialIndex ?? 0), 0, this.surfaceSlots - 1);
    const faceIndex = Number(intersection.faceIndex);
    const topologyRegion = Number.isInteger(faceIndex)
      ? this.regions.find(region => Array.isArray(region.faceIndices) && region.faceIndices.includes(faceIndex))
      : null;
    const region = topologyRegion ?? resolveRegionAtUv(this.regions, intersection.uv, surfaceSlot);
    if (!region || region.interactive === false) return null;
    return { object:this, region, uv:intersection.uv.clone?.() ?? {...intersection.uv}, surfaceSlot, faceIndex, intersection };
  }

  focus(regionId = null) {
    const next = regionId && this.regions.some(r=>r.id===regionId) ? regionId : null;
    if (next === this.focusedRegionId) return;
    this.focusedRegionId = next;
    this._syncSkin();
    this.renderSkin(true);
  }

  updateContent(regionId, patch = {}) {
    let changed = false;
    this.regions = this.regions.map(region => {
      if (region.id !== regionId) return region;
      changed = true;
      return Object.freeze({...region,...patch,rect:region.rect});
    });
    if (changed) {
      this._syncSkin();
      this.renderSkin(true);
      this._notifyRegionsChanged();
    }
    return changed;
  }

  updateLod({ camera, viewportHeight = 900, focused = false, budget = 1 } = {}) {
    if (!camera) return this.lod;
    const sphere = this.mesh.geometry.boundingSphere ?? (this.mesh.geometry.computeBoundingSphere(),this.mesh.geometry.boundingSphere);
    const center = sphere.center.clone().applyMatrix4(this.mesh.matrixWorld);
    const worldScale = this.mesh.getWorldScale(new THREE.Vector3());
    const radius = sphere.radius * Math.max(worldScale.x,worldScale.y,worldScale.z);
    const distance = Math.max(.001,camera.position.distanceTo(center));
    const projectedPixels = viewportHeight * radius / (distance * Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 60) / 2));
    const priority = Math.max(.2,...this.regions.map(r=>r.priority ?? .5));
    const next = semanticLod({projectedPixels,viewCosine:1,focused,priority,budget});
    if (next !== this.lod) {
      this.lod=next;
      this._syncSkin();
      this.renderSkin(true);
    }
    return this.lod;
  }

  setContact(value) {
    const next = clamp(Number(value) || 0);
    if (Math.abs(next - this.contact) < .025) return;
    this.contact = next;
    this._syncSkin();
    this.renderSkin(true);
  }

  update(time = performance.now?.() ?? Date.now()) {
    this.time = Number(time) || 0;
    if (this.contact > .02 || this.focusedRegionId) this.renderSkin(false);
  }

  dispose() {
    for (const set of this.canvases) {
      set.map?.dispose(); set.emissiveMap?.dispose(); set.roughnessMap?.dispose();
    }
    for (const material of this.materials) material.dispose();
    this._ownedGeometry?.dispose?.();
    this._regionListeners.clear();
  }
}

export function surfaceContact(a, b, range = 1.4) {
  if (!(a instanceof SurfaceObject) || !(b instanceof SurfaceObject)) return 0;
  const worldSphere = object => {
    const g = object.mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const center = g.boundingSphere.center.clone().applyMatrix4(object.mesh.matrixWorld);
    const s = object.mesh.getWorldScale(new THREE.Vector3());
    return {center,radius:g.boundingSphere.radius * Math.max(s.x,s.y,s.z)};
  };
  const A = worldSphere(a), B = worldSphere(b);
  const strength = contactStrength({distance:A.center.distanceTo(B.center),radiusA:A.radius,radiusB:B.radius,range});
  a.setContact(strength); b.setContact(strength);
  return strength;
}

function createA11yMirror(surfaceObjects, onAction, documentRoot = globalThis.document) {
  if (!documentRoot?.createElement) return {root:null,sync(){},dispose(){}};
  const root = documentRoot.createElement('section');
  root.id = 'ssf-accessibility-mirror';
  root.setAttribute('aria-label','Surface information controls');
  Object.assign(root.style,{position:'fixed',left:'-10000px',top:'0',width:'1px',height:'1px',overflow:'hidden'});
  documentRoot.body?.append?.(root);
  const sync = () => {
    root.replaceChildren();
    for (const object of surfaceObjects) for (const region of object.regions) if (region.interactive) {
      const button = documentRoot.createElement('button');
      button.type='button';
      button.textContent=`${object.id}: ${region.label} ${region.value ?? ''}`;
      button.onclick=()=>{object.focus(region.id);onAction?.({object,region,source:'keyboard'});};
      root.append(button);
    }
  };
  const unsubs = surfaceObjects.map(object => object.subscribeRegions?.(sync)).filter(Boolean);
  sync();
  return {root,sync,dispose(){for(const unsub of unsubs)unsub?.();root.remove();}};
}

export function createSurfaceInteractionSystem({camera,domElement,surfaceObjects=[],onAction=null,documentRoot=globalThis.document}={}) {
  if (!camera || !domElement) throw Error('SSF interaction requires camera and domElement');
  const objects = [...surfaceObjects];
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null;
  const mirror = createA11yMirror(objects,onAction,documentRoot);

  const locate = event => {
    const rect = domElement.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const nearest = raycaster.intersectObjects(objects.map(o=>o.mesh), false)[0] ?? null;
    if (!nearest) return null;
    const owner = nearest.object.userData.ssf;
    return owner?.hitTest(nearest) ?? null;
  };
  let gesture = null;
  const pointerDown = event => {
    gesture = {pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  };
  const pointerMove = event => {
    if (gesture?.pointerId === event.pointerId) {
      const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
      if (dx*dx+dy*dy > 36) gesture.moved=true;
    }
    const hit = locate(event);
    if (hovered?.object !== hit?.object || hovered?.region?.id !== hit?.region?.id) {
      hovered?.object?.focus(null);
      hovered = hit;
      hovered?.object?.focus(hovered.region.id);
      domElement.style.cursor = hovered ? 'pointer' : 'grab';
    }
  };
  const pointerUp = event => {
    const active = gesture;
    gesture = null;
    if (!active || active.pointerId !== event.pointerId || active.moved) return;
    const dx=event.clientX-active.x,dy=event.clientY-active.y;
    if (dx*dx+dy*dy > 36) return;
    const hit = locate(event);
    if (!hit) return;
    hit.object.focus(hit.region.id);
    onAction?.({...hit,source:'pointer'});
  };
  const pointerCancel = () => { gesture=null; };
  domElement.addEventListener('pointerdown',pointerDown);
  domElement.addEventListener('pointermove',pointerMove);
  domElement.addEventListener('pointerup',pointerUp);
  domElement.addEventListener('pointercancel',pointerCancel);

  return {
    objects,raycaster,mirror,
    selectFromRay(origin,direction,{source='xr'}={}){
      raycaster.ray.origin.copy(origin);raycaster.ray.direction.copy(direction).normalize();
      const nearest=raycaster.intersectObjects(objects.map(o=>o.mesh),false)[0]??null;
      if(!nearest)return null;
      const owner=nearest.object.userData.ssf,hit=owner?.hitTest(nearest);
      if(hit){owner.focus(hit.region.id);onAction?.({...hit,source});return hit;}
      return null;
    },
    dispose(){
      domElement.removeEventListener('pointerdown',pointerDown);
      domElement.removeEventListener('pointermove',pointerMove);
      domElement.removeEventListener('pointerup',pointerUp);
      domElement.removeEventListener('pointercancel',pointerCancel);
      mirror.dispose();
    }
  };
}
