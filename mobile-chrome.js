// mobile-chrome.js — tiny progressive enhancement for phones (<=700px).
//
// Adds the collapsible bottom tab dock plus the VIEW / INSPECT sheet toggles
// that mobile-layout.css styles. Everything is additive: no existing DOM,
// styles, or behavior are modified. On wider viewports this module is a no-op,
// so desktop is pixel-unchanged.
const MOBILE_QUERY = '(max-width:700px)';
const DOCK_SELECTOR = '#matumbo-command-deck .mcd-bottom';

function mount() {
  const dock = document.querySelector(DOCK_SELECTOR);
  if (!dock || dock.dataset.mobileChrome) return; // idempotent
  dock.dataset.mobileChrome = '1';

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.dataset.mobileDockHandle = '';
  handle.setAttribute('aria-expanded', 'false');
  handle.setAttribute('aria-label', 'Open navigation tabs');
  const handleIcon = document.createElement('span');
  handleIcon.setAttribute('aria-hidden', 'true');
  handleIcon.textContent = '☰';
  const handleText = document.createElement('span');
  handleText.textContent = 'Tabs';
  handle.append(handleIcon, handleText);

  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.dataset.mobileViewToggle = '';
  viewBtn.textContent = 'VIEW';
  viewBtn.setAttribute('aria-pressed', 'false');
  viewBtn.setAttribute('aria-label', 'Show or hide the Aspectus view bar');

  const inspectBtn = document.createElement('button');
  inspectBtn.type = 'button';
  inspectBtn.dataset.mobileInspectToggle = '';
  inspectBtn.textContent = 'INSPECT';
  inspectBtn.setAttribute('aria-pressed', 'false');
  inspectBtn.setAttribute('aria-label', 'Show or hide the reality inspector');

  dock.prepend(handle);
  dock.append(viewBtn, inspectBtn);

  const sync = () => {
    handle.setAttribute('aria-expanded', String(document.body.classList.contains('mobile-dock-open')));
    viewBtn.setAttribute('aria-pressed', String(document.body.classList.contains('mobile-view-open')));
    inspectBtn.setAttribute('aria-pressed', String(document.body.classList.contains('mobile-inspect-open')));
  };

  handle.addEventListener('click', () => {
    const open = !document.body.classList.contains('mobile-dock-open');
    document.body.classList.toggle('mobile-dock-open', open);
    if (!open) {
      // Collapsing the dock also closes the sheets it toggles.
      document.body.classList.remove('mobile-view-open', 'mobile-inspect-open');
    }
    sync();
  });
  viewBtn.addEventListener('click', () => {
    document.body.classList.toggle('mobile-view-open');
    sync();
  });
  inspectBtn.addEventListener('click', () => {
    document.body.classList.toggle('mobile-inspect-open');
    sync();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.body.classList.remove('mobile-view-open', 'mobile-inspect-open');
      sync();
    }
  });
  sync();
}

function boot() {
  const mq = window.matchMedia(MOBILE_QUERY);
  const tidy = () => {
    if (mq.matches) mount();
    else document.body.classList.remove('mobile-dock-open', 'mobile-view-open', 'mobile-inspect-open');
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', tidy);
  if (!mq.matches) return; // desktop: no-op
  if (document.querySelector(DOCK_SELECTOR)) {
    mount();
    return;
  }
  // The command deck mounts asynchronously; poll briefly, then give up quietly.
  let tries = 0;
  const timer = setInterval(() => {
    if (document.querySelector(DOCK_SELECTOR)) {
      clearInterval(timer);
      mount();
    } else if (++tries > 120) {
      clearInterval(timer);
    }
  }, 250);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
