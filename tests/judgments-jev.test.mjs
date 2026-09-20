import test from "node:test";
import assert from "node:assert/strict";
import {
  askJudgments,
  botIntentQuestion,
  proposalReadinessQuestion,
  JEV_DEFAULT_TYPESAFE_ENDPOINT,
} from "../src/ai/judgments.js";

test("Jev HTTP provider sends the documented System One request and normalizes Choice", async () => {
  const previousKey = process.env.TYPESAFE_API_KEY;
  const previousUrl = process.env.TYPESAFE_API_URL;
  const previousJevKey = process.env.JEV_AGENT_KEY;
  const previousJevUrl = process.env.JEV_API_URL;

  process.env.TYPESAFE_API_KEY = "test-key";
  delete process.env.TYPESAFE_API_URL;
  delete process.env.JEV_AGENT_KEY;
  delete process.env.JEV_API_URL;

  const originalFetch = globalThis.fetch;
  let request = null;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() {
        return {
          model: "jev-1.13.0",
          answers: {
            "bot-intent": {
              type: "choice",
              choice: "world_action",
              confidence: 0.91,
              probabilities: {
                world_action: 0.91,
                chat: 0.06,
                help: 0.03,
              },
            },
          },
          usage: { input_tokens: 20, output_tokens: 8 },
        };
      },
    };
  };

  try {
    const result = await askJudgments(
      { message: "open the cube" },
      [botIntentQuestion()],
      "http",
    );

    assert.equal(request.url, JEV_DEFAULT_TYPESAFE_ENDPOINT);
    const body = JSON.parse(request.options.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.state.message, "open the cube");
    assert.equal(body.questions["bot-intent"].type, "choice");
    assert.equal(result.provider, "jev");
    assert.equal(result.model, "jev-1.13.0");
    assert.equal(result.answers["bot-intent"].answer.choice, "world_action");
    assert.equal(result.answers["bot-intent"].answer.confidence, 0.91);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.TYPESAFE_API_URL;
    else process.env.TYPESAFE_API_URL = previousUrl;
    if (previousJevKey === undefined) delete process.env.JEV_AGENT_KEY;
    else process.env.JEV_AGENT_KEY = previousJevKey;
    if (previousJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = previousJevUrl;
  }
});

test("Jev Score readiness remains normalized to the local 0..1 convention", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.JEV_AGENT_KEY;
  const previousJevUrl = process.env.JEV_API_URL;

  process.env.JEV_AGENT_KEY = "jv_live_test";
  delete process.env.JEV_API_URL;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_URL;

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        model: "jev-1.13.0",
        answers: {
          "proposal-readiness": {
            type: "score",
            score: 0.8,
            legend: { "0": "not ready", "1": "fully reviewable" },
            probabilities: { "0": 0.2, "1": 0.8 },
            confidence: 0.88,
          },
        },
      };
    },
  });

  try {
    const result = await askJudgments({}, [proposalReadinessQuestion()], "http");
    assert.equal(result.provider, "jev");
    assert.equal(result.answers["proposal-readiness"].answer.score, 0.8);
    assert.equal(result.answers["proposal-readiness"].answer.confidence, 0.88);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.JEV_AGENT_KEY;
    else process.env.JEV_AGENT_KEY = previousKey;
    if (previousJevUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = previousJevUrl;
  }
});

test("malformed Jev output fails closed to the deterministic heuristic", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "test-key";

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { model: "jev-1.13.0", answers: {} };
    },
  });

  try {
    const result = await askJudgments(
      { message: "open the cube" },
      [botIntentQuestion()],
      "http",
    );
    assert.equal(result.provider, "heuristic");
    assert.equal(result.answers["bot-intent"].answer.choice, "world_action");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
  }
});
