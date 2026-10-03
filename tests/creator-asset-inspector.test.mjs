import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectCreatorGLB } from '../src/domains/creator-asset-inspector.js';

// These fixtures contain actual binary POSITION/index bytes, not filenames or
// mocked import-success responses. No scene loader or external provider runs.
function glb(document = { asset: { version: '2.0' } }, binary) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binaryLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const bytes = new ArrayBuffer(20 + jsonLength + (binary ? 8 + binaryLength : 0));
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20, jsonLength).fill(32);
  new Uint8Array(bytes, 20, json.length).set(json);
  if (binary) {
    view.setUint32(20 + jsonLength, binaryLength, true);
    view.setUint32(24 + jsonLength, 0x004e4942, true);
    new Uint8Array(bytes, 28 + jsonLength, binary.length).set(binary);
  }
  return bytes;
}

function triangle({ indexed = true, indices = [0, 1, 2], mode = 4 } = {}) {
  const binary = new Uint8Array(36 + (indexed ? indices.length * 2 : 0));
  const view = new DataView(binary.buffer);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => view.setFloat32(index * 4, value, true));
  if (indexed) indices.forEach((value, index) => view.setUint16(36 + index * 2, value, true));
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode }] }],
  };
  if (indexed) {
    document.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: indices.length * 2, target: 34963 });
    document.accessors.push({ bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' });
    document.meshes[0].primitives[0].indices = 1;
  }
  return { document, binary, bytes: () => glb(document, binary) };
}

test('minimal core GLB produces a frozen structure-only receipt and real SHA-256', async () => {
  const bytes = glb();
  const receipt = await inspectCreatorGLB(bytes, { filename: 'empty.glb' });
  assert.deepEqual(Object.keys(receipt), ['filename', 'byteLength', 'sha256', 'sceneCount', 'nodeCount', 'meshCount', 'materialCount', 'animationCount', 'vertexCount', 'triangleCount', 'inspection', 'externalResources', 'warnings']);
  assert.equal(receipt.sha256, createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
  assert.equal(receipt.byteLength, bytes.byteLength);
  assert.equal(receipt.filename, 'empty.glb');
  assert.equal(receipt.inspection, 'structure-only');
  assert.equal(receipt.externalResources, false);
  assert.equal(receipt.meshCount, 0);
  assert.equal(receipt.triangleCount, 0);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.warnings), true);
  assert.throws(() => receipt.warnings.push('render verified'), TypeError);
  assert.match(receipt.warnings.join(' '), /usage rights are not verified/);
});

test('inspects real indexed and non-indexed triangle geometry', async () => {
  for (const indexed of [true, false]) {
    const receipt = await inspectCreatorGLB(triangle({ indexed }).bytes());
    assert.equal(receipt.sceneCount, 1);
    assert.equal(receipt.nodeCount, 1);
    assert.equal(receipt.meshCount, 1);
    assert.equal(receipt.vertexCount, 3);
    assert.equal(receipt.triangleCount, 1);
  }
});

test('digest and metadata use one private snapshot even if caller mutates its bytes', async () => {
  const bytes = triangle().bytes();
  const expectedHash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  const pending = inspectCreatorGLB(bytes);
  new Uint8Array(bytes).fill(0);
  assert.equal((await pending).sha256, expectedHash);
});

test('topology counts include stored primitives, not scene instances or render claims', async () => {
  const fixture = triangle({ indices: [0, 1, 2, 2], mode: 5 });
  fixture.document.nodes.push({ mesh: 0 });
  fixture.document.scenes[0].nodes.push(1);
  const receipt = await inspectCreatorGLB(fixture.bytes());
  assert.equal(receipt.nodeCount, 2);
  assert.equal(receipt.vertexCount, 3);
  assert.equal(receipt.triangleCount, 2); // includes a degenerate strip triangle
  assert.match(receipt.warnings.join(' '), /topology upper bounds/);
  const points = triangle({ mode: 0 });
  assert.equal((await inspectCreatorGLB(points.bytes())).triangleCount, 0);
});

test('rejects invalid input types, oversized files, and invalid filenames before parsing', async () => {
  await assert.rejects(inspectCreatorGLB(new Uint8Array(20)), /Expected an ArrayBuffer/);
  await assert.rejects(inspectCreatorGLB(new ArrayBuffer(25 * 1024 * 1024 + 1)), /25 MiB/);
  await assert.rejects(inspectCreatorGLB(glb(), { filename: 'bad\u0000.glb' }), /filename/);
});

test('rejects truncated, mismatched, and wrong-version binary headers', async () => {
  await assert.rejects(inspectCreatorGLB(new ArrayBuffer(12)), /Truncated/);
  for (const [offset, value, error] of [[0, 0, /magic/], [4, 1, /version 2/], [8, 500, /Declared GLB length/]]) {
    const bytes = glb();
    new DataView(bytes).setUint32(offset, value, true);
    await assert.rejects(inspectCreatorGLB(bytes), error);
  }
});

test('rejects out-of-file and misaligned chunks, bad ordering, and duplicate chunks', async () => {
  for (const [offset, value, error] of [[12, 1000, /chunk boundary/], [12, 3, /chunk boundary/], [16, 0x004e4942, /First chunk/]]) {
    const bytes = glb();
    new DataView(bytes).setUint32(offset, value, true);
    await assert.rejects(inspectCreatorGLB(bytes), error);
  }
  const bytes = triangle().bytes();
  const view = new DataView(bytes);
  const binHeader = 20 + view.getUint32(12, true);
  view.setUint32(binHeader + 4, 0x4e4f534a, true);
  await assert.rejects(inspectCreatorGLB(bytes), /Duplicate or unsupported/);
  const truncated = new ArrayBuffer(glb().byteLength + 4);
  new Uint8Array(truncated).set(new Uint8Array(glb()));
  new DataView(truncated).setUint32(8, truncated.byteLength, true);
  await assert.rejects(inspectCreatorGLB(truncated), /Truncated chunk header/);
});

test('uses fatal UTF-8 decoding and rejects malformed JSON and a JSON BOM', async () => {
  for (const replacement of [[0xff], [0xef, 0xbb, 0xbf], [0x5d]]) {
    const bytes = glb();
    new Uint8Array(bytes, 20, replacement.length).set(replacement);
    await assert.rejects(inspectCreatorGLB(bytes), /valid UTF-8 and JSON/);
  }
});

test('rejects non-core schema, resource count abuse, sparse accessors, and active extensions', async () => {
  for (const document of [null, [], { asset: { version: '1.0' } }, { asset: { version: '2.0' }, nodes: {} }, { asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }, { asset: { version: '2.0' }, extras: { numbers: new Array(100_001).fill(0) } }]) {
    await assert.rejects(inspectCreatorGLB(glb(document)), /GLB inspection:/);
  }
  const sparse = triangle();
  sparse.document.accessors[0].sparse = { count: 1 };
  await assert.rejects(inspectCreatorGLB(sparse.bytes()), /sparse accessors are unsupported/);
  const compressed = triangle();
  compressed.document.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0 } };
  await assert.rejects(inspectCreatorGLB(compressed.bytes()), /extensions are unsupported/);
});

test('blocks URI buffers and images without fetching them, including data URI resources', async () => {
  for (const uri of ['https://example.invalid/asset.bin', '../private.bin', 'data:application/octet-stream;base64,AAAA']) {
    const fixture = triangle();
    fixture.document.buffers[0].uri = uri;
    await assert.rejects(inspectCreatorGLB(fixture.bytes()), /Buffer URI resources/);
  }
  const fixture = triangle();
  fixture.document.images = [{ uri: 'https://example.invalid/texture.png' }];
  await assert.rejects(inspectCreatorGLB(fixture.bytes()), /Image URI resources/);
});

test('validates embedded BIN declarations and zero padding', async () => {
  const tooLong = triangle();
  tooLong.document.buffers[0].byteLength = 1000;
  await assert.rejects(inspectCreatorGLB(tooLong.bytes()), /Embedded buffer length/);
  const multiple = triangle();
  multiple.document.buffers.push({ byteLength: 4 });
  await assert.rejects(inspectCreatorGLB(multiple.bytes()), /one embedded buffer/);
  const bytes = triangle().bytes();
  new Uint8Array(bytes)[bytes.byteLength - 1] = 1;
  await assert.rejects(inspectCreatorGLB(bytes), /BIN padding/);
  await assert.rejects(inspectCreatorGLB(glb({ asset: { version: '2.0' } }, new Uint8Array(4))), /no declared embedded buffer/);
});

test('checks bufferView and accessor bounds including references and strided final elements', async () => {
  const cases = [
    [doc => { doc.bufferViews[0].buffer = 1; }, /bufferViews\[0\].buffer/],
    [doc => { doc.bufferViews[0].byteLength = 500; }, /embedded buffer bounds/],
    [doc => { doc.accessors[0].bufferView = 9; }, /bufferView/],
    [doc => { doc.accessors[0].count = 4; }, /bufferView bounds/],
    [doc => { doc.accessors[0].byteOffset = 2; }, /alignment/],
    [doc => { doc.bufferViews[0].byteStride = 16; }, /bufferView bounds/],
    [doc => { doc.bufferViews[0].byteStride = 6; }, /multiple of four/],
    [doc => { doc.accessors[0].type = '__proto__'; }, /unsupported component or accessor type/],
    [doc => { doc.accessors[0].componentType = '5126'; }, /must be an integer/],
  ];
  for (const [mutate, error] of cases) {
    const fixture = triangle(); mutate(fixture.document);
    await assert.rejects(inspectCreatorGLB(fixture.bytes()), error);
  }
});

test('reads real primitive index bytes and rejects out-of-range and restart indices', async () => {
  await assert.rejects(inspectCreatorGLB(triangle({ indices: [0, 1, 3] }).bytes()), /outside its POSITION vertex bounds/);
  await assert.rejects(inspectCreatorGLB(triangle({ indices: [0, 1, 65535] }).bytes()), /forbidden restart/);
  await assert.rejects(inspectCreatorGLB(triangle({ indices: [0, 1] }).bytes()), /invalid element count/);
  const fixture = triangle();
  fixture.document.meshes[0].primitives[0].attributes.POSITION = 100;
  await assert.rejects(inspectCreatorGLB(fixture.bytes()), /attributes.POSITION/);
});

test('rejects non-finite POSITION binary data and inverted bounds', async () => {
  const fixture = triangle();
  new DataView(fixture.binary.buffer).setFloat32(0, Infinity, true);
  await assert.rejects(inspectCreatorGLB(fixture.bytes()), /non-finite float/);
  const bounds = triangle();
  bounds.document.accessors[0].min = [2, 0, 0];
  await assert.rejects(inspectCreatorGLB(bounds.bytes()), /inverted min\/max/);
});

test('checks scene, mesh, skin, and node hierarchy references and cycles', async () => {
  const cases = [
    [doc => { doc.nodes[0].mesh = 2; }, /nodes\[0\].mesh/],
    [doc => { doc.scenes[0].nodes = [2]; }, /scenes\[0\].nodes/],
    [doc => { doc.scene = 2; }, /scene/],
    [doc => { doc.nodes[0].children = [0]; }, /cycle/],
    [doc => { doc.nodes.push({ children: [0] }, { children: [0] }); }, /multiple parents/],
    [doc => { doc.skins = [{ joints: [99] }]; }, /joints/],
  ];
  for (const [mutate, error] of cases) {
    const fixture = triangle(); mutate(fixture.document);
    await assert.rejects(inspectCreatorGLB(fixture.bytes()), error);
  }
});

test('allows embedded texture references but explicitly does not certify image pixels', async () => {
  const fixture = triangle();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
  const binary = new Uint8Array(44 + png.length);
  binary.set(fixture.binary);
  binary.set(png, 44);
  fixture.document.buffers[0].byteLength = binary.length;
  fixture.document.bufferViews.push({ buffer: 0, byteOffset: 44, byteLength: png.length });
  fixture.document.images = [{ bufferView: 2, mimeType: 'image/png' }];
  fixture.document.textures = [{ source: 0 }];
  fixture.document.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
  fixture.document.meshes[0].primitives[0].material = 0;
  const receipt = await inspectCreatorGLB(glb(fixture.document, binary));
  assert.equal(receipt.materialCount, 1);
  assert.match(receipt.warnings.join(' '), /image pixels are not decoded/);
  fixture.document.images[0].bufferView = 0;
  await assert.rejects(inspectCreatorGLB(glb(fixture.document, binary)), /incompatible data kinds/);
  fixture.document.images[0].bufferView = 99;
  await assert.rejects(inspectCreatorGLB(glb(fixture.document, binary)), /images\[0\].bufferView/);
});

test('validates declared float bounds against real binary values', async () => {
  const fixture = triangle();
  fixture.document.accessors[0].max = [2, 1, 0];
  await assert.rejects(inspectCreatorGLB(fixture.bytes()), /does not match its binary float data/);
});

test('accepts interleaved vertex data and padded matrix accessor layouts', async () => {
  const fixture = triangle({ indexed: false });
  const binary = new Uint8Array(56);
  const binaryView = new DataView(binary.buffer);
  const positions = new DataView(fixture.binary.buffer);
  for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) binaryView.setFloat32(vertex * 16 + axis * 4, positions.getFloat32(vertex * 12 + axis * 4, true), true);
  fixture.document.buffers[0].byteLength = 56;
  fixture.document.bufferViews[0].byteLength = 44;
  fixture.document.bufferViews[0].byteStride = 16;
  // MAT3 unsigned-byte columns need four-byte spacing; the final padding byte
  // may be absent, making 11 bytes sufficient for one matrix.
  fixture.document.bufferViews.push({ buffer: 0, byteOffset: 44, byteLength: 11 });
  fixture.document.accessors.push({ bufferView: 1, type: 'MAT3', componentType: 5121, count: 1 });
  assert.equal((await inspectCreatorGLB(glb(fixture.document, binary))).triangleCount, 1);
  fixture.document.bufferViews[1].byteLength = 10;
  await assert.rejects(inspectCreatorGLB(glb(fixture.document, binary)), /bufferView bounds/);
});

test('inspects a real animation channel and rejects invalid time ordering', async () => {
  const fixture = triangle({ indexed: false });
  const binary = new Uint8Array(68);
  binary.set(fixture.binary);
  const binaryView = new DataView(binary.buffer);
  binaryView.setFloat32(36, 0, true);
  binaryView.setFloat32(40, 1, true);
  binaryView.setFloat32(56, 1, true);
  fixture.document.buffers[0].byteLength = binary.length;
  fixture.document.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 8 }, { buffer: 0, byteOffset: 44, byteLength: 24 });
  fixture.document.accessors.push(
    { bufferView: 1, type: 'SCALAR', componentType: 5126, count: 2, min: [0], max: [1] },
    { bufferView: 2, type: 'VEC3', componentType: 5126, count: 2 },
  );
  fixture.document.animations = [{ samplers: [{ input: 1, output: 2 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }];
  assert.equal((await inspectCreatorGLB(glb(fixture.document, binary))).animationCount, 1);
  binaryView.setFloat32(36, 1, true);
  binaryView.setFloat32(40, 0, true);
  await assert.rejects(inspectCreatorGLB(glb(fixture.document, binary)), /strictly increasing/);
});

test('animation and material references cannot point outside their collections', async () => {
  const animation = triangle();
  animation.document.animations = [{ samplers: [{ input: 99, output: 0 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }];
  await assert.rejects(inspectCreatorGLB(animation.bytes()), /animation sampler.input/);
  const material = triangle();
  material.document.materials = [{ normalTexture: { index: 2 } }];
  await assert.rejects(inspectCreatorGLB(material.bytes()), /textureInfo.index/);
});
