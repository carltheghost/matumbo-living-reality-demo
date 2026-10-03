import { createOurplaceStudio, OURPLACE_STUDIO_STORAGE_KEY, OURPLACE_STUDIO_LIMITS } from '../domains/ourplace-studio.js?v=20261003-studio1';

const STORAGE_KEY = OURPLACE_STUDIO_STORAGE_KEY;
const MAX_UPLOAD_BYTES = 256 * 1024;
const LICENSES = [['unspecified', 'Unspecified / restricted'], ['CC0', 'CC0 · public-domain dedication'], ['CC-BY', 'CC BY · attribution required']];

function fenced(value) {
  const text = String(value ?? '');
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}text\n${text}\n${fence}`;
}

/** Keep downloaded source material literal, including HTML and Markdown instructions. */
export function studioBriefingMarkdown(packet) {
  const project = packet.project ?? packet;
  const tasks = project.tasks ?? packet.tasks ?? [];
  const sources = packet.references ?? project.sources ?? [];
  const lines = ['# Ourplace Studio production briefing', '', fenced(project.title ?? 'Untitled project'), '',
    'Local production plan. Completion is user reported. No AI execution, asset generation, or rewards are represented by this briefing.', '',
    '## Brief', '', fenced(project.brief ?? ''), '', '## Production roles', ''];
  for (const task of tasks) {
    lines.push(`### ${task.role ?? 'Task'}`, '', fenced(task.title ?? task.description ?? ''), '',
      `Status: ${task.status === 'done' ? 'Done — user reported' : 'Planned'}`, '',
      `Dependencies: ${(task.dependsOn ?? task.dependencies ?? []).join(', ') || 'None'}`, '');
    if (task.description && task.description !== task.title) lines.push(fenced(task.description), '');
    if (task.note) lines.push('User note:', '', fenced(task.note), '');
  }
  lines.push('## Sources and attribution', '');
  for (const source of sources) {
    lines.push(fenced(`${source.title}\nSource: ${source.origin}\nCredit: ${source.attribution || 'Not supplied'}\nLicense: ${source.license}\nFolder: ${source.folder}`), '');
    for (const section of source.sections ?? []) lines.push(`Lines ${section.startLine}–${section.endLine}`, '', fenced(section.text), '');
  }
  if (project.designSnapshot ?? packet.designSnapshot) {
    lines.push('## Design lineage', '', 'Saved design snapshot for reference; this briefing does not execute or apply it.', '',
      fenced(JSON.stringify(project.designSnapshot ?? packet.designSnapshot, null, 2)), '');
  }
  lines.push('## Validated export record', '', fenced(JSON.stringify(packet, null, 2)), '');
  return lines.join('\n');
}

/** A single local surface inside Creator; domain methods enforce every access transition. */
export function mountOurplaceStudio({
  host,
  documentRoot = globalThis.document,
  windowRoot = globalThis.window,
  getActor = () => 'u:you',
  getDesign = () => null,
  onBack = () => {}
} = {}) {
  if (!host || !documentRoot) throw new Error('Ourplace Studio needs its Creator host and document');
  const doc = documentRoot;
  let storage;
  try { storage = windowRoot?.localStorage; } catch { /* Domain reports memory-only persistence. */ }
  const studio = createOurplaceStudio({ storage, storageKey: STORAGE_KEY });
  let currentActor = String(getActor() ?? 'u:you');
  let disposed = false, epoch = 0, activeDocumentId = null, activeSectionId = null, projectId = null;
  let lastAccessSignature = '', sequence = 0;
  const selectedSources = new Set();
  const taskDrafts = new Map();
  const taskOpen = new Map();
  const objectURLs = new Set();
  const create = (tag, text, attrs = {}) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    return node;
  };
  const root = create('section', undefined, { id: 'ourplace-studio', class: 'ourplace-studio', 'aria-label': 'Ourplace Studio' });
  const style = create('style', `
    #ourplace-studio{--studio-blue:#4ebfff;--studio-line:#294862;display:grid;gap:16px;min-width:0;color:#e2f1ff;font:14px/1.5 system-ui,sans-serif}
    #ourplace-studio *{box-sizing:border-box;min-width:0}#ourplace-studio [hidden]{display:none!important}
    #ourplace-studio h2,#ourplace-studio h3,#ourplace-studio h4,#ourplace-studio p{margin:0}
    #ourplace-studio h2{font-size:24px;letter-spacing:-.035em}#ourplace-studio h3{font-size:17px}#ourplace-studio h4{font-size:14px}
    #ourplace-studio .studio-muted,#ourplace-studio small{color:#adc7df}#ourplace-studio .studio-kicker{color:var(--studio-blue);font-size:11px;letter-spacing:.16em;text-transform:uppercase}
    #ourplace-studio .studio-head{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--studio-line);padding-bottom:14px}
    #ourplace-studio .studio-head>div{display:grid;gap:3px}#ourplace-studio .studio-head>button{flex:0 0 auto}
    #ourplace-studio button,#ourplace-studio input,#ourplace-studio textarea,#ourplace-studio select{font:inherit;color:#e7f4ff;background:#081827;border:1px solid #375c79;border-radius:9px;min-height:44px;padding:10px;max-width:100%}
    #ourplace-studio input,#ourplace-studio textarea,#ourplace-studio select{width:100%}#ourplace-studio textarea{min-height:110px;resize:vertical}
    #ourplace-studio button{cursor:pointer;text-align:left;line-height:1.35}#ourplace-studio button:hover{border-color:var(--studio-blue);background:#102b41}
    #ourplace-studio button:disabled{cursor:default;opacity:.5}#ourplace-studio :is(button,input,textarea,select,summary):focus-visible{outline:2px solid #8ad6ff;outline-offset:3px}
    #ourplace-studio .studio-primary{background:#0c4469;border-color:#45b9fc;font-weight:650}#ourplace-studio .studio-danger{color:#ffbdc4;border-color:#a75867}
    #ourplace-studio .studio-layout{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px;align-items:start}
    #ourplace-studio .studio-column,#ourplace-studio .studio-stack,#ourplace-studio form{display:grid;gap:12px}
    #ourplace-studio .studio-section-title{display:flex;align-items:center;justify-content:space-between;gap:10px}
    #ourplace-studio .studio-counter,#ourplace-studio .studio-badge{color:#91d5ff;font-size:11px;letter-spacing:.025em;padding:4px 7px;border:1px solid #315774;border-radius:5px;white-space:nowrap}
    #ourplace-studio .studio-field{display:grid;gap:5px;color:#cbdfef}#ourplace-studio .studio-field>span{font-size:12px}
    #ourplace-studio .studio-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#ourplace-studio .studio-row>.studio-field{flex:1 1 130px}
    #ourplace-studio .studio-actions{display:flex;flex-wrap:wrap;gap:8px}#ourplace-studio .studio-actions>button{flex:1 1 120px}
    #ourplace-studio .studio-inset{border:1px solid var(--studio-line);background:linear-gradient(140deg,#0c2031,#06111d);border-radius:12px;padding:12px}
    #ourplace-studio details>summary{cursor:pointer;min-height:44px;padding:10px 0;color:#c8e8ff}#ourplace-studio details[open]>summary{margin-bottom:8px}
    #ourplace-studio .studio-source{padding:12px 0;border-bottom:1px solid #233a4e;display:grid;gap:7px}
    #ourplace-studio .studio-source:first-child{padding-top:0}#ourplace-studio .studio-source-title{display:flex;align-items:center;gap:9px;min-height:44px;font-weight:600;overflow-wrap:anywhere}
    #ourplace-studio input[type=checkbox]{width:22px;height:22px;min-height:22px;padding:0;flex:0 0 22px;accent-color:#43baff}
    #ourplace-studio .studio-meta{font-size:12px;color:#aac5db;overflow-wrap:anywhere}#ourplace-studio .studio-empty{padding:15px 0;color:#adc7df}
    #ourplace-studio .studio-status{border-left:3px solid var(--studio-blue);background:#081b2a;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}
    #ourplace-studio .studio-status[data-error=true]{border-left-color:#f08d9d;color:#ffc8ce}#ourplace-studio .studio-warning{border-left:3px solid #e9b55d;padding:9px 12px;background:#211c12;color:#f4d59b}
    #ourplace-studio .studio-results{display:grid;gap:10px}#ourplace-studio blockquote{margin:0;padding:9px 12px;border-left:2px solid #426e8e;white-space:pre-wrap;overflow-wrap:anywhere;color:#cbe2f3}
    #ourplace-studio .studio-reader{display:grid;gap:12px;max-height:410px;overflow:auto;overscroll-behavior:contain}
    #ourplace-studio .studio-lines{display:grid;background:#040d16;border-radius:6px;overflow:hidden}
    #ourplace-studio .studio-line{display:grid;grid-template-columns:3.5em minmax(0,1fr);gap:10px;padding:3px 8px;font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
    #ourplace-studio .studio-line-number{color:#7397b4;text-align:right;user-select:none}#ourplace-studio .studio-cited{border-left:2px solid var(--studio-blue);padding-left:9px}
    #ourplace-studio .studio-task{border-top:1px solid #28455e;padding-top:4px}#ourplace-studio .studio-task h4{text-transform:capitalize}
    #ourplace-studio .studio-task-note{min-height:65px}#ourplace-studio .studio-brief{white-space:pre-wrap;overflow-wrap:anywhere}
    #ourplace-studio .studio-project-picker{margin-top:4px}#ourplace-studio .studio-project-picker select{font-weight:600}
    #ourplace-studio pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:10px;background:#040e18;font:12px/1.6 ui-monospace,monospace;max-height:220px;overflow:auto}
    @media(max-width:480px){#ourplace-studio{font-size:13px;gap:13px}#ourplace-studio .studio-layout{gap:16px}#ourplace-studio .studio-head{align-items:start}#ourplace-studio h2{font-size:21px}}
  `);
  root.append(style);
  const header = create('header', undefined, { class: 'studio-head' });
  const title = create('div');
  title.append(create('p', 'Sources → roles → production', { class: 'studio-kicker' }), create('h2', 'Ourplace Studio'));
  header.append(title);
  const back = create('button', '← Creator', { type: 'button', 'data-studio-back': '' });
  back.addEventListener('click', onBack);
  header.append(back);
  root.append(header, create('p', 'Turn your source material into a cited production plan.', { class: 'studio-muted' }),
    create('small', 'Local planning · no AI execution · progress is user reported · no rewards issued. Local identities are rehearsal labels, not authentication.'));
  const warning = create('div', '', { class: 'studio-warning', role: 'status', 'data-studio-warning': '' });
  const status = create('div', '', { class: 'studio-status', role: 'status', 'aria-live': 'polite', 'data-studio-status': '' });
  status.hidden = true;
  root.append(warning, status);
  const layout = create('div', undefined, { class: 'studio-layout' });
  const library = create('section', undefined, { class: 'studio-column', 'aria-label': 'Source library' });
  const production = create('section', undefined, { class: 'studio-column', 'aria-label': 'Production plan' });
  layout.append(library, production);
  root.append(layout);

  function announce(message, error = false) {
    status.textContent = String(message);
    status.hidden = !message;
    status.setAttribute('data-error', error ? 'true' : 'false');
  }
  function field(parent, label, tag = 'input', attrs = {}) {
    const id = `ourplace-studio-field-${++sequence}`;
    const wrapper = create('label', undefined, { class: 'studio-field', for: id });
    const input = create(tag, undefined, { id, ...attrs });
    wrapper.append(create('span', label), input);
    parent.append(wrapper);
    return input;
  }
  function action(parent, label, handler, attrs = {}) {
    const button = create('button', label, { type: 'button', ...attrs });
    button.addEventListener('click', () => perform(handler));
    parent.append(button);
    return button;
  }
  function perform(handler) {
    if (disposed) return;
    if (syncActor()) {
      refresh();
      announce('Local identity changed. Review this identity’s sources before continuing.');
      return;
    }
    try {
      handler();
      refresh();
    } catch (error) {
      refresh();
      announce(error?.message ?? 'The local operation could not be completed.', true);
    }
  }

  const libraryHeading = create('div', undefined, { class: 'studio-section-title' });
  const libraryCount = create('span', '0 sources', { class: 'studio-counter', 'data-studio-source-count': '' });
  libraryHeading.append(create('h3', '01 / Source library'), libraryCount);
  library.append(libraryHeading);
  const addSource = create('details', undefined, { class: 'studio-inset', 'data-studio-add-source': '' });
  addSource.append(create('summary', '+ Add source material'));
  const sourceForm = create('form', undefined, { 'data-studio-source-form': '' });
  const sourceTitle = field(sourceForm, 'Source title', 'input', { required: '', maxlength: '160', 'data-studio-source-title': '' });
  const upload = field(sourceForm, 'Read a local .txt or .md file (up to 256 KiB)', 'input', { type: 'file', accept: '.txt,.md,text/plain,text/markdown', 'data-studio-upload': '' });
  const sourceText = field(sourceForm, 'Source text · up to 100,000 characters', 'textarea', { required: '', maxlength: String(OURPLACE_STUDIO_LIMITS.documentCharacters), placeholder: 'Paste the material you want the production roles to reference…', 'data-studio-source-text': '' });
  const sourceRow = create('div', undefined, { class: 'studio-row' });
  sourceForm.append(sourceRow);
  const sourceFolder = field(sourceRow, 'Folder (optional)', 'input', { maxlength: '160', placeholder: 'Automatic from source text', 'data-studio-source-folder': '' });
  const sourceLicense = field(sourceRow, 'License', 'select', { 'data-studio-source-license': '' });
  for (const [value, label] of LICENSES) sourceLicense.append(create('option', label, { value }));
  const sourceOrigin = field(sourceForm, 'Origin URL or reference (optional; stored as text)', 'input', { maxlength: '500', placeholder: 'https://… or your own reference', 'data-studio-source-origin': '' });
  const sourceAttribution = field(sourceForm, 'Source author / required credit (required for CC BY)', 'input', { maxlength: '240', placeholder: 'Name and attribution supplied by the source', 'data-studio-source-attribution': '' });
  sourceForm.append(create('small', 'New sources start private. Choose a license only when you have the rights to use it. HTML and instructions in documents remain plain source text.'));
  sourceForm.append(create('button', 'Save private source', { type: 'submit', class: 'studio-primary', 'data-studio-source-save': '' }));
  addSource.append(sourceForm);
  library.append(addSource);
  action(library, 'Try a creator-room brief', () => {
    addSource.open = true;
    sourceTitle.value = 'Creator room · original starter brief';
    sourceText.value = '# Creator room\nMake a calm navy room for a creator to review authored 3D assets.\n\n## Modeling\nPreserve original authored GLB assets and their provenance. Do not replace them with procedural placeholders.\n\n## Materials\nUse electric blue to identify interactive surfaces; keep the main room navy and readable.\n\n## Lighting\nLight the asset for readable form without hiding detail in bloom.\n\n## Review\nCheck the room on a phone and desktop. Record frame-rate observations and source attribution.\n';
    sourceFolder.value = 'Studio starters';
    sourceLicense.value = 'CC0';
    sourceAttribution.value = 'Ourplace Studio original starter brief';
    sourceOrigin.value = 'Original local Studio starter text';
    if (!projectTitle.value) projectTitle.value = 'Creator room study';
    if (!projectBrief.value) projectBrief.value = 'Plan a calm navy review room that preserves authored assets, uses readable electric-blue materials, and has an explicit phone and performance review.';
    announce('Original starter text filled in. Review it, then save the source to build a plan.');
    sourceTitle.focus();
  }, { 'data-studio-example': '' });
  const sourceList = create('div', undefined, { 'data-studio-source-list': '' });
  library.append(sourceList);
  const searchForm = create('form', undefined, { role: 'search', 'data-studio-search-form': '' });
  const searchQuery = field(searchForm, 'Search source text', 'input', { type: 'search', maxlength: '160', placeholder: 'Find sections containing all your keywords', 'data-studio-search': '' });
  const searchFolder = field(searchForm, 'Limit to folder', 'select', { 'data-studio-search-folder': '' });
  searchForm.append(create('button', 'Find cited excerpts', { type: 'submit', 'data-studio-search-submit': '' }));
  const searchResults = create('div', undefined, { class: 'studio-results', 'aria-live': 'polite', 'data-studio-search-results': '' });
  library.append(searchForm, searchResults);
  const reader = create('section', undefined, { class: 'studio-inset studio-stack', 'aria-label': 'Source reader', 'data-studio-reader': '', tabindex: '-1' });
  reader.hidden = true;
  library.append(reader);

  const productionHeading = create('div', undefined, { class: 'studio-section-title' });
  const selectionCount = create('span', '0 selected', { class: 'studio-counter', 'data-studio-selection-count': '' });
  productionHeading.append(create('h3', '02 / Production plan'), selectionCount);
  production.append(productionHeading);
  const projectForm = create('form', undefined, { class: 'studio-inset', 'data-studio-project-form': '' });
  const projectTitle = field(projectForm, 'Project title', 'input', { required: '', maxlength: '160', placeholder: 'A scene, object, or world to make', 'data-studio-project-title': '' });
  const projectBrief = field(projectForm, 'Production brief', 'textarea', { required: '', maxlength: '4000', placeholder: 'Describe the result, the constraints, and how you will know it is ready.', 'data-studio-project-brief': '' });
  const captureLabel = create('label', undefined, { class: 'studio-source-title' });
  const captureDesign = create('input', undefined, { type: 'checkbox', 'data-studio-capture-design': '' });
  captureLabel.append(captureDesign, create('span', 'Include current Creator design as lineage'));
  projectForm.append(captureLabel, create('small', 'Select source checkboxes, then build a plan across director, modeling, materials, lighting, and review. Optional design lineage is an inert snapshot. Export requires fresh design provenance.'));
  const build = create('button', 'Build production plan', { type: 'submit', class: 'studio-primary', 'data-studio-project-build': '' });
  projectForm.append(build);
  production.append(projectForm);
  const projectPicker = field(production, 'Saved project', 'select', { class: 'studio-project-picker', 'data-studio-project-picker': '' });
  const projectView = create('div', undefined, { class: 'studio-stack', 'data-studio-project-view': '' });
  production.append(projectView);
  const assetRegion = create('section', undefined, { class: 'studio-stack', 'data-studio-asset-region': '', 'aria-label': 'Local asset inspection' });
  root.append(assetRegion);

  sourceForm.addEventListener('submit', event => {
    event.preventDefault();
    perform(() => {
      const imported = studio.importDocument({ actor: currentActor, title: sourceTitle.value, text: sourceText.value,
        folder: sourceFolder.value || undefined, origin: sourceOrigin.value || undefined, license: sourceLicense.value || 'unspecified', attribution: sourceAttribution.value || undefined });
      selectedSources.add(imported.id);
      sourceForm.reset();
      addSource.open = false;
      announce('Private source saved. It is selected for your next production plan.');
    });
  });
  upload.addEventListener('change', async () => {
    if (syncActor()) { refresh(); return; }
    const file = upload.files?.[0];
    if (!file) return;
    const actorAtRead = currentActor, epochAtRead = ++epoch;
    try {
      if (!/\.(txt|md)$/i.test(file.name)) throw new Error('Choose a .txt or .md source file.');
      if (file.size > MAX_UPLOAD_BYTES) throw new Error('Source files must be 256 KiB or smaller.');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('The source must be valid UTF-8 text. Save it as UTF-8 and try again.'); }
      if (disposed || epochAtRead !== epoch || actorAtRead !== String(getActor() ?? 'u:you')) { refresh(); return; }
      if (text.includes('\u0000')) throw new Error('This file contains binary data. Choose a plain-text .txt or .md source.');
      if (text.length > OURPLACE_STUDIO_LIMITS.documentCharacters) throw new Error('Source text exceeds 100,000 characters.');
      sourceText.value = text;
      if (!sourceTitle.value.trim()) sourceTitle.value = file.name.replace(/\.(txt|md)$/i, '').slice(0, 160);
      announce(`Read ${file.name} locally. Review the text and license, then save the source.`);
    } catch (error) {
      if (disposed || actorAtRead !== String(getActor() ?? 'u:you')) { refresh(); return; }
      upload.value = '';
      announce(error.message, true);
    }
  });
  searchForm.addEventListener('submit', event => { event.preventDefault(); perform(() => renderSearch()); });
  searchFolder.addEventListener('change', () => perform(() => renderSearch()));
  projectForm.addEventListener('submit', event => {
    event.preventDefault();
    perform(() => {
      const design = captureDesign.checked ? getDesign() : null;
      if (captureDesign.checked && !design?.descriptor) throw new Error('No current Creator design is available. Clear the lineage option or create a design first.');
      const project = studio.createProject({ actor: currentActor, title: projectTitle.value, brief: projectBrief.value,
        sourceIds: [...selectedSources], designSnapshot: design ? { descriptor: design.descriptor, provenance: design.provenance } : undefined });
      projectId = project.id;
      projectForm.reset();
      announce('Production plan saved. Role tasks are planned; report completion only after doing the work.');
    });
  });
  projectPicker.addEventListener('change', () => perform(() => { projectId = projectPicker.value || null; }));

  function clearSensitiveViews() {
    ++epoch;
    activeDocumentId = null;
    activeSectionId = null;
    reader.replaceChildren();
    reader.hidden = true;
    searchResults.replaceChildren();
    projectView.replaceChildren();
    taskDrafts.clear();
    taskOpen.clear();
    for (const url of objectURLs) windowRoot?.URL?.revokeObjectURL(url);
    objectURLs.clear();
  }
  function syncActor() {
    const nextActor = String(getActor() ?? 'u:you');
    if (nextActor === currentActor) return false;
    currentActor = nextActor;
    clearSensitiveViews();
    selectedSources.clear();
    projectId = null;
    lastAccessSignature = '';
    sourceForm.reset();
    projectForm.reset();
    searchForm.reset();
    addSource.open = false;
    announce('');
    return true;
  }
  function openSource(documentId, sectionId) {
    studio.getDocument({ actor: currentActor, documentId });
    activeDocumentId = documentId;
    activeSectionId = sectionId ?? null;
    renderReader();
    reader.focus({ preventScroll: true });
    reader.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }
  function renderSources(documents) {
    sourceList.replaceChildren();
    libraryCount.textContent = `${documents.length} ${documents.length === 1 ? 'source' : 'sources'}`;
    selectionCount.textContent = `${selectedSources.size} selected`;
    build.disabled = selectedSources.size === 0;
    if (!documents.length) sourceList.append(create('p', 'Your library starts here. Add a text source and make its evidence part of the plan.', { class: 'studio-empty' }));
    for (const source of documents) {
      const row = create('article', undefined, { class: 'studio-source', 'data-studio-document': source.id });
      const label = create('label', undefined, { class: 'studio-source-title' });
      const checkbox = create('input', undefined, { type: 'checkbox', 'data-studio-source-select': source.id });
      checkbox.checked = selectedSources.has(source.id);
      checkbox.disabled = source.visibility === 'revoked';
      label.append(checkbox, create('span', source.title));
      checkbox.addEventListener('change', () => perform(() => {
        if (checkbox.checked) selectedSources.add(source.id); else selectedSources.delete(source.id);
      }));
      row.append(label, create('div', `${source.folder || 'Unfiled'} · ${source.visibility || 'private'} · ${source.license || 'unspecified'}`, { class: 'studio-meta' }));
      if (source.attribution) row.append(create('small', `Credit: ${source.attribution}`));
      const controls = create('div', undefined, { class: 'studio-actions' });
      const readSource = action(controls, 'Read source', () => openSource(source.id), { 'data-studio-read-source': source.id });
      readSource.disabled = source.visibility === 'revoked';
      row.append(controls);
      if (source.owner === currentActor) {
        const access = create('details');
        access.append(create('summary', 'Owner controls'));
        const accessActions = create('div', undefined, { class: 'studio-actions' });
        access.append(accessActions);
        for (const [visibility, text] of [['private', 'Make private'], ['shared', 'Make shared'], ['revoked', 'Revoke access']]) {
          if (visibility === source.visibility) continue;
          action(accessActions, text, () => {
            studio.setAccess({ actor: currentActor, documentId: source.id, visibility });
            clearSensitiveViews();
            if (visibility === 'revoked') selectedSources.delete(source.id);
            announce(`Source access is now ${visibility}. Export eligibility will be checked again.`);
          }, { 'data-studio-source-access': `${source.id}:${visibility}` });
        }
        action(accessActions, 'Delete source', () => {
          studio.removeDocument({ actor: currentActor, documentId: source.id });
          selectedSources.delete(source.id);
          clearSensitiveViews();
          announce('Source deleted. Its dependent plans are permanently blocked. Create a new plan from available sources.');
        }, { class: 'studio-danger', 'data-studio-delete-source': source.id });
        row.append(access);
      }
      sourceList.append(row);
    }
    const folderValue = searchFolder.value;
    searchFolder.replaceChildren(create('option', 'All folders', { value: '' }));
    for (const folder of [...new Set(documents.map(source => source.folder || 'Unfiled'))].sort()) searchFolder.append(create('option', folder, { value: folder }));
    searchFolder.value = [...searchFolder.options].some(option => option.value === folderValue) ? folderValue : '';
  }
  function renderSearch() {
    searchResults.replaceChildren();
    const query = searchQuery.value.trim();
    if (!query) return;
    const result = studio.search({ actor: currentActor, query, folder: searchFolder.value || undefined });
    searchResults.append(create('small', `${result.results.length} exact source excerpts · local keyword search`));
    if (!result.results.length) searchResults.append(create('p', 'No matching text in the sources available to this identity.', { class: 'studio-empty' }));
    for (const match of result.results) {
      const item = create('article', undefined, { class: 'studio-stack', 'data-studio-search-result': match.documentId });
      item.append(create('blockquote', match.excerpt));
      action(item, `${match.title} / ${match.sectionTitle} · lines ${match.startLine}–${match.endLine}`, () => openSource(match.documentId, match.sectionId),
        { 'data-studio-citation': `${match.documentId}:${match.sectionId}` });
      item.append(create('small', `${match.folder || 'Unfiled'} · ${match.license || 'unspecified'}${match.origin ? ` · ${match.origin}` : ''}${match.attribution ? ` · Credit: ${match.attribution}` : ''}`));
      searchResults.append(item);
    }
  }
  function renderReader() {
    reader.replaceChildren();
    reader.hidden = !activeDocumentId;
    if (!activeDocumentId) return;
    let source;
    try { source = studio.getDocument({ actor: currentActor, documentId: activeDocumentId }); }
    catch { activeDocumentId = null; reader.hidden = true; return; }
    if (!source || source.visibility === 'revoked') { activeDocumentId = null; reader.hidden = true; return; }
    const heading = create('div', undefined, { class: 'studio-section-title' });
    heading.append(create('h3', source.title));
    action(heading, 'Close', () => { activeDocumentId = null; activeSectionId = null; }, { 'data-studio-reader-close': '' });
    reader.append(heading, create('p', `${source.folder || 'Unfiled'} · ${source.license || 'unspecified'}${source.origin ? ` · ${source.origin}` : ''}${source.attribution ? ` · Credit: ${source.attribution}` : ''}`, { class: 'studio-meta' }));
    const sections = source.sections ?? [];
    const selectedIndex = Math.max(0, sections.findIndex(section => section.id === activeSectionId));
    const navigation = create('div', undefined, { class: 'studio-actions' });
    const previous = action(navigation, 'Previous section', () => { activeSectionId = sections[selectedIndex - 1]?.id; }, { 'data-studio-section-previous': '' });
    previous.disabled = selectedIndex === 0;
    const next = action(navigation, 'Next section', () => { activeSectionId = sections[selectedIndex + 1]?.id; }, { 'data-studio-section-next': '' });
    next.disabled = selectedIndex >= sections.length - 1;
    reader.append(create('small', `Section ${selectedIndex + 1} of ${sections.length} · original source text`), navigation);
    const body = create('div', undefined, { class: 'studio-reader' });
    let citedSection;
    // Render one bounded section at a time, including for very line-dense files.
    for (const section of sections.slice(selectedIndex, selectedIndex + 1)) {
      const sectionNode = create('section', undefined, { class: `studio-stack${activeSectionId === section.id ? ' studio-cited' : ''}`, 'data-studio-reader-section': section.id });
      sectionNode.append(create('h4', `${section.title} · lines ${section.startLine}–${section.endLine}`));
      const lines = create('div', undefined, { class: 'studio-lines' });
      for (const [index, text] of section.text.split('\n').entries()) {
        const line = create('div', undefined, { class: 'studio-line' });
        line.append(create('span', String(section.startLine + index), { class: 'studio-line-number', 'aria-label': `Line ${section.startLine + index}` }), create('span', text || ' '));
        lines.append(line);
      }
      sectionNode.append(lines);
      body.append(sectionNode);
      if (activeSectionId === section.id) citedSection = sectionNode;
    }
    reader.append(body);
    citedSection?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }
  function downloadProject(format) {
    if (!projectId) throw new Error('Select a project to export.');
    // This call is intentionally fresh at the click; earlier preview permission is insufficient.
    const packet = studio.exportProject({ actor: currentActor, projectId });
    const text = format === 'json' ? JSON.stringify(packet, null, 2) : studioBriefingMarkdown(packet);
    if (!windowRoot?.URL?.createObjectURL || !windowRoot?.Blob) throw new Error('File downloads are unavailable in this browser.');
    const url = windowRoot.URL.createObjectURL(new windowRoot.Blob([text], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }));
    objectURLs.add(url);
    const anchor = create('a', undefined, { href: url, download: `ourplace-studio-${projectId.replace(/[^a-z0-9-]/gi, '-')}.${format === 'json' ? 'json' : 'md'}` });
    anchor.hidden = true;
    root.append(anchor);
    anchor.click();
    anchor.remove();
    windowRoot.setTimeout?.(() => { windowRoot.URL.revokeObjectURL(url); objectURLs.delete(url); }, 1000);
    announce(`${format === 'json' ? 'JSON plan' : 'Markdown briefing'} prepared for download after fresh source-access validation.`);
  }
  function renderProject(projects) {
    projectPicker.replaceChildren(create('option', 'Choose a saved project', { value: '' }));
    for (const project of projects) projectPicker.append(create('option', project.title ?? (project.blocked ? 'Blocked project' : project.id), { value: project.id }));
    if (projectId && !projects.some(project => project.id === projectId)) projectId = null;
    projectPicker.value = projectId ?? '';
    projectView.replaceChildren();
    if (!projectId) {
      projectView.append(create('p', 'Your role plan will appear here. Each task keeps its dependencies and source references visible.', { class: 'studio-empty' }));
      return;
    }
    const project = studio.getProject({ actor: currentActor, projectId });
    if (project.blocked || project.status === 'blocked') {
      projectView.append(create('p', 'This project is blocked because one or more source documents are unavailable. Its brief, tasks, and derived content are hidden; export is disabled.', { class: 'studio-warning', 'data-studio-project-blocked': '' }));
      return;
    }
    projectView.append(create('h3', project.title), create('p', project.brief, { class: 'studio-brief' }));
    const sourceDetails = create('details');
    sourceDetails.append(create('summary', 'Source references and design lineage'));
    const refs = create('div', undefined, { class: 'studio-stack' });
    const sourceIds = project.sourceIds ?? (project.sourceRefs ?? []).map(source => typeof source === 'string' ? source : source.documentId ?? source.id);
    for (const sourceId of sourceIds) {
      const source = studio.getDocument({ actor: currentActor, documentId: sourceId });
      action(refs, `${source.title} · ${source.license}`, () => openSource(sourceId), { 'data-studio-project-source': sourceId });
    }
    for (const citation of project.citations ?? []) {
      refs.append(create('blockquote', citation.excerpt));
      action(refs, `${citation.title} / ${citation.sectionTitle} · lines ${citation.startLine}–${citation.endLine}`,
        () => openSource(citation.documentId, citation.sectionId), { 'data-studio-project-citation': `${citation.documentId}:${citation.sectionId}` });
      if (citation.attribution) refs.append(create('small', `Credit: ${citation.attribution}`));
    }
    if (project.designSnapshot) refs.append(create('small', 'Creator design captured as inert lineage.'), create('pre', JSON.stringify(project.designSnapshot, null, 2), { 'data-studio-design-lineage': '' }));
    sourceDetails.append(refs);
    projectView.append(sourceDetails);
    const tasks = project.tasks ?? [];
    for (const task of tasks) {
      const taskNode = create('details', undefined, { class: 'studio-task', 'data-studio-task': task.id });
      const draftKey = `${projectId}:${task.id}`;
      taskNode.open = taskOpen.has(draftKey) ? taskOpen.get(draftKey) : task.id === 'director';
      taskNode.addEventListener('toggle', () => { if (taskNode.isConnected) taskOpen.set(draftKey, taskNode.open); });
      const heading = create('summary', undefined, { class: 'studio-section-title' });
      heading.append(create('h4', task.role ?? task.title), create('span', task.status === 'done' ? 'Done · user reported' : 'Planned', { class: 'studio-badge' }));
      taskNode.append(heading);
      const taskBody = create('div', undefined, { class: 'studio-stack' });
      taskNode.append(taskBody);
      if (task.title && task.title !== task.role) taskBody.append(create('p', task.title));
      if (task.description) taskBody.append(create('p', task.description, { class: 'studio-muted' }));
      if (task.deliverables?.length) {
        const deliverables = create('ul');
        for (const deliverable of task.deliverables) deliverables.append(create('li', deliverable));
        taskBody.append(deliverables);
      }
      const dependencies = task.dependsOn ?? task.dependencies ?? [];
      const unmet = dependencies.filter(id => !tasks.some(item => item.id === id && item.status === 'done'));
      taskBody.append(create('small', `Depends on: ${dependencies.map(id => tasks.find(item => item.id === id)?.role ?? id).join(', ') || 'No earlier task'}`));
      if (project.citations?.length) action(taskBody, `Review ${project.citations.length} cited source ${project.citations.length === 1 ? 'section' : 'sections'}`, () => {
        sourceDetails.open = true;
        sourceDetails.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      }, { 'data-studio-task-sources': task.id });
      const note = field(taskBody, 'Work note (user reported)', 'textarea', { class: 'studio-task-note', maxlength: '1000', 'data-studio-task-note': task.id });
      note.value = taskDrafts.has(draftKey) ? taskDrafts.get(draftKey) : task.note ?? '';
      note.addEventListener('input', () => taskDrafts.set(draftKey, note.value));
      const taskActions = create('div', undefined, { class: 'studio-actions' });
      action(taskActions, 'Save note', () => {
        studio.updateTask({ actor: currentActor, projectId, taskId: task.id, status: task.status, note: note.value });
        taskDrafts.delete(draftKey);
        announce('User work note saved.');
      }, { 'data-studio-task-save': task.id });
      const toggle = action(taskActions, task.status === 'done' ? 'Return to planned' : 'Mark done · user reported', () => {
        studio.updateTask({ actor: currentActor, projectId, taskId: task.id, status: task.status === 'done' ? 'planned' : 'done', note: note.value });
        taskDrafts.delete(draftKey);
        announce(task.status === 'done' ? 'Task returned to planned.' : 'Completion recorded as user reported.');
      }, { 'data-studio-task-toggle': task.id });
      toggle.disabled = task.status !== 'done' && unmet.length > 0;
      if (unmet.length && task.status !== 'done') taskBody.append(create('small', 'Complete the prerequisite tasks to unlock this completion step.'));
      taskBody.append(taskActions);
      projectView.append(taskNode);
    }
    const exportActions = create('div', undefined, { class: 'studio-actions' });
    action(exportActions, 'Download JSON plan', () => downloadProject('json'), { 'data-studio-export': 'json' });
    action(exportActions, 'Download Markdown briefing', () => downloadProject('markdown'), { 'data-studio-export': 'markdown' });
    projectView.append(create('p', 'Sharing requires every source to be shared and licensed for reuse. Private, revoked, missing, or restricted sources block export. Every download checks access again.', { class: 'studio-meta' }), exportActions);
  }
  function refresh() {
    if (disposed) return;
    syncActor();
    try {
      const documents = studio.listDocuments({ actor: currentActor });
      const signature = JSON.stringify(documents.map(source => [source.id, source.visibility, source.license]));
      if (lastAccessSignature && lastAccessSignature !== signature) clearSensitiveViews();
      lastAccessSignature = signature;
      for (const sourceId of selectedSources) if (!documents.some(source => source.id === sourceId && source.visibility !== 'revoked')) selectedSources.delete(sourceId);
      renderSources(documents);
      renderSearch();
      renderReader();
      renderProject(studio.listProjects({ actor: currentActor }));
      const message = studio.warning;
      warning.textContent = message ? String(message) : '';
      warning.hidden = !message;
    } catch (error) {
      clearSensitiveViews();
      sourceList.replaceChildren();
      projectPicker.replaceChildren();
      announce(error?.message ?? 'Local source data could not be read.', true);
    }
  }
  const onStorage = event => { if (!event.key || event.key === STORAGE_KEY) refresh(); };
  const onFocus = () => refresh();
  windowRoot?.addEventListener?.('storage', onStorage);
  windowRoot?.addEventListener?.('focus', onFocus);
  host.append(root);
  refresh();
  return {
    refresh,
    studio,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearSensitiveViews();
      windowRoot?.removeEventListener?.('storage', onStorage);
      windowRoot?.removeEventListener?.('focus', onFocus);
      root.remove();
    }
  };
}
