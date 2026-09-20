import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PICTURE_MATTER_METADATA_BOUNDARY,
  PICTURE_MATTER_METADATA_SOURCE,
  WIKIMEDIA_COMMONS_API,
  buildWikimediaCommonsMetadataUrl,
  createUnavailablePictureMatterMetadata,
  fetchPictureMatterMetadata,
} from "../src/domains/picture-matter-metadata.js";

const payload = Object.freeze({
  query: Object.freeze({
    pages: Object.freeze([
      Object.freeze({
        pageid: 101,
        title: "File:Reality sample.jpg",
        imageinfo: Object.freeze([Object.freeze({
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Reality_sample.jpg",
          thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/r/reality/320px-Reality.jpg",
          mime: "image/jpeg",
          size: 2048,
          width: 640,
          height: 480,
          timestamp: "2026-08-28T12:00:00Z",
        })]),
      }),
      Object.freeze({
        pageid: 102,
        title: "File:Second sample.png",
        imageinfo: Object.freeze([Object.freeze({
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Second_sample.png",
          mime: "image/png",
          size: 4096,
          width: 320,
          height: 200,
          timestamp: "2026-08-28T12:01:00Z",
        })]),
      }),
    ]),
  }),
});

test("Wikimedia metadata URL is fixed, bounded, and origin-enabled", () => {
  const url = new URL(buildWikimediaCommonsMetadataUrl({
    query: " reality   lens ".repeat(30),
    limit: 99,
  }));
  assert.equal(`${url.origin}${url.pathname}`, WIKIMEDIA_COMMONS_API);
  assert.equal(url.searchParams.get("action"), "query");
  assert.equal(url.searchParams.get("generator"), "search");
  assert.equal(url.searchParams.get("gsrnamespace"), "6");
  assert.equal(url.searchParams.get("gsrlimit"), "5");
  assert.equal(url.searchParams.get("iiprop"), "url|mime|size|timestamp");
  assert.equal(url.searchParams.get("iiurlwidth"), "320");
  assert.equal(url.searchParams.get("origin"), "*");
  assert.ok(url.searchParams.get("gsrsearch").length <= 64);
  assert.equal([...url.searchParams.keys()].includes("prop"), true);
  assert.equal([...url.searchParams.keys()].includes("imageinfo"), false);
});

test("metadata refresh returns canonical records without image bytes", async () => {
  const requests = [];
  const result = await fetchPictureMatterMetadata({
    query: "reality",
    limit: 3,
    now: () => "2026-08-28T12:02:03Z",
    fetchImpl: async (requestUrl, options) => {
      requests.push({ requestUrl, options });
      return { ok: true, status: 200, json: async () => payload };
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, PICTURE_MATTER_METADATA_SOURCE);
  assert.equal(result.provider, "Wikimedia Commons");
  assert.equal(result.returnedCount, 2);
  assert.equal(result.records[0].sourceUrl, "https://commons.wikimedia.org/wiki/File:Reality_sample.jpg");
  assert.equal(result.records[0].thumbnailUrl.startsWith("https://upload.wikimedia.org/"), true);
  assert.equal(result.records[1].thumbnailUrl, null);
  assert.equal(result.records[0].metadataOnly, true);
  assert.equal(result.records[0].imageBytesFetched, false);
  assert.equal(result.records[0].imageBytesStored, false);
  assert.equal(result.records[0].imageBytesRendered, false);
  assert.equal(result.records[0].persistence, false);
  assert.equal(result.records[0].publishing, false);
  assert.equal(result.records[0].authority, undefined);
  assert.equal("originalUrl" in result.records[0], false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.records[0]), true);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].requestUrl).origin, "https://commons.wikimedia.org");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers.accept, "application/json");
});

test("metadata read fails closed without a fallback row", async () => {
  const unavailable = createUnavailablePictureMatterMetadata({
    retrievedAt: "2026-08-28T12:03:00Z",
    reason: "explicit test unavailability",
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.returnedCount, 0);
  assert.deepEqual(unavailable.records, []);
  assert.match(unavailable.unavailableReason, /explicit test/);
  assert.equal(unavailable.boundary, PICTURE_MATTER_METADATA_BOUNDARY);

  const failed = await fetchPictureMatterMetadata({
    fetchImpl: async () => { throw new Error("network blocked"); },
    now: () => "2026-08-28T12:04:00Z",
  });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.returnedCount, 0);
  assert.deepEqual(failed.records, []);
  assert.match(failed.unavailableReason, /network blocked/);

  const malformed = await fetchPictureMatterMetadata({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ query: { pages: [{ pageid: 1 }] } }) }),
    now: () => "2026-08-28T12:05:00Z",
  });
  assert.equal(malformed.status, "unavailable");
  assert.equal(malformed.providerAvailable, true);
  assert.match(malformed.unavailableReason, /no usable image metadata/);
});
