import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ARENA_GAME_MODES,
  ARENA_GAMES_BOUNDARY,
  ARENA_GAMES_HASH_ALGORITHM,
  ARENA_GAMES_SOURCE,
  applyArenaGameAction,
  createArenaGameState,
  createArenaGamesContribution,
  replayArenaGame,
  resetArenaGame,
} from "../src/domains/arena-games.js";
import {
  ARENA_GAMES_CONSOLE_SOURCE,
  createArenaGamesConsole,
  summarizeArenaGames,
} from "../src/render/arena-games.js";

function makeElement(documentRoot, tag = "div") {
  return {
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
    ["arena-games-console", true],
    ["arena-games-close"],
    ["arena-games-modes"],
    ["arena-games-actions"],
    ["arena-games-replay"],
    ["arena-games-reset"],
    ["arena-games-status"],
    ["arena-games-current"],
    ["arena-games-turn"],
    ["arena-games-hash"],
    ["arena-games-trace"],
    ["arena-games-boundary"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

test("ARENA contribution is deterministic and exposes three bounded modes", () => {
  const left = createArenaGamesContribution();
  const right = createArenaGamesContribution();
  assert.equal(left.source, ARENA_GAMES_SOURCE);
  assert.deepEqual(left, right);
  assert.deepEqual(left.modes.map((mode) => mode.id), ["nebula-rally", "chrono-grid", "orbital-duel"]);
  assert.equal(left.sessions.length, ARENA_GAME_MODES.length);
  assert.equal(left.entities.length, 6);
  assert.equal(left.deterministic, true);
  assert.equal(left.simulation, true);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.modes), true);
  assert.equal(Object.isFrozen(left.sessions[0]), true);
  assert.equal(left.capabilities.some((capability) => capability.denied === true), true);
  assert.equal(left.evidence[0].hashAlgorithm, ARENA_GAMES_HASH_ALGORITHM);
});

test("legal and invalid actions are atomic and visible in the stable event chain", () => {
  const initial = createArenaGameState("nebula-rally");
  const legal = applyArenaGameAction(initial, "boost");
  assert.equal(legal.accepted, true);
  assert.equal(legal.state.turn, 1);
  assert.equal(legal.state.values.progress, 2);
  assert.equal(legal.state.events.length, 1);
  assert.equal(legal.state.events[0].previousHash, "00000000");
  assert.equal(legal.state.events[0].hash.length, 8);
  assert.equal(Object.isFrozen(legal.state.events[0]), true);

  const beforeInvalid = JSON.stringify(legal.state.values);
  const invalid = applyArenaGameAction(legal.state, "not-a-nebula-action");
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.rejected, true);
  assert.match(invalid.reason, /unknown action/i);
  assert.equal(invalid.state.turn, legal.state.turn);
  assert.equal(JSON.stringify(invalid.state.values), beforeInvalid);
  assert.equal(invalid.state.events.length, 2);
  assert.equal(invalid.state.events[1].accepted, false);
  assert.equal(invalid.state.events[1].previousHash, legal.state.headHash);
  assert.equal(invalid.state.rejectedActionCount, 1);
  assert.equal(invalid.state.localOnly, true);
  assert.equal(invalid.state.externalNetwork, false);

  const noCharge = createArenaGameState("orbital-duel");
  const rejectedPulse = applyArenaGameAction(noCharge, "pulse");
  assert.equal(rejectedPulse.accepted, false);
  assert.match(rejectedPulse.reason, /two charge/i);
  assert.equal(rejectedPulse.state.turn, 0);

  const outOfBounds = createArenaGameState("chrono-grid");
  const rejectedWest = applyArenaGameAction(outOfBounds, "west");
  assert.equal(rejectedWest.accepted, false);
  assert.match(rejectedWest.reason, /grid/i);
});

test("replay and reset are deterministic, frozen, and local-only", () => {
  const actions = ["boost", "drift", "scan", "boost"];
  const first = replayArenaGame("nebula-rally", actions);
  const second = replayArenaGame("nebula-rally", actions);
  assert.deepEqual(first, second);
  assert.equal(first.acceptedCount, 4);
  assert.equal(first.rejectedCount, 0);
  assert.equal(first.eventCount, 4);
  assert.equal(first.state.values.progress, 5);
  assert.equal(first.deterministic, true);
  assert.equal(first.localOnly, true);
  assert.equal(first.externalNetwork, false);
  assert.equal(first.persistence, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.state.events), true);
  assert.equal(Object.isFrozen(first.state.values), true);

  const reset = resetArenaGame(first.state);
  assert.equal(reset.action, "reset");
  assert.equal(reset.modeId, "nebula-rally");
  assert.equal(reset.state.turn, 0);
  assert.equal(reset.state.headHash, "00000000");
  assert.equal(reset.state.events.length, 0);
  assert.equal(reset.state.localOnly, true);
  assert.equal(reset.state.executable, false);
});

test("Game Lab console exposes mode/action/replay/reset controls and rejected actions", () => {
  const documentRoot = makeDocument();
  const actions = [];
  const console = createArenaGamesConsole({
    documentRoot,
    projection: createArenaGamesContribution(),
    onMode: (snapshot) => actions.push(snapshot),
    onAction: (snapshot) => actions.push(snapshot),
    onReplay: (snapshot) => actions.push(snapshot),
    onReset: (snapshot) => actions.push(snapshot),
  });
  assert.equal(console.getSnapshot().source, ARENA_GAMES_CONSOLE_SOURCE);
  assert.equal(console.getSnapshot().opened, false);
  const selected = console.selectMode("chrono-grid", "test");
  assert.equal(selected.modeId, "chrono-grid");
  const moved = console.action("east", "test");
  assert.equal(moved.accepted, true);
  const rejected = console.action("west", "test");
  assert.equal(rejected.accepted, true);
  const invalid = console.action("south", "test");
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.rejected, true);
  assert.equal(console.getSnapshot().state.rejectedActionCount, 1);
  const replay = console.replay("test");
  assert.equal(replay.action, "replay");
  assert.equal(replay.result.deterministic, true);
  const reset = console.reset("test");
  assert.equal(reset.action, "reset");
  assert.equal(console.getSnapshot().state.turn, 0);
  assert.deepEqual(actions.map((entry) => entry.action), ["select-mode", "game-action", "game-action", "game-action", "replay", "reset"]);
  assert.equal(actions.every((entry) => entry.localOnly === true && entry.externalNetwork === false && entry.executable === false), true);
  assert.equal(Object.isFrozen(console.getSnapshot()), true);
});

test("renderer summary and adapter source retain the explicit no-runtime boundary", async () => {
  const summary = summarizeArenaGames({ contributions: [createArenaGamesContribution()] });
  assert.equal(summary.source, ARENA_GAMES_SOURCE);
  assert.equal(summary.modeCount, 3);
  assert.equal(summary.boundary, ARENA_GAMES_BOUNDARY);
  assert.equal(summary.localOnly, true);
  assert.equal(summary.persistence, false);

  const source = await readFile(new URL("../src/domains/arena-games.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/render/arena-games.js", import.meta.url), "utf8");
  for (const id of [
    "arena-games-console",
    "arena-games-close",
    "arena-games-modes",
    "arena-games-actions",
    "arena-games-replay",
    "arena-games-reset",
    "arena-games-current",
    "arena-games-trace",
    "arena-games-boundary",
  ]) assert.match(renderer, new RegExp(id));
  assert.match(source, /ARENA_GAMES_HASH_ALGORITHM/);
  assert.match(source, /imported game project/i);
  assert.match(source, /persistence:\s*false/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /\bimport\s*\(/i);
  assert.doesNotMatch(source, /\beval\s*\(/i);
  assert.doesNotMatch(renderer, /\bfetch\s*\(/i);
  assert.doesNotMatch(renderer, /\bimport\s*\(/i);
  assert.doesNotMatch(renderer, /\beval\s*\(/i);
});
