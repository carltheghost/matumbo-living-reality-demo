/**
 * token-social-ux render — translucent blue glass cube + HUD panels
 * for tip / deliver / notifications (simulation only).
 *
 * Design laws:
 *  - three.js only (repo-pinned r179.1 via import map)
 *  - glass materials from glass-style.js conventions
 *  - small by default; opens on interaction; draggable; positions persisted
 *  - minimize → translucent chip
 *  - every panel body scrolls; responsive 1440×900 and 390×844
 */

import {
  makeGlassCube,
  glassTintFor,
} from "./glass-style.js?v=20260922-cache2";

import {
  createTokenSocialUxController,
  DEMO_FEED_POSTS,
  TIP_PRESETS_FLUFF,
  fmtFluff,
  TOAST_EVENT,
  listPendingEscrow,
  listSocialNotifications,
  socialBalance,
  socialFmt,
  socialDeliver,
  socialConfirmDelivery,
  socialCancelDelivery,
  DEFAULT_TIP_FLUFF,
} from "../domains/token-social-ux.js?v=20260922-cache2";

const STORAGE_KEY = "tumbo:token-social-ux:pose";
const PANEL_ID = "token-social-ux-panel";
const TOAST_HOST_ID = "token-social-toast-host";

function loadPose() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number") {
      return p;
    }
  } catch {}
  return null;
}

function savePose(pos) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ x: pos.x, y: pos.y, z: pos.z, t: Date.now() }),
    );
  } catch {}
}

function ensureStyles() {
  if (document.getElementById("token-social-ux-css")) return;
  const style = document.createElement("style");
  style.id = "token-social-ux-css";
  style.textContent = `
#${PANEL_ID} {
  position: fixed;
  right: 16px;
  bottom: 72px;
  z-index: 48;
  width: min(360px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 100px));
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(127, 212, 255, 0.28);
  border-radius: 16px;
  background: linear-gradient(165deg, rgba(4, 18, 28, 0.94), rgba(2, 8, 14, 0.9));
  box-shadow: 0 18px 50px rgba(0,0,0,0.42), inset 0 0 28px rgba(70, 200, 255, 0.04);
  backdrop-filter: blur(16px);
  color: #d6f4ff;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
  pointer-events: auto;
}
#${PANEL_ID}[data-minimized="1"] {
  width: auto;
  max-height: none;
  border-radius: 999px;
  padding: 0;
}
#${PANEL_ID} .tsu-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 8px;
  border-bottom: 1px solid rgba(120, 210, 240, 0.12);
  cursor: grab;
  user-select: none;
}
#${PANEL_ID} .tsu-head:active { cursor: grabbing; }
#${PANEL_ID} .tsu-eyebrow {
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6ec8dc;
}
#${PANEL_ID} .tsu-title {
  margin: 3px 0 2px;
  font-size: 15px;
  font-weight: 650;
  color: #e8fbff;
}
#${PANEL_ID} .tsu-sim {
  font-size: 9px;
  color: #8ab0bc;
  letter-spacing: 0.04em;
}
#${PANEL_ID} .tsu-actions {
  display: flex;
  gap: 4px;
}
#${PANEL_ID} .tsu-icon-btn {
  appearance: none;
  border: 1px solid rgba(130, 220, 245, 0.2);
  background: rgba(40, 120, 150, 0.12);
  color: #9cd4e4;
  border-radius: 8px;
  width: 28px;
  height: 28px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
#${PANEL_ID} .tsu-icon-btn:hover {
  border-color: rgba(170, 240, 255, 0.55);
  color: #fff;
}
#${PANEL_ID} .tsu-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 12px 14px;
  scrollbar-width: thin;
  scrollbar-color: rgba(111, 217, 239, 0.5) rgba(5, 20, 28, 0.5);
}
#${PANEL_ID} .tsu-bal {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border-radius: 10px;
  border: 1px solid rgba(120, 210, 240, 0.14);
  background: rgba(20, 60, 80, 0.25);
  font-size: 11px;
}
#${PANEL_ID} .tsu-bal strong {
  color: #9eecff;
  font-weight: 650;
  letter-spacing: 0.02em;
}
#${PANEL_ID} .tsu-section {
  margin-bottom: 12px;
}
#${PANEL_ID} .tsu-section h3 {
  margin: 0 0 6px;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #70b8c8;
  font-weight: 600;
}
#${PANEL_ID} .tsu-post {
  position: relative;
  padding: 9px 10px 10px;
  margin-bottom: 7px;
  border-radius: 11px;
  border: 1px solid rgba(110, 200, 230, 0.14);
  background: rgba(6, 22, 32, 0.55);
}
#${PANEL_ID} .tsu-post .author {
  font-size: 11px;
  font-weight: 650;
  color: #c8f0ff;
}
#${PANEL_ID} .tsu-post .body {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.4;
  color: #9bb8c4;
}
#${PANEL_ID} .tumbo-tip-control {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}
#${PANEL_ID} .tumbo-tip-btn,
#${PANEL_ID} .tumbo-tip-preset,
#${PANEL_ID} .tsu-btn {
  appearance: none;
  border: 1px solid rgba(120, 220, 250, 0.28);
  background: linear-gradient(180deg, rgba(30, 90, 120, 0.35), rgba(12, 40, 55, 0.4));
  color: #c8f4ff;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 10px;
  letter-spacing: 0.04em;
  cursor: pointer;
}
#${PANEL_ID} .tumbo-tip-btn:hover,
#${PANEL_ID} .tumbo-tip-preset:hover,
#${PANEL_ID} .tsu-btn:hover {
  border-color: rgba(170, 245, 255, 0.6);
  color: #fff;
}
#${PANEL_ID} .tumbo-tip-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  width: 100%;
}
#${PANEL_ID} .tumbo-tip-picker[hidden] { display: none; }
#${PANEL_ID} .tumbo-tip-label {
  font-size: 9px;
  color: #7aa0ad;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  width: 100%;
}
#${PANEL_ID} .tsu-deliver-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 6px;
}
#${PANEL_ID} .tsu-deliver-row input,
#${PANEL_ID} .tsu-deliver-row select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(110, 200, 230, 0.22);
  border-radius: 8px;
  background: rgba(4, 14, 20, 0.7);
  color: #c8eef8;
  padding: 6px 8px;
  font-size: 11px;
}
#${PANEL_ID} .tsu-pending,
#${PANEL_ID} .tsu-notif {
  padding: 7px 9px;
  margin-bottom: 5px;
  border-radius: 9px;
  border: 1px solid rgba(100, 190, 220, 0.12);
  background: rgba(8, 28, 38, 0.5);
  font-size: 10px;
  line-height: 1.35;
  color: #a8c8d4;
}
#${PANEL_ID} .tsu-pending .amt,
#${PANEL_ID} .tsu-notif .amt {
  color: #9eecff;
  font-weight: 600;
}
#${PANEL_ID} .tsu-pending-actions {
  display: flex;
  gap: 5px;
  margin-top: 5px;
}
#${PANEL_ID} .tsu-chip {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #b8e8f8;
}
#${PANEL_ID}[data-minimized="1"] .tsu-head,
#${PANEL_ID}[data-minimized="1"] .tsu-body { display: none; }
#${PANEL_ID}[data-minimized="1"] .tsu-chip { display: flex; }
#${TOAST_HOST_ID} {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 95;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  pointer-events: none;
  width: min(420px, calc(100vw - 24px));
}
#${TOAST_HOST_ID} .tsu-toast {
  pointer-events: auto;
  padding: 9px 14px;
  border-radius: 12px;
  border: 1px solid rgba(120, 220, 250, 0.35);
  background: linear-gradient(135deg, rgba(6, 32, 42, 0.95), rgba(4, 14, 20, 0.92));
  color: #d8f6ff;
  font-size: 11px;
  letter-spacing: 0.03em;
  box-shadow: 0 12px 36px rgba(0,0,0,0.4);
  animation: tsu-toast-in 0.22s ease;
}
#${TOAST_HOST_ID} .tsu-toast[data-error="1"] {
  border-color: rgba(255, 140, 150, 0.55);
  color: #ffe0e4;
}
@keyframes tsu-toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@media (max-width: 420px) {
  #${PANEL_ID} {
    right: 12px;
    left: 12px;
    width: auto;
    bottom: 64px;
    max-height: min(70vh, calc(100vh - 90px));
  }
}
`;
  document.head.appendChild(style);
}

function ensureToastHost() {
  let host = document.getElementById(TOAST_HOST_ID);
  if (host) return host;
  host = document.createElement("div");
  host.id = TOAST_HOST_ID;
  document.body.appendChild(host);
  document.addEventListener(TOAST_EVENT, (ev) => {
    const d = ev?.detail || {};
    const el = document.createElement("div");
    el.className = "tsu-toast";
    if (d.error) el.dataset.error = "1";
    el.textContent = d.message || "Simulated action";
    host.appendChild(el);
    setTimeout(() => {
      try {
        el.remove();
      } catch {}
    }, 3200);
  });
  return host;
}

function renderPanel(ctrl) {
  ensureStyles();
  ensureToastHost();

  let panel = document.getElementById(PANEL_ID);
  if (panel) panel.remove();

  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.setAttribute("data-simulation", "true");
  panel.innerHTML = `
    <div class="tsu-chip" data-action="restore" title="Open token social UX (simulated)">◎ Tips · simulated</div>
    <div class="tsu-head" data-drag="1">
      <div>
        <div class="tsu-eyebrow">Token social</div>
        <div class="tsu-title">Tips & deliveries</div>
        <div class="tsu-sim">Simulated points only — never real money</div>
      </div>
      <div class="tsu-actions">
        <button type="button" class="tsu-icon-btn" data-action="refresh" title="Refresh">↻</button>
        <button type="button" class="tsu-icon-btn" data-action="minimize" title="Minimize">–</button>
      </div>
    </div>
    <div class="tsu-body">
      <div class="tsu-bal">
        <span>Your balance</span>
        <strong data-role="balance">—</strong>
      </div>
      <div class="tsu-section">
        <h3>Feed · tip authors</h3>
        <div data-role="feed"></div>
      </div>
      <div class="tsu-section">
        <h3>Deliver (escrow)</h3>
        <div class="tsu-deliver-row">
          <select data-role="deliver-to">
            <option value="u:alice">u:alice</option>
            <option value="u:bob">u:bob</option>
            <option value="u:river">u:river</option>
          </select>
          <select data-role="deliver-amt">
            ${TIP_PRESETS_FLUFF.map((f) => `<option value="${f}">${fmtFluff(f)}</option>`).join("")}
          </select>
        </div>
        <button type="button" class="tsu-btn" data-action="deliver">Hold in escrow (simulated)</button>
      </div>
      <div class="tsu-section">
        <h3>Pending escrow</h3>
        <div data-role="pending"></div>
      </div>
      <div class="tsu-section">
        <h3>Notifications</h3>
        <div data-role="notifs"></div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const feed = panel.querySelector('[data-role="feed"]');
  for (const post of DEMO_FEED_POSTS) {
    const el = document.createElement("div");
    el.className = "tsu-post";
    el.dataset.postId = post.id;
    el.dataset.author = post.author;
    el.innerHTML = `<div class="author">${post.label} · ${post.author}</div><div class="body">${post.body}</div>`;
    feed.appendChild(el);
    ctrl.attachTipControl(el);
  }

  function refresh() {
    const balEl = panel.querySelector('[data-role="balance"]');
    try {
      balEl.textContent = socialFmt(socialBalance("u:you"));
    } catch {
      balEl.textContent = "—";
    }

    const pendHost = panel.querySelector('[data-role="pending"]');
    const pending = listPendingEscrow();
    if (!pending.length) {
      pendHost.innerHTML = `<div class="tsu-pending">No pending deliveries (simulated).</div>`;
    } else {
      pendHost.innerHTML = pending
        .map(
          (p) => `
        <div class="tsu-pending" data-intent="${p.intentId}">
          <div><span class="amt">${fmtFluff(p.amountFluff)}</span> · ${p.sender} → ${p.receiver}</div>
          <div class="tsu-pending-actions">
            <button type="button" class="tsu-btn" data-action="confirm" data-intent="${p.intentId}" data-receiver="${p.receiver}">Confirm</button>
            <button type="button" class="tsu-btn" data-action="cancel" data-intent="${p.intentId}" data-sender="${p.sender}">Cancel</button>
          </div>
        </div>`,
        )
        .join("");
    }

    const notifHost = panel.querySelector('[data-role="notifs"]');
    const notifs = [
      ...listSocialNotifications("u:you"),
      ...listSocialNotifications("u:alice"),
      ...listSocialNotifications("u:bob"),
      ...listSocialNotifications("u:river"),
    ]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 12);
    if (!notifs.length) {
      notifHost.innerHTML = `<div class="tsu-notif">No tips or deliveries yet (simulated).</div>`;
    } else {
      notifHost.innerHTML = notifs
        .map(
          (n) => `
        <div class="tsu-notif">
          <div><span class="amt">${fmtFluff(n.amountFluff || 0)}</span> · ${n.kind}</div>
          <div>${n.counterparty || "—"} → ${n.forAccount || "—"} · ${n.receiptId || ""}</div>
          <div style="opacity:.65">${n.at || ""}</div>
        </div>`,
        )
        .join("");
    }
  }

  panel.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    if (action === "minimize") {
      panel.dataset.minimized = "1";
      return;
    }
    if (action === "restore") {
      panel.dataset.minimized = "0";
      return;
    }
    if (action === "refresh") {
      refresh();
      return;
    }
    if (action === "deliver") {
      const to = panel.querySelector('[data-role="deliver-to"]').value;
      const amt = Number(panel.querySelector('[data-role="deliver-amt"]').value) || DEFAULT_TIP_FLUFF;
      try {
        socialDeliver({ sender: "u:you", receiver: to, amountFluff: amt });
        refresh();
      } catch {}
      return;
    }
    if (action === "confirm") {
      try {
        socialConfirmDelivery({ intentId: t.dataset.intent, actor: t.dataset.receiver });
        refresh();
      } catch {}
      return;
    }
    if (action === "cancel") {
      try {
        socialCancelDelivery({ intentId: t.dataset.intent, actor: t.dataset.sender });
        refresh();
      } catch {}
      return;
    }
  });

  let dragging = false;
  let ox = 0;
  let oy = 0;
  const head = panel.querySelector(".tsu-head");
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - ox));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  head.addEventListener("pointerup", () => {
    dragging = false;
  });

  document.addEventListener("tumbo:token", () => refresh());
  refresh();
  return panel;
}

/**
 * Mount a small glass cube in the block world and open the HUD panel.
 * @param {object} THREE
 * @param {object} [opts]
 */
export function createTokenSocialUxBlock(THREE, opts = {}) {
  const controller = createTokenSocialUxController({ tipper: "u:you" });
  const group = new THREE.Group();
  group.name = "token-social-ux/block";

  const tint = glassTintFor("#3ec8ff", 0.35);
  const cube = makeGlassCube(THREE, {
    size: 0.85,
    tint,
    name: "token-social-ux/cube",
  });
  group.add(cube);

  const glow = new THREE.PointLight("#6ad8ff", 0.55, 6, 2);
  glow.position.set(0, 0.4, 0.6);
  glow.name = "token-social-ux/glow";
  group.add(glow);

  const saved = loadPose();
  const pos = opts.position || saved || { x: 2.4, y: 0.6, z: -1.8 };
  group.position.set(pos.x, pos.y, pos.z);

  if (opts.parent) {
    opts.parent.add(group);
  }

  group.userData.tokenSocialUx = {
    onHover() {},
    onSelect() {
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.dataset.minimized = "0";
    },
  };

  const panel = renderPanel(controller);

  const poseTimer = setInterval(() => {
    savePose(group.position);
  }, 2000);

  function dispose() {
    clearInterval(poseTimer);
    try {
      controller.dispose();
    } catch {}
    try {
      panel?.remove();
    } catch {}
    try {
      group.parent?.remove(group);
    } catch {}
  }

  return { group, panel, controller, dispose, THREE };
}

export function mountTokenSocialUx(THREE, parent, position) {
  if (!THREE || !parent) {
    const controller = createTokenSocialUxController({ tipper: "u:you" });
    const panel = renderPanel(controller);
    return { group: null, panel, controller, dispose: () => panel?.remove() };
  }
  return createTokenSocialUxBlock(THREE, { parent, position });
}

export { renderPanel, ensureStyles };
