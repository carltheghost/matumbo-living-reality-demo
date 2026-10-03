/**
 * Bounded, dependency-free inspection of a standalone core glTF 2.0 binary.
 * This never loads a scene, decodes an image, executes content, or proves that
 * geometry renders, a character is rigged correctly, or an asset is licensed.
 * Format reference: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
 */
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS = 100_000;
const MAX_JSON_VALUES = 500_000;
const MAX_COMPONENT_READS = 20_000_000;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENTS = {
  5120: { size: 1, read: 'getInt8' },
  5121: { size: 1, read: 'getUint8', restart: 255 },
  5122: { size: 2, read: 'getInt16' },
  5123: { size: 2, read: 'getUint16', restart: 65535 },
  5125: { size: 4, read: 'getUint32', restart: 4294967295 },
  5126: { size: 4, read: 'getFloat32' },
};
const SHAPES = { SCALAR: [1, 1], VEC2: [1, 2], VEC3: [1, 3], VEC4: [1, 4], MAT2: [2, 2], MAT3: [3, 3], MAT4: [4, 4] };

function fail(message) { throw new Error(`GLB inspection: ${message}`); }
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  return value;
}
function integer(value, path, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${path} is outside its integer bounds.`);
  return value;
}
function list(value, path, required = false) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS || (required && !value.length)) fail(`${path} must be a bounded${required ? ' nonempty' : ''} array.`);
  return value;
}
function reference(value, items, path) {
  return items[integer(value, path, 0, items.length - 1)];
}
function vector(value, length, path) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) fail(`${path} must contain ${length} finite numbers.`);
}

// A traversal budget also bounds hostile deeply nested extras before any walk.
function checkJSONBudget(root) {
  const pending = [[root, 0]];
  let visited = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++visited > MAX_JSON_VALUES || depth > 64) fail('JSON exceeds the inspection complexity limit.');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('JSON contains a non-finite number.');
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value) && value.length > MAX_ITEMS) fail('JSON array exceeds the inspection count limit.');
    for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
}

// Unknown extensions may change storage or reference other resources. A clear
// unsupported result is safer than silently inspecting only their core shell.
function coreObject(value, path) {
  object(value, path);
  if (value.extensions !== undefined && Object.keys(object(value.extensions, `${path}.extensions`)).length) {
    fail(`${path}: extensions are unsupported by this core-only inspector.`);
  }
  return value;
}

function readContainer(bytes) {
  if (bytes.byteLength < 20) fail('Truncated GLB header or JSON chunk.');
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67) fail('Invalid GLB magic.');
  if (view.getUint32(4, true) !== 2) fail('Only GLB version 2 is supported.');
  if (view.getUint32(8, true) !== bytes.byteLength) fail('Declared GLB length does not match the file.');
  let offset = 12;
  let jsonBytes;
  let bin;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail('Truncated chunk header.');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (length % 4 || start + length > bytes.byteLength) fail('Invalid chunk boundary or alignment.');
    if (!jsonBytes) {
      if (type !== JSON_CHUNK || !length) fail('First chunk must be nonempty JSON.');
      jsonBytes = new Uint8Array(bytes, start, length);
    } else {
      if (type !== BIN_CHUNK || bin) fail('Duplicate or unsupported GLB chunk.');
      bin = { start, length };
    }
    offset = start + length;
  }
  let document;
  try {
    // Keep a BOM visible so JSON.parse rejects it; UTF-8 replacement is forbidden.
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(jsonBytes));
  } catch { fail('JSON chunk must be valid UTF-8 and JSON.'); }
  checkJSONBudget(document);
  return { document, view, bin };
}

/**
 * @returns {Promise<Readonly<{filename:string,byteLength:number,sha256:string,
 * sceneCount:number,nodeCount:number,meshCount:number,materialCount:number,
 * animationCount:number,vertexCount:number,triangleCount:number,
 * inspection:'structure-only',externalResources:false,warnings:ReadonlyArray<string>}>>}
 */
export async function inspectCreatorGLB(arrayBuffer, { filename = 'asset.glb' } = {}) {
  if (!(arrayBuffer instanceof ArrayBuffer)) fail('Expected an ArrayBuffer.');
  if (arrayBuffer.byteLength > MAX_BYTES) fail('File exceeds the 25 MiB inspection limit.');
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 240 || /[\u0000-\u001f\u007f]/u.test(filename)) fail('Invalid filename.');
  // The caller can mutate its buffer while digest() yields. Inspect and hash the
  // same private snapshot so metadata and digest always describe the same bytes.
  const bytes = arrayBuffer.slice(0);
  const { document: doc, view, bin } = readContainer(bytes);
  coreObject(doc, 'document');
  const asset = coreObject(doc.asset, 'asset');
  if (asset.version !== '2.0' || (asset.minVersion !== undefined && asset.minVersion !== '2.0')) fail('Only glTF asset version 2.0 is supported.');
  for (const field of ['extensionsUsed', 'extensionsRequired']) {
    if (list(doc[field], field).length) fail(`${field}: extensions are unsupported by this core-only inspector.`);
  }
  const arrays = {};
  for (const name of ['buffers', 'bufferViews', 'accessors', 'scenes', 'nodes', 'meshes', 'materials', 'animations', 'images', 'textures', 'samplers', 'skins', 'cameras']) {
    arrays[name] = list(doc[name], name);
    arrays[name].forEach((value, index) => coreObject(value, `${name}[${index}]`));
  }
  const { buffers, bufferViews, accessors, scenes, nodes, meshes, materials, animations, images, textures, samplers, skins, cameras } = arrays;
  if (buffers.length > 1) fail('Only one embedded buffer is supported.');
  buffers.forEach((buffer, index) => {
    if (buffer.uri !== undefined) fail('Buffer URI resources are unsupported; embed the buffer in GLB.');
    const length = integer(buffer.byteLength, `buffers[${index}].byteLength`, 1, MAX_BYTES);
    if (!bin || length > bin.length || bin.length - length > 3) fail('Embedded buffer length does not match the BIN chunk.');
    for (let i = length; i < bin.length; i++) if (view.getUint8(bin.start + i)) fail('BIN padding must be zero.');
  });
  if (bin && !buffers.length) fail('BIN chunk has no declared embedded buffer.');
  bufferViews.forEach((bufferView, index) => {
    const path = `bufferViews[${index}]`;
    const buffer = reference(bufferView.buffer, buffers, `${path}.buffer`);
    const offset = integer(bufferView.byteOffset ?? 0, `${path}.byteOffset`);
    const length = integer(bufferView.byteLength, `${path}.byteLength`, 1);
    if (offset + length > buffer.byteLength) fail(`${path} exceeds its embedded buffer bounds.`);
    if (bufferView.byteStride !== undefined && (integer(bufferView.byteStride, `${path}.byteStride`, 4, 252) % 4)) fail(`${path}.byteStride must be a multiple of four.`);
    if (bufferView.target !== undefined && ![34962, 34963].includes(bufferView.target)) fail(`${path}.target is invalid.`);
  });
  const viewKinds = new Map();
  const viewAttributes = new Map();
  function claimView(index, kind, accessorIndex) {
    const prior = viewKinds.get(index);
    if (prior && prior !== kind) fail(`bufferViews[${index}] mixes incompatible data kinds.`);
    viewKinds.set(index, kind);
    if (kind !== 'vertex' && bufferViews[index].byteStride !== undefined) fail(`${kind} bufferViews cannot have byteStride.`);
    if (kind === 'vertex') {
      const used = viewAttributes.get(index) ?? new Set();
      used.add(accessorIndex);
      viewAttributes.set(index, used);
      if (used.size > 1 && bufferViews[index].byteStride === undefined) fail('Shared vertex attribute bufferViews require byteStride.');
    }
  }

  let componentReads = 0;
  const layouts = accessors.map((accessor, index) => {
    const path = `accessors[${index}]`;
    if (accessor.sparse !== undefined) fail(`${path}: sparse accessors are unsupported.`);
    if (accessor.bufferView === undefined) fail(`${path}: accessors without embedded bufferViews are unsupported.`);
    const bufferView = reference(accessor.bufferView, bufferViews, `${path}.bufferView`);
    const component = Object.hasOwn(COMPONENTS, accessor.componentType) ? COMPONENTS[accessor.componentType] : null;
    const shape = typeof accessor.type === 'string' && Object.hasOwn(SHAPES, accessor.type) ? SHAPES[accessor.type] : null;
    if (!Number.isInteger(accessor.componentType)) fail(`${path}.componentType must be an integer.`);
    if (!component || !shape) fail(`${path} has an unsupported component or accessor type.`);
    const [columns, rows] = shape;
    const count = integer(accessor.count, `${path}.count`, 1, MAX_BYTES);
    const offset = integer(accessor.byteOffset ?? 0, `${path}.byteOffset`);
    const columnStride = columns > 1 ? Math.ceil(rows * component.size / 4) * 4 : rows * component.size;
    const elementSize = columns * columnStride;
    const finalElementSize = (columns - 1) * columnStride + rows * component.size;
    const stride = bufferView.byteStride ?? elementSize;
    const relativeStart = (bufferView.byteOffset ?? 0) + offset;
    if (offset % component.size || relativeStart % component.size || (columns > 1 && relativeStart % 4) || stride < elementSize || stride % component.size) fail(`${path} has invalid accessor alignment or stride.`);
    if (offset + (count - 1) * stride + finalElementSize > bufferView.byteLength) fail(`${path} exceeds its bufferView bounds.`);
    if (accessor.normalized !== undefined && typeof accessor.normalized !== 'boolean') fail(`${path}.normalized must be boolean.`);
    if (accessor.normalized && ![5120, 5121, 5122, 5123].includes(accessor.componentType)) fail(`${path} cannot normalize this component type.`);
    for (const key of ['min', 'max']) if (accessor[key] !== undefined) vector(accessor[key], columns * rows, `${path}.${key}`);
    if (accessor.min && accessor.max && accessor.min.some((value, i) => value > accessor.max[i])) fail(`${path} has inverted min/max bounds.`);
    componentReads += count * columns * rows;
    if (componentReads > MAX_COMPONENT_READS) fail('Accessor data exceeds the inspection complexity limit.');
    const layout = { accessor, bufferView, start: bin.start + relativeStart, stride, component, columns, rows, columnStride };
    // Non-finite floats are not valid glTF data, regardless of visible usage.
    if (accessor.componentType === 5126) {
      const minima = new Array(columns * rows).fill(Infinity);
      const maxima = new Array(columns * rows).fill(-Infinity);
      for (let item = 0; item < count; item++) for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
        const value = view.getFloat32(layout.start + item * stride + column * columnStride + row * 4, true);
        if (!Number.isFinite(value)) fail(`${path} contains a non-finite float.`);
        const componentIndex = column * rows + row;
        minima[componentIndex] = Math.min(minima[componentIndex], value);
        maxima[componentIndex] = Math.max(maxima[componentIndex], value);
      }
      for (const [key, actual] of [['min', minima], ['max', maxima]]) if (accessor[key]?.some((value, i) => Math.fround(value) !== actual[i])) fail(`${path}.${key} does not match its binary float data.`);
    }
    return layout;
  });
  const indexMaxima = new Map();
  function maximumIndex(index) {
    if (indexMaxima.has(index)) return indexMaxima.get(index);
    const layout = layouts[index];
    let maximum = -1;
    for (let i = 0; i < layout.accessor.count; i++) {
      const value = view[layout.component.read](layout.start + i * layout.stride, true);
      if (value === layout.component.restart) fail('Primitive index contains a forbidden restart value.');
      maximum = Math.max(maximum, value);
    }
    indexMaxima.set(index, maximum);
    return maximum;
  }
  let vertexCount = 0;
  let triangleCount = 0;
  meshes.forEach((mesh, meshIndex) => {
    list(mesh.primitives, `meshes[${meshIndex}].primitives`, true).forEach((primitive, primitiveIndex) => {
      const path = `meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      coreObject(primitive, path);
      object(primitive.attributes, `${path}.attributes`);
      const position = reference(primitive.attributes.POSITION, accessors, `${path}.attributes.POSITION`);
      if (position.type !== 'VEC3' || position.componentType !== 5126 || !position.min || !position.max) fail(`${path}.POSITION must be FLOAT VEC3 with min/max bounds.`);
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
        const attribute = reference(accessorIndex, accessors, `${path}.attributes.${semantic}`);
        const layout = layouts[accessorIndex];
        if (attribute.count !== position.count) fail(`${path} attribute counts do not match POSITION.`);
        if ((attribute.byteOffset ?? 0) % 4 || (layout.start - bin.start) % 4 || layout.stride % 4 || (layout.bufferView.target !== undefined && layout.bufferView.target !== 34962)) fail(`${path} has invalid vertex attribute alignment or target.`);
        claimView(attribute.bufferView, 'vertex', accessorIndex);
      }
      if (primitive.material !== undefined) reference(primitive.material, materials, `${path}.material`);
      for (const target of list(primitive.targets, `${path}.targets`)) {
        coreObject(target, `${path}.target`);
        for (const [semantic, accessorIndex] of Object.entries(target)) {
          if (!['POSITION', 'NORMAL', 'TANGENT'].includes(semantic)) fail(`${path} has unsupported morph target attributes.`);
          const accessor = reference(accessorIndex, accessors, `${path}.target.${semantic}`);
          if (accessor.type !== 'VEC3' || accessor.componentType !== 5126 || accessor.count !== position.count) fail(`${path} has invalid morph target accessor.`);
          claimView(accessor.bufferView, 'vertex', accessorIndex);
        }
      }
      let elementCount = position.count;
      if (primitive.indices !== undefined) {
        const indices = reference(primitive.indices, accessors, `${path}.indices`);
        const layout = layouts[primitive.indices];
        if (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType) || indices.normalized || layout.bufferView.byteStride !== undefined || (layout.bufferView.target !== undefined && layout.bufferView.target !== 34963)) fail(`${path} has invalid index accessor.`);
        claimView(indices.bufferView, 'index');
        if (maximumIndex(primitive.indices) >= position.count) fail(`${path} contains an index outside its POSITION vertex bounds.`);
        elementCount = indices.count;
      }
      const mode = integer(primitive.mode ?? 4, `${path}.mode`, 0, 6);
      if ((mode === 1 && elementCount % 2) || (mode === 4 && elementCount % 3) || ([2, 3].includes(mode) && elementCount < 2) || ([4, 5, 6].includes(mode) && elementCount < 3)) fail(`${path} has an invalid element count for its primitive mode.`);
      vertexCount += position.count;
      triangleCount += mode === 4 ? elementCount / 3 : [5, 6].includes(mode) ? elementCount - 2 : 0;
      if (!Number.isSafeInteger(vertexCount) || !Number.isSafeInteger(triangleCount)) fail('Geometry totals exceed safe integer bounds.');
    });
  });

  const parents = new Array(nodes.length).fill(-1);
  nodes.forEach((node, index) => {
    for (const [key, target] of [['mesh', meshes], ['skin', skins], ['camera', cameras]]) if (node[key] !== undefined) reference(node[key], target, `nodes[${index}].${key}`);
    for (const [key, size] of [['matrix', 16], ['translation', 3], ['rotation', 4], ['scale', 3]]) if (node[key] !== undefined) vector(node[key], size, `nodes[${index}].${key}`);
    if (node.matrix !== undefined && ['translation', 'rotation', 'scale'].some(key => node[key] !== undefined)) fail('Nodes cannot combine matrix and TRS transforms.');
    for (const child of list(node.children, `nodes[${index}].children`)) {
      reference(child, nodes, `nodes[${index}].children`);
      if (parents[child] !== -1) fail('Node hierarchy has duplicate or multiple parents.');
      parents[child] = index;
    }
  });
  const pendingNodes = parents.flatMap((parent, index) => parent === -1 ? [index] : []);
  let visitedNodes = 0;
  while (pendingNodes.length) {
    const index = pendingNodes.pop();
    visitedNodes++;
    for (const child of nodes[index].children ?? []) pendingNodes.push(child);
  }
  if (visitedNodes !== nodes.length) fail('Node hierarchy contains a cycle.');
  scenes.forEach((scene, index) => {
    const roots = list(scene.nodes, `scenes[${index}].nodes`);
    if (new Set(roots).size !== roots.length) fail('Scene contains duplicate root nodes.');
    roots.forEach(node => {
      reference(node, nodes, `scenes[${index}].nodes`);
      if (parents[node] !== -1) fail('Scene references a non-root node.');
    });
  });
  if (doc.scene !== undefined) reference(doc.scene, scenes, 'scene');
  skins.forEach((skin, index) => {
    const joints = list(skin.joints, `skins[${index}].joints`, true);
    if (new Set(joints).size !== joints.length) fail('Skin contains duplicate joints.');
    joints.forEach(joint => reference(joint, nodes, `skins[${index}].joints`));
    if (skin.skeleton !== undefined) reference(skin.skeleton, nodes, `skins[${index}].skeleton`);
    if (skin.inverseBindMatrices !== undefined) {
      const accessor = reference(skin.inverseBindMatrices, accessors, `skins[${index}].inverseBindMatrices`);
      if (accessor.type !== 'MAT4' || accessor.componentType !== 5126 || accessor.count < joints.length) fail('Invalid inverse bind matrix accessor.');
      claimView(accessor.bufferView, 'inverse-bind');
    }
  });
  images.forEach((image, index) => {
    if (image.uri !== undefined) fail('Image URI resources are unsupported; embed image bytes in a bufferView.');
    const bufferView = reference(image.bufferView, bufferViews, `images[${index}].bufferView`);
    if (!['image/png', 'image/jpeg'].includes(image.mimeType)) fail('Embedded images must declare a supported core PNG/JPEG MIME type.');
    if (bufferView.byteStride !== undefined) fail('Image bufferViews cannot have byteStride.');
    claimView(image.bufferView, 'image');
  });
  textures.forEach((texture, index) => {
    reference(texture.source, images, `textures[${index}].source`);
    if (texture.sampler !== undefined) reference(texture.sampler, samplers, `textures[${index}].sampler`);
  });
  materials.forEach((material, index) => {
    const pbr = material.pbrMetallicRoughness === undefined ? {} : coreObject(material.pbrMetallicRoughness, `materials[${index}].pbrMetallicRoughness`);
    for (const info of [material.normalTexture, material.occlusionTexture, material.emissiveTexture, pbr.baseColorTexture, pbr.metallicRoughnessTexture]) {
      if (info === undefined) continue;
      coreObject(info, 'material textureInfo');
      reference(info.index, textures, 'material textureInfo.index');
      if (info.texCoord !== undefined) integer(info.texCoord, 'material textureInfo.texCoord');
    }
  });
  const inspectedTimeAccessors = new Set();
  animations.forEach((animation, index) => {
    const animationSamplers = list(animation.samplers, `animations[${index}].samplers`, true);
    animationSamplers.forEach(sampler => {
      coreObject(sampler, 'animation sampler');
      const input = reference(sampler.input, accessors, 'animation sampler.input');
      const output = reference(sampler.output, accessors, 'animation sampler.output');
      if (input.type !== 'SCALAR' || input.componentType !== 5126 || !input.min || !input.max) fail('Animation input must be a FLOAT SCALAR accessor with min/max bounds.');
      claimView(input.bufferView, 'animation');
      claimView(output.bufferView, 'animation');
      if (sampler.interpolation !== undefined && !['LINEAR', 'STEP', 'CUBICSPLINE'].includes(sampler.interpolation)) fail('Unsupported animation interpolation.');
      if (!inspectedTimeAccessors.has(sampler.input)) {
        const layout = layouts[sampler.input];
        let previous = -1;
        for (let i = 0; i < input.count; i++) {
          const time = view.getFloat32(layout.start + i * layout.stride, true);
          if (time < 0 || time <= previous) fail('Animation input times must be nonnegative and strictly increasing.');
          previous = time;
        }
        inspectedTimeAccessors.add(sampler.input);
      }
    });
    list(animation.channels, `animations[${index}].channels`, true).forEach(channel => {
      coreObject(channel, 'animation channel');
      const sampler = reference(channel.sampler, animationSamplers, 'animation channel.sampler');
      coreObject(channel.target, 'animation channel.target');
      const node = reference(channel.target.node, nodes, 'animation channel.target.node');
      const output = accessors[sampler.output];
      const path = channel.target.path;
      if (!['translation', 'rotation', 'scale', 'weights'].includes(path)) fail('Invalid animation target path.');
      const type = path === 'rotation' ? 'VEC4' : path === 'weights' ? 'SCALAR' : 'VEC3';
      let multiplier = sampler.interpolation === 'CUBICSPLINE' ? 3 : 1;
      if (path === 'weights') {
        const mesh = reference(node.mesh, meshes, 'weight animation target mesh');
        const counts = mesh.primitives.map(primitive => primitive.targets?.length ?? 0);
        if (!counts[0] || counts.some(count => count !== counts[0])) fail('Weight animation requires consistent morph targets.');
        multiplier *= counts[0];
      }
      if (output.type !== type || output.componentType !== 5126 || output.count !== accessors[sampler.input].count * multiplier) fail('Animation output does not match its input and target.');
    });
  });

  const warnings = [
    'Structural inspection only; rendered appearance, rigging quality, animation behavior, and usage rights are not verified.',
    'Vertex totals sum POSITION counts per stored primitive, including shared accessors; scene instances are not multiplied.',
    'Triangle totals are topology upper bounds; degenerate triangles may reduce rendered triangles. Points and lines contribute zero.',
  ];
  if (images.length) warnings.push('Embedded image references are bounded; image pixels are not decoded or visually verified.');
  if (!globalThis.crypto?.subtle) fail('SHA-256 requires Web Crypto in a secure browser context or Node 24.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze({
    filename, byteLength: bytes.byteLength, sha256,
    sceneCount: scenes.length, nodeCount: nodes.length, meshCount: meshes.length,
    materialCount: materials.length, animationCount: animations.length,
    vertexCount, triangleCount, inspection: 'structure-only', externalResources: false,
    warnings: Object.freeze(warnings),
  });
}
