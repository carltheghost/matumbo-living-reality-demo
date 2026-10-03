/** Live information painted on the object's own material. The adapter owns all
 * feature state and actions; this module owns only layout, paint and UV picking.
 * No cloned controls, iframe captures, extra meshes or recurring timers. */

const COLORS = Object.freeze({
  background: '#061427', ink: '#edf6ff', muted: '#a6bfd4', cyan: '#70e2f5',
  line: '#294862', control: '#102e48', disabled: '#7d91a3', focus: '#1c4964',
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const textOf = value => String(value ?? '').replace(/\r/g, '').trim();
const INPUT_KINDS = new Set(['input', 'select', 'textarea']);
const ACTION_KINDS = new Set(['button', 'link', 'summary', ...INPUT_KINDS]);

function chartSpec(chart, index, size) {
  const aspect = clamp(Number(chart.aspect ?? (chart.width / chart.height)) || 1, .35, 3);
  const width = Math.round(clamp(size * Math.sqrt(aspect), 256, 1536));
  const height = Math.round(clamp(size / Math.sqrt(aspect), 256, 1536));
  const supplied = chart.contentBounds ?? chart.safeBounds;
  const bounds = supplied && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(supplied[key]))
    ? supplied : {x: .065, y: .19, width: .87, height: .64};
  const x = clamp(bounds.x, .02, .8), y = clamp(bounds.y, .12, .7);
  const w = clamp(bounds.width, .15, .98 - x), h = clamp(bounds.height, .12, .9 - y);
  // Circular caps and triangular ends supply a conservative readable rectangle.
  // Keep headers and paging controls in it too, rather than clipping them off
  // near the edge of a nonrectangular face.
  const constrained = w < .75;
  const frame = constrained ? {x, y, width: w, height: h} : {x, y: .045, width: w, height: .923};
  return {id: textOf(chart.id) || `surface-${index + 1}`, label: textOf(chart.label) || `Surface ${index + 1}`,
    shape: textOf(chart.shape), width, height, frame,
    bounds: constrained ? {x, y: y + h * .25, width: w, height: h * .51} : {x, y, width: w, height: h}};
}

function font(context, pixels, weight = 400) {
  context.font = `${weight} ${pixels}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

/** Wrap long words too: a URL must not paint beyond the selectable surface. */
function wrapText(context, text, width) {
  const lines = [];
  for (const paragraph of textOf(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const proposed = line ? `${line} ${word}` : word;
      if (context.measureText(proposed).width <= width) { line = proposed; continue; }
      if (line) { lines.push(line); line = ''; }
      let part = '';
      for (const letter of word) {
        if (part && context.measureText(part + letter).width > width) { lines.push(part); part = letter; }
        else part += letter;
      }
      line = part;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function featureContext(feature, count) {
  const label = textOf(feature.label ?? feature.title ?? feature.name ?? feature.id) || 'Living object';
  const details = [
    {id: '@context:description', kind: 'text', text: textOf(feature.description ?? feature.summary) || `${label} — controls and information share this object's surface.`},
    {id: '@context:boundary', kind: 'text', text: textOf(feature.boundary) || 'Changes follow the feature’s existing controls and permissions.'},
  ];
  for (const [index, source] of (Array.isArray(feature.sources) ? feature.sources : []).entries()) {
    const value = typeof source === 'string' ? source : [source.label ?? source.name, source.url].filter(Boolean).join('\n');
    if (value) details.push({id: `@context:source:${index}`, kind: 'text', text: `Source\n${value}`});
  }
  if (feature.groupLabel ?? feature.group) details.push({id: '@context:group', kind: 'text', text: `Space\n${textOf(feature.groupLabel ?? feature.group)}`});
  details.push(
    {id: '@context:reading', kind: 'text', text: 'Turn the object to read the information around its sides.'},
    {id: '@context:interaction', kind: 'text', text: 'Select a control on the surface to use it.'},
    {id: '@context:continuity', kind: 'text', text: 'Your current selection and entered values belong to this same object.'},
    {id: '@context:paging', kind: 'text', text: 'When there is more information, use Next or Previous on any surface.'},
  );
  // These are real document facts, never manufactured provider values.
  for (let index = details.length; index < count; index++) details.push({
    id: `@context:position:${index}`, kind: 'text', text: `${label}\nSurface ${index + 1} of ${count}. Turn to continue reading this object.`,
  });
  return details;
}

function cleanBlocks(raw, feature, chartCount) {
  const input = Array.isArray(raw) ? raw : raw?.blocks ?? [];
  const blocks = input.filter(Boolean).map((block, index) => ({...block,
    id: textOf(block.id) || `block-${index}`, kind: textOf(block.kind) || 'text',
    text: textOf(block.text), value: block.inputType === 'password' ? '' : textOf(block.value),
    disabled: Boolean(block.disabled), actionId: block.actionId == null ? null : String(block.actionId),
  })).filter(block => block.text || block.value || block.actionId || ['image', 'canvas', 'media'].includes(block.kind));
  const supplemental = featureContext(feature, chartCount);
  // Short documents get useful, truthful context distributed across their whole
  // body. Long documents spend the available surface on the feature itself.
  while (blocks.length < chartCount && supplemental.length) blocks.push(supplemental.shift());
  return blocks.length ? blocks : featureContext(feature, chartCount);
}

function signatureOf(blocks, raw) {
  return JSON.stringify({revision: raw?.revision ?? null, blocks: blocks.map(block => ({
    id: block.id, kind: block.kind, text: block.text, value: block.value,
    actionId: block.actionId, disabled: block.disabled, checked: block.checked, focused: Boolean(block.focused),
    inputType: block.inputType, options: block.options, selected: block.selected,
    expanded: block.expanded, valueText: block.valueText, min: block.min, max: block.max, readOnly: block.readOnly,
    src: block.element?.currentSrc ?? block.element?.src ?? '',
    loaded: block.element?.complete, width: block.element?.width, height: block.element?.height,
  }))});
}

function blockLines(block, context, contentWidth, scale) {
  const isAction = block.actionId != null || ACTION_KINDS.has(block.kind);
  const weight = block.kind === 'heading' ? 650 : isAction ? 550 : 400;
  const fontSize = (block.kind === 'heading' ? 30 : isAction ? 26 : 25) * scale;
  const padding = isAction ? 15 * scale : 0;
  font(context, fontSize, weight);
  let title = block.text;
  if (block.kind === 'row' && Array.isArray(block.cells)) title = block.cells.map(textOf).join('  ·  ');
  if (typeof block.checked === 'boolean') title = `${block.checked ? '✓' : '○'} ${title}`;
  else if (typeof block.expanded === 'boolean') title = `${block.expanded ? '▾' : '▸'} ${title}`;
  else if (block.selected) title = `✓ ${title}`;
  if (!INPUT_KINDS.has(block.kind) && (block.valueText || block.value)) {
    const value=block.valueText || block.value;
    title += `\n${value}${block.role==='progress'||block.role==='meter'?` / ${block.max??1}`:''}`;
  }
  const lines = wrapText(context, title, Math.max(20, contentWidth - padding * 2));
  if (INPUT_KINDS.has(block.kind)) {
    let value = block.value;
    if (block.kind === 'select') value = block.options?.find(option => String(option.value) === value)?.text ?? value;
    if (block.inputType === 'password') value = 'Private value';
    if (!['checkbox', 'radio'].includes(block.inputType)) lines.push(...wrapText(context, value || 'Select to edit', Math.max(20, contentWidth - padding * 2)));
  }
  return {lines, isAction, padding, fontSize, weight, lineHeight: fontSize * 1.35};
}

function imageAllowed(element) {
  if (!element) return false;
  const tag = String(element.tagName ?? element.nodeName ?? '').toUpperCase();
  if (tag === 'CANVAS') {
    // Checking origin cleanliness before drawImage avoids tainting the atlas.
    try { return Boolean(element.width && element.height && element.toDataURL?.()); } catch { return false; }
  }
  if (tag !== 'IMG' || !element.complete || !element.naturalWidth) return false;
  try {
    const base = globalThis.location?.href ?? 'http://localhost/';
    const url = new URL(element.currentSrc || element.src, base);
    return ['data:', 'blob:'].includes(url.protocol) || url.origin === new URL(base).origin || ['anonymous', 'use-credentials'].includes(element.crossOrigin);
  } catch { return false; }
}

/** One texture per geometry chart; all textures share one canonical document. */
export function createRealitySurfaceAtlas({THREE, charts, document: adapter, feature = {}, size = 768, typeScale = 1, onNavigate} = {}) {
  if (!THREE?.CanvasTexture || !THREE?.MeshBasicMaterial) throw new TypeError('Surface atlas requires Three.js texture and material constructors');
  if (!Array.isArray(charts) || !charts.length) throw new TypeError('Surface atlas requires at least one geometry chart');
  if (typeof adapter?.read !== 'function') throw new TypeError('Surface atlas requires a canonical document adapter');
  const requestedSize = Number(size);
  const specs = charts.map((chart, index) => chartSpec(chart, index, Number.isFinite(requestedSize) ? clamp(requestedSize, 256, 1536) : 768));
  const readingOrder = specs.map((_, index) => index).sort((a, b) => Number(specs[b].id === 'front') - Number(specs[a].id === 'front'));
  const title = textOf(feature.label ?? feature.title ?? feature.name ?? feature.id) || 'Living object';
  const surfaces = specs.map(spec => {
    const canvas = globalThis.document?.createElement?.('canvas');
    if (!canvas) throw new Error('A canvas-capable document is required');
    canvas.width = spec.width; canvas.height = spec.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable for the object surface');
    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace != null) texture.colorSpace = THREE.SRGBColorSpace;
    if (THREE.LinearFilter != null) texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({map: texture, color: 0xffffff, toneMapped: false});
    return {...spec, canvas, context, texture, material, regions: [], placed: []};
  });
  let blocks = [], pages = [], page = 0, revision = 0, lastSignature = '', disposed = false, focusActionId = null;

  function makeFragments() {
    // Fragment long paragraphs so every part remains reachable, while a control
    // remains one atomic hit target. Use the narrowest chart as the wrap limit.
    const minWidth = Math.min(...surfaces.map(surface => surface.width * surface.bounds.width));
    const minHeight = Math.min(...surfaces.map(surface => surface.height * surface.bounds.height));
    const scale = Math.min(...surfaces.map(surface => Math.min(surface.width, surface.height) / 768)) * clamp(Number(typeScale)||1,1,2.2);
    const context = surfaces[0].context;
    const fragments = [];
    for (const block of blocks) {
      const metrics = blockLines(block, context, minWidth, scale);
      // A canvas is one spatial control. Give it a whole chart instead of
      // squeezing it to the smallest triangular end's paragraph height.
      if (['image', 'canvas', 'pointer'].includes(block.kind)) {
        const source = block.element;
        const aspect = (Number(source?.naturalWidth || source?.width || source?.clientWidth) || 1) /
          (Number(source?.naturalHeight || source?.height || source?.clientHeight) || 1);
        const preferredChart = readingOrder.reduce((best, index) => {
          const room = surface => Math.min(surface.width * surface.bounds.width / aspect,
            surface.height * surface.bounds.height - metrics.lineHeight - metrics.padding * 2);
          return room(surfaces[index]) > room(surfaces[best]) ? index : best;
        }, readingOrder[0]);
        fragments.push({block, ...metrics, lines: metrics.lines.slice(0, 1), scale,
          visual: true, preferredChart, part: 0, height: minHeight});
        continue;
      }
      const visualHeight = 0;
      const maxLines = Math.max(1, Math.floor((minHeight - metrics.padding * 2 - 16 * scale - visualHeight) / metrics.lineHeight));
      if (metrics.isAction) {
        const lines = metrics.lines.slice(0, maxLines);
        if (lines.length < metrics.lines.length) lines[lines.length - 1] = `${lines.at(-1).slice(0, -1)}…`;
        fragments.push({block, ...metrics, lines, scale, visualHeight, part: 0,
          height: Math.min(minHeight, lines.length * metrics.lineHeight + metrics.padding * 2 + visualHeight + 14 * scale)});
      } else {
        for (let start = 0; start < metrics.lines.length; start += maxLines) {
          const lines = metrics.lines.slice(start, start + maxLines);
          fragments.push({block, ...metrics, lines, scale, part: start / maxLines,
            visualHeight: start ? 0 : visualHeight,
            height: Math.min(minHeight, lines.length * metrics.lineHeight + (start ? 0 : visualHeight) + 16 * scale)});
        }
      }
    }
    return fragments;
  }

  function reflow() {
    const pending = makeFragments(); pages = [];
    while (pending.length) {
      const chartsForPage = surfaces.map(() => []);
      for (let order = 0; order < readingOrder.length && pending.length; order++) {
        const index = readingOrder[order];
        const surface = surfaces[index], capacity = surface.height * surface.bounds.height;
        const share = Math.max(1, Math.ceil(pending.length / (surfaces.length - order)));
        let used = 0;
        while (pending.length && chartsForPage[index].length < share) {
          const next = pending[0];
          if (next.visual) {
            if (chartsForPage[index].length || index !== next.preferredChart) break;
            chartsForPage[index].push({...pending.shift(), height: capacity,
              visualHeight: Math.max(1, capacity - next.lineHeight - next.padding * 2 - 12 * next.scale)});
            break;
          }
          if (used + next.height > capacity && chartsForPage[index].length) break;
          chartsForPage[index].push(pending.shift()); used += next.height;
        }
      }
      pages.push(chartsForPage);
    }
    if (!pages.length) pages = [surfaces.map(() => [])];
    page = clamp(page, 0, pages.length - 1);
  }

  function addRegion(surface, region) {
    surface.regions.push({...region, x: region.x / surface.width, y: region.y / surface.height,
      width: region.width / surface.width, height: region.height / surface.height});
  }

  function paint(surface, chartIndex) {
    const {context: ctx, width: w, height: h} = surface;
    const scale = Math.min(w, h) / 768;
    surface.regions = []; surface.placed = [];
    ctx.fillStyle = COLORS.background; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createLinearGradient(0, 0, w, h);
    glow.addColorStop(0, '#103552'); glow.addColorStop(.55, '#091d32'); glow.addColorStop(1, '#071425');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    // Full-bleed markings travel with the actual shape, without panel borders.
    ctx.fillStyle = COLORS.cyan; ctx.fillRect(0, 0, w, 4 * scale);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const left = surface.bounds.x * w, contentWidth = surface.bounds.width * w;
    const frameTop = surface.frame.y * h, frameHeight = surface.frame.height * h;
    const headerScale = Math.min(scale, frameHeight / 450);
    font(ctx, 18 * headerScale, 600); ctx.fillStyle = COLORS.cyan;
    ctx.fillText(`${surface.shape || feature.shape || 'OBJECT'} · ${readingOrder.indexOf(chartIndex) + 1}/${surfaces.length}`.toUpperCase(), left, frameTop, contentWidth);
    font(ctx, 31 * headerScale, 650); ctx.fillStyle = COLORS.ink;
    ctx.fillText(title, left, frameTop + frameHeight * .047, contentWidth);
    font(ctx, 18 * headerScale, 450); ctx.fillStyle = COLORS.muted;
    ctx.fillText(surface.label, left, frameTop + frameHeight * .109, contentWidth);
    let y = surface.bounds.y * h;
    const entries = pages[page]?.[chartIndex] ?? [];
    for (const entry of entries) {
      const {block, lines, padding, lineHeight, fontSize, weight, visualHeight, height} = entry;
      surface.placed.push({blockId: block.id, part: entry.part, kind: block.kind, lineCount: lines.length});
      if (entry.isAction) {
        const focused=block.focused||block.actionId===focusActionId;
        ctx.fillStyle = block.disabled ? '#102333' : focused ? '#214867' : block.selected ? COLORS.focus : COLORS.control; ctx.fillRect(left, y, contentWidth, height - 8 * scale);
        ctx.fillStyle = block.disabled ? COLORS.disabled : focused ? '#f1d383' : COLORS.cyan; ctx.fillRect(left, y, (focused?6:3) * scale, height - 8 * scale);
      }
      font(ctx, fontSize, weight);
      ctx.fillStyle = block.disabled ? COLORS.disabled : block.kind === 'heading' ? COLORS.cyan : COLORS.ink;
      lines.forEach((line, index) => ctx.fillText(line, left + padding, y + padding + index * lineHeight, contentWidth - padding * 2));
      let imageRect = null;
      if (visualHeight) {
        const imageY = y + padding + lines.length * lineHeight;
        const source = block.element;
        const sourceWidth = Number(source?.naturalWidth || source?.width || source?.clientWidth) || 1;
        const sourceHeight = Number(source?.naturalHeight || source?.height || source?.clientHeight) || 1;
        const availableWidth = contentWidth - padding * 2;
        const fit = Math.min(availableWidth / sourceWidth, visualHeight / sourceHeight);
        imageRect = {x: left + padding + (availableWidth - sourceWidth * fit) / 2,
          y: imageY + (visualHeight - sourceHeight * fit) / 2,
          width: sourceWidth * fit, height: sourceHeight * fit};
        if (imageAllowed(block.element)) {
          try {
            // WebGL drawing buffers may be cleared after compositing. Ask the
            // original owner for a synchronous frame, then copy in this task.
            if(block.kind==='canvas'&&typeof globalThis.CustomEvent==='function')block.element.dispatchEvent?.(new CustomEvent('matumbo:surface-capture'));
            ctx.drawImage(block.element, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
          }
          catch { ctx.fillStyle = COLORS.muted; ctx.fillText('Preview unavailable', left + padding, imageY, contentWidth - padding * 2); }
        } else {
          ctx.fillStyle = COLORS.muted;
          ctx.fillText(block.kind === 'canvas' ? 'Interactive canvas' : block.kind === 'pointer' ? 'Touch surface' : 'Image preview unavailable', left + padding, imageY, contentWidth - padding * 2);
        }
      }
      if (block.actionId != null) {
        const pointerSurface=['canvas','pointer'].includes(block.kind)&&visualHeight>0;
        addRegion(surface, {x: pointerSurface?imageRect.x:left,
          y: pointerSurface?imageRect.y:y,
          width: pointerSurface?imageRect.width:contentWidth,
          height: pointerSurface?imageRect.height:height-8*scale,
          actionId: block.actionId, blockId: block.id, kind: block.kind, inputType: block.inputType,
          pointerSurface, focused: Boolean(block.focused||block.actionId===focusActionId),
          label: block.text, disabled: block.disabled});
      }
      y += height;
    }
    if (!entries.length) {
      font(ctx, 25 * scale); ctx.fillStyle = COLORS.ink;
      const message = pages.length > 1 ? 'This page continues on the other surfaces.' : 'Turn the object to explore its controls.';
      wrapText(ctx, message, contentWidth).forEach((line, index) => ctx.fillText(line, left, y + index * 34 * scale, contentWidth));
    }
    const footerScale = clamp(Number(typeScale)||1,1,2.2);
    const buttonFraction = .06 * footerScale;
    const footerY = frameTop + frameHeight * (1-buttonFraction), buttonHeight = frameHeight * buttonFraction;
    font(ctx, 17 * headerScale * footerScale, 550); ctx.fillStyle = COLORS.muted;
    ctx.fillText(`PAGE ${page + 1} / ${pages.length}`, left, footerY - frameHeight * .045, contentWidth);
    if (pages.length > 1) {
      for (const [direction, x, disabled] of [['previous', left, page === 0], ['next', left + contentWidth * .53, page === pages.length - 1]]) {
        const width = contentWidth * .47;
        ctx.fillStyle = disabled ? '#0d2032' : COLORS.focus; ctx.fillRect(x, footerY, width, buttonHeight);
        ctx.fillStyle = disabled ? COLORS.disabled : COLORS.ink;
        ctx.fillText(direction === 'previous' ? '← Previous' : 'Next →', x + 9 * headerScale, footerY + 4 * headerScale, width - 18 * headerScale);
        addRegion(surface, {x, y: footerY, width, height: buttonHeight, actionId: `@atlas:${direction}`, kind: 'navigation', label: direction, disabled});
      }
    } else {
      ctx.fillStyle = COLORS.cyan; ctx.fillText('TURN TO EXPLORE  ·  360°', left, footerY + 4 * headerScale, contentWidth);
    }
    surface.texture.needsUpdate = true;
  }

  function paintAll() { surfaces.forEach(paint); revision++; }

  function refresh(options = false) {
    if (disposed) return false;
    const raw = adapter.read();
    const nextBlocks = cleanBlocks(raw, feature, surfaces.length);
    const nextSignature = signatureOf(nextBlocks, raw);
    const force = options === true || options?.force === true;
    if (!force && nextSignature === lastSignature) return false;
    blocks = nextBlocks; focusActionId=blocks.find(block=>block.focused&&block.actionId)?.actionId??null;
    lastSignature = nextSignature; reflow(); paintAll(); return true;
  }

  function hit(chartIndex, uv) {
    if (disposed || !Number.isInteger(chartIndex) || !surfaces[chartIndex] || !uv) return null;
    const u = Array.isArray(uv) ? uv[0] : uv.x, v = Array.isArray(uv) ? uv[1] : uv.y;
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) return null;
    const y = 1 - v;
    const found = surfaces[chartIndex].regions.find(region => u >= region.x && u < region.x + region.width && y >= region.y && y < region.y + region.height);
    return found ? {...found, chartIndex, chartId: surfaces[chartIndex].id,
      subUV:{x:(u-found.x)/found.width,y:(y-found.y)/found.height}} : null;
  }

  function navigate(nextPage) {
    if (disposed) return false;
    const next = clamp(nextPage, 0, pages.length - 1);
    if (next === page) return false;
    page = next; paintAll();
    const result = {kind: 'navigate', page, pageCount: pages.length};
    onNavigate?.(result); return result;
  }

  function activate(chartIndex, uv) {
    const target = hit(chartIndex, uv);
    if (!target || target.disabled) return false;
    if (target.actionId === '@atlas:previous') return navigate(page - 1);
    if (target.actionId === '@atlas:next') return navigate(page + 1);
    const result = adapter.activate?.(target.actionId) ?? false;
    refresh(); return result;
  }

  function snapshot() {
    return {page, pageCount: pages.length, revision, disposed, blockCount: blocks.length,focusActionId,
      textureCount: disposed ? 0 : surfaces.length, canonicalFeatureId: feature.id ?? null,
      charts: surfaces.map((surface, index) => ({index, id: surface.id, label: surface.label,
        width: surface.width, height: surface.height, bounds: {...surface.bounds},
        blocks: surface.placed.map(item => ({...item})), regions: surface.regions.map(region => ({...region}))}))};
  }

  function reveal(actionId) {
    if(disposed||actionId==null)return null;
    const id=String(actionId);let destination=null;
    for(let pageIndex=0;pageIndex<pages.length&&!destination;pageIndex++)for(let chartIndex=0;chartIndex<surfaces.length;chartIndex++){
      if(pages[pageIndex][chartIndex].some(entry=>entry.block.actionId===id||entry.block.id===id)){destination={page:pageIndex,chartIndex};break;}
    }
    if(!destination)return null;
    const changedPage=destination.page!==page;
    page=destination.page;focusActionId=id;paintAll();
    if(changedPage)onNavigate?.({kind:'navigate',page,pageCount:pages.length});
    let region=surfaces[destination.chartIndex].regions.find(item=>item.actionId===id);
    if(!region){const surface=surfaces[destination.chartIndex];let offset=surface.bounds.y*surface.height;for(const entry of pages[page][destination.chartIndex]){if(entry.block.id===id){region={x:surface.bounds.x,y:offset/surface.height,width:surface.bounds.width,height:entry.height/surface.height,blockId:id,kind:entry.block.kind};break;}offset+=entry.height;}}
    return region?{...region,chartIndex:destination.chartIndex,chartId:surfaces[destination.chartIndex].id,page,
      uv:{x:region.x+region.width/2,y:1-region.y-region.height/2}}:null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const surface of surfaces) { surface.texture.dispose(); surface.material.dispose(); surface.regions = []; surface.placed = []; }
    blocks = []; pages = [];
  }

  refresh();
  return {materials: surfaces.map(surface => surface.material), refresh, hit, activate,reveal,
    scroll: delta => Number.isFinite(delta) && delta !== 0 ? navigate(page + Math.sign(delta)) : false,
    snapshot, dispose};
}
