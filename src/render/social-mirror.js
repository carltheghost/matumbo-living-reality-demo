/**
 * Social Mirror console + ambient ticker (DOM adapter).
 *
 * Mounts the Social Mirror console panel (tabs: Feed / Sources / About) and
 * the slim always-visible ticker strip. Official embeds only: the X timeline
 * widget (lazy-loaded platform.twitter.com/widgets.js) and YouTube iframe
 * embeds (youtube-nocookie.com). Snapchat and Meta render connect
 * placeholders — they offer no unauthenticated embeds, and this demo never
 * asks for, accepts, or stores credentials, API keys, tokens, or secrets.
 * Offline or empty states render quiet placeholders, never an error wall.
 *
 * No 3-D is built here: the mirror's glass cube is the existing
 * reality-assembly feature cube (pinned three.js r179.1 via the repo import
 * map), and the feed world's cubes reuse the canon feature-worlds glass
 * recipe (makeGlassCubeMaterial). No other 3-D library, no raw WebGL for
 * new geometry, no CSS-3-D fakes for cubes. This module is DOM only.
 *
 * Simulated points only — no money, no wagering, no wallets anywhere.
 */

import {
  SOCIAL_MIRROR_BOUNDARY,
  SOCIAL_MIRROR_CONSOLE_SOURCE,
  SOCIAL_MIRROR_TABS,
  createSocialMirrorProjection,
  getSocialMirrorTickerItems,
} from "../domains/social-mirror.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function freezeSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeSnapshot(entry)));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeSnapshot(entry)])));
  }
  return value;
}

function makeText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = safeText(value);
  return element;
}

// --- X timeline widget (lazy, official) ----------------------------------
// The widget script loads only when the Feed tab renders a live X slot: the
// console stays small and quiet by default, and nothing is fetched before
// the owner configures a handle and opens the mirror.
let xWidgetLoadPromise = null;
function loadXTimelineWidget(documentRoot) {
  if (xWidgetLoadPromise) return xWidgetLoadPromise;
  xWidgetLoadPromise = new Promise((resolve, reject) => {
    try {
      const view = documentRoot.defaultView ?? globalThis;
      if (view?.twttr?.widgets?.load) {
        resolve(view.twttr);
        return;
      }
      const existing = documentRoot.querySelector?.('script[data-social-mirror-x-widget="true"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(view.twttr ?? null), { once: true });
        existing.addEventListener("error", () => reject(new Error("x-widget-unavailable")), { once: true });
        return;
      }
      const script = documentRoot.createElement("script");
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      script.setAttribute("data-social-mirror-x-widget", "true");
      script.addEventListener("load", () => resolve(view.twttr ?? null), { once: true });
      script.addEventListener("error", () => reject(new Error("x-widget-unavailable")), { once: true });
      (documentRoot.head ?? documentRoot).appendChild(script);
    } catch (error) {
      reject(error);
    }
  });
  // A failed load must not poison later attempts.
  xWidgetLoadPromise.catch(() => { xWidgetLoadPromise = null; });
  return xWidgetLoadPromise;
}

/**
 * Mount the Social Mirror console into the HUD. The host receives frozen
 * select/refresh metadata; this adapter never mutates canonical state and
 * never touches credentials.
 */
export function createSocialMirrorConsole({
  documentRoot = globalThis.document,
  projection = null,
  onSelect = null,
  onRefresh = null,
  onIntent = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Social mirror needs a document-like owner");
  const panel = documentRoot.getElementById("social-mirror-console");
  const closeButton = documentRoot.getElementById("social-mirror-close");
  const refreshButton = documentRoot.getElementById("social-mirror-refresh");
  const statusEl = documentRoot.getElementById("social-mirror-status");
  const tabsEl = documentRoot.getElementById("social-mirror-tabs");
  const feedPanel = documentRoot.getElementById("social-mirror-panel-feed");
  const sourcesPanel = documentRoot.getElementById("social-mirror-panel-sources");
  const aboutPanel = documentRoot.getElementById("social-mirror-panel-about");
  const feedEl = documentRoot.getElementById("social-mirror-feed");
  const sourceListEl = documentRoot.getElementById("social-mirror-source-list");
  const offlineNoteEl = documentRoot.getElementById("social-mirror-offline-note");
  const boundaryEl = documentRoot.getElementById("social-mirror-boundary");
  if (!panel || !closeButton || !statusEl || !feedEl || !sourceListEl) {
    throw new Error("Social mirror console mount points are missing");
  }

  let currentProjection = projection ?? createSocialMirrorProjection();
  let activeTab = "feed";
  let opened = panel.hidden !== true;
  let refreshCount = 0;

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList.toggle("visible", opened);
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) {
      render();
      if (method === "open" && typeof refreshButton?.focus === "function") {
        refreshButton.focus({ preventScroll: true });
      }
    }
  }

  function setTab(tabId, method = "tab") {
    const tab = SOCIAL_MIRROR_TABS.find((candidate) => candidate.id === tabId) ?? SOCIAL_MIRROR_TABS[0];
    activeTab = tab.id;
    const panels = { feed: feedPanel, sources: sourcesPanel, about: aboutPanel };
    SOCIAL_MIRROR_TABS.forEach((candidate) => {
      const selected = candidate.id === activeTab;
      const button = documentRoot.getElementById(`social-mirror-tab-${candidate.id}`);
      button?.setAttribute("aria-selected", String(selected));
      button?.setAttribute("tabindex", selected ? "0" : "-1");
      const section = panels[candidate.id];
      if (section) section.hidden = !selected;
    });
    if (activeTab === "feed") renderFeed();
    if (activeTab === "sources") renderSources();
    onIntent?.(freezeSnapshot({ action: "tab", tabId: activeTab, method }), "social-mirror");
  }

  function statePillText(state) {
    return state === "live" ? "LIVE" : state === "offline" ? "OFFLINE" : "QUIET";
  }

  function placeholderCopy(source, state) {
    if (state === "offline") return "You're offline — the mirror holds its quiet state. Embeds resume when you reconnect.";
    return source.connectCopy;
  }

  function renderPlaceholder(slot, source, state) {
    slot.replaceChildren();
    const card = makeText(documentRoot, "div", "social-mirror-placeholder", "");
    card.append(
      makeText(documentRoot, "strong", "social-mirror-placeholder-title", `${source.label} · ${statePillText(state)}`),
      makeText(documentRoot, "p", "social-mirror-placeholder-copy", placeholderCopy(source, state)),
    );
    if (!source.unauthenticatedEmbed) {
      // Snapchat / Meta: a visibly disabled connect affordance. It explains
      // itself and can never become a credential form.
      const connect = documentRoot.createElement("button");
      connect.type = "button";
      connect.className = "social-mirror-connect";
      connect.disabled = true;
      connect.title = "Connecting accounts is not available in this demo — no credentials are accepted.";
      connect.textContent = "Connect account · unavailable in demo";
      connect.setAttribute("aria-disabled", "true");
      card.append(connect);
    } else if (source.docs) {
      const docs = documentRoot.createElement("a");
      docs.className = "social-mirror-docs";
      docs.href = source.docs;
      docs.target = "_blank";
      docs.rel = "noopener noreferrer";
      docs.textContent = "Official embed docs";
      card.append(docs);
    }
    slot.append(card);
  }

  function renderXSlot(slot, source, descriptor) {
    slot.replaceChildren();
    const anchor = documentRoot.createElement("a");
    anchor.className = "twitter-timeline";
    anchor.setAttribute("data-theme", "dark");
    anchor.setAttribute("data-chrome", "noheader nofooter noborders transparent");
    anchor.setAttribute("data-tweet-limit", "5");
    anchor.href = descriptor.profileUrl;
    anchor.textContent = `Posts by ${descriptor.handle} on X`;
    slot.append(anchor);
    const note = makeText(documentRoot, "div", "social-mirror-embed-note", "Loading the official X timeline widget…");
    slot.append(note);
    loadXTimelineWidget(documentRoot).then((twttr) => {
      try {
        if (twttr?.widgets?.load) twttr.widgets.load(slot);
        note.textContent = "Official X timeline widget · provider content";
      } catch {
        note.textContent = "The X widget could not start — quiet placeholder kept.";
      }
    }).catch(() => {
      note.textContent = "The X widget could not load — quiet placeholder kept.";
    });
  }

  function renderYouTubeSlot(slot, source, descriptor) {
    slot.replaceChildren();
    const frame = documentRoot.createElement("iframe");
    frame.className = "social-mirror-youtube";
    frame.src = descriptor.embedUrl;
    frame.title = `${source.label} · official uploads embed`;
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    frame.allowFullscreen = true;
    slot.append(frame);
    slot.append(makeText(documentRoot, "div", "social-mirror-embed-note", "Official YouTube iframe embed · provider content"));
  }

  function selectSource(source, method = "card") {
    const snapshot = freezeSnapshot({
      source: SOCIAL_MIRROR_CONSOLE_SOURCE,
      action: "select-source",
      method,
      sourceId: source.id,
      label: source.label,
      state: source.state,
      embedKind: source.embedKind,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    });
    onSelect?.(snapshot, method);
    return snapshot;
  }

  function renderFeed() {
    if (!feedEl) return;
    feedEl.replaceChildren();
    const online = currentProjection.online === true;
    if (offlineNoteEl) {
      offlineNoteEl.hidden = online;
      offlineNoteEl.textContent = online
        ? ""
        : "OFFLINE · the mirror holds its quiet state — embeds resume when you reconnect. No error, nothing lost.";
    }
    asArray(currentProjection.sources).forEach((source) => {
      const card = documentRoot.createElement("article");
      card.className = "social-mirror-feed-card";
      card.dataset.sourceId = source.id;
      const head = documentRoot.createElement("button");
      head.type = "button";
      head.className = "social-mirror-feed-head";
      head.setAttribute("aria-label", `Select ${source.label} in the Social Mirror`);
      head.append(
        makeText(documentRoot, "strong", "social-mirror-feed-title", source.label),
        makeText(documentRoot, "span", `social-mirror-pill social-mirror-pill-${source.state}`, statePillText(source.state)),
      );
      head.addEventListener("click", () => selectSource(source, "feed-head"));
      card.append(head);
      const slot = documentRoot.createElement("div");
      slot.className = "social-mirror-feed-slot";
      slot.dataset.sourceId = source.id;
      card.append(slot);
      if (source.state === "live" && source.embed) {
        if (source.embed.kind === "x-timeline") renderXSlot(slot, source, source.embed);
        else if (source.embed.kind === "youtube-iframe") renderYouTubeSlot(slot, source, source.embed);
        else renderPlaceholder(slot, source, source.state);
      } else {
        renderPlaceholder(slot, source, source.state);
      }
      card.append(makeText(
        documentRoot,
        "div",
        "social-mirror-feed-meta",
        source.unauthenticatedEmbed
          ? "Official embed slot · provider content renders in its own frame"
          : "No unauthenticated embed exists · connect placeholder · no credentials accepted",
      ));
      feedEl.append(card);
    });
  }

  function renderSources() {
    if (!sourceListEl) return;
    sourceListEl.replaceChildren();
    asArray(currentProjection.sources).forEach((source) => {
      const card = documentRoot.createElement("article");
      card.className = "social-mirror-source-card";
      card.dataset.sourceId = source.id;
      const head = documentRoot.createElement("div");
      head.className = "social-mirror-source-head";
      head.append(
        makeText(documentRoot, "strong", "social-mirror-source-title", source.label),
        makeText(documentRoot, "span", `social-mirror-pill social-mirror-pill-${source.state}`, statePillText(source.state)),
      );
      card.append(
        head,
        makeText(documentRoot, "p", "social-mirror-source-copy", source.description),
        makeText(documentRoot, "p", "social-mirror-source-copy social-mirror-source-connect", source.connectCopy),
      );
      card.addEventListener("click", () => selectSource(source, "source-card"));
      sourceListEl.append(card);
    });
  }

  function render() {
    if (statusEl) statusEl.textContent = safeText(currentProjection.status, "MIRROR QUIET · LOCAL ONLY");
    if (boundaryEl) boundaryEl.textContent = SOCIAL_MIRROR_BOUNDARY;
    renderFeed();
    renderSources();
  }

  function refresh(method = "button") {
    refreshCount += 1;
    const view = documentRoot.defaultView ?? globalThis;
    const online = typeof view?.navigator?.onLine === "boolean" ? view.navigator.onLine : true;
    currentProjection = createSocialMirrorProjection({ targets: currentProjection.targets, online });
    render();
    const snapshot = freezeSnapshot({
      source: SOCIAL_MIRROR_CONSOLE_SOURCE,
      action: "refresh",
      method,
      refreshCount,
      online,
      liveCount: currentProjection.liveCount,
      status: currentProjection.status,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    });
    onRefresh?.(snapshot);
    return snapshot;
  }

  function getSnapshot() {
    return freezeSnapshot({
      source: SOCIAL_MIRROR_CONSOLE_SOURCE,
      featureId: "social-mirror",
      opened,
      activeTab,
      refreshCount,
      projection: currentProjection,
      tickerItems: getSocialMirrorTickerItems(currentProjection),
      localOnly: true,
      simulation: true,
    });
  }

  function setProjection(next) {
    if (next) currentProjection = next;
    render();
    return getSnapshot();
  }

  tabsEl?.addEventListener("click", (event) => {
    const button = event.target?.closest?.('[role="tab"]');
    if (button?.id?.startsWith("social-mirror-tab-")) {
      setTab(button.id.replace("social-mirror-tab-", ""), "tab");
    }
  });
  tabsEl?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const ids = SOCIAL_MIRROR_TABS.map((tab) => tab.id);
    let index = ids.indexOf(activeTab);
    if (event.key === "ArrowRight") index = (index + 1) % ids.length;
    if (event.key === "ArrowLeft") index = (index - 1 + ids.length) % ids.length;
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = ids.length - 1;
    setTab(ids[index], "keyboard");
    documentRoot.getElementById(`social-mirror-tab-${ids[index]}`)?.focus({ preventScroll: true });
  });

  closeButton.addEventListener("click", () => setOpen(false, "close"));
  refreshButton?.addEventListener("click", () => refresh("button"));
  documentRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });
  const view = documentRoot.defaultView ?? globalThis;
  view?.addEventListener?.("online", () => refresh("network"));
  view?.addEventListener?.("offline", () => refresh("network"));

  render();
  setTab(activeTab, "initial");
  setOpen(opened, "initial");

  return Object.freeze({
    open: (method = "open") => setOpen(true, method ?? "open"),
    close: () => setOpen(false, "close"),
    toggle: () => setOpen(!opened, "toggle"),
    refresh,
    setTab,
    setProjection,
    getSnapshot,
  });
}

/**
 * Mount the slim ambient ticker strip. It stays visible at the side of the
 * world without opening the block: glanceable source states that rotate
 * while the user does other things. Draggable along the side with its
 * position remembered; collapses to the bottom strip on narrow viewports.
 */
export function mountSocialMirrorTicker({
  documentRoot = globalThis.document,
  getProjection = null,
  onOpen = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Social mirror ticker needs a document-like owner");
  const strip = documentRoot.getElementById("social-mirror-ticker");
  const textEl = documentRoot.getElementById("social-mirror-ticker-text");
  const dotEl = documentRoot.getElementById("social-mirror-ticker-dot");
  const openButton = documentRoot.getElementById("social-mirror-ticker-open");
  if (!strip || !textEl) throw new Error("Social mirror ticker mount points are missing");

  const view = documentRoot.defaultView ?? globalThis;
  const TICKER_ROTATE_MS = 6500;
  const TICKER_STORE_KEY = "matumbo.socialMirrorTicker.v1";
  const isNarrow = () => (view?.innerWidth ?? 1024) <= 700;
  const reduceMotion = () => {
    try {
      return view?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    } catch {
      return false;
    }
  };

  let items = [];
  let index = 0;
  let timer = null;

  function readProjection() {
    try {
      const projection = typeof getProjection === "function" ? getProjection() : null;
      return projection ?? createSocialMirrorProjection();
    } catch {
      return createSocialMirrorProjection();
    }
  }

  function paint() {
    const item = items[index] ?? null;
    const tone = item?.tone ?? "quiet";
    textEl.textContent = item ? item.text : "Social Mirror · quiet · local only";
    textEl.setAttribute("data-tone", tone);
    dotEl?.setAttribute("data-tone", tone);
    strip.setAttribute("data-tone", tone);
    strip.title = item
      ? `${item.label} · ${item.text} — open the Social Mirror`
      : "Social Mirror ticker — open the Social Mirror";
  }

  function refresh() {
    const projection = readProjection();
    const next = getSocialMirrorTickerItems(projection);
    items = next.length ? next : [];
    if (index >= items.length) index = 0;
    paint();
    return items.length;
  }

  function start() {
    stop();
    if (reduceMotion()) return;
    if (items.length < 2) return;
    try {
      timer = view.setInterval(() => {
        if (documentRoot.hidden) return;
        index = (index + 1) % items.length;
        paint();
      }, TICKER_ROTATE_MS);
    } catch {
      timer = null;
    }
  }

  function stop() {
    if (timer !== null) {
      try { view.clearInterval(timer); } catch { /* ignore */ }
      timer = null;
    }
  }

  function readStoredY() {
    try {
      const raw = view?.localStorage?.getItem(TICKER_STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const y = Number(parsed?.y);
      return Number.isFinite(y) ? y : null;
    } catch {
      return null;
    }
  }

  function storeY(y) {
    try {
      view?.localStorage?.setItem(TICKER_STORE_KEY, JSON.stringify({ y: Math.round(y) }));
    } catch { /* private mode etc: the position simply does not persist */ }
  }

  function clearInlinePosition() {
    strip.style.top = "";
    strip.style.bottom = "";
    strip.style.transform = "";
  }

  function applyStoredY() {
    if (isNarrow()) {
      clearInlinePosition();
      return;
    }
    const y = readStoredY();
    if (y === null) return;
    const max = Math.max(120, (view?.innerHeight ?? 800) - 60);
    strip.style.top = `${Math.max(70, Math.min(max, y))}px`;
    strip.style.bottom = "auto";
    strip.style.transform = "translateY(-50%)";
  }

  let drag = null;
  strip.addEventListener("pointerdown", (event) => {
    if (isNarrow()) return;
    if (event.target?.closest?.("#social-mirror-ticker-open")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = strip.getBoundingClientRect();
    drag = { startY: event.clientY, originCenterY: rect.top + rect.height / 2, moved: false };
    try { strip.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  });
  strip.addEventListener("pointermove", (event) => {
    if (!drag || isNarrow()) return;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) > 4) drag.moved = true;
    const max = Math.max(120, (view?.innerHeight ?? 800) - 40);
    const y = Math.max(60, Math.min(max, drag.originCenterY + dy));
    strip.style.top = `${y}px`;
    strip.style.bottom = "auto";
    strip.style.transform = "translateY(-50%)";
  });
  const endDrag = (event) => {
    if (!drag) return;
    if (drag.moved) {
      const rect = strip.getBoundingClientRect();
      storeY(rect.top + rect.height / 2);
      if (event?.cancelable) event.preventDefault();
    }
    drag = null;
  };
  strip.addEventListener("pointerup", endDrag);
  strip.addEventListener("pointercancel", () => { drag = null; });

  openButton?.addEventListener("click", () => onOpen?.("ticker"));

  const onNetwork = () => { refresh(); start(); };
  view?.addEventListener?.("online", onNetwork);
  view?.addEventListener?.("offline", onNetwork);
  view?.addEventListener?.("resize", applyStoredY);

  refresh();
  applyStoredY();
  start();

  return Object.freeze({
    refresh: () => {
      const count = refresh();
      start();
      return count;
    },
    destroy: () => {
      stop();
      view?.removeEventListener?.("online", onNetwork);
      view?.removeEventListener?.("offline", onNetwork);
      view?.removeEventListener?.("resize", applyStoredY);
    },
  });
}

export default createSocialMirrorConsole;
