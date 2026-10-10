import assert from "node:assert/strict";
import { test } from "node:test";
import { createBotRegistry, createBotRuntime, createMessageBus, validateBotPlugin } from "../src/domains/bot-plaza.js";
import { LENS_BOT_FACTORIES, LENS_GUIDE_ROUTES, createLensGuidePlugin, createPlanHelperPlugin } from "../src/domains/lens-bot-plugins.js";
import { FEATURE_DEFINITIONS } from "../src/render/feature-navigator.js";

function storage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("bundled guides start without installation or granted powers", () => {
  const registry = createBotRegistry({ storage: storage(), pluginFactories: LENS_BOT_FACTORIES });
  for (const id of Object.keys(LENS_BOT_FACTORIES)) {
    const bot = registry.getBot(id);
    assert.equal(bot.enabled, true);
    assert.equal(bot.persisted, true);
    assert.deepEqual(bot.declaredCapabilities, []);
    assert.deepEqual(bot.approvedCapabilities, []);
  }
  assert.ok(registry.getBot("muse-agent"));
  assert.deepEqual(registry.getStartupIssues(), []);
});

test("startup restores disabled preference but cannot grant guide capabilities", () => {
  const saved = storage();
  const first = createBotRegistry({ storage: saved, pluginFactories: LENS_BOT_FACTORIES });
  first.setEnabled("lens-guide", false);
  first.approveCapabilities("plan-helper", ["world.launch-feature", "world.announce"]);
  const restored = createBotRegistry({ storage: saved, pluginFactories: LENS_BOT_FACTORIES });
  assert.equal(restored.getBot("lens-guide").enabled, false);
  assert.equal(restored.getBot("plan-helper").enabled, true);
  assert.deepEqual(restored.getBot("plan-helper").approvedCapabilities, []);
});

test("every suggested route exists and each route name resolves locally", () => {
  const ids = new Set(FEATURE_DEFINITIONS.map(({ id }) => id));
  const plugin = validateBotPlugin(createLensGuidePlugin());
  for (const route of LENS_GUIDE_ROUTES) {
    assert.ok(ids.has(route.id), route.id);
    const reply = plugin.onMessage(null, { text: `open ${route.id}` });
    assert.match(reply, new RegExp(`feature=${route.id}`));
  }
});

test("guide exposes useful single-space steps and bounded choices", () => {
  const guide = createLensGuidePlugin();
  assert.match(guide.onMessage(null, { text: "I want my GPT" }), /feature=web-ai/);
  assert.match(guide.onMessage(null, { text: "save messages" }), /Messages stay in this browser/);
  const choices = guide.onMessage(null, { text: "chess and wardrobe" });
  assert.match(choices, /feature=chess/);
  assert.match(choices, /feature=wardrobe-atelier/);
  assert.match(choices, /choose one/);
  assert.doesNotMatch(guide.onMessage(null, { text: "chair" }), /feature=web-ai/);
  assert.match(guide.onMessage(null, { text: "unknown custom request" }), /fixed local route vocabulary/);
});

test("planning uses honest finite templates, five steps and bounded requests", () => {
  const helper = validateBotPlugin(createPlanHelperPlugin());
  for (const [request, expected] of [["research a claim", /two public sources/], ["build a new room", /smallest useful first version/], ["learn T402", /Academy lesson/], ["clean the chaos", /one space to organize/]]) {
    const reply = helper.onMessage(null, { text: request });
    assert.match(reply, expected);
    assert.match(reply, /5\./);
    assert.match(reply, /Nothing has been executed or scheduled/);
    assert.ok(reply.length <= 1000);
  }
  assert.ok(helper.onMessage(null, { text: "😺".repeat(2000) }).length <= 1000);
});

test("runtime replies without contacting tools, publishing events or creating drafts", () => {
  const registry = createBotRegistry({ pluginFactories: LENS_BOT_FACTORIES });
  const bus = createMessageBus();
  const calls = [];
  const runtime = createBotRuntime({ registry, bus, actionHandlers: {
    "world.launch-feature": (params) => calls.push(params),
    "world.announce": (params) => calls.push(params),
  } });
  assert.equal(runtime.tellBot("lens-guide", "open wardrobe").ok, true);
  assert.equal(runtime.tellBot("plan-helper", "make something useful").ok, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(runtime.getJournal(), []);
  assert.deepEqual(runtime.getDrafts(), []);
  const replies = bus.getLog().filter(({ from }) => Object.hasOwn(LENS_BOT_FACTORIES, from));
  assert.equal(replies.length, 2);
  assert.match(replies[0].text, /feature=wardrobe-atelier/);
  assert.match(replies[1].text, /scripted local checklist/);
  registry.setEnabled("plan-helper", false);
  assert.equal(runtime.tellBot("plan-helper", "build"), null);
  assert.equal(bus.getLog().filter(({ from }) => from === "plan-helper").length, 1);
});
