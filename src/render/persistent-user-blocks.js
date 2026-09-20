/**
 * Persistent user-created simulation blocks.
 *
 * A block is a small, movable 2D surface that behaves like a window in the
 * Living Reality field. Blocks are independent of feature navigation:
 * navigating to another feature does not close, reset, recenter, or recreate
 * an already-open block.
 *
 * This is projection/UI state only. Block content is local simulation data;
 * there is no provider connection, account, wallet, settlement, or upload.
 */

export const PERSISTENT_BLOCK_SOURCE = "persistent-user-blocks";
export const PERSISTENT_BLOCK_EVENT = "matumbo:persistent-block";
export const PERSISTENT_BLOCK_STORE_KEY = "matumbo.persistent.blocks.v1";
export const PERSISTENT_BLOCK_LIMIT = 24;
export const PERSISTENT_BLOCK_WIDTH = 300;
export const PERSISTENT_BLOCK_HEIGHT = 220;
export const PERSISTENT_BLOCK_DEPTH_MIN = -900;
export const PERSISTENT_BLOCK_DEPTH_MAX = 700;

export const PERSISTENT_BLOCK_TEMPLATES = Object.freeze([
  Object.freeze({
    type: "media",
    label: "Prime-style Media",
    title: "Prime-style Media · SIMULATED",
    body: "A private-looking streaming block for the Living Reality demo. Choose a title below; playback is a local rehearsal only.",
    items: Object.freeze(["The Expanse", "The Matrix", "Planet Earth", "Arrival"]),
  }),
  Object.freeze({
    type: "social",
    label: "Social Network",
    title: "Social Space · SIMULATED",
    body: "A social-network block that stays open while you explore another feature. Feed cards are local fixtures, not a live social feed.",
    items: Object.freeze(["Friends", "Communities", "Messages", "Discover"]),
  }),
  Object.freeze({
    type: "market",
    label: "Market Watch",
    title: "Market Watch · SIMULATED",
    body: "A compact market board for the local simulation. It never becomes an order, wallet, or settlement surface.",
    items: Object.freeze(["BTC", "ETH", "XRP", "SOL", "TUMBO-SIM"]),
  }),
  Object.freeze({
    type: "workspace",
    label: "My Workspace",
    title: "My Workspace · SIMULATED",
    body: "Your own reusable surface. Keep notes, a checklist, a project status, or any other local working context beside the world.",
    items: Object.freeze(["Notes", "Tasks", "Files", "Ideas"]),
  }),
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clampBlockDepth(z) {
  return clamp(finite(z), PERSISTENT_BLOCK_DEPTH_MIN, PERSISTENT_BLOCK_DEPTH_MAX);
}

export function clampBlockPosition(
  x,
  y,
  width = PERSISTENT_BLOCK_WIDTH,
  height = PERSISTENT_BLOCK_HEIGHT,
  viewportWidth = 1440,
  viewportHeight = 900,
) {
  const safeWidth = Math.max(80, finite(width, PERSISTENT_BLOCK_WIDTH));
  const safeHeight = Math.max(60, finite(height, PERSISTENT_BLOCK_HEIGHT));
  const vw = Math.max(safeWidth + 16, finite(viewportWidth, 1440));
  const vh = Math.max(safeHeight + 48, finite(viewportHeight, 900));
  return Object.freeze({
    x: clamp(finite(x, 16), 8, Math.max(8, vw - safeWidth - 8)),
    y: clamp(finite(y, 16), 8, Math.max(8, vh - safeHeight - 42)),
  });
}

export function normalizeBlockId(value) {
  const id = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id.slice(0, 64);
}

export function normalizeBlockSpec(input = {}) {
  if (!isRecord(input)) throw new TypeError("block spec must be an object");
  const id = normalizeBlockId(input.id);
  const title = String(input.title ?? "").trim().slice(0, 80);
  const type = String(input.type ?? "workspace").trim().slice(0, 32) || "workspace";
  const body = String(input.body ?? "").trim().slice(0, 500);
  if (!id) throw new TypeError("block id is required");
  if (!title) throw new TypeError("block title is required");

  const items = Array.isArray(input.items)
    ? input.items
      .map((item) => String(item ?? "").trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 12)
    : [];

  return Object.freeze({
    id,
    title,
    type,
    body,
    items: Object.freeze(items),
    simulation: true,
    localOnly: true,
    externalExecution: false,
  });
}

function readStore(view) {
  try {
    const raw = view?.localStorage?.getItem(PERSISTENT_BLOCK_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(view, entries) {
  try {
    view?.localStorage?.setItem(
      PERSISTENT_BLOCK_STORE_KEY,
      JSON.stringify(entries),
    );
  } catch {
    // Private mode or disabled storage: the live layout still works.
  }
}

function safeDispatch(documentRoot, type, detail) {
  try {
    documentRoot?.dispatchEvent?.(
      new CustomEvent(type, {
        detail: Object.freeze({
          source: PERSISTENT_BLOCK_SOURCE,
          simulation: true,
          localOnly: true,
          externalExecution: false,
          ...detail,
        }),
      }),
    );
  } catch {
    // DOM test doubles may not implement CustomEvent.
  }
}

function chooseTemplate(type) {
  return PERSISTENT_BLOCK_TEMPLATES.find((entry) => entry.type === type)
    ?? PERSISTENT_BLOCK_TEMPLATES[3];
}

function viewport(view) {
  return {
    width: Math.max(320, finite(view?.innerWidth, 1440)),
    height: Math.max(240, finite(view?.innerHeight, 900)),
  };
}

export function createPersistentUserBlocks({
  documentRoot = globalThis.document,
  view = globalThis.window,
  maxBlocks = PERSISTENT_BLOCK_LIMIT,
} = {}) {
  const limit = clamp(Math.floor(finite(maxBlocks, PERSISTENT_BLOCK_LIMIT)), 1, 100);

  if (!documentRoot?.createElement) {
    return Object.freeze({
      mount: () => false,
      destroy: () => {},
      createBlock: () => null,
      createTemplateBlock: () => null,
      removeBlock: () => false,
      showBlock: () => false,
      hideBlock: () => false,
      focusBlock: () => false,
      moveBlock: () => false,
      setDepth: () => false,
      setDock: () => false,
      listBlocks: () => Object.freeze([]),
      getSnapshot: () => Object.freeze({
        source: PERSISTENT_BLOCK_SOURCE,
        mounted: false,
        blockCount: 0,
        blockLimit: limit,
        simulation: true,
        localOnly: true,
      }),
    });
  }

  const saved = readStore(view);
  const records = new Map();
  const listeners = [];
  let mounted = false;
  let launcher = null;
  let creator = null;
  let zCounter = 9400;

  function addListener(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    listeners.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function persist() {
    const output = {};
    for (const rec of records.values()) {
      output[rec.id] = {
        id: rec.id,
        title: rec.title,
        type: rec.type,
        body: rec.body,
        items: [...rec.items],
        x: Math.round(rec.x),
        y: Math.round(rec.y),
        z: Math.round(rec.z),
        visible: rec.visible,
        dock: rec.dock,
      };
    }
    writeStore(view, output);
  }

  function apply(rec) {
    if (!rec.el) return;
    const v = viewport(view);
    const box = rec.el.getBoundingClientRect?.() ?? {
      width: PERSISTENT_BLOCK_WIDTH,
      height: PERSISTENT_BLOCK_HEIGHT,
    };
    const p = clampBlockPosition(
      rec.x,
      rec.y,
      box.width || PERSISTENT_BLOCK_WIDTH,
      box.height || PERSISTENT_BLOCK_HEIGHT,
      v.width,
      v.height,
    );
    rec.x = p.x;
    rec.y = p.y;
    rec.z = clampBlockDepth(rec.z);
    rec.el.style.left = "0px";
    rec.el.style.top = "0px";
    rec.el.style.transform =
      `translate3d(${rec.x.toFixed(1)}px,${rec.y.toFixed(1)}px,0) scale(${(1400 / (1400 - rec.z)).toFixed(4)})`;
    rec.el.style.filter =
      rec.z === 0 ? "" : `brightness(${(1 + rec.z / 5000).toFixed(3)})`;
    rec.el.style.zIndex = String(rec.zIndex);
  }

  function emit(rec, action) {
    safeDispatch(documentRoot, PERSISTENT_BLOCK_EVENT, {
      action,
      blockId: rec?.id ?? null,
      title: rec?.title ?? null,
      dock: rec?.dock ?? "free",
      x: rec?.x ?? null,
      y: rec?.y ?? null,
      z: rec?.z ?? null,
      visible: rec?.visible === true,
    });
  }

  function focus(rec) {
    if (!rec) return false;
    zCounter += 1;
    rec.zIndex = zCounter;
    apply(rec);
    emit(rec, "focus");
    return true;
  }

  function setDockPosition(rec, dock) {
    const v = viewport(view);
    const box = rec.el?.getBoundingClientRect?.() ?? {
      width: PERSISTENT_BLOCK_WIDTH,
      height: PERSISTENT_BLOCK_HEIGHT,
    };
    const width = box.width || PERSISTENT_BLOCK_WIDTH;
    const height = box.height || PERSISTENT_BLOCK_HEIGHT;

    let x = rec.x;
    let y = rec.y;

    switch (dock) {
      case "left":
        x = 12;
        break;
      case "right":
        x = v.width - width - 12;
        break;
      case "front":
        x = (v.width - width) / 2;
        y = (v.height - height) / 2;
        break;
      case "top":
        x = clamp(rec.x, 8, v.width - width - 8);
        y = 12;
        break;
      case "free":
      default:
        break;
    }

    const p = clampBlockPosition(x, y, width, height, v.width, v.height);
    rec.x = p.x;
    rec.y = p.y;
    rec.dock = dock;
    rec.z = dock === "front" ? Math.max(180, rec.z) : rec.z;
    if (dock === "front") focus(rec);
    apply(rec);
    persist();
    emit(rec, "dock");
    return true;
  }

  function createBlock(input = {}) {
    if (records.size >= limit) return null;
    const spec = normalizeBlockSpec(input);
    if (records.has(spec.id)) {
      const existing = records.get(spec.id);
      existing.visible = true;
      focus(existing);
      apply(existing);
      persist();
      emit(existing, "reopen");
      return existing.id;
    }

    const v = viewport(view);
    const savedState = isRecord(saved[spec.id]) ? saved[spec.id] : {};
    const rec = {
      ...spec,
      x: finite(savedState.x, 24 + (records.size % 4) * 24),
      y: finite(savedState.y, 90 + (records.size % 5) * 28),
      z: clampBlockDepth(finite(savedState.z, 0)),
      dock: String(savedState.dock ?? "free"),
      visible: savedState.visible !== false,
      zIndex: ++zCounter,
      el: null,
      cleanup: [],
    };

    const block = documentRoot.createElement("aside");
    block.id = `persistent-block-${rec.id}`;
    block.dataset.persistentBlock = rec.id;
    block.setAttribute("aria-label", rec.title);
    block.style.cssText =
      "position:fixed;left:0;top:0;width:min(300px,calc(100vw - 24px));min-height:150px;max-height:min(72vh,560px);overflow:hidden;box-sizing:border-box;background:rgba(7,17,27,.91);backdrop-filter:blur(13px);border:1px solid rgba(137,207,236,.52);border-radius:14px;box-shadow:0 18px 46px rgba(0,0,0,.35);color:#e8f7ff;font:12px system-ui,sans-serif;transform-origin:0 0;will-change:transform;";

    const grip = documentRoot.createElement("div");
    grip.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid rgba(137,207,236,.22);background:rgba(16,34,48,.45);touch-action:none;user-select:none;";

    const title = documentRoot.createElement("button");
    title.type = "button";
    title.textContent = rec.title;
    title.title = "Drag anywhere. Use the buttons to dock left, right, front, or top.";
    title.style.cssText =
      "flex:1;min-width:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grab;";

    const dockSelect = documentRoot.createElement("select");
    ["free", "left", "right", "front", "top"].forEach((dock) => {
      const option = documentRoot.createElement("option");
      option.value = dock;
      option.textContent = dock.toUpperCase();
      if (dock === rec.dock) option.selected = true;
      dockSelect.append(option);
    });
    dockSelect.title = "Choose a stable location";
    dockSelect.style.cssText =
      "border:1px solid rgba(137,207,236,.28);border-radius:6px;background:#0d2232;color:inherit;padding:3px 5px;font-size:9px;";

    const hide = documentRoot.createElement("button");
    hide.type = "button";
    hide.textContent = "×";
    hide.title = "Hide this block";
    hide.style.cssText =
      "border:1px solid rgba(137,207,236,.24);border-radius:6px;background:rgba(255,255,255,.05);color:inherit;padding:3px 7px;font-size:13px;";

    grip.append(title, dockSelect, hide);

    const body = documentRoot.createElement("div");
    body.style.cssText =
      "padding:9px;overflow:auto;max-height:min(58vh,480px);";

    const description = documentRoot.createElement("div");
    description.textContent = rec.body;
    description.style.cssText =
      "line-height:1.45;opacity:.86;margin-bottom:8px;";
    body.append(description);

    const grid = documentRoot.createElement("div");
    grid.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr;gap:6px;";

    rec.items.forEach((item, index) => {
      const card = documentRoot.createElement("button");
      card.type = "button";
      card.textContent = item;
      card.dataset.blockItem = String(index);
      card.style.cssText =
        "border:1px solid rgba(137,207,236,.24);border-radius:8px;background:rgba(255,255,255,.045);color:inherit;padding:10px 8px;text-align:left;font:inherit;cursor:pointer;";
      card.addEventListener("click", () => {
        focus(rec);
        emit(rec, "item-select");
        safeDispatch(documentRoot, PERSISTENT_BLOCK_EVENT, {
          action: "item-select",
          blockId: rec.id,
          item,
          index,
        });
      });
      grid.append(card);
    });
    body.append(grid);

    const boundary = documentRoot.createElement("div");
    boundary.textContent =
      "SIMULATED BLOCK · LOCAL ONLY · STAYS OPEN UNTIL YOU HIDE IT";
    boundary.style.cssText =
      "margin-top:9px;padding-top:7px;border-top:1px solid rgba(137,207,236,.16);font-size:9px;letter-spacing:.04em;opacity:.56;";
    body.append(boundary);

    block.append(grip, body);
    documentRoot.body?.append(block);

    rec.el = block;
    records.set(rec.id, rec);

    function hideBlock() {
      rec.visible = false;
      block.hidden = true;
      persist();
      emit(rec, "hide");
    }

    function showBlock() {
      rec.visible = true;
      block.hidden = false;
      focus(rec);
      apply(rec);
      persist();
      emit(rec, "show");
    }

    hide.addEventListener("click", hideBlock);
    dockSelect.addEventListener("change", () => {
      setDockPosition(rec, dockSelect.value);
    });

    const pointers = new Map();
    let drag = null;

    function pointerDown(event) {
      if (event.target === dockSelect || event.target === hide) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      focus(rec);
      try {
        title.setPointerCapture?.(event.pointerId);
      } catch {}
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        originX: rec.x,
        originY: rec.y,
        originZ: rec.z,
        depth: event.shiftKey,
        moved: false,
      };
      title.style.cursor = "grabbing";
      event.preventDefault();
    }

    function pointerMove(event) {
      if (!drag || !pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;

      if (drag.depth) {
        rec.z = clampBlockDepth(drag.originZ + (drag.startY - event.clientY) * 2);
      } else {
        rec.dock = "free";
        dockSelect.value = "free";
        const box = block.getBoundingClientRect();
        const v = viewport(view);
        const p = clampBlockPosition(
          drag.originX + dx,
          drag.originY + dy,
          box.width,
          box.height,
          v.width,
          v.height,
        );
        rec.x = p.x;
        rec.y = p.y;
      }
      apply(rec);
      event.preventDefault();
    }

    function pointerEnd(event) {
      pointers.delete(event.pointerId);
      if (!drag) return;
      const wasMove = drag.moved;
      drag = null;
      title.style.cursor = "";
      if (wasMove) {
        persist();
        emit(rec, "move");
      } else {
        showBlock();
      }
    }

    title.addEventListener("pointerdown", pointerDown);
    title.addEventListener("pointermove", pointerMove);
    title.addEventListener("pointerup", pointerEnd);
    title.addEventListener("pointercancel", pointerEnd);
    title.addEventListener("wheel", (event) => {
      rec.z = clampBlockDepth(rec.z - event.deltaY * 1.2);
      apply(rec);
      persist();
      emit(rec, "depth");
      event.preventDefault();
    }, { passive: false });

    block.addEventListener("pointerdown", () => focus(rec), { capture: true });

    rec.cleanup.push(() => {
      hide.removeEventListener("click", hideBlock);
      title.removeEventListener("pointerdown", pointerDown);
      title.removeEventListener("pointermove", pointerMove);
      title.removeEventListener("pointerup", pointerEnd);
      title.removeEventListener("pointercancel", pointerEnd);
      block.remove();
    });

    rec.show = showBlock;
    rec.hide = hideBlock;
    apply(rec);

    if (rec.dock !== "free") setDockPosition(rec, rec.dock);
    if (!rec.visible) block.hidden = true;

    emit(rec, "create");
    return rec.id;
  }

  function createTemplateBlock(type) {
    const template = chooseTemplate(type);
    const suffix = Date.now().toString(36);
    const base = normalizeBlockId(`${template.type}-${suffix}`);
    return createBlock({
      id: base,
      title: template.title,
      type: template.type,
      body: template.body,
      items: template.items,
    });
  }

  function removeBlock(id) {
    const rec = records.get(normalizeBlockId(id));
    if (!rec) return false;
    rec.cleanup.forEach((cleanup) => {
      try {
        cleanup();
      } catch {}
    });
    records.delete(rec.id);
    persist();
    safeDispatch(documentRoot, PERSISTENT_BLOCK_EVENT, {
      action: "remove",
      blockId: rec.id,
    });
    renderLauncher();
    return true;
  }

  function showBlock(id) {
    const rec = records.get(normalizeBlockId(id));
    if (!rec) return false;
    rec.show();
    renderLauncher();
    return true;
  }

  function hideBlock(id) {
    const rec = records.get(normalizeBlockId(id));
    if (!rec) return false;
    rec.hide();
    renderLauncher();
    return true;
  }

  function focusBlock(id) {
    const rec = records.get(normalizeBlockId(id));
    return rec ? focus(rec) : false;
  }

  function moveBlock(id, x, y) {
    const rec = records.get(normalizeBlockId(id));
    if (!rec) return false;
    rec.dock = "free";
    const box = rec.el.getBoundingClientRect();
    const v = viewport(view);
    const p = clampBlockPosition(x, y, box.width, box.height, v.width, v.height);
    rec.x = p.x;
    rec.y = p.y;
    apply(rec);
    persist();
    emit(rec, "move");
    return true;
  }

  function setDepth(id, z) {
    const rec = records.get(normalizeBlockId(id));
    if (!rec) return false;
    rec.z = clampBlockDepth(z);
    apply(rec);
    persist();
    emit(rec, "depth");
    return true;
  }

  function setDock(id, dock) {
    const rec = records.get(normalizeBlockId(id));
    if (!rec) return false;
    setDockPosition(rec, String(dock));
    const select = rec.el.querySelector?.("select");
    if (select) select.value = rec.dock;
    renderLauncher();
    return true;
  }

  function listBlocks() {
    return Object.freeze([...records.values()].map((rec) =>
      Object.freeze({
        id: rec.id,
        title: rec.title,
        type: rec.type,
        visible: rec.visible,
        dock: rec.dock,
        x: Math.round(rec.x),
        y: Math.round(rec.y),
        z: Math.round(rec.z),
        zIndex: rec.zIndex,
        simulation: true,
        localOnly: true,
      }),
    ));
  }

  function renderLauncher() {
    if (!launcher) return;
    launcher.innerHTML = "";

    const label = documentRoot.createElement("div");
    label.textContent = "BLOCKS";
    label.style.cssText =
      "font:700 9px system-ui;letter-spacing:.12em;opacity:.64;padding:2px 4px 4px;";
    launcher.append(label);

    for (const rec of records.values()) {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.textContent = rec.visible ? "● " + rec.title.replace(" · SIMULATED", "") : "○ " + rec.title.replace(" · SIMULATED", "");
      button.title = rec.visible ? "Focus block without moving it" : "Open block at its saved position";
      button.style.cssText =
        "display:block;width:100%;border:1px solid rgba(137,207,236,.2);border-radius:7px;background:rgba(255,255,255,.04);color:inherit;text-align:left;padding:5px 6px;margin:3px 0;font:10px system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      button.addEventListener("click", () => {
        if (rec.visible) focus(rec);
        else rec.show();
      });
      launcher.append(button);
    }
  }

  function openCreator() {
    if (!creator) return;
    creator.hidden = false;
    creator.querySelector("input")?.focus?.();
  }

  function renderCreator() {
    if (!creator) return;
    creator.innerHTML = "";

    const head = documentRoot.createElement("div");
    head.textContent = "CREATE YOUR BLOCK";
    head.style.cssText =
      "font:700 10px system-ui;letter-spacing:.08em;margin-bottom:7px;";

    const input = documentRoot.createElement("input");
    input.type = "text";
    input.placeholder = "My app / social / movie / workspace";
    input.maxLength = 56;
    input.autocomplete = "off";
    input.style.cssText =
      "width:100%;box-sizing:border-box;border:1px solid rgba(137,207,236,.28);border-radius:7px;background:#081723;color:inherit;padding:7px 8px;font:11px system-ui;margin-bottom:6px;";

    const kind = documentRoot.createElement("select");
    kind.style.cssText =
      "width:100%;box-sizing:border-box;border:1px solid rgba(137,207,236,.28);border-radius:7px;background:#081723;color:inherit;padding:6px;font:10px system-ui;margin-bottom:7px;";
    [
      ["workspace", "Workspace"],
      ["media", "Media"],
      ["social", "Social"],
      ["market", "Market"],
    ].forEach(([value, label]) => {
      const option = documentRoot.createElement("option");
      option.value = value;
      option.textContent = label;
      kind.append(option);
    });

    const create = documentRoot.createElement("button");
    create.type = "button";
    create.textContent = "CREATE";
    create.style.cssText =
      "width:100%;border:1px solid rgba(137,207,236,.35);border-radius:7px;background:rgba(100,190,230,.13);color:inherit;padding:7px;font:700 10px system-ui;";

    const hint = documentRoot.createElement("div");
    hint.textContent =
      "After creation: drag freely, SHIFT-drag for depth, or dock LEFT / RIGHT / FRONT / TOP. Navigation will not move it.";
    hint.style.cssText =
      "font-size:9px;line-height:1.4;opacity:.58;margin-top:7px;";

    creator.append(head, input, kind, create, hint);

    create.addEventListener("click", () => {
      const labelValue = input.value.trim();
      if (!labelValue) {
        input.focus();
        return;
      }
      const template = chooseTemplate(kind.value);
      const id = normalizeBlockId(
        `user-${labelValue}-${Date.now().toString(36)}`,
      );
      createBlock({
        id,
        title: `${labelValue} · SIMULATED`,
        type: kind.value,
        body: `Your "${labelValue}" block is a local simulation shell. It stays mounted while you visit other features.`,
        items: template.items,
      });
      creator.hidden = true;
      renderLauncher();
    });
  }

  function mount() {
    if (mounted) return true;
    mounted = true;

    launcher = documentRoot.createElement("aside");
    launcher.id = "persistent-block-launcher";
    launcher.style.cssText =
      "position:fixed;left:10px;bottom:10px;z-index:9450;width:min(190px,calc(100vw - 20px));padding:7px;border:1px solid rgba(137,207,236,.34);border-radius:11px;background:rgba(5,14,23,.82);backdrop-filter:blur(10px);color:#e8f7ff;";
    documentRoot.body?.append(launcher);

    creator = documentRoot.createElement("aside");
    creator.id = "persistent-block-creator";
    creator.hidden = true;
    creator.style.cssText =
      "position:fixed;left:10px;bottom:10px;z-index:9460;width:min(240px,calc(100vw - 20px));padding:10px;border:1px solid rgba(137,207,236,.42);border-radius:11px;background:rgba(5,14,23,.94);backdrop-filter:blur(10px);color:#e8f7ff;";
    documentRoot.body?.append(creator);

    renderCreator();

    const add = documentRoot.createElement("button");
    add.type = "button";
    add.textContent = "+ ADD BLOCK";
    add.title = "Create a persistent simulation block";
    add.style.cssText =
      "width:100%;border:1px solid rgba(137,207,236,.36);border-radius:7px;background:rgba(91,188,231,.10);color:inherit;padding:6px;font:700 9px system-ui;";
    add.addEventListener("click", () => {
      creator.hidden = !creator.hidden;
      if (!creator.hidden) creator.querySelector("input")?.focus?.();
    });

    const templateRow = documentRoot.createElement("div");
    templateRow.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:5px;";
    PERSISTENT_BLOCK_TEMPLATES.slice(0, 4).forEach((template) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.textContent = "+ " + template.label;
      button.title = "Create " + template.label;
      button.style.cssText =
        "border:1px solid rgba(137,207,236,.2);border-radius:6px;background:rgba(255,255,255,.035);color:inherit;padding:5px 4px;font:9px system-ui;";
      button.addEventListener("click", () => {
        const id = createTemplateBlock(template.type);
        if (id) {
          renderLauncher();
          focusBlock(id);
        }
      });
      templateRow.append(button);
    });

    launcher.append(add, templateRow);

    const savedEntries = Object.values(saved).slice(0, limit);
    for (const entry of savedEntries) {
      if (!isRecord(entry)) continue;
      try {
        createBlock({
          id: entry.id,
          title: entry.title,
          type: entry.type,
          body: entry.body,
          items: entry.items,
        });
      } catch {
        // One corrupt saved block never breaks boot.
      }
    }

    addListener(view, "resize", () => {
      for (const rec of records.values()) {
        if (rec.dock !== "free" && rec.visible) setDockPosition(rec, rec.dock);
        else if (rec.visible) apply(rec);
      }
    });

    addListener(documentRoot, "matumbo:spatial-gesture", (event) => {
      const detail = event?.detail;
      if (!detail || !records.size) return;
      if (detail.type === "swipe") {
        const visible = [...records.values()].filter((rec) => rec.visible);
        if (visible.length < 2) return;
        const current = visible.findIndex((rec) => rec.zIndex === Math.max(...visible.map((entry) => entry.zIndex)));
        const nextIndex = detail.direction === "left"
          ? (current + 1) % visible.length
          : (current - 1 + visible.length) % visible.length;
        focus(visible[nextIndex]);
      }
      if (detail.type === "tap") {
        const x = Number(detail.x);
        const y = Number(detail.y);
        const width = Number(view?.innerWidth ?? 1);
        const height = Number(view?.innerHeight ?? 1);
        const target = documentRoot.elementFromPoint?.(
          clamp(x, 0, 0.999999) * width,
          clamp(y, 0, 0.999999) * height,
        );
        if (target?.closest?.("[data-persistent-block]")) {
          const host = target.closest("[data-persistent-block]");
          const id = host.dataset.persistentBlock;
          focusBlock(id);
          target.click?.();
        }
      }
    });

    for (const rec of records.values()) {
      apply(rec);
      if (rec.visible) rec.el.hidden = false;
    }

    renderLauncher();
    safeDispatch(documentRoot, PERSISTENT_BLOCK_EVENT, {
      action: "mount",
      blockCount: records.size,
    });
    return true;
  }

  function destroy() {
    listeners.splice(0).forEach((cleanup) => cleanup());
    for (const rec of records.values()) {
      rec.cleanup.forEach((cleanup) => {
        try {
          cleanup();
        } catch {}
      });
    }
    records.clear();
    launcher?.remove?.();
    creator?.remove?.();
    launcher = null;
    creator = null;
    mounted = false;
  }

  return Object.freeze({
    mount,
    destroy,
    createBlock,
    createTemplateBlock,
    removeBlock,
    showBlock,
    hideBlock,
    focusBlock,
    moveBlock,
    setDepth,
    setDock,
    listBlocks,
    getSnapshot: () => Object.freeze({
      source: PERSISTENT_BLOCK_SOURCE,
      mounted,
      blockCount: records.size,
      visibleCount: [...records.values()].filter((rec) => rec.visible).length,
      blockLimit: limit,
      simulation: true,
      localOnly: true,
      externalExecution: false,
    }),
  });
}

export default createPersistentUserBlocks;
