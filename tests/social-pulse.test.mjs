import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SOCIAL_PULSE_BOUNDARY,
  SOCIAL_PULSE_DEFAULT_ACTOR,
  SOCIAL_PULSE_ENDPOINT,
  SOCIAL_PULSE_SOURCE,
  buildBlueskySocialPulseUrl,
  createUnavailableSocialPulse,
  fetchSocialPulse,
} from "../src/domains/social-pulse.js";

const feedPayload = Object.freeze({
  feed: Object.freeze([
    Object.freeze({
      post: Object.freeze({
        uri: "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3sample1",
        author: Object.freeze({ handle: "atproto.com", displayName: "AT Protocol Developers", did: "did:plc:ewvi7nxzyoun6zhxrhs64oiz" }),
        record: Object.freeze({
          text: "A public post with an ignored image embed.",
          createdAt: "2026-08-28T12:00:00Z",
          embed: Object.freeze({ "$type": "app.bsky.embed.images" }),
        }),
        indexedAt: "2026-08-28T12:00:01Z",
        replyCount: 1,
        repostCount: 2,
        likeCount: 3,
        quoteCount: 4,
        embed: Object.freeze({ images: [] }),
      }),
    }),
    Object.freeze({
      post: Object.freeze({
        uri: "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3sample1",
        author: Object.freeze({ handle: "atproto.com", displayName: "AT Protocol Developers" }),
        record: Object.freeze({ text: "Duplicate should be dropped.", createdAt: "2026-08-28T12:00:00Z" }),
      }),
    }),
    Object.freeze({
      post: Object.freeze({
        uri: "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3sample2",
        author: Object.freeze({ handle: "atproto.com", displayName: "AT Protocol Developers" }),
        record: Object.freeze({ text: "Second public observation.", createdAt: "2026-08-28T11:00:00Z" }),
        indexedAt: "2026-08-28T11:00:01Z",
      }),
    }),
  ]),
});

test("Bluesky pulse URL is fixed to the public AppView and allowlisted actor", () => {
  const url = new URL(buildBlueskySocialPulseUrl({ actor: "other.example", limit: 99 }));
  assert.equal(`${url.origin}${url.pathname}`, SOCIAL_PULSE_ENDPOINT);
  assert.equal(url.searchParams.get("actor"), SOCIAL_PULSE_DEFAULT_ACTOR);
  assert.equal(url.searchParams.get("limit"), "8");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["actor", "limit"]);
});

test("Bluesky pulse normalizes at most eight untrusted text observations and omits media", async () => {
  const calls = [];
  const result = await fetchSocialPulse({
    actor: "atproto.com",
    limit: 8,
    now: () => "2026-08-28T12:02:03Z",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => feedPayload };
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, SOCIAL_PULSE_SOURCE);
  assert.equal(result.providerAvailable, true);
  assert.equal(result.returnedCount, 2);
  assert.equal(result.records[0].text, "A public post with an ignored image embed.");
  assert.equal(result.records[0].publicSource, true);
  assert.equal(result.records[0].untrusted, true);
  assert.equal(result.records[0].mediaPresent, true);
  assert.equal(result.records[0].mediaBytesFetched, false);
  assert.equal(result.records[0].mediaBytesStored, false);
  assert.equal(result.records[0].mediaBytesRendered, false);
  assert.equal(result.records[0].authentication, false);
  assert.equal(result.records[0].identityResolution, false);
  assert.equal(result.records[0].posting, false);
  assert.equal(result.records[0].sourceUrl, "https://bsky.app/profile/atproto.com/post/3sample1");
  assert.equal("embed" in result.records[0], false);
  assert.equal("avatar" in result.records[0], false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.records[0]), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.accept, "application/json");
});

test("Bluesky pulse remains visibly unavailable on errors or unusable payloads", async () => {
  const initial = createUnavailableSocialPulse({
    retrievedAt: "2026-08-28T12:04:00Z",
    reason: "No refresh yet.",
  });
  assert.equal(initial.status, "unavailable");
  assert.equal(initial.returnedCount, 0);
  assert.equal(initial.boundary, SOCIAL_PULSE_BOUNDARY);
  assert.deepEqual(initial.records, []);

  const failed = await fetchSocialPulse({
    fetchImpl: async () => { throw new Error("network blocked"); },
    now: () => "2026-08-28T12:05:00Z",
  });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.providerAvailable, false);
  assert.equal(failed.externalNetwork, false);
  assert.deepEqual(failed.records, []);
  assert.match(failed.unavailableReason, /network blocked/);

  const empty = await fetchSocialPulse({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ feed: [] }) }),
    now: () => "2026-08-28T12:06:00Z",
  });
  assert.equal(empty.status, "unavailable");
  assert.equal(empty.providerAvailable, true);
  assert.equal(empty.externalNetwork, true);
  assert.match(empty.unavailableReason, /no usable text observations/);
});
