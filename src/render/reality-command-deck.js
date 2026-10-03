import { FEATURE_DEFINITIONS } from './feature-navigator.js?v=20261003-complete8';
import { LENS_SPACES, lensDirectory, lensRuntimeStatus } from './reality-lens-chrome.js?v=20261003-complete8';

const STYLE = `
#matumbo-command-deck{position:fixed;inset:0;z-index:110;pointer-events:none;color:#e2f0f7;font:14px/1.5 system-ui,sans-serif;--mcd-line:rgba(133,196,218,.24)}
#matumbo-command-deck *{box-sizing:border-box}
#matumbo-command-deck [hidden]{display:none!important}
#matumbo-command-deck button,#matumbo-command-deck input,#matumbo-command-deck a{font:inherit;color:inherit}
#matumbo-command-deck button,#matumbo-command-deck .mcd-link{min-height:44px;border:1px solid var(--mcd-line);border-radius:10px;padding:10px 14px;background:#0c1c29;cursor:pointer;text-decoration:none}
#matumbo-command-deck button:hover,#matumbo-command-deck .mcd-link:hover{background:#163044;border-color:#8acbe1}
#matumbo-command-deck button:focus-visible,#matumbo-command-deck a:focus-visible,#matumbo-command-deck input:focus-visible,#matumbo-command-deck summary:focus-visible{outline:2px solid #d7bc7d;outline-offset:3px}
#matumbo-command-deck button:disabled{opacity:.45;cursor:default}
#matumbo-command-deck .mcd-panel{pointer-events:auto;border:1px solid var(--mcd-line);border-radius:16px;background:linear-gradient(145deg,rgba(8,22,33,.97),rgba(4,11,19,.96));backdrop-filter:blur(18px);box-shadow:0 18px 48px #0005}
#matumbo-command-deck .mcd-top{position:absolute;top:16px;left:18px;right:178px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px;max-width:920px}
#matumbo-command-deck .mcd-brand{font-weight:650;font-size:18px;letter-spacing:-.02em}
#matumbo-command-deck .mcd-sub,#matumbo-command-deck .mcd-status{color:#9eb9c8;font-size:13px}
#matumbo-command-deck .mcd-status[data-state=error]{color:#ecc68c}
#matumbo-command-deck .mcd-bottom{position:absolute;left:18px;bottom:calc(16px + env(safe-area-inset-bottom));display:flex;gap:8px;align-items:center;padding:6px}
#matumbo-command-deck .mcd-drawer{position:absolute;left:18px;top:94px;bottom:86px;width:min(420px,calc(100vw - 36px));display:flex;flex-direction:column;gap:16px;padding:18px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
#matumbo-command-deck .mcd-drawer header{display:flex;justify-content:space-between;align-items:center;gap:10px}
#matumbo-command-deck h2{font-size:21px;line-height:1.2;margin:0}
#matumbo-command-deck .mcd-close{padding:8px 12px}
#matumbo-command-deck .mcd-search{display:grid;gap:7px}
#matumbo-command-deck input{width:100%;min-height:46px;border:1px solid var(--mcd-line);border-radius:10px;background:#05111b;padding:10px 12px}
#matumbo-command-deck .mcd-count{margin:0;color:#a3bdcb;font-size:13px}
#matumbo-command-deck .mcd-groups{display:grid;gap:10px}
#matumbo-command-deck .mcd-group{border:1px solid var(--mcd-line);border-radius:12px;overflow:hidden}
#matumbo-command-deck summary{cursor:pointer;min-height:48px;padding:12px 14px;color:#e3f3fa}
#matumbo-command-deck summary span{float:right;color:#9ab6c7;font-size:13px}
#matumbo-command-deck .mcd-features{display:grid;gap:5px;padding:0 8px 8px}
#matumbo-command-deck .mcd-feature{text-align:left;width:100%;background:transparent;border-color:transparent}
#matumbo-command-deck .mcd-feature strong{font-weight:550;display:block}
#matumbo-command-deck .mcd-feature small{display:block;color:#9eb9c8;font-size:13px;margin-top:3px}
#matumbo-command-deck .mcd-feature[aria-current=true]{border-color:#86bdd0;background:#153448}
#matumbo-command-deck .mcd-description{color:#b7cdd9;margin:10px 0 14px;font-size:15px}
#matumbo-command-deck .mcd-detail{padding-top:16px;border-top:1px solid var(--mcd-line)}
#matumbo-command-deck .mcd-detail h3{margin:0;font-size:18px}
#matumbo-command-deck .mcd-detail p{overflow-wrap:anywhere}
#matumbo-command-deck .mcd-boundary{color:#a6c0cf;font-size:13px}
#matumbo-command-deck .mcd-tools{display:flex;flex-wrap:wrap;gap:8px;padding-top:12px;border-top:1px solid var(--mcd-line)}
#matumbo-command-deck .mcd-tools button{font-size:13px}
#matumbo-command-deck .mcd-fallback{pointer-events:auto;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(680px,calc(100vw - 40px));padding:24px}
#matumbo-command-deck .mcd-fallback h1{font-size:clamp(24px,3vw,32px);font-weight:550;margin:0 0 12px;letter-spacing:-.025em;line-height:1.25}
#matumbo-command-deck .mcd-fallback p{color:#b5cbd8;margin:0 0 18px;font-size:16px}
#matumbo-command-deck .mcd-space-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
#matumbo-command-deck .mcd-space{text-align:left;min-height:72px}
#matumbo-command-deck .mcd-space small{display:block;color:#9ab9c8;font-size:13px}
#matumbo-command-deck[data-drawer-open=true] .mcd-fallback{visibility:hidden;pointer-events:none}
body.lens-chrome-ready #brand,body.lens-chrome-ready #feature-toggle,body.lens-chrome-ready #feature-shell{display:none!important}
body.lens-chrome-ready:not(.lens-asset-active) #asset-launch{display:none!important}
body.lens-chrome-ready #runtime-status{left:18px;top:94px;transform:none;width:min(430px,calc(100vw - 36px));z-index:100}
body.lens-chrome-ready #runtime-status[data-runtime-state=ready]{display:none}
body.lens-directory-open #runtime-status,body.lens-directory-open #readout{visibility:hidden}
body.lens-chrome-ready #hint{display:none}
body.lens-chrome-ready #runtime-status{display:none!important}
#matumbo-command-deck .mcd-diagnosis{margin-top:16px;border-top:1px solid var(--mcd-line);font-size:13px;color:#aac5d3}
#matumbo-command-deck .mcd-diagnosis p{font-size:13px}
#matumbo-command-deck .mcd-retry{display:inline-flex;align-items:center;margin-top:10px}
body.lens-runtime-degraded #readout,body.lens-runtime-degraded #reality-lens,body.lens-runtime-degraded #intent-timeline-open,body.lens-runtime-degraded #token-transfer-chip{display:none!important}
body.lens-chrome-ready #runtime-status-title{font-size:13px;line-height:1.4}
body.lens-chrome-ready #runtime-status-message{font-size:13px;line-height:1.5}
body.lens-chrome-ready #runtime-status-retry{min-height:44px;display:flex;align-items:center;font-size:12px}
@media(max-width:700px){
  body #matumbo-command-deck .mcd-top{display:flex;top:10px;left:10px;right:10px;padding:10px 14px;align-items:flex-start;flex-direction:column;gap:3px}
  body #matumbo-command-deck .mcd-bottom{left:10px;right:auto;bottom:calc(10px + env(safe-area-inset-bottom));transform:none;max-width:calc(100vw - 20px);border-radius:14px}
  body #matumbo-command-deck .mcd-bottom>button{display:block;font-size:14px;min-height:44px}
  #matumbo-command-deck .mcd-drawer{left:10px;top:94px;bottom:calc(78px + env(safe-area-inset-bottom));width:calc(100vw - 20px);padding:16px}
  #matumbo-command-deck .mcd-fallback{top:calc(50% + 24px);padding:18px;max-height:calc(100dvh - 230px);overflow:auto}
  #matumbo-command-deck .mcd-space-grid{gap:7px}
  #matumbo-command-deck .mcd-space{padding:10px;min-height:76px;font-size:14px}
  body.lens-chrome-ready #runtime-status{left:10px;top:102px;width:calc(100vw - 20px);padding:8px 10px}
}
@media(prefers-reduced-motion:reduce){#matumbo-command-deck *{scroll-behavior:auto;transition:none}}
`;

export function mountRealityCommandDeck({ documentRoot = document } = {}) {
  if (documentRoot.getElementById('matumbo-command-deck')) return null;
  const style = documentRoot.createElement('style');
  style.textContent = STYLE;
  documentRoot.head.append(style);
  const root = documentRoot.createElement('div');
  root.id = 'matumbo-command-deck';
  root.innerHTML = `
    <header class="mcd-panel mcd-top">
      <div><div class="mcd-brand">maTumbo · Reality Lens Ω</div><div class="mcd-sub">One world. Open one space at a time.</div></div>
      <span class="mcd-status" data-status role="status" aria-live="polite"></span>
    </header>
    <section class="mcd-panel mcd-drawer" id="lens-spaces-drawer" aria-labelledby="lens-spaces-title" hidden>
      <header><h2 id="lens-spaces-title">Spaces</h2><button class="mcd-close" data-close aria-label="Close spaces">Close</button></header>
      <label class="mcd-search">Find a feature<input data-search type="search" placeholder="YouTube, chess, contracts…" autocomplete="off"></label>
      <p class="mcd-count" data-count></p>
      <nav class="mcd-groups" data-groups aria-label="maTumbo feature spaces"></nav>
      <p data-empty hidden>No matching features. Try another name or clear the search.</p>
      <section class="mcd-detail" data-detail hidden aria-live="polite"></section>
      <div class="mcd-tools" data-tools aria-label="World tools"></div>
    </section>
    <section class="mcd-panel mcd-fallback" data-fallback hidden aria-label="Reality Lens directory mode">
      <h1>Your world, one space at a time.</h1>
      <p>3D is unavailable in this browser. Explore all 36 feature descriptions here, or reload after enabling WebGL.</p>
      <div class="mcd-space-grid" data-spaces></div>
      <details class="mcd-diagnosis"><summary>Why 3D is unavailable</summary><p data-error></p></details>
      <a class="mcd-link mcd-retry" href="./index.html">Reload 3D</a>
    </section>
    <nav class="mcd-panel mcd-bottom" data-lens-chrome="calm" aria-label="Reality Lens navigation">
      <button data-directory aria-controls="lens-spaces-drawer" aria-expanded="false">Spaces · F</button>
      <button data-home>Overview</button>
    </nav>`;
  documentRoot.body.append(root);
  documentRoot.body.classList.add('lens-chrome-ready');

  const find = selector => root.querySelector(selector);
  const drawer = find('[data-close]').closest('section');
  const search = find('[data-search]');
  const groups = find('[data-groups]');
  const detail = find('[data-detail]');
  const opener = find('[data-directory]');
  const runtime = documentRoot.getElementById('runtime-status');
  const legacy = documentRoot.getElementById('feature-shell');
  const registry = documentRoot.getElementById('feature-nav');
  let state = null;
  let activeId = null;
  let destroyed = false;

  // The navigator still owns feature selection. Keep its hidden controls
  // inert to keyboard navigation; dispatch through them only when available.
  const quietLegacy = () => {
    if (!legacy) return;
    legacy.inert = true;
    legacy.setAttribute('aria-hidden', 'true');
  };
  const closeLegacy = () => {
    documentRoot.getElementById('feature-close')?.click();
    quietLegacy();
  };

  function setOpen(open, { focus = true } = {}) {
    drawer.hidden = !open;
    root.dataset.drawerOpen = String(open);
    opener.setAttribute('aria-expanded', String(open));
    documentRoot.body.classList.toggle('lens-directory-open', open);
    if (focus) (open ? search : opener).focus({ preventScroll: true });
  }

  function describeFeature(feature) {
    detail.replaceChildren();
    const title = documentRoot.createElement('h3'); title.textContent = feature.label;
    const description = documentRoot.createElement('p'); description.className = 'mcd-description'; description.textContent = feature.description;
    const note = documentRoot.createElement('p'); note.textContent = '3D is required to open this feature. This directory shows its description; the feature is not running.';
    const boundary = documentRoot.createElement('details'); boundary.className = 'mcd-boundary';
    const summary = documentRoot.createElement('summary'); summary.textContent = 'Feature scope';
    const copy = documentRoot.createElement('p'); copy.textContent = feature.boundary;
    boundary.append(summary, copy); detail.append(title, description, note, boundary); detail.hidden = false;
    detail.scrollIntoView({ block: 'nearest' });
  }

  function activate(feature) {
    const canonical = documentRoot.getElementById('feature-button-' + feature.id);
    if (state !== 'ready' || !canonical) {
      if (feature.id === 'white-paper') {
        const link = documentRoot.createElement('a');
        describeFeature(feature); link.className = 'mcd-link'; link.href = './paper-live.html'; link.textContent = 'Read the white paper'; detail.append(link);
      } else describeFeature(feature);
      return false;
    }
    setOpen(false, { focus: false });
    canonical.click();
    closeLegacy();
    if (documentRoot.body.classList.contains('assembly-mode')) documentRoot.querySelector('#reality-assembly [data-directory-toggle]')?.focus({ preventScroll: true });
    else opener.focus({ preventScroll: true });
    return true;
  }

  function renderDirectory() {
    const directory = lensDirectory(FEATURE_DEFINITIONS, search.value);
    const count = directory.reduce((sum, space) => sum + space.features.length, 0);
    find('[data-count]').textContent = search.value.trim() ? count + ' matching features' : FEATURE_DEFINITIONS.length + ' features · ' + LENS_SPACES.length + ' spaces';
    find('[data-empty]').hidden = count !== 0;
    groups.replaceChildren();
    for (const space of directory) {
      const section = documentRoot.createElement('details'); section.className = 'mcd-group'; section.dataset.space = space.id; section.open = Boolean(search.value.trim());
      const heading = documentRoot.createElement('summary'); heading.append(documentRoot.createTextNode(space.label));
      const total = documentRoot.createElement('span'); total.textContent = String(space.features.length); heading.append(total);
      const list = documentRoot.createElement('div'); list.className = 'mcd-features';
      section.addEventListener('toggle', () => {
        if (!section.open || search.value.trim()) return;
        for (const other of groups.children) if (other !== section) other.open = false;
      });
      for (const feature of space.features) {
        const button = documentRoot.createElement('button'); button.type = 'button'; button.className = 'mcd-feature'; button.dataset.featureId = feature.id;
        button.setAttribute('aria-current', String(feature.id === activeId));
        const name = documentRoot.createElement('strong'); name.textContent = feature.label;
        const kicker = documentRoot.createElement('small'); kicker.textContent = feature.kicker;
        button.append(name, kicker); button.addEventListener('click', () => activate(feature)); list.append(button);
      }
      section.append(heading, list); groups.append(section);
    }
  }

  for (const space of lensDirectory(FEATURE_DEFINITIONS)) {
    const button = documentRoot.createElement('button'); button.type = 'button'; button.className = 'mcd-space';
    const label = documentRoot.createElement('span'); label.textContent = space.label;
    const count = documentRoot.createElement('small'); count.textContent = space.features.length + ' features';
    button.append(label, count); button.addEventListener('click', () => {
      search.value = ''; renderDirectory(); setOpen(true);
      for (const group of groups.children) group.open = group.dataset.space === space.id;
    }); find('[data-spaces]').append(button);
  }

  const tools = [
    ['Camera controls', 'camera-input-open'], ['Stories', 'story-mode-open'],
    ['Intent trace', 'intent-timeline-open'], ['Launch kit', 'launch-kit-open'],
    ['Reality .25', 'matumbo-reality25-launcher'],
  ];
  for (const [label, id] of tools) {
    const button = documentRoot.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.toolId = id;
    button.onclick = () => { const target = documentRoot.getElementById(id); if (target && state === 'ready') { setOpen(false); target.click(); } };
    find('[data-tools]').append(button);
  }
  const paper = documentRoot.createElement('a'); paper.className = 'mcd-link'; paper.href = './paper-live.html'; paper.textContent = 'White paper'; find('[data-tools]').append(paper);

  const update = () => {
    if (destroyed) return;
    state = runtime?.dataset.runtimeState ?? 'loading';
    documentRoot.body.classList.toggle('lens-runtime-degraded', state !== 'ready');
    find('[data-status]').textContent = lensRuntimeStatus(state); find('[data-status]').dataset.state = state;
    find('[data-fallback]').hidden = state !== 'error';
    find('[data-error]').textContent = documentRoot.getElementById('runtime-status-message')?.textContent ?? 'The renderer has not started.';
    const selected = registry?.querySelector('.feature-button[aria-pressed="true"]')?.dataset.featureId ?? null;
    activeId = selected;
    find('[data-home]').disabled = state !== 'ready';
    documentRoot.body.classList.toggle('lens-asset-active', ['asset-token', 'launch-distribution', 'paycore'].includes(selected));
    for (const button of groups.querySelectorAll('[data-feature-id]')) button.setAttribute('aria-current', String(button.dataset.featureId === selected));
    for (const button of root.querySelectorAll('[data-tool-id]')) { button.disabled = state !== 'ready' || !documentRoot.getElementById(button.dataset.toolId); button.hidden = button.disabled; }
    quietLegacy();
  };
  const observer = new MutationObserver(update);
  if (runtime) observer.observe(runtime, { attributes: true, attributeFilter: ['data-runtime-state'] });
  if (registry) observer.observe(registry, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  if (legacy) observer.observe(legacy, { attributes: true, attributeFilter: ['class'] });
  // Some optional tool launchers arrive after the renderer, without polling.
  observer.observe(documentRoot.body, { childList: true });
  opener.onclick = () => setOpen(drawer.hidden);
  find('[data-close]').onclick = () => setOpen(false);
  find('[data-home]').onclick = () => activate(FEATURE_DEFINITIONS.find(feature => feature.id === 'reality-lens'));
  search.addEventListener('input', () => { detail.hidden = true; renderDirectory(); });
  const onKey = event => {
    if (documentRoot.body.classList.contains('assembly-mode') || event.metaKey || event.ctrlKey || event.altKey || event.repeat || /input|textarea|select/i.test(event.target?.tagName ?? '') || event.target?.isContentEditable) return;
    if (event.key.toLowerCase() === 'f' || (event.key === 'Escape' && !drawer.hidden)) {
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(event.key === 'Escape' ? false : drawer.hidden);
    }
  };
  // Escape also works from the search input; editing shortcuts remain native.
  drawer.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } });
  documentRoot.addEventListener('keydown', onKey, true);
  renderDirectory(); update(); closeLegacy();
  return Object.freeze({
    open: () => setOpen(true), close: () => setOpen(false),
    destroy() { destroyed = true; observer.disconnect(); documentRoot.removeEventListener('keydown', onKey, true); root.remove(); style.remove(); if (legacy) { legacy.inert = false; legacy.removeAttribute('aria-hidden'); } documentRoot.body.classList.remove('lens-chrome-ready', 'lens-directory-open', 'lens-asset-active', 'lens-runtime-degraded'); },
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountRealityCommandDeck(), { once: true });
  else mountRealityCommandDeck();
}
