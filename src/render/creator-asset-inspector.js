import { inspectCreatorGLB } from '../domains/creator-asset-inspector.js?v=20261003-studio1';

/** Inspect user-selected bytes without loading a model or granting tool authority. */
export function mountCreatorAssetInspector({host, documentRoot = document, windowRoot = window, getActor = () => 'u:you'} = {}) {
  const doc = documentRoot;
  const make = (tag, text) => { const node = doc.createElement(tag); if (text) node.textContent = text; return node; };
  const root = make('details');
  root.dataset.studioAssetInspector = '';
  root.append(make('summary', 'Inspect a returned 3D asset'));
  root.append(make('p', 'Check a standalone GLB before accepting a deliverable. This checks file structure and fingerprints its bytes. Visual quality, rights and animation behavior need separate review.'));
  const label = make('label', 'GLB file · maximum 25 MiB');
  const input = make('input'); input.type = 'file'; input.accept = '.glb'; input.dataset.studioAssetFile = '';
  label.append(input); root.append(label);
  const status = make('p', 'Choose an asset you created or received. The file stays in this browser and is not added to the scene.');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.studioAssetStatus = '';
  const output = make('div'); output.dataset.studioAssetResult = '';
  const download = make('button', 'Download inspection receipt'); download.type = 'button'; download.disabled = true;
  download.dataset.studioAssetDownload = '';
  root.append(status, output, download); host.append(root);
  let actor = getActor(), generation = 0, receipt = null, disposed = false;
  const urls = new Set();
  const clear = () => { generation++; receipt = null; input.value = ''; output.replaceChildren(); download.disabled = true; };
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; clear();
    if (!file) return;
    const request = generation, requestActor = getActor(); actor = requestActor;
    status.textContent = 'Inspecting selected bytes…';
    try {
      if (!/\.glb$/i.test(file.name)) throw new Error('Choose a .glb file. Other formats need their own importer.');
      if (file.size > 25 * 1024 * 1024) throw new Error('This inspector accepts GLB files up to 25 MiB.');
      const report = await inspectCreatorGLB(await file.arrayBuffer(), {filename: file.name});
      if (disposed || request !== generation || requestActor !== getActor()) return;
      receipt = {format: 'ourplace-glb-inspection-v1', inspectedAt: new Date().toISOString(), ...report,
        declaredParticipant: requestActor, visualReviewPassed: false, ownershipVerified: false,
        sceneInstalled: false, rewardAuthorized: false};
      const summary = make('p', `${report.filename} · ${report.byteLength.toLocaleString()} bytes · ${report.meshCount} meshes · ${report.materialCount} materials · ${report.animationCount} animations`);
      const counts = make('p', `${report.vertexCount.toLocaleString()} stored primitive vertices · up to ${report.triangleCount.toLocaleString()} topology triangles`);
      const hash = make('code', `SHA-256 ${report.sha256}`); hash.style.overflowWrap = 'anywhere';
      output.append(summary, counts, hash);
      for (const warning of report.warnings) output.append(make('p', warning));
      download.disabled = false;
      status.textContent = 'Structural inspection passed for the supported GLB profile. Open the asset in Blender and the target device for visual review.';
    } catch (error) {
      if (!disposed && request === generation && requestActor === getActor()) status.textContent = error.message;
    }
  });
  download.addEventListener('click', () => {
    if (!receipt || disposed || actor !== getActor()) { refresh(); return; }
    const url = windowRoot.URL.createObjectURL(new windowRoot.Blob([JSON.stringify(receipt, null, 2)], {type: 'application/json'}));
    urls.add(url);
    const link = make('a'); link.href = url; link.download = 'ourplace-glb-inspection.json'; host.append(link); link.click(); link.remove();
    windowRoot.setTimeout(() => { windowRoot.URL.revokeObjectURL(url); urls.delete(url); }, 1000);
  });
  function refresh() {
    if (actor !== getActor()) { actor = getActor(); clear(); status.textContent = 'Participant changed. Choose an asset for this participant.'; }
  }
  return {refresh, dispose() { disposed = true; clear(); for (const url of urls) windowRoot.URL.revokeObjectURL(url); urls.clear(); root.remove(); }};
}
