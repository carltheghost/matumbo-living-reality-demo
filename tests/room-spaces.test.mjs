import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  ROOM_SPACES_CONSOLE_SOURCE,
  ROOM_SPACES_SOURCE,
  createRoomSpaces,
  summarizeRooms,
} from "../src/render/room-spaces.js";

function makeElement(documentRoot, tag = "div") {
  const element = {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force === true) this.values.add(name);
        else if (force === false) this.values.delete(name);
        else if (this.values.has(name)) this.values.delete(name);
        else this.values.add(name);
      },
    },
    append(...children) {
      children.forEach((child) => this.appendChild(child));
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    focus() {},
  };
  return element;
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) {
      return makeElement(documentRoot, tag);
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    addEventListener() {},
    register(id, hidden = false) {
      const element = makeElement(documentRoot);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  [
    ["room-console", true],
    ["room-console-close"],
    ["room-console-replay"],
    ["room-console-enter"],
    ["room-console-leave"],
    ["room-console-status"],
    ["room-console-current"],
    ["room-console-membership"],
    ["room-console-room-count"],
    ["room-console-membership-count"],
    ["room-console-message-indicator"],
    ["room-console-list"],
    ["room-console-trace"],
    ["room-console-boundary"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

test("room summary reads two canonical rooms, roles, and metadata-only messaging", () => {
  const projection = createLivingRealityProjection().world;
  const summary = summarizeRooms(projection);
  assert.equal(summary.source, ROOM_SPACES_SOURCE);
  assert.equal(summary.roomCount, 2);
  assert.equal(summary.membershipCount, 2);
  assert.deepEqual(summary.rooms.map((room) => room.id), ["room:reality", "room:market"]);
  assert.deepEqual(summary.rooms.map((room) => room.role), ["owner", "observer"]);
  assert.equal(summary.message.indicator, "protected");
  assert.equal(summary.message.contentRetained, false);
  assert.equal(summary.message.cryptographyImplemented, false);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.rooms), true);
  assert.equal(Object.isFrozen(summary.rooms[0].memberships), true);
});

test("room console select, enter, leave, and replay stay local and do not mutate canonical state", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const documentRoot = makeDocument();
  const actions = [];
  const roomSpaces = createRoomSpaces({
    documentRoot,
    projection,
    onSelect: (action) => actions.push(action),
    onEnter: (action) => actions.push(action),
    onLeave: (action) => actions.push(action),
    onReplay: (action) => actions.push(action),
  });

  const selected = roomSpaces.selectRoom("room:market", "test");
  assert.equal(selected.source, ROOM_SPACES_CONSOLE_SOURCE);
  assert.equal(selected.action, "select");
  assert.equal(roomSpaces.getSnapshot().selectedId, "room:market");

  const entered = roomSpaces.enterRoom("test");
  assert.equal(entered.action, "enter");
  assert.equal(roomSpaces.getSnapshot().enteredRoomId, "room:market");
  assert.equal(roomSpaces.getSnapshot().enteredRoom.role, "observer");

  const left = roomSpaces.leaveRoom("test");
  assert.equal(left.action, "leave");
  assert.equal(roomSpaces.getSnapshot().enteredRoomId, null);

  const replay = roomSpaces.replay("test");
  assert.deepEqual(replay.steps, ["entered", "left"]);
  assert.equal(roomSpaces.getSnapshot().enteredRoomId, null);
  assert.equal(roomSpaces.getSnapshot().replayCount, 1);
  assert.equal(actions.slice(0, 5).map((action) => action.action).join(","), "select,enter,leave,enter,leave");
  assert.equal(actions[5].source, ROOM_SPACES_CONSOLE_SOURCE);
  assert.equal(actions[5].replayCount, 1);
  assert.equal(actions.every((action) => action.simulation === true && action.localOnly === true), true);
  assert.equal(actions.every((action) => action.externalNetwork === false && action.externalTransfer === false), true);
  assert.equal(JSON.stringify(projection), before);
  assert.equal(Object.isFrozen(replay), true);
});

test("room console markup exposes enter and leave controls without an external execution path", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/room-spaces.js", import.meta.url), "utf8");
  for (const id of [
    "room-console",
    "room-console-list",
    "room-console-enter",
    "room-console-leave",
    "room-console-replay",
    "room-console-current",
    "room-console-message-indicator",
    "room-console-trace",
    "room-console-boundary",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Rooms \+ Messaging/i);
  assert.match(html, /Enter selected room/i);
  assert.match(html, /Leave room/i);
  assert.match(html, /Replay local enter \/ leave/i);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /navigator\.sendBeacon/i);
});
