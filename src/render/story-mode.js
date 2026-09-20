// story-mode.js — Story Mode RENDER console (planner + player HUD).
//
// Two closed-by-default panels materialized only on user interaction:
//   - planner panel (#story-mode-console): story library CRUD + beat editor.
//   - player HUD   (#story-mode-hud):     beat-by-beat playback controls.
//
// The console drives the pure story-mode domain module
// (src/domains/story-mode.js); it never touches the world itself. Beat
// navigation is handed to the host via onNavigateBeat(beat) so the 3D
// projection can fly the camera there.
//
// All local simulation/projection: no network, no wallet, no custody,
// no mainnet, no external execution, no real timers.
//
// Usage: const console = createStoryModeConsole({ documentRoot, storage,
//   onNavigateBeat, onEvent }); console.open(); console.playStory(id);
//   console.next(); console.stop(); console.close();

import {
  createStoryLibrary,
  createStoryStore,
  seedJourneyStory,
  createStory,
  getStory,
  listStories,
  copyStory,
  deleteStory,
  addBeat,
  removeBeat,
  moveBeat,
  createStoryPlayer,
  playerStart,
  playerNext,
  playerPrev,
  playerGoto,
  playerStop,
  currentBeat,
  STORY_MODE_BEAT_KINDS,
  STORY_MODE_BOUNDARY,
  JOURNEY_STORY_ID,
} from "../domains/story-mode.js";

const PLAYER_FINISHED = "finished";

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function resolveStorage(explicit) {
  if (explicit && typeof explicit.getItem === "function" && typeof explicit.setItem === "function") {
    return explicit;
  }
  try {
    const ls = typeof globalThis !== "undefined" ? globalThis.localStorage : null;
    if (ls && typeof ls.getItem === "function" && typeof ls.setItem === "function") return ls;
  } catch { /* fall through to memory shim */ }
  return makeMemoryStorage();
}

function resolveDocument(explicit) {
  if (explicit && typeof explicit.createElement === "function") return explicit;
  try {
    if (typeof globalThis !== "undefined" && globalThis.document) return globalThis.document;
  } catch { /* no document */ }
  return null;
}

// Works with the fake DOM (plain children array) and the real DOM.
function clearEl(node) {
  if (!node) return;
  if (Array.isArray(node.children)) {
    node.children.length = 0;
    return;
  }
  while (node.firstChild) node.removeChild(node.firstChild);
}

function panelStyle() {
  return (
    "position:absolute;z-index:900;box-sizing:border-box;" +
    "max-width:100vw;max-height:82vh;overflow:auto;" +
    "background:rgba(6,10,16,0.94);color:#e8f4ff;" +
    "border:1px solid rgba(120,200,255,0.35);border-radius:12px;padding:12px;" +
    "font-family:system-ui,sans-serif;font-size:13px;"
  );
}

// Sets styles as individual properties (fake-DOM-safe) on top of cssText,
// so both real and fake DOMs expose position/maxWidth directly.
function stylePanel(node, extraCss = "", extraProps = {}) {
  node.style.cssText = panelStyle() + extraCss;
  node.style.position = "absolute";
  node.style.zIndex = "900";
  node.style.boxSizing = "border-box";
  node.style.maxWidth = "100vw";
  node.style.maxHeight = "82vh";
  node.style.overflow = "auto";
  for (const [key, value] of Object.entries(extraProps)) {
    node.style[key] = value;
  }
}

/**
 * Create the Story Mode console (planner panel + player HUD).
 *
 * @param {object} opts
 * @param {Document} [opts.documentRoot] - fake-DOM-compatible document.
 * @param {object} [opts.storage] - localStorage-compatible { getItem, setItem }.
 * @param {(beat: object) => void} [opts.onNavigateBeat] - called with each newly current beat.
 * @param {(type: string, detail: object) => void} [opts.onEvent] - story.opened | story.closed | story.beat | story.finished.
 * @returns {{ open, close, isOpen, playStory, next, prev, goto, stop, getSnapshot, getElement, destroy }}
 */
export function createStoryModeConsole({
  documentRoot = null,
  storage = null,
  onNavigateBeat = null,
  onEvent = null,
} = {}) {
  const doc = resolveDocument(documentRoot);
  const store = createStoryStore(resolveStorage(storage));

  const loaded = store.load();
  let library = loaded.ok && loaded.library ? loaded.library : createStoryLibrary();
  if (loaded.fresh) {
    seedJourneyStory(library);
    store.save(library);
  }

  let player = createStoryPlayer();
  let open = false;
  let selectedStoryId = null;

  const emit = (type, detail = {}) => {
    try {
      onEvent?.(type, { boundary: STORY_MODE_BOUNDARY, ...detail });
    } catch { /* never break the host loop */ }
  };

  const persist = () => { store.save(library); };

  const navigate = (beat) => {
    if (!beat) return;
    try { onNavigateBeat?.(beat); } catch { /* host-side failure, ignore */ }
  };

  const selectedStory = () => (selectedStoryId ? getStory(library, selectedStoryId) : null);

  // ---------- DOM construction (persistent elements, refilled on render) ----------

  const mk = (tag, { id = null, className = null, text = null } = {}) => {
    const node = doc.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    if (text !== null && text !== undefined) node.textContent = text;
    return node;
  };

  const mkButton = (id, text, onClick) => {
    const btn = mk("button", { id, text });
    btn.type = "button";
    btn.addEventListener("click", () => { onClick(); });
    return btn;
  };

  const mkInput = (id, placeholder = "") => {
    const input = mk("input", { id });
    input.type = "text";
    input.placeholder = placeholder;
    input.value = "";
    return input;
  };

  let root = null;
  let planner = null;
  let hud = null;
  let storyListEl = null;
  let editorTitleEl = null;
  let editorNoteEl = null;
  let beatListEl = null;
  let beatFormEl = null;
  let beatKindSelect = null;
  let beatRefInput = null;
  let beatTitleInput = null;
  let beatCaptionInput = null;
  let beatErrorEl = null;
  let makeCopyBtn = null;
  let hudCountEl = null;
  let hudTitleEl = null;
  let hudCaptionEl = null;
  let hudFillEl = null;
  let hudNextBtn = null;
  let hudPrevBtn = null;
  let newTitleInput = null;
  let newDescInput = null;
  let newErrorEl = null;

  function buildDom() {
    if (!doc || root) return;

    root = mk("div", { id: "story-mode-root" });

    // ----- planner panel -----
    planner = mk("aside", { id: "story-mode-console" });
    planner.setAttribute("aria-label", "Story Mode console");
    planner.hidden = true;
    stylePanel(planner, "top:12px;left:12px;right:12px;max-width:480px;", {
      top: "12px",
      left: "12px",
      right: "12px",
    });

    const header = mk("div");
    header.append(mk("strong", { text: "Story Mode" }));
    header.append(mkButton("story-mode-close", "Close", () => api.close()));
    planner.append(header);

    const boundary = mk("div", { id: "story-mode-boundary", text: STORY_MODE_BOUNDARY });
    boundary.style.cssText = "font-size:11px;opacity:0.75;margin:8px 0;";
    planner.append(boundary);

    planner.append(mk("strong", { text: "Stories" }));
    storyListEl = mk("div", { id: "story-mode-story-list" });
    planner.append(storyListEl);

    const form = mk("div", { id: "story-mode-new-form" });
    form.append(mk("strong", { text: "New story" }));
    newTitleInput = mkInput("story-mode-new-title", "Title");
    newDescInput = mkInput("story-mode-new-description", "Description");
    newErrorEl = mk("div", { id: "story-mode-new-error" });
    newErrorEl.style.cssText = "color:#ff9d9d;font-size:11px;min-height:14px;";
    const createBtn = mkButton("story-mode-new-create", "Create story", () => {
      const res = createStory(library, {
        title: newTitleInput.value,
        description: newDescInput.value,
      });
      if (!res.ok) {
        newErrorEl.textContent = `Could not create story: ${res.reason}`;
        return;
      }
      newErrorEl.textContent = "";
      newTitleInput.value = "";
      newDescInput.value = "";
      selectedStoryId = res.story.id;
      persist();
      renderPlanner();
    });
    form.append(newTitleInput, newDescInput, createBtn, newErrorEl);
    planner.append(form);

    // ----- beat editor (persistent regions, refilled by renderBeatEditor) -----
    const editor = mk("div", { id: "story-mode-beat-editor" });
    editorTitleEl = mk("strong", { id: "story-mode-editor-title", text: "" });
    editorNoteEl = mk("div", { id: "story-mode-editor-note", text: "" });
    editorNoteEl.style.cssText = "font-size:12px;opacity:0.85;margin:4px 0;";
    makeCopyBtn = mkButton("story-mode-make-copy", "Make a copy", () => {
      const story = selectedStory();
      if (!story) return;
      const res = copyStory(library, story.id);
      if (res.ok) {
        selectedStoryId = res.story.id;
        persist();
        renderPlanner();
      }
    });
    beatListEl = mk("div", { id: "story-mode-beat-list" });

    beatFormEl = mk("div", { id: "story-mode-beat-form" });
    beatFormEl.append(mk("strong", { text: "Add beat" }));
    beatKindSelect = mk("select", { id: "story-mode-beat-kind" });
    STORY_MODE_BEAT_KINDS.forEach((kind) => {
      const opt = mk("option", { text: kind });
      opt.value = kind;
      beatKindSelect.append(opt);
    });
    beatKindSelect.value = STORY_MODE_BEAT_KINDS[0];
    beatRefInput = mkInput("story-mode-beat-refid", "refId (required)");
    beatTitleInput = mkInput("story-mode-beat-title", "Beat title");
    beatCaptionInput = mkInput("story-mode-beat-caption", "Caption");
    beatErrorEl = mk("div", { id: "story-mode-beat-error" });
    beatErrorEl.style.cssText = "color:#ff9d9d;font-size:11px;min-height:14px;";
    const addBtn = mkButton("story-mode-beat-add", "Add beat", () => {
      const story = selectedStory();
      if (!story) return;
      const res = addBeat(library, story.id, {
        kind: beatKindSelect.value,
        refId: beatRefInput.value,
        title: beatTitleInput.value,
        caption: beatCaptionInput.value,
      });
      if (!res.ok) {
        beatErrorEl.textContent = `Could not add beat: ${res.reason}`;
        return;
      }
      beatErrorEl.textContent = "";
      beatRefInput.value = "";
      beatTitleInput.value = "";
      beatCaptionInput.value = "";
      persist();
      renderPlanner();
    });
    beatFormEl.append(beatKindSelect, beatRefInput, beatTitleInput, beatCaptionInput, addBtn, beatErrorEl);

    editor.append(editorTitleEl, editorNoteEl, makeCopyBtn, beatListEl, beatFormEl);
    planner.append(editor);

    // ----- player HUD -----
    hud = mk("aside", { id: "story-mode-hud" });
    hud.setAttribute("aria-label", "Story player");
    hud.hidden = true;
    stylePanel(hud, "left:12px;right:12px;bottom:12px;", {
      left: "12px",
      right: "12px",
      bottom: "12px",
    });

    hudCountEl = mk("div", { id: "story-mode-hud-count", text: "" });
    hudTitleEl = mk("strong", { id: "story-mode-hud-title", text: "" });
    hudCaptionEl = mk("div", { id: "story-mode-hud-caption", text: "" });
    hudCaptionEl.style.cssText = "font-size:12px;opacity:0.85;margin:4px 0;";

    const progress = mk("div", { id: "story-mode-hud-progress" });
    progress.style.cssText = "height:4px;background:rgba(120,200,255,0.2);border-radius:2px;margin:8px 0;";
    hudFillEl = mk("div", { id: "story-mode-hud-progress-fill" });
    hudFillEl.style.cssText = "height:100%;width:0%;background:#7fd7ff;border-radius:2px;";
    progress.append(hudFillEl);

    const row = mk("div");
    hudPrevBtn = mkButton("story-mode-hud-prev", "Prev", () => api.prev());
    hudNextBtn = mkButton("story-mode-hud-next", "Next", () => api.next());
    const stopBtn = mkButton("story-mode-hud-stop", "Stop", () => api.stop());
    row.append(hudPrevBtn, hudNextBtn, stopBtn);

    hud.append(hudCountEl, hudTitleEl, hudCaptionEl, progress, row);

    root.append(planner, hud);
    if (doc.body && typeof doc.body.appendChild === "function") {
      doc.body.appendChild(root);
    }
  }

  // ---------- planner rendering ----------

  function renderStoryList() {
    if (!storyListEl) return;
    clearEl(storyListEl);
    const stories = listStories(library);
    stories.forEach((story) => {
      const row = mk("div");
      row.append(mk("span", {
        text: `${story.title} (${story.beats.length} beat${story.beats.length === 1 ? "" : "s"})${story.canonical ? " · canonical" : ""}`,
      }));
      row.append(mkButton(`story-mode-play-${story.id}`, "Play", () => api.playStory(story.id)));
      row.append(mkButton(`story-mode-edit-${story.id}`, "Edit", () => {
        selectedStoryId = story.id;
        renderPlanner();
      }));
      row.append(mkButton(`story-mode-copy-${story.id}`, story.canonical ? "Make a copy" : "Copy", () => {
        const res = copyStory(library, story.id);
        if (res.ok) {
          selectedStoryId = res.story.id;
          persist();
          renderPlanner();
        }
      }));
      if (!story.canonical) {
        row.append(mkButton(`story-mode-delete-${story.id}`, "Delete", () => {
          const res = deleteStory(library, story.id);
          if (res.ok) {
            if (selectedStoryId === story.id) selectedStoryId = null;
            persist();
            renderPlanner();
          }
        }));
      }
      storyListEl.append(row);
    });
  }

  function renderBeatEditor() {
    if (!beatListEl) return;
    const story = selectedStory();
    clearEl(beatListEl);
    if (!story) {
      editorTitleEl.textContent = "";
      editorNoteEl.textContent = "Select a story to edit its beats.";
      makeCopyBtn.hidden = true;
      beatFormEl.hidden = true;
      return;
    }
    editorTitleEl.textContent = `Editing: ${story.title}`;
    makeCopyBtn.hidden = !story.canonical;
    if (story.canonical) {
      editorNoteEl.textContent = "Canonical journey — beats are locked. Play it or make a copy to remix.";
      beatFormEl.hidden = true;
    } else {
      editorNoteEl.textContent = "";
      beatFormEl.hidden = false;
    }

    story.beats.forEach((beat, index) => {
      const row = mk("div", { id: `story-mode-beat-row-${beat.id}` });
      row.append(mk("span", {
        text: `${index + 1}. [${beat.kind}] ${beat.title}${beat.caption ? ` — ${beat.caption}` : ""}`,
      }));
      if (!story.canonical) {
        row.append(mkButton(`story-mode-beat-up-${beat.id}`, "↑", () => {
          moveBeat(library, story.id, beat.id, index - 1);
          persist();
          renderPlanner();
        }));
        row.append(mkButton(`story-mode-beat-down-${beat.id}`, "↓", () => {
          moveBeat(library, story.id, beat.id, index + 1);
          persist();
          renderPlanner();
        }));
        row.append(mkButton(`story-mode-beat-remove-${beat.id}`, "Remove", () => {
          removeBeat(library, story.id, beat.id);
          persist();
          renderPlanner();
        }));
      }
      beatListEl.append(row);
    });
  }

  function renderPlanner() {
    renderStoryList();
    renderBeatEditor();
  }

  // ---------- player HUD rendering ----------

  function renderHud() {
    if (!hud) return;
    const story = player.storyId ? getStory(library, player.storyId) : null;
    const beat = story ? currentBeat(player, story) : null;
    const beats = story ? story.beats : [];

    if (player.state === PLAYER_FINISHED) {
      hudCountEl.textContent = "Story finished";
      hudTitleEl.textContent = story ? story.title : "";
      hudCaptionEl.textContent = "Playback complete. Stop to close the player.";
      hudFillEl.style.width = "100%";
      hudPrevBtn.hidden = true;
      hudNextBtn.hidden = true;
      return;
    }

    hudPrevBtn.hidden = false;
    hudNextBtn.hidden = false;
    if (beat) {
      hudCountEl.textContent = `Beat ${player.beatIndex + 1} of ${beats.length}`;
      hudTitleEl.textContent = beat.title || "";
      hudCaptionEl.textContent = beat.caption || "";
      hudFillEl.style.width = `${Math.round(((player.beatIndex + 1) / Math.max(1, beats.length)) * 100)}%`;
      const last = player.beatIndex >= beats.length - 1;
      hudNextBtn.textContent = last ? "Finish" : "Next";
    } else {
      hudCountEl.textContent = "";
      hudTitleEl.textContent = "";
      hudCaptionEl.textContent = "";
      hudFillEl.style.width = "0%";
      hudNextBtn.textContent = "Next";
    }
  }

  // ---------- public API ----------

  const api = {
    open() {
      buildDom();
      open = true;
      renderPlanner();
      if (planner) planner.hidden = false;
      emit("story.opened", { storyCount: listStories(library).length });
      return { ok: true };
    },

    close() {
      open = false;
      api.stop();
      if (planner) planner.hidden = true;
      emit("story.closed", {});
      return { ok: true };
    },

    isOpen() {
      return open;
    },

    playStory(storyId) {
      buildDom();
      const story = getStory(library, storyId);
      if (!story) return { ok: false, reason: "story-not-found" };
      const res = playerStart(player, story, { beatIndex: 0 });
      if (!res.ok) return { ok: false, reason: res.reason };
      if (hud) hud.hidden = false;
      renderHud();
      navigate(res.beat);
      emit("story.beat", { storyId: story.id, beatIndex: player.beatIndex, beatId: res.beat?.id ?? null });
      return { ok: true, storyId: story.id };
    },

    next() {
      const story = player.storyId ? getStory(library, player.storyId) : null;
      const res = playerNext(player, story);
      if (!res.ok) return { ok: false, reason: res.reason };
      renderHud();
      if (res.state === PLAYER_FINISHED) {
        emit("story.finished", {
          storyId: player.storyId,
          beatIndex: player.beatIndex,
          beatId: res.beat?.id ?? null,
        });
        return { ok: true, finished: true };
      }
      navigate(res.beat);
      emit("story.beat", { storyId: player.storyId, beatIndex: player.beatIndex, beatId: res.beat?.id ?? null });
      return { ok: true };
    },

    prev() {
      const story = player.storyId ? getStory(library, player.storyId) : null;
      const res = playerPrev(player, story);
      if (!res.ok) return { ok: false, reason: res.reason };
      renderHud();
      navigate(res.beat);
      emit("story.beat", { storyId: player.storyId, beatIndex: player.beatIndex, beatId: res.beat?.id ?? null });
      return { ok: true };
    },

    goto(index) {
      const story = player.storyId ? getStory(library, player.storyId) : null;
      const res = playerGoto(player, story, index);
      if (!res.ok) return { ok: false, reason: res.reason };
      renderHud();
      navigate(res.beat);
      emit("story.beat", { storyId: player.storyId, beatIndex: player.beatIndex, beatId: res.beat?.id ?? null });
      return { ok: true };
    },

    stop() {
      playerStop(player);
      if (hud) hud.hidden = true;
      return { ok: true };
    },

    getSnapshot() {
      return {
        open,
        player: {
          state: player.state,
          storyId: player.storyId,
          beatIndex: player.beatIndex,
        },
        storyCount: listStories(library).length,
        journeyStoryId: JOURNEY_STORY_ID,
      };
    },

    getElement() {
      buildDom();
      return root;
    },

    destroy() {
      api.stop();
      open = false;
      try { root?.remove?.(); } catch { /* ignore */ }
      root = null;
      planner = null;
      hud = null;
      storyListEl = null;
      editorTitleEl = null;
      editorNoteEl = null;
      beatListEl = null;
      beatFormEl = null;
      beatKindSelect = null;
      beatRefInput = null;
      beatTitleInput = null;
      beatCaptionInput = null;
      beatErrorEl = null;
      makeCopyBtn = null;
      hudCountEl = null;
      hudTitleEl = null;
      hudCaptionEl = null;
      hudFillEl = null;
      hudNextBtn = null;
      hudPrevBtn = null;
      newTitleInput = null;
      newDescInput = null;
      newErrorEl = null;
      selectedStoryId = null;
      return { ok: true };
    },
  };

  return api;
}
