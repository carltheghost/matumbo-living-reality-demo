/**
 * src/render/air-keyboard.js
 *
 * Hand Lens — Air Keyboard
 * ------------------------
 * Floating, glassy, movable QWERTY keyboard for the maTumbo Living Reality Ω
 * local-first spatial UI.
 *
 * No build step.
 * Vanilla ES modules.
 *
 * Public API:
 *
 *   const keyboard = createAirKeyboard({
 *     onKey(keyInfo) {}
 *   });
 *
 *   keyboard.show();
 *   keyboard.hide();
 *   keyboard.isVisible();
 *   keyboard.setPosition3D(x, y, z);
 *   keyboard.getKeyRects();
 *   keyboard.destroy();
 *   keyboard.element;
 *
 * The keyboard automatically watches document focus/beforeinput events for:
 *   - <input>
 *   - <textarea>
 *   - [contenteditable]
 *
 * Integration point:
 *
 *   import { createAirKeyboard } from './render/air-keyboard.js';
 *
 *   const airKeyboard = createAirKeyboard({
 *     onKey: (keyInfo) => {
 *       // Optional hand-lane / telemetry hook.
 *     }
 *   });
 *
 * Focus events are learned automatically from the document. main.js does not
 * need to manually forward focus events.
 *
 * If main.js already has its own focus/input routing, it can simply construct
 * the keyboard once during startup.
 */

const STORAGE_KEY = 'matumbo:air-keyboard:position';

const DEFAULT_OPTIONS = {
  autoHide: true,
  storageKey: STORAGE_KEY,
  animationMs: 180,
  bottomOffset: 18,
  sidePadding: 12,
  maxWidth: 720,
};

const LETTER_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const NUMBER_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const SYMBOL_ROWS = [
  ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
  ['-', '_', '=', '+', '[', ']', '{', '}', '\\'],
  [';', ':', "'", '"', ',', '.', '/', '?'],
];

/**
 * Keys which are rendered as normal character keys.
 */
const CHARACTER_KEYS = new Set([
  ...NUMBER_ROW,
  ...LETTER_ROWS.flat(),
  ...SYMBOL_ROWS.flat(),
]);

/**
 * ---------------------------------------------------------------------------
 * Pure layout math
 * ---------------------------------------------------------------------------
 *
 * Kept independent from DOM creation so this can be unit-tested later.
 */

/**
 * Build a logical keyboard layout.
 *
 * Each key contains:
 *   id
 *   label
 *   value
 *   width
 *   action
 *
 * Width is a relative unit. A normal key is 1 unit.
 *
 * @param {Object} options
 * @param {boolean} options.symbols
 * @returns {Array<Array<Object>>}
 */
export function calculateKeyboardLayout({ symbols = false } = {}) {
  const rows = [];

  if (!symbols) {
    rows.push(
      NUMBER_ROW.map((key) => createCharacterLayoutKey(key)),
    );

    rows.push(
      LETTER_ROWS[0].map((key) => createCharacterLayoutKey(key)),
    );

    rows.push([
      ...LETTER_ROWS[1].map((key) => createCharacterLayoutKey(key)),
      createActionLayoutKey('backspace', '⌫', 'backspace', 1.7),
    ]);

    rows.push([
      createActionLayoutKey('shift', '⇧', 'shift', 1.55),
      ...LETTER_ROWS[2].map((key) => createCharacterLayoutKey(key)),
      createActionLayoutKey('enter', '↵', 'enter', 1.7),
    ]);
  } else {
    rows.push(
      SYMBOL_ROWS[0].map((key) => createCharacterLayoutKey(key)),
    );

    rows.push(
      SYMBOL_ROWS[1].map((key) => createCharacterLayoutKey(key)),
    );

    rows.push([
      ...SYMBOL_ROWS[2].map((key) => createCharacterLayoutKey(key)),
      createActionLayoutKey('backspace', '⌫', 'backspace', 1.7),
    ]);

    rows.push([
      createActionLayoutKey('symbols', 'ABC', 'symbols', 1.55),
      createActionLayoutKey('space', 'space', ' ', 5.4),
      createActionLayoutKey('enter', '↵', 'enter', 1.7),
    ]);
  }

  if (!symbols) {
    rows.push([
      createActionLayoutKey('symbols', '?123', 'symbols', 1.55),
      createActionLayoutKey('space', 'space', ' ', 5.4),
      createActionLayoutKey('enter', '↵', 'enter', 1.7),
      createActionLayoutKey('dismiss', '×', 'dismiss', 1.15),
    ]);
  } else {
    rows.push([
      createActionLayoutKey('symbols', 'ABC', 'symbols', 1.55),
      createActionLayoutKey('space', 'space', ' ', 5.4),
      createActionLayoutKey('dismiss', '×', 'dismiss', 1.15),
    ]);
  }

  // Action keys (enter, symbols) legitimately appear twice in a layout
  // (once per row group). Key IDs must stay unique so getKeyRects() and
  // dataset lookups never silently drop a key.
  const seenIds = new Map();
  for (const row of rows) {
    for (const key of row) {
      const count = seenIds.get(key.id) ?? 0;
      seenIds.set(key.id, count + 1);
      if (count > 0) key.id = `${key.id}-${count + 1}`;
    }
  }

  return rows;
}

/**
 * Calculate normalized rectangles for a keyboard layout.
 *
 * The result is independent of DOM, viewport, or Three.js.
 *
 * @param {Array<Array<Object>>} rows
 * @param {Object} options
 * @param {number} options.keySize
 * @param {number} options.gap
 * @returns {Object<string, {x:number,y:number,width:number,height:number}>}
 */
export function calculateKeyRects(
  rows,
  {
    keySize = 44,
    gap = 6,
  } = {},
) {
  const rects = {};
  let y = 0;
  for (const row of rows) {
    let x = 0;
    for (const key of row) {
      const width = keySize * key.width + gap * Math.max(0, key.width - 1);
      rects[key.id] = {
        x,
        y,
        width,
        height: keySize,
      };
      x += width + gap;
    }
    y += keySize + gap;
  }
  return rects;
}

function createCharacterLayoutKey(value) {
  return {
    id: `key-${value}`,
    label: value,
    value,
    width: 1,
    action: 'character',
  };
}

function createActionLayoutKey(id, label, value, width) {
  return {
    id: `key-${id}`,
    label,
    value,
    width,
    action: id,
  };
}

/**
 * ---------------------------------------------------------------------------
 * Public factory
 * ---------------------------------------------------------------------------
 */

/**
 * Create a floating air keyboard.
 *
 * @param {Object} options
 * @param {(keyInfo:Object) => void} [options.onKey]
 * @param {boolean} [options.autoHide=true]
 * @param {string} [options.storageKey]
 * @param {number} [options.animationMs=180]
 * @param {number} [options.bottomOffset=18]
 * @param {number} [options.sidePadding=12]
 * @param {number} [options.maxWidth=720]
 * @returns {{
 *   show: Function,
 *   hide: Function,
 *   isVisible: Function,
 *   setPosition3D: Function,
 *   getKeyRects: Function,
 *   destroy: Function,
 *   element: HTMLElement
 * }}
 */
export function createAirKeyboard(options = {}) {
  if (typeof document === 'undefined') {
    throw new Error('createAirKeyboard() requires a browser document.');
  }

  const config = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  injectStyles();

  let destroyed = false;
  let visible = false;
  let symbols = false;
  let shift = false;

  /**
   * The field which should receive keyboard input.
   *
   * We intentionally retain this reference when the keyboard's own buttons
   * are interacted with. Otherwise clicking a keyboard button would move
   * document.activeElement to that button and the text would go nowhere.
   */
  let focusedTarget = null;

  /**
   * Position is stored in CSS-pixel coordinates relative to the viewport.
   *
   * z is retained as a 3D layer value so the hand-grab lane can manipulate
   * the keyboard through setPosition3D().
   */
  let position = loadPosition(config.storageKey);

  /**
   * Forward a key event to the configured onKey hook.
   *
   * Telemetry must never break typing: a throwing hook is swallowed.
   */
  function emitKey(keyInfo) {
    if (typeof config.onKey !== 'function') return;
    try {
      config.onKey(keyInfo);
    } catch {
      // A telemetry hook must never break typing.
    }
  }

  /**
   * -------------------------------------------------------------------------
   * Root
   * -------------------------------------------------------------------------
   */
  const root = document.createElement('section');
  root.className = 'matumbo-air-keyboard';
  root.setAttribute('aria-label', 'Air keyboard');
  root.setAttribute('aria-hidden', 'true');
  root.style.setProperty(
    '--air-keyboard-animation-ms',
    `${config.animationMs}ms`,
  );

  /**
   * A small floating handle is deliberately separate from the keys.
   * The hand-grab lane can use it as its physical grab target.
   */
  const dragHandle = document.createElement('div');
  dragHandle.className = 'matumbo-air-keyboard__handle';
  dragHandle.setAttribute('role', 'button');
  dragHandle.setAttribute('tabindex', '0');
  dragHandle.setAttribute('aria-label', 'Move keyboard');
  dragHandle.innerHTML = `
    <span class="matumbo-air-keyboard__handle-dot"></span>
    <span class="matumbo-air-keyboard__handle-dot"></span>
    <span class="matumbo-air-keyboard__handle-dot"></span>
  `;

  const title = document.createElement('span');
  title.className = 'matumbo-air-keyboard__title';
  title.textContent = 'AIR INPUT';

  const status = document.createElement('span');
  status.className = 'matumbo-air-keyboard__status';
  status.setAttribute('aria-hidden', 'true');

  const header = document.createElement('div');
  header.className = 'matumbo-air-keyboard__header';
  header.append(dragHandle, title, status);

  const keyboardSurface = document.createElement('div');
  keyboardSurface.className = 'matumbo-air-keyboard__surface';
  keyboardSurface.setAttribute('role', 'group');
  keyboardSurface.setAttribute('aria-label', 'Keyboard keys');

  root.append(header, keyboardSurface);
  document.body.appendChild(root);

  /**
   * -------------------------------------------------------------------------
   * Layout
   * -------------------------------------------------------------------------
   */
  function renderKeys() {
    keyboardSurface.replaceChildren();
    const rows = calculateKeyboardLayout({ symbols });
    for (const row of rows) {
      const rowElement = document.createElement('div');
      rowElement.className = 'matumbo-air-keyboard__row';
      for (const key of row) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'matumbo-air-keyboard__key';
        button.dataset.keyId = key.id;
        button.dataset.action = key.action;
        button.dataset.value = key.value;
        button.style.setProperty('--key-width', String(key.width));
        button.setAttribute('aria-label', getAccessibleKeyLabel(key));
        button.textContent = key.label;
        if (key.action === 'shift' && shift) {
          button.classList.add('is-active');
          button.setAttribute('aria-pressed', 'true');
        }
        if (key.action === 'symbols') {
          button.setAttribute('aria-pressed', String(symbols));
        }
        /**
         * pointerdown prevents the real input from losing focus.
         *
         * This is critical for mouse, pen, and touch interaction.
         */
        button.addEventListener('pointerdown',
          (event) => {
            event.preventDefault();
          },
          { passive: false },
        );
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          activateKey(key, button);
        });
        rowElement.appendChild(button);
      }
      keyboardSurface.appendChild(rowElement);
    }
    updateStatus();
  }

  renderKeys();

  /**
   * -------------------------------------------------------------------------
   * Focus / input detection
   * -------------------------------------------------------------------------
   */
  function handleFocusIn(event) {
    if (destroyed) {
      return;
    }
    const target = event.target;
    if (!isTextTarget(target)) {
      return;
    }
    focusedTarget = target;
    showNearTarget(target);
  }

  function handleBeforeInput(event) {
    if (destroyed) {
      return;
    }
    const target = event.target;
    if (!isTextTarget(target)) {
      return;
    }
    focusedTarget = target;
    if (!visible) {
      showNearTarget(target);
    }
  }

  function handleFocusOut(event) {
    if (destroyed || !config.autoHide) {
      return;
    }
    const target = event.target;
    if (target !== focusedTarget) {
      return;
    }
    /**
     * Delay the hide check by one frame.
     *
     * This gives pointer interaction on the keyboard a chance to begin
     * without causing a visual flicker.
     */
    requestAnimationFrame(() => {
      if (destroyed) {
        return;
      }
      const active = document.activeElement;
      if (active !== target && !root.contains(active)) {
        hide();
      }
    });
  }

  function handleDocumentKeydown(event) {
    if (destroyed || !visible) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
      return;
    }
    /**
     * Physical keyboard input still works normally.
     *
     * The air keyboard is an additional input surface, not a replacement
     * for the user's hardware keyboard.
     */
    if (event.key === 'Tab' && !root.contains(event.target)) {
      return;
    }
  }

  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('beforeinput', handleBeforeInput);
  document.addEventListener('focusout', handleFocusOut);
  document.addEventListener('keydown', handleDocumentKeydown);

  /**
   * -------------------------------------------------------------------------
   * Show / hide
   * -------------------------------------------------------------------------
   */
  function show() {
    if (destroyed) {
      return;
    }
    visible = true;
    root.classList.add('is-visible');
    root.setAttribute('aria-hidden', 'false');
    updateStatus();
  }

  function hide() {
    if (destroyed) {
      return;
    }
    visible = false;
    root.classList.remove('is-visible');
    root.setAttribute('aria-hidden', 'true');
  }

  function isVisible() {
    return visible;
  }

  /**
   * Position the keyboard near the focused field without obscuring it.
   *
   * Default behavior:
   * - Prefer directly beneath the field.
   * - If there is not enough room, place it above the field.
   * - Clamp horizontally to the viewport.
   * - If the keyboard would otherwise become absurdly large, CSS handles
   *   responsive compression.
   */
  function showNearTarget(target) {
    if (!target || !target.getBoundingClientRect) {
      show();
      return;
    }
    const targetRect = target.getBoundingClientRect();
    /**
     * Reset temporary transform so getBoundingClientRect() represents the
     * keyboard's natural dimensions while we calculate placement.
     */
    root.classList.add('is-measuring');
    const keyboardRect = root.getBoundingClientRect();
    root.classList.remove('is-measuring');
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(
      keyboardRect.width || config.maxWidth,
      viewportWidth - config.sidePadding * 2,
    );
    const height = keyboardRect.height || 280;
    let x = targetRect.left + targetRect.width / 2 - width / 2;
    let y = targetRect.bottom + 12;
    /**
     * Prefer below the field.
     * If that would leave the keyboard mostly outside the viewport,
     * flip it above.
     */
    if (y + height > viewportHeight - config.bottomOffset) {
      y = targetRect.top - height - 12;
    }
    /**
     * If there is still no room above, use the bottom dock.
     */
    if (y < config.sidePadding) {
      y = viewportHeight - height - config.bottomOffset;
    }
    x = clamp(
      x,
      config.sidePadding,
      viewportWidth - width - config.sidePadding,
    );
    position.x = Math.round(x);
    position.y = Math.round(y);
    position.z = Number.isFinite(position.z) ? position.z : 0;
    applyPosition();
    persistPosition(config.storageKey);
    show();
  }

  /**
   * -------------------------------------------------------------------------
   * Key handling
   * -------------------------------------------------------------------------
   */
  function activateKey(key, button) {
    if (destroyed) {
      return;
    }
    /**
     * Make the press visually tangible.
     */
    flashKey(button);
    const action = key.action;
    if (action === 'dismiss') {
      hide();
      emitKey({
        id: key.id,
        action,
        value: null,
        label: key.label,
      });
      return;
    }
    if (action === 'symbols') {
      symbols = !symbols;
      renderKeys();
      emitKey({
        id: key.id,
        action,
        value: symbols,
        label: key.label,
      });
      return;
    }
    if (action === 'shift') {
      shift = !shift;
      renderKeys();
      emitKey({
        id: key.id,
        action,
        value: shift,
        label: key.label,
      });
      return;
    }
    if (!focusedTarget || !isTextTarget(focusedTarget)) {
      emitKey({
        id: key.id,
        action,
        value: key.value,
        label: key.label,
        inserted: false,
      });
      return;
    }
    /**
     * Restore the target's focus without scrolling the page around.
     */
    try {
      focusedTarget.focus({
        preventScroll: true,
      });
    } catch {
      focusedTarget.focus();
    }
    const value = getKeyValue(key);
    let inserted = false;
    if (action === 'backspace') {
      inserted = deleteBackward(focusedTarget);
    } else if (action === 'enter') {
      inserted = insertText(focusedTarget, '\n');
    } else {
      inserted = insertText(focusedTarget, value);
    }
    emitKey({
      id: key.id,
      action,
      value,
      label: key.label,
      inserted,
    });
    /**
     * Shift is deliberately one-shot.
     */
    if (shift && action !== 'shift' && action !== 'symbols') {
      shift = false;
      renderKeys();
    }
    updateStatus();
  }

  function getKeyValue(key) {
    if (key.action === 'character' && shift) {
      return key.value.toUpperCase();
    }
    return key.value;
  }

  /**
   * Insert text into an input/textarea while preserving cursor position.
   */
  function insertText(target, text) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return insertIntoFormControl(target, text);
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      return insertIntoContentEditable(target, text);
    }
    return false;
  }

  function insertIntoFormControl(target, text) {
    const value = target.value ?? '';
    const start = Number.isInteger(target.selectionStart)
      ? target.selectionStart
      : value.length;
    const end = Number.isInteger(target.selectionEnd)
      ? target.selectionEnd
      : start;
    const nextValue = value.slice(0, start) + text + value.slice(end);
    /**
     * Native setter helps frameworks which observe the property rather than
     * merely listening to DOM mutation.
     */
    setNativeValue(target, nextValue);
    const nextCursor = start + text.length;
    try {
      target.setSelectionRange(nextCursor, nextCursor);
    } catch {
      // Some input types do not expose selection APIs.
    }
    dispatchInputEvent(target, text);
    return true;
  }

  function deleteBackward(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const value = target.value ?? '';
      let start = Number.isInteger(target.selectionStart)
        ? target.selectionStart
        : value.length;
      let end = Number.isInteger(target.selectionEnd)
        ? target.selectionEnd
        : start;
      if (start === end) {
        if (start <= 0) {
          return false;
        }
        start -= 1;
      }
      const nextValue = value.slice(0, start) + value.slice(end);
      setNativeValue(target, nextValue);
      try {
        target.setSelectionRange(start, start);
      } catch {
        // Ignore unsupported selection APIs.
      }
      dispatchInputEvent(target, '');
      return true;
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      return deleteContentEditableBackward(target);
    }
    return false;
  }

  /**
   * Contenteditable insertion.
   *
   * execCommand is intentionally used as a compatibility fallback because
   * browser contenteditable implementations vary considerably. Where
   * available, it preserves the browser's native editing semantics.
   */
  function insertIntoContentEditable(target, text) {
    target.focus();
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }
      const range = selection.getRangeAt(0);
      if (!target.contains(range.commonAncestorContainer)) {
        return false;
      }
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      inserted = true;
    }
    if (inserted) {
      dispatchInputEvent(target, text);
    }
    return inserted;
  }

  function deleteContentEditableBackward(target) {
    target.focus();
    try {
      if (document.execCommand('delete', false)) {
        dispatchInputEvent(target, '');
        return true;
      }
    } catch {
      // Continue to range fallback.
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) {
      return false;
    }
    if (!range.collapsed) {
      range.deleteContents();
    } else {
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        if (range.startOffset <= 0) {
          return false;
        }
        range.setStart(node, range.startOffset - 1);
        range.deleteContents();
      } else {
        return false;
      }
    }
    dispatchInputEvent(target, '');
    return true;
  }

  function setNativeValue(target, value) {
    const prototype = target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(target, value);
    } else {
      target.value = value;
    }
  }

  function dispatchInputEvent(target, data) {
    let event;
    try {
      event = new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data,
      });
    } catch {
      event = new Event('input', {
        bubbles: true,
        composed: true,
      });
    }
    target.dispatchEvent(event);
  }

  /**
   * -------------------------------------------------------------------------
   * Dragging
   * -------------------------------------------------------------------------
   */
  let dragState = null;

  function beginDrag(event) {
    if (destroyed) {
      return;
    }
    /**
     * Only primary pointer participates.
     */
    if (event.pointerType !== 'touch' && event.button !== 0) {
      return;
    }
    event.preventDefault();
    const point = getPointerPoint(event);
    dragState = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originX: position.x,
      originY: position.y,
      originZ: position.z,
    };
    root.classList.add('is-dragging');
    try {
      dragHandle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional.
    }
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    event.preventDefault();
    const point = getPointerPoint(event);
    position.x = dragState.originX + (point.x - dragState.startX);
    position.y = dragState.originY + (point.y - dragState.startY);
    /**
     * Keep the keyboard reachable instead of allowing it to disappear
     * completely beyond the viewport.
     */
    const rect = root.getBoundingClientRect();
    const width = rect.width || 320;
    const height = rect.height || 250;
    position.x = clamp(
      position.x,
      4 - width + 56,
      window.innerWidth - 56,
    );
    position.y = clamp(
      position.y,
      4 - height + 56,
      window.innerHeight - 56,
    );
    applyPosition();
  }

  function endDrag(event) {
    if (dragState && event.pointerId !== dragState.pointerId) {
      return;
    }
    if (!dragState) {
      return;
    }
    dragState = null;
    root.classList.remove('is-dragging');
    persistPosition(config.storageKey);
  }

  dragHandle.addEventListener('pointerdown', beginDrag, { passive: false });
  dragHandle.addEventListener('pointermove', moveDrag, { passive: false });
  dragHandle.addEventListener('pointerup', endDrag);
  dragHandle.addEventListener('pointercancel', endDrag);
  dragHandle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      root.classList.toggle('is-expanded');
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    }
  });

  /**
   * -------------------------------------------------------------------------
   * Public 3D positioning
   * -------------------------------------------------------------------------
   */

  /**
   * Move the keyboard in screen-space X/Y and retain a Z value for the
   * spatial/hand lane.
   *
   * For the browser implementation, z becomes a CSS translateZ value.
   * A future Three.js projection layer can call this directly without
   * needing to know how the DOM keyboard is implemented.
   */
  function setPosition3D(x, y, z = 0) {
    if (destroyed) {
      return;
    }
    position.x = Number.isFinite(Number(x)) ? Number(x) : position.x;
    position.y = Number.isFinite(Number(y)) ? Number(y) : position.y;
    position.z = Number.isFinite(Number(z)) ? Number(z) : position.z;
    applyPosition();
    persistPosition(config.storageKey);
  }

  function applyPosition() {
    root.style.setProperty('--air-keyboard-x', `${position.x}px`);
    root.style.setProperty('--air-keyboard-y', `${position.y}px`);
    root.style.setProperty('--air-keyboard-z', `${position.z}px`);
  }

  /**
   * -------------------------------------------------------------------------
   * Key rectangle API
   * -------------------------------------------------------------------------
   */

  /**
   * Return screen-space DOMRects for every visible key.
   *
   * Example:
   *
   *   const rects = keyboard.getKeyRects();
   *   rects['key-a'].left
   *   rects['key-a'].top
   *   rects['key-a'].width
   *
   * This is intentionally screen-space so an air-typing system can compare
   * hand/finger coordinates directly against these rectangles.
   */
  function getKeyRects() {
    const result = {};
    const buttons = root.querySelectorAll('.matumbo-air-keyboard__key');
    for (const button of buttons) {
      if (!button.dataset.keyId) {
        continue;
      }
      result[button.dataset.keyId] = button.getBoundingClientRect();
    }
    return result;
  }

  /**
   * -------------------------------------------------------------------------
   * Persistence
   * -------------------------------------------------------------------------
   */
  function persistPosition(storageKey) {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          x: position.x,
          y: position.y,
          z: position.z,
        }),
      );
    } catch {
      /**
       * localStorage can be unavailable in private/restricted contexts.
       * The keyboard still works normally.
       */
    }
  }

  /**
   * -------------------------------------------------------------------------
   * Visual helpers
   * -------------------------------------------------------------------------
   */
  function flashKey(button) {
    button.classList.remove('is-pressed');
    /**
     * Force animation restart without introducing layout work.
     */
    void button.offsetWidth;
    button.classList.add('is-pressed');
    window.setTimeout(() => {
      button.classList.remove('is-pressed');
    }, Math.max(80, config.animationMs));
  }

  function updateStatus() {
    if (!status) {
      return;
    }
    status.textContent = symbols
      ? 'SYMBOLS'
      : shift
        ? 'SHIFT'
        : focusedTarget
          ? 'READY'
          : 'WAITING';
  }

  /**
   * -------------------------------------------------------------------------
   * Destroy
   * -------------------------------------------------------------------------
   */
  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    document.removeEventListener('focusin', handleFocusIn);
    document.removeEventListener('beforeinput', handleBeforeInput);
    document.removeEventListener('focusout', handleFocusOut);
    document.removeEventListener('keydown', handleDocumentKeydown);
    dragHandle.removeEventListener('pointerdown', beginDrag);
    dragHandle.removeEventListener('pointermove', moveDrag);
    dragHandle.removeEventListener('pointerup', endDrag);
    dragHandle.removeEventListener('pointercancel', endDrag);
    root.remove();
    focusedTarget = null;
    dragState = null;
  }

  /**
   * Initial position.
   *
   * The keyboard is not visible until an editable field receives focus.
   */
  applyPosition();

  /**
   * -------------------------------------------------------------------------
   * Programmatic key press (air-typing bridge)
   * -------------------------------------------------------------------------
   */

  /**
   * Press a key by its id exactly as if the user clicked its button:
   * same flash, same insertion path, same shift/symbols state machine,
   * same onKey emission. This is the integration point for the air-typing
   * engine: hand-tracked taps become real key presses with pointer parity.
   *
   * @param {string} keyId e.g. "key-a", "key-space", "key-backspace"
   * @returns {boolean} true when the key existed and was activated.
   */
  function pressKey(keyId) {
    if (destroyed || typeof keyId !== "string" || !keyId) {
      return false;
    }
    // Direct button lookup: iterate the rendered keys and match the data
    // key id instead of building a CSS attribute selector. This keeps
    // pressKey working for ids that contain characters special to CSS
    // selectors (e.g. key-?, key-\) and removes the CSS.escape dependency.
    let button = null;
    const buttons = root.querySelectorAll(".matumbo-air-keyboard__key");
    for (const candidate of buttons) {
      if (candidate.dataset.keyId === keyId) {
        button = candidate;
        break;
      }
    }
    if (!button) {
      return false;
    }
    activateKey(
      {
        id: keyId,
        action: button.dataset.action,
        value: button.dataset.value,
        label: button.textContent,
      },
      button,
    );
    return true;
  }

  /**
   * Public surface.
   */
  return {
    show,
    hide,
    isVisible,
    setPosition3D,
    getKeyRects,
    pressKey,
    destroy,
    element: root,
  };
}

/**
 * ---------------------------------------------------------------------------
 * Target detection
 * ---------------------------------------------------------------------------
 */
function isTextTarget(target) {
  if (!target || !(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLTextAreaElement) {
    return !target.disabled && !target.readOnly;
  }
  if (target instanceof HTMLInputElement) {
    const type = (target.type || 'text').toLowerCase();
    /**
     * These input types represent text-like entry surfaces.
     *
     * Number is intentionally included because the air keyboard can still
     * provide numbers, while the symbols layer provides additional input.
     */
    const supportedTypes = new Set([
      'text',
      'search',
      'email',
      'url',
      'tel',
      'password',
      'number',
    ]);
    return (
      supportedTypes.has(type) &&
      !target.disabled &&
      !target.readOnly
    );
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return false;
}

function getAccessibleKeyLabel(key) {
  switch (key.action) {
    case 'backspace':
      return 'Backspace';
    case 'shift':
      return 'Shift';
    case 'symbols':
      return 'Toggle symbols';
    case 'space':
      return 'Space';
    case 'enter':
      return 'Enter';
    case 'dismiss':
      return 'Dismiss keyboard';
    default:
      return key.label;
  }
}

/**
 * ---------------------------------------------------------------------------
 * Pointer helpers
 * ---------------------------------------------------------------------------
 */
function getPointerPoint(event) {
  return {
    x: Number.isFinite(event.clientX) ? event.clientX : 0,
    y: Number.isFinite(event.clientY) ? event.clientY : 0,
  };
}

/**
 * ---------------------------------------------------------------------------
 * Position persistence
 * ---------------------------------------------------------------------------
 */
function loadPosition(storageKey) {
  const fallback = {
    x: null,
    y: null,
    z: 0,
  };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return createDefaultPosition();
    }
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') {
      return createDefaultPosition();
    }
    return {
      x: Number.isFinite(Number(saved.x))
        ? Number(saved.x)
        : createDefaultPosition().x,
      y: Number.isFinite(Number(saved.y))
        ? Number(saved.y)
        : createDefaultPosition().y,
      z: Number.isFinite(Number(saved.z))
        ? Number(saved.z)
        : fallback.z,
    };
  } catch {
    return createDefaultPosition();
  }
}

function createDefaultPosition() {
  /**
   * Initial values are recalculated when the keyboard is actually shown,
   * because viewport dimensions may not be known at module construction time.
   *
   * Using 50% here gives the CSS/browser a sensible center fallback.
   */
  return {
    x: Math.max(12, Math.round(window.innerWidth / 2 - 360)),
    y: Math.max(12, Math.round(window.innerHeight - 320)),
    z: 0,
  };
}

/**
 * ---------------------------------------------------------------------------
 * Generic helpers
 * ---------------------------------------------------------------------------
 */
function clamp(value, min, max) {
  if (min > max) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * ---------------------------------------------------------------------------
 * Styles
 * ---------------------------------------------------------------------------
 *
 * Injected once per document.
 *
 * The visual language deliberately avoids a conventional webpage card:
 * - floating translucent surface
 * - no ordinary border/card treatment
 * - tiny spatial handle
 * - restrained glow
 * - layered glass
 * - compact typography
 * - no giant title/header
 */
function injectStyles() {
  if (document.getElementById('matumbo-air-keyboard-styles')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'matumbo-air-keyboard-styles';
  style.textContent = `
    .matumbo-air-keyboard {
      --air-keyboard-x: 12px;
      --air-keyboard-y: 12px;
      --air-keyboard-z: 0px;
      --air-keyboard-animation-ms: 180ms;

      position: fixed;
      left: 0;
      top: 0;

      z-index: 2147483000;

      width: min(
        720px,
        calc(100vw - 24px)
      );

      box-sizing: border-box;

      padding: 7px 8px 9px;

      border: 1px solid
        rgba(255, 255, 255, 0.13);

      border-radius: 20px;

      background:
        linear-gradient(
          145deg,
          rgba(28, 34, 45, 0.78),
          rgba(10, 14, 22, 0.68)
        );

      box-shadow:
        0 20px 55px
          rgba(0, 0, 0, 0.34),
        0 0 32px
          rgba(140, 190, 255, 0.055),
        inset 0 1px 0
          rgba(255, 255, 255, 0.10);

      backdrop-filter:
        blur(22px)
        saturate(135%);

      -webkit-backdrop-filter:
        blur(22px)
        saturate(135%);

      color: rgba(255, 255, 255, 0.92);

      transform:
        translate3d(
          var(--air-keyboard-x),
          var(--air-keyboard-y),
          var(--air-keyboard-z)
        )
        scale(0.97);

      transform-origin: center bottom;

      opacity: 0;
      visibility: hidden;
      pointer-events: none;

      transition:
        opacity var(--air-keyboard-animation-ms)
          ease,
        transform var(--air-keyboard-animation-ms)
          cubic-bezier(0.22, 0.8, 0.24, 1),
        visibility 0s
          linear
          var(--air-keyboard-animation-ms);

      user-select: none;
      -webkit-user-select: none;

      touch-action: none;

      font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

      isolation: isolate;
    }

    .matumbo-air-keyboard::before {
      content: "";

      position: absolute;
      inset: 0;

      border-radius: inherit;

      pointer-events: none;

      background:
        radial-gradient(
          circle at 18% 0%,
          rgba(255, 255, 255, 0.085),
          transparent 32%
        ),
        linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.025),
          transparent
        );

      opacity: 0.9;

      z-index: -1;
    }

    .matumbo-air-keyboard.is-visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;

      transform:
        translate3d(
          var(--air-keyboard-x),
          var(--air-keyboard-y),
          var(--air-keyboard-z)
        )
        scale(1);

      transition:
        opacity var(--air-keyboard-animation-ms)
          ease,
        transform var(--air-keyboard-animation-ms)
          cubic-bezier(0.22, 0.8, 0.24, 1),
        visibility 0s linear 0s;
    }

    .matumbo-air-keyboard.is-dragging {
      transition: none;
      cursor: grabbing;
    }

    .matumbo-air-keyboard.is-measuring {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }

    .matumbo-air-keyboard__header {
      height: 27px;

      display: flex;
      align-items: center;

      gap: 8px;

      padding:
        0 4px
        2px 4px;

      box-sizing: border-box;
    }

    .matumbo-air-keyboard__handle {
      width: 30px;
      height: 24px;

      display: flex;
      align-items: center;
      justify-content: center;

      gap: 3px;

      flex: 0 0 auto;

      border: 0;
      border-radius: 8px;

      background:
        rgba(255, 255, 255, 0.035);

      color: rgba(255, 255, 255, 0.56);

      cursor: grab;

      outline: none;

      touch-action: none;
    }

    .matumbo-air-keyboard__handle:hover,
    .matumbo-air-keyboard__handle:focus-visible {
      background:
        rgba(255, 255, 255, 0.085);

      color:
        rgba(255, 255, 255, 0.88);
    }

    .matumbo-air-keyboard__handle:active {
      cursor: grabbing;
    }

    .matumbo-air-keyboard__handle-dot {
      width: 3px;
      height: 3px;

      border-radius: 50%;

      background: currentColor;

      box-shadow:
        0 6px 0 currentColor,
        0 -6px 0 currentColor;
    }

    .matumbo-air-keyboard__title {
      min-width: 0;

      font-size: 8px;
      line-height: 1;

      letter-spacing: 0.18em;
      font-weight: 700;

      color:
        rgba(255, 255, 255, 0.48);

      white-space: nowrap;
    }

    .matumbo-air-keyboard__status {
      margin-left: auto;

      min-width: 45px;

      text-align: right;

      font-size: 7px;
      line-height: 1;

      letter-spacing: 0.12em;
      font-weight: 700;

      color:
        rgba(145, 210, 255, 0.62);

      white-space: nowrap;
    }

    .matumbo-air-keyboard__surface {
      display: flex;
      flex-direction: column;

      gap: 5px;

      width: 100%;
    }

    .matumbo-air-keyboard__row {
      display: flex;
      align-items: stretch;
      justify-content: center;

      gap: 5px;

      min-width: 0;
    }

    .matumbo-air-keyboard__key {
      appearance: none;
      -webkit-appearance: none;

      box-sizing: border-box;

      min-width: 0;
      flex:
        var(--key-width)
        var(--key-width)
        0;

      height: clamp(
        34px,
        5.7vw,
        48px
      );

      padding: 0 4px;

      border:
        1px solid
        rgba(255, 255, 255, 0.085);

      border-radius: 10px;

      background:
        linear-gradient(
          145deg,
          rgba(255, 255, 255, 0.105),
          rgba(255, 255, 255, 0.038)
        );

      box-shadow:
        inset 0 1px 0
          rgba(255, 255, 255, 0.065),
        0 3px 12px
          rgba(0, 0, 0, 0.12);

      color:
        rgba(255, 255, 255, 0.88);

      font: inherit;
      font-size: clamp(
        11px,
        1.75vw,
        14px
      );

      font-weight: 560;

      line-height: 1;

      cursor: pointer;

      outline: none;

      transition:
        background 90ms ease,
        border-color 90ms ease,
        transform 90ms ease,
        box-shadow 90ms ease,
        color 90ms ease;

      touch-action: manipulation;
    }

    .matumbo-air-keyboard__key:hover {
      border-color:
        rgba(255, 255, 255, 0.16);

      background:
        linear-gradient(
          145deg,
          rgba(255, 255, 255, 0.145),
          rgba(255, 255, 255, 0.06)
        );

      color:
        rgba(255, 255, 255, 0.98);

      box-shadow:
        inset 0 1px 0
          rgba(255, 255, 255, 0.085),
        0 5px 16px
          rgba(0, 0, 0, 0.16);
    }

    .matumbo-air-keyboard__key:focus-visible {
      border-color:
        rgba(145, 210, 255, 0.62);

      box-shadow:
        0 0 0 2px
          rgba(145, 210, 255, 0.13),
        inset 0 1px 0
          rgba(255, 255, 255, 0.085);
    }

    .matumbo-air-keyboard__key:active,
    .matumbo-air-keyboard__key.is-pressed {
      transform:
        translateY(1px)
        scale(0.965);

      border-color:
        rgba(145, 210, 255, 0.46);

      background:
        linear-gradient(
          145deg,
          rgba(145, 210, 255, 0.20),
          rgba(255, 255, 255, 0.07)
        );

      color: #fff;

      box-shadow:
        inset 0 1px 0
          rgba(255, 255, 255, 0.13),
        0 0 18px
          rgba(145, 210, 255, 0.10);
    }

    .matumbo-air-keyboard__key.is-active {
      border-color:
        rgba(145, 210, 255, 0.50);

      background:
        linear-gradient(
          145deg,
          rgba(145, 210, 255, 0.18),
          rgba(255, 255, 255, 0.055)
        );

      color:
        rgba(190, 230, 255, 0.98);
    }

    @media (max-width: 560px) {
      .matumbo-air-keyboard {
        width:
          calc(100vw - 12px);

        left: 0;

        padding:
          6px 6px 8px;

        border-radius: 17px;
      }

      .matumbo-air-keyboard__header {
        height: 24px;
      }

      .matumbo-air-keyboard__row {
        gap: 3px;
      }

      .matumbo-air-keyboard__surface {
        gap: 3px;
      }

      .matumbo-air-keyboard__key {
        height: clamp(
          32px,
          10vw,
          43px
        );

        border-radius: 8px;
      }

      .matumbo-air-keyboard__title {
        font-size: 7px;
      }

      .matumbo-air-keyboard__status {
        font-size: 6px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .matumbo-air-keyboard,
      .matumbo-air-keyboard.is-visible,
      .matumbo-air-keyboard__key {
        transition: none;
      }
    }
  `;
  document.head.appendChild(style);
}
