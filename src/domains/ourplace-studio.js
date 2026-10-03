/**
 * Ourplace source library and production planning. This is a same-browser role
 * rehearsal, not authentication, an AI agent, Blender execution or a payment API.
 * Documents are inert text. Projects retain source IDs, never cached quotations.
 */
import { normalizeDesignDescriptor, normalizeDesignProvenance } from './creator-economy.js?v=20261003-complete8';

export const OURPLACE_STUDIO_STORAGE_KEY = 'matumbo.ourplace-studio.v1';
export const OURPLACE_STUDIO_LIMITS = Object.freeze({ documents: 60, documentCharacters: 100000, totalCharacters: 1000000, projects: 30, projectSources: 8, searchResults: 40 });
export const OURPLACE_STUDIO_LICENSES = Object.freeze(['unspecified', 'restricted', 'CC0', 'CC-BY']);
const VISIBILITIES = ['private', 'shared', 'revoked'];
const MAX_STATE_CHARACTERS = 3500000;
const ROLE_TASKS = Object.freeze([
  { id: 'director', role: 'director', title: 'Direction and source review', description: 'Review the brief and cited sources; define the object, scale and acceptance criteria.', dependencies: [], deliverables: ['Reviewed brief', 'Source and license review', 'Acceptance criteria'] },
  { id: 'modeling', role: 'modeling', title: 'Geometry and scale', description: 'Plan or build geometry in your chosen tool and record the actual result.', dependencies: ['director'], deliverables: ['Geometry plan or authored model', 'Scale and topology notes'] },
  { id: 'materials', role: 'materials', title: 'Materials and attribution', description: 'Plan surfaces and material references, retaining the relevant source attribution.', dependencies: ['director'], deliverables: ['Material palette', 'Texture provenance and attribution'] },
  { id: 'lighting', role: 'lighting', title: 'Lighting and composition', description: 'Review geometry and materials before planning lighting, camera and composition.', dependencies: ['modeling', 'materials'], deliverables: ['Lighting and camera plan', 'Composition review'] },
  { id: 'review', role: 'review', title: 'Review and handoff', description: 'Compare the recorded work with acceptance criteria and identify unverified or unfinished work.', dependencies: ['lighting'], deliverables: ['Acceptance checklist', 'Remaining limitations', 'Human-reviewed handoff'] },
]);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (message, code = 'STUDIO_INVALID') => { const error = new Error(message); error.code = code; throw error; };

function plain(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`Unsupported ${label} field: ${key}`);
  return value;
}

function boundedText(value, label, max, { empty = false, multiline = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label} must contain ${empty ? '0' : '1'}–${max} characters`);
  if ((multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail(`${label} must be plain UTF-8 text`);
  // Reject malformed UTF-16 rather than silently replacing it during UTF-8 export.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(`${label} contains malformed Unicode`); }
    else if (c >= 0xdc00 && c <= 0xdfff) fail(`${label} contains malformed Unicode`);
  }
  return value;
}

function actorId(value) {
  boundedText(value, 'Actor', 66);
  if (!/^u:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) fail('Use a local u:<identity> participant role');
  return value;
}

function one(value, choices, label) { if (!choices.includes(value)) fail(`Unsupported ${label}`); return value; }
function timestamp(value) { if (typeof value !== 'string' || value.length !== 24 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Invalid studio timestamp'); return value; }
function identifier(value, kind) { if (typeof value !== 'string' || !new RegExp(`^${kind}:[1-9][0-9]{0,8}$`).test(value)) fail(`Invalid ${kind} identifier`); return value; }
function folderName(value) {
  const name = boundedText(value, 'Folder', 160).trim();
  const parts = name.split('/');
  if (parts.length > 6 || parts.some(part => !part.trim() || part === '.' || part === '..' || /[\\<>]/.test(part))) fail('Folder must be a path of 1–6 named sections');
  return parts.map(part => part.trim()).join('/');
}

function automaticFolder(title, body) {
  const words = `${title}\n${body.slice(0, 3000)}`.toLowerCase();
  if (/\b(material|texture|shader|surface|palette)\b/.test(words)) return 'Production/Materials';
  if (/\b(light|lighting|camera|composition)\b/.test(words)) return 'Production/Lighting';
  if (/\b(mesh|model|modeling|geometry|topology|scale)\b/.test(words)) return 'Production/Geometry';
  if (/\b(brief|direction|story|concept)\b/.test(words)) return 'Production/Direction';
  return 'Library/References';
}

function designData(value) {
  if (value == null) return null;
  plain(value, 'design snapshot', ['descriptor', 'provenance']);
  if (!value.descriptor || !value.provenance) fail('Design snapshot requires descriptor and provenance');
  const normalized = { descriptor: clone(normalizeDesignDescriptor(value.descriptor)), provenance: clone(normalizeDesignProvenance(value.provenance)) };
  if (JSON.stringify(normalized).length > 16000) fail('Design snapshot exceeds 16000 characters');
  return normalized;
}

function sectionsOf(document) {
  const lines = document.text.split(/\r\n|\n|\r/), sections = [];
  let start = 0, title = document.title, fence = null;
  const append = end => {
    if (end <= start) return;
    sections.push({ id: `${document.id}:section:${sections.length + 1}`, title, startLine: start + 1, endLine: end, text: lines.slice(start, end).join('\n') });
    start = end;
  };
  for (let i = 0; i < lines.length; i++) {
    const fenceLine = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceLine) {
      if (!fence) fence = { character: fenceLine[1][0], size: fenceLine[1].length };
      else if (fenceLine[1][0] === fence.character && fenceLine[1].length >= fence.size) fence = null;
    }
    const heading = !fence && !fenceLine ? lines[i].match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/) : null;
    if (heading) { append(i); title = heading[1]; }
    else if (i - start >= 40) append(i);
  }
  append(lines.length);
  return sections;
}

function citation(document, section, terms = []) {
  const lines = section.text.split('\n');
  const match = terms.length ? lines.findIndex(line => terms.some(term => line.toLowerCase().includes(term))) : 0;
  const first = Math.max(0, match - 1);
  let excerpt = lines.slice(first, first + 3).join('\n');
  // A single very long source line stays a quotation from that exact line.
  if (excerpt.length > 2000) {
    const hit = terms.length ? Math.max(0, excerpt.toLowerCase().indexOf(terms.find(term => excerpt.toLowerCase().includes(term)) ?? '')) : 0;
    const offset = Math.max(0, hit - 400);
    const precedingLines = excerpt.slice(0, offset).split('\n').length - 1;
    excerpt = excerpt.slice(offset, offset + 2000);
    return { documentId: document.id, title: document.title, folder: document.folder, sectionId: section.id, sectionTitle: section.title, startLine: section.startLine + first + precedingLines, endLine: section.startLine + first + precedingLines + excerpt.split('\n').length - 1, excerpt, origin: document.origin, license: document.license, attribution: document.attribution };
  }
  return { documentId: document.id, title: document.title, folder: document.folder, sectionId: section.id, sectionTitle: section.title, startLine: section.startLine + first, endLine: section.startLine + first + excerpt.split('\n').length - 1, excerpt, origin: document.origin, license: document.license, attribution: document.attribution };
}

const accessible = (document, actor) => document && document.visibility !== 'revoked' && (document.owner === actor || document.visibility === 'shared');
const sourceMetadata = document => ({ id: document.id, owner: document.owner, title: document.title, folder: document.folder, origin: document.origin, license: document.license, attribution: document.attribution, visibility: document.visibility, createdAt: document.createdAt, updatedAt: document.updatedAt });
const blank = () => ({ schemaVersion: 1, nextId: 1, documents: [], projects: [] });

/** Strict restore validates every owned field; unknown authority-bearing fields fail closed. */
function validateState(value) {
  plain(value, 'saved studio', ['schemaVersion', 'nextId', 'documents', 'projects']);
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.nextId) || value.nextId < 1 || value.nextId > 999999999 || !Array.isArray(value.documents) || !Array.isArray(value.projects)) fail('Invalid saved studio schema');
  if (value.documents.length > OURPLACE_STUDIO_LIMITS.documents || value.projects.length > OURPLACE_STUDIO_LIMITS.projects) fail('Saved studio exceeds record limits');
  const seen = new Set();
  const register = (id, kind) => { identifier(id, kind); const sequence = Number(id.split(':')[1]); if (seen.has(sequence) || sequence >= value.nextId) fail('Duplicate or invalid saved identifier sequence'); seen.add(sequence); };
  let total = 0;
  for (const document of value.documents) {
    plain(document, 'saved document', ['id', 'owner', 'title', 'text', 'folder', 'origin', 'license', 'attribution', 'visibility', 'createdAt', 'updatedAt']);
    register(document.id, 'document'); actorId(document.owner); boundedText(document.title, 'Document title', 160); boundedText(document.text, 'Document text', OURPLACE_STUDIO_LIMITS.documentCharacters, { multiline: true });
    if (folderName(document.folder) !== document.folder) fail('Invalid saved folder');
    boundedText(document.origin, 'Document origin', 500); boundedText(document.attribution, 'Source attribution', 240, { empty: true }); one(document.license, OURPLACE_STUDIO_LICENSES, 'license'); one(document.visibility, VISIBILITIES, 'visibility'); timestamp(document.createdAt); timestamp(document.updatedAt);
    if (document.updatedAt < document.createdAt) fail('Invalid document chronology');
    total += document.text.length;
  }
  if (total > OURPLACE_STUDIO_LIMITS.totalCharacters) fail('Library exceeds 1000000 text characters');
  for (const project of value.projects) {
    plain(project, 'saved project', ['id', 'owner', 'title', 'brief', 'sourceIds', 'designSnapshot', 'tasks', 'invalidated', 'createdAt', 'updatedAt']);
    register(project.id, 'project'); actorId(project.owner); boundedText(project.title, 'Project title', 160); boundedText(project.brief, 'Project brief', 4000, { multiline: true }); timestamp(project.createdAt); timestamp(project.updatedAt);
    if (project.updatedAt < project.createdAt || typeof project.invalidated !== 'boolean') fail('Invalid saved project metadata');
    if (!Array.isArray(project.sourceIds) || project.sourceIds.length < 1 || project.sourceIds.length > OURPLACE_STUDIO_LIMITS.projectSources || new Set(project.sourceIds).size !== project.sourceIds.length) fail('Projects require 1–8 unique source IDs');
    project.sourceIds.forEach(id => identifier(id, 'document'));
    if (!Object.hasOwn(project, 'designSnapshot')) fail('Saved project is missing its design snapshot field');
    designData(project.designSnapshot);
    if (!Array.isArray(project.tasks) || project.tasks.length !== ROLE_TASKS.length) fail('Invalid saved production tasks');
    for (const [index, task] of project.tasks.entries()) {
      plain(task, 'saved task', ['id', 'status', 'note', 'reportedAt']);
      if (task.id !== ROLE_TASKS[index].id) fail('Invalid production task order');
      one(task.status, ['planned', 'done'], 'task status'); boundedText(task.note, 'Task note', 1000, { empty: true, multiline: true });
      if (task.status === 'done') {
        timestamp(task.reportedAt);
        if (!task.note.trim() || task.reportedAt < project.createdAt || task.reportedAt > project.updatedAt || ROLE_TASKS[index].dependencies.some(id => project.tasks.find(row => row.id === id)?.status !== 'done')) fail('Completed task lacks its note, timestamp or completed dependencies');
      } else if (task.reportedAt !== null) fail('Planned tasks cannot carry completion evidence');
    }
  }
  return value;
}

function defaultStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }

export function createOurplaceStudio({ storage = defaultStorage(), storageKey = OURPLACE_STUDIO_STORAGE_KEY, now = () => new Date().toISOString() } = {}) {
  boundedText(storageKey, 'Storage key', 160);
  if (typeof now !== 'function' || (storage !== null && (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function'))) fail('Invalid studio persistence options');
  let state = blank(), warning = storage === null ? 'Local persistence is disabled; data lives only in this instance.' : null, blockedStorage = false;

  function reload() {
    if (storage === null) return;
    try {
      const raw = storage.getItem(storageKey);
      if (raw === null) state = blank();
      else {
        if (typeof raw !== 'string' || raw.length > MAX_STATE_CHARACTERS) fail('Saved studio exceeds its size limit');
        state = validateState(JSON.parse(raw));
      }
      warning = null; blockedStorage = false;
    } catch {
      state = blank(); blockedStorage = true;
      // Parser diagnostics may contain private source bytes. Keep restore errors
      // independent of both the selected participant and the malformed payload.
      warning = 'Saved studio was not loaded: data is invalid, unavailable, or exceeds its size limit. Access is closed and existing saved data has not been overwritten.';
    }
  }
  function read(actor) { actorId(actor); reload(); return state; }
  function mutate(actor, operation) {
    read(actor);
    if (blockedStorage) fail(warning, 'STUDIO_STORAGE_BLOCKED');
    const next = clone(state), result = operation(next);
    validateState(next);
    const serialized = JSON.stringify(next);
    if (serialized.length > MAX_STATE_CHARACTERS) fail('Studio exceeds its persistence size limit');
    if (storage !== null) {
      try { storage.setItem(storageKey, serialized); }
      catch { warning = 'Studio save failed: local storage is unavailable or full. The change was not saved.'; fail(warning, 'STUDIO_STORAGE_WRITE'); }
    }
    state = next;
    return clone(result);
  }
  const time = () => timestamp(now());
  function getReadable(documentId, actor, from = state) {
    identifier(documentId, 'document');
    const document = from.documents.find(row => row.id === documentId);
    if (!accessible(document, actor)) fail('Document is unavailable or access is denied', 'STUDIO_ACCESS_DENIED');
    return document;
  }
  function ownProject(projectId, actor, from = state) {
    identifier(projectId, 'project');
    const project = from.projects.find(row => row.id === projectId && row.owner === actor);
    if (!project) fail('Project is unavailable or access is denied', 'STUDIO_ACCESS_DENIED');
    return project;
  }
  function projectBlocked(project, from = state) { return project.invalidated || project.sourceIds.some(id => !accessible(from.documents.find(document => document.id === id), project.owner)); }
  function documentView(document) { return { ...sourceMetadata(document), text: document.text, sections: sectionsOf(document) }; }
  function projectView(project, from = state) {
    if (projectBlocked(project, from)) return { id: project.id, owner: project.owner, title: 'Blocked project', createdAt: project.createdAt, updatedAt: project.updatedAt, status: 'blocked', blocked: true, blockedReason: 'A source was revoked, deleted or made unavailable. Create a new project from currently accessible sources.' };
    const documents = project.sourceIds.map(id => from.documents.find(row => row.id === id));
    const tasks = project.tasks.map((task, index) => ({ ...clone(ROLE_TASKS[index]), ...clone(task), completionEvidence: task.status === 'done' ? 'user-reported' : 'not-reported' }));
    return { id: project.id, owner: project.owner, title: project.title, brief: project.brief, sourceIds: [...project.sourceIds], sources: documents.map(sourceMetadata), citations: documents.flatMap(document => sectionsOf(document).slice(0, 2).map(section => citation(document, section))), designSnapshot: clone(project.designSnapshot), tasks, createdAt: project.createdAt, updatedAt: project.updatedAt, status: tasks.every(task => task.status === 'done') ? 'user-reported-complete' : tasks.some(task => task.status === 'done') ? 'in-progress' : 'planned', blocked: false, blockedReason: null, localOnly: true, aiExecuted: false, blenderExecuted: false, payoutAuthorized: false };
  }
  reload();

  return Object.freeze({
    get warning() { return warning; },
    importDocument(input) {
      plain(input, 'document import', ['actor', 'title', 'text', 'folder', 'origin', 'license', 'attribution']);
      const { actor } = input, title = boundedText(input.title, 'Document title', 160).trim(), body = boundedText(input.text, 'Document text', OURPLACE_STUDIO_LIMITS.documentCharacters, { multiline: true });
      const folder = input.folder ? folderName(input.folder) : automaticFolder(title, body), origin = boundedText(input.origin ?? 'Local text import', 'Document origin', 500).trim(), license = one(input.license ?? 'unspecified', OURPLACE_STUDIO_LICENSES, 'license'), attribution = boundedText(input.attribution ?? '', 'Source attribution', 240, { empty: true }).trim();
      if (license === 'CC-BY' && !attribution) fail('CC-BY sources require the original author or required attribution credit');
      const document = mutate(actor, next => {
        if (next.documents.length >= OURPLACE_STUDIO_LIMITS.documents) fail('Library allows at most 60 documents');
        if (next.documents.reduce((sum, row) => sum + row.text.length, 0) + body.length > OURPLACE_STUDIO_LIMITS.totalCharacters) fail('Library exceeds 1000000 text characters');
        const at = time(), row = { id: `document:${next.nextId++}`, owner: actor, title, text: body, folder, origin, license, attribution, visibility: 'private', createdAt: at, updatedAt: at };
        next.documents.push(row); return row;
      });
      return documentView(document);
    },
    listDocuments({ actor }) {
      read(actor);
      return state.documents.filter(document => document.owner === actor || accessible(document, actor)).map(document => ({ ...sourceMetadata(document), sections: accessible(document, actor) ? sectionsOf(document) : [], blocked: !accessible(document, actor) }));
    },
    getDocument({ actor, documentId }) { read(actor); return documentView(getReadable(documentId, actor)); },
    search({ actor, query, folder }) {
      const original = boundedText(query, 'Search query', 160, { empty: true }).trim(), terms = [...new Set(original.toLowerCase().split(/\s+/).filter(Boolean))];
      if (terms.length > 12) fail('Search accepts at most 12 keyword terms');
      const folderFilter = folder ? folderName(folder) : null;
      read(actor);
      const results = [];
      if (terms.length) for (const document of state.documents) {
        if (!accessible(document, actor) || (folderFilter && document.folder !== folderFilter && !document.folder.startsWith(`${folderFilter}/`))) continue;
        for (const section of sectionsOf(document)) {
          const haystack = `${document.title}\n${section.title}\n${section.text}`.toLowerCase();
          if (terms.every(term => haystack.includes(term))) results.push(citation(document, section, terms));
          if (results.length >= OURPLACE_STUDIO_LIMITS.searchResults) return { query: original, results, method: 'local-keyword-search' };
        }
      }
      return { query: original, results, method: 'local-keyword-search' };
    },
    setAccess({ actor, documentId, visibility }) {
      identifier(documentId, 'document'); one(visibility, VISIBILITIES, 'visibility');
      return mutate(actor, next => {
        const document = next.documents.find(row => row.id === documentId && row.owner === actor);
        if (!document) fail('Only the document owner can change access', 'STUDIO_ACCESS_DENIED');
        document.visibility = visibility; document.updatedAt = time();
        for (const project of next.projects) if (project.sourceIds.includes(documentId) && !accessible(document, project.owner)) { project.invalidated = true; project.updatedAt = document.updatedAt; }
        return { ...sourceMetadata(document), sections: accessible(document, actor) ? sectionsOf(document) : [], blocked: !accessible(document, actor) };
      });
    },
    removeDocument({ actor, documentId }) {
      identifier(documentId, 'document');
      return mutate(actor, next => {
        if (!next.documents.some(row => row.id === documentId && row.owner === actor)) fail('Only the document owner can remove this document', 'STUDIO_ACCESS_DENIED');
        next.documents = next.documents.filter(row => row.id !== documentId);
        const at = time();
        for (const project of next.projects) if (project.sourceIds.includes(documentId)) { project.invalidated = true; project.updatedAt = at; }
        return { removed: true, documentId };
      });
    },
    createProject(input) {
      plain(input, 'project creation', ['actor', 'title', 'brief', 'sourceIds', 'designSnapshot']);
      const { actor } = input, title = boundedText(input.title, 'Project title', 160).trim(), brief = boundedText(input.brief, 'Project brief', 4000, { multiline: true }), designSnapshot = designData(input.designSnapshot);
      if (!Array.isArray(input.sourceIds) || input.sourceIds.length < 1 || input.sourceIds.length > OURPLACE_STUDIO_LIMITS.projectSources || new Set(input.sourceIds).size !== input.sourceIds.length) fail('Projects require 1–8 unique source IDs');
      const sourceIds = input.sourceIds.map(id => identifier(id, 'document'));
      const project = mutate(actor, next => {
        if (next.projects.length >= OURPLACE_STUDIO_LIMITS.projects) fail('Studio allows at most 30 projects');
        sourceIds.forEach(id => getReadable(id, actor, next));
        const at = time(), row = { id: `project:${next.nextId++}`, owner: actor, title, brief, sourceIds, designSnapshot, tasks: ROLE_TASKS.map(task => ({ id: task.id, status: 'planned', note: '', reportedAt: null })), invalidated: false, createdAt: at, updatedAt: at };
        next.projects.push(row); return row;
      });
      return projectView(project);
    },
    listProjects({ actor }) { read(actor); return state.projects.filter(project => project.owner === actor).map(project => projectView(project)); },
    getProject({ actor, projectId }) { read(actor); return projectView(ownProject(projectId, actor)); },
    updateTask({ actor, projectId, taskId, status, note = '' }) {
      one(status, ['planned', 'done'], 'task status'); boundedText(note, 'Task note', 1000, { empty: true, multiline: true });
      const project = mutate(actor, next => {
        const row = ownProject(projectId, actor, next);
        if (projectBlocked(row, next)) fail('Project is blocked by unavailable sources', 'STUDIO_PROJECT_BLOCKED');
        const task = row.tasks.find(item => item.id === taskId), template = ROLE_TASKS.find(item => item.id === taskId);
        if (!task || !template) fail('Unknown production task');
        if (status === 'done' && (!note.trim() || template.dependencies.some(id => row.tasks.find(item => item.id === id).status !== 'done'))) fail('Complete prerequisite tasks and add a completion note before marking this task done');
        if (status === 'planned' && row.tasks.some(item => item.status === 'done' && ROLE_TASKS.find(role => role.id === item.id).dependencies.includes(taskId))) fail('Reopen dependent tasks before reopening this prerequisite');
        row.updatedAt = time(); task.status = status; task.note = note; task.reportedAt = status === 'done' ? row.updatedAt : null;
        return row;
      });
      return projectView(project);
    },
    exportProject({ actor, projectId }) {
      read(actor);
      const project = ownProject(projectId, actor);
      if (projectBlocked(project)) fail('Share export is blocked: a source was revoked, removed or made unavailable. Create a new valid project.', 'STUDIO_EXPORT_BLOCKED');
      for (const id of project.sourceIds) {
        const document = getReadable(id, actor);
        if (document.visibility !== 'shared') fail('Share export requires every source to be explicitly shared', 'STUDIO_EXPORT_PRIVATE');
        if (!['CC0', 'CC-BY'].includes(document.license)) fail('Share export requires explicitly declared CC0 or CC-BY source licenses', 'STUDIO_EXPORT_LICENSE');
        if (document.license === 'CC-BY' && !document.attribution.trim()) fail('Share export requires the original CC-BY attribution credit', 'STUDIO_EXPORT_LICENSE');
      }
      if (project.designSnapshot && project.designSnapshot.provenance.kind !== 'fresh') fail('Share export cannot relicense a captured design with existing or unverified provenance. Create a project without that snapshot and use the original design export to preserve its licensing.', 'STUDIO_EXPORT_DESIGN_LICENSE');
      return { schemaVersion: 1, kind: 'ourplace-production-plan', exportedAt: time(), project: projectView(project), references: project.sourceIds.map(id => {
        const document = getReadable(id, actor);
        return { ...sourceMetadata(document), sections: sectionsOf(document), licenseEvidence: 'importer-declared' };
      }), boundary: { localOnly: true, authentication: 'same-browser-role-rehearsal', completionEvidence: 'user-reported-only', aiExecuted: false, blenderExecuted: false, executionPerformed: false, payoutAuthorized: false, sourceLicenses: 'Importer-declared; ownership and licensing are not independently verified.' } };
    },
  });
}
