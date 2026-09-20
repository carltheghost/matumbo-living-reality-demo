import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH,
  CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM,
  CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
  CONTRACTS_MARKETS_GRAPH_ROUTE_PARAM,
  validateContractDraftRouteState,
} from "../src/domains/contracts-markets.js";

test("Packet 182 main route serializes and hydrates a bounded local detail URL", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /function writeContractsDraftRoute\(routeState\)/);
  assert.match(main, /history\.pushState\(null, '', url\)/);
  assert.match(main, /function parseContractsDraftRoute\(query\)/);
  assert.match(main, /JSON\.parse\(serialized\)/);
  assert.match(main, /validateContractDraftRouteState\(parsed\)/);
  assert.match(main, /contractsMarkets\?\.hydrateDraftRouteState\?\.\(draftRoute\.state, method\)/);
  assert.match(main, /addEventListener\?\.\('popstate'/);
  assert.match(main, /parseSportsSourceReturnRoute\(sportsRouteQuery\)/);
  assert.match(main, /sourceReturn: sourceReturn\.strict/);
  assert.match(main, /openSportsEvents\('url', sourceReturn\.strict \? sourceReturn\.valid : true/);
  assert.match(main, /selectSportsRecordAfterRouteRefresh/);
});

test("valid local detail and graph routes skip protocol refresh while only explicit protocol routes refresh", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("function applyContractsRoute(method = 'url')");
  const end = main.indexOf("globalThis.addEventListener?.('popstate'", start);
  assert.ok(start >= 0 && end > start);
  const routeBlock = main.slice(start, end);
  assert.match(routeBlock, /const graphRoute = parseContractsGraphRoute\(query\)/);
  assert.match(routeBlock, /hydrateGraphRouteState/);
  assert.match(routeBlock, /if \(draftRoute\.present\)/);
  assert.match(routeBlock, /hydrateDraftRouteState/);
  assert.match(routeBlock, /if \(protocolRoute && method === 'url'\) void protocolEvidence\?\.refresh\('url'\)/);
  const detailBranch = routeBlock.slice(routeBlock.indexOf("if (draftRoute.present)"), routeBlock.indexOf("} else {"));
  assert.doesNotMatch(detailBranch, /protocolEvidence\?\.refresh/);
  const plainBranch = routeBlock.slice(routeBlock.lastIndexOf("} else {"));
  assert.doesNotMatch(plainBranch, /if \(method === 'url'\) void protocolEvidence/);
});

test("Packet 185 graph route is bounded and uses the canonical record validator", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const domain = await readFile(new URL("../src/domains/contracts-markets.js", import.meta.url), "utf8");
  assert.equal(CONTRACTS_MARKETS_GRAPH_ROUTE_PARAM, "graph");
  assert.equal(CONTRACTS_MARKETS_GRAPH_ROUTE_MODE, "expanded");
  assert.match(main, /function parseContractsGraphRoute\(query\)/);
  assert.match(main, /validateContractsMarketsGraphRoute\(\{/);
  assert.match(main, /graph route record is malformed, unknown, or not a canonical contract\/pool graph node/);
  assert.match(domain, /GRAPH_ROUTE_RECORD_KINDS/);
  assert.match(domain, /position-scenario/);
  assert.match(domain, /return Object\.freeze\(\{/);
});

test("route parser bounds the encoded draft before JSON or provider work", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const domain = await readFile(new URL("../src/domains/contracts-markets.js", import.meta.url), "utf8");
  assert.match(main, new RegExp(`${CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM}`));
  assert.match(main, new RegExp(`length > CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH`));
  assert.match(domain, /CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH = 4096/);
  assert.equal(CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH, 4096);
  assert.equal(validateContractDraftRouteState(null), null);
});

test("route source return carries a bounded provider record and refuses non-ESPN provenance", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /createSportsContractSourceRoute\(record = null\)/);
  assert.match(main, /url\.searchParams\.set\('record', recordId\)/);
  assert.match(main, /isAllowlistedSportsProvenanceUrl\(record\.sourceUrl\)/);
  assert.match(main, /requested provider record was not returned/);
  assert.match(main, /sportsEventsConsole\?\.selectRecord\?\.\(record\.id, `route:\$\{method\}`\)/);
  assert.match(main, /SPORTS_SOURCE_RETURN_JOURNEY/);
});

test("source-return route is strict while ordinary sports routes keep their normal first-row view", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /journey !== SPORTS_SOURCE_RETURN_JOURNEY/);
  assert.match(main, /source return route is missing or has a malformed provider record id/);
  assert.match(main, /strictSourceReturn && !requestedRecordId/);
  assert.match(main, /setSourceReturnState\?\.\(\{/);
  assert.match(main, /state: requestedRecordId \? 'pending' : 'invalid'/);
});

test("draft provenance requires the exact contract-detail source journey and source record", async () => {
  const domain = await readFile(new URL("../src/domains/contracts-markets.js", import.meta.url), "utf8");
  assert.match(domain, /CONTRACTS_MARKETS_SOURCE_RETURN_JOURNEY = [\"']contract-detail-source-182/);
  assert.match(domain, /searchParams\.get\("journey"\) !== CONTRACTS_MARKETS_SOURCE_RETURN_JOURNEY/);
  assert.match(domain, /sourceRoute must identify the source sports record/);
});

test("Tennis contract handoff aligns the shared active-feature context and creates an addressable local Contract/Pool rehearsal", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("onOpenContractDraft: ({ record, method }) => {");
  const end = main.indexOf("onReplay: (snapshot)", start);
  assert.ok(start >= 0 && end > start, "expected the Tennis contract/pool handoff callback");
  const handoff = main.slice(start, end);
  assert.match(
    handoff,
    /alignFeatureSurface\('contracts', `sports-contract-draft:\$\{method \?\? 'button'\}`\)/,
    "a Tennis-to-Contracts transition must not leave the shared feature context on Tennis Evidence",
  );
  assert.match(handoff, /contractsMarkets\?\.open\(\)/);
  assert.match(handoff, /contractsMarkets\?\.prepareDraft\?\.\(record/);
  assert.match(
    handoff,
    /prepared\?\.action === 'prepare-draft'\s*\? contractsMarkets\?\.createDraft\?\.\(`sports:\$\{method \?\? 'button'\}`\)\s*:\s*null/,
    "a selected provider-backed Tennis record must create the bounded local draft before its detail links are exposed",
  );
  assert.match(handoff, /draftId: created\?\.localDraft\?\.id \?\? null/);
  assert.match(handoff, /contractId: created\?\.localDraft\?\.contract\?\.id \?\? null/);
  assert.match(handoff, /poolId: created\?\.localDraft\?\.pool\?\.id \?\? null/);
  assert.match(
    handoff,
    /localOnly: true,[\s\S]*?persistence: false,[\s\S]*?executable: false,[\s\S]*?settlement: false,[\s\S]*?custody: false/,
    "the automatic handoff must stay a local, non-custodial, non-settling rehearsal",
  );
});
